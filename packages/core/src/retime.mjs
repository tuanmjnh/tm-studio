// tmcut-core — retime: speed/reverse time map (Roadmap C4).
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

/** The slowest rate a media element is worth running — below it a clip stutters. */
export const ELEMENT_RATE_MIN = 0.25
/** The fastest a browser will accept on `HTMLMediaElement.playbackRate`. */
export const ELEMENT_RATE_MAX = 16

/**
 * One authored rate plus the host's clock, inside the element's window.
 * A `shuttle` of 0 (or anything unusable) is not a rate request — the clip runs
 * at its own speed rather than being clamped down to the floor.
 */
export function clampedElementRate(rate, shuttle = 1) {
  const base = Number(rate)
  const clock = Number(shuttle)
  const composed = Number.isFinite(base) ? base : 1
  const factor = Number.isFinite(clock) && clock !== 0 ? Math.abs(clock) : 1
  return Math.min(ELEMENT_RATE_MAX, Math.max(ELEMENT_RATE_MIN, composed * factor))
}

/** The rate a media element must run at for one clip at one clip-local tick. */
export function elementRate(clip, atTicks, shuttle = 1) {
  return clampedElementRate(speedAt(clip, atTicks), shuttle)
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

/**
 * Split a speed curve at clip-local ticks `cutTicks`.
 * `head` still runs on the original clock (t = 0 .. cutTicks) and gains a
 * control point interpolated AT the cut; `tail` is the same curve re-anchored
 * so the cut becomes its own t = 0. Concatenating the two reproduces the
 * original curve exactly — which is what lets a split replay the same frames
 * the uncut clip would have shown.
 * Fewer than two valid points means "no curve": both halves come back empty
 * so callers keep the classic constant-speed path byte-identical.
 * @param {Array<{t: number, speed: number}>|null|undefined} points
 * @param {number} cutTicks
 * @returns {{ head: Array<{t: number, speed: number}>, tail: Array<{t: number, speed: number}> }}
 */
export function splitSpeedPoints(points, cutTicks) {
  const pts = (Array.isArray(points) ? points : [])
    .filter(p => p && Number.isFinite(p.t) && Number.isFinite(p.speed))
    .map(p => ({ t: p.t, speed: p.speed < 0.01 ? 0.01 : p.speed }))
    .sort((a, b) => a.t - b.t)
  if (pts.length < 2) return { head: [], tail: [] }
  const cut = Number.isFinite(cutTicks) ? Math.max(0, cutTicks) : 0
  const atCut = speedAt({ speedPoints: pts }, cut)
  const head = pts.filter(p => p.t < cut).map(p => ({ t: p.t, speed: p.speed }))
  head.push({ t: cut, speed: atCut })
  const tail = [{ t: 0, speed: atCut }]
  for (const p of pts) {
    if (p.t > cut) tail.push({ t: p.t - cut, speed: p.speed })
  }
  return { head, tail }
}

/**
 * The time map a split must inherit: where the cut lands in the SOURCE and
 * what each half's `speed` / `speedPoints` have to be.
 *
 * Both timeline models derive a clip's length from span/speed (the flat app
 * store has no duration field at all, and the v3 bridge synthesizes one the
 * same way), so a half that carries a curve whose mean is NOT its `speed`
 * would silently resize the clip. The fix is therefore per-half, not per-
 * curve: `speed` becomes that half's own mean and the curve is the exact
 * sub-curve, which keeps the source partitioned once AND the cut exactly
 * where the user put it. Constant clips return today's numbers unchanged.
 *
 * @param {{ in?: number, out?: number, speed?: number, reverse?: boolean, speedPoints?: Array<{t: number, speed: number}>|null }} clip
 * @param {number} elapsedTicks clip-local timeline ticks before the cut
 * @returns {{ boundary: number, consumed: number, head: object, tail: object }} `in`/`out` are SOURCE ticks
 */
export function splitRamp(clip, elapsedTicks) {
  const speed = validateSpeed(clip?.speed)
  const inT = finiteOr(clip?.in, 0)
  const outT = finiteOr(clip?.out, 0)
  const lo = Math.min(inT, outT)
  const hi = Math.max(inT, outT)
  const span = hi - lo
  const rev = clip?.reverse === true
  if (span < 2) {
    const flat = { in: lo, out: hi, speed, speedPoints: null }
    return { boundary: lo, consumed: 0, head: { ...flat }, tail: { ...flat } }
  }
  const duration = span / speed
  const elapsed = clamp(Number.isFinite(elapsedTicks) ? elapsedTicks : 0, 0, duration)
  const headTicks = Math.max(1, Math.round(elapsed))
  const tailTicks = Math.max(1, Math.round(duration - elapsed))
  const consumed = clamp(rampIntegral(clip, elapsed), 0, span)
  const cut = Math.round(clamp(rev ? hi - consumed : lo + consumed, lo + 1, hi - 1))
  const split = splitSpeedPoints(clip?.speedPoints, elapsed)
  // A constant clip keeps its own speed on both halves — the mean formula
  // would only add rounding noise to a number the user typed.
  const ramped = isRamped(clip)
  const half = (from, to, ticks, curve) => ({
    in: from,
    out: to,
    speed: ramped ? validateSpeed(Math.max(1, to - from) / ticks) : speed,
    speedPoints: curve.length >= 2 ? curve : null
  })
  return {
    boundary: cut,
    consumed,
    head: rev ? half(cut, hi, headTicks, split.head) : half(lo, cut, headTicks, split.head),
    tail: rev ? half(lo, cut, tailTicks, split.tail) : half(cut, hi, tailTicks, split.tail)
  }
}

/**
 * Inverse of `rampIntegral`: the clip-local timeline ticks needed to consume
 * `consumedTicks` of SOURCE. Solved segment by segment, exactly — within a
 * segment the speed is linear, so the area is quadratic in x and
 * `a.speed*x + k*x^2/2 = rem` has one non-negative root. The stable form
 * `2*rem / (a + sqrt(a^2 + 2*k*rem))` also covers `k -> 0` (pure linear
 * segment) without cancellation. Non-ramped clips use `consumed / speed`.
 */
export function rampElapsedForConsumed(clip, consumedTicks) {
  const speed = validateSpeed(clip?.speed)
  const want = Math.max(0, Number(consumedTicks) || 0)
  const pts = sortedPoints(clip)
  if (pts.length < 2) return want / speed
  if (want <= pts[0].speed * pts[0].t) return want / pts[0].speed
  let acc = pts[0].speed * pts[0].t
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const width = b.t - a.t
    const area = ((a.speed + b.speed) / 2) * width
    if (want > acc + area) {
      acc += area
      continue
    }
    if (width <= 0) return b.t
    const rem = want - acc
    const k = (b.speed - a.speed) / width
    const root = Math.sqrt(Math.max(0, a.speed * a.speed + 2 * k * rem))
    return a.t + (2 * rem) / (a.speed + root)
  }
  const last = pts[pts.length - 1]
  return last.t + (want - acc) / last.speed
}

/**
 * Trim as "a split whose discarded half is thrown away" (V4 ADR-027). The
 * curve stays anchored to the SOURCE content it was drawn against, the
 * survivor gets that sub-curve re-anchored to its own t = 0, and `speed`
 * becomes the survivor's mean so the derived timeline length still equals
 * what the curve actually plays. Which end is shaved depends on the PLAY
 * direction: a reversed clip consumes source downwards, so an in-trim takes
 * off what plays last (the clip does not move) and an out-trim takes off what
 * plays first (it does). Constant clips return the classic numbers.
 *
 * @param {{ in?: number, out?: number, speed?: number, reverse?: boolean, speedPoints?: Array<{t: number, speed: number}>|null }} clip
 * @param {'in'|'out'} edge
 * @param {number} targetTicks new source boundary for that edge
 * @returns {{ in: number, out: number, speed: number, speedPoints: Array<object>|null, shiftTicks: number }}
 */
export function trimRamp(clip, edge, targetTicks) {
  const speed = validateSpeed(clip?.speed)
  const inT = finiteOr(clip?.in, 0)
  const outT = finiteOr(clip?.out, 0)
  const lo = Math.min(inT, outT)
  const hi = Math.max(inT, outT)
  const span = hi - lo
  if (span < 2) return { in: lo, out: hi, speed, speedPoints: null, shiftTicks: 0 }
  const cut = clamp(Math.round(Number(targetTicks) || 0), lo + 1, hi - 1)
  const kept = edge === 'in' ? hi - cut : cut - lo
  const trimsFront = (clip?.reverse === true) ? edge === 'out' : edge === 'in'
  const elapsed = clamp(rampElapsedForConsumed(clip, trimsFront ? span - kept : kept), 1, span)
  const map = splitRamp(clip, elapsed)
  const half = trimsFront ? map.tail : map.head
  return { ...half, shiftTicks: trimsFront ? Math.max(0, Math.round(elapsed)) : 0 }
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
