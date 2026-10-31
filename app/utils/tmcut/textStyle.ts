// Text style metrics (roadmap C-2): the preview overlay and the export
// compiler import THESE numbers — duplicated formulas would drift apart
// and break WYSIWYW (the C0 lesson from canvas.ts).

/** Stroke width in px — drawtext borderw and CSS -webkit-text-stroke. */
export function textStrokeWidth(fontSize: number): number {
  return Math.max(1, Math.round(fontSize / 18))
}

/** Shadow offset in px — drawtext shadowx/shadowy and CSS text-shadow. */
export function textShadowOffset(fontSize: number): number {
  return Math.max(1, Math.round(fontSize / 14))
}

/**
 * Plate padding in px — drawtext `boxborderw` and the CSS padding of the
 * preview's plate. Same number on both sides, so the box hugs the text the
 * same way before and after export.
 */
export function textBoxPadding(fontSize: number): number {
  return Math.max(2, Math.round(fontSize * 0.25))
}
