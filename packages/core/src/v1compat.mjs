// =============================================================================
//  @tmcut/core — v1compat
//  Transitional bridge between the app's flat timeline shape (numeric
//  opacity/scale, path srcs) and the DSL v3 engine (integer ticks,
//  rational transforms, assetId+locator). Structural typing only — no app
//  imports, so the core stays dependency-free. DELETE after the app state
//  migrates to v3 natively.
//
//  C16-R3: two conversion flavors share one structural core:
//   - SECONDS: legacy flat items (float seconds) — used ONLY for file
//     migration (opening pre-C16-R3 project files, recovery copies).
//   - TICKS:   live store (integer ticks) — the app store now holds
//     in/out/offset natively in ticks, so the per-edit bridge is
//     identity on time fields (no double conversion, ulp-noise free).
// =============================================================================

import { secToTicks, ticksToSec, TICKS_PER_SECOND } from './time.mjs'

const EPS = 1e-6

function round4(value) {
  return Math.round(value * 10000) / 10000
}

function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ---- Time-field converters (the ONLY difference between the bridges) ----

const SECONDS = {
  // flat seconds -> v3 source ticks (legacy files)
  toSource: value => Math.max(0, secToTicks(num(value))),
  // v3 ticks -> flat seconds (legacy files, 4-decimal rounding)
  fromSource: ticks => round4(ticksToSec(ticks)),
  defaultOut: 5
}

const TICKS = {
  // flat ticks -> v3 source ticks (identity, rounded to integer)
  toSource: value => Math.max(0, Math.round(num(value))),
  // v3 ticks -> flat ticks (identity, rounded to integer)
  fromSource: ticks => Math.round(ticks),
  defaultOut: 5 * TICKS_PER_SECOND
}

function clipToV3(item, trackType, conv) {
  const speed = num(item.speed, 1) > 0 ? num(item.speed, 1) : 1
  const sourceIn = Math.max(0, conv.toSource(item.in))
  const sourceOut = Math.max(sourceIn + 1, conv.toSource(item.out ?? conv.defaultOut))
  const scale = num(item.scale, 100) / 100
  const opacity = num(item.opacity, 100)
  return {
    id: item.id,
    type: trackType,
    name: item.name ?? item.text ?? 'Clip',
    assetId: null,
    locator: item.src ? { runtime: 'electron', path: item.src } : null,
    source: { in: sourceIn, out: sourceOut },
    timeline: {
      start: Math.max(0, Math.round(conv.toSource(item.offset ?? 0))),
      duration: Math.max(1, Math.round((sourceOut - sourceIn) / speed))
    },
    speed,
    reverse: item.reverse ?? false,
    groupId: item.groupId ?? null,
    linkId: item.linkId ?? null,
    transform: {
      x: num(item.x),
      y: num(item.y),
      scaleX: scale,
      scaleY: scale,
      rotation: num(item.rotation),
      opacity: Math.min(1, Math.max(0, opacity > 1 ? opacity / 100 : opacity))
    },
    fit: item.fit,
    focusX: item.focusX,
    focusY: item.focusY,
    cropRect: item.cropRect,
    volume: item.volume,
    text: item.text,
    color: item.color,
    fontSize: item.fontSize,
    fontFamily: item.fontFamily,
    fontFile: item.fontFile,
    bold: item.bold,
    italic: item.italic,
    align: item.align,
    shadow: item.shadow,
    stroke: item.stroke,
    effects: Array.isArray(item.effects) ? item.effects : [],
    keyframes: Array.isArray(item.keyframes) ? item.keyframes : [],
    transitionIn: item.transitionIn,
    fade: item.fade,
    animIn: item.animIn,
    animInDuration: item.animInDuration,
    animOut: item.animOut,
    animOutDuration: item.animOutDuration,
    stabilize: item.stabilize,
    stabilizeLevel: item.stabilizeLevel,
    stabilizedPath: item.stabilizedPath,
    stabilizeStatus: item.stabilizeStatus
  }
}

/** Legacy v1 (seconds) track list -> v3 timeline (file migration path). */
export function v1TracksToV3(tracks) {
  return tracksToV3(tracks, SECONDS)
}

/** C16-R3: live store (ticks) track list -> v3 timeline (per-edit path). */
export function ticksTracksToV3(tracks) {
  return tracksToV3(tracks, TICKS)
}

function tracksToV3(tracks, conv) {
  return {
    version: 3,
    tracks: (tracks ?? []).map(track => ({
      id: track.id,
      type: track.type,
      name: track.name,
      muted: track.muted,
      locked: track.locked,
      hidden: track.hidden,
      items: (track.items ?? []).map(item => clipToV3(item, track.type, conv))
    })),
    markers: []
  }
}

/** Legacy v1 (seconds) clip -> v3 clip (structural, any object with flat fields). */
export function v1ClipToV3(item, trackType) {
  return clipToV3(item, trackType, SECONDS)
}

/** C16-R3: ticks clip -> v3 clip. */
export function ticksClipToV3(item, trackType) {
  return clipToV3(item, trackType, TICKS)
}

function v3ClipToFlat(clip, conv) {
  const patch = {
    id: clip.id,
    name: clip.name,
    src: clip.locator?.path,
    text: clip.text,
    color: clip.color,
    fontSize: clip.fontSize,
    fontFamily: clip.fontFamily,
    fontFile: clip.fontFile,
    bold: clip.bold,
    italic: clip.italic,
    align: clip.align,
    shadow: clip.shadow,
    stroke: clip.stroke,
    in: conv.fromSource(clip.source.in),
    out: conv.fromSource(clip.source.out),
    offset: conv.fromSource(clip.timeline.start),
    speed: clip.speed,
    reverse: clip.reverse ?? false,
    opacity: round4(clip.transform.opacity * 100),
    scale: round4(((clip.transform.scaleX + clip.transform.scaleY) / 2) * 100),
    x: round4(clip.transform.x),
    y: round4(clip.transform.y),
    rotation: clip.transform.rotation,
    volume: clip.volume,
    fit: clip.fit,
    focusX: clip.focusX,
    focusY: clip.focusY,
    cropRect: clip.cropRect,
    effects: clip.effects ?? [],
    keyframes: clip.keyframes ?? [],
    transitionIn: clip.transitionIn,
    fade: clip.fade,
    animIn: clip.animIn,
    animInDuration: clip.animInDuration,
    animOut: clip.animOut,
    animOutDuration: clip.animOutDuration,
    stabilize: clip.stabilize,
    stabilizeLevel: clip.stabilizeLevel,
    stabilizedPath: clip.stabilizedPath,
    stabilizeStatus: clip.stabilizeStatus,
    groupId: clip.groupId ?? null,
    linkId: clip.linkId ?? null
  }
  return patch
}

/** v3 clip -> legacy v1 (seconds) field patch. */
export function v3ClipToV1(clip) {
  return v3ClipToFlat(clip, SECONDS)
}

/** C16-R3: v3 clip -> ticks field patch (identity time round-trip). */
export function v3ClipToTicks(clip) {
  return v3ClipToFlat(clip, TICKS)
}

const COMPARE_NUMBERS = ['in', 'out', 'offset', 'speed', 'opacity', 'scale', 'x', 'y', 'rotation', 'volume', 'fontSize', 'focusX', 'focusY', 'animInDuration', 'animOutDuration']
// groupId/linkId must be compared or relation-only core edits (C9
// grouping) get silently dropped by the sync step.
// fontFamily/fontFile (C-1) must be compared so a font-only edit syncs
// back AND split/paste/duplicate clones (which copy the v3 clip verbatim)
// keep the picked face on their new flat items.
const COMPARE_STRINGS = ['name', 'src', 'text', 'color', 'fit', 'groupId', 'linkId', 'fontFamily', 'fontFile', 'align', 'animIn', 'animOut', 'stabilizeLevel', 'stabilizedPath', 'stabilizeStatus']
// Text style flags (C-2): undefined and false compare EQUAL — flat items
// from older projects lack the keys, so a strict compare would rewrite
// every untouched clip on open. `reverse` is here too: flat items often
// lack it (undefined) while v3 normalizes to false, so treat undefined
// as false — a real reverse toggle must sync back (R74).
const COMPARE_FLAGS = ['bold', 'italic', 'shadow', 'stroke', 'stabilize', 'reverse']

// Deep-compare effect arrays so an effects-only edit syncs back (R74).
function sameEffects(a, b) {
  const arrA = Array.isArray(a) ? a : []
  const arrB = Array.isArray(b) ? b : []
  if (arrA.length !== arrB.length) return false
  for (let i = 0; i < arrA.length; i++) {
    if (arrA[i].type !== arrB[i].type) return false
    const pa = arrA[i].params || {}
    const pb = arrB[i].params || {}
    const keysA = Object.keys(pa).sort()
    const keysB = Object.keys(pb).sort()
    if (keysA.length !== keysB.length) return false
    for (const k of keysA) {
      if (!sameValue(pa[k], pb[k])) return false
    }
  }
  return true
}

// Deep-compare keyframe arrays so a keyframe-only edit syncs back (R74).
function sameKeyframes(a, b) {
  const arrA = Array.isArray(a) ? a : []
  const arrB = Array.isArray(b) ? b : []
  if (arrA.length !== arrB.length) return false
  for (let i = 0; i < arrA.length; i++) {
    if (!sameValue(arrA[i].t, arrB[i].t)) return false
    if (arrA[i].prop !== arrB[i].prop) return false
    if (!sameValue(arrA[i].value, arrB[i].value)) return false
  }
  return true
}

function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= EPS
  return a === b
}

function sameTransition(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.type !== b.type) return false
  return sameValue(num(a.duration, 0), num(b.duration, 0))
}

// fade is an object { in, out } (both TICKS): compared explicitly so
// CLEARING a fade syncs back (R38/C12), same reasoning as transitionIn.
function sameFade(a, b) {
  const aIn = num(a?.in, 0)
  const aOut = num(a?.out, 0)
  const bIn = num(b?.in, 0)
  const bOut = num(b?.out, 0)
  const aSet = aIn > 0 || aOut > 0
  const bSet = bIn > 0 || bOut > 0
  if (aSet !== bSet) return false
  if (!aSet) return true
  return sameValue(aIn, bIn) && sameValue(aOut, bOut)
}

function sameCropRect(a, b) {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  return sameValue(num(a.x, 0), num(b.x, 0))
    && sameValue(num(a.y, 0), num(b.y, 0))
    && sameValue(num(a.w, 1), num(b.w, 1))
    && sameValue(num(a.h, 1), num(b.h, 1))
}

/** True when a flat item already matches a v3 clip (untouched clips skip). */
export function v1MatchesV3(item, clip) {
  return matchesV3(item, clip, SECONDS)
}

/** C16-R3: ticks-native match check. */
export function ticksMatchesV3(item, clip) {
  return matchesV3(item, clip, TICKS)
}

function matchesV3(item, clip, conv) {
  const patch = v3ClipToFlat(clip, conv)
  for (const key of COMPARE_NUMBERS) {
    if (!sameValue(num(item[key], 0), num(patch[key], 0))) return false
  }
  for (const key of COMPARE_STRINGS) {
    if ((item[key] ?? null) !== (patch[key] ?? null)) return false
  }
  for (const key of COMPARE_FLAGS) {
    if ((item[key] ?? false) !== (patch[key] ?? false)) return false
  }
  // transitionIn is an object { type, duration } (duration in TICKS):
  // compared explicitly so CLEARING a transition syncs back even when the
  // restored offset round-trips to the same value (R34/B3).
  if (!sameTransition(item.transitionIn, patch.transitionIn)) return false
  // fade { in, out } in TICKS: a fade the user clears must sync back
  // even when no numeric field changed (R38/C12).
  if (!sameFade(item.fade, patch.fade)) return false
  // cropRect { x, y, w, h }: compared explicitly so crop adjustments sync back (R67/F-3).
  if (!sameCropRect(item.cropRect, patch.cropRect)) return false
  // effects[]: deep-compared so an effects-only edit syncs back (R74).
  if (!sameEffects(item.effects, patch.effects)) return false
  // keyframes[]: deep-compared so a keyframe-only edit syncs back (R74).
  if (!sameKeyframes(item.keyframes, patch.keyframes)) return false
  return true
}

/**
 * Merge a mutated v3 timeline back into flat tracks (matched by id).
 * Untouched clips are NOT rewritten (epsilon compare); new ids are
 * appended (creating tracks when the v3 track is unknown); ids absent
 * from v3 are removed, and so are flat tracks whose id no longer exists
 * in v3 (track add/remove flows through here). Returns
 * { added, updated, removed } for clips.
 */
export function syncV3Result(v1Tracks, afterV3) {
  return syncResult(v1Tracks, afterV3, SECONDS)
}

/** C16-R3: ticks-native merge back into the live store. */
export function syncTicksResult(v1Tracks, afterV3) {
  return syncResult(v1Tracks, afterV3, TICKS)
}

function syncResult(flatTracks, afterV3, conv) {
  const stats = { added: 0, updated: 0, removed: 0 }
  const flatById = new Map()
  for (const track of flatTracks ?? []) {
    for (let index = 0; index < (track.items ?? []).length; index += 1) {
      flatById.set(track.items[index].id, { track, index })
    }
  }
  const v3Ids = new Set()
  for (const v3Track of afterV3?.tracks ?? []) {
    let flatTrack = (flatTracks ?? []).find(track => track.id === v3Track.id)
    if (!flatTrack) {
      flatTrack = { id: v3Track.id, type: v3Track.type, name: v3Track.name ?? v3Track.type, items: [] }
      flatTracks.push(flatTrack)
    }
    // Sync track-level flags (muted/locked/hidden) from v3 so a track
    // toggle survives the live round-trip (R74). Flat items often lack
    // these keys, so treat undefined as false.
    const trackPatch = {}
    if (v3Track.muted !== undefined) trackPatch.muted = !!v3Track.muted
    if (v3Track.locked !== undefined) trackPatch.locked = !!v3Track.locked
    if (v3Track.hidden !== undefined) trackPatch.hidden = !!v3Track.hidden
    if (Object.keys(trackPatch).length > 0) {
      Object.assign(flatTrack, trackPatch)
    }
    for (const clip of v3Track.items ?? []) {
      v3Ids.add(clip.id)
      const location = flatById.get(clip.id)
      if (!location) {
        flatTrack.items.push(v3ClipToFlat(clip, conv))
        stats.added += 1
      } else if (!matchesV3(location.track.items[location.index], clip, conv)) {
        Object.assign(location.track.items[location.index], v3ClipToFlat(clip, conv))
        stats.updated += 1
      }
    }
  }
  for (const track of flatTracks ?? []) {
    for (let index = (track.items ?? []).length - 1; index >= 0; index -= 1) {
      if (!v3Ids.has(track.items[index].id)) {
        track.items.splice(index, 1)
        stats.removed += 1
      }
    }
  }
  const v3TrackIds = new Set((afterV3?.tracks ?? []).map(track => track.id))
  for (let index = (flatTracks ?? []).length - 1; index >= 0; index -= 1) {
    if (!v3TrackIds.has(flatTracks[index].id)) flatTracks.splice(index, 1)
  }
  return stats
}
