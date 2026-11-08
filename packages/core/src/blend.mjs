// tmcut-core — clip blend mode (Zero-FFmpeg slice F6d).
//
// A video clip can composite over the footage beneath it with a pixel-wise
// blend instead of the plain overlay. ONE name drives the monitor's CSS
// `mix-blend-mode`, and the same name is what the layer carries, so the
// preview and the exporter never decide a mode twice.
//
// The legal set is core's: `evaluateTimeline` puts the answer on the layer so
// the preview never reaches for the authored clip, and the export eligibility
// law runs the clip through `blendModeOf` before painting. Anything outside the
// set — a hand-edited project, a CSS mode no consumer implements — normalizes
// to `normal`.
//
// Slice J retired the FFmpeg `blend=all_mode=` emitter. The WebCodecs export
// MVP refuses a non-normal blend by name (`planEncodeContent` -> 'blend'), so
// today the set describes the monitor's reach, not the file's.

/** The modes both counterparts implement with the same spelling. */
export const BLEND_MODES = ['normal', 'screen', 'overlay', 'multiply']

/**
 * The blend mode one clip composites with, normalized to the legal set.
 *
 * @param {{ blend?: unknown } | null | undefined} clip a stored clip
 * @returns {string} a member of `BLEND_MODES`; `normal` when absent, not a
 *   string, or not a mode both counterparts implement.
 */
export function blendModeOf(clip) {
  const mode = clip?.blend
  return typeof mode === 'string' && BLEND_MODES.includes(mode) ? mode : 'normal'
}
