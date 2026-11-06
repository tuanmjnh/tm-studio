/**
 * MediaProbeService (zero-FFmpeg plan §4) — the one host-agnostic collector.
 *
 * This spec is the proof that a probe needs no FFmpeg and no second copy per
 * host. It runs the real demuxer over bytes and over HTTP range requests, in a
 * runtime that has no WebCodecs at all, so the honest answers are the ones a
 * browser would also give: what it cannot know stays unknown instead of a zero.
 *
 * What is pinned here, in order:
 *  - capabilities with no WebCodecs: an empty list means "nothing known", and
 *    core then refuses to claim decode or encode support (never `true`);
 *  - a real container demuxed from bytes: duration from the container, the
 *    track's own sample rate and channel count, `importStatus: 'ready'`;
 *  - the same file over HTTP, which is what `media://local` is on desktop
 *    (electron/media-protocol.cjs answers `Accept-Ranges: bytes` with 206s, and
 *    tmcut_media_protocol.spec.ts pins that);
 *  - a container the demuxer does not know: `unsupported` with the reason, not
 *    a silently truncated record;
 *  - a still image, which has no timeline: raster size or an explicit
 *    "this runtime cannot draw it", never a fabricated one-frame video track;
 *  - cancellation throwing instead of answering, and a probe with neither bytes
 *    nor a location refusing outright;
 *  - the adapter leg: name, kind and hints derived from the stored locator, and
 *    the source resolver that must ignore the playback proxy;
 *  - the timeline's two desktop pickers taking a clip's length from this
 *    service, which is how the ruler and the bin stop disagreeing;
 *  - rule 12 structurally: exactly two files in `app/` may open a container —
 *    one to describe it, one to draw a frame of it.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_media_probe.spec.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Installs the Nuxt auto-import shims: importing the adapter reaches the store,
// which is written against them. Must stay before the dynamic imports below.
import './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/**
 * A one-channel PCM WAV, written by hand so the suite needs no media fixture:
 * a demuxer reads this the same way it reads any container it knows.
 */
function wavBytes(seconds: number, sampleRate: number, channels: number): Uint8Array {
  const frames = Math.round(seconds * sampleRate)
  const bytesPerFrame = channels * 2
  const dataSize = frames * bytesPerFrame
  const view = new DataView(new ArrayBuffer(44 + dataSize))
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerFrame, true)
  view.setUint16(32, bytesPerFrame, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * bytesPerFrame, 1000, true)
  return new Uint8Array(view.buffer)
}

function wavBlob(seconds = 0.5, sampleRate = 8000, channels = 1): Blob {
  return new Blob([wavBytes(seconds, sampleRate, channels)], { type: 'audio/wav' })
}

/**
 * A byte source that serves ranges, so one URL answers a demuxer the way
 * `media://local` answers it on desktop. `stats.partial` counts the 206s, which
 * is the measurement behind the claim that one service can serve both hosts.
 */
function serveBuffer(
  buffer: Buffer,
  contentType: string,
  name = 'tone.wav'
): Promise<{ url: string, stats: { partial: number }, close: () => Promise<void> }> {
  const stats = { partial: 0 }
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
      if (range && (range[1] !== '' || range[2] !== '')) {
        const start = range[1] === '' ? Math.max(0, buffer.length - Number(range[2])) : Number(range[1])
        const end = range[2] === '' || range[1] === '' ? buffer.length - 1 : Number(range[2])
        stats.partial++
        res.writeHead(206, {
          'content-type': contentType,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${buffer.length}`,
          'accept-ranges': 'bytes'
        })
        res.end(buffer.subarray(start, end + 1))
        return
      }
      res.writeHead(200, { 'content-type': contentType, 'content-length': String(buffer.length), 'accept-ranges': 'bytes' })
      res.end(buffer)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/${name}`,
        stats,
        close: () => new Promise(done => server.close(() => done()))
      })
    })
  })
}

function serveWav(seconds: number) {
  return serveBuffer(Buffer.from(wavBytes(seconds, 8000, 1)), 'audio/wav')
}

async function main() {
  console.log('=== [TMCut media probe service] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  if (!g.useToast) g.useToast = () => ({ add: () => {} })

  const { getMediaCapabilities, probeMedia, probeMediaMetadata } = await import('../../app/utils/tmcut/mediaProbe')
  const { useTmcutPlatform } = await import('../../app/composables/useTmcutPlatform')

  await check('a runtime without WebCodecs knows nothing, and says so', async () => {
    const capabilities = await getMediaCapabilities()
    assert.equal(capabilities.hasWebCodecs, false, 'plain Node runs no WebCodecs')
    assert.deepEqual(capabilities.decodableVideoCodecs, [], 'no codec table to read')
    assert.deepEqual(capabilities.encodableAudioCodecs, [])
    assert.equal(capabilities.hasAudioGraph, false, 'and no audio graph either')
    // The same question twice is one answer, asked once: it is a property of the
    // runtime, and every probe would otherwise re-query the codec tables.
    assert.equal(await getMediaCapabilities(), capabilities, 'memoized')
  })

  await check('a real container demuxed from bytes reports what it is', async () => {
    const bytes = wavBytes(0.5, 8000, 1)
    const info = await probeMedia({ name: 'tone.wav', blob: new Blob([bytes]), size: bytes.byteLength })
    assert.equal(info.kind, 'audio', 'the demuxer found an audio track, so the kind is not a guess from the name')
    assert.equal(info.container, 'WAVE')
    assert.equal(info.duration, 0.5)
    assert.equal(info.durationSource, 'container')
    assert.equal(info.videoTracks.length, 0)
    assert.equal(info.audioTracks.length, 1)
    const track = info.audioTracks[0]
    assert.equal(track.sampleRate, 8000, 'read from the fmt chunk, not defaulted')
    assert.equal(track.channels, 1)
    assert.equal(typeof track.codec, 'string')
    assert.equal(info.compatibility.canDemux, true)
    assert.equal(info.compatibility.canPreview, true)
    assert.equal(info.compatibility.canDecodeAudio, true, 'the track answered canDecode itself')
    assert.equal(info.compatibility.canExportSourceCodec, false, 'no encoder read means no lossless-export claim')
    assert.equal(info.importStatus, 'ready')
    assert.deepEqual(info.probeWarnings, [], 'a clean probe warns about nothing')
  })

  await check('the same file over ranged HTTP answers the same', async () => {
    const host = await serveWav(0.5)
    try {
      const info = await probeMedia({ name: 'tone.wav', url: host.url, size: 40044 })
      assert.equal(info.container, 'WAVE')
      assert.equal(info.duration, 0.5)
      assert.equal(info.audioTracks[0].sampleRate, 8000)
      assert.equal(info.importStatus, 'ready')
      assert.ok(host.stats.partial > 0, 'the demuxer asked for ranges, which is why media://local works here')
    } finally {
      await host.close()
    }
  })

  await check('bytes no demuxer knows end the probe with a reason, not a record', async () => {
    const junk = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8])
    const info = await probeMedia({ name: 'clip.mp4', blob: new Blob([junk]), size: junk.byteLength })
    assert.equal(info.compatibility.canDemux, false)
    assert.ok(info.probeWarnings.some(entry => entry.code === 'CONTAINER_UNDEMODABLE' && entry.severity === 'error'))
    // `error`, not `unsupported`: a file that yielded no length and no track at
    // all was never read, so the honest status is the one the import list shows
    // as a failure. `unsupported` is for a file the probe *did* read and can
    // then refuse, which packages/core/test/media-info.test.mjs pins separately.
    assert.equal(info.importStatus, 'error')
    assert.equal(info.duration, undefined, 'no length is invented for an unreadable file')
    assert.equal(info.videoTracks.length, 0)
  })

  await check('a still image has a raster, not a fabricated one-frame track', async () => {
    const previous = g.createImageBitmap
    const bitmapCalls: number[] = []
    g.createImageBitmap = async (blob: Blob) => {
      bitmapCalls.push(blob.size)
      return { width: 640, height: 360, close: () => {} }
    }
    try {
      const png = new Uint8Array(1200)
      const info = await probeMedia({ name: 'poster.png', blob: new Blob([png]), size: png.byteLength, kind: 'image' })
      assert.equal(info.kind, 'image')
      assert.deepEqual(bitmapCalls, [png.byteLength], 'the raster attempt is the probe')
      assert.deepEqual(info.still, { width: 640, height: 360, decodable: true })
      assert.equal(info.videoTracks.length, 0, 'no invented track to satisfy the schema')
      assert.equal(info.compatibility.canPreview, true)
      assert.equal(info.importStatus, 'ready')
      // An image has no timeline, so 'unknown' is the truthful length source, and
      // core keeps quiet about it: a readable still is not a broken import.
      assert.equal(info.durationSource, 'unknown')
      assert.deepEqual(info.probeWarnings, [])
    } finally {
      if (previous === undefined) delete g.createImageBitmap
      else g.createImageBitmap = previous
    }
  })

  await check('a runtime that cannot draw the still says which, and stops there', async () => {
    // No createImageBitmap shim: this is exactly the desktop-less case, and the
    // answer must be an explicit refusal rather than a zero-sized image.
    const info = await probeMedia({ name: 'photo.heic', blob: new Blob([new Uint8Array(64)]), size: 64, kind: 'image' })
    assert.deepEqual(info.still, { decodable: false })
    assert.equal(info.compatibility.canPreview, false)
    assert.equal(info.importStatus, 'unsupported')
    assert.ok(info.probeWarnings.some(entry => entry.code === 'IMAGE_NOT_DECODABLE'))
  })

  await check('a cancelled probe throws instead of returning a verdict', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      () => probeMedia({ name: 'tone.wav', blob: wavBlob(), size: 4044 }, { signal: controller.signal }),
      /probe cancelled: tone\.wav/
    )
    // The distinction is the point: an aborted scan must not arrive at the
    // import list as `unsupported`, because the file was never judged.
    const late = new AbortController()
    const pending = probeMedia({ name: 'tone.wav', blob: wavBlob(), size: 4044 }, { signal: late.signal })
    late.abort()
    await assert.rejects(() => pending, /probe cancelled/)
  })

  await check('bytes and a location are both missing, so the probe refuses', async () => {
    await assert.rejects(
      () => probeMedia({ name: 'ghost.mp4', size: 10 }),
      /probe ghost\.mp4: no bytes and no location to read/
    )
  })

  await check('the five-field answer still falls out of the same probe', async () => {
    const meta = await probeMediaMetadata({ name: 'tone.wav', blob: wavBlob(), size: 4044 })
    assert.deepEqual(meta, { durationSec: 0.5, width: 0, height: 0, fps: 0, hasAudio: true })
  })

  await check('the adapter derives name and kind from the stored locator', async () => {
    const seen: Record<string, unknown>[] = []
    const platform = useTmcutPlatform({
      isDesktop: { value: true },
      resolveSrc: src => String(src),
      resolveSource: src => `media://local/${src}`,
      probeInfo: async (source) => {
        seen.push(source as unknown as Record<string, unknown>)
        return { importStatus: 'ready' } as never
      }
    })
    const info = await platform.media.probeInfo('D:/clips/a.mkv', { size: 2048, mimeType: 'video/x-matroska' })
    assert.equal(info.importStatus, 'ready', 'the adapter returns the service answer untouched')
    assert.equal(seen.length, 1)
    assert.deepEqual(
      seen[0],
      { name: 'a.mkv', url: 'media://local/D:/clips/a.mkv', size: 2048, mimeType: 'video/x-matroska', kind: 'video' },
      'one locator in, the source object out: name from the path, kind from core'
    )
    // A caller that already knows the kind wins, because it read the File object.
    await platform.media.probeInfo('D:/clips/voice.mp3.wav', { kind: 'audio' })
    assert.equal(seen[1].kind, 'audio')
    // And the source URL is the stored file, never the proxy `resolveSrc` may
    // hand the preview: MediaInfo must describe the codec the export will see.
    assert.equal(seen[1].url, 'media://local/D:/clips/voice.mp3.wav')
    assert.notEqual(seen[1].url, platform.media.resolveSrc('D:/clips/voice.mp3.wav') + '?proxy=1')
  })

  await check('the adapter default probe is the service, loaded on first use', async () => {
    const host = await serveWav(0.25)
    try {
      const platform = useTmcutPlatform({
        isDesktop: { value: false },
        resolveSrc: src => String(src),
        resolveSource: () => host.url
      })
      const info = await platform.media.probeInfo('tone.wav')
      assert.equal(info.container, 'WAVE')
      assert.equal(info.duration, 0.25)
      assert.equal(info.importStatus, 'ready')
    } finally {
      await host.close()
    }
  })

  await check('the desktop pickers size a clip from the demuxer, not the binary leg', () => {
    // `media.probe` is the adapter's ffprobe-over-IPC answer. The two desktop
    // "add file" legs used to take a new clip's length from it, so the ruler and
    // the media bin could disagree about the same file. Both now ask the one
    // service, and a container that stores no length still answers `undefined`
    // rather than a zero — which is what keeps the honest fallback reachable.
    const timeline = read('app/components/tmcut/TmcutTimeline.vue')
    assert.ok(!/platform\.media\.probe\(/.test(timeline), 'the timeline may not call the ffprobe leg')
    assert.equal(timeline.split('platform.media.probeInfo(').length - 1, 2, 'both pickers ask the demuxer')
    assert.match(timeline, /out: durationSec > 0[\s\S]{0,90}?10 \* TICKS_PER_SECOND/,
      'a video the container gives no length for keeps its fallback')
    assert.match(timeline, /out: durationSec > 0[\s\S]{0,90}?15 \* TICKS_PER_SECOND/,
      'and so does an audio file')
    // Nothing else in the renderer asks it either, which is the measurement the
    // slice that cuts the binary needs: the leg stays in the contract for host
    // parity until then, but no feature depends on it.
    const stillAsking: string[] = []
    const walkApp = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walkApp(rel)
        else if (/\.(ts|vue|mjs)$/.test(entry.name) && /media\.probe\(/.test(read(rel))) stillAsking.push(rel)
      }
    }
    walkApp('app')
    assert.deepEqual(stillAsking, [], 'no renderer module calls media.probe')
  })

  await check('four seams own the container, and no component reaches past them (rule 12)', async () => {
    const demuxerFiles: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(rel)
        else if (/\.(ts|vue|mjs)$/.test(entry.name) && /from ['"]mediabunny['"]/.test(read(rel))) demuxerFiles.push(rel)
      }
    }
    walk('app')
    // Probing a file, drawing a frame of it and reading its sound are three
    // different questions, each with exactly one module allowed to open a
    // container. Slice D added the frame seam beside the probe seam, slice E3
    // added the audio seam beside both. Slice H3b adds the writer: an exporter
    // that opens a container to close one is the fourth and last direction the
    // library can be pointed in, and a fifth importer would be drift.
    assert.deepEqual(demuxerFiles.sort(), [
      'app/utils/tmcut/audioDecode.ts',
      'app/utils/tmcut/exportEncodeSession.ts',
      'app/utils/tmcut/frameDecode.ts',
      'app/utils/tmcut/mediaProbe.ts'
    ], 'the services own the container')
    // The contract carries the rich question, so a feature asks the host and
    // never a library.
    assert.match(read('packages/core/types/platform.ts'), /probeInfo\(src: string, hints\?: TmcutProbeHints\)/)
    // The element probe stays only while FFmpeg still answers `probe`; §4
    // replaces both, and a second MediaInfo collector would be the drift.
    assert.doesNotMatch(read('app/utils/tmcut/webProbe.ts'), /buildMediaInfo|TmcutMediaInfo/)
    assert.match(read('package.json'), /"mediabunny"/, 'and the demuxer is a declared dependency')
  })

  console.log(`\n=== All ${passed} media probe checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
