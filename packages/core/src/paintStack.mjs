// =============================================================================
//  tmcut-core — paint stack
//  Which footage rows are paintable at one tick, in paint order (V4 Phase 2,
//  gap G18; the row half of the plan F1 splits out of the app).
//
//  `evaluateTimeline` answers "which clips are live at t?" for every track. It
//  does not answer the question both renderers actually ask: of the footage
//  rows, which are PAINTABLE? The answer is a selection over the evaluation —
//  video rows, not hidden, holding a layer at this tick — returned in track
//  order, which IS the paint order: `rows[0]` is the bottom of the stack.
//
//  The rule lives here because both hosts need the SAME one. Before this module
//  the preview re-implemented it per frame (`footageRow`, app/composables/
//  useTmcutPlayback.ts) — the row that has a layer, so a gap hands the canvas to
//  the next visible row — while the exporter pinned the first visible row for
//  the whole file (`selectExportTracks`, app/utils/tmcut/render/clip.ts). The
//  two disagree precisely where a project has more than one footage row, which
//  is the disagreement G18 records.
//
//  This module answers the ROW question only. Which layer of a row is the
//  picture, which is a transition's outgoing partner, and what overlays the
//  whole stack is the job of `composite.mjs` — `compositePlan` calls here for
//  its rows, so the two cannot drift. `base` (== `rows[0]`) survives for the
//  hosts that still drive one surface: for them the bottom row is the one that
//  paints, which is exactly what the single-row law was, minus the claim that
//  no host may stack more.
//
//  A row carries `trackIndex`, its position in `evaluateTimeline`'s own track
//  list — which that call builds one entry per input track, in order, so a host
//  joins back to its authored track by the same index. Core deliberately does
//  not carry the items: the evaluation stays renderer-agnostic, and joining is
//  the host's business.
//
//  The module answers that question at TWO scopes. `selectPaintRows` reads one
//  evaluation (per tick, what the preview asks every frame); `selectFileRows`
//  reads the timeline (per file, what a host that builds one static graph for
//  the whole render asks). The second is the union of the first, written once —
//  the exporter used to hold its own version of it, and the two disagreed about
//  a row made of trimmed-to-nothing clips: the app asked whether a clip carried
//  media, core asks whether a clip can be live at all. Same law, same answer,
//  F3.
//
//  What the rule deliberately does NOT do: skip a row whose only live layer is
//  transparent. `evaluateTimeline` marks such a layer `visible: false` but still
//  returns it, and the preview keeps owning the canvas through it (the layer's
//  opacity reaches the <video> as CSS). Measured in the core test, not assumed —
//  changing it would change what the screen shows, and that is a compositor
//  decision, not a move-the-law one.
// =============================================================================

import { evaluateTimeline } from './evaluate.mjs'
import { clipSpan } from './timeline.mjs'

/**
 * The footage rows eligible to paint at one tick, in track order.
 *
 * @param {{ at?: number, tracks?: object[] }} evaluation an `evaluateTimeline`
 *   result, so a per-frame caller never evaluates the timeline twice.
 * @returns {{ at: number, rows: Array<{ trackId: string|null, trackIndex:
 *   number, layers: object[] }>, base: object|null }}
 *   `rows` is the paint order, bottom first: `rows[0]` (also `base`) is the row
 *   a host with a single surface paints, and `compositePlan` stacks all of them.
 *   A `base` of `null` means no footage paints at this tick: the canvas shows
 *   its background, exactly as an uncovered gap does.
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

/** The same timeline resolution `evaluateTimeline` makes, so both see one shape. */
function timelineOf(input) {
  if (input && Array.isArray(input.tracks)) return input
  return input?.timeline ?? null
}

/**
 * Does this row hold a clip that can be live at some tick? Exactly the
 * condition `evaluateTimeline` applies to a clip (`span.duration > 0`), read
 * over the row instead of over one tick — so a row the per-tick law would never
 * name at the sampled ticks still counts, and a row of zero-length clips never
 * does.
 */
function hasLiveClip(track) {
  const items = Array.isArray(track?.items) ? track.items : []
  for (const clip of items) {
    if (clipSpan(clip).duration > 0) return true
  }
  return false
}

/**
 * The rows of the whole file, lane by lane, in the order each lane paints.
 *
 * This is `selectPaintRows` seen whole rather than at one tick: the footage
 * lanes are the union of the per-tick rows, so a host that builds one static
 * graph per render stacks precisely the rows the canvas stacks, and never picks
 * a bottom row of its own. Like the per-tick law it reports identity only —
 * `{ trackId, trackIndex }` — and the host joins the index back to the track it
 * authored.
 *
 * The lanes differ in one documented way: `audio` is not a picture lane, so the
 * picture rule never reads it. `hidden` is a picture control and `muted` is the
 * sound one, so a hidden audio row is still mixed — the same asymmetry
 * `evaluateTimeline` keeps (`visible` from `hidden`, `audible` from `muted`).
 * An empty audio row is harmless: the host pulls clips per clip.
 *
 * @param {{ timeline?: object } | { tracks: object[] }} input project or timeline
 * @returns {{ rows: object[], base: object|null, stacked: object[],
 *   overlays: object[], audio: object[] }}
 *   `rows` (== `base` then `stacked`) is the footage stack, bottom first;
 *   `overlays` the text rows, in track order, painted above all footage;
 *   `audio` every audio row.
 */
export function selectFileRows(input) {
  const timeline = timelineOf(input)
  const tracks = Array.isArray(timeline?.tracks) ? timeline.tracks : []
  const rows = []
  const overlays = []
  const audio = []
  for (let index = 0; index < tracks.length; index++) {
    const track = tracks[index]
    const type = track?.type
    if (type !== 'video' && type !== 'text' && type !== 'audio') continue
    const row = { trackId: track.id ?? null, trackIndex: index }
    // The sound lane takes the picture rule out of it entirely: `hidden` is a
    // picture control, and an empty audio row costs the host nothing.
    if (type === 'audio') {
      audio.push(row)
      continue
    }
    if (track.hidden === true) continue
    if (!hasLiveClip(track)) continue
    if (type === 'video') rows.push(row)
    else overlays.push(row)
  }
  return {
    rows,
    base: rows[0] ?? null,
    stacked: rows.slice(1),
    overlays,
    audio
  }
}
