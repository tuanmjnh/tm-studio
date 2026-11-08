// =============================================================================
//  tmcut-core — audio
//  Fade in/out + gain math (Roadmap C12). Fades live on the clip as
//  `fade?: { in, out }` in TICKS; volume stays 0..100 (v1 heritage).
//  gainAt returns the linear 0..1 multiplier a player or the mixer applies
//  at a CLIP-LOCAL tick position (0 = clip start).
//
//  Slice J retired the FFmpeg `volume` expression (fade envelope) and the
//  `stereotools` pan filter. `gainAt` is the live law; pan is currently not
//  applied by the Web Audio mixer — a documented gap in the slice J section
//  of docs/audit/zero-ffmpeg-audit.md.
//
//  Clip argument accepts both shapes: v3 (`timeline.duration` ticks) and
//  the legacy v1 flat item (`in`/`out` in SECONDS) — same dual-shape
//  contract as evalKeyframe, so the preview can call it directly.
// =============================================================================

import { secToTicks } from './time.mjs'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Clip duration in ticks for either model shape. */
function durationTicks(clip) {
  const direct = clip?.timeline?.duration
  if (isFiniteNumber(direct) && direct > 0) return direct
  // Legacy v1 flat shape: in/out are SECONDS.
  if (isFiniteNumber(clip?.in) && isFiniteNumber(clip?.out) && clip.out > clip.in) {
    const speed = isFiniteNumber(clip?.speed) && clip.speed > 0 ? clip.speed : 1
    return Math.max(1, Math.round(secToTicks((clip.out - clip.in) / speed)))
  }
  // v3 fallback: derive from the source range (mirrors addClip math).
  const sourceIn = clip?.source?.in ?? 0
  const sourceOut = clip?.source?.out ?? sourceIn
  const speed = isFiniteNumber(clip?.speed) && clip.speed > 0 ? clip.speed : 1
  return Math.max(1, Math.round((Math.max(sourceOut, sourceIn + 1) - sourceIn) / speed))
}

/**
 * Fade length in ticks for 'in'/'out', clamped to half the clip duration
 * (both fades together can never overlap). 0 = no fade on that edge.
 */
export function fadeDuration(clip, edge) {
  if (!clip || typeof clip !== 'object' || (edge !== 'in' && edge !== 'out')) return 0
  const raw = edge === 'in' ? clip.fade?.in : clip.fade?.out
  if (!isFiniteNumber(raw) || raw <= 0) return 0
  return Math.min(raw, Math.floor(durationTicks(clip) / 2))
}

/**
 * Linear gain at a clip-local tick position: volume (0..100 -> 0..1)
 * multiplied by the fade envelope (0..1). Outside the clip reads the
 * clamped edge value. Keyframed volume is the caller's job — spread the
 * evaluated value into `volume` before calling when keyframes exist.
 */
export function gainAt(clip, atTicks) {
  if (!clip || typeof clip !== 'object') return 0
  const duration = durationTicks(clip)
  const at = Math.min(Math.max(0, isFiniteNumber(atTicks) ? atTicks : 0), duration)
  const volumeRaw = isFiniteNumber(clip.volume) ? clip.volume : 100
  const volume = Math.min(1, Math.max(0, volumeRaw / 100))
  const fadeIn = fadeDuration(clip, 'in')
  const fadeOut = fadeDuration(clip, 'out')
  let envelope = 1
  if (fadeIn > 0 && at < fadeIn) envelope = at / fadeIn
  if (fadeOut > 0 && at > duration - fadeOut) {
    envelope = Math.min(envelope, (duration - at) / fadeOut)
  }
  return volume * envelope
}

/**
 * Track-level mute (CapCut-style track header toggle, Roadmap R124 A1).
 * Mute is a TRACK property, not a clip one — it silences every clip on
 * that track at mix time. The render layer decides how to express it
 * (volume=0 on the track's bus, or skipping the track's inputs entirely);
 * this helper is the single source of truth for "is this track silent".
 *
 * @param {{ muted?: boolean }} track
 * @returns {boolean}
 */
export function isTrackMuted(track) {
  return !!track?.muted
}
