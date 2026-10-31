// =============================================================================
//  @tmcut/core — frames
//  Frame-timestamp planning (Roadmap C14): WHERE to cut filmstrips,
//  segment thumbnails and HUD snapshots. Core only MATHS the tick lists —
//  converting to seconds (ticksToSec) and running FFmpeg `-ss` belongs to
//  the Electron extractor (G1 IPC tmcut:extractFrame).
//
//  Segment arguments accept both shapes: v3 clips (timeline ticks) and
//  legacy v1 flat items (offset/in/out SECONDS) — same dual-shape
//  contract as evalKeyframe/gainAt.
// =============================================================================

import { secToTicks } from './time.mjs'

/** Head/tail share a filmstrip never samples (black / mid-decode frames). */
const EDGE_GUARD_SHARE = 0.02

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * `count` evenly spaced tick positions across [startTicks,
 * startTicks + durationTicks], each centered in its own slice and at
 * least 2% away from both edges (edge frames are usually black or still
 * decoding). Duration <= 0 or a bad count yields [].
 */
export function filmstripTimes(startTicks, durationTicks, count) {
  if (!isFiniteNumber(startTicks) || !isFiniteNumber(durationTicks) || durationTicks <= 0) return []
  if (!isFiniteNumber(count) || count < 1) return []
  const total = Math.floor(count)
  const guard = durationTicks * EDGE_GUARD_SHARE
  const usable = durationTicks - guard * 2
  const slice = usable / total
  const times = []
  for (let index = 0; index < total; index++) {
    times.push(Math.round(startTicks + guard + (index + 0.5) * slice))
  }
  return times
}

/** Span in ticks for either clip model shape (null = unusable). */
function segmentSpan(segment) {
  // v3 clip: timeline placement in ticks.
  if (isFiniteNumber(segment?.timeline?.start) && isFiniteNumber(segment?.timeline?.duration)) {
    return { start: segment.timeline.start, duration: segment.timeline.duration }
  }
  // Legacy v1 flat item: offset/in/out in SECONDS.
  if (
    isFiniteNumber(segment?.offset)
    && isFiniteNumber(segment?.in)
    && isFiniteNumber(segment?.out)
    && segment.out > segment.in
  ) {
    const speed = isFiniteNumber(segment?.speed) && segment.speed > 0 ? segment.speed : 1
    return {
      start: secToTicks(segment.offset),
      duration: Math.max(1, Math.round(secToTicks((segment.out - segment.in) / speed)))
    }
  }
  return null
}

/**
 * Per-segment filmstrip plans: { id, times[] } for every entry with an
 * id. Entries without a usable span keep their slot with empty times so
 * callers can zip results back 1:1; entries without an id are dropped.
 */
export function frameTimesForSegments(segments, perSegment) {
  if (!Array.isArray(segments)) return []
  const plans = []
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object' || segment.id == null) continue
    const span = segmentSpan(segment)
    plans.push({
      id: segment.id,
      times: span ? filmstripTimes(span.start, span.duration, perSegment) : []
    })
  }
  return plans
}

/**
 * Clamp a frame time into the segment range [start, start + duration]
 * (seek / snap safety). A non-finite time or a non-positive duration
 * pins to the start.
 */
export function clampFrameTime(atTicks, startTicks, durationTicks) {
  if (!isFiniteNumber(startTicks)) return 0
  if (!isFiniteNumber(atTicks) || !isFiniteNumber(durationTicks) || durationTicks <= 0) {
    return startTicks
  }
  return Math.min(Math.max(atTicks, startTicks), startTicks + durationTicks)
}
