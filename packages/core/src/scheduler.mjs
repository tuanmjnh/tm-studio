// =============================================================================
//  tmcut-core — scheduler
//  Frame-index playback planning (V4 Phase 2, item 3).
//
//  A loop that asks the wall clock what time it is can never be replayed:
//  frame 137 is whichever picture the machine happened to reach by then.
//  This module inverts the question — a frame INDEX is a position
//  (clock.frameStartAt), and the content at that position is evaluateTimeline
//  at that position. Count, order and content follow only from the project
//  and the frame rate, so the DOM preview, a WebCodecs loop and an offline
//  golden-frame dump walk the same sequence and can be diffed frame by frame.
//
//  Pure: no timers, no Date.now(), no performance.now(). The host owns WHEN
//  to ask for the next index; it can never own WHAT that index contains.
//
//  Like evaluateTimeline, both stored clip shapes are accepted (DSL v3
//  `timeline` ticks and the app store's flat `offset` + `in`/`out`), so the
//  editor and core-native projects schedule identically.
// =============================================================================

import { createClock } from './clock.mjs'
import { evaluateTimeline, projectTracks } from './evaluate.mjs'
import { clipSpan } from './timeline.mjs'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * End of the content span in ticks. Zero-length clips are skipped for the
 * same reason evaluateTimeline skips them: an empty clip must not extend the
 * sequence it can never paint.
 */
function contentEndTicks(tracks) {
  let max = 0
  for (const track of tracks) {
    for (const clip of track?.items ?? []) {
      const span = clipSpan(clip)
      if (!(span.duration > 0)) continue
      if (span.end > max) max = span.end
    }
  }
  return max
}

/**
 * The renderable frame sequence of one project.
 *
 * @param {{ canvas?: { fps?: object }, timeline?: object, tracks?: object[] } | null | undefined} input
 *   project or timeline, in either stored shape
 * @param {{ rate?: { numerator: number, denominator: number } }} [options]
 *   an explicit rate wins over `input.canvas.fps`; an unusable rate falls
 *   back to 30 fps the way createClock does
 * @returns {{
 *   clock: ReturnType<typeof createClock>,
 *   fps: number,
 *   ticksPerFrame: number,
 *   endTicks: number,
 *   frameCount: number,
 *   indexOf: (ticks: number) => number,
 *   frameAt: (index: number) => object | null,
 *   frames: (fromIndex?: number, toIndex?: number) => object[]
 * }} frozen; `frameCount` is 0 for an empty project, so every index is out of range
 */
export function createFrameScheduler(input, options = {}) {
  const clock = createClock(options?.rate ?? input?.canvas?.fps)
  const endTicks = contentEndTicks(projectTracks(input))
  const frameCount = clock.durationFrames(endTicks)

  /** One frame of the sequence, or null when the index is outside it. */
  function frameAt(index) {
    if (!isFiniteNumber(index)) return null
    const ordinal = Math.floor(index)
    if (ordinal < 0 || ordinal >= frameCount) return null
    const startTicks = clock.frameStartAt(ordinal)
    return Object.freeze({
      index: ordinal,
      startTicks,
      /** The frame's own width. The LAST frame can overrun the content: a partial frame still counts as one to render. */
      endTicks: startTicks + clock.ticksPerFrame,
      evaluation: evaluateTimeline(input, startTicks)
    })
  }

  return Object.freeze({
    clock,
    fps: clock.fps,
    ticksPerFrame: clock.ticksPerFrame,
    endTicks,
    frameCount,
    /**
     * Which frame contains an absolute tick position. Clamped into the
     * sequence, because a position past the end has no frame of its own and
     * the renderer must park on the last one (ADR-018).
     */
    indexOf: (ticks) => {
      if (frameCount === 0) return 0
      return Math.min(clock.frameIndexAt(ticks), frameCount - 1)
    },
    frameAt,
    /** Half-open [fromIndex, toIndex) of the sequence — a bounded render plan. */
    frames: (fromIndex = 0, toIndex = frameCount) => {
      const from = Math.max(0, Math.floor(isFiniteNumber(fromIndex) ? fromIndex : 0))
      const to = Math.min(frameCount, Math.ceil(isFiniteNumber(toIndex) ? toIndex : frameCount))
      const planned = []
      for (let ordinal = from; ordinal < to; ordinal++) planned.push(frameAt(ordinal))
      return planned
    }
  })
}
