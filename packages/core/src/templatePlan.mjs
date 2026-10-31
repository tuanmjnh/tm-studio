// =============================================================================
//  @tmcut/core — AI Template Plan (roadmap v3 §6.5)
//
//  "The AI should generate a Template Plan, not arbitrary serialized project
//  JSON." This module defines the narrow plan vocabulary (canvas fields +
//  add-clip only), validates it strictly, and BUILDS a real template through
//  the same core commands as everything else: applyEditPlan (addClip) ->
//  v3ClipToTicks -> createTemplateFromTimeline. The output template then
//  flows through the existing pipeline (validateTemplate / requiredAssets /
//  instantiateTemplate), so AI templates are indistinguishable from manual
//  ones except for the `generatedBy` provenance label.
//
//  Media safety mirrors the Edit Plan: library refs only (no paths). A clip
//  without mediaRef becomes a placeholder clip — the template asks for the
//  media at apply time, which is the point of a template.
//
//  Zero-dependency, pure, no Electron/Vue/Node imports.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import { extractJsonObject } from './aiPlan.mjs'
import { addClip } from './timeline.mjs'
import { v3ClipToTicks } from './v1compat.mjs'
import { createTemplateFromTimeline } from './templates.mjs'

export const TEMPLATE_PLAN_SCHEMA_VERSION = 1

const MAX_PLAN_OPERATIONS = 100
const TEMPLATE_CATEGORIES = ['intro', 'promo', 'outro', 'split-screen', 'minimal', 'custom']
// Must stay inside the TmcutTemplate.aspectRatio union — a plan may not
// invent canvas ratios the template store/type does not model.
const ASPECT_RATIOS = ['16:9', '9:16', '1:1']

function isPlain(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validate a raw Template Plan (untrusted model reply).
 * Shape:
 * {
 *   schemaVersion: 1,
 *   IntentSummary?: string,
 *   template: { name, description?, category?, aspectRatio?, width?, height?, fps? },
 *   operations: [ add-clip only ]
 * }
 * `options.mediaRefs`: offered ids (same rule as the Edit Plan).
 */
export function validateTemplatePlan(plan, options = {}) {
  const errors = []
  if (!isPlain(plan)) return { valid: false, errors: ['plan must be an object'] }
  if (plan.schemaVersion !== undefined && plan.schemaVersion !== TEMPLATE_PLAN_SCHEMA_VERSION) {
    errors.push(`unsupported template plan schemaVersion ${plan.schemaVersion} (expected ${TEMPLATE_PLAN_SCHEMA_VERSION})`)
  }

  const tpl = plan.template
  if (!isPlain(tpl)) {
    errors.push('template must be an object')
  } else {
    if (typeof tpl.name !== 'string' || tpl.name.trim() === '' || tpl.name.length > 200) {
      errors.push('template.name is required (max 200 characters)')
    }
    if (tpl.description !== undefined && (typeof tpl.description !== 'string' || tpl.description.length > 1000)) {
      errors.push('template.description must be a string of at most 1000 characters')
    }
    if (tpl.category !== undefined && !TEMPLATE_CATEGORIES.includes(tpl.category)) {
      errors.push(`template.category must be one of ${TEMPLATE_CATEGORIES.join(', ')}`)
    }
    if (tpl.aspectRatio !== undefined && !ASPECT_RATIOS.includes(tpl.aspectRatio)) {
      errors.push(`template.aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`)
    }
    for (const [key, max] of [['width', 32768], ['height', 32768], ['fps', 240]]) {
      const value = tpl[key]
      if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max)) {
        errors.push(`template.${key} must be a positive number (max ${max})`)
      }
    }
    if (tpl.width && tpl.height && tpl.aspectRatio) {
      const parity = (tpl.width / tpl.height).toFixed(3)
      const [aw, ah] = tpl.aspectRatio.split(':').map(Number)
      if (Math.abs(Number(parity) - aw / ah) > 0.02) {
        errors.push(`template.aspectRatio ${tpl.aspectRatio} contradicts canvas ${tpl.width}x${tpl.height}`)
      }
    }
  }

  const ops = plan.operations
  if (!Array.isArray(ops) || ops.length === 0) {
    errors.push('operations must be a non-empty array')
    return { valid: false, errors }
  }
  if (ops.length > MAX_PLAN_OPERATIONS) {
    errors.push(`plan has ${ops.length} operations (max ${MAX_PLAN_OPERATIONS})`)
    return { valid: false, errors }
  }
  const offeredMedia = options.mediaRefs ? new Set(Array.from(options.mediaRefs)) : null
  ops.forEach((op, i) => {
    const where = `op[${i}]`
    if (!isPlain(op)) {
      errors.push(`${where} must be an object`)
      return
    }
    // Template plans build from scratch: ONLY add-clip is meaningful (no
    // clip ids can exist yet, no destructive verbs, no canvas op — canvas
    // lives on template.*).
    if (op.type !== 'add-clip') {
      errors.push(`${where}.type must be "add-clip" (template plans only add)`)
      return
    }
    if (!['video', 'audio', 'text'].includes(op.trackType)) {
      errors.push(`${where}.trackType must be one of video, audio, text`)
    }
    if (op.name !== undefined && (typeof op.name !== 'string' || op.name.length > 120)) {
      errors.push(`${where}.name must be a string of at most 120 characters`)
    }
    if (op.text !== undefined && (typeof op.text !== 'string' || op.text.length > 512)) {
      errors.push(`${where}.text must be a string of at most 512 characters`)
    }
    if (op.effects !== undefined && !Array.isArray(op.effects)) {
      errors.push(`${where}.effects must be an array`)
    }
    const colorOk = op.color === undefined || (typeof op.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(op.color))
    if (!colorOk) errors.push(`${where}.color must be a #rrggbb string`)
    if (op.fontSize !== undefined && (typeof op.fontSize !== 'number' || !Number.isFinite(op.fontSize) || op.fontSize <= 0 || op.fontSize > 1024)) {
      errors.push(`${where}.fontSize must be a number in (0, 1024]`)
    }
    for (const key of ['in', 'out', 'offset']) {
      if (op[key] !== undefined && (typeof op[key] !== 'number' || !Number.isFinite(op[key]) || op[key] < 0)) {
        errors.push(`${where}.${key} must be a non-negative finite number (ticks)`)
      }
    }
    if (op.mediaRef !== undefined) {
      if (typeof op.mediaRef !== 'string' || !/^[\w.-]+$/.test(op.mediaRef)) {
        errors.push(`${where}.mediaRef may only contain letters, digits, ".", "_" and "-"`)
      } else if (offeredMedia && !offeredMedia.has(op.mediaRef)) {
        errors.push(`${where}.mediaRef "${op.mediaRef}" is not among the offered media refs`)
      }
    }
    // No mediaRef is legal: the clip becomes a placeholder the applying
    // user fills in. This is exactly the §6.5 "resolve placeholders" step.
  })

  return { valid: errors.length === 0, errors }
}

/**
 * Build a template object from a (validated) plan. Pipeline per §6.5:
 * clips are appended through the core addClip command onto a fresh v3
 * timeline (the same verb the manual editor and the Edit Plan applier
 * use), converted to the template's flat ticks shape, then handed to
 * createTemplateFromTimeline (auto-placeholders + requiredAssets +
 * schemaVersion included).
 * `options.mediaResolution`: mediaRef -> { src, name } for refs the host
 * resolves now (embedded content); unresolved refs build PLACEHOLDER
 * clips (no src) so the applying user supplies the media later.
 * Returns { template, warnings } — throws nothing.
 */
export function buildTemplateFromPlan(plan, options = {}) {
  const warnings = []
  const resolution = options.mediaResolution || {}
  const timeline = { version: 3, tracks: [], markers: [] }

  ;(plan.operations || []).forEach((op, i) => {
    if (op.trackType === 'text') {
      addClip(timeline, 'text', {
        name: op.name || op.text || 'Text',
        text: op.text ?? op.name ?? '',
        in: op.in ?? 0,
        out: op.out ?? 4 * TICKS_PER_SECOND,
        offset: op.offset,
        fontSize: op.fontSize,
        color: op.color,
        effects: Array.isArray(op.effects) ? op.effects : undefined
      })
      return
    }
    const resolved = op.mediaRef ? resolution[op.mediaRef] : undefined
    const range = {
      in: op.in ?? 0,
      out: op.out ?? 5 * TICKS_PER_SECOND,
      offset: op.offset
    }
    if (resolved && typeof resolved.src === 'string') {
      addClip(timeline, op.trackType, {
        name: op.name || resolved.name || op.mediaRef,
        src: resolved.src,
        ...range
      })
      return
    }
    // Placeholder clip: the template keeps the slot (position/duration),
    // the media arrives at instantiate time (roadmap §6.5 placeholder flow).
    addClip(timeline, op.trackType, {
      name: op.name || `${op.trackType} placeholder`,
      ...range
    })
    warnings.push(`op[${i}]: ${op.mediaRef ? `mediaRef "${op.mediaRef}" unresolved` : 'no mediaRef'} — placeholder slot kept`)
  })

  // v3 -> flat ticks shape (the template store format), track-preserving.
  const flatTracks = timeline.tracks.map((track, index) => ({
    id: track.id || `tr-${track.type}-${index + 1}`,
    type: track.type,
    name: track.name || track.type,
    items: (track.items || []).map(clip => v3ClipToTicks(clip))
  }))

  const tpl = plan.template || {}
  const canvas = {
    width: tpl.width || 1920,
    height: tpl.height || 1080,
    fps: tpl.fps || 30
  }
  const aspectRatio = tpl.aspectRatio
    || (canvas.width === canvas.height ? '1:1' : canvas.width > canvas.height ? '16:9' : '9:16')

  const template = createTemplateFromTimeline({ tracks: flatTracks, markers: [] }, {
    name: tpl.name,
    description: tpl.description || '',
    category: tpl.category || 'custom',
    aspectRatio,
    canvas,
    // §6.5 provenance: AI-generated material must be labelled; provider/
    // model passed through for display only — never secrets, never prompts.
    generatedBy: {
      tool: 'ai',
      provider: options.provider || null,
      model: options.model || null,
      at: Date.now()
    }
  })
  return { template, warnings }
}

/** Parse a raw model reply into a Template Plan candidate (never throws). */
export function parseTemplatePlanReply(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, errors: ['empty reply'] }
  }
  const candidate = extractJsonObject(text)
  if (!candidate) return { ok: false, errors: ['no JSON object found in reply'] }
  const check = validateTemplatePlan(candidate, options)
  if (!check.valid) return { ok: false, errors: check.errors }
  return { ok: true, plan: candidate }
}

/** Readable op lines for the review UI (mirrors summarizeEditPlan). */
export function summarizeTemplatePlan(plan) {
  const lines = []
  const tpl = plan?.template || {}
  lines.push(`template "${tpl.name || ''}" ${tpl.aspectRatio || ''} ${tpl.width || ''}x${tpl.height || ''}`.trim())
  for (const op of plan?.operations || []) {
    if (op.trackType === 'text') {
      lines.push(`text "${(op.text || op.name || '').slice(0, 40)}" @ ${((op.offset || 0) / TICKS_PER_SECOND).toFixed(1)}s`)
    } else {
      lines.push(`${op.trackType} ${op.mediaRef ? `ref ${op.mediaRef}` : '(placeholder)'} ${((op.offset || 0) / TICKS_PER_SECOND).toFixed(1)}s + ${(((op.out || 0) - (op.in || 0)) / TICKS_PER_SECOND).toFixed(1)}s`)
    }
  }
  return lines
}
