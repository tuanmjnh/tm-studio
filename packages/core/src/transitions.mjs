// =============================================================================
//  @tmcut/core — transitions (Roadmap C5)
//  Pure transition operations on plain Timeline DSL v3 objects.
//
//  Overlap model: a transition attaches to the FOLLOWING clip as
//  `transitionIn = { type, duration }` (ticks) and the helper looks up the
//  clip immediately before it. Applying shifts the clip left by `duration`
//  so its head genuinely overlaps the neighbor's tail — the only model with
//  continuous playback on BOTH layers (no position jump at the window
//  edges). Clearing shifts the clip back right by exactly the stored
//  duration, restoring the original cut position. Only the clip carrying
//  the transition moves; later clips on the track stay put (the gap after
//  it widens by the same amount, so re-applying with a new duration is a
//  pure local swap — positions outside the pair never change).
//
//  Lock-aware per the core convention: locked tracks refuse apply/clear
//  with reason 'locked' (a documented extension of the spec's reason
//  union — the core never mutates locked tracks).
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import { clipDurationTicks, clipEndTicks, findClip } from './timeline.mjs'

// The 6 original keys keep their order and semantics (stored projects).
// The 39 keys added in R128 are the remaining FFmpeg `xfade` transition
// names (alphabetical): the renderer maps any of them straight to
// `xfade=transition=<name>` — see the app-side catalog (fxCatalog.ts)
// for the UI categories and the legacy-name aliases (wipe-left -> wipeleft…).
export const KNOWN_TRANSITIONS = [
  'fade',
  'dissolve',
  'wipe-left',
  'wipe-right',
  'slide-left',
  'zoom-in',
  'circleclose',
  'circlecrop',
  'circleopen',
  'diagbl',
  'diagbr',
  'diagtl',
  'diagtr',
  'distance',
  'fadeblack',
  'fadegrays',
  'fadewhite',
  'hblur',
  'hlslice',
  'hrslice',
  'horzclose',
  'horzopen',
  'pixelize',
  'radial',
  'rectcrop',
  'slidedown',
  'slideright',
  'slideup',
  'smoothdown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'squeezeh',
  'squeezev',
  'vertclose',
  'vertopen',
  'vdslice',
  'vuslice',
  'wipebl',
  'wipebr',
  'wipedown',
  'wipetl',
  'wipetr',
  'wipeup',
  'zoomin'
]

// Positions round-trip through the app's v1 seconds model (1e-4 s grid),
// so adjacency is checked with a 1 ms tolerance instead of exact ticks.
const ADJACENCY_EPS = TICKS_PER_SECOND / 1000

/**
 * The cut position the neighbor must touch. A clip that already carries a
 * transition sits `duration` ticks LEFT of the original cut, so the
 * "un-shifted" view adds the stored duration back before checking.
 */
function effectiveStart(clip) {
  const stored = clip.transitionIn?.duration
  const existing = typeof stored === 'number' && stored > 0 ? stored : 0
  return clip.timeline.start + existing
}

/**
 * Validate a transition before applying it (Roadmap C5).
 * `durationTicks` is the requested overlap. Reasons:
 *  - 'no-neighbor'   clip id unknown, or no clip ends at the cut
 *  - 'gap'           a clip precedes it but does not touch the cut
 *  - 'too-long'      duration <= 0, or longer than either clip of the pair
 *  - 'unknown-type'  type outside KNOWN_TRANSITIONS
 *  - 'locked'        the clip sits on a locked track (extension, see header)
 * When ok, `overlapTicks` echoes the duration that would be created.
 */
export function canApplyTransition(timeline, clipId, type, durationTicks) {
  const found = findClip(timeline, clipId)
  if (!found) return { ok: false, reason: 'no-neighbor' }
  if (found.track.locked) return { ok: false, reason: 'locked' }
  if (!KNOWN_TRANSITIONS.includes(type)) return { ok: false, reason: 'unknown-type' }
  if (!(durationTicks > 0)) return { ok: false, reason: 'too-long' }

  const cut = effectiveStart(found.clip)
  // Neighbor = the clip on this track ending closest before the cut.
  let neighbor = null
  for (const other of found.track.items) {
    if (other.id === clipId) continue
    const end = clipEndTicks(other)
    if (end > cut + ADJACENCY_EPS) continue
    if (!neighbor || end > clipEndTicks(neighbor)) neighbor = other
  }
  if (!neighbor) return { ok: false, reason: 'no-neighbor' }
  if (cut - clipEndTicks(neighbor) > ADJACENCY_EPS) return { ok: false, reason: 'gap' }

  const maxOverlap = Math.min(clipDurationTicks(neighbor), clipDurationTicks(found.clip))
  if (durationTicks > maxOverlap) return { ok: false, reason: 'too-long' }
  return { ok: true, overlapTicks: durationTicks }
}

/**
 * Apply `transitionIn` on the clip and shift it left by `durationTicks`
 * to create the overlap. Re-applying first restores the previous shift, so
 * the stored duration always equals the live shift. Returns false and
 * leaves the timeline untouched on any validation failure.
 */
export function applyTransition(timeline, clipId, type, durationTicks) {
  const check = canApplyTransition(timeline, clipId, type, durationTicks)
  if (!check.ok) return false
  const { clip } = findClip(timeline, clipId)
  // Drop the old shift first (re-apply with a new type/duration).
  const oldDuration = clip.transitionIn?.duration
  if (typeof oldDuration === 'number' && oldDuration > 0) {
    clip.timeline.start += oldDuration
  }
  clip.timeline.start = Math.max(0, clip.timeline.start - durationTicks)
  clip.transitionIn = { type, duration: Math.round(durationTicks) }
  return true
}

/**
 * Remove the transition and shift the clip back right by the stored
 * duration (restores the original cut). False when the clip is missing,
 * locked, or has no transition.
 */
export function clearTransition(timeline, clipId) {
  const found = findClip(timeline, clipId)
  if (!found || found.track.locked) return false
  const duration = found.clip.transitionIn?.duration
  if (!(typeof duration === 'number' && duration > 0)) return false
  found.clip.timeline.start += duration
  delete found.clip.transitionIn
  return true
}

/**
 * Overlap windows of one track: for every clip carrying a transition,
 * the region where both clips are live (`startTicks` = the clip's shifted
 * start, `endTicks` = the original cut = the neighbor's end). Pairs broken
 * by later edits (the neighbor no longer ends at the window end) are
 * skipped — they have no valid overlap region. Sorted by position.
 */
export function transitionWindows(track) {
  const items = Array.isArray(track?.items) ? track.items : []
  const windows = []
  for (const clip of items) {
    const duration = clip.transitionIn?.duration
    if (!(typeof duration === 'number' && duration > 0)) continue
    const startTicks = clip.timeline.start
    const endTicks = startTicks + duration
    const outgoing = items.find(other =>
      other.id !== clip.id && Math.abs(clipEndTicks(other) - endTicks) <= ADJACENCY_EPS)
    if (!outgoing) continue
    windows.push({ fromId: outgoing.id, toId: clip.id, startTicks, endTicks })
  }
  return windows.sort((a, b) => a.startTicks - b.startTicks)
}
