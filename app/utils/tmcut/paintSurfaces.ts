// The one answer to "what paints at this tick", shared by preview and export.
//
// core owns which layer of which row is the picture, which is a transition's
// outgoing partner, and what overlays the footage (`compositePlan`, built on the
// row law `selectPaintRows` — see Zero-FFmpeg F1). What core does not own, and
// what the app has to answer, is the join: which authored clip a slot belongs
// to, what media position its element must sit at, which surface carries the
// file's sound, and whether a crossfade is actually on screen.
//
// That answer used to live inside a `computed` in `useTmcutPlayback`, welded to
// the store's playhead. The exporter could not read it, because it paints at a
// frame index, not at the playhead — and a modal that re-implemented the mapping
// to get around that would be a second answer to what the file looks like. §53
// has spent four increments retiring exactly that pair-of-answers bug, so the
// law moved here instead: plain, reactive-free, and called once per tick by
// whoever has an evaluation. Both callers now see the same `PaintSurface` for
// the same `at`, which is what lets an export frame ask the decoder for the same
// instant the preview asked for.
import { compositePlan, ticksToSec } from 'tmcut-core'
import type { CoreEvaluatedLayer, CoreTimelineEvaluation } from 'tmcut-core'
import type { TmcutTimelineItem, TmcutTrack } from '~/composables/useTmcutProject'

/**
 * One footage surface the canvas must paint. Every number that decides where a
 * picture lands comes from the evaluator's layer BY REFERENCE: opacity,
 * transform and source position are core's for this tick, never a second
 * reading of the clip.
 */
export type PaintSurface = {
  key: string
  role: 'paint' | 'outgoing'
  trackId: string | null
  trackIndex: number
  clip: TmcutTimelineItem
  layer: CoreEvaluatedLayer
  mediaTimeSec: number
  /** True on the bottom row's picture: the surface whose sound the file carries. */
  ownsAudio: boolean
  /** True when this surface's crossfade partner is on screen with it. */
  crossfades: boolean
}

/**
 * One text overlay the canvas paints at this tick. Same shape rule as a footage
 * surface: the authored clip rides along for editing (drag, selection, the
 * Inspector), and every painted number comes from the layer BY REFERENCE.
 */
export type TextSurface = {
  clip: TmcutTimelineItem
  layer: CoreEvaluatedLayer
}

export interface SurfaceAnswer {
  footage: PaintSurface[]
  text: TextSurface[]
}

/**
 * The surfaces for one `evaluateTimeline` result, in core's stack order.
 *
 * `tracks` is the authored list the evaluation was made from — the plan indexes
 * rows, it does not carry clips, so the join back is one lookup by core's own
 * index. Nothing here re-decides whether a slot exists: a slot that core did not
 * produce is not painted, and a live layer core gave no source position for
 * paints nothing, because a position the app invented (`clip.in + local * speed`,
 * NaN when there is no `in`) is how an element used to sit parked on the first
 * source frame while the drift check re-seeked it every tick.
 */
export function surfacesAt(
  tracks: readonly TmcutTrack[] | undefined,
  evaluation: CoreTimelineEvaluation | null | undefined
): SurfaceAnswer {
  const footage: PaintSurface[] = []
  const text: TextSurface[] = []
  if (!tracks) return { footage, text }

  const plan = compositePlan(evaluation)
  let audioClaimed = false
  for (const slot of plan.slots) {
    const clip = tracks[slot.trackIndex]?.items?.find(item => item.id === slot.clipId)
    if (!clip) continue
    if (slot.kind === 'overlay') {
      text.push({ clip, layer: slot.layer })
      continue
    }
    if (slot.kind !== 'footage') continue
    if (slot.layer.sourceTicks === null) continue
    const ownsAudio = slot.role === 'paint' && !audioClaimed
    if (ownsAudio) audioClaimed = true
    footage.push({
      key: `${slot.trackId}:${slot.clipId}:${slot.role}`,
      role: slot.role,
      trackId: slot.trackId,
      trackIndex: slot.trackIndex,
      clip,
      layer: slot.layer,
      mediaTimeSec: ticksToSec(slot.layer.sourceTicks),
      ownsAudio,
      crossfades: false
    })
  }

  // A crossfade only exists when BOTH of its layers are on screen. The plan
  // hands the outgoing slot directly under its picture, so that adjacency IS
  // the pair; a layer whose partner was trimmed away keeps painting as the
  // plain cut `compositePlan` decided, with no ramp on it.
  for (let index = 1; index < footage.length; index++) {
    const below = footage[index - 1]
    const above = footage[index]
    if (!below || !above) continue
    if (below.role === 'outgoing' && above.role === 'paint'
      && below.trackIndex === above.trackIndex) {
      below.crossfades = true
      above.crossfades = true
    }
  }

  return { footage, text }
}
