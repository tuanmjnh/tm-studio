/**
 * Browser media integration check — the half of the decode contract Node cannot see.
 *
 * Node 24 can demux: `probeMedia` answers from a fixture under plain `node --test`.
 * It cannot decode: `VideoDecoder` and `AudioDecoder` are undefined there, so
 * `decodeFrame` and `decodePcm` return `null`. That is the modules answering
 * honestly about a host without WebCodecs, not a defect — but it does mean no
 * Node-only spec can prove the browser-first runtime works, which is exactly
 * why extracting `packages/media-core` is BLOCKED / DEFERRED. See
 * docs/audit/repository-package-architecture-audit.md and
 * docs/architecture/core-package-contract.md.
 *
 * This harness loads the REAL sources, not a copy: it imports
 * `app/utils/tmcut/{mediaProbe,frameDecode,audioDecode}.ts` through the dev
 * server's Vite graph, so `tmcut-core` and `mediabunny` resolve the way they
 * resolve for the app. A green run here is evidence about those files.
 *
 * What it measures:
 *   1. probe      — Mediabunny reads the fixture's container and one video track
 *   2. capability — WebCodecs exists and core's capability record is filled in
 *   3. frames     — decode at the start, middle and end of a 0.6 s / 6-packet clip
 *   4. ordering   — those three PNGs are byte-distinct, so "middle" is a different
 *                   instant rather than a still that would pass a shape-only check
 *   5. audio      — a generated WAV decodes to real PCM whose peak matches the
 *                   authored amplitude; no committed fixture carries audio
 *   6. audio range — a multi-packet Opus file is built in the page and asked for
 *                   several sub-ranges: the head must be aligned to the ask, and
 *                   the tail overrun must stay inside one packet
 *   7. errors     — a corrupt container answers `null` instead of throwing
 *   8. cancel     — an already-aborted ask returns `null` for both seams
 *
 * Run:
 *   node node_modules/tsx/dist/cli.mjs tests/e2e/browser_media_integration.mts
 *
 * Needs a browser and a dev server. Missing either prints `SKIP` with the reason
 * and exits 0; `tests/unit/helpers/spec_status.ts` turns that into SKIP, never
 * PASS, so a machine without a browser cannot claim it measured one.
 *
 * A CI machine is not such a machine. Set `TMCUT_BROWSER_REQUIRED=1` there and a
 * skip becomes exit 1: the job exists to measure decode, so "I could not" is a
 * failure with a reason rather than a green run over nothing. The default stays
 * permissive so a laptop without the dev server is not told it broke something.
 *
 * Browser resolution, in order: `TMCUT_BROWSER_CHANNEL` (a playwright channel
 * name), a Playwright-installed Chromium, then the Edge that ships on Windows.
 * Electron is not used here: the check is about the web runtime the renderer is
 * built on, and driving the packaged app would drag in the IPC surface.
 */
import { chromium, type Browser } from 'playwright-core'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { SKIP, PARTIAL } from '../unit/helpers/spec_status'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const DEV_URL = process.env.TMCUT_DEV_URL || 'http://localhost:4003'
const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'containers', 'h264.mp4')

/** The fixture, measured: 6 packets at 10 fps over 0.6 s, 64x36, video only. */
const FIXTURE_SECONDS = 0.6
const FIXTURE_PACKETS = 6

function say(message: string): void {
  console.log(message)
}

/**
 * A run that measured nothing. Exit code follows `TMCUT_BROWSER_REQUIRED`: off by
 * default so a laptop is not failed for having no dev server, on in CI so a job
 * that exists to measure decode cannot pass without measuring it.
 */
function bail(reason: string): never {
  const required = process.env.TMCUT_BROWSER_REQUIRED === '1'
  say(`${SKIP}  browser media integration: ${reason}`)
  if (required) {
    say(`browser media integration: TMCUT_BROWSER_REQUIRED=1 and nothing was measured — failing`)
    process.exit(1)
  }
  process.exit(0)
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/** Try each browser source in turn and report which one answered. */
async function launch(): Promise<{ browser: Browser, via: string }> {
  const attempts: Array<{ via: string, options: Record<string, unknown> }> = []
  if (process.env.TMCUT_BROWSER_CHANNEL) {
    attempts.push({ via: `channel ${process.env.TMCUT_BROWSER_CHANNEL}`, options: { channel: process.env.TMCUT_BROWSER_CHANNEL } })
  }
  attempts.push({ via: 'playwright chromium', options: {} })
  if (process.platform === 'win32') attempts.push({ via: 'msedge channel', options: { channel: 'msedge' } })

  const failures: string[] = []
  for (const attempt of attempts) {
    try {
      return { browser: await chromium.launch(attempt.options), via: attempt.via }
    } catch (error) {
      // Missing browser is the expected failure; a launch error is not worth retrying.
      failures.push(`${attempt.via}: ${(error as Error).message.split('\n')[0]}`)
    }
  }
  bail(`no browser could be launched (${failures.join('; ')})`)
}

if (!existsSync(FIXTURE)) bail(`fixture missing: ${path.relative(ROOT, FIXTURE)}`)
if (!(await reachable(DEV_URL))) bail(`no dev server at ${DEV_URL} — start \`pnpm dev\``)

const fixtureBase64 = readFileSync(FIXTURE).toString('base64')
const { browser, via } = await launch()
say(`browser: ${via}`)

let passed = 0
let skipped = 0
const failures: string[] = []

function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    say(`FAIL  ${name}${detail ? `: ${detail}` : ''}`)
    return
  }
  passed++
  say(`[ok] ${name}${detail ? `: ${detail}` : ''}`)
}

function skipCheck(name: string, reason: string): void {
  skipped++
  say(`${SKIP}  ${name}: ${reason}`)
}

try {
  const page = await browser.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  // Any same-origin page will do; a dynamic import of an app module resolves
  // through Vite from wherever it is called.
  //
  // The `__name` shim is for the harness, not the app: tsx compiles this file
  // with esbuild's keepNames, which wraps functions in `__name(fn, "…")`. That
  // call is serialised into the function source Playwright evaluates in the page,
  // where no such helper exists. Defining it as identity keeps the transform
  // harmless and leaves the measured code untouched.
  await page.addInitScript(() => {
    const scope = globalThis as Record<string, unknown>
    scope.__name ??= (fn: unknown) => fn
  })
  await page.goto(`${DEV_URL}/login`, { waitUntil: 'domcontentloaded' })

  const measured = await page.evaluate(async ({ b64, seconds, packets }) => {
    const seamed = (file: string) => `/_nuxt/@fs/${file.replace(/\\/g, '/')}`
    const at = (p: string) => seamed(`D:/Applications/tm-studio/${p}`)

    const probe = await import(/* @vite-ignore */ at('app/utils/tmcut/mediaProbe.ts'))
    const pixels = await import(/* @vite-ignore */ at('app/utils/tmcut/frameDecode.ts'))
    const sound = await import(/* @vite-ignore */ at('app/utils/tmcut/audioDecode.ts'))

    const video = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/mp4' })
    const signal = new AbortController().signal

    const info = await probe.probeMedia({ name: 'h264.mp4', size: video.size, mimeType: 'video/mp4', blob: video })
    const capabilities = await probe.getMediaCapabilities()

    // A hash of the PNG so "a different instant" is proven by content, not by size.
    const digest = (blob: Blob) => blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer)
      let hash = 2166136261
      for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i]!, 16777619) >>> 0
      return `${bytes.length}:${hash}`
    })

    const instants = [0, seconds / 2, seconds - 0.01]
    const frames: Array<{ at: number, size: number, type: string, digest: string } | null> = []
    for (const atSec of instants) {
      const frame = await pixels.decodeFrame({ key: 'probe', atSec, width: 64, bytes: video, src: null, signal })
      frames.push(frame ? { at: atSec, size: frame.size, type: frame.type, digest: await digest(frame) } : null)
    }

    // A corrupt container: valid prefix, then noise where the box data was.
    const corruptBytes = new Uint8Array(4096)
    corruptBytes.set(new Uint8Array([0, 0, 0, 24]).subarray(0, 4))
    for (let i = 8; i < corruptBytes.length; i++) corruptBytes[i] = (i * 37) & 0xff
    const corruptFrame = await pixels.decodeFrame({
      key: 'corrupt', atSec: 0, width: 64,
      bytes: new Blob([corruptBytes], { type: 'video/mp4' }), src: null, signal
    }).then(() => 'resolved', error => `threw:${String(error).slice(0, 60)}`)

    // A WAV the page builds itself: 0.5 s of 440 Hz at 12000/32768 amplitude.
    const rate = 8000
    const total = rate * 0.5
    const dataBytes = total * 2
    const buffer = new ArrayBuffer(44 + dataBytes)
    const view = new DataView(buffer)
    const put = (offset: number, text: string) => {
      for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
    }
    put(0, 'RIFF')
    view.setUint32(4, 36 + dataBytes, true)
    put(8, 'WAVE')
    put(12, 'fmt ')
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true)
    view.setUint16(22, 1, true)
    view.setUint32(24, rate, true)
    view.setUint32(28, rate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true)
    put(36, 'data')
    view.setUint32(40, dataBytes, true)
    for (let i = 0; i < total; i++) {
      view.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * (i / rate)) * 12000), true)
    }
    const wav = new Blob([buffer], { type: 'audio/wav' })
    const wavInfo = await probe.probeMedia({ name: 'tone.wav', size: wav.size, mimeType: 'audio/wav', blob: wav })
    const pcm = await sound.decodePcm({ bytes: wav, src: null, signal, inSec: 0.1, outSec: 0.4 })
    let peak = 0
    if (pcm) for (const channel of pcm.channels) for (const value of channel) peak = Math.max(peak, Math.abs(value))

    // A multi-packet stream, because a WAV is one packet and cannot exercise a
    // range at all. Opus in WebM, encoded in this page with the mediabunny the app
    // already depends on and WebCodecs it already uses. Four 250 ms blocks at
    // 0.8/0.4/0.2/0.1 of full scale — descending on purpose: an untrimmed head
    // leaks the louder block before the ask, which an ascending ladder would hide.
    const ranges: Array<{
      inSec: number
      outSec: number
      askedSamples: number
      deliveredSamples: number
      headPeak: number
      expectedHead: number
    }> = []
    let multiPacket: { codec: string | null, tracks: number } | null
    try {
      const mb = await import(/* @vite-ignore */ '/_nuxt/@id/mediabunny')
      const toneRate = 48000
      const toneSamples = toneRate
      const levels = [0.8, 0.4, 0.2, 0.1]
      const tone = new Float32Array(toneSamples)
      for (let i = 0; i < toneSamples; i++) {
        const block = Math.min(levels.length - 1, Math.floor(i / (toneSamples / levels.length)))
        tone[i] = Math.sin(2 * Math.PI * 440 * (i / toneRate)) * levels[block]!
      }
      const output = new mb.Output({ format: new mb.WebMOutputFormat(), target: new mb.BufferTarget() })
      const source = new mb.AudioBufferSource({ codec: 'opus', quality: mb.QUALITY_HIGH })
      output.addAudioTrack(source)
      await output.start()
      const audioBuffer = new AudioBuffer({ length: toneSamples, numberOfChannels: 1, sampleRate: toneRate })
      audioBuffer.copyToChannel(tone, 0)
      await source.add(audioBuffer)
      source.close()
      await output.finalize()
      const stream = new Blob([new Uint8Array(output.target.buffer)], { type: 'audio/webm' })
      const streamInfo = await probe.probeMedia({ name: 'blocks.webm', size: stream.size, mimeType: 'audio/webm', blob: stream })
      multiPacket = { codec: streamInfo.audioTracks[0]?.codec ?? null, tracks: streamInfo.audioTracks.length }

      for (const [from, to] of [[0, 0.5], [0.25, 0.5], [0.1, 0.4], [0.5, 0.75], [0.6, 0.9]] as const) {
        const part = await sound.decodePcm({ bytes: stream, src: null, signal, inSec: from, outSec: to })
        if (!part) continue
        const channel = part.channels[0]!
        const block = Math.min(levels.length - 1, Math.floor((from * toneRate) / (toneSamples / levels.length)))
        let head = 0
        const headSamples = Math.min(channel.length, Math.round(part.sampleRate * 0.02))
        for (let i = 0; i < headSamples; i++) head = Math.max(head, Math.abs(channel[i]!))
        ranges.push({
          inSec: from,
          outSec: to,
          askedSamples: Math.round((to - from) * part.sampleRate),
          deliveredSamples: channel.length,
          headPeak: head,
          expectedHead: levels[block]!
        })
      }
    } catch (error) {
      multiPacket = null
      say(`note: the multi-packet fixture could not be built — ${String(error).slice(0, 120)}`)
    }

    // Cancellation, on both seams, with an already-aborted signal.
    const aborted = new AbortController()
    aborted.abort()
    const cancelledFrame = await pixels.decodeFrame({
      key: 'cancel', atSec: 0, width: 64, bytes: video, src: null, signal: aborted.signal
    })
    const cancelledPcm = await sound.decodePcm({ bytes: wav, src: null, signal: aborted.signal, inSec: 0, outSec: 0.2 })

    return {
      webCodecs: typeof globalThis.VideoDecoder === 'function' && typeof globalThis.AudioDecoder === 'function',
      videoTracks: info.videoTracks.length,
      audioTracks: info.audioTracks.length,
      codec: info.videoTracks[0]?.codec ?? null,
      pixelWidth: info.videoTracks[0]?.displayWidth ?? null,
      imported: info.duration?.estimated ?? info.duration?.container ?? null,
      capabilityKeys: Object.keys(capabilities ?? {}).sort(),
      capabilityCodecCount: (capabilities?.decodableVideoCodecs ?? []).length,
      hasFrameDecoder: pixels.hasFrameDecoder(),
      hasAudioDecoder: sound.hasAudioDecoder(),
      frames,
      instants,
      corruptFrame,
      wavAudioTracks: wavInfo.audioTracks.length,
      wavCodec: wavInfo.audioTracks[0]?.codec ?? null,
      pcm: pcm ? { sampleRate: pcm.sampleRate, channels: pcm.channels.length, samples: pcm.channels[0]?.length ?? 0, peak } : null,
      cancelledFrame: cancelledFrame === null,
      cancelledPcm: cancelledPcm === null,
      multiPacket,
      ranges,
      packets: packets
    }
  }, { b64: fixtureBase64, seconds: FIXTURE_SECONDS, packets: FIXTURE_PACKETS })

  // 1. probe
  check('probe reads the container and one video track',
    measured.videoTracks === 1 && measured.codec === 'avc',
    `videoTracks=${measured.videoTracks} codec=${measured.codec} width=${measured.pixelWidth}`)

  // 2. capability
  check('the browser has WebCodecs (VideoDecoder and AudioDecoder)', measured.webCodecs)
  check('core reports a filled capability record', measured.capabilityKeys.length === 6 && measured.capabilityCodecCount > 0,
    `keys=${measured.capabilityKeys.length} decodableVideoCodecs=${measured.capabilityCodecCount}`)
  check('both seams report a usable decoder on this host',
    measured.hasFrameDecoder && measured.hasAudioDecoder,
    `frame=${measured.hasFrameDecoder} audio=${measured.hasAudioDecoder}`)

  // 3 + 4. frames and ordering
  const decoded = measured.frames.filter((frame): frame is NonNullable<typeof frame> => frame !== null)
  check('all three instants decode to PNG', decoded.length === 3,
    decoded.length === 3 ? decoded.map(f => `${f.at}s=${f.size}B`).join(' ') : `${decoded.length}/3 decoded`)
  const digests = new Set(decoded.map(frame => frame.digest))
  check('start, middle and end are different pictures', digests.size === decoded.length && decoded.length > 1,
    `${digests.size} distinct of ${decoded.length}`)

  // 5. audio
  if (measured.wavAudioTracks === 0) {
    skipCheck('PCM decode', 'the generated WAV did not probe as an audio track on this browser')
  } else {
    check('a generated WAV decodes to PCM with the authored amplitude',
      measured.pcm !== null
      && measured.pcm.sampleRate === 8000
      && measured.pcm.channels === 1
      && measured.pcm.samples > 0
      && Math.abs(measured.pcm.peak - 12000 / 32768) < 0.01,
      measured.pcm
        ? `${measured.pcm.sampleRate}Hz ${measured.pcm.channels}ch ${measured.pcm.samples} samples peak=${measured.pcm.peak.toFixed(4)} codec=${measured.wavCodec}`
        : 'decodePcm returned null')
  }
  if (measured.audioTracks === 0) {
    // Worth stating rather than hiding: the committed video fixtures carry no sound.
    skipCheck('PCM decode from a committed fixture', 'every containers/ fixture is video-only')
  }

  // 6. a real multi-packet range: head alignment, and how far past the ask it runs
  if (!measured.multiPacket || measured.multiPacket.tracks === 0) {
    skipCheck('PCM range on a multi-packet stream', 'this browser could not produce an Opus stream to range over')
  } else if (measured.ranges.length < 5) {
    check('every asked range decoded on a multi-packet stream', false,
      `${measured.ranges.length} of 5 ranges returned samples`)
  } else {
    // The head is the part the seam actually trims, so it is the part that must
    // be exact: the first 20 ms of each answer has to carry the amplitude of the
    // source block the ask started in, not the block before it.
    const misaligned = measured.ranges.filter(range => Math.abs(range.headPeak - range.expectedHead) > 0.02)
    check('every range starts where it was asked to', misaligned.length === 0,
      misaligned.length === 0
        ? measured.ranges.map(r => `${r.inSec}s head=${r.headPeak.toFixed(2)}`).join(' ')
        : misaligned.map(r => `${r.inSec}s head=${r.headPeak.toFixed(3)} wanted=${r.expectedHead}`).join('; '))

    // The tail is not trimmed by the seam — measured, not assumed. Every answer
    // ran 144 or 624 samples (3 or 13 ms at 48 kHz) past the ask, one Opus packet.
    // Pinning the bound is what would catch a decoder that started returning
    // whole seconds.
    const overruns = measured.ranges.map(range => range.deliveredSamples - range.askedSamples)
    const worstMs = Math.max(...measured.ranges.map(range =>
      Math.round((range.deliveredSamples - range.askedSamples) / (range.askedSamples / (range.outSec - range.inSec)) * 1000)))
    check('the tail overrun stays inside one packet', overruns.every(overrun => overrun >= 0 && worstMs <= 25),
      `worst ${worstMs}ms over the ask across ${measured.ranges.length} ranges`)
  }

  // 7. errors
  check('a corrupt container answers null instead of throwing', measured.corruptFrame === 'resolved',
    measured.corruptFrame)

  // 7. cancel
  check('an aborted frame ask returns null', measured.cancelledFrame)
  check('an aborted PCM ask returns null', measured.cancelledPcm)
  check('the page raised no uncaught error', pageErrors.length === 0, pageErrors.join('; '))

  await page.close()
} finally {
  await browser.close()
}

const total = passed + failures.length
if (failures.length > 0) {
  say(`\n=== browser media integration: ${passed}/${total} checks passed, ${failures.length} failed, ${skipped} skipped ===`)
  for (const failure of failures) say(`  - ${failure}`)
  process.exitCode = 1
} else {
  say(`\n=== browser media integration: all ${passed} checks passed${skipped > 0 ? `, ${skipped} ${PARTIAL}` : ''} ===`)
}
