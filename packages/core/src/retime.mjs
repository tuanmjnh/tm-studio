// @tmcut/core — retime: speed/reverse time map (Roadmap C4).
//
// UNIT: every clip field (in/out) and every argument here is in timeline
// TICKS (TICKS_PER_SECOND = 120000) — the DSL v3 unit. App code that
// stores seconds converts at its boundary (sec * TICKS_PER_SECOND).
//
// Timeline model (clip-local): `t = 0` is the clip's own start on the
// timeline, its duration is (out - in) / speed and the source range
// [in, out] is the part of the media being used:
//
//   forward: source = in + t * speed      (speed > 1 plays more source
//                                          per timeline tick = faster)
//   reverse: source = out - t * speed     (plays the source backwards
//                                          from its end)
//
// Mapping functions clamp: timeline input to [0, duration], source
// output to [in, out] — callers can query outside ranges safely.
// Returned ticks may be fractional (round at the edge when integer
// ticks are required); roundtrips are exact within ±1 tick.

import { TICKS_PER_SECOND } from './time.mjs'

/** Smallest source span after a speed change — matches the editor's
 * minimum trim (0.2 s) so a clip never collapses to zero length. */
const MIN_SPAN_TICKS = TICKS_PER_SECOND / 5

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function finiteOr(v, fallback) {
  return Number.isFinite(v) ? v : fallback
}

/**
 * Normalized speed: non-finite input (undefined/NaN) means "normal
 * speed" (1); anything below the floor clamps to 0.01 (100× slow-mo).
 * Negative speeds are invalid — `reverse` is a separate flag.
 * @param {number} speed
 * @returns {number}
 */
export function validateSpeed(speed) {
  const v = Number(speed)
  if (!Number.isFinite(v)) return 1
  return v < 0.01 ? 0.01 : v
}

/**
 * True when the clip needs retime filters in export (`speed !== 1` or
 * `reverse`) — the compiler's switch for setpts/asetpts/reverse steps.
 * @param {object|null|undefined} clip
 * @returns {boolean}
 */
export function isRetimed(clip) {
  if (!clip) return false
  return validateSpeed(clip.speed ?? 1) !== 1 || !!clip.reverse
}

/**
 * Timeline position (clip-local ticks) -> source ticks, honoring speed
 * and direction; clamped outside the clip to its source bounds.
 * @param {{ in?: number, out?: number, speed?: number, reverse?: boolean }} clip
 * @param {number} atTicks
 * @returns {number} source ticks within [in, out]
 */
export function timelineToSource(clip, atTicks) {
  const speed = validateSpeed(clip?.speed)
  const inT = finiteOr(clip?.in, 0)
  const outT = finiteOr(clip?.out, 0)
  const lo = Math.min(inT, outT)
  const hi = Math.max(inT, outT)
  const duration = Math.max(0, (outT - inT) / speed)
  const t = clamp(Number.isFinite(atTicks) ? atTicks : 0, 0, duration)
  const src = clip?.reverse ? outT - t * speed : inT + t * speed
  return clamp(src, lo, hi)
}

/**
 * Source ticks -> timeline position (clip-local ticks), the inverse of
 * timelineToSource; clamped outside the source range to [0, duration].
 * @param {{ in?: number, out?: number, speed?: number, reverse?: boolean }} clip
 * @param {number} sourceTicks
 * @returns {number} clip-local timeline ticks within [0, duration]
 */
export function sourceToTimeline(clip, sourceTicks) {
  const speed = validateSpeed(clip?.speed)
  const inT = finiteOr(clip?.in, 0)
  const outT = finiteOr(clip?.out, 0)
  const duration = Math.max(0, (outT - inT) / speed)
  const s = clamp(Number.isFinite(sourceTicks) ? sourceTicks : 0, Math.min(inT, outT), Math.max(inT, outT))
  const t = clip?.reverse ? (outT - s) / speed : (s - inT) / speed
  return clamp(t, 0, duration)
}

/**
 * Return a NEW clip with a different speed, keeping the source range
 * [in, out] untouched (CapCut behavior: source preserved, the timeline
 * duration (out - in) / speed changes) and never letting the span
 * collapse below the 0.2 s floor. `offset` (clip start) is unchanged.
 * Pure — wrap the resulting assignment with the app's applyV3Edit.
 * @param {{ in?: number, out?: number, speed?: number }} clip
 * @param {number} speed
 * @returns {object} normalized copy
 */
export function withSpeed(clip, speed) {
  const next = { ...(clip || {}), speed: validateSpeed(speed) }
  const inT = finiteOr(next.in, 0)
  if (!Number.isFinite(next.out) || next.out < inT + MIN_SPAN_TICKS) {
    next.out = inT + MIN_SPAN_TICKS
  }
  return next
}

// ---- Speed ramping (R124 A4, CapCut §5.4 speed curves) ----
//
// `clip.speedPoints: [{ t, speed }]` (clip-local TICKS, ascending) turns
// the constant `speed` into a piecewise-linear multiplier curve. Between
// control points the speed interpolates linearly; outside the point range
// the first/last speed clamps (same rule as evalKeyframe). Absent/empty
// points = constant speed (byte-identical behavior everywhere).
//
// Source position under a ramp is the SPEED INTEGRAL over timeline time:
// forward  source = in + ∫₀ᵗ s(τ)dτ
// reverse  source = out − ∫₀ᵗ s(τ)dτ
// Piecewise-linear s has an exact closed form per segment (trapezoid),
// which `rampIntegral` returns and the preview/export maps share.

/** True when the clip carries a usable speed curve (>= 2 valid points). */
export function isRamped(clip) {
  const pts = Array.isArray(clip?.speedPoints) ? clip.speedPoints : []
  return pts.filter(p => p && Number.isFinite(p.t) && Number.isFinite(p.speed)).length >= 2
}

/** Valid speed points sorted by time (defensive copy). */
function sortedPoints(clip) {
  return (Array.isArray(clip?.speedPoints) ? clip.speedPoints : [])
    .filter(p => p && Number.isFinite(p.t) && Number.isFinite(p.speed))
    .map(p => ({ t: p.t, speed: p.speed < 0.01 ? 0.01 : p.speed }))
    .sort((a, b) => a.t - b.t)
}

/** Interpolated curve speed at clip-local ticks (constant fallback). */
export function speedAt(clip, atTicks) {
  const pts = sortedPoints(clip)
  if (pts.length < 2) return validateSpeed(clip?.speed)
  const at = Number.isFinite(atTicks) ? atTicks : 0
  if (at <= pts[0].t) return pts[0].speed
  const last = pts[pts.length - 1]
  if (at >= last.t) return last.speed
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (at >= a.t && at <= b.t) {
      const span = b.t - a.t
      if (span <= 0) return a.speed
      const u = (at - a.t) / span
      return a.speed + (b.speed - a.speed) * u
    }
  }
  return validateSpeed(clip?.speed)
}

/**
 * Exact ∫₀ᵗ s(τ)dτ of the piecewise-linear curve (trapezoid per segment).
 * Non-ramped clips fall back to `speed * t` so callers can use one map.
 */
export function rampIntegral(clip, toTicks) {
  const pts = sortedPoints(clip)
  if (pts.length < 2) return validateSpeed(clip?.speed) * Math.max(0, Number(toTicks) || 0)
  const at = Math.max(0, Number.isFinite(toTicks) ? toTicks : 0)
  let acc = 0
  // Area from t=0 to the first point uses the first speed (clamp rule).
  if (at <= pts[0].t) return pts[0].speed * at
  acc = pts[0].speed * pts[0].t
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (at >= b.t) {
      acc += ((a.speed + b.speed) / 2) * (b.t - a.t)
    } else {
      const span = b.t - a.t
      const u = span > 0 ? (at - a.t) / span : 0
      const sAt = a.speed + (b.speed - a.speed) * u
      // Trapezoid from a to (at): width * (parallel sides mean).
      acc += ((a.speed + sAt) / 2) * (at - a.t)
      return acc
    }
  }
  // Beyond the last point: last speed continues (clamp rule).
  acc += pts[pts.length - 1].speed * (at - pts[pts.length - 1].t)
  return acc
}

/**
 * Ramped generalization of timelineToSource: exact for curves, identical
 * to the constant formula for plain clips (isRamped false).
 */
export function rampTimelineToSource(clip, atTicks) {
  const inT = finiteOr(clip?.in, 0)
  const outT = finiteOr(clip?.out, 0)
  const lo = Math.min(inT, outT)
  const hi = Math.max(inT, outT)
  if (!isRamped(clip)) return timelineToSource(clip, atTicks)
  const consumed = rampIntegral(clip, atTicks)
  const src = clip?.reverse ? outT - consumed : inT + consumed
  return clamp(src, lo, hi)
}

/** Preset curve kinds (CapCut speed-curve menu). */
export const SPEED_RAMP_PRESETS = ['ease-in', 'ease-out', 'mountain', 'valley']

/**
 * Build a preset speed curve over the clip duration, anchored so the
 * MEAN speed equals the clip's current constant speed (the timeline
 * length survives picking a curve, CapCut's rule). Times span
 * [0, duration]; speeds are ≥ 0.01.
 */
export function buildRampPreset(kind, durationTicks, baseSpeed = 1) {
  const d = Math.max(TICKS_PER_SECOND / 5, Number(durationTicks) || 0)
  const b = Math.max(0.01, Number(baseSpeed) || 1)
  const p = (t, mul) => ({ t: Math.round(t), speed: Number(Math.max(0.01, b * mul).toFixed(4)) })
  switch (kind) {
    case 'ease-in': return [p(0, 0.5), p(d, 1.5)]
    case 'ease-out': return [p(0, 1.5), p(d, 0.5)]
    case 'mountain': return [p(0, 0.5), p(d / 2, 1.5), p(d, 0.5)]
    case 'valley': return [p(0, 1.5), p(d / 2, 0.5), p(d, 1.5)]
    default: return []
  }
}

/**
 * FFmpeg `setpts` expression realizing the speed curve NON-LINEARLY
 * (R124 A4). An input frame at source-progress u = (PTS-STARTPTS) seconds
 * past the trim point gets output time τ = u⁻¹, the inverse of the speed
 * integral. Piecewise-linear speed integrates to a QUADRATIC per segment
 * (area = a·θ + k·θ², k = (b−a)/(2W)), so every branch is a closed form
 * evaluated at compile time:
 *
 *   if(lt(u,A), T0 + (-a + sqrt(a² + 4k(u−A0))) / (2k), …tail…)
 *
 * constant segments collapse to the linear (u−A0)/a form. The sqrt
 * argument is (a…b)² in-range — never negative. Null when the clip is
 * not ramped: callers keep the classic `/speed` path byte-identical.
 *
 * Pair with `setpts=PTS-STARTPTS` BEFORE this expression (u is then the
 * elapsed source seconds), and an `fps=` resample AFTER it (duplicate /
 * drop frames onto the constant output grid).
 *
 * @param {object} clip with speedPoints (clip-local ticks)
 * @param {string} uVar expression for elapsed input seconds
 * @returns {string|null} setpts expression (caller wraps in quotes), or null
 */
export function rampSetptsExpr(clip, uVar = '(PTS-STARTPTS)') {
  if (!isRamped(clip)) return null
  const pts = sortedPoints(clip)
  const S = TICKS_PER_SECOND
  const f = (n) => String(Number(n.toFixed(6)))
  /** Segments in SECONDS: linear speed a -> b across timeline [t0, t1]. */
  const segs = []
  for (let i = 0; i + 1 < pts.length; i++) {
    segs.push({ t0: pts[i].t / S, t1: pts[i + 1].t / S, a: pts[i].speed, b: pts[i + 1].speed })
  }
  // Branch table (ascending source-area ranges). Each entry: the output
  // time τ as a closed form of u, valid while u < areaEnd.
  const parts = []
  let T0 = 0 // timeline seconds at the current branch start
  let A0 = 0 // source seconds consumed at the branch start
  if (segs[0].t0 > 0) {
    // Clamp rule: before the first point the curve runs at its first speed.
    const a = segs[0].a
    parts.push({ areaEnd: a * segs[0].t0, tau: `(${uVar})/(${f(a)})` })
    T0 = segs[0].t0
    A0 = a * segs[0].t0
  }
  for (const seg of segs) {
    const W = seg.t1 - seg.t0
    const k = W > 0 ? (seg.b - seg.a) / (2 * W) : 0
    const area = seg.a * W + k * W * W // = (a+b)/2 * W
    const tau = k === 0
      ? `(${f(T0)})+(((${uVar})-(${f(A0)}))/(${f(seg.a)}))`
      : `(${f(T0)})+(((-(${f(seg.a)})+sqrt(((${f(seg.a)})^2)+(${f(4 * k)})*(((${uVar})-(${f(A0)}))))))/(2*(${f(k)})))`
    parts.push({ areaEnd: A0 + area, tau })
    T0 = seg.t1
    A0 += area
  }
  // Clamp rule beyond the last point: constant last speed.
  const lastSpeed = segs[segs.length - 1].b
  let expr = `(${f(T0)})+(((${uVar})-(${f(A0)}))/(${f(lastSpeed)}))`
  for (let i = parts.length - 1; i >= 0; i--) {
    expr = `if(lt(${uVar},${f(parts[i].areaEnd)}),${parts[i].tau},${expr})`
  }
  return expr
}
