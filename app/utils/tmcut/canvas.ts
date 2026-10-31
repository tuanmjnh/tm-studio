// Canvas geometry (presets, aspect math, fit styles, FFmpeg fit filters,
// reframe) lives in @tmcut/core as the single source of truth since
// Roadmap C0 — this module only preserves existing app import paths.
//
// C16: App migration to DSL v3 — normalizeCanvas now uses core's implementation
// which returns rational fps ({ numerator, denominator }). The app project model
// now stores fps as FrameRate.
import type { FrameRate } from '@tmcut-core'

export {
  TMUTCANVAS_PRESETS,
  TMUTCUT_SOCIAL_PRESETS,
  TMUTCUT_FIT_MODES,
  aspectValue,
  orientationOf,
  ratioIdOf,
  ratioLabel,
  findCanvasPreset,
  findCanvasPresetByDimensions,
  computeFitObjectStyle,
  buildFfmpegFitFilters,
  buildFfmpegTransform,
  reframeTransform,
  CROP_RATIO_PRESETS,
  clampCropRect,
  applyCropRatio,
  buildBackgroundSource,
  normalizeCanvas
} from '@tmcut-core'

/**
 * C16: numeric fps from a canvas (FrameRate rational or legacy number).
 * Returns the exact ratio (e.g. 29.97 for 30000/1001) — 3-decimal rounding
 * keeps FFmpeg args and UI labels clean.
 */
export function canvasFpsValue(canvas?: { fps?: FrameRate | number } | null): number {
  if (!canvas || !canvas.fps) return 30
  if (typeof canvas.fps === 'number') return canvas.fps
  if (canvas.fps.denominator <= 0) return 30
  return Math.round((canvas.fps.numerator / canvas.fps.denominator) * 1000) / 1000
}
