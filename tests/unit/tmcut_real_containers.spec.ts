/**
 * Real containers (zero-FFmpeg slice D3) — the demuxer over files a camera emits.
 *
 * Every earlier proof of the collector ran over a WAV written by hand and over a
 * PNG. Those are real bytes, but nothing in them shows whether the MP4 a creator
 * actually dropped on the timeline is understood. These four fixtures are real:
 * each was encoded once, on the dev machine, from the same `testsrc` raster at
 * the same 0.6 s and the same 64x36 — so the expected answer is known from
 * outside this code, and a demuxer that misreads a header fails here instead of
 * on somebody's project.
 *
 * What is pinned, in order:
 *  - the container is named from the header, and the name is the real family
 *    (a .mov is QuickTime, not WebM, even though both are read by one demuxer);
 *  - the length comes from the container's own metadata, not from a packet walk,
 *    and it matches the 0.6 s that was encoded;
 *  - the video track reports the raster that was encoded, with the codec name
 *    read out of the file — a string this code never writes by hand;
 *  - a silent clip gains no audio track: the answer is not padded;
 *  - the same file over ranged HTTP answers the same as its own bytes, because
 *    that is how `media://local` serves the original on desktop;
 *  - what Node may *not* claim: no WebCodecs means the collector still says
 *    `canDemux`, but never `ready` — the codec cannot be painted here, and the
 *    warning names the codec the file actually holds.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_real_containers.spec.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TmcutMediaInfo } from 'tmcut-core'
import './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const readBytes = (rel: string) => readFileSync(join(root, rel))

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/**
 * A byte source that answers range requests, which is what
 * `electron/media-protocol.cjs` does for `media://local`. `partial` counts the
 * 206s, so "the header was fetched, not the file" is a measurement.
 */
function serveFile(rel: string, contentType: string): Promise<{
  url: string
  stats: { partial: number }
  close: () => Promise<void>
}> {
  const buffer = readBytes(rel)
  const name = rel.split('/').pop() ?? 'media'
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

/**
 * One raster and one length were encoded into all four files, and the two codec
 * families are what the encoder put there: `h264` is the AVC family and `vp9` is
 * VP9, so the names below come from the encode command, not from this demuxer's
 * answer.
 */
const ENCODED = { seconds: 0.6, width: 64, height: 36 }

type Fixture = { rel: string, mime: string, container: string, codec: string }

const FIXTURES: Fixture[] = [
  { rel: 'tests/fixtures/containers/h264.mp4', mime: 'video/mp4', container: 'MP4', codec: 'avc' },
  { rel: 'tests/fixtures/containers/h264.mov', mime: 'video/quicktime', container: 'QuickTime File Format', codec: 'avc' },
  { rel: 'tests/fixtures/containers/h264.mkv', mime: 'video/x-matroska', container: 'Matroska', codec: 'avc' },
  { rel: 'tests/fixtures/containers/vp9.webm', mime: 'video/webm', container: 'WebM', codec: 'vp9' }
]

const infos = new Map<string, TmcutMediaInfo>()

async function main() {
  console.log('=== [TMCut real containers] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  const { probeMedia, getMediaCapabilities } = await import('../../app/utils/tmcut/mediaProbe')
  const core = await import('tmcut-core')

  for (const fixture of FIXTURES) {
    const name = fixture.rel.split('/').pop()!
    await check(`the demuxer reads the ${name} header the encoder wrote`, async () => {
      const bytes = readBytes(fixture.rel)
      const info = await probeMedia({
        name,
        blob: new Blob([bytes], { type: fixture.mime }),
        size: bytes.byteLength,
        kind: 'video'
      })
      infos.set(fixture.rel, info)
      assert.equal(info.kind, 'video', 'the kind is read from the track, not assumed from the name')
      assert.equal(info.container, fixture.container, 'the container is the header the demuxer knows')
      assert.equal(info.compatibility.canDemux, true, 'and it really demuxed')
      assert.equal(info.isSeekable, true, 'its packets can be sought, which is what a filmstrip asks for')
      assert.equal(info.durationSource, 'container', 'the length is stored metadata, no packet walk')
      assert.ok(Math.abs(Number(info.duration) - ENCODED.seconds) < 0.05,
        `${ENCODED.seconds} s was encoded, ${info.duration} was read`)
      assert.equal(info.videoTracks.length, 1, 'one encoded track, one reported track')
      const track = info.videoTracks[0]
      assert.equal(track.displayWidth, ENCODED.width, 'the raster that was encoded')
      assert.equal(track.displayHeight, ENCODED.height)
      assert.ok(String(track.codec).startsWith(fixture.codec),
        `${fixture.codec} was encoded, ${track.codec} was read from the file`)
      assert.equal(info.audioTracks.length, 0, 'a silent clip does not gain an audio track')
    })
  }

  await check('the QuickTime file is not called WebM and vice versa', () => {
    // Both are read by one demuxer family, so the answer must still tell a
    // creator's .mov from their .webm: the wrong name would send an export down
    // the wrong muxer, and the two files above differ only in that header.
    const mov = infos.get('tests/fixtures/containers/h264.mov')
    const webm = infos.get('tests/fixtures/containers/vp9.webm')
    assert.notEqual(mov.container, webm.container, `${mov.container} vs ${webm.container}`)
    assert.notEqual(mov.videoTracks[0].codec, webm.videoTracks[0].codec)
  })

  await check('a runtime with no WebCodecs reports what it cannot paint', async () => {
    // Node runs no WebCodecs, so it cannot paint either codec. The collector may
    // report the container and the track perfectly — but it must not claim this
    // runtime can decode them, and the warning has to name the codec the file holds.
    const capabilities = await getMediaCapabilities()
    assert.equal(capabilities.hasWebCodecs, false, 'plain Node has no codec table to read')
    const wrong = ['CONTAINER_UNDEMODABLE', 'DIMENSIONS_UNKNOWN', 'DURATION_UNKNOWN', 'DURATION_MISMATCH', 'SIZE_UNKNOWN']
    for (const fixture of FIXTURES) {
      const info = infos.get(fixture.rel)
      assert.equal(info.compatibility.canDemux, true, `${fixture.rel}: demuxing never needed WebCodecs`)
      assert.equal(info.videoTracks[0].canDecode, false, 'painting it does')
      assert.equal(info.importStatus, 'partial', `so core calls it usable-but-not-previewable: ${JSON.stringify(info.probeWarnings)}`)
      const codes = info.probeWarnings.map((entry: { code: string }) => entry.code)
      assert.ok(codes.includes('VIDEO_NOT_DECODABLE'), `${fixture.rel}: ${codes.join(', ')}`)
      const names = info.probeWarnings.map((entry: { message: string }) => entry.message).join(' | ')
      assert.ok(names.includes(String(info.videoTracks[0].codec)), 'the warning must name the real codec')
      // Nothing about the file itself was wrong, so nothing about it is blamed.
      for (const code of wrong) {
        assert.ok(!codes.includes(code), `${fixture.rel} should not warn about ${code}`)
      }
    }
  })

  await check('core keeps its verdict for a real container', () => {
    // The taxonomy is asked about real files rather than a hand-made WAV.
    assert.equal(typeof core.classifyImportStatus, 'function', 'core owns the verdict')
    for (const [rel, info] of infos) {
      assert.equal(core.classifyImportStatus(info), info.importStatus, `${rel} is judged the same twice`)
    }
  })

  await check('the same file over ranged HTTP answers the same as its bytes', async () => {
    const fixture = FIXTURES[0]!
    const served = await serveFile(fixture.rel, fixture.mime)
    try {
      const info = await probeMedia({
        name: fixture.rel.split('/').pop()!,
        url: served.url,
        size: readBytes(fixture.rel).byteLength,
        kind: 'video'
      })
      const fromBytes = infos.get(fixture.rel)
      assert.equal(info.container, fromBytes.container, 'the same container, named the same way')
      assert.equal(info.durationSource, 'container')
      assert.ok(Math.abs(Number(info.duration) - Number(fromBytes.duration)) < 0.001,
        `${info.duration} vs ${fromBytes.duration}`)
      assert.equal(info.videoTracks[0].codec, fromBytes.videoTracks[0].codec)
      assert.equal(info.videoTracks[0].displayWidth, ENCODED.width)
      assert.ok(served.stats.partial > 0, 'it read ranges, so the header was fetched, not the whole file')
    } finally {
      await served.close()
    }
  })

  await check('the proof needs no binary at run time', () => {
    // These bytes were encoded once, on the dev machine, and are committed as
    // they are: a fixture smaller than a real container is a placeholder, and
    // the collector must find its answers in the header, never by asking a
    // process to run. The law is checked on the modules under test rather than
    // on this spec's own text, which has to name the thing it forbids.
    for (const fixture of FIXTURES) {
      const bytes = readBytes(fixture.rel)
      assert.ok(bytes.byteLength > 1024, `${fixture.rel} must be a real file, not a stub`)
      assert.ok(!/\.{1,3}\/\.{1,3}/.test(fixture.rel), 'fixtures are committed, not pointed outside the repo')
    }
    for (const module of [
      'app/utils/tmcut/mediaProbe.ts',
      'app/utils/tmcut/frameStore.ts',
      'app/utils/tmcut/frameStrip.ts'
    ]) {
      const source = read(module)
      assert.ok(!/child_process/.test(source), `${module} may not run a binary`)
    }
  })

  console.log(`\n=== [TMCut real containers] ${passed}/${passed} specs passed ===`)
}

main().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
