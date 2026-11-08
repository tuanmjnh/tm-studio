// =============================================================================
//  tmcut-core — canvas
//  Ported from app/utils/tmcut/canvas.ts (docs Phase 4: Canvas Engine).
//  Pure geometry: presets, orientation, fit styles, reframe and crop math.
//  Canvas fps is rational (docs section 3); numeric inputs are coerced via
//  fpsToRational. Slice J retired the FFmpeg argv/filter emitters — the
//  WebCodecs exporter paints from the plan, never from a filter string.
// =============================================================================

import { fpsToRational } from './time.mjs'

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

/**
 * Media placement resolved from a stored clip: the same defaults
 * `computeFitObjectStyle` (preview CSS) and the export plate planner assume,
 * so a renderer never re-guesses them. Focus goes through `clamp01` because
 * that is exactly what the 'smart' fit does with it; `cropRect` passes
 * through as stored.
 *
 * `evaluateTimeline` puts this on every layer and `planEncodePlate` reads the
 * same call, so the two renderers cannot diverge on fit, focus or crop.
 */
export function resolveClipLayout(clip) {
  return {
    fit: typeof clip?.fit === 'string' && clip.fit ? clip.fit : 'fit',
    focusX: clamp01(clip?.focusX),
    focusY: clamp01(clip?.focusY),
    cropRect: clip?.cropRect ?? null
  }
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
