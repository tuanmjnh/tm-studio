// tmcut-core — keyframes: evaluation + easing (Roadmap C3).
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
