// =============================================================================
//  @tmcut/core — clock
//  Frame-boundary math shared by every renderer (V4 Phase 1 / M1). The DOM
//  preview loop, a WebCodecs frame loop and the FFmpeg timeline all need the
//  same answers: which frame contains tick t, where does that frame start,
//  and which frame starts fall inside a span.
//
//  Pure: no timers, no Date.now(). The host owns wall-clock pacing; this
//  module only converts between the tick timebase and frame indices.
// =============================================================================

import { rationalToFloat, snapToFrame, ticksPerFrame, ticksToFrames } from './time.mjs'

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Clock for one FrameRate. Every frame is `ticksPerFrame` ticks wide, and
 * frame N starts at N * ticksPerFrame — the same grid `snapToFrame` and
 * `ticksToFrames` use, so stepping and snapping never disagree.
 *
 * @param {{ numerator: number, denominator: number }} rate rational fps
 * @returns {{
 *   fps: number,
 *   ticksPerFrame: number,
 *   frameIndexAt: (ticks: number) => number,
 *   frameStartAt: (index: number) => number,
 *   nextFrameStart: (ticks: number) => number,
 *   snap: (ticks: number) => number,
 *   frameStarts: (startTick: number, endTick: number) => number[],
 *   durationFrames: (durationTicks: number) => number
 * }}
 */
export function createClock(rate) {
  const per = ticksPerFrame(rate)
  const safePer = per > 0 ? per : 1

  const frameIndexAt = ticks => ticksToFrames(finiteOr(ticks, 0), rate)

  const frameStartAt = (index) => {
    const safe = Math.max(0, Math.floor(finiteOr(index, 0)))
    return Math.max(0, Math.round(safe * safePer))
  }

  return Object.freeze({
    fps: rationalToFloat(rate),
    ticksPerFrame: safePer,
    frameIndexAt,
    frameStartAt,
    nextFrameStart: ticks => frameStartAt(frameIndexAt(ticks) + 1),
    snap: ticks => snapToFrame(finiteOr(ticks, 0), rate),
    /** Start ticks of every frame in the half-open span [startTick, endTick). */
    frameStarts: (startTick, endTick) => {
      const start = Math.max(0, finiteOr(startTick, 0))
      const end = finiteOr(endTick, 0)
      if (!(end > start)) return []
      const first = Math.ceil(start / safePer)
      const last = Math.ceil(end / safePer)
      const starts = []
      for (let index = first; index < last; index++) starts.push(Math.round(index * safePer))
      return starts
    },
    /** Frames needed to cover a duration (ceil, so a partial frame counts). */
    durationFrames: durationTicks => Math.ceil(Math.max(0, finiteOr(durationTicks, 0)) / safePer)
  })
}
