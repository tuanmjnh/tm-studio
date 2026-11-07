// =============================================================================
//  tmcut-core — evaluate
//  Timeline evaluation at an absolute tick position (V4 Phase 1 / M1).
//
//  This is the missing "what is on screen at t?" step: it resolves each
//  active clip into a flat, renderer-agnostic layer (source position,
//  transform, opacity, audio gain, mask geometry, media layout, transition
//  role) so a DOM renderer and the FFmpeg compiler can consume ONE answer
//  instead of re-deriving it.
//
//  It draws nothing and knows nothing about pixels: units stay in the DSL
//  v3 contract — ticks for time, 0..1 for opacity/scale/transform, percent
//  (0..100) for volume before it becomes a 0..1 gain. Both stored clip
//  shapes are accepted: DSL v3 (`timeline`/`source`) and the app store's
//  flat model (`offset` + `in`/`out`), so the editor preview and core
//  consumers read one answer.
//
//  Source position honors constant speed, reverse and speed ramps: a ramped
//  clip maps through `rampTimelineToSource` (the same integral the preview
//  and export compiler use), so no caller needs the app's clipTime helper.
//  Text clips also carry their in/out animation state (opacity, slide delta,
//  zoom) resolved at the same tick, so the preview and export read one answer.
// =============================================================================

import { evalKeyframe } from './keyframes.mjs'
import { gainAt } from './audio.mjs'
import { isRamped, rampTimelineToSource, speedAt } from './retime.mjs'
import { resolveClipLayout } from './canvas.mjs'
import { normalizeMask } from './mask.mjs'
import { TICKS_PER_SECOND } from './time.mjs'
import { transitionWindows } from './transitions.mjs'
import { clipSpan } from './timeline.mjs'
import { blendModeOf } from './blend.mjs'

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value, lo, hi) {
  return Math.min(Math.max(value, lo), hi)
}

/**
 * Absolute span of a clip in ticks. DSL v3 keeps it under `timeline`; the
 * app store keeps `offset` + `in`/`out`/`speed` flat — `clipSpan` resolves
 * both so one evaluator serves the editor and core-native projects.
 */
function spanOf(clip) {
  return clipSpan(clip)
}

/**
 * Source range of a clip in ticks: DSL v3 `source.{in,out}` or the app's
 * flat `in`/`out`. Null when the clip carries neither (text/sticker layers).
 *
 * Exported because a caller that reads a file's samples needs to know how far
 * into it any clip reaches (the export's mix leg decodes from media 0 to the
 * furthest out-point). A second copy of this two-shape rule in `app/` is the
 * drift this module exists to prevent.
 */
export function clipSourceRange(clip) {
  if (clip?.source) {
    const inT = finiteOr(clip.source.in, 0)
    return { in: inT, out: finiteOr(clip.source.out, inT) }
  }
  if (typeof clip?.in === 'number' && Number.isFinite(clip.in)) {
    return { in: clip.in, out: finiteOr(clip.out, clip.in) }
  }
  return null
}

/** The internal name, kept so the evaluator reads what callers now share. */
const sourceRangeOf = clipSourceRange

/** Clip-local timeline ticks -> source ticks (speed, ramp and reverse aware). */
function sourceAt(clip, localTicks, duration) {
  const range = sourceRangeOf(clip)
  if (!range) return null
  const inT = range.in
  const outT = range.out
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
 * Mask geometry as the renderers see it. `normalizeMask` is the same call
 * `maskAlphaExpr` (export) and `maskCssMaskImage` (preview) make internally,
 * so publishing its output cannot move a pixel — and a shape neither builder
 * knows becomes `null` here instead of truthy data on the layer.
 */
function maskOf(clip) {
  return normalizeMask(clip.mask)
}

/**
 * Fade envelope only (0..1). `gainAt` already clamps fades to half the clip
 * and reads the v3 `timeline.duration`, so pass a neutral volume and apply
 * the keyframed volume separately.
 */
function envelopeAt(clip, localTicks) {
  return gainAt({ ...clip, volume: 100 }, localTicks)
}

/** Shortest in/out ramp — matches the preview's and export's 0.05 s floor. */
const TEXT_ANIM_MIN_TICKS = TICKS_PER_SECOND / 20

/**
 * Text in/out animation at clip-local ticks: the shared math behind the
 * preview's CSS and the export's drawtext alpha/x/zoom expressions.
 * `animInDuration`/`animOutDuration` are SECONDS (the only seconds field in
 * the clip); each window is clamped to half the clip with a 0.05 s floor.
 * The returned `opacity` is separate from the clip's own opacity — callers
 * multiply both so a keyframed fade is not applied twice.
 *
 * @param {object|null|undefined} clip
 * @param {number} localTicks
 * @param {number} durationTicks clip-local length in ticks
 * @returns {{ opacity: number, deltaX: number, deltaY: number, scale: number }}
 */
export function textAnimationAt(clip, localTicks, durationTicks) {
  const duration = Math.max(0, finiteOr(durationTicks, 0))
  const local = clamp(finiteOr(localTicks, 0), 0, duration)
  const animIn = typeof clip?.animIn === 'string' && clip.animIn !== 'none' ? clip.animIn : null
  const animOut = typeof clip?.animOut === 'string' && clip.animOut !== 'none' ? clip.animOut : null
  const windowOf = seconds => Math.max(
    TEXT_ANIM_MIN_TICKS,
    Math.min(duration / 2, finiteOr(seconds, 0.5) * TICKS_PER_SECOND)
  )
  const inWindow = animIn ? windowOf(clip.animInDuration) : 0
  const outWindow = animOut ? windowOf(clip.animOutDuration) : 0
  const pIn = inWindow > 0 ? clamp(local / inWindow, 0, 1) : 1
  const pOut = outWindow > 0 ? clamp((duration - local) / outWindow, 0, 1) : 1

  const inXDir = animIn === 'slide-left' ? 100 : animIn === 'slide-right' ? -100 : 0
  const outXDir = animOut === 'slide-left' ? -100 : animOut === 'slide-right' ? 100 : 0
  const inYDir = animIn === 'slide-up' ? 60 : animIn === 'slide-down' ? -60 : 0
  const outYDir = animOut === 'slide-up' ? -60 : animOut === 'slide-down' ? 60 : 0
  const scaleIn = animIn === 'zoom-in' ? 0.3 + 0.7 * pIn : animIn === 'zoom-out' ? 1.5 - 0.5 * pIn : 1
  const scaleOut = animOut === 'zoom-out' ? 0.3 + 0.7 * pOut : animOut === 'zoom-in' ? 1.5 - 0.5 * pOut : 1

  return {
    opacity: Math.min(animIn ? pIn : 1, animOut ? pOut : 1),
    deltaX: inXDir * (1 - pIn) + outXDir * (1 - pOut),
    deltaY: inYDir * (1 - pIn) + outYDir * (1 - pOut),
    scale: scaleIn * scaleOut
  }
}

function textOf(clip, localTicks, durationTicks) {
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
    shadowColor: typeof clip.shadowColor === 'string' ? clip.shadowColor : null,
    strokeColor: typeof clip.strokeColor === 'string' ? clip.strokeColor : null,
    bgColor: typeof clip.bgColor === 'string' ? clip.bgColor : null,
    animIn: clip.animIn ?? 'none',
    animInDuration: finiteOr(clip.animInDuration, 0),
    animOut: clip.animOut ?? 'none',
    animOutDuration: finiteOr(clip.animOutDuration, 0),
    animation: textAnimationAt(clip, localTicks, durationTicks)
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
    // The authored media-clock rate at this tick (curve value, or the constant).
    // A host that seeks by `sourceTicks` must run its element at THIS number, or
    // the corrective seek fires every frame — one answer for picture and sound.
    sourceRate: speedAt(clip, localTicks),
    reverse: clip.reverse === true,
    visible: track?.hidden !== true && visual.opacity > 0,
    opacity: visual.opacity,
    volume: clamp(gain, 0, 1),
    audible: track?.muted !== true && gain > 0,
    transform: visual.transform,
    effects: Array.isArray(clip.effects) ? clip.effects.map(effect => ({ ...effect })) : [],
    mask: maskOf(clip),
    layout: resolveClipLayout(clip),
    blend: blendModeOf(clip),
    transition: transitionOf(transitionAt(windows, clip.id, at), clipsById),
    text: textOf(clip, localTicks, span.duration),
    ramped: isRamped(clip),
    groupId: clip.groupId ?? null,
    linkId: clip.linkId ?? null
  }
}

/**
 * The rows of a project, a timeline, or a bare `{ tracks }` object.
 *
 * Three shapes reach this module and the ones that join it: the store's project
 * (`project.timeline.tracks`), a DSL v3 timeline (`timeline.tracks`), and the
 * flat `{ tracks }` shape core's own tests and callers build. Four private
 * copies of this resolution already lived in core (`evaluate`, `scheduler`,
 * `paintStack`, `exportContent`); it is exported because `app/` needs a fifth
 * answer and a fifth copy is where the export stopped finding the row it was
 * meant to paint.
 *
 * Always a list: a caller that walks the answer should not also have to answer
 * "was there a project at all" before its `for` loop.
 */
export function projectTracks(input) {
  if (input && Array.isArray(input.tracks)) return input.tracks
  const timeline = input?.timeline
  return Array.isArray(timeline?.tracks) ? timeline.tracks : []
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
  const at = Math.max(0, Math.round(finiteOr(atTicks, 0)))
  const layers = []
  const tracks = []

  for (const track of projectTracks(input)) {
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
