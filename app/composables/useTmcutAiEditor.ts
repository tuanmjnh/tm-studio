import { ref, computed } from 'vue'
import type { AiChatMessage } from '#shared/types/electron'
import { useTmcutProject } from './useTmcutProject'
import { useTmcutMedia } from './useTmcutMedia'
import { useTmcutAi } from './useTmcutAi'
import {
  TICKS_PER_SECOND,
  secToTicks,
  ticksTracksToV3,
  syncTicksResult,
  validateEditPlan,
  applyEditPlan,
  parseEditPlanReply,
  summarizeEditPlan
} from '@tmcut-core'
import type { AiEditPlan, AiEditPlanTrace } from '@tmcut-core'

// =============================================================================
//  AI Editor orchestration (roadmap v3 PART C / §13).
//
//  The renderer NEVER mutates the project from model output directly:
//  the model must return an Edit Plan (core `validateEditPlan` schema), the
//  plan is dry-run validated against the CURRENT timeline (clip ids must
//  exist, media refs must be offered), and applying runs the core
//  `applyEditPlan` on the v3 view of the store — the same commands the
//  manual editor uses — wrapped in ONE history entry (one Ctrl+Z reverts
//  the whole plan). One bounded repair round lets the model fix its own
//  validation errors; after that the user sees the errors verbatim.
// =============================================================================

/** Media the host is willing to resolve for a plan: opaque ref -> path. */
export interface AiEditorMediaOffer {
  ref: string
  src: string
  name: string
  kind: string
  durationTicks: number
}

const MAX_OFFERED_MEDIA = 60
const MAX_CONTEXT_CLIPS = 40

const SYSTEM_PROMPT = `You are the TMCut video editor's planning engine. You NEVER edit anything yourself: you return a JSON "Edit Plan" that the app validates and applies. Reply with ONE JSON object and nothing else.

Plan shape:
{"schemaVersion":1,"intentSummary":"<short goal restatement>","assumptions":["<anything you assumed>"],"operations":[<ops>]}

Operations (closed vocabulary — any other type is rejected):
- {"type":"set-canvas","width":1080,"height":1920,"fps":30}
- {"type":"add-clip","trackType":"video"|"audio","mediaRef":"<ref from the offered media list>","name":"...","in":<ticks>,"out":<ticks>,"offset":<ticks>}
- {"type":"add-clip","trackType":"text","name":"...","text":"...","offset":<ticks>,"out":<ticks>,"fontSize":<px>,"color":"#rrggbb"}
- {"type":"set-clip","clipId":"<existing id>","text":"...","name":"...","color":"#rrggbb","fontSize":<px>}
- {"type":"move-clip","clipId":"<existing id>","startTicks":<ticks>}
- {"type":"remove-clip","clipId":"<existing id>"}
- {"type":"set-effect","clipId":"<existing id>","effects":[{"type":"<registry effect type>","params":{}}]}
- {"type":"set-transition","clipId":"<existing id>","transition":"fade"|"wipe"|"slide"|"zoom","durationTicks":<ticks>}
- {"type":"set-speed","clipId":"<existing id>","speed":<0.01..100>}
- {"type":"set-volume","clipId":"<existing id>","volume":<0..400>}

Hard rules (violations fail validation and you will be asked to repair):
1. All times are TICKETS: TICKS_PER_SECOND = ${TICKS_PER_SECOND}. Convert seconds x ${TICKS_PER_SECOND}.
2. mediaRef values MUST come from the offered media list. You may NOT use file paths, URLs or filenames.
3. clipId values MUST come from the project context clip list.
4. Maximum 100 operations. Prefer few, reversible, clearly-described edits.
5. No commentary, no markdown fences around the final JSON — JSON only.`

export function useTmcutAiEditor() {
  const project = useTmcutProject()
  const media = useTmcutMedia()
  const ai = useTmcutAi()

  const generating = ref(false)
  const applying = ref(false)
  const plan = ref<AiEditPlan | null>(null)
  const validationErrors = ref<string[]>([])
  const lastError = ref<string | null>(null)
  const lastTrace = ref<(AiEditPlanTrace & { canvasApplied: boolean }) | null>(null)

  const isDesktop = ai.isDesktop

  /** Current v3 view of the timeline (plan validation/apply target). */
  function currentV3(): ReturnType<typeof ticksTracksToV3> | null {
    const tracks = project.currentProject.value?.timeline?.tracks
    return tracks ? ticksTracksToV3(tracks) : null
  }

  /** Opaque media refs the host will resolve at apply time (library only). */
  function offeredMedia(): AiEditorMediaOffer[] {
    const offers: AiEditorMediaOffer[] = []
    for (const asset of media.assets.value) {
      if (offers.length >= MAX_OFFERED_MEDIA) break
      // Core mediaRef charset — generated ids qualify; skip anything odd.
      if (!/^[\w.-]+$/.test(asset.id)) continue
      if (asset.status === 'missing' || asset.status === 'error') continue
      const kind = asset.kind === 'audio' ? 'audio' : 'video'
      offers.push({
        ref: asset.id,
        src: asset.path,
        name: asset.name,
        kind,
        durationTicks: Math.round(secToTicks(asset.meta?.durationSec || 0))
      })
    }
    return offers
  }

  /** Bounded, path-free project summary embedded in the prompt. */
  function projectContext(v3: ReturnType<typeof ticksTracksToV3>) {
    const canvas = project.currentProject.value?.canvas
    let clips = 0
    const tracks = v3.tracks.map(track => ({
      id: track.id,
      type: track.type,
      name: track.name ?? track.type,
      locked: !!track.locked,
      items: (track.items ?? []).filter(() => clips++ < MAX_CONTEXT_CLIPS).map(item => ({
        id: item.id,
        name: item.name ?? item.id,
        startTicks: item.timeline?.start ?? 0,
        durationTicks: item.timeline?.duration ?? 0,
        ...(item.type === 'text' ? { text: String(item.text ?? '').slice(0, 80) } : {})
      }))
    }))
    let end = 0
    for (const track of v3.tracks) {
      for (const item of track.items ?? []) {
        end = Math.max(end, (item.timeline?.start ?? 0) + (item.timeline?.duration ?? 0))
      }
    }
    return {
      canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0, fps: canvas?.fps?.numerator ?? 30 },
      durationTicks: end,
      tracks
    }
  }

  function labels(): Record<string, string> {
    const map: Record<string, string> = {}
    for (const track of project.currentProject.value?.timeline?.tracks || []) {
      for (const item of track.items || []) map[item.id] = item.name || item.id
    }
    return map
  }

  /** Ask the model for a plan; one bounded repair round on validation errors. */
  async function generatePlan(userPrompt: string) {
    plan.value = null
    validationErrors.value = []
    lastError.value = null
    lastTrace.value = null
    const v3 = currentV3()
    if (!v3) {
      lastError.value = 'no-project'
      return
    }
    generating.value = true
    try {
      const offers = offeredMedia()
      const context = {
        project: projectContext(v3),
        offeredMedia: offers.map(({ ref, name, kind, durationTicks }) => ({ ref, name, kind, durationTicks }))
      }
      const messages: AiChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${userPrompt}\n\nPROJECT CONTEXT (JSON):\n${JSON.stringify(context)}` }
      ]
      const res = await ai.complete({ task: 'plan', jsonMode: true, messages, maxTokens: 2048, temperature: 0.2 })
      let parsed = parseEditPlanReply(res.content, { timeline: v3, mediaRefs: offers.map(o => o.ref) })
      if (!parsed.ok && parsed.errors) {
        // BOUNDED-REPAIR: one retry, errors fed back verbatim.
        const repairMessages: AiChatMessage[] = [
          ...messages,
          { role: 'assistant', content: res.content.slice(0, 4000) },
          { role: 'user', content: `Your plan failed validation:\n${parsed.errors.map(e => `- ${e}`).join('\n')}\nFix ONLY these errors and reply with the corrected JSON plan, nothing else.` }
        ]
        const retry = await ai.complete({ task: 'plan', jsonMode: true, messages: repairMessages, maxTokens: 2048, temperature: 0 })
        parsed = parseEditPlanReply(retry.content, { timeline: v3, mediaRefs: offers.map(o => o.ref) })
      }
      if (parsed.ok && parsed.plan) {
        plan.value = parsed.plan
      } else {
        validationErrors.value = parsed.errors || ['unparseable reply']
      }
    } catch (err) {
      lastError.value = (err as Error)?.message || 'ai-request-failed'
    } finally {
      generating.value = false
    }
  }

  /** Human-readable diff lines for the review UI (no paths, no secrets). */
  const planLines = computed(() => (plan.value ? summarizeEditPlan(plan.value, labels()) : []))

  /** Ops whose mediaRef the host cannot resolve right now (would skip). */
  const unresolvedMediaRefs = computed(() => {
    if (!plan.value) return []
    const offered = new Set(offeredMedia().map(o => o.ref))
    const missing = new Set<string>()
    for (const op of plan.value.operations) {
      if ((op.type === 'add-clip') && typeof op.mediaRef === 'string' && !offered.has(op.mediaRef)) {
        missing.add(op.mediaRef)
      }
    }
    return Array.from(missing)
  })

  /** Re-validate against the CURRENT timeline right before applying. */
  function revalidate(): boolean {
    const v3 = currentV3()
    if (!plan.value || !v3) return false
    const check = validateEditPlan(plan.value, {
      timeline: v3,
      mediaRefs: offeredMedia().map(o => o.ref)
    })
    validationErrors.value = check.errors
    return check.valid
  }

  /**
   * Apply the reviewed plan: ONE history entry, canvas ops through the
   * store's switchCanvas (keeps the reframe logic), timeline ops through
   * core applyEditPlan on the v3 view, then the standard sync + save.
   */
  function applyPlan(): { ok: boolean, applied: number, skipped: number } {
    const current = project.currentProject.value
    const tracks = current?.timeline?.tracks
    if (!plan.value || !tracks || !revalidate()) return { ok: false, applied: 0, skipped: 0 }
    applying.value = true
    try {
      project.pushHistory()
      const canvasOps = plan.value.operations.filter(op => op.type === 'set-canvas')
      const timelineOps = plan.value.operations.filter(op => op.type !== 'set-canvas')
      for (const op of canvasOps) {
        project.switchCanvas(Number(op.width), Number(op.height))
      }
      const v3 = ticksTracksToV3(tracks)
      const resolution: Record<string, { src: string, name?: string }> = {}
      for (const offer of offeredMedia()) resolution[offer.ref] = { src: offer.src, name: offer.name }
      const trace = applyEditPlan(v3, { operations: timelineOps }, { mediaResolution: resolution })
      syncTicksResult(tracks, v3)
      project.saveProject()
      lastTrace.value = { ...trace, canvasApplied: canvasOps.length > 0 }
      plan.value = null
      return { ok: true, applied: trace.applied.length + canvasOps.length, skipped: trace.skipped.length }
    } finally {
      applying.value = false
    }
  }

  function clearPlan() {
    plan.value = null
    validationErrors.value = []
    lastError.value = null
    lastTrace.value = null
  }

  return {
    isDesktop,
    generating,
    applying,
    plan,
    planLines,
    unresolvedMediaRefs,
    validationErrors,
    lastError,
    lastTrace,
    generatePlan,
    applyPlan,
    clearPlan
  }
}
