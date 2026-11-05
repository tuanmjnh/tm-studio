/**
 * V4 G16 — the preview transition geometry against the binary that ships it.
 *
 * `tmcut-core/transitions.mjs` owns the shape, the travel law and the CSS of
 * every xfade key, and `TmcutPreviewPlayer.vue` only paints what it is handed.
 * That claim is only worth as much as the measurement behind it, so this spec
 * re-runs the probe that produced the table: two solid plates through `xfade`,
 * one frame at a time, read three ways against the model.
 *
 *   coverage    the registry's analytic area curve vs the frame's mean luminance
 *               (black plate = 0, white = 1, so mean luminance IS the covered
 *               fraction);  <= 0.03 exact / <= 0.15 shape
 *   area        the CSS rasterized at the plate's pixel grid vs that luminance;
 *               <= 0.03 exact / <= 0.08 shape
 *   region      which pixels each side keeps, pixel for pixel, at three points
 *               of the ramp;                     <= 0.03 exact / <= 0.12 shape
 *
 * The third read is the one that separates a family from its mirror: a wipe, a
 * squeeze and a closing band all cover exactly `travel` of the box, so no area
 * number can tell them apart — and it is the read that turned the four `*slice`
 * keys from wipes into a comb.
 *
 * The probe window is the one the export emits: `offset = firstInputLength -
 * duration`, i.e. the overlap ENDS where the first input ends. Earlier revisions
 * of this file used `offset=0.6` on 1.2 s plates, which strands 0.2 s of the
 * first input with nowhere to go; every fill-fraction number reproduced at both
 * placements, but `squeezev` hard-crashed only at the illegal one, and that crash
 * is what got its row marked `unavailable` and the export degraded to a fade. The
 * last block re-measures both halves of that finding, so the window law is a
 * measurement here rather than a preference.
 *
 * Area alone cannot grade an axis: a squeeze, a band and a wipe all cover a
 * linear share of the box, and the two squeezes cover EXACTLY the same share. So
 * the block after the sweep also reads the band GEOMETRY out of the pixels and
 * compares it with the `travel` letter the registry declares — the assertion that
 * a swapped axis survives a luminance sweep and ships.
 *
 * The probe list is every (shape, law) pair the table declares, not a
 * representative subset: the guard under the sweep fails when a pair goes
 * unprobed, and when the fidelity census moves without a new measurement. The
 * full 45-key sweep lives in `docs/v4-phase-0-audit.md` §8.1. A key that fails
 * here means the preview shows a cut the export does not make.
 *
 * `resources/ffmpeg.exe` is git-ignored, so a machine without the binary skips
 * rather than fails — same convention as `tmcut_fx_catalog.spec.ts`.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { XFADE_PREVIEW, previewTransitionRamp } from 'tmcut-core'
import type { TmcutPreviewLayerStyle } from 'tmcut-core'
import { FFMPEG_XFADE_NAMES, xfadeNameFor } from '../../app/utils/tmcut/fxCatalog'
import { mapXfadeTransition } from '../../app/utils/tmcut/render'

const here = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  process.env.TMCUT_FFMPEG_PATH,
  join(here, '..', '..', 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
].filter(Boolean)
const BIN = CANDIDATES.find(c => existsSync(c))

const W = 320
const H = 180
// 1.2 s of 30 fps plates and a 0.4 s overlap: the tail-aligned window opens at
// offset = 1.2 - 0.4 = 0.8 s, so the transition occupies frames 24..36 and frame
// 24+i carries progress i/12. Frame 25 is the first frame with any incoming and
// 36 is the first fully incoming one.
const CLIP_SEC = 1.2
const DUR_SEC = 0.4
const OFFSET_SEC = CLIP_SEC - DUR_SEC
const FIRST_RAMP_FRAME = Math.round(OFFSET_SEC * 30)
const PLATE = (colour: string, w: number, h: number) => `color=c=${colour}:s=${w}x${h}:r=30:d=${CLIP_SEC}`

/** The 12 transition frames of one key, gray, or null when the render fails. */
function renderRamp(bin: string, name: string, w = W, h = H): Buffer | null {
  const res = spawnSync(bin, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', PLATE('black', w, h),
    '-f', 'lavfi', '-i', PLATE('white', w, h),
    '-filter_complex', `[0:v][1:v]xfade=transition=${name}:duration=${DUR_SEC}:offset=${OFFSET_SEC.toFixed(4)}`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ], { maxBuffer: 1 << 30, encoding: 'buffer', timeout: 120_000 })
  if (res.status !== 0) return null
  const frameBytes = w * h
  if (res.stdout.length < (FIRST_RAMP_FRAME + 12) * frameBytes) return null
  return res.stdout
}

/** Mean luminance of each transition frame, as the covered fraction of the box. */
function rampCoverage(buf: Buffer, w = W, h = H): number[] {
  const frameBytes = w * h
  const out: number[] = []
  for (let i = 1; i <= 12; i++) {
    const frame = buf.subarray((FIRST_RAMP_FRAME + i) * frameBytes, (FIRST_RAMP_FRAME + i + 1) * frameBytes)
    let sum = 0
    for (let px = 0; px < frameBytes; px++) sum += frame[px]
    out.push(sum / frameBytes / 255)
  }
  return out
}

/**
 * Which axis the reveal front travels along, read off one mid-ramp frame.
 *
 * A reveal that eats in from two opposite edges (a squeeze, a closing band) or
 * from a centered band outward leaves every row carrying incoming pixels when the
 * front moves along x, and every column when it moves along y — the other axis
 * always shows a gap. The two squeezes have the SAME area curve, so nothing in
 * the luminance sweep can tell them apart; this can, and it is the fact the
 * registry states as `travel`.
 */
function measuredFrontAxis(buf: Buffer, p: number, w = W, h = H): 'x' | 'y' | 'neither' {
  const frameBytes = w * h
  const at = FIRST_RAMP_FRAME + Math.round(p * 12)
  const frame = buf.subarray(at * frameBytes, (at + 1) * frameBytes)
  let rowsWithIncoming = 0
  let colsWithIncoming = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (frame[y * w + x] >= 250) {
        rowsWithIncoming++
        break
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (frame[y * w + x] >= 250) {
        colsWithIncoming++
        break
      }
    }
  }
  if (rowsWithIncoming === h && colsWithIncoming < w) return 'x'
  if (colsWithIncoming === w && rowsWithIncoming < h) return 'y'
  return 'neither'
}

/**
 * The same window law, but painted with real picture content instead of two
 * solid plates.
 *
 * A plate can only ever show luminance, so every read above answers "how much
 * of the box is covered". On `testsrc2` over `smptebars` each pixel of the two
 * sources has its own colour, so a rendered pixel can be matched to the clip it
 * came from: the fourth read asks WHICH clip is on top at this exact pixel.
 * Geometry that survives a hue edge, a moving needle and burned-in text is
 * geometry, not a luminance coincidence.
 *
 * The list is derived, not hand-picked: every key the registry calls `exact`
 * is graded, minus the blends. At a crossfade every pixel is a weighted mix of
 * both clips, so "which clip is this pixel from" has no answer there — grading
 * it would only re-measure the alpha law the plate reads already cover.
 */
const FOOTAGE_KEYS = Object.keys(XFADE_PREVIEW).filter(key =>
  XFADE_PREVIEW[key]!.fidelity === 'exact' && XFADE_PREVIEW[key]!.shape !== 'crossfade')
const FOOTAGE_SOURCES = ['testsrc2', 'smptebars']
const FOOTAGE_SRC = (name: string) => `${name}=s=${W}x${H}:r=30:d=${CLIP_SEC}`
// The prep chain the app's own compiled graph emits, so the frames the sources
// are graded on are the frames the transition received.
const FOOTAGE_PREP = `scale=${W}:${H}:force_original_aspect_ratio=decrease,`
  + `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,settb=1/30,fps=30,format=gbrp`
// A pixel two sources agree on cannot be attributed to either one, so it is
// set aside instead of being counted as a pass. Measured: 57600 pixels of the
// grid, this is the summed absolute channel difference it takes to tell them.
const FOOTAGE_SEP = 48
// How far one pixel may sit from the picture the model predicts before the read
// calls it off-model, summed over the three channels. Measured across the whole
// `exact` sweep: the mean lands near 11 and the tail is the resampler, not the
// geometry, so anything past a full channel-step of 64 per channel is a real
// disagreement. A pixel inside the model's own edge band is allowed to be off —
// a CSS front and an FFmpeg front are one pixel apart there, and `painted` says
// which of the two the preview will actually paint.
const OFF_MODEL_ERROR = 192

/** One source alone, as rgb24 frames — the ground truth for every pixel. */
function renderSource(bin: string, name: string): Buffer | null {
  const res = spawnSync(bin, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', FOOTAGE_SRC(name),
    '-filter_complex', `[0:v]${FOOTAGE_PREP}[v]`, '-map', '[v]',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
  ], { maxBuffer: 1 << 30, encoding: 'buffer', timeout: 120_000 })
  return res.status === 0 ? res.stdout : null
}

/** The same two sources through one xfade window, as rgb24 frames. */
function renderContentRamp(bin: string, xfade: string): Buffer | null {
  const res = spawnSync(bin, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', FOOTAGE_SRC(FOOTAGE_SOURCES[0]),
    '-f', 'lavfi', '-i', FOOTAGE_SRC(FOOTAGE_SOURCES[1]),
    '-filter_complex',
    `[0:v]${FOOTAGE_PREP}[a];[1:v]${FOOTAGE_PREP}[b];`
    + `[a][b]xfade=transition=${xfade}:duration=${DUR_SEC}:offset=${OFFSET_SEC.toFixed(4)}`,
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'
  ], { maxBuffer: 1 << 30, encoding: 'buffer', timeout: 120_000 })
  return res.status === 0 ? res.stdout : null
}

/**
 * Which source pixel a layer style puts at displayed pixel (k, j).
 *
 * A CSS transform is a sampler read backwards: `translateX(20%)` moves the
 * layer, so column k shows source column k - 0.2W, and `scaleX(0.75)` about the
 * centre shows source column (k - W/2)/0.75 + W/2. Those are the only two
 * families the ramp emits today, and a third one has to be taught here rather
 * than skipped — an unknown function would otherwise make the content read
 * grade a moving picture as if it stood still.
 */
type Sampler = (k: number, j: number) => Point

function layerSampler(style: TmcutPreviewLayerStyle): Sampler {
  let sx = 1
  let sy = 1
  let tx = 0
  let ty = 0
  for (const part of (style.transform || '').split(/\s+/).filter(Boolean)) {
    const fn = /^([a-zA-Z]+)\((-?[\d.]+)(%?)\)$/.exec(part)
    assert.ok(fn, `cannot sample "${part}" — this spec does not know that transform, so the content read would ignore real geometry`)
    const value = Number(fn![2])
    if (fn![1] === 'scaleX') sx = value
    else if (fn![1] === 'scaleY') sy = value
    else if (fn![1] === 'scale') {
      sx = value
      sy = value
    } else if (fn![1] === 'translateX') tx = fn![3] === '%' ? value / 100 * W : value
    else if (fn![1] === 'translateY') ty = fn![3] === '%' ? value / 100 * H : value
    else assert.fail(`cannot sample "${part}" — unknown transform function`)
  }
  return (k, j) => [(k + 0.5 - W / 2 - tx) / sx + W / 2, (j + 0.5 - H / 2 - ty) / sy + H / 2]
}

/** Bilinear at the sampler's coordinate, the way swscale samples the file. */
function sampleClip(buf: Buffer, frame: number, at: Point): [number, number, number] {
  const u = Math.min(W - 1.000001, Math.max(0, at[0] - 0.5))
  const v = Math.min(H - 1.000001, Math.max(0, at[1] - 0.5))
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const base = frame * W * H * 3
  const read = (x: number, y: number, c: number) => buf[base + (y * W + x) * 3 + c]
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const top = read(x0, y0, c) * (1 - fx) + read(x0 + 1, y0, c) * fx
    const bottom = read(x0, y0 + 1, c) * (1 - fx) + read(x0 + 1, y0 + 1, c) * fx
    out[c] = top * (1 - fy) + bottom * fy
  }
  return out
}

/**
 * Grade one transition frame against the picture the model predicts for it.
 *
 * Inside the window, output frame `FIRST_RAMP_FRAME + i` still carries outgoing
 * frame `FIRST_RAMP_FRAME + i` (the first clip runs from 0) and incoming frame
 * `i` (the second clip starts at the window), so the frame indices are derived,
 * not guessed. Each layer's own transform then says which source pixel belongs
 * at this displayed pixel, and the model says which of them is on top — or
 * neither, for a key that clips the outgoing as well, where the canvas behind
 * both layers is what the file paints. A pixel is gradable when the prediction
 * and its rivals differ by `FOOTAGE_SEP`, and it is right when the render sits
 * closest to the candidate the model chose. One number therefore grades the
 * region AND the geometry inside it: a solid plate cannot see a squeezed or a
 * cropped picture, this can.
 */
function contentAttribution(
  ramp: Buffer,
  outgoing: Buffer,
  incoming: Buffer,
  i: number,
  paintedIn: Region,
  paintedOut: Region,
  hasBlack: boolean,
  outSampler: Sampler,
  inSampler: Sampler
): { graded: number, attributed: number, ambiguous: number, offModel: number } {
  const frameBytes = W * H * 3
  const outFrame = FIRST_RAMP_FRAME + i
  const inFrame = i
  const BLACK: [number, number, number] = [0, 0, 0]
  const dist = (a: [number, number, number], b: [number, number, number]) =>
    Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
  let graded = 0
  let attributed = 0
  let ambiguous = 0
  let offModel = 0
  for (let j = 0; j < H; j++) {
    for (let k = 0; k < W; k++) {
      const at = (outFrame * frameBytes) + (j * W + k) * 3
      const shown: [number, number, number] = [ramp[at], ramp[at + 1], ramp[at + 2]]
      const pt: Point = [(k + 0.5) / W, (j + 0.5) / H]
      const here = sampleClip(outgoing, outFrame, outSampler(k, j))
      const there = sampleClip(incoming, inFrame, inSampler(k, j))
      // The candidates, best-explained first: the layer the model puts on top,
      // then what sits under it, then — only for a model that clips the outgoing
      // as well — the black canvas behind both of them.
      const onCanvas = hasBlack && !paintedIn(pt) && !paintedOut(pt)
      const layers = onCanvas
        ? [BLACK, here, there]
        : paintedIn(pt) ? [there, here] : [here, there]
      const rivals = layers.slice(1)
      const separation = Math.min(...rivals.map(other => dist(layers[0], other)))
      if (separation < FOOTAGE_SEP) {
        ambiguous++
        continue
      }
      graded++
      const predicted = dist(shown, layers[0])
      const competing = Math.min(...rivals.map(other => dist(shown, other)))
      if (predicted <= competing) attributed++
      if (predicted > OFF_MODEL_ERROR) offModel++
    }
  }
  return { graded, attributed, ambiguous, offModel }
}

/**
 * The two region reads, graded at the plate's own pixel resolution.
 *
 * `previewTransitionRamp` hands the player CSS strings and the browser turns
 * them into a set of pixels; `modelRegion` is that set, and `measuredRegion`
 * reads the same set out of a rendered frame — the white plate IS the incoming
 * clip, so a pixel over 128 is inside it. A coarser sample grid invents error:
 * the comb rows report 6.7% disagreement on an 80x45 grid and 1.7% on this one.
 */
type Point = [number, number]
type Region = (pt: Point) => boolean

/** One sample per pixel of the plate, at its centre. */
const GRID: Point[] = []
for (let j = 0; j < H; j++) {
  for (let i = 0; i < W; i++) GRID.push([(i + 0.5) / W, (j + 0.5) / H])
}

const toUnit = (s: string) => Number(s.replace('%', '')) / 100
/** CSS `circle()` percentages resolve against sqrt(w^2 + h^2) / sqrt(2). */
const COVER_PX = Math.sqrt(W * W + H * H) / Math.SQRT2

function polygonPoints(css: string): Point[] {
  return css.replace(/^polygon\(/, '').replace(/\)$/, '').split(',').map((tok) => {
    const parts = tok.trim().split(/\s+/)
    return [toUnit(parts[0]), toUnit(parts[1])]
  })
}

function pointInPolygon(pt: Point, poly: Point[]): boolean {
  let inside = false
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const [xi, yi] = poly[a]
    const [xj, yj] = poly[b]
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** A gradient split into its stops, with commas nested in functions kept out. */
function gradientParts(css: string): string[] {
  const body = css.replace(/^[a-z-]+\(/, '').replace(/\)$/, '')
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}

/** Gradient keyword -> axis, and whether the ramp runs with that coordinate. */
const GRADIENT_DIR: Record<string, ['x' | 'y', number]> = {
  'to bottom': ['y', 1], 'to top': ['y', -1], 'to right': ['x', 1], 'to left': ['x', -1]
}

type Stop = { colour: string, from: number, to: number }

function gradientStops(parts: string[]): Stop[] {
  return parts.slice(1).map((part) => {
    const toks = part.split(/\s+/)
    const at = (k: number) => (toks[k].endsWith('%') ? toUnit(toks[k]) : Number(toks[k]) / 100)
    if (toks.length === 3) return { colour: toks[0], from: at(1), to: at(2) }
    if (toks.length === 2) return { colour: toks[0], from: at(1), to: at(1) }
    return { colour: toks[0], from: 0, to: 0 }
  })
}

/**
 * The pixels the incoming layer would keep. null is a form this spec cannot
 * paint — and the caller fails on it, because a silent skip is how the region
 * grade stops being a guard.
 */
function modelRegion(incoming: TmcutPreviewLayerStyle): Region | null {
  const clip = incoming.clipPath || ''
  const mask = incoming.maskImage || ''
  if (clip.startsWith('inset(')) {
    // inset() is a shorthand: 1 value = all edges, 2 = [v, h], 3 = [t, h, b],
    // 4 = [t, r, b, l]. Reading only the four-value form makes every shorter
    // row an empty region, i.e. a disagreement as large as the coverage.
    const vals = clip.slice(6, -1).trim().split(/\s+/).map(toUnit)
    const [t, r = t, b = t, l = r] = vals
    return ([u, v]) => u >= l && u <= 1 - r && v >= t && v <= 1 - b
  }
  if (clip.startsWith('polygon(')) {
    const poly = polygonPoints(clip)
    return pt => pointInPolygon(pt, poly)
  }
  if (clip.startsWith('circle(')) {
    const m = /^circle\(([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%\)$/.exec(clip)
    if (!m) return null
    const r = toUnit(m[1]) * COVER_PX
    const cx = toUnit(m[2]) * W
    const cy = toUnit(m[3]) * H
    return ([u, v]) => ((u * W - cx) ** 2 + (v * H - cy) ** 2) <= r * r
  }
  if (mask.startsWith('linear-gradient(')) {
    const parts = gradientParts(mask)
    const dir = GRADIENT_DIR[parts[0]]
    if (!dir) return null
    const [axis, sense] = dir
    const segs = gradientStops(parts)
    return ([u, v]) => {
      let pos = axis === 'x' ? u : v
      if (sense < 0) pos = 1 - pos
      for (const s of segs) {
        if (pos >= s.from - 1e-9 && pos <= s.to + 1e-9) return s.colour === '#000'
      }
      return segs[segs.length - 1].colour === '#000'
    }
  }
  if (mask.startsWith('radial-gradient(')) {
    // transparent inside, opaque outside: everything but the disc is kept.
    const m = /^radial-gradient\(circle\s+([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%/.exec(mask)
    if (!m) return null
    const r = toUnit(m[1]) * COVER_PX
    const cx = toUnit(m[2]) * W
    const cy = toUnit(m[3]) * H
    return ([u, v]) => ((u * W - cx) ** 2 + (v * H - cy) ** 2) >= r * r
  }
  if (mask.startsWith('conic-gradient(')) {
    const at = /from\s+([\d.]+)deg\s+at\s+([\d.]+)%\s+([\d.]+)%/.exec(mask)
    const sweep = /#000\s+([\d.]+)deg/.exec(mask)
    if (!at || !sweep) return null
    const cx = toUnit(at[2]) * W
    const cy = toUnit(at[3]) * H
    const deg = Number(sweep[1])
    return ([u, v]) => {
      const dx = u * W - cx
      const dy = v * H - cy
      if (dx === 0 && dy === 0) return true
      // CSS conic: 0deg points up and increases clockwise.
      const a = (Math.atan2(dx, -dy) * 180) / Math.PI + 360
      return (a % 360) <= deg
    }
  }
  const tr = /^translate([XY])\((-?[\d.]+)%\)$/.exec(incoming.transform || '')
  if (tr) {
    const shift = Number(tr[2]) / 100
    return tr[1] === 'X'
      ? ([u]) => u >= shift && u <= 1 + shift
      : ([, v]) => v >= shift && v <= 1 + shift
  }
  return null
}

/** Incoming region out of one rendered frame: the white plate is over 128. */
function measuredRegion(buf: Buffer, p: number): Region {
  const at = FIRST_RAMP_FRAME + Math.round(p * 12)
  const frame = buf.subarray(at * W * H, (at + 1) * W * H)
  return ([u, v]) => frame[Math.floor(v * H) * W + Math.floor(u * W)] >= 128
}

/**
 * One key per family and law the table uses, and every (shape, law) pair it
 * declares — the guard below fails if a pair goes unprobed. `coverage` is
 * graded against the frame for all of them; `circleopen` and `circlecrop` need
 * no hand-derived expectation any more because `modelRegion` computes the disc
 * area at the plate's real proportions, which is the number that relation was
 * approximating.
 */
const PROBES: string[] = [
  'fade',
  'fadeblack',
  'fadewhite',
  'wipe-left',
  'wipedown',
  'slide-left',
  'slideright',
  'squeezeh',
  'squeezev',
  'smoothleft',
  'smoothdown',
  'horzopen',
  'horzclose',
  'vertopen',
  'vertclose',
  'hlslice',
  'hrslice',
  'vdslice',
  'vuslice',
  'wipebl',
  'wipetr',
  'rectcrop',
  'zoom-in',
  'circleclose',
  'circleopen',
  'circlecrop',
  'radial',
  'diagbl',
  'diagtr'
]

/**
 * Keys whose whole geometry IS an axis, so the letter in `travel` is checkable
 * against pixels. The four `*slice` keys are combs, not bands: their teeth fill
 * from the edge core names in `from`, and the tooth positions are graded by the
 * region read, which is a stricter test of the same fact.
 */
const AXIS_KEYS = ['squeezeh', 'squeezev', 'horzopen', 'horzclose', 'vertopen', 'vertclose']

/**
 * The diagonal front is a 45-degree line in CANVAS PROPORTIONS, so the covered
 * area must not move when the canvas does. Measured at three aspects: if this
 * ever spreads, `coverage` is no longer aspect-free and the diagonals belong
 * with `circleopen` above — hand-derived per aspect, not asserted from the model.
 */
const ASPECT_PROBES: Array<[number, number]> = [[320, 180], [180, 320], [200, 200]]

if (!BIN) {
  console.log('SKIP  tmcut_transition_preview — no FFmpeg binary found (set TMCUT_FFMPEG_PATH)')
} else {
  // One render per key, graded against three reads of it.
  const rendered = new Map<string, { buf: Buffer, xfade: string }>()
  for (const key of PROBES) {
    // The app's catalog owns the legacy aliases (wipe-left -> wipeleft). The
    // probe must render what the export renders, so it resolves through the
    // same call — and a probe key that is not in the catalog would silently
    // degrade to `fade` there, so pin that here.
    const xfade = xfadeNameFor(key)
    assert.ok(FFMPEG_XFADE_NAMES.includes(xfade),
      `${key}: the catalog resolves it to "${xfade}", which the binary does not offer`)
    const buf = renderRamp(BIN, xfade)
    assert.ok(buf, `xfade=${xfade} did not render its window on this binary — the probe cannot grade the model`)
    rendered.set(key, { buf, xfade })
  }

  // Ceilings come from the last full 45-key sweep, read at the plate's own
  // pixel resolution: the worst `exact` row is 1.7% on both pixel reads, the
  // worst `shape` row 5.6% of painted area (`circleclose`) and 10.5% of region
  // (`diag*` — the binary's front is a wide gradient, the CSS one is an edge).
  // The coverage ceiling is looser than the painted-area one because `coverage`
  // is the analytic relation the registry publishes, aspect-free by design,
  // while the rasterization is the same shape at one specific canvas.
  const COVERAGE_CEILING: Record<string, number> = { exact: 0.03, shape: 0.15 }
  const AREA_CEILING: Record<string, number> = { exact: 0.03, shape: 0.08 }
  const REGION_CEILING: Record<string, number> = { exact: 0.03, shape: 0.12 }
  // Attribution on real content, measured across the 20 `exact` non-crossfade
  // keys at five progress points each (100 grades): the worst row is 1.7%
  // (`vuslice`/`vdslice`, the soft tooth edge) and the worst off-model share
  // 2.2% (`slidedown`, the resampler at the travelling seam). Same 3% tolerance
  // as the plate region read, earned a second time on pixels that are not two
  // greys — a front is a front whatever is behind it, but a squeezed or cropped
  // PICTURE only shows here.
  const CONTENT_REGION_CEILING = 0.03
  const OFF_MODEL_CEILING = 0.03

  let checked = 0
  let regions = 0
  // `approximate` rows are painted on screen (they must render, and the probe
  // list requires that), but this plate cannot grade them: on a black plate
  // going into a white one, `fadeblack` passes the picture through black, so
  // the frame's mean luminance IS the tint and says nothing about the alpha the
  // model carries. Measured: it diverges by 15.9% of the frame at p=0.42 while
  // the reveal itself is right. Their row claims only the timing, and the
  // timing of a tinted pass is not readable here.
  const ungradeable: string[] = []
  for (const key of PROBES) {
    const { buf, xfade } = rendered.get(key)!
    const measured = rampCoverage(buf)
    const mid = previewTransitionRamp(key, 0.5)
    const where = `${key} -> ${xfade} (${mid.shape}/${mid.law}, ${mid.fidelity})`
    if (mid.fidelity === 'approximate') {
      ungradeable.push(`${key} (${mid.law})`)
      continue
    }
    const worst = measured.reduce((acc, value, i) => {
      const predicted = previewTransitionRamp(key, (i + 1) / 12).coverage
      if (predicted === null) return acc // aspect-dependent: graded from pixels below
      return Math.max(acc, Math.abs(predicted - value))
    }, 0)
    assert.ok(worst <= COVERAGE_CEILING[mid.fidelity],
      `${where}: the render and the CSS model diverge by ${(worst * 100).toFixed(1)}% of the frame (limit ${COVERAGE_CEILING[mid.fidelity] * 100}%)`)
    checked += 1

    // A crossfade is a uniform layer alpha: every pixel of the box is inside, so
    // there is no region to grade and nothing to rasterize. Every other key has
    // to paint, or this block has stopped being a guard.
    if (mid.shape === 'crossfade') continue

    for (let i = 1; i <= 12; i++) {
      const p = i / 12
      const painted = modelRegion(previewTransitionRamp(key, p).incoming)
      if (painted === null) {
        assert.fail(`${where} @p=${p.toFixed(3)}: this spec cannot paint the CSS the model emits, so the pixel grades would be vacuous`)
      }
      let inside = 0
      for (const pt of GRID) if (painted(pt)) inside++
      const gap = Math.abs(inside / GRID.length - measured[i - 1])
      assert.ok(gap <= AREA_CEILING[mid.fidelity],
        `${where}: the area the CSS paints is ${(gap * 100).toFixed(1)}% of the box away from the frame's own luminance at p=${p.toFixed(3)} (limit ${AREA_CEILING[mid.fidelity] * 100}%)`)
    }

    for (const p of [1 / 3, 0.5, 2 / 3]) {
      const painted = modelRegion(previewTransitionRamp(key, p).incoming)
      if (painted === null) {
        assert.fail(`${where} @p=${p.toFixed(3)}: this spec cannot paint the CSS the model emits, so the pixel grades would be vacuous`)
      }
      const actual = measuredRegion(buf, p)
      let diff = 0
      for (const pt of GRID) if (painted(pt) !== actual(pt)) diff++
      const gap = diff / GRID.length
      assert.ok(gap <= REGION_CEILING[mid.fidelity],
        `${where}: the region the CSS paints disagrees with the rendered frame on ${(gap * 100).toFixed(1)}% of pixels at p=${p.toFixed(3)} (limit ${REGION_CEILING[mid.fidelity] * 100}%)`)
      regions += 1
    }
  }

  // The sweep may not be allowed to drift behind the registry: every (shape,
  // law) pair the table declares has to be probed, and the fidelity census is
  // the measured answer, not a style preference. A row that moves here without
  // a new measurement against the binary is the bug this whole file exists to
  // catch — the preview showing a cut the export does not make.
  const probed = new Set(PROBES.map(key => `${XFADE_PREVIEW[key].shape}/${XFADE_PREVIEW[key].law}`))
  const unprobed = [...new Set(Object.values(XFADE_PREVIEW).map(v => `${v.shape}/${v.law}`))]
    .filter(pair => !probed.has(pair))
  assert.equal(unprobed.length, 0,
    `the registry declares ${unprobed.join(', ')} but no probe renders it — that family's geometry is unmeasured`)
  const census: Record<string, number> = {}
  for (const v of Object.values(XFADE_PREVIEW)) census[v.fidelity] = (census[v.fidelity] || 0) + 1
  assert.deepEqual(census, { exact: 21, shape: 15, approximate: 9 },
    `the fidelity census is ${JSON.stringify(census)} — these are the 45-key sweep's verdicts, so a row changed grade without a new measurement`)

  // The area sweep above cannot tell a left/right reveal from a top/bottom one,
  // so grade the band geometry directly. Measured on this binary at the window
  // the export emits: `squeezeh` puts the incoming in rows 0-44 + 136-179 at
  // p=0.5 (a front along y) and `squeezev` in columns 0-79 + 241-319 (along x) —
  // the opposite letter from each name, and the swap that survived every
  // luminance number in the table above.
  let axes = 0
  for (const key of AXIS_KEYS) {
    const entry = rendered.get(key)
    assert.ok(entry, `${key} is graded for its axis but is not in the probe list`)
    const declared = XFADE_PREVIEW[key].travel
    assert.ok(declared === 'x' || declared === 'y',
      `${key}: the registry declares travel "${declared}", which this grade cannot read`)
    const measured = measuredFrontAxis(entry.buf, 0.5)
    assert.equal(measured, declared,
      `${key} -> ${entry.xfade} renders its front along ${measured}, but the registry (and so the preview CSS) says ${declared} — the two surfaces paint different cuts`)
    axes += 1
  }
  // The classifier must be able to disagree: both squeezes are in the set and the
  // registry says they are perpendicular. If a future edit gives them the same
  // letter, this is the assert that says so before the pixel compare goes vacuous.
  assert.notEqual(XFADE_PREVIEW.squeezeh.travel, XFADE_PREVIEW.squeezev.travel,
    'the two squeezes declare the same axis — the axis grade above no longer separates them')

  // Both halves of the window law, on the same plates.
  const illegal = spawnSync(BIN, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', PLATE('black', W, H),
    '-f', 'lavfi', '-i', PLATE('white', W, H),
    '-filter_complex', '[0:v][1:v]xfade=transition=squeezev:duration=0.4:offset=0.6',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ], { maxBuffer: 1 << 30, encoding: 'buffer', timeout: 120_000 })
  assert.notEqual(illegal.status, 0,
    'a non-tail-aligned xfade window now renders — re-read the window law before trusting it, and replace this probe')
  const legal = renderRamp(BIN, 'squeezev')
  assert.ok(legal, 'squeezev no longer renders on its tail-aligned window — the registry row is wrong again')
  const ramp = rampCoverage(legal)
  const midRamp = ramp.map((value, i) => Math.abs(value - (i + 1) / 12)).reduce((a, b) => Math.max(a, b), 0)
  assert.ok(midRamp <= 0.03,
    `squeezev renders but no longer covers a linear share of the box (worst ${(midRamp * 100).toFixed(1)}%) — its law/shape row needs re-measuring`)
  assert.equal(measuredFrontAxis(legal, 0.5), 'x')

  // And the export asks for that name: no key is degraded any more, because the
  // graph emits the window that renders. `mapXfadeTransition` is the app's own
  // resolver, so this is the wiring, not a restatement of the registry.
  assert.equal(mapXfadeTransition('squeezev'), 'squeezev',
    'the export still degrades a key the binary renders — the preview and the file would show different cuts')
  assert.equal(mapXfadeTransition('squeezeh'), 'squeezeh')

  // Fourth read: on real picture content, every pixel is graded against the
  // picture the model predicts for it — which layer is on top AND which source
  // pixel that layer shows there. A plate can only ever say how much of the box
  // is covered, so it is blind to a squeezed or slid picture. Graded at five
  // progress points of the window (frame 12 is fully incoming, so there is no
  // outgoing pixel left to attribute there).
  const outgoing = renderSource(BIN, FOOTAGE_SOURCES[0])
  const incoming = renderSource(BIN, FOOTAGE_SOURCES[1])
  assert.ok(outgoing, 'the outgoing content source did not render — attribution cannot be graded')
  assert.ok(incoming, 'the incoming content source did not render — attribution cannot be graded')
  let contentGrades = 0
  let contentWorst = 0
  let offModelWorst = 0
  for (const key of FOOTAGE_KEYS) {
    const xfade = xfadeNameFor(key)
    const rampBuf = renderContentRamp(BIN, xfade)
    assert.ok(rampBuf, `${key} -> ${xfade} did not render on real content — the fourth read cannot grade it`)
    assert.equal(rampBuf.length % (W * H * 3), 0,
      `${key}: the rgb24 ramp is not a whole number of frames, so frame indices would be guessed`)
    const mid = previewTransitionRamp(key, 0.5)
    const where = `${key} -> ${xfade} (${mid.shape}/${mid.law}, ${mid.fidelity})`
    for (const i of [1, 3, 5, 8, 11]) {
      const p = i / 12
      const style = previewTransitionRamp(key, p)
      const painted = modelRegion(style.incoming)
      if (painted === null) {
        assert.fail(`${where} @p=${p.toFixed(3)}: this spec cannot paint the CSS the model emits`)
      }
      // A layer with no clip-path and no mask is the whole box. Only the crop
      // family clips the OUTGOING, and there the pixels neither layer keeps show
      // the canvas behind them — the monitor's own black, which is the field the
      // file paints in the first half of the window.
      const clipsOut = !!(style.outgoing.clipPath || style.outgoing.maskImage)
      const cutOut = clipsOut ? modelRegion(style.outgoing) : null
      if (clipsOut && cutOut === null) {
        assert.fail(`${where} @p=${p.toFixed(3)}: this spec cannot paint the OUTGOING CSS the model emits, so the black field would be guessed`)
      }
      const { graded, attributed, ambiguous, offModel } = contentAttribution(
        rampBuf, outgoing, incoming, i, painted, cutOut ?? (() => true), clipsOut,
        layerSampler(style.outgoing), layerSampler(style.incoming))
      // Two vacuity guards: a frame where almost nothing is gradable, and a frame
      // where the two sources are the same picture, both make 100% agreement
      // meaningless, so both have to be big and small respectively.
      assert.ok(graded >= 0.5 * W * H,
        `${where} @p=${p.toFixed(3)}: only ${graded} pixels of ${W * H} differ enough between the two clips to be attributed — the grade is too thin to mean anything`)
      assert.ok(ambiguous <= 0.5 * W * H,
        `${where} @p=${p.toFixed(3)}: ${ambiguous} pixels the two clips agree on — the sources are too similar to test attribution`)
      const gap = 1 - attributed / graded
      const offShare = offModel / graded
      contentWorst = Math.max(contentWorst, gap)
      offModelWorst = Math.max(offModelWorst, offShare)
      assert.ok(gap <= CONTENT_REGION_CEILING,
        `${where} @p=${p.toFixed(3)}: the render disagrees with the picture the model predicts for ${(gap * 100).toFixed(1)}% of gradable pixels (limit ${CONTENT_REGION_CEILING * 100}%) — the preview would paint this cut somewhere the file does not`)
      assert.ok(offShare <= OFF_MODEL_CEILING,
        `${where} @p=${p.toFixed(3)}: ${(offShare * 100).toFixed(1)}% of gradable pixels sit further from the predicted picture than any resampler explains (limit ${OFF_MODEL_CEILING * 100}%) — the preview shows a picture the file does not contain`)
      contentGrades++
    }
  }

  // Same diagonal at three canvases: the model publishes one `coverage` curve
  // and claims it holds whatever the aspect, which is only true because the
  // front is a 45-degree line in proportions, not in pixels.
  const curves = ASPECT_PROBES.map(([w, h]) => {
    const buf = renderRamp(BIN, 'diagbl', w, h)
    assert.ok(buf, `diagbl would not render at ${w}x${h} — the aspect claim cannot be graded`)
    return rampCoverage(buf, w, h)
  })
  let spread = 0
  for (let i = 0; i < 12; i++) {
    const at = curves.map(c => c[i])
    spread = Math.max(spread, Math.max(...at) - Math.min(...at))
  }
  assert.ok(spread < 0.01,
    `the diagonal area curve moved ${(spread * 100).toFixed(1)}% of the frame across canvases — coverage is no longer aspect-free (limit 1%)`)

  console.log(`OK    tmcut_transition_preview — ${checked} keys re-measured against the CSS model, ${regions} region grades on the plate's pixel grid, ${contentGrades} attribution grades on real content (worst ${(contentWorst * 100).toFixed(1)}% of gradable pixels), ${axes} band axes pinned to pixels, squeezev renders on the window the export emits (and still crashes off it), diagbl aspect-stable; ${ungradeable.length} crossfade rows carry timing the plate cannot show (${ungradeable.join(', ')})`)
}
