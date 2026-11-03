// =============================================================================
//  tmcut-core — paint stack
//  Which footage row owns the canvas at one tick (V4 Phase 2, gap G18).
//
//  `evaluateTimeline` answers "which clips are live at t?" for every track. It
//  does not answer the question both renderers actually ask: of the footage
//  rows, which one PAINTS? Exactly one row can own the canvas today (no host
//  composites two at once), so the answer is a selection over the evaluation —
//  video rows, not hidden, holding a layer at this tick, first in track order
//  wins and the rest are footage the render drops.
//
//  The rule lives here because both hosts need the SAME one. Before this module
//  the preview re-implemented it per frame (`footageRow`, app/composables/
//  useTmcutPlayback.ts) — the row that has a layer, so a gap hands the canvas to
//  the next visible row — while the exporter pinned the first visible row for
//  the whole file (`selectExportTracks`, app/utils/tmcut/render/clip.ts). The
//  two disagree precisely where a project has more than one footage row, which
//  is the disagreement G18 records. The compositor slice builds its graph from
//  `rows`, so it stacks from the answer the preview already paints.
//
//  A row carries `trackIndex`, its position in `evaluateTimeline`'s own track
//  list — which that call builds one entry per input track, in order, so a host
//  joins back to its authored track by the same index. Core deliberately does
//  not carry the items: the evaluation stays renderer-agnostic, and joining is
//  the host's business.
//
//  What the rule deliberately does NOT do: skip a row whose only live layer is
//  transparent. `evaluateTimeline` marks such a layer `visible: false` but still
//  returns it, and the preview keeps owning the canvas through it (the layer's
//  opacity reaches the <video> as CSS). Measured in the core test, not assumed —
//  changing it would change what the screen shows, and that is a compositor
//  decision, not a move-the-law one.
// =============================================================================

import { evaluateTimeline } from './evaluate.mjs'

/**
 * The footage rows eligible to paint at one tick, in track order.
 *
 * @param {{ at?: number, tracks?: object[] }} evaluation an `evaluateTimeline`
 *   result, so a per-frame caller never evaluates the timeline twice.
 * @returns {{ at: number, rows: Array<{ trackId: string|null, trackIndex:
 *   number, layers: object[] }>, base: object|null }}
 *   `rows` is the paint order both hosts must follow — `rows[0]` (also `base`)
 *   is the row that owns the canvas today, and anything after it is footage the
 *   single-row law drops. A `base` of `null` means no footage paints at this
 *   tick: the canvas shows its background, exactly as an uncovered gap does.
 */
export function selectPaintRows(evaluation) {
  const entries = Array.isArray(evaluation?.tracks) ? evaluation.tracks : []
  const rows = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry?.type !== 'video') continue
    if (entry.hidden === true) continue
    const layers = Array.isArray(entry.layers) ? entry.layers : []
    if (layers.length === 0) continue
    rows.push({ trackId: entry.id ?? null, trackIndex: index, layers })
  }
  return {
    at: Number.isFinite(evaluation?.at) ? evaluation.at : 0,
    rows,
    base: rows[0] ?? null
  }
}

/**
 * `evaluateTimeline` + `selectPaintRows` in one call, for hosts that do not
 * already hold the evaluation (the exporter, tests, workers).
 *
 * @param {{ timeline?: object } | { tracks: object[] }} input project or timeline
 * @param {number} atTicks absolute timeline ticks
 * @returns {{ at: number, rows: object[], base: object|null }}
 */
export function paintStackAt(input, atTicks) {
  return selectPaintRows(evaluateTimeline(input, atTicks))
}
