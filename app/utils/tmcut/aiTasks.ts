// =============================================================================
//  AI task registry (roadmap R130 / docs §194).
//
//  The gateway routes by TASK (plan | transcribe | triage); this module is
//  the single source for what each text task ASKS the model (system prompt,
//  user message, JSON contract) and how its answer is VALIDATED before it
//  touches any UI or the EDL. No prompt or schema lives in a component.
//
//  Honesty rules (same doctrine as the FX catalog):
//   - parsers return []/throw on unparseable answers, never fabricate data;
//   - the caller degrades to the no-AI path when a task is not configured;
//   - triage output is capped by the transcript spans it is given (a model
//     cannot rate a span that was not provided).
// =============================================================================

import type {
  AiScriptDuration,
  AiScriptPlatform,
  TmcutAiScript,
  TmcutAiScriptScene
} from './aiScript'

export type AiTaskId = 'plan' | 'transcribe' | 'triage'

/** UI-facing metadata for the AI connection panel (one row per surface). */
export const AI_TASK_META: Record<AiTaskId, { labelKey: string, icon: string, jsonMode: boolean, temperature: number }> = {
  plan: { labelKey: 'tmcut.aiConnect.surfaceEditor', icon: 'i-lucide-pen-line', jsonMode: true, temperature: 0.7 },
  transcribe: { labelKey: 'tmcut.aiConnect.surfaceTranscribe', icon: 'i-lucide-captions', jsonMode: false, temperature: 0 },
  triage: { labelKey: 'tmcut.aiConnect.surfaceAutocut', icon: 'i-lucide-scissors', jsonMode: true, temperature: 0.2 }
}

// =============================================================================
//  PLAN — editor script generation (useTmcutAiScript)
// =============================================================================

export interface AiPlanContext {
  prompt: string
  platform: AiScriptPlatform
  duration: AiScriptDuration
  targetSec: number
  language?: 'vi' | 'en'
}

export function planSystemPrompt(ctx: AiPlanContext): string {
  const lang = ctx.language === 'en' ? 'English' : 'Vietnamese'
  return `You are an expert video director and viral scriptwriter for short-form (TikTok, Reels, Shorts) and long-form (YouTube, Vlogs).
Create an engaging, structured video storyboard script in ${lang}.
The target total duration is approximately ${ctx.targetSec} seconds.
Output strictly a JSON object with this exact structure:
{
  "title": "Compelling video title",
  "synopsis": "One sentence summary of the video",
  "platform": "${ctx.platform}",
  "targetDurationSec": ${ctx.targetSec},
  "scenes": [
    {
      "id": "scene-1",
      "order": 1,
      "title": "Hook / Intro",
      "durationSec": 4,
      "visualPrompt": "Detailed visual description for video/camera or B-roll",
      "voiceover": "Spoken voiceover or dialogue text",
      "onScreenText": "Short catchy text/caption displayed on screen"
    }
  ]
}
Make sure the sum of all scenes' durationSec equals approximately ${ctx.targetSec} seconds.
Keep onScreenText punchy, short, and suited for video overlays.`
}

export function planUserMessage(ctx: AiPlanContext): string {
  return `Create a video script for the following topic/idea:
"${ctx.prompt}"
Target platform: ${ctx.platform}
Target duration: ${ctx.duration}`
}

const PLAN_SCENE_MAX_SEC = 120

/**
 * Validate + normalize a plan response. Throws on unparseable / empty
 * answers — the caller owns the curated fallback (never a silent fake).
 */
export function parsePlanScript(content: string, ctx: Pick<AiPlanContext, 'prompt' | 'platform' | 'targetSec'>): TmcutAiScript {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('AI returned invalid JSON')
  }
  const parsed = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const scenesRaw = Array.isArray(parsed.scenes) ? parsed.scenes : []
  if (scenesRaw.length === 0) throw new Error('AI returned invalid script structure')

  const scenes: TmcutAiScriptScene[] = scenesRaw.slice(0, 40).map((s: Record<string, unknown>, idx: number) => {
    const scene = typeof s === 'object' && s !== null ? s : {}
    const duration = Math.min(PLAN_SCENE_MAX_SEC, Math.max(1, Number(scene.durationSec) || 5))
    return {
      id: String(scene.id || `scene-${idx + 1}`),
      order: Number(scene.order) || idx + 1,
      title: String(scene.title || `Cảnh ${idx + 1}`),
      durationSec: duration,
      visualPrompt: String(scene.visualPrompt || ''),
      voiceover: String(scene.voiceover || ''),
      onScreenText: String(scene.onScreenText || scene.title || '')
    }
  })

  return {
    title: String(parsed.title || ctx.prompt || 'Kịch bản Video AI'),
    synopsis: String(parsed.synopsis || ''),
    platform: ctx.platform,
    targetDurationSec: ctx.targetSec,
    scenes,
    createdAt: new Date().toISOString()
  }
}

// =============================================================================
//  TRIAGE — AutoCut content analysis (useTmcutAutocut)
// =============================================================================

export interface AiTriageSpan {
  start: number
  end: number
  text?: string
}

/** One validated triage opinion: where + how much the AI wants to keep it. */
export interface AiTriageItem {
  start: number
  end: number
  interest: number
}

/**
 * Keep the prompt within a sane token budget: keep head + tail of the
 * transcript, mark the middle cut. Honest — the model is told exactly what
 * it is not seeing, so it cannot pretend to rate missing content.
 */
const TRIAGE_CHARS_HEAD = 18000
const TRIAGE_CHARS_TAIL = 12000

export function buildTriageSpans(transcript: AiTriageSpan[]): AiTriageSpan[] {
  const spans = transcript.filter(s => s && s.end > s.start)
  let total = 0
  for (const span of spans) total += (span.text || '').length
  if (total <= TRIAGE_CHARS_HEAD + TRIAGE_CHARS_TAIL) return spans
  const head: AiTriageSpan[] = []
  const tail: AiTriageSpan[] = []
  let used = 0
  for (const span of spans) {
    head.push(span)
    used += (span.text || '').length
    if (used >= TRIAGE_CHARS_HEAD) break
  }
  used = 0
  for (let i = spans.length - 1; i >= 0; i -= 1) {
    const span = spans[i]!
    tail.unshift(span)
    used += (span.text || '').length
    if (used >= TRIAGE_CHARS_TAIL) break
  }
  return head.length >= tail.length ? head : tail
}

export function triageSystemPrompt(): string {
  return `You are a video editor judging CUT WORTHINESS of a transcript for an auto-cut.
You will receive numbered transcript spans: [i] start-end "text".
Rate each span from 0.0 (worthless: filler, repetition, off-topic, dead air)
to 1.0 (must-keep: key point, story peak, strong hook).
Judge ONLY by content value — not length. Be conservative: most spans are 0.3-0.6.
Respond with a single JSON object, nothing else:
{"items":[{"i":0,"interest":0.8},...]}
Include every provided span index exactly once.`
}

export function triageUserMessage(spans: AiTriageSpan[], truncated: boolean): string {
  const lines = spans.map((span, i) => `[${i}] ${span.start.toFixed(1)}-${span.end.toFixed(1)} "${(span.text || '').trim()}"`).join('\n')
  const note = truncated ? '\n(Only part of the transcript is provided — rate only the spans above.)' : ''
  return `Transcript spans to rate:\n${lines}${note}`
}

/**
 * Validate a triage answer. Accepts BOTH `{"items":[...]}` and a bare array.
 * Each item: `{i, interest}` (index form) or `{start, end, interest}`.
 * Interest is clamped 0..1; out-of-range indices/spans are dropped; malformed
 * entries are skipped. Returns [] when nothing usable comes back.
 */
export function parseTriageItems(
  content: string,
  spans: AiTriageSpan[],
  durationSec: number
): AiTriageItem[] {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return []
  }
  let list: unknown[] = []
  if (Array.isArray(raw)) {
    list = raw
  } else if (typeof raw === 'object' && raw !== null && Array.isArray((raw as { items?: unknown }).items)) {
    list = (raw as { items: unknown[] }).items
  }
  if (list.length === 0) return []

  const limit = durationSec > 0 ? durationSec : Infinity
  const out: AiTriageItem[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const item = entry as Record<string, unknown>
    const interest = Number(item.interest)
    if (!Number.isFinite(interest)) continue
    const value = Math.min(1, Math.max(0, Math.round(interest * 1000) / 1000))

    const idx = Number(item.i)
    let start: number
    let end: number
    if (Number.isInteger(idx) && idx >= 0 && idx < spans.length) {
      const span = spans[idx]!
      start = span.start
      end = span.end
    } else if (Number.isFinite(Number(item.start)) && Number.isFinite(Number(item.end))) {
      start = Number(item.start)
      end = Number(item.end)
    } else {
      continue
    }
    if (end <= start) continue
    if (start >= limit || end <= 0) continue
    out.push({
      start: Math.max(0, start),
      end: Math.min(limit, end),
      interest: value
    })
  }
  // De-duplicate overlapping entries (model may double-report an index).
  out.sort((a, b) => a.start - b.start)
  const deduped: AiTriageItem[] = []
  for (const item of out) {
    const last = deduped[deduped.length - 1]
    if (last && item.start < last.end) {
      last.interest = Math.max(last.interest, item.interest)
      last.end = Math.max(last.end, item.end)
    } else {
      deduped.push({ ...item })
    }
  }
  return deduped
}
