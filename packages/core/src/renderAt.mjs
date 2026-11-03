// =============================================================================
//  tmcut-core — renderAt
//  The public "paint this timestamp" contract (V4 Phase 2, item 1).
//
//  `evaluateTimeline` already answers "what is live at this tick" and
//  `createFrameScheduler` already answers "what is live at frame N", but a
//  renderer has to compose them itself and decide what to do with a timestamp
//  that lands between two frames, one that is past the end, and one that is
//  before zero. Every one of those decisions is a boundary law, and a law a
//  caller re-invents is a law that drifts — the preview kept its own copy of
//  the end-of-content step-back (ADR-018) while core owned the grid.
//
//  So one function owns them. In frame mode (the default) every timestamp
//  inside a frame collapses to that frame's start, which is what makes a
//  render replayable: two calls in the same frame MUST produce the same
//  picture, whatever the wall clock said. In scrub mode the position stands —
//  a drag should track the pointer — and only the end of the content pulls it
//  back, because the end instant belongs to no clip and a canvas parked there
//  would go black exactly where playback leaves the viewer.
//
//  Pure: no timers, no Date.now(), no performance.now(). Like the scheduler,
//  it accepts both stored clip shapes (DSL v3 `timeline` ticks and the app
//  store's flat `offset` + `in`/`out`/`speed`), so editor and core-native
//  projects render identically.
// =============================================================================

import { createFrameScheduler } from './scheduler.mjs'
import { evaluateTimeline } from './evaluate.mjs'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Everything one renderer needs for one timestamp.
 *
 * @param {{ canvas?: { fps?: object }, timeline?: object, tracks?: object[] } | null | undefined} input
 *   project or timeline, in either stored shape
 * @param {number} atTicks absolute timeline ticks requested
 * @param {{ rate?: { numerator: number, denominator: number }, snapToFrame?: boolean }} [options]
 *   `rate` wins over `input.canvas.fps` (an unusable rate falls back to 30 fps
 *   the way `createClock` does); `snapToFrame: false` keeps the requested
 *   position instead of collapsing it to its frame
 * @returns {{
 *   requestedTicks: number, at: number, snapped: boolean, beyond: boolean,
 *   index: number | null, frame: object | null, evaluation: object,
 *   fps: number, ticksPerFrame: number, endTicks: number, frameCount: number
 * }} frozen. `index`/`frame` are null for an empty project, whose only honest
 *   answer is that nothing bounds the request.
 */
export function renderAt(input, atTicks, options = {}) {
  const plan = createFrameScheduler(input, { rate: options.rate })
  const requestedTicks = Math.max(0, Math.round(isFiniteNumber(atTicks) ? atTicks : 0))
  const snapped = options.snapToFrame !== false
  // The last position that still has a picture: the start of the final frame.
  // Null when there is no content at all, so no request can be pulled back.
  const lastRenderable = plan.endTicks > 0
    ? plan.clock.frameStartAt(Math.max(0, plan.clock.durationFrames(plan.endTicks) - 1))
    : null

  let index = null
  let frame = null
  let at = requestedTicks
  if (plan.frameCount > 0) {
    index = plan.indexOf(requestedTicks)
    frame = plan.frameAt(index)
    at = snapped ? frame.startTicks : Math.min(requestedTicks, lastRenderable)
  }

  return Object.freeze({
    requestedTicks,
    /** The position actually evaluated — `at` and `evaluation` are one answer. */
    at,
    evaluation: frame && snapped ? frame.evaluation : evaluateTimeline(input, at),
    /** The named frame the request fell in, from the same plan a frame loop walks. */
    index,
    frame,
    snapped,
    beyond: plan.endTicks > 0 && requestedTicks >= plan.endTicks,
    fps: plan.fps,
    ticksPerFrame: plan.ticksPerFrame,
    endTicks: plan.endTicks,
    frameCount: plan.frameCount
  })
}
