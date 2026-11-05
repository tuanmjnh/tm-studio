// =============================================================================
//  tmcut-core — audio mix plan
//  Which layers make SOUND at one tick, and with what gain (Zero-FFmpeg G3).
//
//  `evaluateTimeline` already answers the gain question per layer: `volume` is
//  the clip's keyframed volume, the track's volume and the fade envelope
//  multiplied together, and `audible` is the track's mute folded in. What no
//  module answered is the question a mixer actually asks first — WHICH layers
//  get a node. The preview held one answer (an `ownsAudio` flag set while it
//  walked its own surface list, plus a scan of the store's audio tracks), and
//  the export held another (one concat of the bottom footage row). Two answers
//  is how a file sounds different from the screen.
//
//  The footage leg is `compositePlan`'s, not a copy: the row whose PICTURE
//  paints owns the sound, which is the same bottom-row law the export has
//  always run, and it inherits the plan's two hard edges for free — a hidden
//  row hands the sound to the row that paints, and a crossfade window sounds
//  only its incoming clip because the outgoing layer is not the picture.
//
//  The audio leg keeps the asymmetry `paintStack.mjs` documents: `hidden` is a
//  picture control and `muted` is the sound one, so a hidden audio row is still
//  mixed and muting is left to `audible` rather than decided twice.
//
//  What this deliberately does NOT do: apply the master volume, or touch a Web
//  Audio node. The master belongs to the monitoring device the user is on, and
//  the graph belongs to the host — this module names the sources and their
//  gains so that both hosts sum the same set.
// =============================================================================

import { compositePlan } from './composite.mjs'

/** A layer contributes its evaluated gain, and nothing at all when muted. */
function gainOf(layer) {
  return layer.audible === false ? 0 : layer.volume
}

/**
 * The sources one mix holds at one tick, in the order the host should build them.
 *
 * @param {{ at?: number, tracks?: object[] }} evaluation an `evaluateTimeline`
 *   result — never a project, so the caller does not evaluate the timeline twice.
 * @returns {{ at: number, sources: Array<{ role: 'footage' | 'audio', clipId:
 *   string, trackId: string | null, trackIndex: number, gain: number }> }}
 *   At most one `footage` source: the picture layer of the bottom paintable row.
 *   Then every live layer of every audio row, in track order. A text or overlay
 *   layer never sounds, and a tick with nothing live returns no sources.
 */
export function audioMixAt(evaluation) {
  const sources = []
  let footageClaimed = false

  for (const slot of compositePlan(evaluation).slots) {
    if (slot.kind !== 'footage') continue
    if (footageClaimed || slot.role !== 'paint') continue
    footageClaimed = true
    sources.push({
      role: 'footage',
      clipId: slot.clipId,
      trackId: slot.trackId,
      trackIndex: slot.trackIndex,
      gain: gainOf(slot.layer)
    })
  }

  const entries = Array.isArray(evaluation?.tracks) ? evaluation.tracks : []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    if (entry?.type !== 'audio') continue
    const layers = Array.isArray(entry.layers) ? entry.layers : []
    for (const layer of layers) {
      if (layer?.clipId == null) continue
      sources.push({
        role: 'audio',
        clipId: layer.clipId,
        trackId: entry.id ?? null,
        trackIndex: index,
        gain: gainOf(layer)
      })
    }
  }

  return {
    at: Number.isFinite(evaluation?.at) ? evaluation.at : 0,
    sources
  }
}
