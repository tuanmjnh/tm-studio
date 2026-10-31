import type { TmcutAsset } from '~/types/tmcut'
import type { TmcutAnalysisResult } from '#shared/types/electron'
import type { TmcutEdl, TmcutEdlSegment } from '@tmcut-core'
import {
  parseSceneOutput,
  parseSilenceOutput,
  scoreSegments,
  validateEdl,
  editPlanFromEdl,
  validateEditPlan
} from '@tmcut-core'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutAi } from '~/composables/useTmcutAi'
import {
  buildTriageSpans,
  triageSystemPrompt,
  triageUserMessage,
  parseTriageItems,
  type AiTriageItem
} from '~/utils/tmcut/aiTasks'

export type AutocutProfile = 'viral-shorts' | 'podcast-summary' | 'cinematic-vlog'

export interface AutocutOptions {
  filterFillerWords?: boolean
  highlightKeywords?: string[]
  customFillerWords?: string[]
  /**
   * Opt-in AI content triage (docs §194): ask the `triage`-routed model to
   * rate the transcript and blend its opinions into the EDL scores.
   * Requires a configured AI connection; skipped silently (honest, no
   * fake data) when unavailable or the answer is unusable.
   */
  aiAnalysis?: boolean
  /**
   * Blend weight for the triage opinions (docs §199, R135): how far the
   * AI opinion pulls the local score. Core clamps 0..0.5 (AI is an
   * opinion, not truth); 0 means the triage pass runs but changes
   * nothing (analyzerVersion stays honest at transcript-v2).
   */
  aiWeight?: number
}

export interface AutocutAnalysis {
  edl: TmcutEdl
  sceneCount: number
  transcriptUsed: boolean
  /** total source duration, seconds (from FFmpeg scene probe) */
  sourceDurationSec: number
  /** number of silence ranges detected by FFmpeg silencedetect */
  silenceCount: number
  /** total seconds covered by the detected silences */
  silenceRemovedSec: number
  /** total seconds covered by the transcript (speech coverage) */
  speechSec: number
  /** raw transcript lines kept so the review UI can show real text */
  transcript: Array<{ start: number, end: number, text?: string }>
  /** count of segments detected containing filler words */
  fillerSegmentCount: number
  /** count of segments boosted with highlight keywords */
  highlightSegmentCount: number
  /** true when an AI triage pass actually blended opinions into the EDL */
  aiAnalysisUsed: boolean
  /** triage opinions the AI actually returned (validated) */
  aiItems: AiTriageItem[]
}

function tmcutIpc() {
  return typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
}

/**
 * The two detection passes (shots, silence) for one source, from the desktop
 * main process or — for a web asset, which already lives on the local server as
 * a `/uploads/` file — from POST /api/v1/media/analyze. Both run the same
 * ffmpeg filters and hand back the raw log, so @tmcut/core scores identically
 * on either runtime. Null when neither can read the file.
 */
function resolveAnalyzer(filePath: string): ((kind: 'scenes' | 'silence') => Promise<TmcutAnalysisResult>) | null {
  const ipc = tmcutIpc()
  if (ipc?.analyzeScenes && ipc.analyzeSilence) {
    return kind => (kind === 'scenes' ? ipc.analyzeScenes!({ filePath }) : ipc.analyzeSilence!({ filePath }))
  }
  if (filePath.startsWith('/uploads/')) {
    return kind => $fetch<TmcutAnalysisResult>('/api/v1/media/analyze', { method: 'POST', body: { kind, src: filePath } })
  }
  return null
}

/**
 * AutoCut pipeline driver (roadmap section 65.6): scene/silence detection
 * in main, optional Whisper transcript via the AI gateway, pure scoring
 * in @tmcut/core, draft project application without touching sources.
 */
export function useTmcutAutocut() {
  const { createProject, addClipToTrack, switchCanvas } = useTmcutProject()
  const { linkAssetToProject } = useTmcutMedia()
  const { transcribe, complete, status } = useTmcutAi()

  const analyzing = ref(false)
  const stageKey = ref('')
  const analysisError = ref<string | null>(null)

  async function analyzeSource(
    asset: TmcutAsset,
    profile: AutocutProfile,
    options?: AutocutOptions
  ): Promise<AutocutAnalysis | null> {
    const analyze = resolveAnalyzer(asset.path)
    if (!analyze) {
      analysisError.value = 'desktop-only'
      return null
    }
    analyzing.value = true
    analysisError.value = null
    try {
      stageKey.value = 'tmcut.steps.stageScenes'
      const scenes = await analyze('scenes')
      if (!scenes?.ok) throw new Error(scenes?.error || 'scene-detection-failed')

      stageKey.value = 'tmcut.steps.stageSilence'
      const silence = await analyze('silence')
      if (!silence?.ok) throw new Error(silence?.error || 'silence-detection-failed')

      const durationSec = scenes.durationSec || silence.durationSec || asset.meta.durationSec || 0
      const shotList = parseSceneOutput(scenes.log, durationSec)
      const silenceList = parseSilenceOutput(silence.log, durationSec)

      // Transcript is best-effort: EDL scoring degrades gracefully without it.
      let speech: Array<{ start: number, end: number }> = []
      let transcriptText: Array<{ start: number, end: number, text?: string }> = []
      let transcriptUsed = false
      stageKey.value = 'tmcut.steps.stageTranscript'
      try {
        const aiStatus = await status()
        if (aiStatus?.hasKey) {
          const transcript = await transcribe(asset.path, { format: 'verbose_json' })
          const rawSegments = transcript.segments ?? []
          speech = rawSegments.map(segment => ({ start: segment.start, end: segment.end }))
          // Keep the text so the review UI can show a real transcript line
          // per EDL segment (scoring only needs the timings).
          transcriptText = rawSegments.map(segment => ({ start: segment.start, end: segment.end, text: segment.text }))
          transcriptUsed = speech.length > 0
        }
      } catch {
        speech = []
        transcriptText = []
      }

      stageKey.value = 'tmcut.steps.stageScoring'
      // AI content triage (docs §194): a second, optional opinion pass on
      // the transcript. Opt-in, degrades silently — the local scoring is
      // always the baseline the AI only nudges (core caps the pull).
      let aiItems: AiTriageItem[] = []
      let aiAnalysisUsed = false
      // R135: a 0-weight slider means "triage must not move anything" —
      // running the (paid) triage call then would waste a provider
      // request for a no-op blend, so the pass is skipped entirely.
      const aiWeight = options?.aiWeight ?? 0.25
      if (options?.aiAnalysis && aiWeight > 0 && transcriptText.length > 0) {
        stageKey.value = 'tmcut.steps.stageAiAnalysis'
        try {
          const spans = buildTriageSpans(transcriptText)
          const aiResponse = await complete({
            task: 'triage',
            messages: [
              { role: 'system', content: triageSystemPrompt() },
              { role: 'user', content: triageUserMessage(spans, spans.length < transcriptText.length) }
            ],
            jsonMode: true,
            // Reasoning headroom: see useTmcutAiScript — GLM/Nemotron never
            // emit final content at tiny maxTokens and the triage step would
            // silently fall back to heuristic-only spans.
            maxTokens: 2048,
            temperature: 0.2
          })
          aiItems = parseTriageItems(aiResponse.content, spans, durationSec)
          aiAnalysisUsed = aiItems.length > 0
        } catch {
          // Triage is an enhancement — never fail the analysis over it.
          aiItems = []
        }
      }
      const edl = scoreSegments({
        scenes: shotList,
        silences: silenceList,
        speech,
        transcript: transcriptText,
        profile,
        assetId: asset.id,
        analyzerVersion: aiAnalysisUsed ? 'triage-v3' : 'transcript-v2',
        filterFillerWords: options?.filterFillerWords,
        keywords: options?.highlightKeywords,
        customFillerWords: options?.customFillerWords,
        aiScores: aiItems,
        aiWeight
      })
      const problems = validateEdl(edl)
      if (problems.length > 0) throw new Error(problems[0])
      const silenceRemovedSec = silenceList.reduce(
        (total, range) => total + Math.max(0, range.end - range.start),
        0
      )
      const speechSec = speech.reduce(
        (total, range) => total + Math.max(0, range.end - range.start),
        0
      )
      const fillerSegmentCount = edl.segments.filter(
        segment => segment.hasFillerWords || segment.reason === 'filler-word'
      ).length
      const highlightSegmentCount = edl.segments.filter(
        segment => segment.isHighlight || segment.reason === 'highlight'
      ).length
      return {
        edl,
        sceneCount: shotList.length,
        transcriptUsed,
        sourceDurationSec: durationSec,
        silenceCount: silenceList.length,
        silenceRemovedSec,
        speechSec,
        transcript: transcriptText,
        fillerSegmentCount,
        highlightSegmentCount,
        aiAnalysisUsed,
        aiItems
      }
    } catch (err: unknown) {
      analysisError.value = err instanceof Error ? err.message : String(err)
      return null
    } finally {
      analyzing.value = false
      stageKey.value = ''
    }
  }

  /**
   * Apply accepted EDL segments as a NEW draft project (source untouched,
   * docs section 41). Roadmap v3 Phase 7: the EDL is first converted to a
   * standard Edit Plan (core `editPlanFromEdl`), the plan passes the SAME
   * `validateEditPlan` gate the AI Editor uses, and only then do its ops
   * build the project through store commands. Optional auto-captions come
   * from the transcript the analysis already produced (lines inside dropped
   * spans never make it into the plan — see the core bridge tests).
   * Returns the draft project id, or null when nothing applies.
   */
  async function applyDraft(
    asset: TmcutAsset,
    edl: TmcutEdl,
    included: number[],
    projectName: string,
    options?: { captions?: boolean, transcript?: Array<{ start: number, end: number, text?: string }> }
  ): Promise<string | null> {
    if (validateEdl(edl).length > 0) return null
    const segments: TmcutEdlSegment[] = []
    for (const index of included) {
      const segment = edl.segments[index]
      if (segment) segments.push(segment)
    }
    if (segments.length === 0) return null
    // The media ref is host-internal: this call resolves it to the source
    // asset itself. The plan stays path-free like every other plan.
    const { plan } = editPlanFromEdl(edl, segments, {
      mediaRef: 'source-',
      name: asset.name,
      captions: options?.captions ? (options.transcript ?? []) : undefined
    })
    if (plan.operations.length === 0) return null
    const check = validateEditPlan(plan, { mediaRefs: ['source-'] })
    if (!check.valid) return null

    const proj = createProject(projectName)
    if (edl.profile === 'viral-shorts') {
      switchCanvas(1080, 1920)
    } else if (asset.meta.width > 0 && asset.meta.height > 0) {
      switchCanvas(asset.meta.width, asset.meta.height)
    }
    linkAssetToProject(asset.id, proj.id)
    // C16-R3: the store keeps TICKS natively — plan fields are core ticks
    // and pass straight through to the same commands the manual editor uses.
    for (const op of plan.operations) {
      if (op.type !== 'add-clip') continue
      if (op.trackType === 'text') {
        addClipToTrack('text', {
          name: String(op.name || 'Caption'),
          text: String(op.text || ''),
          in: 0,
          out: Math.round(Number(op.out) || 0),
          offset: Math.round(Number(op.offset) || 0),
          fontSize: Number(op.fontSize) || 32,
          color: String(op.color || '#ffffff')
        })
      } else {
        addClipToTrack('video', {
          name: asset.name,
          src: asset.path,
          in: Math.round(Number(op.in) || 0),
          out: Math.round(Number(op.out) || 0),
          offset: Math.round(Number(op.offset) || 0)
        })
      }
    }
    return proj.id
  }

  return {
    analyzing,
    stageKey,
    analysisError,
    analyzeSource,
    applyDraft
  }
}
