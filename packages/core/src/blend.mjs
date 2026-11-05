// tmcut-core — clip blend mode (Zero-FFmpeg slice F6d).
//
// A video clip can composite over the footage beneath it with a pixel-wise
// blend instead of the plain overlay. The two counterparts spell the modes
// identically — CSS `mix-blend-mode` on the monitor, FFmpeg `blend=all_mode=`
// in the file — so ONE name can drive both, and it has to: FFmpeg validates the
// mode while it parses the filtergraph, so an unknown name is not one clip
// looking wrong, it is every frame of that render failing.
//
// The legal set is therefore core's, and both surfaces ask before they paint or
// emit: `evaluateTimeline` puts the answer on the layer so the preview never
// reaches for the authored clip, and the export compiler runs the clip through
// `blendModeOf` before interpolating it into a filtergraph. Anything outside the
// set — a hand-edited project, a CSS mode the binary does not know — normalizes
// to `normal`, which the exporter draws with the classic `overlay` combiner and
// no blend filter at all.

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
