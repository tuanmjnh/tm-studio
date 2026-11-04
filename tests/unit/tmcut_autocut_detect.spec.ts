/**
 * AutoCut detection (zero-FFmpeg slice E4).
 *
 * AutoCut asks two questions about one file — where does the camera cut, and
 * where is the track quiet. Slices E2 and E3 answered them in two modules that
 * take an injected reader; the FFmpeg passes in the main process and on the
 * server answered them too, and the app picked which one to ask by looking at
 * the path. This slice removes the second answer, and this file is the only
 * place that knows what is left over: the order of the two passes, which bytes
 * they read, and what an empty answer means.
 *
 * What is pinned, in order:
 *  - `autocutDetect.ts` is glue, not a third decoder: it imports the two scans
 *    and the byte cache, and holds no demuxer and no sample or pixel work;
 *  - the client copy of the file beats its location, the way the frame pipeline
 *    decided in slice D2 — one byte-precedence law, not one per consumer;
 *  - one clip is one grid read and one PCM read, on the instants core planned;
 *  - the stage callbacks name the pass the UI is waiting on, in that order;
 *  - shots and silences are exactly what core's laws answer for the same
 *    samples, so the desktop and the web host cannot disagree about a cut;
 *  - a clip with no sound is not an error, and is not reported as silence;
 *  - a file with no readable frames says so, and stops before paying for sound;
 *  - a host that cannot decode is told so before anything is opened;
 *  - a cancelled scan answers nothing, and keeps only the counts it earned;
 *  - the two lists go straight into core's scorer, which is the whole point.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_autocut_detect.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import './helpers/tmcut_store_env'
import { blobOf, clearByteIndex, installOpfs } from './helpers/tmcut_browser_storage'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const FP = 'f4ce01f4'
const CLIP = '/uploads/clipA.mp4'
const rate = 8000
/** One uniform luma grid: `cells` x `cells` of the same level. */
const grid = (level: number, cells = 8) => new Array(cells * cells).fill(level)
/** One second of tone then nothing, so a quiet run always exists. */
function pcmOf(seconds: number) {
  const length = Math.round(rate * seconds)
  const channel = new Float32Array(length)
  channel.fill(0.5, 0, rate)
  return { sampleRate: rate, channels: [channel] }
}

type Ask = Record<string, unknown>
type GridAsk = { timesSec: number[], bytes: Blob | null, src: string | null, signal: AbortSignal }
type PcmAsk = { inSec: number, outSec: number, bytes: Blob | null, src: string | null, signal: AbortSignal }

function recorder(options: {
  grids?: (ask: GridAsk) => Array<ArrayLike<number> | null>
  pcm?: (ask: PcmAsk) => { sampleRate: number, channels: Float32Array[] } | null
  canDecodeVideo?: boolean
} = {}) {
  const gridAsks: GridAsk[] = []
  const pcmAsks: PcmAsk[] = []
  const seams = {
    canDecodeVideo: () => options.canDecodeVideo !== false,
    readGrids: async (ask: GridAsk) => {
      gridAsks.push(ask)
      return options.grids ? options.grids(ask) : ask.timesSec.map((_t, index) => grid(index === 0 ? 10 : 240))
    },
    readPcm: async (ask: PcmAsk) => {
      pcmAsks.push(ask)
      return options.pcm ? options.pcm(ask) : pcmOf(ask.outSec - ask.inSec)
    }
  }
  return { seams, gridAsks, pcmAsks }
}

async function main() {
  console.log('=== [TMCut autocut detect] Starting ===\n')
  const core = await import('tmcut-core')
  const store = await import('../../app/utils/tmcut/byteStore')
  const { createAutocutDetect } = await import('../../app/utils/tmcut/autocutDetect')

  /** Core's own plan for the same clip, so the spec never hardcodes a rate. */
  const planSecs = core.sceneSampleTimes(core.secToTicks(0), core.secToTicks(4), core.TMCUT_SCENE_SAMPLE_HZ)
    .map((ticks: number) => core.ticksToSec(ticks))
  const expectedSpans = core.silenceSpans(core.loudestPeakSeries([pcmOf(4).channels[0]], rate),
    { offsetSec: 0, durationSec: 4 })

  async function seedCache(hold: boolean) {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    if (hold) assert.equal(await store.putCachedBytes(FP, blobOf(5000, 'm'), new Set([FP])), true)
  }

  await check('the detect leg is glue: no demuxer, no pixels, no samples', () => {
    assert.ok(existsSync(join(root, 'app/utils/tmcut/autocutDetect.ts')),
      'app/utils/tmcut/autocutDetect.ts must own the order of the two passes')
    const detect = read('app/utils/tmcut/autocutDetect.ts')
    assert.ok(!/from 'mediabunny'/.test(detect), 'a fourth demuxer holder would be a fourth place to drift')
    assert.ok(!/CanvasSink|AudioBufferSink|BlobSource|UrlSource|getChannelData|AudioBuffer\b/.test(detect),
      'decoding belongs to the seams, not to the order')
    assert.ok(!/decodeLumaSeries\(|decodePcm\(/.test(detect),
      'the seams are called by the browser wiring, not from here')
    assert.ok(!/from '(?:\.\.\/|~\/)[^']*?(?:frameDecode|audioDecode)/.test(detect),
      'and not imported either, so plain Node can test what happens around them')
    assert.match(detect, /from '\.\/sceneScan'/, 'the scene scan is the shot list')
    assert.match(detect, /from '\.\/silenceScan'/, 'the silence scan is the quiet runs')
    assert.match(detect, /from '\.\/byteStore'/, 'and the byte cache is the first copy to read')
  })

  await check('the client copy beats the location, as it does for frames', async () => {
    await seedCache(true)
    const first = recorder()
    await createAutocutDetect(first.seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.ok(first.gridAsks[0]?.bytes, 'the cached file was handed to the pixel seam')
    assert.equal(first.gridAsks[0]?.src, null, 'and no location was opened next to it')
    assert.ok(first.pcmAsks[0]?.bytes, 'the same copy went to the sound seam')
    assert.equal(first.pcmAsks[0]?.src, null)

    const second = recorder()
    await createAutocutDetect(second.seams).detect({ fingerprint: null, src: CLIP, durationSec: 4 })
    assert.equal(second.gridAsks[0]?.bytes, null, 'with no fingerprint there is no cached copy')
    assert.equal(second.gridAsks[0]?.src, CLIP, 'so the location is the read')
    assert.equal(second.pcmAsks[0]?.src, CLIP)
  })

  await check('one clip is one read of each kind, on the instants core planned', async () => {
    const seen: Ask[] = []
    await seedCache(false)
    const { seams, gridAsks, pcmAsks } = recorder({
      grids: (ask) => {
        seen.push({ times: ask.timesSec })
        return ask.timesSec.map(() => grid(10))
      }
    })
    await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(gridAsks.length, 1, 'one grid walk, not one decode per instant')
    assert.equal(pcmAsks.length, 1, 'one PCM walk')
    assert.deepEqual(seen[0].times, planSecs, 'the instants are core\'s scene plan')
    assert.equal(pcmAsks[0].inSec, 0)
    assert.equal(pcmAsks[0].outSec, 4, 'the sound pass listened to the whole clip')
  })

  await check('the stage callbacks name the pass the UI is waiting on, in order', async () => {
    const stages: string[] = []
    await seedCache(false)
    const { seams } = recorder()
    await createAutocutDetect(seams).detect({
      fingerprint: FP,
      src: CLIP,
      durationSec: 4,
      onStage: stage => stages.push(stage)
    })
    assert.deepEqual(stages, ['scenes', 'silence'])
  })

  await check('shots and silences are core\'s answers, in source seconds', async () => {
    await seedCache(false)
    const { seams } = recorder()
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(result.error, null, `a readable clip is not an error: ${result.error}`)
    assert.deepEqual(result.cuts, [planSecs[1]], 'the change was attributed to the later sample')
    assert.deepEqual(result.shots, core.cutsToShots([planSecs[1]], 4))
    assert.deepEqual(result.silences, expectedSpans)
    assert.equal(result.sampled, planSecs.length)
    assert.equal(result.missing, 0)
    assert.equal(result.audioHeard, true)
    assert.ok(result.windows > 0, 'the level windows were counted')
  })

  await check('a clip with no sound is not an error and not a wall of silence', async () => {
    await seedCache(false)
    const { seams, pcmAsks } = recorder({ pcm: () => null })
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(pcmAsks.length, 1, 'the pass was still asked, so the answer is the file\'s')
    assert.equal(result.error, null, 'an audio-less clip still has shots')
    assert.equal(result.audioHeard, false)
    assert.deepEqual(result.silences, [], 'nothing was heard, so nothing is claimed quiet')
    assert.equal(result.windows, 0)
    assert.ok(result.shots.length > 0, 'the shot list stands on its own')
  })

  await check('a file with no readable frames says so and stops before the sound', async () => {
    await seedCache(false)
    const { seams, pcmAsks } = recorder({ grids: ask => ask.timesSec.map(() => null) })
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(result.error, 'no-video')
    assert.equal(result.sampled, planSecs.length, 'what was asked for is still reported')
    assert.equal(result.missing, planSecs.length)
    assert.deepEqual(result.shots, [])
    assert.equal(pcmAsks.length, 0, 'a clip with no shots has no draft, so the sound is not paid for')
  })

  await check('a host that cannot decode is told so before anything is opened', async () => {
    await seedCache(false)
    const { seams, gridAsks, pcmAsks } = recorder({ canDecodeVideo: false })
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(result.error, 'no-decoder')
    assert.equal(gridAsks.length, 0, 'no decoder, no read')
    assert.equal(pcmAsks.length, 0)
    assert.deepEqual(result.shots, [])
    assert.equal(result.audioHeard, false)
  })

  await check('a cancelled scan answers nothing and keeps only the counts it earned', async () => {
    await seedCache(false)
    const before = recorder()
    const cancelled = new AbortController()
    cancelled.abort()
    const early = await createAutocutDetect(before.seams)
      .detect({ fingerprint: FP, src: CLIP, durationSec: 4, signal: cancelled.signal })
    assert.equal(early.error, 'cancelled')
    assert.equal(before.gridAsks.length, 0, 'an already-cancelled scan opens nothing')
    assert.deepEqual(early.shots, [])

    const controller = new AbortController()
    const mid = recorder({
      // The walk was stopped part-way, exactly as a cancel stops a real decode:
      // the frames it never got are missing, and a partial list must not become
      // a shot boundary.
      grids: (ask) => {
        controller.abort()
        return ask.timesSec.map((_t, index) => index < 2 ? grid(10) : null)
      }
    })
    const partial = await createAutocutDetect(mid.seams)
      .detect({ fingerprint: FP, src: CLIP, durationSec: 4, signal: controller.signal })
    assert.equal(partial.error, 'cancelled')
    assert.equal(partial.sampled, planSecs.length, 'the plan it did walk is counted')
    assert.equal(partial.missing, planSecs.length - 2)
    assert.deepEqual(partial.shots, [], 'a cancelled scan paints no EDL')
  })

  await check('a decoder that dies because the scan was cancelled says cancelled', async () => {
    await seedCache(false)
    const controller = new AbortController()
    const { seams, pcmAsks } = recorder({
      // What a real cancel does in the browser: the signal flips mid-batch and the
      // decoder rejects instead of handing back the frames it never reached. The
      // sentence the UI needs is "you stopped it", not "this file has no frames".
      grids: () => {
        controller.abort()
        throw new Error('AbortError: the user aborted a request')
      }
    })
    const result = await createAutocutDetect(seams)
      .detect({ fingerprint: FP, src: CLIP, durationSec: 4, signal: controller.signal })
    assert.equal(result.error, 'cancelled', 'a cancel is not a broken file')
    assert.deepEqual(result.shots, [])
    assert.equal(result.audioHeard, false)
    assert.equal(pcmAsks.length, 0, 'and the sound pass is not paid for')
  })

  await check('the two lists are what the scorer already eats', async () => {
    await seedCache(false)
    const { seams } = recorder()
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    const edl = core.scoreSegments({
      scenes: result.shots,
      silences: result.silences,
      profile: 'viral-shorts',
      assetId: 'asset_test'
    })
    assert.deepEqual(core.validateEdl(edl), [], 'the EDL built from decoded answers is a valid EDL')
    assert.ok(edl.segments.length > 0, 'and it holds segments to review')
  })

  await check('a file the decoder chokes on is the same empty answer as a file with no frames', async () => {
    await seedCache(false)
    const { seams, pcmAsks } = recorder({
      grids: () => { throw new TypeError('Failed to parse URL') }
    })
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(result.error, 'no-video', 'a stack trace is not a sentence the UI can show')
    assert.equal(result.sampled, 0)
    assert.equal(pcmAsks.length, 0, 'and the sound pass is not paid for either')
  })

  await check('a sound pass that fails leaves the shot list standing', async () => {
    await seedCache(false)
    const { seams } = recorder({
      pcm: () => { throw new Error('decoder gave up') }
    })
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 4 })
    assert.equal(result.error, null, 'the draft is still worth making')
    assert.equal(result.audioHeard, false)
    assert.deepEqual(result.silences, [])
    assert.ok(result.shots.length > 0)
  })

  await check('an unknown duration is an honest empty answer, not a zero-second film', async () => {
    await seedCache(false)
    const { seams, gridAsks, pcmAsks } = recorder()
    const result = await createAutocutDetect(seams).detect({ fingerprint: FP, src: CLIP, durationSec: 0 })
    assert.equal(result.error, 'no-video')
    assert.equal(result.sampled, 0, 'nothing was asked of the decoder')
    assert.equal(gridAsks.length, 0)
    assert.equal(pcmAsks.length, 0)
  })

  await check('the composable asks the browser, not the main process or the server', () => {
    const composable = read('app/composables/useTmcutAutocut.ts')
    assert.ok(!/analyzeScenes|analyzeSilence/.test(composable),
      'the desktop FFmpeg passes are gone from AutoCut')
    assert.ok(!/media\/analyze/.test(composable), 'so is the server pass')
    assert.ok(!/parseSceneOutput|parseSilenceOutput/.test(composable),
      'no stderr log reaches the scorer any more')
    assert.match(composable, /autocutDetect/, 'it asks the one decode leg instead')
    assert.match(composable, /frameDecode/, 'with the real pixel seam')
    assert.match(composable, /audioDecode/, 'and the real sound seam')
    assert.match(composable, /cancel/, 'and the scan can be cancelled')
  })

  console.log(`\n=== [TMCut autocut detect] ${passed} passed ===`)
}

main().catch((error) => {
  console.error('AUTOCUT DETECT SPEC FAILED:', error)
  process.exit(1)
})
