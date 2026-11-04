// =============================================================================
//  tmcut-core — composite plan
//  What each renderer paints at one tick, and in what order (V4 Phase 2, F1).
//
//  `evaluateTimeline` says which clips are live; `selectPaintRows` says which
//  footage ROWS are eligible. Neither answers the question a renderer actually
//  has: which surfaces does I create, and what goes on top? That needs three
//  more decisions — per row, which layer is the picture and which is a
//  transition's outgoing partner; across rows, the paint order; and above all
//  footage, which text overlays are live.
//
//  Those decisions used to live in the preview (`footageRow` + the crossfade
//  pair + `activeVideoClip` + `activeTextClips`, app/composables/useTmcutPlayback
//  .ts) and again, differently, in the exporter (`selectExportTracks`,
//  app/utils/tmcut/render/clip.ts). Two implementations of one law is the drift
//  this module exists to end: a project with two footage rows or a crossfade
//  could look right in the preview and render wrong on export, and no amount of
//  reviewing either side would catch it.
//
//  The plan is a SELECTION over an evaluation it is handed — it never evaluates
//  the timeline itself, so a per-frame caller stays at one evaluator pass, and
//  the row law it builds on is `selectPaintRows`, not a copy of it. It carries
//  the layer objects by reference: the plan is a reading of the evaluator's
//  answer, so making copies would let the two disagree.
//
//  What this deliberately does NOT decide: how a slot is put on screen. A host
//  with one <video> element and a DOM overlay still honours the same order —
//  `role: 'paint'` is the picture, `role: 'outgoing'` is the layer beneath it
//  during a crossfade, `kind: 'overlay'` paints last. Compositing strategy is
//  the host's; the SET and its ORDER are core's.
// =============================================================================

import { selectPaintRows } from './paintStack.mjs'

/** A slot carries a layer only when the evaluator gave it an identity to seek. */
function identifiable(layer) {
  return layer != null && layer.clipId != null
}

/**
 * The surfaces to paint at one tick, bottom of the stack first.
 *
 * @param {{ at?: number, tracks?: object[] }} evaluation an `evaluateTimeline`
 *   result, so the caller never evaluates the timeline twice.
 * @returns {{ at: number, slots: Array<{ kind: 'footage' | 'overlay', role:
 *   'paint' | 'outgoing', clipId: string, trackId: string | null, trackIndex:
 *   number, layer: object }> }}
 *   Footage slots come first in track order, and a row contributes its
 *   `outgoing` partner (when the playhead sits in a transition window) directly
 *   beneath its `paint` layer. Overlay slots follow every footage slot, in
 *   track order. A hidden row, an audio row or a gap contributes nothing.
 */
export function compositePlan(evaluation) {
  const slots = []

  for (const row of selectPaintRows(evaluation).rows) {
    const layers = row.layers.filter(identifiable)
    if (layers.length === 0) continue

    // A crossfade needs BOTH sides and a type to blend with; a window whose
    // partner was trimmed away is a plain cut, exactly as the preview treats it.
    const incoming = layers.find(layer =>
      layer.transition?.role === 'incoming' && layer.transition?.type)
    const outgoing = incoming
      ? layers.find(layer =>
          layer.clipId !== incoming.clipId && layer.transition?.role === 'outgoing')
      : undefined

    const stackable = outgoing ? layers.filter(layer => layer !== outgoing) : layers
    const paint = stackable[stackable.length - 1]
    if (!paint) continue

    // The outgoing layer sits UNDER the paint layer: a crossfade is the incoming
    // clip arriving over the clip that is leaving, never the other way round.
    if (outgoing) {
      slots.push({
        kind: 'footage',
        role: 'outgoing',
        clipId: outgoing.clipId,
        trackId: row.trackId,
        trackIndex: row.trackIndex,
        layer: outgoing
      })
    }
    slots.push({
      kind: 'footage',
      role: 'paint',
      clipId: paint.clipId,
      trackId: row.trackId,
      trackIndex: row.trackIndex,
      layer: paint
    })
  }

  const entries = Array.isArray(evaluation?.tracks) ? evaluation.tracks : []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry?.type !== 'text') continue
    if (entry.hidden === true) continue
    const layers = Array.isArray(entry.layers) ? entry.layers : []
    for (const layer of layers) {
      if (!identifiable(layer)) continue
      slots.push({
        kind: 'overlay',
        role: 'paint',
        clipId: layer.clipId,
        trackId: entry.id ?? null,
        trackIndex: index,
        layer
      })
    }
  }

  return {
    at: Number.isFinite(evaluation?.at) ? evaluation.at : 0,
    slots
  }
}
