// =============================================================================
//  tmcut-core — frames
//  Frame-timestamp planning (Roadmap C14): WHERE to cut filmstrips,
//  segment thumbnails and HUD snapshots. Core only MATHS the tick lists —
//  converting to seconds (ticksToSec) is the app's job, and since slice D so
//  is decoding: the identity of one request, the instant it may actually ask
//  for, and which of several racing requests still gets to paint all live
//  here, so the browser decoder and any leftover desktop path agree.
//
//  Segment arguments accept both shapes: v3 clips (timeline ticks) and
//  legacy v1 flat items (offset/in/out SECONDS) — same dual-shape
//  contract as evalKeyframe/gainAt.
// =============================================================================

import { secToTicks } from './time.mjs'
import { isByteCacheKey } from './byteCache.mjs'

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

// -----------------------------------------------------------------------------
// Slice D — one frame request, in seconds (the unit a decoder speaks).
// -----------------------------------------------------------------------------

/** Ceiling for an ask when the duration is not known: a day, not forever. */
export const TMCUT_FRAME_MAX_TIME_SEC = 24 * 3600

/**
 * How many decoded frames the app may hold. A thumbnail is tens of kilobytes,
 * so the bound is counted in frames, not bytes: 512 of them is a few tens of
 * megabytes, which is a cache, not a second copy of the library.
 */
export const TMCUT_FRAME_CACHE_MAX_ENTRIES = 512

/** `${fingerprint}-f${millis}-w${pixels}`, and nothing else. */
const FRAME_KEY_PATTERN = /^[0-9a-f]{8}-f\d+-w\d+$/

const FRAME_WIDTH_DEFAULT = 320
const FRAME_WIDTH_MIN = 16
const FRAME_WIDTH_MAX = 1280

/** The last frame of a file sits this far inside its own end. */
const FRAME_TAIL_GUARD_SEC = 0.05

/**
 * The millisecond a request is made at. A negative or unusable ask is a
 * refusal, not a clamp: there is no frame before the start of the file.
 */
export function frameRequestMillis(atSec) {
  if (!isFiniteNumber(atSec) || atSec < 0) return null
  return Math.round(atSec * 1000)
}

/** The pixel width asked for, clamped to what a decoder is worth bothering. */
export function frameRequestWidth(width) {
  const asked = isFiniteNumber(width) ? width : FRAME_WIDTH_DEFAULT
  return Math.min(FRAME_WIDTH_MAX, Math.max(FRAME_WIDTH_MIN, Math.round(asked)))
}

/**
 * A cached frame is named by exactly one request. A path, an uppercase
 * fingerprint or a hand-typed fragment must never name a decoded image the
 * app is about to show.
 */
export function isFrameCacheKey(key) {
  return typeof key === 'string' && FRAME_KEY_PATTERN.test(key)
}

/**
 * The one name both hosts give the same frame: revision, instant, size. The
 * desktop has spelled its PNG this way since roadmap G-1, and the browser
 * cache uses the same string, so a request cannot be answered from a frame
 * of another revision or another second.
 * `fingerprint` is the byte-cache passport (slice C1): no legal fingerprint,
 * no key.
 */
export function frameRequestKey(fingerprint, atSec, width) {
  if (!isByteCacheKey(fingerprint)) return null
  const millis = frameRequestMillis(atSec)
  if (millis === null) return null
  return `${fingerprint}-f${millis}-w${frameRequestWidth(width)}`
}

/**
 * Where to actually ask the decoder. Seeking past the end returns the last
 * real frame rather than nothing, so the tail guard keeps the ask inside the
 * media; when the duration is unknown the day cap keeps a bad probe from
 * asking for a year.
 */
export function frameTimeWithinMedia(atSec, durationSec, maxSec = TMCUT_FRAME_MAX_TIME_SEC) {
  if (!isFiniteNumber(atSec) || atSec < 0) return null
  const ceiling = isFiniteNumber(durationSec) && durationSec > 0
    ? Math.max(0, durationSec - FRAME_TAIL_GUARD_SEC)
    : isFiniteNumber(maxSec) && maxSec > 0 ? maxSec : TMCUT_FRAME_MAX_TIME_SEC
  return Math.min(atSec, ceiling)
}

/**
 * Who is still allowed to paint, per slot.
 *
 * A scrub asks ten frames and shows one. Each ask for a slot takes a fresh
 * token that never comes back, and the law answers two questions the app must
 * not guess at: which token this ask got (and which one it just retired), and
 * whether a result that finally arrived is still the one being waited for.
 * Slots are caller-defined — a HUD, one clip's strip — so one clip's seek can
 * never cancel another's.
 */
export function createFrameSlotLedger() {
  const current = new Map()
  let issued = 0
  return {
    /** Register an ask for `slot`; `superseded` is the token that just lost. */
    begin(slot, key) {
      const previous = current.get(slot)
      issued += 1
      current.set(slot, { token: issued, key })
      return { token: issued, superseded: previous ? previous.token : null }
    },
    /** Whether this token is still the newest thing asked for in that slot. */
    isCurrent(slot, token) {
      const entry = current.get(slot)
      return entry !== undefined && entry.token === token
    },
    /** Stop tracking a slot its owner has gone. Returns whether it was tracked. */
    forget(slot) {
      return current.delete(slot)
    },
    /** Slots still being tracked — a leak here means a component forgot to forget. */
    size() {
      return current.size
    }
  }
}

function byFrameAgeThenKey(a, b) {
  if (a.accessedAt !== b.accessedAt) return a.accessedAt - b.accessedAt
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Which cached frames to release so at most `maxEntries` remain.
 *
 * Duplicate rows collapse to the later touch, an entry that names no frame is
 * reported as `invalid` and dropped (it can free nothing, so keeping it would
 * hide the leak), and a bound that is not a bound keeps nothing rather than
 * meaning "forever". `keep` comes back oldest-first so the caller can drop
 * from its front on the next pass.
 *
 * @param {Array<{key: string, accessedAt: number}>} entries
 * @param {number} maxEntries
 */
export function planFrameCacheEviction(entries, maxEntries) {
  const rows = Array.isArray(entries) ? entries : []
  const bound = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : 0

  const invalid = []
  const byKey = new Map()
  for (const entry of rows) {
    const key = entry && typeof entry.key === 'string' ? entry.key : ''
    if (!isFrameCacheKey(key)) {
      if (key) invalid.push(key)
      continue
    }
    const accessedAt = isFiniteNumber(entry.accessedAt) ? entry.accessedAt : 0
    const seen = byKey.get(key)
    if (seen && seen.accessedAt >= accessedAt) continue
    byKey.set(key, { key, accessedAt })
  }

  const drop = [...invalid]
  const keep = [...byKey.values()].sort(byFrameAgeThenKey)
  while (keep.length > bound) {
    drop.push(keep.shift().key)
  }
  return { drop, keep, kept: keep.length, invalid }
}
