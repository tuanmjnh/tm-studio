/**
 * Decoder-side scene scan (zero-FFmpeg slice E2, ADR-028/030).
 *
 * ADR-028 row 2 keeps AutoCut's cut detection alive by re-making it on decoded
 * samples instead of FFmpeg stderr. Slice E1 put the numbers in core; this slice
 * puts the pixels in reach of them. Two files, and the split is the point:
 *
 *  - `app/utils/tmcut/frameDecode.ts` gains the pixel seam. It already opens the
 *    demuxer for a thumbnail, so the luma read goes in the SAME file: the repo
 *    pins how many modules may hold a decoder, and a third seam would be a third
 *    place for a host to drift.
 *  - `app/utils/tmcut/sceneScan.ts` holds no platform code at all. It asks core
 *    which instants exist, hands them to an injected grid reader, and asks core
 *    what the answers mean. Plain Node can test every decision in it.
 *
 * What is pinned, in order:
 *  - the instants are core's (`sceneSampleTimes`, which is the C14 strip law at
 *    the scene rate), so a scan and a filmstrip never stand on different seconds;
 *  - a shot list comes out of `cutsToShots`, not a local loop, so the desktop and
 *    the browser close their tails at the same second;
 *  - a sample the decoder lost is a hole, not a frame of zeros: the pair is
 *    skipped, the count is reported, and a scan that got nothing says "no shots"
 *    rather than inventing one shot for the whole file;
 *  - a runtime with no WebCodecs is answered by the seam with nulls, and the scan
 *    turns that into an empty result without throwing;
 *  - an aborted scan stops asking;
 *  - the luma maths is core's `lumaCells` — the seam reads pixels, it does not
 *    decide what a bright frame is.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_scene_scan.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

async function main() {
  console.log('=== [TMCut scene scan] Starting ===\n')
  const core = await import('tmcut-core')
  const { createSceneScan } = await import('../../app/utils/tmcut/sceneScan')

  /** One uniform grid, so a score can be aimed at an exact number. */
  const solid = (level: number) => new Array(64).fill(level)

  await check('the scan is its own module and the luma seam is not', () => {
    assert.ok(existsSync(join(root, 'app/utils/tmcut/sceneScan.ts')),
      'app/utils/tmcut/sceneScan.ts must own the scan')
    const scan = read('app/utils/tmcut/sceneScan.ts')
    assert.ok(!/from 'mediabunny'/.test(scan), 'the scan must not hold a decoder')
    assert.ok(!/VideoDecoder|CanvasSink|getImageData/.test(scan),
      'pixel work belongs to the seam, not to the scan')
  })

  await check('the instants asked are core\'s, in seconds, for the trimmed range', async () => {
    const seen: number[][] = []
    const scan = createSceneScan(async (times) => {
      seen.push(times.slice())
      return times.map(() => solid(10))
    })
    await scan.scan({ inSec: 2, outSec: 6, durationSec: 10 })
    const expected = core.sceneSampleTimes(core.secToTicks(2), core.secToTicks(4))
      .map((ticks: number) => core.ticksToSec(ticks))
    assert.equal(seen.length, 1, 'one range is one read')
    assert.deepEqual(seen[0], expected, 'the scan asks the instants core planned')
    assert.equal(seen[0].length, expected.length)
    assert.ok(seen[0].length > 0)
  })

  await check('a hard change becomes a cut at the sampled instant, and shots from core', async () => {
    const scan = createSceneScan(times => Promise.resolve(
      times.map(atSec => (atSec >= 1 ? solid(240) : solid(10)))
    ))
    const result = await scan.scan({ inSec: 0, outSec: 2, durationSec: 2 })
    const expected = core.sceneSampleTimes(core.secToTicks(0), core.secToTicks(2))
      .map((ticks: number) => core.ticksToSec(ticks))
    const firstBright = expected.findIndex(atSec => atSec >= 1)
    assert.deepEqual(result.cuts, [core.sceneCuts(expected, expected.map(atSec => (atSec >= 1 ? solid(240) : solid(10))))[0]])
    assert.equal(result.cuts.length, 1)
    assert.equal(result.cuts[0], expected[firstBright])
    assert.deepEqual(result.shots, core.cutsToShots(result.cuts, 2))
    assert.equal(result.sampled, expected.length)
    assert.equal(result.missing, 0)
  })

  await check('a lost sample is a hole: skipped, counted, never scored as no change', async () => {
    const scan = createSceneScan(times => Promise.resolve(
      times.map((atSec, index) => (index === 1 ? null : solid(atSec >= 1.5 ? 240 : 10)))
    ))
    const expected = core.sceneSampleTimes(core.secToTicks(0), core.secToTicks(2))
      .map((ticks: number) => core.ticksToSec(ticks))
    const result = await scan.scan({ inSec: 0, outSec: 2, durationSec: 2 })
    assert.equal(result.missing, 1)
    assert.equal(result.sampled, expected.length)
    // The pair across the hole is not compared, so a change that starts at the
    // sample after the hole is not claimed at the hole's instant.
    assert.deepEqual(result.cuts, core.sceneCuts(expected, expected.map((atSec, index) =>
      (index === 1 ? null : solid(atSec >= 1.5 ? 240 : 10)))))
  })

  await check('a scan that got nothing says so instead of inventing a shot', async () => {
    const scan = createSceneScan(times => Promise.resolve(times.map(() => null)))
    const result = await scan.scan({ inSec: 0, outSec: 4, durationSec: 4 })
    assert.deepEqual(result.cuts, [])
    assert.deepEqual(result.shots, [], 'no usable sample must not become "one shot covering the file"')
    assert.ok(result.missing > 0)
    assert.equal(result.sampled, result.missing)
  })

  await check('an unreal range asks the decoder for nothing', async () => {
    let calls = 0
    const scan = createSceneScan((times) => {
      calls++
      return Promise.resolve(times.map(() => solid(10)))
    })
    for (const ask of [
      { inSec: 0, outSec: 0 },
      { inSec: 4, outSec: 1 },
      { inSec: Number.NaN, outSec: 3 },
      { inSec: 0, outSec: Number.POSITIVE_INFINITY }
    ]) {
      const result = await scan.scan(ask)
      assert.deepEqual(result.cuts, [], `${ask.inSec}..${ask.outSec} must answer nothing`)
      assert.deepEqual(result.shots, [])
      assert.equal(result.sampled, 0)
    }
    assert.equal(calls, 0, 'an empty plan must not touch the decoder')
  })

  await check('a caller-thinned sample rate and threshold reach core, not a local copy', async () => {
    const scan = createSceneScan(times => Promise.resolve(
      times.map(atSec => (atSec >= 1 ? solid(55) : solid(10)))
    ))
    const defaultRun = await scan.scan({ inSec: 0, outSec: 2, durationSec: 2 })
    const eager = await scan.scan({ inSec: 0, outSec: 2, durationSec: 2, threshold: 0.01 })
    assert.equal(defaultRun.cuts.length, 0, 'a 45/255 lift is under the 0.18 default E4 calibrated to')
    assert.ok(eager.cuts.length > 0, 'a lowered threshold must find it')
    assert.deepEqual(eager.cuts, core.sceneCuts(
      core.sceneSampleTimes(core.secToTicks(0), core.secToTicks(2)).map((t: number) => core.ticksToSec(t)),
      core.sceneSampleTimes(core.secToTicks(0), core.secToTicks(2))
        .map((t: number) => core.ticksToSec(t))
        .map(atSec => (atSec >= 1 ? solid(55) : solid(10))),
      { threshold: 0.01 }
    ))
  })

  await check('a sample rate below core\'s default still plans on core\'s law', async () => {
    const seen: number[][] = []
    const scan = createSceneScan((times) => {
      seen.push(times.slice())
      return times.map(() => solid(10))
    })
    await scan.scan({ inSec: 0, outSec: 10, durationSec: 10, sampleHz: 1 })
    assert.equal(seen[0].length, 10, '10s at 1Hz is ten looks')
    assert.deepEqual(seen[0], core.sceneSampleTimes(core.secToTicks(0), core.secToTicks(10), 1)
      .map((t: number) => core.ticksToSec(t)))
  })

  await check('an aborted scan stops asking and answers nothing', async () => {
    const controller = new AbortController()
    let asked = 0
    const scan = createSceneScan(async (times) => {
      asked++
      controller.abort()
      return times.map(() => solid(10))
    })
    const result = await scan.scan({ inSec: 0, outSec: 2, durationSec: 2, signal: controller.signal })
    assert.equal(asked, 1)
    assert.deepEqual(result.cuts, [], 'a scan that was cancelled paints no EDL')
    assert.deepEqual(result.shots, [])
    const afterAbort = await scan.scan({ inSec: 0, outSec: 2, durationSec: 2, signal: controller.signal })
    assert.equal(asked, 1, 'an already-cancelled scan must not open the decoder again')
    assert.deepEqual(afterAbort.cuts, [])
  })

  await check('the seam reads pixels with core\'s grid law and holds no decision', () => {
    const seam = read('app/utils/tmcut/frameDecode.ts')
    assert.match(seam, /lumaCells\(/, 'the grid must come from tmcut-core')
    assert.match(seam, /export async function decodeLumaSeries/, 'the luma read lives in the pixel seam')
    assert.match(seam, /canvasesAtTimestamps/, 'a sparse scan decodes each packet at most once')
    assert.ok(!/sceneScore|cutsToShots|sceneCuts/.test(seam),
      'the seam delivers pixels; what they mean is decided in core and the scan')
  })

  // The demuxer-holder count moved to `tmcut_silence_scan.spec.ts` in slice E3,
  // the slice that added a third holder on purpose. One guard, one home.

  console.log(`\n=== [TMCut scene scan] ${passed} passed ===`)
}

main().catch((error) => {
  console.error('SCENE SCAN SPEC FAILED:', error)
  process.exit(1)
})
