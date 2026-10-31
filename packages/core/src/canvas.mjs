// =============================================================================
//  @tmcut/core — canvas
//  Ported from app/utils/tmcut/canvas.ts (docs Phase 4: Canvas Engine).
//  Pure geometry: presets, orientation, fit styles, ffmpeg fit filters and
//  reframe math. Canvas fps is rational (docs section 3); numeric inputs
//  are coerced via fpsToRational.
// =============================================================================

import { fpsToRational } from './time.mjs'

/**
 * Convert a DSL canvas color to an FFmpeg `color` source spec.
 * FFmpeg color syntax is `[0x|#]RRGGBB[AA]` — the render pipeline's proven
 * working form is `0x` hex (see app render helper ffmpegColor and the R62
 * render test asserting `color=c=0x123456`). Named colors ('black', 'red')
 * pass through unchanged.
 */
function toFfmpegColor(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return '0x000000'
  if (v.startsWith('#')) return `0x${v.slice(1)}`
  if (v.startsWith('0x')) return v
  return v
}

/**
 * Builds the FFmpeg background source descriptor for the canvas.
 *
 * Contract (R76 — Phase 4 Canvas Engine):
 * - `color` / `transparent` → `{ kind: 'source', chain }` — a self-contained
 *   `color=` source filter chain; append your own stream label.
 *   Transparent is a REAL chain (`0x00000000`) so overlays still composite
 *   over it; the output codec (alpha-capable) decides whether the alpha
 *   survives to the file.
 * - `image` → `{ kind: 'input', file, inputFlags, tail }` — the image is an
 *   FFmpeg INPUT (not a `movie=` filter: drive-letter colons like `D:/`
 *   break `:`-separated filter options, and `fps=` is not a movie demuxer
 *   option). The caller registers the file via
 *   `graph.addInput(file, inputFlags)` (flags carry `-framerate`,
 *   `-loop 1`, `-t <duration>`) and applies `tail` to the labeled stream.
 *
 * @param {object} options
 * @param {number} options.canvasW    Canvas width (evened).
 * @param {number} options.canvasH    Canvas height (evened).
 * @param {number} options.fps        Frame rate.
 * @param {number} options.duration   Seconds the background must cover.
 * @param {object} options.background { type: 'color'|'image'|'transparent', value?: string }.
 * @returns {object} { type, kind, chain?, file?, inputFlags?, tail? }
 */
export function buildBackgroundSource(options) {
  const canvasW = Math.max(2, Math.floor((Number(options.canvasW) || 0) / 2) * 2)
  const canvasH = Math.max(2, Math.floor((Number(options.canvasH) || 0) / 2) * 2)
  const fps = Number(options.fps) > 0 ? Number(options.fps) : 30
  const duration = Math.max(0.05, Number(options.duration) || 1)
  const bg = options.background ?? { type: 'color', value: '#000000' }

  if (bg.type === 'image') {
    const imgPath = typeof bg.value === 'string' ? bg.value.trim() : ''
    if (!imgPath) {
      // Missing path: fall back to a solid black source so the render
      // still produces a full-canvas frame (no dangling input).
      return {
        type: 'color',
        kind: 'source',
        chain: `color=c=0x000000:s=${canvasW}x${canvasH}:r=${fps}:d=${duration.toFixed(3)}`
      }
    }
    // Cover-fit: scale to fill the canvas, crop the overflow, keep SAR 1.
    // No `-t` here: each consumer trims its own window (clip duration +
    // headroom), so one looping input can serve the whole timeline.
    const tail = `scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase,crop=${canvasW}:${canvasH},setsar=1`
    return {
      type: 'image',
      kind: 'input',
      file: imgPath,
      inputFlags: ['-framerate', String(fps), '-loop', '1'],
      tail
    }
  }

  if (bg.type === 'transparent') {
    return {
      type: 'transparent',
      kind: 'source',
      chain: `color=c=0x00000000:s=${canvasW}x${canvasH}:r=${fps}:d=${duration.toFixed(3)}`
    }
  }

  // 'color' (default)
  return {
    type: 'color',
    kind: 'source',
    chain: `color=c=${toFfmpegColor(bg.value)}:s=${canvasW}x${canvasH}:r=${fps}:d=${duration.toFixed(3)}`
  }
}

export const TMUTCANVAS_PRESETS = [
  { id: '16:9', width: 1920, height: 1080, orientation: 'landscape', icon: 'i-lucide-tv' },
  { id: '9:16', width: 1080, height: 1920, orientation: 'portrait', icon: 'i-lucide-smartphone' },
  { id: '1:1', width: 1080, height: 1080, orientation: 'square', icon: 'i-lucide-square' },
  { id: '4:5', width: 1080, height: 1350, orientation: 'portrait', icon: 'i-lucide-rectangle-vertical' },
  { id: '4:3', width: 1440, height: 1080, orientation: 'landscape', icon: 'i-lucide-proportions' },
  { id: '21:9', width: 2560, height: 1080, orientation: 'landscape', icon: 'i-lucide-monitor' }
]

export const TMUTCUT_SOCIAL_PRESETS = [
  { id: 'youtube', presetId: '16:9', icon: 'i-lucide-tv' },
  { id: 'youtube-shorts', presetId: '9:16', icon: 'i-lucide-smartphone' },
  { id: 'tiktok', presetId: '9:16', icon: 'i-simple-icons-tiktok' },
  { id: 'instagram-reels', presetId: '9:16', icon: 'i-simple-icons-instagram' },
  { id: 'instagram-feed', presetId: '4:5', icon: 'i-simple-icons-instagram' },
  { id: 'facebook', presetId: '16:9', icon: 'i-simple-icons-facebook' }
]

export const TMUTCUT_FIT_MODES = ['fit', 'fill', 'crop', 'stretch', 'smart']

function gcd(a, b) {
  let x = Math.abs(Math.round(a))
  let y = Math.abs(Math.round(b))
  while (y > 0) {
    const t = x % y
    x = y
    y = t
  }
  return x || 1
}

export function aspectValue(width, height) {
  if (!width || !height || width <= 0 || height <= 0) return 0
  const divisor = gcd(width, height)
  return width / divisor / (height / divisor)
}

export function orientationOf(width, height) {
  if (!width || !height || width <= 0 || height <= 0) return 'landscape'
  if (width > height) return 'landscape'
  if (width < height) return 'portrait'
  return 'square'
}

export function findCanvasPreset(id) {
  return TMUTCANVAS_PRESETS.find(preset => preset.id === id) ?? null
}

export function findCanvasPresetByDimensions(width, height) {
  return TMUTCANVAS_PRESETS.find(preset => preset.width === Math.round(width) && preset.height === Math.round(height)) ?? null
}

export function ratioIdOf(width, height) {
  const preset = findCanvasPresetByDimensions(width, height)
  return preset ? preset.id : `${width}x${height}`
}

export function ratioLabel(width, height) {
  return ratioIdOf(width, height)
}

/** Normalize partial canvas input to a v3 canvas (rational fps). */
export function normalizeCanvas(canvas) {
  const width = Math.round(canvas?.width && canvas.width > 0 ? canvas.width : 1920)
  const height = Math.round(canvas?.height && canvas.height > 0 ? canvas.height : 1080)
  const fpsInput = canvas?.fps
  const fps = fpsInput && typeof fpsInput === 'object'
    ? fpsInput
    : fpsToRational(typeof fpsInput === 'number' && fpsInput > 0 ? fpsInput : 30)
  const aspectRatio = canvas?.aspectRatio?.id
    ? {
        id: canvas.aspectRatio.id,
        value: canvas.aspectRatio.value || aspectValue(width, height),
        orientation: canvas.aspectRatio.orientation || orientationOf(width, height)
      }
    : {
        id: ratioIdOf(width, height),
        value: aspectValue(width, height),
        orientation: orientationOf(width, height)
      }
  const background = canvas?.background?.type
    ? (canvas.background.value !== undefined
        ? { type: canvas.background.type, value: canvas.background.value }
        : { type: canvas.background.type })
    : { type: 'color', value: '#000000' }
  return { width, height, fps, aspectRatio, background }
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0.5
  return Math.min(1, Math.max(0, value))
}

/** CSS object-fit/position for a fit mode (preview adapter). */
export function computeFitObjectStyle(mode, focusX = 0.5, focusY = 0.5, cropRect) {
  if (mode === 'fill') return { objectFit: 'cover', objectPosition: '50% 50%' }
  if (mode === 'stretch') return { objectFit: 'fill', objectPosition: '50% 50%' }
  if (mode === 'smart') {
    const fx = Math.round(clamp01(focusX) * 100)
    const fy = Math.round(clamp01(focusY) * 100)
    return { objectFit: 'cover', objectPosition: `${fx}% ${fy}%` }
  }
  if (mode === 'crop' && cropRect) {
    const w = clamp01(cropRect.w)
    const h = clamp01(cropRect.h)
    const cx = clamp01(cropRect.x) + w / 2
    const cy = clamp01(cropRect.y) + h / 2
    return { objectFit: 'cover', objectPosition: `${Math.round(cx * 100)}% ${Math.round(cy * 100)}%` }
  }
  return { objectFit: 'contain', objectPosition: '50% 50%' }
}

/** FFmpeg filter chain for a fit mode (render adapter, same semantics). */
export function buildFfmpegFitFilters(mode, canvasW, canvasH, options = {}) {
  const w = Math.max(2, Math.floor(canvasW / 2) * 2)
  const h = Math.max(2, Math.floor(canvasH / 2) * 2)
  const padColor = options.padColor || 'black'
  const fit = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:${padColor}`
  if (mode === 'fill') return withRotation([`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`], options)
  if (mode === 'stretch') return withRotation([`scale=${w}:${h}`], options)
  if (mode === 'smart') {
    const fx = clamp01(options.focusX ?? 0.5)
    const fy = clamp01(options.focusY ?? 0.5)
    return withRotation([`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:x='(iw-${w})*${fx.toFixed(4)}':y='(ih-${h})*${fy.toFixed(4)}'`], options)
  }
  if (mode === 'crop' && options.cropRect) {
    const cx = clamp01(options.cropRect.x)
    const cy = clamp01(options.cropRect.y)
    const cw = clamp01(options.cropRect.w)
    const ch = clamp01(options.cropRect.h)
    if (cw > 0 && ch > 0 && (cx > 0 || cy > 0 || cw < 1 || ch < 1)) {
      return withRotation([
        `crop=w='iw*${cw.toFixed(4)}':h='ih*${ch.toFixed(4)}':x='iw*${cx.toFixed(4)}':y='ih*${cy.toFixed(4)}'`,
        fit
      ], options)
    }
    return withRotation([fit], options)
  }
  return withRotation([fit], options)
}

/**
 * Append the rotation step (Roadmap C7) AFTER the fit filters, keeping
 * the canvas box size: `rotate=<deg>*PI/180:ow=iw:oh=ih` clips the
 * rotated corners to the canvas just like the preview monitor's
 * `overflow: hidden`, and `fillcolor` colors the uncovered corners with
 * the canvas background. Direction matches CSS `rotate(deg)` — verified
 * against ffmpeg: `rotate=90*PI/180` is byte-identical to
 * `transpose=1` (clockwise). A rotation of0 (or absent) appends nothing,
 * so callers keep byte-identical output for unrotated clips.
 */
function withRotation(filters, options = {}) {
  const deg = Number(options.rotation)
  if (!Number.isFinite(deg) || deg % 360 === 0) return filters
  filters.push(`rotate=${deg}*PI/180:ow=iw:oh=ih:fillcolor=${options.padColor || 'black'}`)
  return filters
}

/**
 * FFmpeg filters applying a clip transform to a canvas-sized stream,
 * matching the preview CSS `translate(x, y) scale(s)` (rotation is
 * intentionally NOT included — the export rotate filter is pending, C7):
 *
 *   content = scale(canvasW * s, canvasH * s)   // evenized, min 2px
 *   x_pos   = (canvasW - contentW) / 2 + x      // rounded, may be negative
 *   y_pos   = (canvasH - contentH) / 2 + y
 *
 * A background is required because the content can be larger than the
 * canvas (scale > 100) or leave gaps (scale < 100). FFmpeg's `pad` is
 * not usable for this: it rejects input larger than output ("Padded
 * dimensions cannot be smaller than input dimensions") and silently
 * ignores negative offsets (both verified against ffmpeg). The reliable
 * form is `color` + `overlay` with `shortest=1` and a background
 * duration of `duration + 2` seconds — the headroom absorbs source
 * frame quantization from `trim` so the segment always ends on the
 * clip's own last frame and concat A/V lengths stay aligned.
 *
 * Phase 4 (R76): `bgInput` lets the caller supply a pre-labeled background
 * stream (e.g. `[v_bg]` from the canvas image source). The overlay then
 * composites the clip over that shared base instead of an inline `color=`
 * source — required when the canvas background is an image, where the
 * still must be a looping INPUT (drive-letter colons cannot appear in a
 * `movie=` filter). When set, `bg` is an empty string and the overlay
 * reads the background from the supplied label.
 *
 * @param {object} [options]
 * @param {number} options.canvasW     Canvas width (evenized like fit filters).
 * @param {number} options.canvasH     Canvas height.
 * @param {number} [options.scale=100] Scale percent (clip.scale).
 * @param {number} [options.x=0]       X offset in canvas px (clip.x, may be fractional/negative).
 * @param {number} [options.y=0]       Y offset in canvas px (clip.y).
 * @param {number} [options.fps=30]    Background frame rate.
 * @param {number} [options.duration=1] Clip duration in seconds (background headroom base).
 * @param {string} [options.bgColor='black'] FFmpeg color spec for the background.
 * @returns {null | { bg: string, tail: string, overlay: string }} `null` for
 *   the identity transform (scale 100 + no offsets) so callers keep the
 *   original pipeline untouched. Otherwise `bg` is a standalone source
 *   chain (label it yourself), `tail` appends to the clip's own chain,
 *   and `overlay` joins the two labeled inputs.
 */
export function buildFfmpegTransform(options = {}) {
  const canvasW = Math.max(2, Math.floor((Number(options.canvasW) || 0) / 2) * 2)
  const canvasH = Math.max(2, Math.floor((Number(options.canvasH) || 0) / 2) * 2)
  const rawScale = Number(options.scale)
  let s = Number.isFinite(rawScale) ? rawScale / 100 : 1
  if (!(s > 0)) s = 0.01 // degenerate non-positive scale renders near-invisible
  const dx = Math.round(Number.isFinite(Number(options.x)) ? Number(options.x) : 0)
  const dy = Math.round(Number.isFinite(Number(options.y)) ? Number(options.y) : 0)
  const scaleExpr = options.scaleExpr || null
  const xExpr = options.xExpr || null
  const yExpr = options.yExpr || null
  const isAnimated = Boolean(scaleExpr || xExpr || yExpr)

  if (!isAnimated && s === 1 && dx === 0 && dy === 0) return null

  const fps = Number(options.fps) > 0 ? Number(options.fps) : 30
  const duration = Math.max(0.05, Number(options.duration) || 1)
  const bgColor = options.bgColor || 'black'
  const bg = options.bgInput
    ? '' // caller supplies the background via a labeled input (image background)
    : `color=c=${bgColor}:s=${canvasW}x${canvasH}:r=${fps}:d=${(duration + 2).toFixed(3)}`

  if (isAnimated) {
    const tail = scaleExpr
      ? `scale=w='trunc(${canvasW}*(${scaleExpr})/100/2)*2':h='trunc(${canvasH}*(${scaleExpr})/100/2)*2':eval=frame`
      : `scale=${Math.max(2, Math.round(canvasW * s / 2) * 2)}:${Math.max(2, Math.round(canvasH * s / 2) * 2)}`
    const ovX = xExpr ? `(W-w)/2+(${xExpr})` : `(W-w)/2+${dx}`
    const ovY = yExpr ? `(H-h)/2+(${yExpr})` : `(H-h)/2+${dy}`
    const overlay = `overlay=x='${ovX}':y='${ovY}':eval=frame:shortest=1`
    return { bg, tail, overlay }
  }

  const w = Math.max(2, Math.round(canvasW * s / 2) * 2)
  const h = Math.max(2, Math.round(canvasH * s / 2) * 2)
  const x = Math.round((canvasW - w) / 2 + dx)
  const y = Math.round((canvasH - h) / 2 + dy)
  return {
    bg,
    tail: `scale=${w}:${h}`,
    overlay: `overlay=x=${x}:y=${y}:shortest=1`
  }
}

/** Proportionally reframe manual x/y offsets across a canvas switch. */
export function reframeTransform(x, y, fromW, fromH, toW, toH) {
  if (!fromW || !fromH || !toW || !toH) return { x, y }
  return {
    x: Math.round((x || 0) * (toW / fromW)),
    y: Math.round((y || 0) * (toH / fromH))
  }
}

/**
 * Preview scale factor: CSS pixels per canvas pixel along the width axis.
 * Overlays authored in canvas units (text size/position) multiply by this
 * to stay proportional at any player size (fixes the hardcoded 0.7 factor).
 */
export function previewScale(containerWidth, canvasWidth) {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(canvasWidth) || canvasWidth <= 0 || containerWidth <= 0) return 1
  return containerWidth / canvasWidth
}

// --- Safe areas + frame guides (Roadmap C13) -------------------------------

/** Broadcast safe-area fractions of the frame: action safe / title safe. */
const ACTION_SAFE = 0.9
const TITLE_SAFE = 0.8

function centeredRect(fraction) {
  // Trim float noise so rects serialize clean (0.05, not 0.049999…).
  const inset = Number(((1 - fraction) / 2).toFixed(6))
  return { x: inset, y: inset, w: fraction, h: fraction }
}

/**
 * Safe-area rectangles for a canvas as CENTERED FRACTIONS of the frame
 * (dimension-independent, ready for CSS percentages). An invalid canvas
 * yields zero rects so overlays never draw on garbage.
 */
export function safeAreaRects(canvas) {
  const width = canvas?.width
  const height = canvas?.height
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    const zero = { x: 0, y: 0, w: 0, h: 0 }
    return { actionSafe: zero, titleSafe: zero }
  }
  return {
    actionSafe: centeredRect(ACTION_SAFE),
    titleSafe: centeredRect(TITLE_SAFE)
  }
}

/**
 * Ratio frame-guide presets for the preview overlay (composition aid,
 * not a crop): draw the centered box of `ratio` inside the canvas.
 */
export const SAFE_AREA_PRESETS = [
  { id: '16-9', label: '16:9', ratio: 16 / 9 },
  { id: '9-16', label: '9:16', ratio: 9 / 16 },
  { id: '1-1', label: '1:1', ratio: 1 },
  { id: '4-5', label: '4:5', ratio: 4 / 5 },
  { id: '4-3', label: '4:3', ratio: 4 / 3 },
  { id: '3-4', label: '3:4', ratio: 3 / 4 },
  { id: '21-9', label: '21:9', ratio: 21 / 9 }
]

/**
 * Interactive crop ratio presets for canvas crop editing (Roadmap F-3).
 * `ratio = width / height` in pixel terms.
 */
export const CROP_RATIO_PRESETS = [
  { id: 'free', label: 'Free', ratio: null },
  { id: '16-9', label: '16:9', ratio: 16 / 9 },
  { id: '9-16', label: '9:16', ratio: 9 / 16 },
  { id: '1-1', label: '1:1', ratio: 1 },
  { id: '4-3', label: '4:3', ratio: 4 / 3 },
  { id: '3-4', label: '3:4', ratio: 3 / 4 },
  { id: '21-9', label: '21:9', ratio: 21 / 9 }
]

/**
 * Clamps a normalized cropRect { x, y, w, h } inside [0, 1] bounds with min size.
 */
export function clampCropRect(rect, minSize = 0.05) {
  if (!rect || typeof rect !== 'object') {
    return { x: 0, y: 0, w: 1, h: 1 }
  }
  const minS = Math.max(0.01, Math.min(1, minSize))
  const rawW = Number.isFinite(rect.w) ? rect.w : 1
  const rawH = Number.isFinite(rect.h) ? rect.h : 1
  const w = Math.min(1, Math.max(minS, rawW))
  const h = Math.min(1, Math.max(minS, rawH))
  const rawX = Number.isFinite(rect.x) ? rect.x : 0
  const rawY = Number.isFinite(rect.y) ? rect.y : 0
  const x = Math.max(0, Math.min(1 - w, rawX))
  const y = Math.max(0, Math.min(1 - h, rawY))
  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.round(y * 10000) / 10000,
    w: Math.round(w * 10000) / 10000,
    h: Math.round(h * 10000) / 10000
  }
}

/**
 * Fits a target pixel aspect ratio inside the existing cropRect or [0, 1] space,
 * centered around the existing crop center.
 */
export function applyCropRatio(rect, ratio, sourceW = 1920, sourceH = 1080) {
  const current = clampCropRect(rect)
  if (!ratio || ratio <= 0 || !Number.isFinite(ratio)) {
    return current
  }
  const sw = Math.max(1, Number.isFinite(sourceW) && sourceW > 0 ? sourceW : 1920)
  const sh = Math.max(1, Number.isFinite(sourceH) && sourceH > 0 ? sourceH : 1080)
  const sourceAspect = sw / sh
  // In normalized 0..1 space: normRatio = w_norm / h_norm = ratio / sourceAspect
  const targetNormRatio = ratio / sourceAspect

  let newW = current.w
  let newH = current.h

  if (newW / newH > targetNormRatio) {
    newW = newH * targetNormRatio
  } else {
    newH = newW / targetNormRatio
  }

  if (newW > 1) {
    newW = 1
    newH = 1 / targetNormRatio
  }
  if (newH > 1) {
    newH = 1
    newW = targetNormRatio
  }

  const cx = current.x + current.w / 2
  const cy = current.y + current.h / 2
  const newX = cx - newW / 2
  const newY = cy - newH / 2

  return clampCropRect({ x: newX, y: newY, w: newW, h: newH })
}
