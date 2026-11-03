// =============================================================================
//  tmcut-core — timeline
//  Pure timeline operations on plain Timeline DSL v3 objects (docs §14).
//  No Vue, no Electron, no filesystem. All positions are integer ticks.
//  Functions mutate the passed timeline object and return affected ids,
//  so callers can wrap them in history commands.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import { isRamped, splitRamp, trimRamp } from './retime.mjs'
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_FONT_SIZE } from './textStyle.mjs'

let clipCounter = 0
let trackCounter = 0

function nextClipId() {
  clipCounter += 1
  return `clip_${Date.now().toString(36)}_${clipCounter.toString(36)}`
}

function nextTrackId(type) {
  trackCounter += 1
  return `t-${type}-${Date.now().toString(36)}${trackCounter.toString(36)}`
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Media duration of a clip in ticks (source range adjusted by speed). */
export function clipDurationTicks(clip) {
  const speed = isFiniteNumber(clip.speed) && clip.speed > 0 ? clip.speed : 1
  const span = (clip.source?.out ?? 0) - (clip.source?.in ?? 0)
  return Math.max(0, Math.round(span / speed))
}

/** Timeline end of a clip in ticks. */
export function clipEndTicks(clip) {
  const start = clip.timeline?.start ?? 0
  return start + clipDurationTicks(clip)
}

function speedOf(clip) {
  return isFiniteNumber(clip?.speed) && clip.speed > 0 ? clip.speed : 1
}

/**
 * Absolute tick span, accepting BOTH stored shapes: DSL v3 (`timeline.start`
 * + `clip.timeline.duration`) and the app store's flat model (`offset` +
 * `in`/`out`/`speed`, where the span is derived exactly like the app's
 * `clipDurationTicks`). Unknown shapes are empty (`duration: 0`), which
 * keeps every caller's live check false instead of throwing.
 */
export function clipSpan(clip) {
  if (clip?.timeline) {
    const start = isFiniteNumber(clip.timeline.start) ? clip.timeline.start : 0
    const duration = Math.max(0, isFiniteNumber(clip.timeline.duration) ? clip.timeline.duration : 0)
    return { start, duration, end: start + duration }
  }
  if (isFiniteNumber(clip?.in) || isFiniteNumber(clip?.out) || isFiniteNumber(clip?.offset)) {
    const start = Math.max(0, Math.round(isFiniteNumber(clip.offset) ? clip.offset : 0))
    const span = (isFiniteNumber(clip.out) ? clip.out : 0) - (isFiniteNumber(clip.in) ? clip.in : 0)
    const duration = Math.max(0, Math.round(span / speedOf(clip)))
    return { start, duration, end: start + duration }
  }
  return { start: 0, duration: 0, end: 0 }
}

/** Total timeline duration in ticks (max clip end across tracks). */
export function totalDurationTicks(timeline) {
  let max = 0
  for (const track of timeline?.tracks ?? []) {
    for (const item of track.items ?? []) {
      const end = clipEndTicks(item)
      if (end > max) max = end
    }
  }
  return max
}

/** Find a clip by id. Returns { track, index, clip } or null. */
export function findClip(timeline, clipId) {
  for (const track of timeline?.tracks ?? []) {
    const index = (track.items ?? []).findIndex(item => item.id === clipId)
    if (index !== -1) return { track, index, clip: track.items[index] }
  }
  return null
}

/** Find a track by id. */
export function findTrack(timeline, trackId) {
  return (timeline?.tracks ?? []).find(track => track.id === trackId) ?? null
}

/** Ensure a track of the given type exists; create and append it otherwise. */
export function ensureTrack(timeline, trackType, name) {
  if (!timeline || !Array.isArray(timeline.tracks)) {
    throw new Error('timeline.tracks must be an array')
  }
  let track = timeline.tracks.find(t => t.type === trackType)
  if (!track) {
    track = { id: nextTrackId(trackType), type: trackType, name: name ?? trackType, items: [] }
    timeline.tracks.push(track)
  }
  return track
}

/**
 * Next display name for a track of the given type (Roadmap C8): counts
 * both numbered names ("Video 1") and plain defaults ("Text") so the
 * app's default tracks never collide with generated ones.
 */
export function nextTrackName(timeline, trackType) {
  const label = { video: 'Video', text: 'Text', audio: 'Audio' }[trackType] ?? 'Track'
  let numbered = 0
  let total = 0
  for (const track of timeline?.tracks ?? []) {
    if (track.type !== trackType) continue
    total += 1
    const match = /\s(\d+)$/.exec(track.name ?? '')
    if (match) numbered = Math.max(numbered, Number(match[1]))
  }
  return `${label} ${Math.max(numbered, total) + 1}`
}

/** Append an empty track of the given type; returns the new track (Roadmap C8). */
export function addTrack(timeline, trackType, name) {
  if (!timeline || !Array.isArray(timeline.tracks)) {
    throw new Error('timeline.tracks must be an array')
  }
  const track = {
    id: nextTrackId(trackType),
    type: trackType,
    name: name ?? nextTrackName(timeline, trackType),
    items: []
  }
  timeline.tracks.push(track)
  return track
}

/**
 * Remove a track by id (Roadmap C8). Locked tracks are refused (the
 * core lock-guard convention). Default removes the track WITH its
 * clips; `{ keepClips: true }` re-homes the clips onto another track of
 * the same type instead and returns false when there is no target left.
 * Unknown ids return false.
 */
export function removeTrack(timeline, trackId, options = {}) {
  const tracks = timeline?.tracks ?? []
  const index = tracks.findIndex(track => track.id === trackId)
  if (index === -1) return false
  const track = tracks[index]
  if (track.locked) return false
  if (options.keepClips && (track.items ?? []).length > 0) {
    const target = tracks.find((other, otherIndex) => otherIndex !== index && other.type === track.type)
    if (!target) return false
    target.items.push(...track.items)
  }
  tracks.splice(index, 1)
  return true
}

function defaultTransform() {
  return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 }
}

/**
 * Append a clip to a track. When `partial.timeline.start` is omitted the
 * clip is appended after the last clip end (mirrors the app editor).
 * `partial` accepts v3 fields; `source`/`timeline` may be omitted.
 */
export function addClip(timeline, trackType, partial = {}) {
  const track = ensureTrack(timeline, trackType)
  // Locked tracks refuse edits (CapCut-style track lock, docs Phase 2).
  if (track.locked) return null
  const sourceIn = Math.max(0, Math.round(partial.source?.in ?? partial.in ?? 0))
  const fallbackOut = trackType === 'text'
    ? 4 * TICKS_PER_SECOND
    : 5 * TICKS_PER_SECOND
  const sourceOut = Math.round(partial.source?.out ?? partial.out ?? fallbackOut)
  const speed = isFiniteNumber(partial.speed) && partial.speed > 0 ? partial.speed : 1
  const duration = Math.max(1, Math.round((Math.max(sourceOut, sourceIn + 1) - sourceIn) / speed))
  let start = partial.timeline?.start ?? partial.offset
  if (!isFiniteNumber(start)) {
    start = track.items.reduce((max, item) => Math.max(max, clipEndTicks(item)), 0)
  }
  const clip = {
    id: partial.id ?? nextClipId(),
    type: trackType,
    name: partial.name ?? 'Clip',
    assetId: partial.assetId ?? null,
    locator: partial.locator ?? (partial.src ? { runtime: 'electron', path: partial.src } : null),
    source: { in: sourceIn, out: Math.max(sourceIn + 1, sourceOut) },
    timeline: { start: Math.max(0, Math.round(start)), duration },
    speed,
    reverse: partial.reverse ?? false,
    groupId: partial.groupId ?? null,
    linkId: partial.linkId ?? null,
    transform: { ...defaultTransform(), ...(partial.transform ?? {}) },
    fit: partial.fit,
    focusX: partial.focusX,
    focusY: partial.focusY,
    cropRect: partial.cropRect,
    speedPoints: partial.speedPoints,
    volume: partial.volume ?? 100,
    text: partial.text,
    color: partial.color ?? DEFAULT_TEXT_COLOR,
    fontSize: partial.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
    effects: Array.isArray(partial.effects) ? partial.effects : [],
    keyframes: Array.isArray(partial.keyframes) ? partial.keyframes : [],
    transitionIn: partial.transitionIn,
    fade: partial.fade
  }
  track.items.push(clip)
  return clip
}

/** Remove a clip by id. Returns true when removed. */
export function removeClip(timeline, clipId) {
  const found = findClip(timeline, clipId)
  if (!found || found.track.locked) return false
  found.track.items.splice(found.index, 1)
  return true
}

/**
 * Split the clip under `splitTimeTicks` into two clips.
 * Keeps ≥1 tick margin on each side. Returns the second clip or null.
 *
 * The cut inherits the clip's TIME MAP, not just the source boundary: speed,
 * curve and direction all decide which source ticks sit on which side, and
 * each half gets the mean speed that keeps its derived length on the cut
 * (`retime.splitRamp`). Copying the whole curve to both halves — what this
 * function did before — replays the ramp twice and skips the middle.
 */
export function splitClip(timeline, clipId, splitTimeTicks) {
  const found = findClip(timeline, clipId)
  if (!found || found.track.locked) return null
  const { track, index, clip } = found
  const clipStart = clip.timeline.start
  const clipEnd = clipStart + clipDurationTicks(clip)
  if (splitTimeTicks <= clipStart || splitTimeTicks >= clipEnd) return null

  const elapsed = splitTimeTicks - clipStart
  const map = splitRamp({
    in: clip.source.in,
    out: clip.source.out,
    speed: clip.speed,
    reverse: clip.reverse,
    speedPoints: clip.speedPoints
  }, elapsed)
  // Clone the tail BEFORE rewriting the head, then hand it its own half.
  const second = {
    ...JSON.parse(JSON.stringify(clip)),
    id: nextClipId(),
    source: { in: map.tail.in, out: map.tail.out },
    timeline: { start: splitTimeTicks, duration: Math.max(1, clipEnd - splitTimeTicks) },
    speed: map.tail.speed
  }
  if (map.tail.speedPoints) second.speedPoints = map.tail.speedPoints
  else delete second.speedPoints
  clip.source.in = map.head.in
  clip.source.out = map.head.out
  clip.speed = map.head.speed
  if (map.head.speedPoints) clip.speedPoints = map.head.speedPoints
  else delete clip.speedPoints
  clip.timeline.duration = Math.max(1, elapsed)
  // The tail's incoming neighbor changed: the inherited transition only
  // ever described the ORIGINAL pair (the first half keeps it — its start
  // still overlaps the previous clip) (R34/B3).
  delete second.transitionIn
  track.items.splice(index + 1, 0, second)
  return second
}

/** Move a clip to a new timeline start (ticks). Returns false when missing. */
export function moveClip(timeline, clipId, startTicks) {
  const found = findClip(timeline, clipId)
  if (!found || found.track.locked) return false
  found.clip.timeline.start = Math.max(0, Math.round(startTicks))
  return true
}

/**
 * Trim a clip edge. `edge` is 'in' or 'out'; `sourceTicks` is the new source
 * boundary. Trims keep ≥1 tick of media, and only content that PLAYS FIRST
 * moves the clip along the timeline: an in-trim for a forward clip, an
 * out-trim for a reversed one.
 *
 * A ramped clip that SHRINKS goes through `retime.trimRamp` (ADR-027): the
 * curve is anchored to the SOURCE content it was drawn against, so the
 * survivor keeps its own sub-curve and its own mean speed, and it moves by
 * the ticks that content actually consumed — `delta / speed` only holds for a
 * constant clip. Growing a ramp has no split analogue: the curve keeps its
 * anchor and `speedAt` clamps over the extra head.
 */
export function trimClip(timeline, clipId, edge, sourceTicks) {
  const found = findClip(timeline, clipId)
  if (!found || found.track.locked) return false
  const { clip } = found
  const speed = isFiniteNumber(clip.speed) && clip.speed > 0 ? clip.speed : 1
  if (edge !== 'in' && edge !== 'out') return false
  const flat = {
    in: clip.source.in,
    out: clip.source.out,
    speed: clip.speed,
    reverse: clip.reverse,
    speedPoints: clip.speedPoints
  }
  const target = edge === 'in'
    ? Math.max(0, Math.min(flat.out - 1, Math.round(sourceTicks)))
    : Math.max(flat.in + 1, Math.round(sourceTicks))
  const shrinks = edge === 'in' ? target > flat.in : target < flat.out
  if (shrinks && isRamped(flat)) {
    const half = trimRamp(flat, edge, target)
    clip.source.in = half.in
    clip.source.out = half.out
    clip.speed = half.speed
    if (half.speedPoints) clip.speedPoints = half.speedPoints
    else delete clip.speedPoints
    clip.timeline.start = Math.max(0, clip.timeline.start + half.shiftTicks)
  } else if (edge === 'in') {
    const delta = target - clip.source.in
    clip.source.in = target
    // A reversed clip consumes source DOWNWARDS, so raising `in` shaves what
    // plays LAST and the clip keeps its position (ADR-027).
    if (!clip.reverse) clip.timeline.start = Math.max(0, clip.timeline.start + Math.round(delta / speed))
  } else {
    const delta = clip.source.out - target
    clip.source.out = target
    if (clip.reverse) clip.timeline.start = Math.max(0, clip.timeline.start + Math.round(delta / speed))
  }
  clip.timeline.duration = Math.max(1, clipDurationTicks(clip))
  return true
}

/**
 * Structural validation. Returns an array of human-readable errors
 * (empty = valid). Intended for Edit Plan validation (docs §38).
 */
export function validateTimeline(timeline) {
  const errors = []
  if (!timeline || typeof timeline !== 'object') return ['timeline must be an object']
  if (timeline.version !== 3) errors.push(`unsupported timeline version: ${timeline.version}`)
  if (!Array.isArray(timeline.tracks)) return [...errors, 'timeline.tracks must be an array']
  const seen = new Set()
  for (const track of timeline.tracks) {
    if (!['video', 'text', 'audio'].includes(track.type)) {
      errors.push(`unknown track type: ${track.type}`)
    }
    for (const item of track.items ?? []) {
      if (!item.id) {
        errors.push('clip without id')
        continue
      }
      if (seen.has(item.id)) errors.push(`duplicate clip id: ${item.id}`)
      seen.add(item.id)
      if (!(item.source?.out > item.source?.in)) {
        errors.push(`clip ${item.id} has empty source range`)
      }
      if (!(item.timeline?.duration > 0)) {
        errors.push(`clip ${item.id} has non-positive duration`)
      }
      if (!(item.speed > 0)) errors.push(`clip ${item.id} has non-positive speed`)
      if (item.timeline?.start < 0) errors.push(`clip ${item.id} has negative start`)
    }
  }
  return errors
}
