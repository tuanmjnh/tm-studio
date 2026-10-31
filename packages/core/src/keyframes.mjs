// @tmcut/core — keyframes: evaluation + easing (Roadmap C3).
//
// A clip stores keyframes as `clip.keyframes: [{ t, prop, value, easing? }]`
// where `t` is in timeline ticks (TICKS_PER_SECOND = 120000). The easing
// of the LEFT keyframe of a segment drives that segment:
//
//   linear     u
//   ease-in    u²                          (slow start, fast end)
//   ease-out   1 - (1-u)²                  (fast start, slow end)
//   ease-in-out  2u² (u<½) / 1-2(1-u)²     (slow both ends)
//   step       hold the left value until the right keyframe's time
//
// Evaluation clamps outside the range: before the first keyframe the
// first value applies, after the last one the last value applies. All
// functions are pure except setKeyframe/removeKeyframe, which mutate
// `clip.keyframes` in place (wrap them with the app's applyV3Edit for
// undo/history like every other core mutation).
import { TICKS_PER_SECOND } from './time.mjs'

/** Easing names accepted by setKeyframe/evalKeyframe. */
export const KEYFRAME_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step']

function isValidNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Keyframes of one prop sorted by time (defensive copy, invalid rows dropped). */
function sortedFor(clip, prop) {
  const list = Array.isArray(clip?.keyframes) ? clip.keyframes : []
  return list
    .filter(k => k && k.prop === prop && isValidNumber(k.t) && isValidNumber(k.value))
    .slice()
    .sort((a, b) => a.t - b.t)
}

function easedU(easing, u) {
  if (easing === 'ease-in') return u * u
  if (easing === 'ease-out') return 1 - (1 - u) * (1 - u)
  if (easing === 'ease-in-out') return u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)
  return u // linear + unknown values degrade to linear
}

/**
 * Interpolated value of `prop` at `atTicks`.
 * @param {object|null|undefined} clip
 * @param {string} prop
 * @param {number} atTicks
 * @returns {number|undefined} undefined when the prop has no keyframes
 *   (or the query time is not a finite number).
 */
export function evalKeyframe(clip, prop, atTicks) {
  const kf = sortedFor(clip, prop)
  if (kf.length === 0 || !isValidNumber(atTicks)) return undefined
  if (atTicks <= kf[0].t) return kf[0].value
  const last = kf[kf.length - 1]
  if (atTicks >= last.t) return last.value

  // Segment [i, i+1] with kf[i].t <= atTicks < kf[i+1].t.
  let i = 0
  while (i + 1 < kf.length && kf[i + 1].t <= atTicks) i++
  const a = kf[i]
  const b = kf[i + 1]
  const span = b.t - a.t
  if (span <= 0 || atTicks === a.t) return a.value
  if (a.easing === 'step') return a.value
  const u = (atTicks - a.t) / span
  return a.value + (b.value - a.value) * easedU(a.easing, u)
}

/**
 * The stored keyframe of `prop` closest to `atTicks` (exact match by
 * default; pass toleranceTicks for hit-testing). Returns the LIVE object
 * from clip.keyframes (not a copy) or null.
 */
export function keyframeAt(clip, prop, atTicks, toleranceTicks = 0) {
  if (!Array.isArray(clip?.keyframes) || !isValidNumber(atTicks)) return null
  const tol = Math.max(0, isValidNumber(toleranceTicks) ? toleranceTicks : 0)
  let best = null
  let bestDist = Infinity
  for (const k of clip.keyframes) {
    if (!k || k.prop !== prop || !isValidNumber(k.t)) continue
    const d = Math.abs(k.t - atTicks)
    if (d <= tol && d < bestDist) {
      best = k
      bestDist = d
    }
  }
  return best
}

/**
 * Insert (or replace when `t` matches exactly) a keyframe. The array
 * stays sorted by `t`. Mutates clip.keyframes in place.
 * @returns {object|null} the stored keyframe, or null when atTicks/value
 *   are not finite numbers (kept nullable instead of throwing so UI
 *   input paths cannot crash the editor).
 */
export function setKeyframe(clip, prop, atTicks, value, easing) {
  if (!clip || !prop || !isValidNumber(atTicks) || !isValidNumber(value)) return null
  if (!Array.isArray(clip.keyframes)) clip.keyframes = []
  const existing = clip.keyframes.find(k => k && k.prop === prop && k.t === atTicks)
  if (existing) {
    existing.value = value
    if (easing !== undefined) existing.easing = easing
    return existing
  }
  const kf = { t: atTicks, prop, value }
  if (easing !== undefined) kf.easing = easing
  clip.keyframes.push(kf)
  clip.keyframes.sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0))
  return kf
}

/** Remove the keyframe of `prop` at `atTicks` (within tolerance). */
export function removeKeyframe(clip, prop, atTicks, toleranceTicks = 0) {
  const hit = keyframeAt(clip, prop, atTicks, toleranceTicks)
  if (!hit) return false
  const idx = clip.keyframes.indexOf(hit)
  clip.keyframes.splice(idx, 1)
  return true
}

/** Unique props that carry at least one keyframe (first-appearance order). */
export function propsWithKeyframes(clip) {
  const list = Array.isArray(clip?.keyframes) ? clip.keyframes : []
  const props = []
  for (const k of list) {
    if (k && k.prop && !props.includes(k.prop)) props.push(k.prop)
  }
  return props
}

/** Times (ticks, ascending) of every keyframe of `prop`. */
export function keyframeTimes(clip, prop) {
  return sortedFor(clip, prop).map(k => k.t)
}

function fmt(n) {
  return String(Number(n.toFixed(6)))
}

/**
 * FFmpeg mathematical expression string for `prop` over time (Roadmap R2, core C3).
 * Evaluates in clip-local time `timeVar` (seconds, default 't').
 * Clamps before the first keyframe to the first value, and after the
 * last keyframe to the last value. Supports all 5 easings:
 * linear, ease-in, ease-out, ease-in-out, step.
 *
 * @param {object|null|undefined} clip
 * @param {string} prop
 * @param {string} [timeVar='t']
 * @returns {string|null} null when the prop has no valid keyframes,
 *   constant number string if exactly 1 keyframe, or nested if() expression.
 */
export function keyframeExpr(clip, prop, timeVar = 't') {
  const kf = sortedFor(clip, prop)
  if (kf.length === 0) return null
  if (kf.length === 1) return fmt(kf[0].value)

  let expr = fmt(kf[kf.length - 1].value)

  for (let i = kf.length - 2; i >= 0; i--) {
    const a = kf[i]
    const b = kf[i + 1]
    const sa = a.t / TICKS_PER_SECOND
    const sb = b.t / TICKS_PER_SECOND
    const span = sb - sa
    const va = a.value
    const vb = b.value

    let segExpr
    if (span <= 0 || a.easing === 'step') {
      segExpr = fmt(va)
    } else {
      const uStr = `((${timeVar}-${fmt(sa)})/${fmt(span)})`
      let easedStr
      if (a.easing === 'ease-in') {
        easedStr = `(${uStr}*${uStr})`
      } else if (a.easing === 'ease-out') {
        easedStr = `(1-(1-${uStr})*(1-${uStr}))`
      } else if (a.easing === 'ease-in-out') {
        easedStr = `if(lt(${uStr},0.5),2*${uStr}*${uStr},1-2*(1-${uStr})*(1-${uStr}))`
      } else {
        easedStr = uStr
      }
      segExpr = `(${fmt(va)}+(${fmt(vb - va)})*${easedStr})`
    }

    expr = `if(lt(${timeVar},${fmt(sb)}),${segExpr},${expr})`
  }

  const s0 = kf[0].t / TICKS_PER_SECOND
  return `if(lt(${timeVar},${fmt(s0)}),${fmt(kf[0].value)},${expr})`
}
