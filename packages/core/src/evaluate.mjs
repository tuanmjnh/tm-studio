// =============================================================================
//  @tmcut/core — evaluate
//  Timeline evaluation at an absolute tick position (V4 Phase 1 / M1).
//
//  This is the missing "what is on screen at t?" step: it resolves each
//  active clip into a flat, renderer-agnostic layer (source position,
//  transform, opacity, audio gain, transition role) so a DOM renderer and
//  the FFmpeg compiler can consume ONE answer instead of re-deriving it.
//
//  It draws nothing and knows nothing about pixels: units stay in the DSL
//  v3 contract — ticks for time, 0..1 for opacity/scale/transform, percent
//  (0..100) for volume before it becomes a 0..1 gain.
//
//  Source position honors constant speed, reverse and speed ramps: a ramped
//  clip maps through `rampTimelineToSource` (the same integral the preview
//  and export compiler use), so no caller needs the app's clipTime helper.
// =============================================================================

import { evalKeyframe } from './keyframes.mjs'
import { gainAt } from './audio.mjs'
import { isRamped, rampTimelineToSource } from './retime.mjs'
import { transitionWindows } from './transitions.mjs'

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), hi)
}

/** Absolute span of a v3 clip in ticks. Non-positive durations are empty. */
function spanOf(clip) {
  const start = finiteOr(clip?.timeline?.start, 0)
  const duration = Math.max(0, finiteOr(clip?.timeline?.duration, 0))
  return { start, duration, end: start + duration }
}

/** Clip-local timeline ticks -> source ticks (speed, ramp and reverse aware). */
function sourceAt(clip, localTicks, duration) {
  if (!clip?.source) return null
  const inT = finiteOr(clip.source.in, 0)
  const outT = finiteOr(clip.source.out, inT)
  const local = clamp(localTicks, 0, duration)
  const lo = Math.min(inT, outT)
  const hi = Math.max(inT, outT)
  const speed = finiteOr(clip.speed, 1) > 0 ? finiteOr(clip.speed, 1) : 1
  const source = isRamped(clip)
    ? rampTimelineToSource({ in: inT, out: outT, reverse: clip.reverse === true, speed: clip.speed, speedPoints: clip.speedPoints }, local)
    : clip.reverse ? outT - local * speed : inT + local * speed
  return clamp(source, lo, hi)
}

/**
 * Flat app-model value (v1 heritage) when the clip carries it. The app store
 * keeps `scale`/`opacity`/`x`/`y`/`rotation` flat and in percent or canvas px;
 * DSL v3 keeps them under `transform`. Flat wins because a flat field only
 * appears when a caller supplied the app shape (migrateV1ToV3 folds it into
 * `transform`), so an untouched `transform` default never masks it.
 */
function flatOr(clip, key) {
  return typeof clip?.[key] === 'number' && Number.isFinite(clip[key]) ? clip[key] : undefined
}

/** Keyframed scale (legacy `scale` is percent, `scaleX/Y` are multipliers). */
function scaleOf(clip, localTicks) {
  const transform = clip.transform || {}
  const legacy = evalKeyframe(clip, 'scale', localTicks)
  const keyedX = evalKeyframe(clip, 'scaleX', localTicks)
  const keyedY = evalKeyframe(clip, 'scaleY', localTicks)
  const flat = flatOr(clip, 'scale')
  const baseX = flat === undefined ? finiteOr(transform.scaleX, 1) : flat / 100
  const baseY = flat === undefined ? finiteOr(transform.scaleY, 1) : flat / 100
  return {
    scaleX: keyedX ?? (legacy === undefined ? baseX : legacy / 100),
    scaleY: keyedY ?? (legacy === undefined ? baseY : legacy / 100)
  }
}

/** Opacity as 0..1; legacy flat `opacity` and its keyframes are percent. */
function opacityOf(clip, localTicks) {
  const transform = clip.transform || {}
  const keyed = evalKeyframe(clip, 'opacity', localTicks)
  if (keyed !== undefined) return clamp(keyed / 100, 0, 1)
  const flat = flatOr(clip, 'opacity')
  const base = flat !== undefined ? flat / 100 : finiteOr(transform.opacity, 1)
  return clamp(base, 0, 1)
}

function transformOf(clip, localTicks) {
  const transform = clip.transform || {}
  const { scaleX, scaleY } = scaleOf(clip, localTicks)
  return {
    x: evalKeyframe(clip, 'x', localTicks) ?? flatOr(clip, 'x') ?? finiteOr(transform.x, 0),
    y: evalKeyframe(clip, 'y', localTicks) ?? flatOr(clip, 'y') ?? finiteOr(transform.y, 0),
    scaleX,
    scaleY,
    rotation: evalKeyframe(clip, 'rotation', localTicks)
      ?? flatOr(clip, 'rotation')
      ?? finiteOr(transform.rotation, 0)
  }
}

/** Volume percent (0..100) including its keyframes. */
function volumeOf(clip, localTicks) {
  const keyed = evalKeyframe(clip, 'volume', localTicks)
  return clamp(keyed ?? finiteOr(clip.volume, 100), 0, 100)
}

/**
 * Fade envelope only (0..1). `gainAt` already clamps fades to half the clip
 * and reads the v3 `timeline.duration`, so pass a neutral volume and apply
 * the keyframed volume separately.
 */
function envelopeAt(clip, localTicks) {
  return gainAt({ ...clip, volume: 100 }, localTicks)
}

function textOf(clip) {
  if (clip?.type !== 'text' && !clip?.text) return null
  return {
    content: clip.text ?? '',
    color: clip.color ?? null,
    fontSize: finiteOr(clip.fontSize, 0) || null,
    fontFamily: clip.fontFamily ?? null,
    fontFile: clip.fontFile ?? null,
    bold: clip.bold === true,
    italic: clip.italic === true,
    align: clip.align ?? 'center',
    shadow: clip.shadow === true,
    stroke: clip.stroke === true,
    animIn: clip.animIn ?? 'none',
    animInDuration: finiteOr(clip.animInDuration, 0),
    animOut: clip.animOut ?? 'none',
    animOutDuration: finiteOr(clip.animOutDuration, 0)
  }
}

/**
 * One clip's visual/audio state at clip-local ticks. Same math as a layer of
 * `evaluateTimeline`, exposed for per-clip callers (preview layers, inspector
 * badges, thumbnails) that do not build a timeline.
 *
 * @param {object|null|undefined} clip
 * @param {number} localTicks
 * @returns {{ opacity: number, volume: number, transform: object }}
 *   `opacity` 0..1, `volume` percent 0..100 (fade envelope not applied).
 */
export function evaluateClip(clip, localTicks) {
  const at = finiteOr(localTicks, 0)
  return {
    opacity: opacityOf(clip, at),
    volume: volumeOf(clip, at),
    transform: transformOf(clip, at)
  }
}

function transitionAt(overlaps, clipId, at) {
  for (const overlap of overlaps) {
    if (at < overlap.startTicks || at >= overlap.endTicks) continue
    const span = overlap.endTicks - overlap.startTicks
    const progress = span > 0 ? (at - overlap.startTicks) / span : 1
    if (overlap.toId === clipId) return { overlap, progress, role: 'incoming' }
    if (overlap.fromId === clipId) return { overlap, progress, role: 'outgoing' }
  }
  return null
}

/**
 * Both clips of an overlap share ONE transition spec: the incoming clip owns
 * `transitionIn`, and that is the effect being scrubbed — the outgoing layer
 * must report the same type or renderers would fade one side only.
 */
function transitionOf(hit, clipsById) {
  if (!hit) return null
  const incoming = clipsById.get(hit.overlap.toId)
  const spec = incoming?.transitionIn
  return {
    type: typeof spec?.type === 'string' ? spec.type : null,
    duration: finiteOr(spec?.duration, hit.overlap.endTicks - hit.overlap.startTicks),
    role: hit.role,
    progress: hit.progress
  }
}

function layerFor(clip, track, at, windows, clipsById) {
  const span = spanOf(clip)
  const localTicks = at - span.start
  const visual = evaluateClip(clip, localTicks)
  const trackVolume = clamp(finiteOr(track?.volume, 100), 0, 100)
  const gain = (visual.volume / 100) * (trackVolume / 100) * envelopeAt(clip, localTicks)
  return {
    clipId: clip.id,
    trackId: track?.id ?? null,
    trackType: track?.type ?? clip.type ?? 'video',
    kind: clip.type ?? track?.type ?? 'video',
    startTicks: span.start,
    endTicks: span.end,
    localTicks,
    sourceTicks: sourceAt(clip, localTicks, span.duration),
    visible: track?.hidden !== true && visual.opacity > 0,
    opacity: visual.opacity,
    volume: clamp(gain, 0, 1),
    audible: track?.muted !== true && gain > 0,
    transform: visual.transform,
    effects: Array.isArray(clip.effects) ? clip.effects.map(effect => ({ ...effect })) : [],
    mask: clip.mask ?? null,
    transition: transitionOf(transitionAt(windows, clip.id, at), clipsById),
    text: textOf(clip),
    ramped: isRamped(clip),
    groupId: clip.groupId ?? null,
    linkId: clip.linkId ?? null
  }
}

/**
 * Resolve every clip that is live at `atTicks`.
 *
 * @param {{ timeline?: object } | { tracks: object[] }} input project or timeline
 * @param {number} atTicks absolute timeline ticks
 * @returns {{ at: number, layers: object[], tracks: object[] }}
 *   `layers` is draw order (track order, then clip start time). Each layer
 *   is a plain object so it can cross a worker/postMessage boundary.
 */
export function evaluateTimeline(input, atTicks) {
  const timeline = input && Array.isArray(input.tracks) ? input : input?.timeline
  const at = Math.max(0, Math.round(finiteOr(atTicks, 0)))
  const layers = []
  const tracks = []

  for (const track of Array.isArray(timeline?.tracks) ? timeline.tracks : []) {
    const windows = transitionWindows(track)
    const items = (Array.isArray(track?.items) ? track.items : [])
      .map((clip, index) => ({ clip, index, start: spanOf(clip).start }))
      .sort((a, b) => a.start - b.start || a.index - b.index)

    const clipsById = new Map(items.map(({ clip }) => [clip.id, clip]))
    const live = []
    for (const { clip } of items) {
      const span = spanOf(clip)
      if (!(span.duration > 0)) continue
      if (at < span.start || at >= span.end) continue
      const layer = layerFor(clip, track, at, windows, clipsById)
      live.push(layer)
      layers.push(layer)
    }

    tracks.push({
      id: track?.id ?? null,
      type: track?.type ?? null,
      muted: track?.muted === true,
      hidden: track?.hidden === true,
      locked: track?.locked === true,
      layers: live
    })
  }

  return { at, layers, tracks }
}
