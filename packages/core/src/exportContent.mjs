// =============================================================================
//  tmcut-core — export content
//  Which projects the WebCodecs exporter may paint, and the grid it paints them
//  on (Zero-FFmpeg slice H3d).
//
//  H3c proved the seam can turn samples into a file. It said nothing about which
//  projects the app may hand it, and the answer is not "all of them": the preview
//  composites with DOM surfaces, while a WebCodecs export has to paint each frame
//  itself, and one `drawImage` of the decoded plate covers only part of what a
//  project can ask for. So the difference is decided here, once, as a named list
//  of reasons — not guessed by a caller that would rather not fail.
//
//  The law is the exporter's, not the evaluator's: `evaluateTimeline` stays
//  renderer-agnostic and keeps answering "what is live at t" for everything a
//  project can hold. What lives here is a question about ONE renderer — can the
//  file painter make this pixel — read over the whole timeline rather than one
//  tick. Each reason names a feature the DOM preview (and the FFmpeg chain)
//  implements and the canvas painter does not yet have a measured twin for, so
//  adding a mode to the painter means adding a line here, in the same commit.
//
//  Two consequences follow from that framing, and both are load-bearing:
//  - The check reads the AUTHORED fields, the same ones `evaluateTimeline` reads,
//    so the preview and this verdict cannot disagree about what a clip asks for.
//    Where core already normalizes a field — `blendModeOf`, `normalizeMask`,
//    `resolveClipLayout` — this module calls that helper instead of re-deriving
//    it, because a second rule could only drift from the first.
//  - A refusal is complete: every reason in the project is named, in sorted
//    order. "Fix this one thing" would make the user fix one and re-fail on the
//    next, and the copy would be a guess.
//
//  What is NOT here on purpose: the even-dimension rule (`planEncodePresets`
//  refuses it, and this module's request feeds straight into that), the frame
//  grid (`createFrameScheduler` counts it), and which rows paint at all
//  (`selectFileRows` selects them). Duplicating any of those would create the
//  two-answers bug this whole slice exists to close.
// =============================================================================

import { isTrackMuted } from './audio.mjs'
import { resolveClipLayout } from './canvas.mjs'
import { clipSpan } from './timeline.mjs'
import { fpsToRational, TICKS_PER_SECOND } from './time.mjs'
import { blendModeOf } from './blend.mjs'
import { normalizeMask } from './mask.mjs'
import { selectFileRows } from './paintStack.mjs'
import { createFrameScheduler } from './scheduler.mjs'

/**
 * The audio config the exporter asks a runtime about, when the file has sound.
 *
 * This is not a preference: `mp4a.40.2` was measured answering `supported` at
 * 48 000 Hz stereo and `unsupported` at 22 050 and 32 000 on this machine
 * (§49.4, re-measured at §52.1), and 48 kHz is what the Web Audio mix and
 * every source probe already run at. A second number here would be a second
 * answer to "what does the file sound like".
 */
export const ENCODE_AUDIO_REQUEST = Object.freeze({ sampleRate: 48_000, channelCount: 2 })

/**
 * Every reason `planEncodeContent` can name, in the order it reports them
 * (sorted, like the verdict's `reasons`). The UI translates this vocabulary;
 * it must never invent a reason of its own.
 */
export const ENCODE_REFUSAL_REASONS = Object.freeze([
  'bad-canvas',
  'background-image',
  'background-transparent',
  'empty',
  'stacked-rows',
  'text',
  'effects',
  'mask',
  'blend',
  'transition',
  'reverse',
  'stabilize',
  'fit-unsupported',
  'rotation'
])

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

/** The same timeline resolution `evaluateTimeline` and `selectFileRows` make. */
function timelineOf(input) {
  if (input && Array.isArray(input.tracks)) return input
  return input?.timeline ?? null
}

/**
 * A frame rate the exporter can build a grid from: a rational pair, or a plain
 * number to convert. `null` for anything else — the clock's own fallback to
 * 30 fps is a convenience for a scrub, and a lie for a file.
 */
function usableRate(fps) {
  if (isPositiveInteger(fps?.numerator) && isPositiveInteger(fps?.denominator)) {
    return { numerator: fps.numerator, denominator: fps.denominator }
  }
  if (isFiniteNumber(fps) && fps > 0) return fpsToRational(fps)
  return null
}

/** The modes the plate law paints: `smart` needs the focus-aware crop, which has
 *  no canvas twin measured against the file yet. */
function isPaintableFit(layout) {
  return layout.fit !== 'smart'
}

/**
 * Does this clip ask for a rotation at any tick? The three places the evaluator
 * reads rotation, checked for a non-zero number: the v3 `transform`, the flat
 * app field, and the keyframes that would carry it.
 */
function isRotated(clip) {
  const degrees = [
    clip?.transform?.rotation,
    clip?.rotation,
    ...(Array.isArray(clip?.keyframes)
      ? clip.keyframes.filter(key => key?.prop === 'rotation').map(key => key?.value)
      : [])
  ]
  return degrees.some(value => isFiniteNumber(value) && value % 360 !== 0)
}

/**
 * Can this clip ever make sound? Volume is 0..100 (`gainAt`'s scale) and a
 * stored clip with no volume is at full; keyframed volume can lift a silent
 * one, so the same three reads the evaluator's `volumeOf` makes.
 */
function makesSound(clip) {
  if (!(clipSpan(clip).duration > 0)) return false
  const stored = isFiniteNumber(clip?.volume) ? clip.volume : 100
  if (stored > 0) return true
  const keyed = Array.isArray(clip?.keyframes) ? clip.keyframes : []
  return keyed.some(key => key?.prop === 'volume' && isFiniteNumber(key?.value) && key.value > 0)
}

/**
 * What one project means for the exporter.
 *
 * @param {{ canvas?: object, tracks?: object[], timeline?: object }|null|undefined} input
 *   a project, in either stored clip shape. A bare timeline is refused as
 *   `bad-canvas`: the size and rate of the file come from the project, and a
 *   renderer that guesses them renders a different video than the monitor shows.
 * @returns {{
 *   kind: 'eligible' | 'refused',
 *   reasons: string[],
 *   request: { width: number, height: number, fps: object, audio: object|null } | null,
 *   canvas: { width: number, height: number, fps: object } | null,
 *   totalFrames: number,
 *   contentEndTicks: number,
 *   durationSec: number
 * }} frozen. `reasons` is sorted and complete; a refusal carries no `request`
 *   and no `canvas`, so a caller cannot hand `planEncodePresets` a guess.
 */
export function planEncodeContent(input) {
  const reasons = new Set()
  const canvas = input?.canvas ?? null
  const fps = usableRate(canvas?.fps)
  // A canvas this module cannot size or time is refused alone, before anything
  // else is read: a grid built on a defaulted rate is the answer the project
  // never asked for, and reporting other reasons beside it would bury that.
  if (!isPositiveInteger(canvas?.width) || !isPositiveInteger(canvas?.height) || !fps) {
    return verdict(['bad-canvas'], { fps: null, canvas: null, grid: { frameCount: 0, endTicks: 0 } })
  }

  const rows = selectFileRows(input)
  if (rows.rows.length === 0) reasons.add('empty')
  if (rows.stacked.length > 0) reasons.add('stacked-rows')
  if (rows.overlays.length > 0) reasons.add('text')

  // An image background is a decoded still, cover-fitted, under the footage —
  // the preview does it in CSS and the FFmpeg chain does it as an input, and
  // the canvas painter has done neither yet. A blank value is no background at
  // all in both, so it is not a reason.
  const background = canvas.background
  const blank = typeof background?.value !== 'string' || background.value.trim() === ''
  if (background?.type === 'image' && !blank) reasons.add('background-image')
  // A transparent canvas is a second thing the file cannot answer: the FFmpeg
  // chain switches to an alpha-capable output for it, while the preset ladder
  // asks H.264, VP9 and AV1 with no alpha option — so the painter would deliver
  // black where the preview shows through. A refusal, not a surprise.
  if (background?.type === 'transparent') reasons.add('background-transparent')

  // The rows the file actually uses: the footage the painter paints and the
  // audio the mixer mixes. Hidden rows are skipped by `selectFileRows` because
  // they paint nothing, so a mask on one is not a reason to refuse.
  const tracks = Array.isArray(timelineOf(input)?.tracks) ? timelineOf(input).tracks : []
  const used = [...rows.rows, ...rows.audio].map(row => tracks[row.trackIndex]).filter(Boolean)
  for (const track of used) {
    const items = Array.isArray(track?.items) ? track.items : []
    for (const clip of items) {
      if (!(clipSpan(clip).duration > 0)) continue
      if (Array.isArray(clip.effects) && clip.effects.length > 0) reasons.add('effects')
      if (normalizeMask(clip.mask)) reasons.add('mask')
      if (blendModeOf(clip) !== 'normal') reasons.add('blend')
      if (clip.transitionIn) reasons.add('transition')
      if (clip.reverse === true) reasons.add('reverse')
      if (clip.stabilize === true) reasons.add('stabilize')
      if (!isPaintableFit(resolveClipLayout(clip))) reasons.add('fit-unsupported')
      if (isRotated(clip)) reasons.add('rotation')
    }
  }

  const scheduler = createFrameScheduler(input, { rate: fps })
  const silent = !used.some(track => (
    !isTrackMuted(track)
    && (Array.isArray(track?.items) ? track.items : []).some(clip => makesSound(clip))
  ))

  return verdict([...reasons], { fps, canvas, grid: scheduler, silent })
}

/**
 * Assemble the verdict: reasons sorted and de-duplicated against the published
 * vocabulary, and no request at all when anything is refused.
 */
function verdict(rawReasons, { fps, canvas, grid, silent }) {
  const reasons = ENCODE_REFUSAL_REASONS
    .filter(reason => new Set(rawReasons).has(reason))
    .sort()
  const refused = reasons.length > 0
  const contentEndTicks = grid.endTicks ?? 0
  return Object.freeze({
    kind: refused ? 'refused' : 'eligible',
    reasons: Object.freeze(reasons),
    request: refused || !fps
      ? null
      : Object.freeze({
          width: canvas.width,
          height: canvas.height,
          fps: Object.freeze({ numerator: fps.numerator, denominator: fps.denominator }),
          audio: silent ? null : Object.freeze({ ...ENCODE_AUDIO_REQUEST })
        }),
    canvas: refused || !fps
      ? null
      : Object.freeze({ width: canvas.width, height: canvas.height, fps: Object.freeze({ ...fps }) }),
    totalFrames: grid.frameCount ?? 0,
    contentEndTicks,
    durationSec: contentEndTicks / TICKS_PER_SECOND
  })
}

// --- the plate rect ----------------------------------------------------------
//
// `planEncodeContent` says whether a project can be painted; this says WHERE one
// layer of it lands. The two counterparts answer that today — CSS `object-fit`
// on the monitor, `scale`/`pad`/`crop`/`overlay` in the file — and a third
// answer written next to `drawImage` is how a render ends up cropped differently
// than the user scrubbed. So the geometry is core's, and it mirrors the two
// builders field for field: the same evenized canvas box they scale into, the
// same `clamp01` on the crop fractions, the same "centered, then offset by
// canvas pixels" placement, the same fall-through of an unknown fit to `fit`.
//
// One number cannot be pinned without a measurement, and it is marked for the
// live leg (§53): whole-pixel rounding. The FFmpeg `scale` filter rounds
// its own way, so a plate can land ±1 px off the file's letterbox edge. That is
// what `compareFrames` is run against in H3d-4, not something to guess here.

/** `canvas.mjs`'s clamp, because the crop fractions must agree with its builders. */
function clamp01(value) {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/** The canvas box both builders scale into: at least 2 px, and even. */
function evenBox(size) {
  return Math.max(2, Math.floor(size / 2) * 2)
}

function positiveSize(value) {
  return isFiniteNumber(value) && value > 0 ? Math.round(value) : 0
}

/**
 * Where one layer paints, in canvas pixels.
 *
 * @param {{
 *   media?: { width?: number, height?: number } | null,
 *   canvas?: { width?: number, height?: number } | null,
 *   layout?: { fit?: string, focusX?: number, focusY?: number, cropRect?: object } | null,
 *   transform?: { x?: number, y?: number, scaleX?: number, scaleY?: number } | null,
 *   opacity?: number
 * }} input the decoded plate's intrinsic size, the canvas, and the layer fields
 *   `evaluateTimeline` already resolved (`layout`, `transform`, `opacity`)
 * @returns {{ source: {sx:number,sy:number,sw:number,sh:number},
 *   dest: {dx:number,dy:number,dw:number,dh:number}, alpha: number } | null}
 *   the arguments to one `drawImage`, or null when there is no picture to place:
 *   an unusable media or canvas size, or a fit mode this painter has no measured
 *   twin for (`smart`) — which `planEncodeContent` already refuses, so a null
 *   here means a caller skipped the content law.
 *   A `dest` may extend past the canvas and `dx`/`dy` may go negative: that is
 *   what an enlarged transform looks like in both counterparts, where the frame
 *   edge — not a clamp — decides what is visible.
 */
export function planEncodePlate(input = {}) {
  const mw = positiveSize(input.media?.width)
  const mh = positiveSize(input.media?.height)
  if (!(mw > 0 && mh > 0)) return null
  const canvasW = positiveSize(input.canvas?.width)
  const canvasH = positiveSize(input.canvas?.height)
  if (!(canvasW > 0 && canvasH > 0)) return null

  // `resolveClipLayout` owns the defaults (absent fit is `fit`, focus is clamped,
  // cropRect passes through as stored) — calling it with the layer's layout
  // object reads those same fields, so this module cannot re-guess them.
  const layout = resolveClipLayout(input.layout ?? {})
  if (layout.fit === 'smart') return null

  const boxW = evenBox(canvasW)
  const boxH = evenBox(canvasH)

  let sx = 0
  let sy = 0
  let sw = mw
  let sh = mh

  // `crop` first trims the source, then falls through to the same fit the
  // builder applies after its own crop filter — so a full-frame rect crops
  // nothing, exactly as the `(cx > 0 || cy > 0 || cw < 1 || ch < 1)` guard says.
  if (layout.fit === 'crop' && layout.cropRect) {
    const rect = layout.cropRect
    const cx = clamp01(rect.x)
    const cy = clamp01(rect.y)
    const cw = clamp01(rect.w)
    const ch = clamp01(rect.h)
    if (cw > 0 && ch > 0 && (cx > 0 || cy > 0 || cw < 1 || ch < 1)) {
      sx = Math.round(cx * mw)
      sy = Math.round(cy * mh)
      sw = Math.max(1, Math.round(cw * mw))
      sh = Math.max(1, Math.round(ch * mh))
    }
  }

  // `fill` is a centered crop to the canvas aspect — `cover` in CSS,
  // `scale=increase,crop=W:H` in the file — and only then the whole canvas box.
  if (layout.fit === 'fill') {
    const target = boxW / boxH
    const ratio = sw / sh
    if (ratio > target) {
      const keep = Math.max(1, Math.round(sh * target))
      sx += Math.round((sw - keep) / 2)
      sw = keep
    } else if (ratio < target) {
      const keep = Math.max(1, Math.round(sw / target))
      sy += Math.round((sh - keep) / 2)
      sh = keep
    }
  }

  const covers = layout.fit === 'fill' || layout.fit === 'stretch'
  const scale = covers ? 1 : Math.min(boxW / sw, boxH / sh)
  const fitW = covers ? boxW : Math.max(1, Math.round(sw * scale))
  const fitH = covers ? boxH : Math.max(1, Math.round(sh * scale))

  const transform = input.transform ?? {}
  const scaleX = isFiniteNumber(transform.scaleX) && transform.scaleX > 0 ? transform.scaleX : 1
  const scaleY = isFiniteNumber(transform.scaleY) && transform.scaleY > 0 ? transform.scaleY : 1
  // `rotation` is read by neither line here: the preview rotates a DOM surface
  // and the file rotates the whole canvas box, and the two have not been
  // measured against a canvas `rotate`. `planEncodeContent` names that gap as
  // `rotation` and stops the project before it reaches a painter.
  const dw = Math.max(1, Math.round(fitW * scaleX))
  const dh = Math.max(1, Math.round(fitH * scaleY))

  return Object.freeze({
    source: Object.freeze({ sx, sy, sw, sh }),
    dest: Object.freeze({
      dx: Math.round((boxW - dw) / 2 + (isFiniteNumber(transform.x) ? transform.x : 0)),
      dy: Math.round((boxH - dh) / 2 + (isFiniteNumber(transform.y) ? transform.y : 0)),
      dw,
      dh
    }),
    alpha: isFiniteNumber(input.opacity) ? Math.min(1, Math.max(0, input.opacity)) : 1
  })
}

// --- the frame the painter starts from ---------------------------------------
//
// `planEncodePlate` says where a layer lands; it says nothing about what is
// underneath it. A painter that never clears re-uses the previous frame's pixels
// and ships a smear, so every frame begins at the canvas background — and that
// background is read in three languages today: CSS (`bgStyle.backgroundColor =
// bg.value || '#000000'` in the preview), FFmpeg's `color=` source (through
// `buildBackgroundSource`, whose `toFfmpegColor` blanks to `0x000000`) and a
// canvas `fillStyle`, which is the weakest of the three: it keeps the OLD colour
// when handed a string it cannot parse, so a bad value does not paint black, it
// paints last frame.
//
// `null` is part of the answer, not an error: it means "no colour paints this
// background correctly", and it is reserved for the two shapes
// `planEncodeContent` already refuses — a transparent canvas (the preset ladder
// has no alpha) and a real image background (no decoder-fed cover fit yet). So a
// caller that ran the content law first can never be handed a black frame where
// the preview shows through, and a caller that skipped it gets `null` rather than
// a wrong picture.

/** The canvas spelling of an authored colour, or null when it is not a colour. */
function cssColorOf(value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text === '') return null
  // `toFfmpegColor` accepts the `0xRRGGBB` spelling, so a project can hold it —
  // and a canvas cannot. One colour, two spellings, resolved here rather than
  // silently dropped by a `fillStyle` that never changed.
  if (/^0x[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(text)) return `#${text.slice(2)}`
  return text
}

/**
 * The fill colour one painted export frame starts from.
 *
 * @param {{ background?: { type?: string, value?: unknown } | null } | null} canvas
 *   the project's canvas, read through the same `background` field
 *   `planEncodeContent` classifies
 * @returns {string | null} a CSS colour for `ctx.fillStyle`, or null when this
 *   background has no correct colour answer — which is exactly the pair of shapes
 *   the content law refuses, so a null here means the caller never asked.
 */
export function encodeCanvasFill(canvas) {
  const background = canvas?.background
  const type = background?.type
  if (type === 'transparent') return null
  // A blank image path is no background in either counterpart — the FFmpeg chain
  // says so in its own comment and falls back to a black source.
  if (type === 'image') return cssColorOf(background.value) === null ? '#000000' : null
  // Everything else is the colour branch, which is also what an unknown type
  // becomes in `buildBackgroundSource` and what the preview leaves unpainted.
  return cssColorOf(background?.value) ?? '#000000'
}
