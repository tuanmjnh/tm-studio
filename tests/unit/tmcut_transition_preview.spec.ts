/**
 * V4 G16 — the preview transition geometry against the binary that ships it.
 *
 * `tmcut-core/transitions.mjs` now owns the shape, the travel law and the CSS
 * of every xfade key, and `TmcutPreviewPlayer.vue` only paints what it is
 * handed. That claim is only worth as much as the measurement behind it, so
 * this spec re-runs the probe that produced the table: two solid plates through
 * `xfade`, one frame at a time, and the mean luminance of the frame IS the
 * fraction of the box the incoming clip covers (black plate = 0, white = 1).
 * The core model predicts the same number through `coverage`, and the two must
 * agree inside a tolerance that depends on what the key claims:
 *
 *   'exact'  <= 0.03 — the shape and the timing both reproduce the render
 *   'shape'  <= 0.15 — the shape and timing reproduce, the soft edge does not
 *
 * The subset is one representative per (family, law) pair actually used by the
 * table; the full 45-key sweep lives in `docs/v4-phase-0-audit.md`. A key that
 * fails here means the preview shows a cut the export does not make.
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

const here = dirname(fileURLToPath(import.meta.url))
const CANDIDATES = [
  process.env.TMCUT_FFMPEG_PATH,
  join(here, '..', '..', 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
].filter(Boolean)
const BIN = CANDIDATES.find(c => existsSync(c))

const W = 320
const H = 180
// 1.2 s of 30 fps plates, the overlap occupies frames 18..30 (0.4 s = 12
// frames after the 0.6 s offset). Frame 18 is pure outgoing, frame 30 pure
// incoming, so frame 18+i is progress i/12.
const PLATE = (colour: string, w: number, h: number) => `color=c=${colour}:s=${w}x${h}:r=30:d=1.2`

/** Mean luminance of one gray frame, as the covered fraction of the box. */
function coverage(bin: string, name: string, w = W, h = H): number[] | null {
  const res = spawnSync(bin, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', PLATE('black', w, h),
    '-f', 'lavfi', '-i', PLATE('white', w, h),
    '-filter_complex', `[0:v][1:v]xfade=transition=${name}:duration=0.4:offset=0.6`,
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ], { maxBuffer: 1 << 30, encoding: 'buffer', timeout: 120_000 })
  if (res.status !== 0) return null
  const frameBytes = w * h
  const out: number[] = []
  for (let i = 1; i <= 12; i++) {
    const frame = res.stdout.subarray((18 + i) * frameBytes, (19 + i) * frameBytes)
    if (frame.length < frameBytes) return null
    let sum = 0
    for (let px = 0; px < frameBytes; px++) sum += frame[px]
    out.push(sum / frameBytes / 255)
  }
  return out
}

/**
 * One key per family and law the table uses. `circleopen` carries an explicit
 * expectation instead of a model number: the area of a disc clipped by the box
 * depends on the canvas proportions, so the model reports coverage `null` and
 * the derivation is written out where it can be checked. The diagonals do NOT
 * need that treatment — their area relation is aspect-free, which is what the
 * second probe block below measures.
 */
const PROBES: Array<{ key: string, expect?: Array<number | null> }> = [
  { key: 'fade' },
  { key: 'wipe-left' },
  { key: 'wipedown' },
  { key: 'slide-left' },
  { key: 'slideright' },
  { key: 'squeezeh' },
  { key: 'smoothleft' },
  { key: 'smoothdown' },
  { key: 'horzopen' },
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
 * The diagonal front is a 45-degree line in CANVAS PROPORTIONS, so the covered
 * area must not move when the canvas does. Measured at three aspects: if this
 * ever spreads, `coverage` is no longer aspect-free and the diagonals belong
 * with `circleopen` above — hand-derived per aspect, not asserted from the model.
 */
const ASPECT_PROBES: Array<[number, number]> = [[320, 180], [180, 320], [200, 200]]

if (!BIN) {
  console.log('SKIP  tmcut_transition_preview — no FFmpeg binary found (set TMCUT_FFMPEG_PATH)')
} else {
  let checked = 0
  for (const probe of PROBES) {
    // The app's catalog owns the legacy aliases (wipe-left -> wipeleft). The
    // probe must render what the export renders, so it resolves through the
    // same call — and a probe key that is not in the catalog would silently
    // degrade to `fade` there, so pin that here.
    const xfade = xfadeNameFor(probe.key)
    assert.ok(FFMPEG_XFADE_NAMES.includes(xfade),
      `${probe.key}: the catalog resolves it to "${xfade}", which the binary does not offer`)
    const measured = coverage(BIN, xfade)
    assert.ok(measured, `xfade=${xfade} produced no readable frames — the probe cannot grade the model`)
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

  // The one key the preview deliberately misrepresents: the bundled binary
  // dies on it, so the registry must not paint a squeeze and the table must
  // keep saying so. Re-checked against the process, not against memory.
  const squeezev = spawnSync(BIN, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', PLATE('black', W, H),
    '-f', 'lavfi', '-i', PLATE('white', W, H),
    '-filter_complex', '[0:v][1:v]xfade=transition=squeezev:duration=0.4:offset=0.6',
    '-f', 'rawvideo', '-pix_fmt', 'gray', '-'
  ], { maxBuffer: 1 << 30, encoding: 'buffer', timeout: 120_000 })
  assert.notEqual(squeezev.status, 0,
    'squeezev now renders on this binary — the preview must stop faking it with a plain fade')
  assert.equal(XFADE_PREVIEW.squeezev.shape, 'unavailable')
  assert.equal(previewTransitionRamp('squeezev', 0.5).incoming.opacity, 0.5)

  // Same diagonal at three canvases: the model publishes one `coverage` curve
  // and claims it holds whatever the aspect, which is only true because the
  // front is a 45-degree line in proportions, not in pixels.
  const curves = ASPECT_PROBES.map(([w, h]) => {
    const c = coverage(BIN, 'diagbl', w, h)
    assert.ok(c, `diagbl would not render at ${w}x${h} — the aspect claim cannot be graded`)
    return c
  })
  let spread = 0
  for (let i = 0; i < 12; i++) {
    const at = curves.map(c => c[i])
    spread = Math.max(spread, Math.max(...at) - Math.min(...at))
  }
  assert.ok(spread < 0.01,
    `the diagonal area curve moved ${(spread * 100).toFixed(1)}% of the frame across canvases — coverage is no longer aspect-free (limit 1%)`)

  console.log(`OK    tmcut_transition_preview — ${checked} keys re-measured against the CSS model, diagbl aspect-stable, squeezev still refuses to render`)
}
