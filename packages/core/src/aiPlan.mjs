// =============================================================================
//  @tmcut/core — AI Edit Plan (roadmap v3 PART C, §7.2/§7.3)
//
//  The AI is NEVER the source of truth. A plan is structured data with a
//  small, closed vocabulary of edit operations; this module (a) validates
//  every plan strictly and (b) applies it through the existing core edit
//  commands (addClip / removeClip / moveClip / setKeyframe / effects /
//  transitions / retime). Anything the vocabulary cannot express is
//  rejected — there is no arbitrary shell, no arbitrary path, no free-form
//  mutation.
//
//  Media safety: a plan references media by an opaque `mediaRef` id only
//  (no path characters, no absolute paths — the model can never set local
//  file paths). The host resolves refs at apply time (user library,
//  Asset Center installs); unresolved refs skip the operation with a
//  reported reason instead of failing the whole plan.
//
//  Zero-dependency, pure, no Electron/Vue/Node imports.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import {
  addClip,
  removeClip,
  findClip,
  validateTimeline
} from './timeline.mjs'
import { validateEffect, normalizeEffects } from './effects.mjs'
import { KNOWN_TRANSITIONS, canApplyTransition, applyTransition } from './transitions.mjs'

export const AI_EDIT_PLAN_SCHEMA_VERSION = 1

/** Closed operation vocabulary — the ONLY verbs a plan may use. */
export const EDIT_OPERATION_TYPES = [
  'set-canvas',
  'add-clip',
  'set-clip',
  'move-clip',
  'remove-clip',
  'set-effect',
  'set-transition',
  'set-speed',
  'set-volume'
]

const MAX_PLAN_OPERATIONS = 100
const MAX_STRING_LEN = 512
const TRACK_TYPES = ['video', 'audio', 'text']
const TRACK_TYPES_WITH_MEDIA = ['video', 'audio']

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function positiveFiniteNumber(v, name, errors, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > max) {
    errors.push(`${name} must be a positive finite number`)
    return false
  }
  return true
}

function nonNegativeFiniteNumber(v, name, errors, max = Number.MAX_SAFE_INTEGER) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
    errors.push(`${name} must be a non-negative finite number`)
    return false
  }
  return true
}

function cleanString(v, name, errors, { required = false, max = MAX_STRING_LEN } = {}) {
  if (typeof v !== 'string' || (required && v.trim() === '')) {
    if (required) errors.push(`${name} is required`)
    return null
  }
  if (v.length > max) {
    errors.push(`${name} exceeds ${max} characters`)
    return null
  }
  return v
}

/**
 * `mediaRef` is the ONLY media channel in a plan: a short opaque id.
 * Path separators / drive letters / URL schemes are all rejected so a
 * model (or a tampered payload) can never smuggle a filesystem path.
 */
function checkMediaRef(v, name, errors, required = true) {
  if (v === undefined || v === null) {
    if (required) errors.push(`${name} is required`)
    return null
  }
  const s = cleanString(v, name, errors, { required: true })
  if (!s) return null
  if (!/^[\w.-]+$/.test(s)) {
    errors.push(`${name} may only contain letters, digits, ".", "_" and "-"`)
    return null
  }
  return s
}

/**
 * Validate a raw plan object (untrusted). Returns { valid, errors }.
 * `options`:
 *  - `timeline`: when given, clip-targeting ops must reference existing
 *    clip ids (the dry-run gate: a plan for a different project fails).
 *  - `mediaRefs`: when given (Set/array of ids), add-clip mediaRef values
 *    must be among the refs the host actually offers.
 */
export function validateEditPlan(plan, options = {}) {
  const errors = []
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan must be an object'] }

  if (plan.schemaVersion !== undefined && plan.schemaVersion !== AI_EDIT_PLAN_SCHEMA_VERSION) {
    errors.push(`unsupported plan schemaVersion ${plan.schemaVersion} (expected ${AI_EDIT_PLAN_SCHEMA_VERSION})`)
  }
  cleanString(plan.intentSummary, 'intentSummary', errors, { max: 1000 })
  if (plan.assumptions !== undefined && !Array.isArray(plan.assumptions)) {
    errors.push('assumptions must be an array')
  }
  if (plan.target !== undefined) {
    if (!isPlainObject(plan.target)) {
      errors.push('target must be an object')
    } else {
      if (plan.target.durationTicks !== undefined) positiveFiniteNumber(plan.target.durationTicks, 'target.durationTicks', errors)
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

  const timeline = options.timeline || null
  const offeredMedia = options.mediaRefs
    ? new Set(Array.from(options.mediaRefs))
    : null

  ops.forEach((op, i) => {
    const where = `op[${i}]`
    if (!isPlainObject(op)) {
      errors.push(`${where} must be an object`)
      return
    }
    const type = op.type
    if (!EDIT_OPERATION_TYPES.includes(type)) {
      errors.push(`${where} has unknown type: ${type}`)
      return
    }

    switch (type) {
      case 'set-canvas': {
        positiveFiniteNumber(op.width, `${where}.width`, errors, 32768)
        positiveFiniteNumber(op.height, `${where}.height`, errors, 32768)
        positiveFiniteNumber(op.fps, `${where}.fps`, errors, 240)
        break
      }
      case 'add-clip': {
        if (!TRACK_TYPES.includes(op.trackType)) errors.push(`${where}.trackType must be one of ${TRACK_TYPES.join(', ')}`)
        cleanString(op.name, `${where}.name`, errors)
        if (typeof op.text !== 'string' && op.text !== undefined) errors.push(`${where}.text must be a string`)
        if (op.effects !== undefined) {
          if (!Array.isArray(op.effects)) {
            errors.push(`${where}.effects must be an array`)
          } else {
            op.effects.forEach((fx, j) => {
              errors.push(...validateEffect(fx).map(e => `${where}.effects[${j}]: ${e}`))
            })
          }
        }
        if (op.trackType === 'text') {
          if (op.mediaRef !== undefined) checkMediaRef(op.mediaRef, `${where}.mediaRef`, errors)
        } else if (TRACK_TYPES_WITH_MEDIA.includes(op.trackType)) {
          const ref = checkMediaRef(op.mediaRef, `${where}.mediaRef`, errors, true)
          if (ref && offeredMedia && !offeredMedia.has(ref)) {
            errors.push(`${where}.mediaRef "${ref}" is not among the offered media refs`)
          }
        }
        if (op.in !== undefined) nonNegativeFiniteNumber(op.in, `${where}.in`, errors, 10 * 3600 * TICKS_PER_SECOND)
        if (op.out !== undefined) nonNegativeFiniteNumber(op.out, `${where}.out`, errors, 10 * 3600 * TICKS_PER_SECOND)
        if (op.offset !== undefined) nonNegativeFiniteNumber(op.offset, `${where}.offset`, errors, 10 * 3600 * TICKS_PER_SECOND)
        if (op.volume !== undefined && (typeof op.volume !== 'number' || !Number.isFinite(op.volume) || op.volume < 0 || op.volume > 400)) {
          errors.push(`${where}.volume must be a number in [0, 400]`)
        }
        if (op.fade !== undefined) {
          if (!isPlainObject(op.fade)) {
            errors.push(`${where}.fade must be an object with optional in/out ticks`)
          } else {
            if (op.fade.in !== undefined) nonNegativeFiniteNumber(op.fade.in, `${where}.fade.in`, errors, TICKS_PER_SECOND * 60)
            if (op.fade.out !== undefined) nonNegativeFiniteNumber(op.fade.out, `${where}.fade.out`, errors, TICKS_PER_SECOND * 60)
          }
        }
        if (op.fontSize !== undefined) positiveFiniteNumber(op.fontSize, `${where}.fontSize`, errors, 1024)
        if (op.color !== undefined && (typeof op.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(op.color))) {
          errors.push(`${where}.color must be a #rrggbb string`)
        }
        break
      }
      case 'set-clip': {
        if (timeline) requireClipId(op, where, errors, timeline)
        if (typeof op.text !== 'string' && op.text !== undefined) errors.push(`${where}.text must be a string`)
        if (op.color !== undefined && (typeof op.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(op.color))) {
          errors.push(`${where}.color must be a #rrggbb string`)
        }
        if (op.fontSize !== undefined) positiveFiniteNumber(op.fontSize, `${where}.fontSize`, errors, 1024)
        break
      }
      case 'move-clip': {
        if (timeline) requireClipId(op, where, errors, timeline)
        if (typeof op.startTicks !== 'number' || !Number.isFinite(op.startTicks) || op.startTicks < 0) {
          errors.push(`${where}.startTicks must be a non-negative number`)
        }
        break
      }
      case 'remove-clip': {
        if (timeline) requireClipId(op, where, errors, timeline)
        break
      }
      case 'set-effect': {
        if (timeline) requireClipId(op, where, errors, timeline)
        if (!Array.isArray(op.effects)) {
          errors.push(`${where}.effects must be an array`)
        } else {
          op.effects.forEach((fx, j) => {
            errors.push(...validateEffect(fx).map(e => `${where}.effects[${j}]: ${e}`))
          })
        }
        break
      }
      case 'set-transition': {
        if (timeline) requireClipId(op, where, errors, timeline)
        if (!KNOWN_TRANSITIONS.includes(op.transition)) {
          errors.push(`${where}.transition must be one of ${KNOWN_TRANSITIONS.join(', ')}`)
        }
        if (typeof op.durationTicks !== 'number' || !Number.isFinite(op.durationTicks) || op.durationTicks <= 0) {
          errors.push(`${where}.durationTicks must be a positive number`)
        }
        break
      }
      case 'set-speed': {
        if (timeline) requireClipId(op, where, errors, timeline)
        if (typeof op.speed !== 'number' || !Number.isFinite(op.speed) || op.speed < 0.01 || op.speed > 100) {
          errors.push(`${where}.speed must be a finite number in [0.01, 100]`)
        }
        break
      }
      case 'set-volume': {
        if (timeline) requireClipId(op, where, errors, timeline)
        if (typeof op.volume !== 'number' || !Number.isFinite(op.volume) || op.volume < 0 || op.volume > 400) {
          errors.push(`${where}.volume must be a number in [0, 400]`)
        }
        break
      }
    }
  })

  return { valid: errors.length === 0, errors }
}

function requireClipId(op, where, errors, timeline) {
  const clipId = cleanString(op.clipId, `${where}.clipId`, errors, { required: true })
  if (clipId && !findClip(timeline, clipId)) {
    errors.push(`${where}.clipId "${clipId}" does not exist in the target timeline`)
  }
}

/**
 * Apply a (validated) plan to a timeline object, in place, using the core
 * edit commands. `options`:
 *  - `mediaResolution`: Map/mediaRef -> { src, name? } the host offers.
 *  - `canvas`: when the plan has set-canvas, the host passes its own
 *    canvas object; the op mutates it (width/height/fps only).
 * Returns the plan trace: { applied: [...], skipped: [...], warnings: [] }.
 * Individual op failures skip that op (reported), they do not abort the
 * plan — the project can never end up half-claimed as applied.
 */
export function applyEditPlan(timeline, plan, options = {}) {
  const trace = { applied: [], skipped: [], warnings: [] }
  const resolution = options.mediaResolution || {}
  const canvas = options.canvas || null

  for (const [i, op] of (plan.operations || []).entries()) {
    const step = { index: i, type: op.type, ok: true, reason: null }
    try {
      switch (op.type) {
        case 'set-canvas': {
          if (!canvas) {
            step.ok = false
            step.reason = 'no-canvas-target'
            break
          }
          canvas.width = Math.round(op.width)
          canvas.height = Math.round(op.height)
          canvas.fps = op.fps
          break
        }
        case 'add-clip': {
          if (op.trackType === 'text') {
            const clip = addClip(timeline, 'text', {
              name: op.name || 'Text',
              text: op.text ?? op.name ?? '',
              in: op.in ?? 0,
              out: op.out ?? 4 * TICKS_PER_SECOND,
              offset: op.offset,
              fontSize: op.fontSize,
              color: op.color,
              effects: op.effects ? normalizeEffects(op.effects) : undefined
            })
            if (!clip) { step.ok = false; step.reason = 'track-locked' }
            break
          }
          const resolved = op.mediaRef ? resolution[op.mediaRef] : undefined
          if (!resolved || typeof resolved.src !== 'string') {
            step.ok = false
            step.reason = 'media-ref-missing'
            break
          }
          const clip = addClip(timeline, op.trackType, {
            name: op.name || resolved.name || op.mediaRef,
            src: resolved.src,
            in: op.in ?? 0,
            out: op.out ?? 5 * TICKS_PER_SECOND,
            offset: op.offset,
            // Phase 8: music beds / SFX carry loudness + fades on the op;
            // validateEditPlan already range-checked both.
            volume: op.volume,
            fade: op.fade,
            effects: op.effects ? normalizeEffects(op.effects) : undefined
          })
          if (!clip) { step.ok = false; step.reason = 'track-locked' }
          break
        }
        case 'set-clip': {
          const found = findClip(timeline, op.clipId)
          if (!found) { step.ok = false; step.reason = 'clip-missing'; break }
          if (found.track.locked) { step.ok = false; step.reason = 'track-locked'; break }
          if (op.name !== undefined) found.clip.name = op.name
          if (op.text !== undefined) found.clip.text = op.text
          if (op.color !== undefined) found.clip.color = op.color
          if (op.fontSize !== undefined) found.clip.fontSize = op.fontSize
          break
        }
        case 'move-clip': {
          const found = findClip(timeline, op.clipId)
          if (!found) { step.ok = false; step.reason = 'clip-missing'; break }
          if (found.track.locked) { step.ok = false; step.reason = 'track-locked'; break }
          found.clip.timeline.start = Math.max(0, Math.round(op.startTicks))
          break
        }
        case 'remove-clip': {
          if (!removeClip(timeline, op.clipId)) { step.ok = false; step.reason = 'clip-missing-or-locked' }
          break
        }
        case 'set-effect': {
          const found = findClip(timeline, op.clipId)
          if (!found) { step.ok = false; step.reason = 'clip-missing'; break }
          if (found.track.locked) { step.ok = false; step.reason = 'track-locked'; break }
          // Re-validate at apply time (defense in depth: a plan validated
          // against a different timeline must not smuggle bad effects).
          found.clip.effects = normalizeEffects(op.effects)
          break
        }
        case 'set-transition': {
          const gate = canApplyTransition(timeline, op.clipId, op.transition, op.durationTicks)
          if (!gate.ok) { step.ok = false; step.reason = gate.reason || 'cannot-apply'; break }
          const ok = applyTransition(timeline, op.clipId, op.transition, op.durationTicks)
          if (!ok) { step.ok = false; step.reason = 'apply-failed' }
          break
        }
        case 'set-speed': {
          const found = findClip(timeline, op.clipId)
          if (!found) { step.ok = false; step.reason = 'clip-missing'; break }
          if (found.track.locked) { step.ok = false; step.reason = 'track-locked'; break }
          found.clip.speed = op.speed
          break
        }
        case 'set-volume': {
          const found = findClip(timeline, op.clipId)
          if (!found) { step.ok = false; step.reason = 'clip-missing'; break }
          if (found.track.locked) { step.ok = false; step.reason = 'track-locked'; break }
          found.clip.volume = op.volume
          break
        }
        default:
          step.ok = false
          step.reason = 'unknown-op'
      }
    } catch (err) {
      step.ok = false
      step.reason = 'exception'
      trace.warnings.push(`op[${i}] ${op.type}: ${err?.message || 'exception'}`)
    }
    if (step.ok) trace.applied.push(step)
    else trace.skipped.push(step)
  }

  const timelineErrors = validateTimeline(timeline)
  if (Array.isArray(timelineErrors) && timelineErrors.length > 0) {
    trace.warnings.push(`post-apply timeline validation: ${timelineErrors.join('; ')}`)
  }
  return trace
}

/**
 * Extract the first plausible JSON object from a free-text model reply
 * (markdown fences stripped, then whole text, then a brace span). Never
 * throws — garbage yields null. Shared by the Edit Plan and Template Plan
 * parsers (bounded-repair contract: report, then retry once).
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string' || text.trim() === '') return null
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const sources = [fence?.[1], text.trim()]
  const firstBrace = text.indexOf('{')
  if (firstBrace !== -1) {
    const lastBrace = text.lastIndexOf('}')
    if (lastBrace > firstBrace) sources.push(text.slice(firstBrace, lastBrace + 1))
  }
  for (const src of sources) {
    if (!src || typeof src !== 'string') continue
    try {
      const parsed = JSON.parse(src)
      if (isPlainObject(parsed)) return parsed
    } catch {
      // try next source
    }
  }
  return null
}

/**
 * Parse a raw model reply (free text, often markdown-fenced) into a plan
 * candidate. Extraction never throws: garbage is { ok: false }.
 * The BOUNDED-REPAIR contract: `errors` are meant to be appended to the
 * prompt on the retry turn.
 */
export function parseEditPlanReply(text, options = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, errors: ['empty reply'] }
  }
  const candidate = extractJsonObject(text)
  if (!candidate) return { ok: false, errors: ['no JSON object found in reply'] }
  const check = validateEditPlan(candidate, options)
  if (!check.valid) return { ok: false, errors: check.errors }
  return { ok: true, plan: candidate }
}

/** One-line-per-op summary for UI diff display (no secrets, no paths). */
export function summarizeEditPlan(plan, labels = {}) {
  const lines = []
  for (const op of plan?.operations || []) {
    switch (op.type) {
      case 'set-canvas': lines.push(`canvas ${op.width}x${op.height} @${op.fps}fps`); break
      case 'add-clip': lines.push(`add ${op.trackType} "${op.name || op.mediaRef || ''}"`); break
      case 'set-clip': lines.push(`edit clip ${labels[op.clipId] || op.clipId}`); break
      case 'move-clip': lines.push(`move clip ${labels[op.clipId] || op.clipId} to ${(op.startTicks / TICKS_PER_SECOND).toFixed(2)}s`); break
      case 'remove-clip': lines.push(`remove clip ${labels[op.clipId] || op.clipId}`); break
      case 'set-effect': lines.push(`effects -> ${(op.effects || []).map(f => f.type).join(', ') || '(clear)'}`); break
      case 'set-transition': lines.push(`transition ${op.transition} ${(op.durationTicks / TICKS_PER_SECOND).toFixed(2)}s`); break
      case 'set-speed': lines.push(`speed x${op.speed}`); break
      case 'set-volume': lines.push(`volume ${op.volume}%`); break
      default: lines.push(op.type)
    }
  }
  return lines
}
