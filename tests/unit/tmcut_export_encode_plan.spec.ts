/**
 * The export asks the runtime what it can encode, and writes the answer down
 * (zero-FFmpeg slice H2, ADR-029 and ADR-030).
 *
 * H1 put the verdict in core and H2 put the question list there too, so this
 * file has one job left: touch the browser. That is the whole reason it exists —
 * the Phase-0 audit counted `VideoEncoder` zero times in the repo, and the brief
 * for slice H opens with "chạy VideoEncoder.isConfigSupported() trên config thực
 * tế của runtime mục tiêu; ghi kết quả, không đoán hardware H.264". A decision
 * this small is still worth its own seam, because four failures live exactly
 * here:
 *
 *  * A runtime with no WebCodecs must be a refusal the user can read, not a
 *    `VideoEncoder is not defined` thrown while the export dialog is open.
 *  * Probing is not free. The same output request must not re-ask six configs
 *    every time the dialog opens, so a capability remembers what it asked —
 *    keyed by the whole question, because the level and the frame rate are part
 *    of it and a 30 fps answer is not a 60 fps answer.
 *  * An answer that names a different codec than the one asked is not a gift.
 *    Core calls it a substitution; this file must not undo that by taking the
 *    config anyway.
 *  * The audio half is asked too. A runtime that encodes video and refuses the
 *    audio spelling would otherwise produce a silent file, which is the exact
 *    failure mode ADR-030 was written to forbid.
 *
 * It deliberately does not import `mediabunny`: the muxer belongs to the encode
 * session, and three specs freeze which files may import that package.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_encode_plan.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEncodeCapability } from '../../app/utils/tmcut/exportEncodePlan'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_60 = { numerator: 60, denominator: 1 }
const REQUEST = { width: 1920, height: 1080, fps: RATE_30, audio: { sampleRate: 48000, channelCount: 2 } }

type Support = { supported?: boolean, config?: { codec?: string } }
type AskedConfig = Record<string, unknown>

const codecOf = (config: AskedConfig) => String(config.codec)

/**
 * A fake runtime: answers per codec string, counts every config it was shown,
 * and keeps the two halves of WebCodecs apart so a missing audio encoder is
 * visible as its own failure.
 */
function fakeRuntime(options: {
  video?: (codec: string) => Support | undefined
  audio?: (codec: string) => Support | undefined
} = {}) {
  const asked = { video: [] as AskedConfig[], audio: [] as AskedConfig[] }
  return {
    asked,
    probeVideo: async (config: AskedConfig) => {
      asked.video.push(config)
      return options.video?.(codecOf(config)) ?? { supported: true, config: { codec: codecOf(config) } }
    },
    probeAudio: async (config: AskedConfig) => {
      asked.audio.push(config)
      return options.audio?.(codecOf(config)) ?? { supported: true, config: { codec: codecOf(config) } }
    }
  }
}

async function main() {
  console.log('\n--- tmcut export encode plan (slice H2) ---')

  await check('takes the first config the runtime accepts, in ladder order', async () => {
    const runtime = fakeRuntime({ video: codec => codec.startsWith('avc1.') ? { supported: false } : undefined })
    const decision = await createEncodeCapability(runtime).decide(REQUEST)
    assert.equal(decision.kind, 'ready')
    assert.ok(!decision.config!.video.codec.startsWith('avc1.'), `took a refused codec: ${decision.config!.video.codec}`)
    assert.equal(decision.container, 'webm', `the winner asked for ${decision.container}; the muxer is not a guess`)
    assert.equal(runtime.asked.video.length, runtime.asked.audio.length, 'every video question needs its audio question')
  })

  await check('asks both AAC spellings before it gives up on audio', async () => {
    const runtime = fakeRuntime({ audio: codec => codec === 'aac' ? { supported: false } : undefined })
    const decision = await createEncodeCapability(runtime).decide(REQUEST)
    assert.equal(decision.kind, 'ready')
    assert.equal(decision.config!.audio?.codec, 'mp4a.40.2', `chose ${decision.config!.audio?.codec}`)
  })

  await check('refuses a runtime with no encoders instead of throwing', async () => {
    const decision = await createEncodeCapability({}).decide(REQUEST)
    assert.equal(decision.kind, 'refused')
    assert.ok(decision.errors.length > 0, 'the refusal has no reason a UI can show')
    assert.match(decision.errors.join(' '), /answers nothing/, `a runtime with no encoder is not a runtime that refused: ${decision.errors.join(' ')}`)
    assert.equal(decision.config, null)
  })

  await check('refuses an unusable request without touching the runtime', async () => {
    const runtime = fakeRuntime()
    const decision = await createEncodeCapability(runtime).decide({ width: 1921, height: 1080, fps: RATE_30 })
    assert.equal(decision.kind, 'refused')
    assert.equal(runtime.asked.video.length, 0, 'probed a config core never offered')
    assert.ok(decision.errors.join(' ').includes('chroma'), decision.errors.join(' '))
  })

  await check('does not accept a substituted codec, even though it was offered', async () => {
    // HEVC is in no ladder: every question comes back answered with a codec
    // that was never asked, so the whole matrix is one substitution.
    const runtime = fakeRuntime({ video: () => ({ supported: true, config: { codec: 'hev1.1.6.L153.B0' } }) })
    const decision = await createEncodeCapability(runtime).decide(REQUEST)
    assert.equal(decision.kind, 'refused')
    assert.equal(decision.config, null, 'the exporter took a codec it never asked for')
    assert.ok(decision.checked.every(row => row.verdict === 'substituted'), 'the matrix lost the substitution')
    assert.ok(decision.errors.join(' ').includes('hev1'), decision.errors.join(' '))
  })

  await check('a probe the API rejects is an unanswered question, not a refusal', async () => {
    const throws = (codec: string) => {
      if (codec.startsWith('avc1.')) throw new TypeError('the API rejected the shape')
    }
    const throwing = fakeRuntime({ video: throws })
    const decision = await createEncodeCapability(throwing).decide(REQUEST)
    const avc = decision.checked.filter(row => row.preset?.video.codec.startsWith('avc1.')).map(row => row.verdict)
    assert.ok(avc.length > 0, 'the ladder never asked H.264')
    assert.ok(avc.every(verdict => verdict === 'unmeasured'), `a thrown probe was written down as ${avc.join(', ')}`)
    assert.equal(decision.kind, 'ready', 'one rejected shape cancelled every codec that did answer')

    const refusing = fakeRuntime({ video: codec => codec.startsWith('avc1.') ? { supported: false } : undefined })
    const refused = await createEncodeCapability(refusing).decide(REQUEST)
    assert.ok(refused.checked.some(row => row.verdict === 'unsupported'), 'a runtime that refused a codec is not an unasked question')
  })

  await check('remembers the answers for one request, keyed by the whole question', async () => {
    const runtime = fakeRuntime()
    const capability = createEncodeCapability(runtime)
    const first = await capability.decide(REQUEST)
    const probes = runtime.asked.video.length
    const again = await capability.decide(REQUEST)
    assert.equal(runtime.asked.video.length, probes, 're-probed a request it already asked')
    assert.deepEqual(again.checked, first.checked)
    await capability.decide({ ...REQUEST, fps: RATE_60 })
    assert.ok(runtime.asked.video.length > probes, 'reused the 30 fps answers for a 60 fps export')
  })

  await check('passes the picture, the rate and the bitrate to the runtime, not a bare codec', async () => {
    const runtime = fakeRuntime()
    await createEncodeCapability(runtime).decide(REQUEST)
    const asked = runtime.asked.video[0]
    assert.equal(asked.width, 1920)
    assert.equal(asked.height, 1080)
    assert.equal(asked.framerate, 30)
    assert.ok(Number(asked.bitrate) > 0, `bitrate ${String(asked.bitrate)} never reached the probe`)
    assert.equal(codecOf(asked).slice(0, 4), 'avc1')
  })

  await check('asks the API in its own shape, not core\'s', async () => {
    const runtime = fakeRuntime()
    await createEncodeCapability(runtime).decide(REQUEST)
    const avc = runtime.asked.video.find(config => codecOf(config).startsWith('avc1.'))
    assert.ok(avc, 'the ladder never asked H.264')
    assert.equal((avc.avc as { format?: string } | undefined)?.format, 'avc', 'an H.264 question without its codec option block is a different codec')
    const other = runtime.asked.video.find(config => !codecOf(config).startsWith('avc1.'))
    assert.ok(other, 'the ladder asked only H.264')
    assert.ok(!('avc' in other), `isConfigSupported throws on ${JSON.stringify(other)}; a throw is not an answer`)
    const audio = runtime.asked.audio[0]
    assert.equal(audio.sampleRate, 48000)
    assert.equal(audio.numberOfChannels, 2, `channel count reached the API as ${Object.keys(audio).join(', ')}`)
  })

  await check('the decision is core\'s and the muxer is not imported here', () => {
    const source = read('app/utils/tmcut/exportEncodePlan.ts')
    assert.match(source, /planEncodePresets/, 'the question list is core\'s')
    assert.match(source, /planEncodeConfig/, 'the verdict is core\'s')
    // The claim is the import, not the word: the file may explain what it omits.
    assert.doesNotMatch(source, /from ['"]mediabunny['"]|import\(['"]mediabunny['"]\)/, 'the muxer belongs to the encode session, not this file')
  })

  console.log(`\n=== All ${passed} export-encode-plan checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
