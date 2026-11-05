// =============================================================================
//  tmcut-core — pace
//  The ONE conversion from "the host says this much wall time passed" to "the
//  playhead stands on that frame" (Zero-FFmpeg slice F, requirement 6).
//
//  A live preview has to answer a question every frame, and there are only two
//  honest ways to get it wrong. Integrating the intervals the host delivers
//  makes the position a running float sum of machine jitter, so the preview
//  samples places no exported frame ever sits at. Re-arming the anchor lazily
//  re-spends an interval the pace already spent. This module gets both from one
//  shape: an anchor is a (timestamp, frame, rate) triple, and a position is the
//  anchor frame plus the WHOLE frames the rate covers since then — placed by the
//  clock, never accumulated by the host.
//
//  Pure in the sense the rest of core is pure: no timers, no Date.now(), no
//  performance.now(). The host still owns WHEN it asks; it can never own WHAT
//  that answer is. `createClock` counts and places the frames, `createFrameScheduler`
//  plans them for a render, and this module is the same grid under a live loop.
//
//  Two hosts read it today — the editor transport and the html-video preview —
//  and a WebCodecs frame loop uses the same grid through the scheduler. Adding a
//  third preview means passing a timestamp in, not writing the arithmetic again.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function wholeFrames(value) {
  return Math.max(0, Math.floor(isFiniteNumber(value) ? value : 0))
}

/**
 * The pace of one preview, on one clock.
 *
 * @param {ReturnType<typeof import('./clock.mjs').createClock>} clock
 *   a frame-boundary clock — `createClock(fpsToRational(fps))` is the usual source
 * @returns {{
 *   at: (timestampMs: number, rate: number, currentFrame: number) => {
 *     frame: number, startTicks: number
 *   },
 *   reset: () => void
 * }} stateful handle; every answer is still a pure function of the anchor it holds
 */
export function createFramePace(clock) {
  const usable = clock
    && typeof clock.frameIndexAt === 'function'
    && typeof clock.frameStartAt === 'function'
  if (!usable) {
    throw new TypeError('createFramePace needs a clock from createClock(rate)')
  }

  let armed = false
  let anchorMs = 0
  let anchorFrame = 0
  let anchorRate = 0
  let lastFrame = 0

  function landOn(frame) {
    const safe = wholeFrames(frame)
    return Object.freeze({ frame: safe, startTicks: clock.frameStartAt(safe) })
  }

  /** Start measuring from `frame` at `timestamp` — the interval before it is spent. */
  function arm(timestamp, rate, frame) {
    armed = true
    anchorMs = timestamp
    anchorRate = rate
    anchorFrame = frame
    lastFrame = frame
  }

  /**
   * Where the playhead stands at `timestampMs`.
   *
   * `currentFrame` is where the host says the playhead actually is. When that
   * is not the frame this pace delivered — a scrub, a jump, a clip edit — or
   * the rate changed, or the pace was reset, the anchor moves there instead of
   * dragging the old interval along. `rate` is a signed shuttle factor: 1 paces
   * real time, 8 covers eight frames a second, -1 rewinds; 0 holds position.
   */
  function at(timestampMs, rate, currentFrame) {
    const position = wholeFrames(currentFrame)
    const timestamp = isFiniteNumber(timestampMs) ? timestampMs : 0
    const factor = isFiniteNumber(rate) ? rate : 1
    if (!armed || factor !== anchorRate || position !== lastFrame) {
      arm(timestamp, factor, position)
      return landOn(position)
    }

    const elapsedTicks = Math.round(Math.max(0, timestamp - anchorMs) * (TICKS_PER_SECOND / 1000))
    const advanced = clock.frameIndexAt(elapsedTicks * Math.abs(factor))
    const next = anchorFrame + (factor < 0 ? -advanced : advanced)
    lastFrame = Math.max(0, next)
    return landOn(next)
  }

  return Object.freeze({
    at,
    /** Forget the anchor: the next call starts a fresh segment at the frame it is given. */
    reset() {
      armed = false
      anchorMs = 0
      anchorFrame = 0
      anchorRate = 0
      lastFrame = 0
    }
  })
}
