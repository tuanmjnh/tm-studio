// =============================================================================
//  tmcut-core — text style
//  The pixel numbers a caption is drawn with, owned once (V4 Phase 2).
//
//  The preview paints a caption as CSS on a DOM overlay from these numbers.
//  They used to live in the app's own helper, so a second host — or the core's
//  own clip factory, which seeds the font size — had to copy them, and copied
//  arithmetic drifts (the canvas.ts C0 lesson). Slice J retired the FFmpeg
//  drawtext leg; the WebCodecs exporter refuses text clips by name, so the
//  preview is the only painter left and it still reads this one law.
// =============================================================================

/** Font size a text clip falls back to when the project carries none. */
export const DEFAULT_TEXT_FONT_SIZE = 36

/** Glyph colour a text clip falls back to. One value, one spelling. */
export const DEFAULT_TEXT_COLOR = '#ffffff'

/** Stroke width in px — the CSS text stroke. */
export function textStrokeWidth(fontSize) {
  return Math.max(1, Math.round(fontSize / 18))
}

/** Shadow offset in px — the CSS text-shadow. */
export function textShadowOffset(fontSize) {
  return Math.max(1, Math.round(fontSize / 14))
}

/**
 * Plate padding in px — the CSS padding of the preview's plate, so the box
 * hugs the glyphs consistently at any player size.
 */
export function textBoxPadding(fontSize) {
  return Math.max(2, Math.round(fontSize * 0.25))
}
