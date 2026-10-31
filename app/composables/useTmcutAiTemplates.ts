import { ref, computed } from 'vue'
import type { AiChatMessage } from '#shared/types/electron'
import {
  TICKS_PER_SECOND,
  parseTemplatePlanReply,
  buildTemplateFromPlan,
  summarizeTemplatePlan,
  validateTemplate
} from '@tmcut-core'
import type { AiTemplatePlan, TmcutTemplate } from '@tmcut-core'
import { useTmcutAi } from './useTmcutAi'
import { useTmcutMedia } from './useTmcutMedia'

// =============================================================================
//  AI Template generation (roadmap v3 §6.5).
//
//  Same trust model as the AI Editor, aimed at templates: the model returns
//  a Template Plan (add-clip only — no canvas verb, no destructive verbs),
//  the core validates it, and the builder turns it into a REAL template
//  object through core commands (createTemplateFromTimeline). The result
//  flows through the ordinary template pipeline (validateTemplate,
//  requiredAssets, instantiateTemplate) — an AI template is indistinguish
//  from a manual one except for its `generatedBy` provenance label.
// =============================================================================

const MAX_OFFERED_MEDIA = 60

const SYSTEM_PROMPT = `You are the TMCut template designer. You design NEW video templates by returning a JSON "Template Plan". The app builds it into a real, reusable template. Reply with ONE JSON object and nothing else.

Plan shape:
{"schemaVersion":1,"intentSummary":"<what this template is for>","template":{"name":"...","description":"...","category":"intro|promo|outro|split-screen|minimal|custom","aspectRatio":"16:9|9:16|1:1","width":<px>,"height":<px>,"fps":<num>},"operations":[<ops>]}

Operations — ONLY this verb exists (a template is a blank to be filled later):
- {"type":"add-clip","trackType":"video"|"audio"|"text","name":"...","offset":<ticks>,"out":<ticks>,"in":<ticks>, ...}
  text clips: add "text":"..." (and optionally "color":"#rrggbb", "fontSize":<px>)
  video/audio clips: MAY add "mediaRef":"<ref from the offered media list>" to embed one clip. Omit it to leave a PLACEHOLDER slot the end user fills with their own media.

Hard rules (violations fail validation and you will be asked to repair):
1. TICKS_PER_SECOND = ${TICKS_PER_SECOND}. All times are ticks (seconds x ${TICKS_PER_SECOND}).
2. mediaRef MUST come from the offered media list — never a path, URL or filename. Prefer leaving mediaRef OFF so the template stays reusable.
3. A good short-form template: 1-3 video/audio slots + 1-3 text slots, a clear hook in the first second, total 10-30 seconds.
4. No destructive ops, no canvas op (canvas lives on template.*), no clip ids, no transitions or effects unless the registry clearly allows them.
5. Prefer placeholders over embedded media: the point of a template is that ANY user can apply it.
6. JSON only, no markdown fences, no commentary.`

export interface AiTemplateDraft {
  plan: AiTemplatePlan
  lines: string[]
  warnings: string[]
  /** The core-built, core-validated template this plan produces. */
  template: TmcutTemplate
}

export function useTmcutAiTemplates() {
  const ai = useTmcutAi()
  const media = useTmcutMedia()

  const generating = ref(false)
  const draft = ref<AiTemplateDraft | null>(null)
  const validationErrors = ref<string[]>([])
  const lastError = ref<string | null>(null)

  const isDesktop = ai.isDesktop

  function offeredMedia(): { ref: string, src: string, name: string }[] {
    const offers: { ref: string, src: string, name: string }[] = []
    for (const asset of media.assets.value) {
      if (offers.length >= MAX_OFFERED_MEDIA) break
      if (!/^[\w.-]+$/.test(asset.id)) continue
      if (asset.status === 'missing' || asset.status === 'error') continue
      offers.push({ ref: asset.id, src: asset.path, name: asset.name })
    }
    return offers
  }

  const offeredMediaIds = computed(() => offeredMedia().map(o => o.ref))

  /** Turn a parsed plan into a draft (validated template + diff lines). */
  function buildDraft(plan: AiTemplatePlan): AiTemplateDraft | null {
    const offers = offeredMedia()
    const { template, warnings } = buildTemplateFromPlan(plan, {
      mediaResolution: Object.fromEntries(offers.map(o => [o.ref, { src: o.src, name: o.name }])),
      provider: null,
      model: null
    })
    const check = validateTemplate(template)
    if (!check.valid) {
      validationErrors.value = check.errors
      return null
    }
    return { plan, lines: summarizeTemplatePlan(plan), warnings, template }
  }

  /** Ask the model for a template; one bounded repair round on errors. */
  async function generateTemplate(brief: string) {
    draft.value = null
    validationErrors.value = []
    lastError.value = null
    generating.value = true
    try {
      const offers = offeredMedia()
      const messages: AiChatMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${brief}\n\nOFFERED MEDIA (refs you MAY embed — prefer not to):\n${JSON.stringify(offers.map(({ ref, name }) => ({ ref, name })))}` }
      ]
      const res = await ai.complete({ task: 'plan', jsonMode: true, messages, maxTokens: 2048, temperature: 0.4 })
      let parsed = parseTemplatePlanReply(res.content, { mediaRefs: offeredMediaIds.value })
      if (!parsed.ok && parsed.errors) {
        const repairMessages: AiChatMessage[] = [
          ...messages,
          { role: 'assistant', content: res.content.slice(0, 4000) },
          { role: 'user', content: `Your template plan failed validation:\n${parsed.errors.map(e => `- ${e}`).join('\n')}\nFix ONLY these errors and reply with the corrected JSON plan, nothing else.` }
        ]
        const retry = await ai.complete({ task: 'plan', jsonMode: true, messages: repairMessages, maxTokens: 2048, temperature: 0 })
        parsed = parseTemplatePlanReply(retry.content, { mediaRefs: offeredMediaIds.value })
      }
      if (parsed.ok && parsed.plan) {
        draft.value = buildDraft(parsed.plan)
      } else {
        validationErrors.value = parsed.errors || ['unparseable reply']
      }
    } catch (err) {
      lastError.value = (err as Error)?.message || 'ai-request-failed'
    } finally {
      generating.value = false
    }
  }

  function clearDraft() {
    draft.value = null
    validationErrors.value = []
    lastError.value = null
  }

  return {
    isDesktop,
    generating,
    draft,
    validationErrors,
    lastError,
    generateTemplate,
    clearDraft
  }
}
