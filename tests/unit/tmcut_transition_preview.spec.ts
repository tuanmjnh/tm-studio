/**
 * V4 G16 — the preview transition geometry against the binary that ships it.
 *
 * `tmcut-core/transitions.mjs` owns the shape, the travel law and the CSS of
 * every xfade key, and `TmcutPreviewPlayer.vue` only paints what it is handed.
 * That claim is only worth as much as the measurement behind it, so this spec
 * re-runs the probe that produced the table: two solid plates through `xfade`,
 * one frame at a time, and the mean luminance of the frame IS the fraction of
 * the box the incoming clip covers (black plate = 0, white = 1). The core model
 * predicts the same number through `coverage`, and the two must agree inside a
 * tolerance that depends on what the key claims:
 *
 *   'exact'  <= 0.03 — the shape and the timing both reproduce the render
 *   'shape'  <= 0.15 — the shape and timing reproduce, the soft edge does not
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
 * the middle block reads the band GEOMETRY out of the pixels and compares it with
 * the `travel` letter the registry declares — the assertion that a swapped axis
 * survives a luminance sweep and ships.
 *
 * The subset is one representative per (family, law) pair actually used by the
 * table; the full 45-key sweep lives in `docs/v4-phase-0-audit.md` §8.1. A key
 * that fails here means the preview shows a cut the export does not make.
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
 * One key per family and law the table uses. `circleopen` carries an explicit
 * expectation instead of a model number: the area of a disc clipped by the box
 * depends on the canvas proportions, so the model reports coverage `null` and
 * the derivation is written out where it can be checked. The diagonals do NOT
 * need that treatment — their area relation is aspect-free, which is what the
 * aspect block at the bottom measures.
 */
const PROBES: Array<{ key: string, expect?: Array<number | null> }> = [
  { key: 'fade' },
  { key: 'wipe-left' },
  { key: 'wipedown' },
  { key: 'slide-left' },
  { key: 'slideright' },
  { key: 'squeezeh' },
  { key: 'squeezev' },
  { key: 'smoothleft' },
  { key: 'smoothdown' },
  { key: 'horzopen' },
  { key: 'horzclose' },
  { key: 'vertopen' },
  { key: 'vertclose' },
  { key: 'hlslice' },
  { key: 'vdslice' },
  { key: 'wipebl' },
  { key: 'wipetr' },
  { key: 'rectcrop' },
  { key: 'zoom-in' },
  // A disc of radius r in a 320x180 box is fully inside while r <= 90, so the
  // covered fraction is pi*r^2/(320*180) for the first half of the ramp. The
  // model's travel at p=0.5 is 0.5 of the covering radius (183.58 px) = 91.8 px
  // -> 0.459. Only the mid-frame is checked: past that the disc leaves the box
  // and the relation is no longer a circle formula, so those frames are null.
  { key: 'circleopen', expect: [null, null, null, null, null, 0.459, null, null, null, null, null, 1] },
  { key: 'diagbl' },
  { key: 'diagtr' }
]

/**
 * Keys whose whole geometry IS an axis, so the letter in `travel` is checkable
 * against pixels. `slice` and `smooth` are deliberately absent: on the card
 * surface their axis names the stripe/gradient orientation, which core expresses
 * through `from`, so the two variables are not the same fact.
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
  // One render per key, graded two ways.
  const rendered = new Map<string, { buf: Buffer, xfade: string }>()
  for (const probe of PROBES) {
    // The app's catalog owns the legacy aliases (wipe-left -> wipeleft). The
    // probe must render what the export renders, so it resolves through the
    // same call — and a probe key that is not in the catalog would silently
    // degrade to `fade` there, so pin that here.
    const xfade = xfadeNameFor(probe.key)
    assert.ok(FFMPEG_XFADE_NAMES.includes(xfade),
      `${probe.key}: the catalog resolves it to "${xfade}", which the binary does not offer`)
    const buf = renderRamp(BIN, xfade)
    assert.ok(buf, `xfade=${xfade} did not render its window on this binary — the probe cannot grade the model`)
    rendered.set(probe.key, { buf, xfade })
  }

  let checked = 0
  for (const probe of PROBES) {
    const { buf, xfade } = rendered.get(probe.key)!
    const measured = rampCoverage(buf)
    const mid = previewTransitionRamp(probe.key, 0.5)
    const limit = mid.fidelity === 'exact' ? 0.03 : 0.15
    const worst = measured.reduce((acc, value, i) => {
      const p = (i + 1) / 12
      const predicted = probe.expect
        ? probe.expect[i]
        : previewTransitionRamp(probe.key, p).coverage
      if (predicted === null) return acc // this frame is aspect-dependent, not graded
      return Math.max(acc, Math.abs(predicted - value))
    }, 0)
    assert.ok(worst <= limit,
      `${probe.key} -> ${xfade} (${mid.shape}/${mid.law}, ${mid.fidelity}): the render and the CSS model diverge by ${(worst * 100).toFixed(1)}% of the frame (limit ${limit * 100}%)`)
    checked += 1
  }

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

  console.log(`OK    tmcut_transition_preview — ${checked} keys re-measured against the CSS model, ${axes} band axes pinned to pixels, squeezev renders on the window the export emits (and still crashes off it), diagbl aspect-stable`)
}
