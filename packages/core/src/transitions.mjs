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
//  plate through `xfade=transition=<name>:duration=0.4:offset=0.6` at 320x180
//  with `resources/ffmpeg.exe` (N-126482-g903325e279-20260909), the 12 transition
//  frames decoded as gray, then read twice — mean luminance is the fill fraction
//  (0 and 255 make it exact) and the 50%-luminance crossing is the boundary
//  position. `tests/unit/tmcut_transition_preview.spec.ts` re-runs the crossing
//  read and fails if the laws below stop matching the binary.
//
//  `fidelity` is part of the data, not a disclaimer: 'exact' = the law matched
//  the measurement at >= 3 frames; 'shape' = the shape, direction and endpoints
//  are measured but the travel curve is fitted to 1-2 frames (a wide soft band
//  makes the fill fraction unreadable); 'approximate' = the binary does something
//  a two-layer CSS composite cannot show (a dither, a blur, a pass through white),
//  so only the reveal timing is carried over.
// =============================================================================

/**
 * Travel laws: how far the shape has moved at progress p. The constants are the
 * measured curves, not a style choice — `smoother` is the soft front (RMSE 0.008
 * over 12 frames), `inOutQuad` the slice family (0.020) and, once squared into
 * the area a triangular front covers, the diagonal family as well (RMSE 0.023,
 * worst frame 5.1%), `late` the crop/zoom family (nothing before p=0.5), `iris`
 * the disc (0.0 at p=0.25, 0.5 at 0.5, 1.0 at 0.75 — measured, the iris really
 * does open in the middle half).
 */
export const XFADE_POSITION_LAWS = {
  linear: p => p,
  smoother: p => ((6 * p - 15) * p + 10) * p * p * p,
  inOutQuad: p => (p < 0.5 ? 2 * p * p : 1 - ((-2 * p + 2) ** 2) / 2),
  smooth: p => 3 * p * p - 2 * p * p * p,
  sqrt: p => Math.sqrt(p),
  late: p => Math.max(0, 2 * p - 1),
  iris: p => Math.min(1, Math.max(0, 2 * p - 0.5)),
  irisLate: p => Math.min(1, Math.max(0, (p - 0.7) / 0.3))
}

/**
 * Strips per axis for the slice family: the hlslice frame repeats every 16%.
 */
export const XFADE_COMB_PERIOD = 1 / 6

/**
 * `circle()` percentages resolve against sqrt(w^2 + h^2) / sqrt(2), while the
 * radius that reaches the farthest corner is sqrt(w^2 + h^2) / 2 — so the
 * covering radius is always 100/sqrt(2) % of the box, at any canvas aspect.
 */
const CIRCLE_COVER_PCT = 100 / Math.SQRT2

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
  'circlecrop': { shape: 'iris', law: 'irisLate', fidelity: 'shape' },
  'circleopen': { shape: 'iris', law: 'iris', fidelity: 'exact' },
  'diagbl': { shape: 'diag', from: 'top right', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'diagbr': { shape: 'diag', from: 'top left', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'diagtl': { shape: 'diag', from: 'bottom right', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'diagtr': { shape: 'diag', from: 'bottom left', law: 'inOutQuad', fidelity: 'shape', note: SOFT_EDGE },
  'distance': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'per-pixel luma pick' },
  'fadeblack': { shape: 'crossfade', law: 'smooth', tint: 'black', fidelity: 'approximate' },
  'fadegrays': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'desaturated blend' },
  'fadewhite': { shape: 'crossfade', law: 'sqrt', tint: 'white', fidelity: 'approximate' },
  'hblur': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'blur ramp' },
  'hlslice': { shape: 'comb', from: 'right', law: 'inOutQuad', fidelity: 'shape' },
  'hrslice': { shape: 'comb', from: 'left', law: 'inOutQuad', fidelity: 'shape' },
  'horzclose': { shape: 'band', travel: 'y', mode: 'close', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'horzopen': { shape: 'band', travel: 'y', mode: 'open', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'pixelize': { shape: 'crossfade', law: 'linear', fidelity: 'approximate', note: 'block ramp' },
  'radial': { shape: 'pie', law: 'linear', fidelity: 'shape', note: 'area lags the angle near the corners' },
  'rectcrop': { shape: 'rect', law: 'late', fidelity: 'exact' },
  'slidedown': { shape: 'slide', from: 'top', law: 'linear', fidelity: 'exact' },
  'slideright': { shape: 'slide', from: 'left', law: 'linear', fidelity: 'exact' },
  'slideup': { shape: 'slide', from: 'bottom', law: 'linear', fidelity: 'exact' },
  'smoothdown': { shape: 'softwipe', from: 'top', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'smoothleft': { shape: 'softwipe', from: 'right', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'smoothright': { shape: 'softwipe', from: 'left', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'smoothup': { shape: 'softwipe', from: 'bottom', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'squeezeh': { shape: 'squeeze', travel: 'x', law: 'linear', fidelity: 'exact' },
  // Measured crash, not a naming slip: xfade=transition=squeezev exits
  // 0xC0000005 on solid plates at 320x180 and 640x360 and on testsrc2 ->
  // smptebars, while squeezeh completes. A preview that paints this as a
  // squeeze would be showing an effect the binary cannot render.
  'squeezev': { shape: 'unavailable', law: 'linear', fidelity: 'approximate', note: 'xfade crashes the bundled binary' },
  'vertclose': { shape: 'band', travel: 'x', mode: 'close', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'vertopen': { shape: 'band', travel: 'x', mode: 'open', law: 'smoother', fidelity: 'shape', note: SOFT_EDGE },
  'vdslice': { shape: 'comb', from: 'top', law: 'inOutQuad', fidelity: 'shape' },
  'vuslice': { shape: 'comb', from: 'bottom', law: 'inOutQuad', fidelity: 'shape' },
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

/** One mask layer needs the gradient stretched over the box, never tiled. */
function maskLayers(image) {
  const repeat = image.startsWith('repeating') ? 'repeat' : 'no-repeat'
  return {
    maskImage: image,
    webkitMaskImage: image,
    maskSize: '100% 100%',
    webkitMaskSize: '100% 100%',
    maskRepeat: repeat,
    webkitMaskRepeat: repeat
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
      const solid = pct(travel * XFADE_COMB_PERIOD)
      Object.assign(incoming, maskLayers(
        `repeating-linear-gradient(to ${TRAVEL_DIR[spec.from]}, #000 0 ${solid}, transparent ${solid} ${pct(XFADE_COMB_PERIOD)})`
      ))
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
    case 'unavailable':
      incoming.opacity = progress
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
