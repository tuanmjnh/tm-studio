// =============================================================================
//  tmcut-core — audio mix plan
//  Which layers make SOUND at one tick — at what gain, at what position in their
//  own file, at what element rate (Zero-FFmpeg G3 + G4).
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
//
//  Slice G4 gave the same answer for TIME: each source also carries where it is
//  inside its own file (`mediaTicks`, the evaluator's own `sourceTicks`), the
//  rate its media element must run at, and whether an element can play it at
//  all. Those were three private laws on the screen — one per leg, plus the
//  export's own divisor — so a 6x clip could run its picture at 6x and its
//  sound at 1x, and a ramped bed reached the end of the file late.
// =============================================================================

import { compositePlan } from './composite.mjs'
import { clampedElementRate } from './retime.mjs'

/** A layer contributes its evaluated gain, and nothing at all when muted. */
function gainOf(layer) {
  return layer.audible === false ? 0 : layer.volume
}

/**
 * Where this layer is in its own file, how fast its element must run, and whether
 * a media element can play it at all. The position is the evaluator's number —
 * trim, speed and ramp are already folded into it — so the sound cannot be
 * retimed apart from the picture that came from the same tick.
 */
function playoutOf(layer, shuttle) {
  const refusal = layer.reverse === true ? 'reverse' : null
  return {
    mediaTicks: Number.isFinite(layer.sourceTicks) ? layer.sourceTicks : null,
    rate: clampedElementRate(layer.sourceRate, shuttle),
    plays: refusal === null,
    refusal
  }
}

/**
 * The sources one mix holds at one tick, in the order the host should build them.
 *
 * @param {{ at?: number, tracks?: object[] }} evaluation an `evaluateTimeline`
 *   result — never a project, so the caller does not evaluate the timeline twice.
 * @param {{ shuttle?: number }} [options] the host's own playhead multiplier —
 *   a shuttle is a fact about the clock the user is riding, not about the
 *   timeline. It composes with each clip's rate inside the element's window.
 * @returns {{ at: number, sources: Array<{ role: 'footage' | 'audio', clipId:
 *   string, trackId: string | null, trackIndex: number, gain: number,
 *   mediaTicks: number | null, rate: number, plays: boolean, refusal: string | null }> }}
 *   At most one `footage` source: the picture layer of the bottom paintable row.
 *   Then every live layer of every audio row, in track order. A text or overlay
 *   layer never sounds, and a tick with nothing live returns no sources.
 */
export function audioMixAt(evaluation, options = {}) {
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
      gain: gainOf(slot.layer),
      ...playoutOf(slot.layer, options.shuttle)
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
        gain: gainOf(layer),
        ...playoutOf(layer, options.shuttle)
      })
    }
  }

  return {
    at: Number.isFinite(evaluation?.at) ? evaluation.at : 0,
    sources
  }
}
