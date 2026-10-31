// =============================================================================
//  @tmcut/core — time
//  MediaTime (docs section 2) + rational FrameRate (docs section 3).
//  Pure, zero dependencies. Ticks are plain numbers (JSON-safe); exact for
//  any editable duration (120_000 ticks/s stays precise past 2^53).
// =============================================================================

/** Internal time resolution: 120,000 ticks per second. */
export const TICKS_PER_SECOND = 120_000

/** Convert float seconds to integer ticks. */
export function secToTicks(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round(seconds * TICKS_PER_SECOND)
}

/** Convert integer ticks back to float seconds. */
export function ticksToSec(ticks) {
  if (!Number.isFinite(ticks) || ticks <= 0) return 0
  return ticks / TICKS_PER_SECOND
}

/** Well-known frame rates as rationals. */
export const KNOWN_FRAME_RATES = [
  { numerator: 24, denominator: 1 },
  { numerator: 25, denominator: 1 },
  { numerator: 30, denominator: 1 },
  { numerator: 60, denominator: 1 },
  { numerator: 120, denominator: 1 },
  { numerator: 24000, denominator: 1001 },
  { numerator: 30000, denominator: 1001 },
  { numerator: 60000, denominator: 1001 }
]

function floatEquals(a, b, epsilon = 0.001) {
  return Math.abs(a - b) < epsilon
}

/** Map a float fps value to its rational form (docs section 3). */
export function fpsToRational(fps) {
  const value = Number(fps)
  if (!Number.isFinite(value) || value <= 0) return { numerator: 30, denominator: 1 }
  for (const known of KNOWN_FRAME_RATES) {
    if (floatEquals(value, known.numerator / known.denominator)) {
      return { numerator: known.numerator, denominator: known.denominator }
    }
  }
  return { numerator: Math.round(value * 1000), denominator: 1000 }
}

/** Rational fps back to float. */
export function rationalToFloat(rate) {
  if (!rate || !Number.isFinite(rate.numerator) || !Number.isFinite(rate.denominator) || rate.denominator === 0) {
    return 30
  }
  return rate.numerator / rate.denominator
}

/** Ticks for exactly one frame at the given rate. */
export function ticksPerFrame(rate) {
  const fps = rationalToFloat(rate)
  if (!(fps > 0)) return TICKS_PER_SECOND / 30
  return TICKS_PER_SECOND / fps
}

/** Snap ticks to the nearest frame boundary. */
export function snapToFrame(ticks, rate) {
  const per = ticksPerFrame(rate)
  if (!(per > 0)) return Math.max(0, Math.round(ticks))
  return Math.max(0, Math.round(ticks / per) * Math.round(per))
}

/** Whole frames elapsed at the given tick position. */
export function ticksToFrames(ticks, rate) {
  const per = ticksPerFrame(rate)
  if (!(per > 0)) return 0
  return Math.max(0, Math.floor(ticks / per))
}

/**
 * Format ticks as a timecode string.
 * Uses the nominal (rounded) fps for the frame field: HH:MM:SS:FF.
 */
export function formatTimecode(ticks, rate) {
  const safe = Number.isFinite(ticks) && ticks > 0 ? ticks : 0
  const nominalFps = Math.max(1, Math.round(rationalToFloat(rate)))
  const totalFrames = Math.floor((safe / TICKS_PER_SECOND) * nominalFps)
  const ff = totalFrames % nominalFps
  const totalSeconds = Math.floor(totalFrames / nominalFps)
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60) % 60
  const hh = Math.floor(totalSeconds / 3600)
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  const base = `${pad(mm)}:${pad(ss)}:${pad(ff)}`
  return hh > 0 ? `${pad(hh)}:${base}` : base
}
