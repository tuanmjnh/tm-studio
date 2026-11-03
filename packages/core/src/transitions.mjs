// =============================================================================
//  tmcut-core — transitions (Roadmap C5)
//  Pure transition operations on plain Timeline DSL v3 objects.
//
//  Overlap model: a transition attaches to the FOLLOWING clip as
//  `transitionIn = { type, duration }` (ticks) and the helper looks up the
//  clip immediately before it. Applying shifts the clip left by `duration`
//  so its head genuinely overlaps the neighbor's tail — the only model with
//  continuous playback on BOTH layers (no position jump at the window
//  edges). Clearing shifts the clip back right by exactly the stored
//  duration, restoring the original cut position. Only the clip carrying
//  the transition moves; later clips on the track stay put (the gap after
//  it widens by the same amount, so re-applying with a new duration is a
//  pure local swap — positions outside the pair never change).
//
//  Lock-aware per the core convention: locked tracks refuse apply/clear
//  with reason 'locked' (a documented extension of the spec's reason
//  union — the core never mutates locked tracks).
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import { clipDurationTicks, clipEndTicks, clipSpan, findClip } from './timeline.mjs'

// The 6 original keys keep their order and semantics (stored projects).
// The 39 keys added in R128 are the remaining FFmpeg `xfade` transition
// names (alphabetical): the renderer maps any of them straight to
// `xfade=transition=<name>` — see the app-side catalog (fxCatalog.ts)
// for the UI categories and the legacy-name aliases (wipe-left -> wipeleft…).
export const KNOWN_TRANSITIONS = [
  'fade',
  'dissolve',
  'wipe-left',
  'wipe-right',
  'slide-left',
  'zoom-in',
  'circleclose',
  'circlecrop',
  'circleopen',
  'diagbl',
  'diagbr',
  'diagtl',
  'diagtr',
  'distance',
  'fadeblack',
  'fadegrays',
  'fadewhite',
  'hblur',
  'hlslice',
  'hrslice',
  'horzclose',
  'horzopen',
  'pixelize',
  'radial',
  'rectcrop',
  'slidedown',
  'slideright',
  'slideup',
  'smoothdown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'squeezeh',
  'squeezev',
  'vertclose',
  'vertopen',
  'vdslice',
  'vuslice',
  'wipebl',
  'wipebr',
  'wipedown',
  'wipetl',
  'wipetr',
  'wipeup',
  'zoomin'
]

// Positions round-trip through the app's v1 seconds model (1e-4 s grid),
// so adjacency is checked with a 1 ms tolerance instead of exact ticks.
const ADJACENCY_EPS = TICKS_PER_SECOND / 1000

/**
 * The cut position the neighbor must touch. A clip that already carries a
 * transition sits `duration` ticks LEFT of the original cut, so the
 * "un-shifted" view adds the stored duration back before checking.
 */
function effectiveStart(clip) {
  const stored = clip.transitionIn?.duration
  const existing = typeof stored === 'number' && stored > 0 ? stored : 0
  return clip.timeline.start + existing
}

/**
 * Validate a transition before applying it (Roadmap C5).
 * `durationTicks` is the requested overlap. Reasons:
 *  - 'no-neighbor'   clip id unknown, or no clip ends at the cut
 *  - 'gap'           a clip precedes it but does not touch the cut
 *  - 'too-long'      duration <= 0, or longer than either clip of the pair
 *  - 'unknown-type'  type outside KNOWN_TRANSITIONS
 *  - 'locked'        the clip sits on a locked track (extension, see header)
 * When ok, `overlapTicks` echoes the duration that would be created.
 */
export function canApplyTransition(timeline, clipId, type, durationTicks) {
  const found = findClip(timeline, clipId)
  if (!found) return { ok: false, reason: 'no-neighbor' }
  if (found.track.locked) return { ok: false, reason: 'locked' }
  if (!KNOWN_TRANSITIONS.includes(type)) return { ok: false, reason: 'unknown-type' }
  if (!(durationTicks > 0)) return { ok: false, reason: 'too-long' }

  const cut = effectiveStart(found.clip)
  // Neighbor = the clip on this track ending closest before the cut.
  let neighbor = null
  for (const other of found.track.items) {
    if (other.id === clipId) continue
    const end = clipEndTicks(other)
    if (end > cut + ADJACENCY_EPS) continue
    if (!neighbor || end > clipEndTicks(neighbor)) neighbor = other
  }
  if (!neighbor) return { ok: false, reason: 'no-neighbor' }
  if (cut - clipEndTicks(neighbor) > ADJACENCY_EPS) return { ok: false, reason: 'gap' }

  const maxOverlap = Math.min(clipDurationTicks(neighbor), clipDurationTicks(found.clip))
  if (durationTicks > maxOverlap) return { ok: false, reason: 'too-long' }
  return { ok: true, overlapTicks: durationTicks }
}

/**
 * Apply `transitionIn` on the clip and shift it left by `durationTicks`
 * to create the overlap. Re-applying first restores the previous shift, so
 * the stored duration always equals the live shift. Returns false and
 * leaves the timeline untouched on any validation failure.
 */
export function applyTransition(timeline, clipId, type, durationTicks) {
  const check = canApplyTransition(timeline, clipId, type, durationTicks)
  if (!check.ok) return false
  const { clip } = findClip(timeline, clipId)
  // Drop the old shift first (re-apply with a new type/duration).
  const oldDuration = clip.transitionIn?.duration
  if (typeof oldDuration === 'number' && oldDuration > 0) {
    clip.timeline.start += oldDuration
  }
  clip.timeline.start = Math.max(0, clip.timeline.start - durationTicks)
  clip.transitionIn = { type, duration: Math.round(durationTicks) }
  return true
}

/**
 * Remove the transition and shift the clip back right by the stored
 * duration (restores the original cut). False when the clip is missing,
 * locked, or has no transition.
 */
export function clearTransition(timeline, clipId) {
  const found = findClip(timeline, clipId)
  if (!found || found.track.locked) return false
  const duration = found.clip.transitionIn?.duration
  if (!(typeof duration === 'number' && duration > 0)) return false
  found.clip.timeline.start += duration
  delete found.clip.transitionIn
  return true
}

// =============================================================================
//  Preview geometry (V4 G16)
//
//  The timeline preview used to know four xfade keys; the other 41 fell back to
//  a plain crossfade, so choosing `smoothleft` showed something the export would
//  never paint. This section is the single source of what a key LOOKS like.
//
//  Every row is measured, not designed. Method: solid black plate -> solid white
//  plate through `xfade=transition=<name>:duration=0.4:offset=0.8` at 320x180
//  with `resources/ffmpeg.exe` (N-126482-g903325e279-20260909), the 12 transition
//  frames decoded as gray, then read three ways — mean luminance is the fill
//  fraction (0 and 255 make it exact), the 50%-luminance crossing is the boundary
//  position, and which pixels are over 128 IS the shape. The third read is the
//  one that separates a family from its mirror: a wipe, a squeeze and a closing
//  band all cover exactly `travel` of the box, so no area number can tell them
//  apart, and the four `*slice` keys kept their stripes until the region read said
//  otherwise. `tests/unit/tmcut_transition_preview.spec.ts` re-runs the crossing,
//  the area and the region reads and fails if the laws below stop matching.
//
//  The offset is not a free parameter: xfade's window must END where the first
//  input ends (`offset = firstInputLength - duration`), which for these 1.2 s
//  plates is 0.8. An earlier sweep used 0.6, which leaves 0.2 s of the first
//  input with nowhere to go, and that placement — not the transition names — is
//  what made `squeezev` die mid-encode (22-27 of 60 frames, exit 0xC0000005,
//  unstable run to run; guards `tmcut_render_graph` and `tmcut_transition_preview`
//  re-measure both sides of that line). Re-measured at the legal window, every
//  fill-fraction number in `docs/v4-phase-0-audit.md` §8.1 reproduces unchanged;
//  `squeezev` is the row whose verdict moved, and no key is unrenderable, so the
//  `unavailable` shape and the export's name-degradation it drove are gone.
//
//  `fidelity` is part of the data, not a disclaimer, and the spec's tolerance is
//  the definition: 'exact' = the area AND the region agree with the frame to
//  within 3% of the box; 'shape' = the shape, direction and endpoints are
//  measured but the agreement is looser; 'approximate' = the binary does
//  something a two-layer CSS composite cannot show (a dither, a blur, a pass
//  through white), so only the reveal timing is carried over.
//
//  The region read is graded at the plate's own pixel resolution, because a
//  coarser sample grid invents error: at 80x45 the comb rows reported 6.7% and
//  at 320x180 the same geometry reports 1.7%. Graded that way, every hard-edged
//  row lands at or under 1.7% (comb 0.9-1.7, squeeze 0.3-0.6, wipe 0.3-0.6,
//  corner 0.4-0.6, slide 0.3-0.6, rect 0.3, circlecrop 0.0) and the 3% ceiling
//  has room. What does not land is the soft-fronted set, and the numbers are the
//  reason they are called 'shape': a hard edge painted at the measured timing
//  differs from a wide gradient ramp by 4.7-5.0% (`smooth*`, `band`), from a
//  diagonal ramp by 10.5% (`diag*`) and from a soft ring by 10.2% (`circleclose`,
//  `circleopen` — the disc's own law is exact to 3% of the area, but the ring is
//  several pixels wide and 10.2% of the box is on it). The ten `crossfade` rows
//  have no region to grade at all: a uniform layer alpha covers every pixel.
// =============================================================================

/**
 * Travel laws: how far the shape has moved at progress p. The constants are the
 * measured curves, not a style choice — `smoother` is the soft front (RMSE 0.008
 * over 12 frames), `inOutQuad` the diagonal family (once squared into the area a
 * triangular front covers, RMSE 0.023, worst frame 5.1%), `linear` the slice
 * family (its front position is literally `progress` in FFmpeg's band argument),
 * `late` the crop/zoom family (nothing before p=0.5), `iris` the disc (0.0 at
 * p=0.25, 0.5 at 0.5, 1.0 at 0.75 — measured, the iris really does open in the
 * middle half).
 *
 * For the comb, `travel` is the band position, not the covered area: the area is
 * the mean of the ten tooth fills and lags `travel` wherever the band is straddling
 * a tooth boundary. `previewTransitionRamp` reports that mean as `coverage`.
 *
 * `lateCube` and `radialLag` are fits, not borrowed shapes. `circlecrop` is the
 * crop family taken to the third power: the radius needed to reach the measured
 * area is 0.000/0.011/0.039/0.122/0.297/0.578/0.985 at p=0.5..0.917, which
 * `(2p-1)^3` reproduces to 0.5% RMSE — the law it replaces (nothing before
 * p=0.7, then linear) was off by 6.2% RMSE and 19.8% of the frame. `radialLag`
 * is the sweep's angle fraction, which the binary holds below `p` for the first
 * third of the window (0.0 at p=1/12, 0.117 at p=0.25 against a linear 0.25) and
 * only catches up at the end; an onset-and-power grid over the 12 frames bottoms
 * out at (0.18, 0.9) with 1.4% RMSE, where every law already in the table sits
 * at 7-8% and `linear` at 8.4%.
 */
export const XFADE_POSITION_LAWS = {
  linear: p => p,
  smoother: p => ((6 * p - 15) * p + 10) * p * p * p,
  inOutQuad: p => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2),
  smooth: p => 3 * p * p - 2 * p * p * p,
  sqrt: p => Math.sqrt(p),
  late: p => Math.max(0, 2 * p - 1),
  lateCube: p => Math.max(0, 2 * p - 1) ** 3,
  iris: p => Math.min(1, Math.max(0, 2 * p - 0.5)),
  radialLag: p => Math.min(1, Math.max(0, (p - 0.18) / 0.82)) ** 0.9
}

/**
 * `circle()` percentages resolve against sqrt(w^2 + h^2) / sqrt(2), while the
 * radius that reaches the farthest corner is sqrt(w^2 + h^2) / 2 — so the
 * covering radius is always 100/sqrt(2) % of the box, at any canvas aspect.
 */
const CIRCLE_COVER_PCT = 100 / Math.SQRT2

/**
 * Tooth period for the slice family, as a fraction of the axis: 1/10, counted
 * out of `fract(10.f * x / w)` in FFmpeg's `HLSLICE_TRANSITION` and confirmed by
 * the run-length read (ten bands along x for `hlslice`/`hrslice`, along y for
 * `vdslice`/`vuslice`). The preview used 1/6.
 */
export const XFADE_COMB_PERIOD = 1 / 10

/** The softstep band's half-width and its rate of travel, as FFmpeg writes them. */
const COMB_BAND = 0.5
const COMB_RATE = 1.5
const COMB_TEETH = Math.round(1 / XFADE_COMB_PERIOD)
const smooth01 = t => t * t * (3 - 2 * t)

/**
 * Fill fraction of tooth `k` at front position `travel`. The band's low edge
 * starts at `1 - 1.5 * travel` and each tooth's own length pushes it: the pixel
 * partway into tooth k sits at `x/w = (k + f) / N`, so the crossing is the fixed
 * point of `f = smooth01(clamp(((k + f) / N - s0) / band))`. Four iterations
 * converge well inside a pixel at N=10.
 */
function combTooth(k, travel) {
  const s0 = 1 - COMB_RATE * travel
  const g = t => smooth01(Math.min(1, Math.max(0, (t - s0) / COMB_BAND)))
  let f = g(k / COMB_TEETH)
  for (let i = 0; i < 4; i++) f = g((k + f) / COMB_TEETH)
  return f
}

/**
 * The soft fronts are measured but not painted: a gradient mask whose ramp is
 * 37% of the axis (`smooth*`) or 70% (`diag*`) cannot reach alpha 0 at p=0 and
 * alpha 1 at p=1, so it leaks the incoming clip at both ends. The preview uses
 * the hard edge — the timing and geometry carry over, the softness does not.
 */
const SOFT_EDGE = 'measured soft front painted as a hard edge'

/**
 * Shape per key. `from` names the edge or corner the INCOMING clip enters from
 * (measured — `wipe-left` enters at the right edge and the boundary travels
 * left, which is why its clip-path is an inset on the left). `travel` is the
 * axis a band moves along, `mode` whether it opens from the middle or closes
 * from both edges.
 */
export const XFADE_PREVIEW = {
  'fade': { shape: 'crossfade', law: 'linear', fidelity: 'exact' },
  'dissolve': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'pixel dither' },
  'wipe-left': { shape: 'wipe', from: 'right', law: 'linear', fidelity: 'exact' },
  'wipe-right': { shape: 'wipe', from: 'left', law: 'linear', fidelity: 'exact' },
  'slide-left': { shape: 'slide', from: 'right', law: 'linear', fidelity: 'exact' },
  'zoom-in': { shape: 'crossfade', law: 'late', fidelity: 'approximate', note: 'scale is invisible on a solid plate' },
  'circleclose': { shape: 'hole', law: 'iris', fidelity: 'shape', note: 'soft ring around the disc' },
  'circlecrop': { shape: 'iris', law: 'lateCube', fidelity: 'exact' },
  'circleopen': { shape: 'iris', law: 'iris', fidelity: 'shape', note: 'soft ring around the disc' },
  'diagbl': { shape: 'diag', from: 'top right', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'diagbr': { shape: 'diag', from: 'top left', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'diagtl': { shape: 'diag', from: 'bottom right', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'diagtr': { shape: 'diag', from: 'bottom left', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'distance': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'per-pixel luma pick' },
  'fadeblack': { shape: 'crossfade', law: 'smooth', tint: 'black', fidelity: 'approximate' },
  'fadegrays': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'desaturated blend' },
  'fadewhite': { shape: 'crossfade', law: 'sqrt', tint: 'white', fidelity: 'approximate' },
  'hblur': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'blur ramp' },
  // There is a comb family, and it is not the one this table first carried. Read
  // as runs of incoming pixels along the axis, `hlslice` at p=0.5 fills
  // 0.000/0.000/0.000/0.006/0.31/0.72/0.97/1/1/1 of ten equal bands — 10 teeth
  // (period 1/10 of the axis), each filled from its own low end, with the fill
  // fraction increasing toward the edge the key names (`hlslice` from the right,
  // `hrslice` the left, `vdslice` the top, `vuslice` the bottom). The old row
  // had 6 teeth of a uniform width, so the preview painted a different comb than
  // the export: same area, wrong cut. Guards: `tmcut_transition_preview` grades
  // the tooth positions against the frame.
  'hlslice': { shape: 'comb', from: 'right', law: 'linear', fidelity: 'exact' },
  'hrslice': { shape: 'comb', from: 'left', law: 'linear', fidelity: 'exact' },
  'horzclose': { shape: 'band', travel: 'y', mode: 'close', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'horzopen': { shape: 'band', travel: 'y', mode: 'open', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'pixelize': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'block ramp' },
  // The sweep's origin and direction are the model's (measured against the
  // frame: the wedge grows from 12 o'clock clockwise), only its timing lags —
  // see `radialLag`. The fidelity stays `shape` because the conic area bursts
  // twice per turn, at the corners, where d(area)/d(angle) is 4x the value at
  // the edge midpoints: 1.4% of travel costs 3.0% of the frame.
  'radial': { shape: 'pie', law: 'radialLag', fidelity: 'shape', note: 'corner bursts amplify the law error into the area' },
  'rectcrop': { shape: 'rect', law: 'late', fidelity: 'exact' },
  'slidedown': { shape: 'slide', from: 'top', law: 'linear', fidelity: 'exact' },
  'slideright': { shape: 'slide', from: 'left', law: 'linear', fidelity: 'exact' },
  'slideup': { shape: 'slide', from: 'bottom', law: 'linear', fidelity: 'exact' },
  'smoothdown': { shape: 'softwipe', from: 'top', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'smoothleft': { shape: 'softwipe', from: 'right', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'smoothright': { shape: 'softwipe', from: 'left', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'smoothup': { shape: 'softwipe', from: 'bottom', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  // The squeeze family, measured frame by frame on the window the export
  // emits (`offset = firstInputLength - duration`): the incoming arrives as
  // two hard-edged bands eating in from opposite edges, and the keys differ
  // only in which pair. `squeezeh` opens at the top and bottom (rows 0-7 and
  // 173-179 of 180 at p=1/12, all columns), `squeezev` at the left and right
  // (cols 0-13 and 307-319 of 320, all rows) — so `travel` names the axis the
  // FRONT moves along, the opposite letter from the name. The `band` rows
  // above and below already follow that convention and measure correctly; an
  // area curve cannot tell the two squeezes apart (each covers exactly
  // `travel` of the box), which is how the swap survived until the render
  // smoke spec started grading position.
  'squeezeh': { shape: 'squeeze', travel: 'y', law: 'linear', fidelity: 'exact' },
  // Renders, and is the mirror of the row above. It used to read `unavailable`
  // because the probe that produced that verdict placed the window at
  // `offset=0.6` on 1.2 s plates — not the tail-aligned window the graph
  // builds — and xfade exits 0xC0000005 on `squeezev` only in that position.
  'squeezev': { shape: 'squeeze', travel: 'x', law: 'linear', fidelity: 'exact' },
  'vertclose': { shape: 'band', travel: 'x', mode: 'close', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'vertopen': { shape: 'band', travel: 'x', mode: 'open', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'vdslice': { shape: 'comb', from: 'top', law: 'linear', fidelity: 'exact' },
  'vuslice': { shape: 'comb', from: 'bottom', law: 'linear', fidelity: 'exact' },
  'wipebl': { shape: 'corner', from: 'bl', law: 'linear', fidelity: 'exact' },
  'wipebr': { shape: 'corner', from: 'br', law: 'linear', fidelity: 'exact' },
  'wipedown': { shape: 'wipe', from: 'top', law: 'linear', fidelity: 'exact' },
  'wipetl': { shape: 'corner', from: 'tl', law: 'linear', fidelity: 'exact' },
  'wipetr': { shape: 'corner', from: 'tr', law: 'linear', fidelity: 'exact' },
  'wipeup': { shape: 'wipe', from: 'bottom', law: 'linear', fidelity: 'exact' },
  'zoomin': { shape: 'crossfade', law: 'late', fidelity: 'approximate', note: 'scale is invisible on a solid plate' }
}

const FALLBACK = { shape: 'crossfade', law: 'linear', fidelity: 'approximate' }
const AXIS_OF = { left: 'X', right: 'X', top: 'Y', bottom: 'Y' }
/** +1 = the incoming starts off-box on the `from` side and travels inward. */
const TRAVEL_SIGN = { left: -1, right: 1, top: -1, bottom: 1 }
/**
 * A gradient's first stop sits on the side OPPOSITE its `to` keyword, so the
 * keyword is the direction of travel, not the edge the clip enters from.
 */
const TRAVEL_DIR = {
  'left': 'right', 'right': 'left', 'top': 'bottom', 'bottom': 'top',
  'top left': 'bottom right', 'top right': 'bottom left',
  'bottom left': 'top right', 'bottom right': 'top left'
}
// The side of the box the incoming has NOT covered yet gets the inset.
const WIPE_INSET = { right: [0, 0, 0, 1], left: [0, 1, 0, 0], top: [0, 0, 1, 0], bottom: [1, 0, 0, 0] }
// Outgoing retreats into its corner (measured — the wipebl frame at p=0.25 is
// the complement of the rect [0, 0.75] x [0.23, 1]), so the incoming is the
// L-shaped remainder of a square of side `s` sitting in that corner.
const CORNER_L = {
  bl: s => `polygon(0% 0%, 100% 0%, 100% 100%, ${pct(s)} 100%, ${pct(s)} ${pct(1 - s)}, 0% ${pct(1 - s)})`,
  br: s => `polygon(0% 0%, 100% 0%, 100% ${pct(1 - s)}, ${pct(1 - s)} ${pct(1 - s)}, ${pct(1 - s)} 100%, 0% 100%)`,
  tl: s => `polygon(${pct(s)} 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${pct(s)}, ${pct(s)} ${pct(s)})`,
  tr: s => `polygon(0% 0%, ${pct(1 - s)} 0%, ${pct(1 - s)} ${pct(s)}, 100% ${pct(s)}, 100% 100%, 0% 100%)`
}
// A diagonal front: the covered triangle at the entry corner while less than
// half the box is revealed, then the box with the far corner's triangle cut
// out. `leg` runs along both box edges meeting at that corner, and the triangle
// it spans covers leg^2 / 2 of the box.
const CORNER_TRI = {
  'top left': leg => `polygon(0% 0%, ${pct(leg)} 0%, 0% ${pct(leg)})`,
  'top right': leg => `polygon(100% 0%, ${pct(1 - leg)} 0%, 100% ${pct(leg)})`,
  'bottom left': leg => `polygon(0% 100%, ${pct(leg)} 100%, 0% ${pct(1 - leg)})`,
  'bottom right': leg => `polygon(100% 100%, ${pct(1 - leg)} 100%, 100% ${pct(1 - leg)})`
}
const CORNER_CUT = {
  'top left': leg => `polygon(${pct(leg)} 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${pct(leg)})`,
  'top right': leg => `polygon(0% 0%, ${pct(1 - leg)} 0%, 100% ${pct(leg)}, 100% 100%, 0% 100%)`,
  'bottom left': leg => `polygon(0% 0%, 100% 0%, 100% 100%, ${pct(leg)} 100%, 0% ${pct(1 - leg)})`,
  'bottom right': leg => `polygon(0% 0%, 100% 0%, 100% ${pct(1 - leg)}, ${pct(1 - leg)} 100%, 0% 100%)`
}

const pct = v => `${(v * 100).toFixed(2)}%`

/**
 * Both edges covered, the middle left for the layer underneath — the shape a
 * `close` band and a squeeze leave behind. The depth per edge is `travel / 2`,
 * so the covered fraction is exactly `travel` and both endpoints are clean.
 */
function edgeBands(dir, travel) {
  const in1 = pct(travel / 2)
  const in2 = pct(1 - travel / 2)
  return `linear-gradient(to ${dir}, #000 0 ${in1}, transparent ${in1} ${in2}, #000 ${in2})`
}

/** One mask layer covers the box once; a tiled mask would repeat the front. */
function maskLayers(image) {
  return {
    maskImage: image,
    webkitMaskImage: image,
    maskSize: '100% 100%',
    webkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    webkitMaskRepeat: 'no-repeat'
  }
}

/**
 * The preview face of one xfade key at progress `p` (0 = the outgoing whole,
 * 1 = the incoming whole). Returns the travel value, the predicted covered
 * fraction and the two layer style objects — plain CSS strings, so the player
 * owns no geometry decision and a test can assert the numbers without a
 * browser.
 *
 * The player paints the incoming clip OVER the outgoing one, so every reveal is
 * expressed on the INCOMING layer: clipping the outgoing would only uncover the
 * black canvas behind it. `slide` is the exception — both layers travel.
 */
export function previewTransitionRamp(type, p) {
  const spec = XFADE_PREVIEW[type] || FALLBACK
  const progress = Math.min(1, Math.max(0, Number(p) || 0))
  const travel = XFADE_POSITION_LAWS[spec.law || 'linear'](progress)
  const incoming = { opacity: 1 }
  const outgoing = { opacity: 1 }
  let coverage = travel
  switch (spec.shape) {
    case 'wipe':
    case 'softwipe': {
      const [t, r, b, l] = WIPE_INSET[spec.from]
      const rest = 1 - travel
      incoming.clipPath = `inset(${pct(t * rest)} ${pct(r * rest)} ${pct(b * rest)} ${pct(l * rest)})`
      break
    }
    case 'slide': {
      const sign = TRAVEL_SIGN[spec.from]
      incoming.transform = `translate${AXIS_OF[spec.from]}(${(sign * (1 - travel) * 100).toFixed(2)}%)`
      outgoing.transform = `translate${AXIS_OF[spec.from]}(${(-sign * travel * 100).toFixed(2)}%)`
      break
    }
    case 'squeeze':
      // The outgoing shrinks to a band in FFmpeg; over the incoming that is the
      // same picture as the two edges eating in, which is what the layer order
      // can actually paint.
      Object.assign(incoming, maskLayers(edgeBands(spec.travel === 'y' ? 'bottom' : 'right', travel)))
      break
    case 'diag': {
      // `travel` is the FRONT POSITION and the covered AREA is its square: the
      // front is a 45-degree line in canvas proportions (measured — the p=0.5
      // frame of `diagbl` cuts the top edge at 0.31 and the right edge at 0.69,
      // equal legs), so a leg of length L covers L^2 / 2. That relation also
      // makes the diagonal aspect-free: the same area curve comes back at
      // 320x180, 180x320 and 200x200, spread by at most 0.1% of the frame.
      const area = travel * travel
      const leg = Math.sqrt(2 * (area <= 0.5 ? area : 1 - area))
      incoming.clipPath = area <= 0.5
        ? CORNER_TRI[spec.from](leg)
        : CORNER_CUT[TRAVEL_DIR[spec.from]](leg)
      coverage = area
      break
    }
    case 'band': {
      if (spec.mode === 'open') {
        const rest = pct((1 - travel) / 2)
        incoming.clipPath = spec.travel === 'y' ? `inset(${rest} 0%)` : `inset(0% ${rest})`
      } else {
        Object.assign(incoming, maskLayers(edgeBands(spec.travel === 'y' ? 'bottom' : 'right', travel)))
      }
      break
    }
    case 'comb': {
      // One gradient, `COMB_TEETH` teeth, each filled from its own low end by the
      // crossing computed above. No tile, no repeat: the stop list covers the box
      // exactly once, so the tooth positions are box fractions at any aspect.
      const stops = []
      let sum = 0
      for (let k = 0; k < COMB_TEETH; k++) {
        const f = combTooth(k, travel)
        sum += f
        const start = pct(k / COMB_TEETH)
        const end = pct((k + f) / COMB_TEETH)
        const next = pct((k + 1) / COMB_TEETH)
        stops.push(`#000 ${start} ${end}`, `transparent ${end} ${next}`)
      }
      Object.assign(incoming, maskLayers(`linear-gradient(to ${spec.from}, ${stops.join(', ')})`))
      coverage = sum / COMB_TEETH
      break
    }
    case 'corner': {
      const side = 1 - travel
      incoming.clipPath = CORNER_L[spec.from](side)
      coverage = 1 - side * side
      break
    }
    case 'iris':
      incoming.clipPath = `circle(${(travel * CIRCLE_COVER_PCT).toFixed(2)}% at 50% 50%)`
      // The disc is clipped by the box, so its area depends on the canvas
      // aspect; only the families with a fixed relation report a coverage.
      coverage = null
      break
    case 'hole':
      Object.assign(incoming, maskLayers(
        `radial-gradient(circle ${((1 - travel) * CIRCLE_COVER_PCT).toFixed(2)}% at 50% 50%, transparent 0 100%, #000 100%)`
      ))
      coverage = null
      break
    case 'rect':
      incoming.clipPath = `inset(${(((1 - travel) / 2) * 100).toFixed(2)}%)`
      coverage = travel * travel
      break
    case 'pie':
      Object.assign(incoming, maskLayers(
        `conic-gradient(from 0deg at 50% 50%, #000 ${(travel * 360).toFixed(2)}deg, transparent 0)`
      ))
      coverage = null
      break
    default: // 'crossfade'
      incoming.opacity = travel
      // A fade through black IS a two-partial-alpha composite: the dark canvas
      // behind the layers is the intermediate. Through white there is no such
      // backdrop, so only its early reveal timing carries over.
      if (spec.tint === 'black') outgoing.opacity = 1 - progress
      break
  }
  return {
    shape: spec.shape,
    law: spec.law || 'linear',
    fidelity: spec.fidelity || 'approximate',
    note: spec.note || null,
    travel,
    coverage,
    progress,
    incoming,
    outgoing
  }
}

/**
 * Overlap windows of one track: for every clip carrying a transition,
 * the region where both clips are live (`startTicks` = the clip's shifted
 * start, `endTicks` = the original cut = the neighbor's end). Pairs broken
 * by later edits (the neighbor no longer ends at the window end) are
 * skipped — they have no valid overlap region. Sorted by position.
 *
 * Spans go through `clipSpan`, so the app store's flat clips (no
 * `timeline`/`source`) resolve exactly like DSL v3 ones.
 */
export function transitionWindows(track) {
  const items = Array.isArray(track?.items) ? track.items : []
  const windows = []
  for (const clip of items) {
    const duration = clip.transitionIn?.duration
    if (!(typeof duration === 'number' && duration > 0)) continue
    const startTicks = clipSpan(clip).start
    const endTicks = startTicks + duration
    const outgoing = items.find(other =>
      other.id !== clip.id && Math.abs(clipSpan(other).end - endTicks) <= ADJACENCY_EPS)
    if (!outgoing) continue
    windows.push({ fromId: outgoing.id, toId: clip.id, startTicks, endTicks })
  }
  return windows.sort((a, b) => a.startTicks - b.startTicks)
}
