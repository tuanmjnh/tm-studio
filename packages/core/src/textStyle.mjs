// =============================================================================
//  tmcut-core — text style
//  The pixel numbers a caption is drawn with, owned once (V4 Phase 2).
//
//  Preview and export render the same caption: the preview as CSS on a DOM
//  overlay, the export as drawtext options on a filter chain. Two syntaxes,
//  one set of numbers. Those numbers used to live in the app's own helper, so
//  a second host — or the core's own clip factory, which seeds the font size —
//  had to copy them, and copied arithmetic drifts (the canvas.ts C0 lesson).
//  Each function below names the option it feeds on BOTH sides.
// =============================================================================

/** Font size a text clip falls back to when the project carries none. */
export const DEFAULT_TEXT_FONT_SIZE = 36

/**
 * Glyph colour a text clip falls back to. The export may spell the same colour
 * in FFmpeg syntax (`white`); the value, not the spelling, is the law.
 */
export const DEFAULT_TEXT_COLOR = '#ffffff'

/** Stroke width in px — drawtext `borderw` and CSS text-stroke. */
export function textStrokeWidth(fontSize) {
  return Math.max(1, Math.round(fontSize / 18))
}

/** Shadow offset in px — drawtext `shadowx`/`shadowy` and CSS text-shadow. */
export function textShadowOffset(fontSize) {
  return Math.max(1, Math.round(fontSize / 14))
}

/**
 * Plate padding in px — drawtext `boxborderw` and the CSS padding of the
 * preview's plate. One number, so the box hugs the glyphs the same way before
 * and after export.
 */
export function textBoxPadding(fontSize) {
  return Math.max(2, Math.round(fontSize * 0.25))
}
