// =============================================================================
//  TMCut Voice Commands — Roadmap v1 §4, P2
//  Speech-to-Text (Whisper) → Intent/LLM Planner → Validated Tool Call
//  → TMCut Core Command → Result/Audit → User Feedback
//
//  Two input modes:
//   - Text command: typed into AI Editor or Voice panel
//   - Voice command: STT converts speech → text → same Intent/Planner
//
//  Risk classification (from docs §4):
//   - Low-risk: read info, find asset, move playhead, preview
//   - Reversible editing: add caption, add clip, change volume, split/trim
//     (proposal/draft + preview + one undo group)
//   - Cost/destructive/external: batch generation, delete project, publish
//     (explicit confirmation required)
//
//  Credentials & STT model live in main process (electron/tools/ai-gateway.cjs).
//  Renderer only calls `transcribe(filePath)` and `agent.callTool()`.
// =============================================================================

import { ref, computed } from 'vue'
import { useTmcutAi } from './useTmcutAi'
import { useTmcutAgentTools } from './useTmcutAgentTools'

export type VoiceRisk = 'read' | 'reversible' | 'destructive' | 'cost'

export interface VoiceIntent {
  tool: string
  args: Record<string, unknown>
  risk: VoiceRisk
  requiresConfirmation: boolean
  description: string
}

export interface VoiceResult {
  ok: boolean
  intent?: VoiceIntent
  transcript?: string
  result?: unknown
  error?: { code: string, message: string, retryable: boolean }
  needsConfirmation?: boolean
  confirmationMessage?: string
  /** Reversible intent was drafted into the review panel, not applied. */
  staged?: boolean
  /** Operations waiting in the pending proposal after this call. */
  queued?: number
  /**
   * Why the command could not be staged. `proposal-pending`: another draft
   * is awaiting review, so the UI must ask the user to apply/discard it.
   */
  blocked?: 'proposal-pending'
}

export interface VoiceCommandOptions {
  language?: 'vi' | 'en'
  autoExecute?: boolean // false = require confirmation for reversible
  confirmCostThresholdUsd?: number
}

const DEFAULT_CONFIRM_COST_THRESHOLD = 10 // USD

// Intent keywords mapping (vi + en) — closed vocabulary for agent tools
const INTENT_PATTERNS: Array<{
  tool: string
  vi: string[]
  en: string[]
  extractArgs: (text: string, lang: 'vi' | 'en') => Record<string, unknown> | null
}> = [
  // Context read (no confirmation)
  { tool: 'project.get_context', vi: ['thông tin dự án', 'dự án hiện tại'], en: ['project info', 'current project'], extractArgs: () => ({}) },
  { tool: 'project.get_timeline', vi: ['timeline', 'dòng thời gian', 'track'], en: ['timeline', 'tracks'], extractArgs: () => ({}) },
  { tool: 'project.list_assets', vi: ['thư viện', 'asset', 'media', 'tìm asset'], en: ['library', 'assets', 'media', 'find asset'], extractArgs: t => ({ query: extractSearchQueryOrEmpty(t, ['tìm', 'search', 'tìm kiếm']) }) },

  // Playback
  { tool: 'playback.seek', vi: ['tua', 'đi tới', 'nhảy tới'], en: ['seek', 'go to', 'jump to'], extractArgs: t => ({ timeSec: extractTimeSec(t) }) },
  { tool: 'playback.play', vi: ['phát', 'bắt đầu'], en: ['play', 'start'], extractArgs: () => ({}) },
  { tool: 'playback.pause', vi: ['tạm dừng', 'dừng'], en: ['pause', 'stop'], extractArgs: () => ({}) },

  // Clip edits (reversible)
  { tool: 'timeline.add_clip', vi: ['thêm clip', 'thêm video', 'thêm audio', 'thêm text', 'thêm tiêu đề'], en: ['add clip', 'add video', 'add audio', 'add text', 'add caption'], extractArgs: t => extractAddClipArgs(t) },
  { tool: 'timeline.move_clip', vi: ['di chuyển clip', 'kéo clip', 'chuyển clip'], en: ['move clip', 'drag clip'], extractArgs: t => extractMoveClipArgs(t) },
  { tool: 'timeline.trim_clip', vi: ['cắt clip', 'cắt ngắn', 'trim'], en: ['trim clip', 'cut clip', 'shorten'], extractArgs: t => extractTrimClipArgs(t) },
  { tool: 'timeline.remove_clip', vi: ['xóa clip', 'xoá clip'], en: ['remove clip', 'delete clip'], extractArgs: t => extractRemoveClipArgs(t) },
  { tool: 'timeline.split_clip', vi: ['chia clip', 'tách clip', 'split'], en: ['split clip', 'divide clip'], extractArgs: t => extractSplitClipArgs(t) },
  { tool: 'timeline.set_volume', vi: ['âm lượng', 'volume'], en: ['volume'], extractArgs: t => extractVolumeArgs(t) },
  { tool: 'timeline.add_caption', vi: ['thêm phụ đề', 'thêm caption', 'thêm text', 'thêm tiêu đề'], en: ['add caption', 'add subtitle', 'add text'], extractArgs: t => extractCaptionArgs(t) },
  { tool: 'timeline.set_transition', vi: ['thêm transition', 'thêm hiệu ứng chuyển'], en: ['add transition', 'add effect transition'], extractArgs: t => extractTransitionArgs(t) },
  { tool: 'timeline.set_effect', vi: ['thêm effect', 'thêm hiệu ứng'], en: ['add effect'], extractArgs: t => extractEffectArgs(t) }
]

function extractSearchQuery(text: string, triggers: string[]): string {
  for (const trigger of triggers) {
    const idx = text.indexOf(trigger)
    if (idx >= 0) return text.slice(idx + trigger.length).trim()
  }
  return ''
}

function extractSearchQueryOrEmpty(text: string, triggers: string[]): string {
  const r = extractSearchQuery(text, triggers)
  return r ?? ''
}

function extractTimeSec(text: string): number {
  // Match: 10s, 1:30, 1m30s, 90 seconds, 2 phút 30 giây
  const patterns: RegExp[] = [
    /(\d+):(\d+)/, // 1:30
    /(\d+)\s*(?:s|giây|seconds?)/i, // 90s, 90 giây
    /(\d+)\s*(?:m|phút|minutes?)\s*(\d+)?\s*(?:s|giây|seconds?)?/i // 1m30s, 2 phút 30
  ]
  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      if (p.source.includes(':')) return parseInt(m[1]!) * 60 + parseInt(m[2]!)
      if (p.source.includes('m|phút')) {
        const min = parseInt(m[1]!)
        const sec = m[2] ? parseInt(m[2]!) : 0
        return min * 60 + sec
      }
      return parseInt(m[1]!)
    }
  }
  return 0
}

function extractAddClipArgs(text: string): Record<string, unknown> | null {
  const isText = /text|tiêu đề|caption|chữ/i.test(text)
  const isAudio = /audio|âm thanh|âm nhạc|music/i.test(text)
  return {
    trackType: isText ? 'text' : (isAudio ? 'audio' : 'video'),
    text: isText ? extractSearchQueryOrEmpty(text, ['với nội dung', 'nội dung', 'nói', 'saying', 'with text']) : undefined,
    offsetSec: 0 // defaults to playhead in agent
  }
}

function extractMoveClipArgs(text: string): Record<string, unknown> | null {
  const time = extractTimeSec(text)
  return time > 0 ? { clipId: 'selected', startSec: time } : null
}

function extractTrimClipArgs(text: string): Record<string, unknown> | null {
  return { clipId: 'selected', edge: 'out', atSec: extractTimeSec(text) || 0 }
}

function extractRemoveClipArgs(_text: string): Record<string, unknown> | null {
  return { clipId: 'selected' }
}

function extractSplitClipArgs(text: string): Record<string, unknown> | null {
  return { clipId: 'selected', atSec: extractTimeSec(text) || 0 }
}

function extractVolumeArgs(text: string): Record<string, unknown> | null {
  const m = text.match(/(\d+)\s*%?/)
  if (m) return { trackId: 'selected', volume: parseInt(m[1]!) }
  return null
}

function extractCaptionArgs(text: string): Record<string, unknown> | null {
  const query = extractSearchQueryOrEmpty(text, ['nội dung', 'chữ', 'nói', 'content', 'saying'])
  if (query) return { text: query, atSec: 0, durationSec: 3 }
  return null
}

function extractTransitionArgs(text: string): Record<string, unknown> | null {
  // Detect transition type from keywords
  const types = ['fade', 'dissolve', 'wipe', 'slide', 'zoom', 'circle']
  for (const t of types) if (text.includes(t)) return { clipId: 'selected', type: t, durationSec: 0.5 }
  return { clipId: 'selected', type: 'fade', durationSec: 0.5 }
}

function extractEffectArgs(_text: string): Record<string, unknown> | null {
  // Placeholder mapping: the planner can refine this via the LLM fallback.
  return { clipId: 'selected', effects: [{ type: 'blur', params: { radius: 10 } }] }
}

function classifyRisk(tool: string): VoiceRisk {
  if (tool.startsWith('project.') || tool.startsWith('playback.')) return 'read'
  // Roadmap §4: removing a clip is a reversible timeline edit (one undo step),
  // unlike deleting a project/file or spending credits.
  return 'reversible'
}

export function useTmcutVoiceCommands() {
  const agent = useTmcutAgentTools()
  const ai = useTmcutAi()
  const { callTool, listTools } = agent

  const isProcessing = ref(false)
  const lastTranscript = ref('')
  const lastResult = ref<VoiceResult | null>(null)

  // --- STT ---
  async function transcribeAudio(filePath: string, language: 'vi' | 'en' = 'vi'): Promise<string> {
    const res = await ai.transcribe(filePath, { format: 'verbose_json', language })
    return res.text || ''
  }

  // --- Intent Parsing (keyword + LLM fallback) ---
  async function parseIntent(text: string, lang: 'vi' | 'en' = 'vi'): Promise<VoiceIntent | null> {
    const t = text.trim().toLowerCase()
    if (!t) return null

    // 1. Keyword match (fast, deterministic)
    for (const pattern of INTENT_PATTERNS) {
      const triggers = lang === 'vi' ? pattern.vi : pattern.en
      for (const trigger of triggers) {
        if (t.includes(trigger.toLowerCase())) {
          const args = pattern.extractArgs(t, lang)
          if (args !== null) {
            const risk = classifyRisk(pattern.tool)
            return {
              tool: pattern.tool,
              args,
              risk,
              requiresConfirmation: risk !== 'read',
              description: `${pattern.tool} (${lang === 'vi' ? trigger : pattern.en[0]})`
            }
          }
        }
      }
    }

    // 2. LLM fallback (structured, for ambiguous commands)
    // Uses the AI gateway's task-scoped PLAN endpoint with JSON mode
    return parseIntentLLM(text, lang)
  }

  async function parseIntentLLM(text: string, lang: 'vi' | 'en' = 'vi'): Promise<VoiceIntent | null> {
    const tools = listTools().map(t => ({ name: t.name, desc: t.description, params: t.parameters }))
    const prompt = `Parse voice command to tool call. Available tools: ${JSON.stringify(tools)}. Command: "${text}". Language: ${lang}. Return ONLY JSON: { "tool": "...", "args": {}, "risk": "read|reversible|destructive|cost", "requiresConfirmation": true/false, "description": "..." } or null if unclear.`
    try {
      const res = await ai.complete({ task: 'plan', jsonMode: true, messages: [{ role: 'user', content: prompt }], maxTokens: 512, temperature: 0 })
      const parsed = JSON.parse(res.content)
      if (parsed && parsed.tool) {
        return { tool: parsed.tool, args: parsed.args || {}, risk: parsed.risk || 'reversible', requiresConfirmation: parsed.requiresConfirmation ?? true, description: parsed.description || '' }
      }
    } catch {
      // Unparseable reply: fall through so the caller reports no-intent.
    }
    return null
  }

  // --- Execute ---
  async function executeIntent(intent: VoiceIntent, autoExecute: boolean = false, confirmCostThreshold: number = DEFAULT_CONFIRM_COST_THRESHOLD): Promise<VoiceResult> {
    void confirmCostThreshold
    // Low-risk: auto-execute
    if (intent.risk === 'read') {
      const result = await callTool(intent.tool, intent.args)
      return { ok: result.ok, intent, result: result.data, error: result.error }
    }

    // Reversible: DRAFT first (roadmap §4). The operation lands in the pending
    // proposal; the Agent panel previews it and the user applies it as one
    // undo group. Nothing touches the timeline before that confirmation.
    if (intent.risk === 'reversible') {
      if (!autoExecute) {
        // A draft already carrying operations belongs to the user — never
        // append to it silently (that is how one command silently becomes
        // part of another).
        if (agent.proposalCount.value > 0) {
          return {
            ok: true,
            intent,
            staged: false,
            needsConfirmation: true,
            blocked: 'proposal-pending',
            queued: agent.proposalCount.value,
            confirmationMessage: `A proposal is already awaiting review (${agent.proposalCount.value} operation(s)). Apply or discard it first.`
          }
        }
        const started = agent.createProposal(intent.description, 'voice')
        if (!started.ok) return { ok: false, intent, error: started.error }
        const result = await callTool(intent.tool, intent.args)
        if (!result.ok) return { ok: false, intent, error: result.error }
        return {
          ok: true,
          intent,
          staged: true,
          needsConfirmation: true,
          queued: agent.proposalCount.value,
          confirmationMessage: `Ready to review: "${intent.description}"`
        }
      }
      // Explicit confirmation flow (panel Apply button or confirmAndExecute).
      if (agent.proposalCount.value === 0) {
        const started = agent.createProposal(intent.description, 'voice')
        if (!started.ok) return { ok: false, intent, error: started.error }
        const queued = await callTool(intent.tool, intent.args)
        if (!queued.ok) {
          agent.discardProposal()
          return { ok: false, intent, error: queued.error }
        }
      }
      const apply = await agent.applyProposal()
      return { ok: apply.ok, intent, result: apply.data, error: apply.error }
    }

    // Destructive/Cost: always require explicit confirmation with details
    return { ok: true, intent, needsConfirmation: true, confirmationMessage: `⚠️ "${intent.description}" is ${intent.risk}. Proceed?` }
  }

  /** Apply whatever the user reviewed in the Agent panel. */
  async function confirmStaged(): Promise<VoiceResult> {
    const apply = await agent.applyProposal()
    return { ok: apply.ok, result: apply.data, error: apply.error }
  }

  /** Throw the reviewed draft away without touching the timeline. */
  function discardStaged(): VoiceResult {
    const res = agent.discardProposal()
    return { ok: res.ok, result: res.data, error: res.error }
  }

  // --- High-level: voice command end-to-end ---
  async function runVoiceCommand(filePath: string, options: VoiceCommandOptions = {}): Promise<VoiceResult> {
    const { language = 'vi', autoExecute = false, confirmCostThresholdUsd = DEFAULT_CONFIRM_COST_THRESHOLD } = options
    isProcessing.value = true
    try {
      const transcript = await transcribeAudio(filePath, language)
      lastTranscript.value = transcript

      let intent = await parseIntent(transcript, language)
      if (!intent) return {
        ok: false, transcript, error: { code: 'no-intent', message: `Could not understand: "${transcript}"`, retryable: true }
      }

      const result = await executeIntent(intent, autoExecute, confirmCostThresholdUsd)
      lastResult.value = result
      return result
    } catch (err) {
      return { ok: false, error: { code: 'voice-failed', message: (err as Error)?.message || 'Voice command failed', retryable: false } }
    } finally {
      isProcessing.value = false
    }
  }

  async function runTextCommand(text: string, options: VoiceCommandOptions = {}): Promise<VoiceResult> {
    const { language = 'vi', autoExecute = false, confirmCostThresholdUsd = DEFAULT_CONFIRM_COST_THRESHOLD } = options
    try {
      const intent = await parseIntent(text, language)
      if (!intent) return {
        ok: false, error: { code: 'no-intent', message: `Could not parse: "${text}"`, retryable: true }
      }
      return await executeIntent(intent, autoExecute, confirmCostThresholdUsd)
    } catch (err) {
      return { ok: false, error: { code: 'text-failed', message: (err as Error)?.message || 'Text command failed', retryable: false } }
    }
  }

  async function confirmAndExecute(intent: VoiceIntent): Promise<VoiceResult> {
    return executeIntent(intent, true)
  }

  return {
    isProcessing: computed(() => isProcessing.value),
    lastTranscript: computed(() => lastTranscript.value),
    lastResult: computed(() => lastResult.value),
    transcribeAudio,
    parseIntent,
    parseIntentLLM,
    executeIntent,
    runVoiceCommand,
    runTextCommand,
    confirmAndExecute,
    confirmStaged,
    discardStaged,
    // Expose the draft so a panel renders it without a second composable call.
    pendingProposal: agent.pendingProposal,
    proposalCount: agent.proposalCount,
    listTools,
    callTool
  }
}
