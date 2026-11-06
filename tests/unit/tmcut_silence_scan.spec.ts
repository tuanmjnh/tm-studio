/**
 * Decoder-side silence scan (zero-FFmpeg slice E3, ADR-028/030).
 *
 * ADR-028 row 3 keeps AutoCut's quiet detection alive by re-making it on decoded
 * PCM instead of FFmpeg stderr. Slice E1 put the numbers in core, E2 proved the
 * split with pixels; this slice does the same for sound. Three files, and the
 * split is the same one:
 *
 *  - `app/utils/tmcut/audioDecode.ts` is the PCM seam — the third module allowed
 *    to hold a demuxer, and the only one that touches samples.
 *  - `app/utils/tmcut/silenceScan.ts` holds no platform code: it hands the range
 *    to an injected reader and asks core what the samples mean.
 *  - core owns every number: `loudestPeakSeries` decides how channels become one
 *    level per window, `silenceSpans` decides what quiet is.
 *
 * What is pinned, in order:
 *  - the window width and the floor are core's defaults, so the desktop and the
 *    browser cannot disagree about what a decibel is or how long quiet must last;
 *  - the loudest channel wins a window — that is why the scan calls
 *    `loudestPeakSeries` rather than mixing channels first;
 *  - a trimmed read still reports SOURCE seconds: the seam starts at the clip's
 *    in point, core shifts by it (`offsetSec`), the glue adds nothing;
 *  - a host with no audio decoder, an empty track and an unreal range are all
 *    answered with "no spans" rather than a throw or an invented silence;
 *  - an aborted scan stops asking;
 *  - the seam holds no law.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_silence_scan.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
  console.log('=== [TMCut silence scan] Starting ===\n')
  const core = await import('tmcut-core')
  const { createSilenceScan } = await import('../../app/utils/tmcut/silenceScan')

  const rate = 8000
  const windowSec = core.TMCUT_SILENCE_WINDOW_SEC
  const samples = (seconds: number) => rate * seconds
  /** How many core-sized windows `seconds` of PCM becomes. */
  const windowsOf = (seconds: number) => Math.round(seconds / windowSec)
  /** One second of tone, then one second of nothing: two core-sized halves. */
  const loudThenQuiet = () => [
    new Float32Array([...new Float32Array(samples(1)).fill(0.5), ...new Float32Array(samples(1))])
  ]
  /** The same content twice as long, for the option tests. */
  const alternating = () => [
    new Float32Array([
      ...new Float32Array(samples(1)).fill(0.5),
      ...new Float32Array(samples(1)),
      ...new Float32Array(samples(1)).fill(0.5),
      ...new Float32Array(samples(1))
    ])
  ]

  await check('the scan is its own module and holds no decoder', () => {
    assert.ok(existsSync(join(root, 'app/utils/tmcut/silenceScan.ts')),
      'app/utils/tmcut/silenceScan.ts must own the scan')
    const scan = read('app/utils/tmcut/silenceScan.ts')
    assert.ok(!/from 'mediabunny'/.test(scan), 'the scan must not hold a decoder')
    assert.ok(!/AudioBufferSink|AudioDecoder|getChannelData|BlobSource|UrlSource/.test(scan),
      'sample work belongs to the seam, not to the scan')
  })

  await check('the levels come from core, on the range the caller asked for', async () => {
    const seen: Array<{ inSec: number, outSec: number }> = []
    const scan = createSilenceScan(async (ask) => {
      seen.push({ inSec: ask.inSec, outSec: ask.outSec })
      return { sampleRate: rate, channels: loudThenQuiet() }
    })
    const result = await scan.scan({ inSec: 0, outSec: 2 })
    assert.deepEqual(seen, [{ inSec: 0, outSec: 2 }], 'one range is one read')
    assert.deepEqual(result.spans, core.silenceSpans(
      core.loudestPeakSeries(loudThenQuiet(), rate, windowSec),
      { windowSec, offsetSec: 0, durationSec: 2 }
    ))
    assert.deepEqual(result.spans, [{ start: 1, end: 2 }])
    assert.equal(result.windows, windowsOf(2), 'the whole range was levelled at core\'s window')
  })

  await check('a trimmed read reports source seconds, not window-relative ones', async () => {
    const scan = createSilenceScan(async () => ({ sampleRate: rate, channels: loudThenQuiet() }))
    const trimmed = await scan.scan({ inSec: 10, outSec: 12 })
    assert.deepEqual(trimmed.spans, [{ start: 11, end: 12 }],
      'the clip was trimmed 10s in, so its quiet tail sits at 11s of the source')
    assert.deepEqual(trimmed.spans, core.silenceSpans(
      core.loudestPeakSeries(loudThenQuiet(), rate, windowSec),
      { windowSec, offsetSec: 10, durationSec: 2 }
    ), 'the shift is core\'s offsetSec, not glue arithmetic')
  })

  await check('the loudest channel decides, so a dead channel cannot make content quiet', async () => {
    const deadAndLoud = [new Float32Array(samples(2)), new Float32Array(samples(2)).fill(0.5)]
    const scan = createSilenceScan(async () => ({ sampleRate: rate, channels: deadAndLoud }))
    const result = await scan.scan({ inSec: 0, outSec: 2 })
    assert.deepEqual(result.spans, [], 'one audible channel is enough to keep both seconds loud')
    assert.equal(result.windows, windowsOf(2))
  })

  await check('an unreal range asks the decoder for nothing', async () => {
    let calls = 0
    const scan = createSilenceScan(async () => {
      calls++
      return { sampleRate: rate, channels: loudThenQuiet() }
    })
    for (const ask of [
      { inSec: 0, outSec: 0 },
      { inSec: 4, outSec: 1 },
      { inSec: Number.NaN, outSec: 3 },
      { inSec: 0, outSec: Number.POSITIVE_INFINITY }
    ]) {
      const result = await scan.scan(ask)
      assert.deepEqual(result.spans, [], `${ask.inSec}..${ask.outSec} must answer nothing`)
      assert.equal(result.windows, 0)
    }
    assert.equal(calls, 0, 'an unreal range must not open the decoder')
  })

  await check('no samples delivered is no spans, not a file of silence', async () => {
    const answers = [
      async () => null,
      async () => ({ sampleRate: rate, channels: [] as Float32Array[] })
    ]
    for (const readPcm of answers) {
      const result = await createSilenceScan(readPcm).scan({ inSec: 0, outSec: 4 })
      assert.deepEqual(result.spans, [], 'a host that gave nothing must not be read as silence')
      assert.equal(result.windows, 0)
    }
  })

  await check('caller options reach core instead of a local copy', async () => {
    const scan = createSilenceScan(async () => ({ sampleRate: rate, channels: alternating() }))
    const plain = await scan.scan({ inSec: 0, outSec: 4 })
    assert.deepEqual(plain.spans, [{ start: 1, end: 2 }, { start: 3, end: 4 }])
    assert.deepEqual(await scan.scan({ inSec: 0, outSec: 4, minDurationSec: 2 }),
      { windows: windowsOf(4), spans: [] }, 'a one-second gap is not a two-second silence')
    assert.deepEqual(await scan.scan({ inSec: 0, outSec: 4, noiseDb: 0 }),
      { windows: windowsOf(4), spans: [{ start: 0, end: 4 }] }, 'a raised floor counts the tone as quiet too')
    assert.deepEqual((await scan.scan({ inSec: 0, outSec: 4, windowSec: 2 })).spans,
      core.silenceSpans(core.loudestPeakSeries(alternating(), rate, 2),
        { windowSec: 2, offsetSec: 0, durationSec: 4 }),
      'a widened window is core\'s maths, not a re-sample')
  })

  await check('an aborted scan stops asking and answers nothing', async () => {
    const controller = new AbortController()
    let asked = 0
    const scan = createSilenceScan(async () => {
      asked++
      controller.abort()
      return { sampleRate: rate, channels: loudThenQuiet() }
    })
    const result = await scan.scan({ inSec: 0, outSec: 2, signal: controller.signal })
    assert.equal(asked, 1)
    assert.deepEqual(result.spans, [], 'a cancelled scan paints no EDL')
    assert.equal(result.windows, windowsOf(2), 'what was read is still counted, only the answer is dropped')
    const afterAbort = await scan.scan({ inSec: 0, outSec: 2, signal: controller.signal })
    assert.equal(asked, 1, 'an already-cancelled scan must not open the decoder again')
    assert.deepEqual(afterAbort.spans, [])
    assert.equal(afterAbort.windows, 0)
  })

  await check('the seam aligns packets with core and holds no silence law', () => {
    const seam = read('app/utils/tmcut/audioDecode.ts')
    assert.match(seam, /export async function decodePcm/, 'the PCM read lives in the audio seam')
    assert.match(seam, /AudioBufferSink/, 'samples come from the mediabunny audio sink')
    assert.match(seam, /\.buffers\(/, 'a sequential read decodes each packet once')
    assert.match(seam, /hasAudioDecoder/, 'a host without an audio decoder is answered, not crashed')
    assert.match(seam, /pcmHeadTrim\(/,
      'a packet that starts before the ask is trimmed by core\'s law, not by local arithmetic')
    assert.ok(!/\b(silenceSpans|loudestPeakSeries|peakLevelSeries|dbfsOf)\(/.test(seam),
      'the seam delivers samples; what they mean is decided in core')
  })

  await check('the container belongs to exactly four modules', () => {
    const dir = join(root, 'app/utils/tmcut')
    const holders = readdirSync(dir)
      .filter(name => name.endsWith('.ts'))
      .filter(name => /from 'mediabunny'/.test(readFileSync(join(dir, name), 'utf8')))
      .sort()
    // E3 added one audio seam on purpose. H3b added the one module that opens a
    // container to WRITE it, so the count is four and every entry has a reason:
    // a fifth holder is a fifth place to drift.
    assert.deepEqual(holders, ['audioDecode.ts', 'exportEncodeSession.ts', 'frameDecode.ts', 'mediaProbe.ts'],
      'each reader of the container has a name, and so does its only writer')
  })

  console.log(`\n=== [TMCut silence scan] ${passed} passed ===`)
}

main().catch((error) => {
  console.error('SILENCE SCAN SPEC FAILED:', error)
  process.exit(1)
})
