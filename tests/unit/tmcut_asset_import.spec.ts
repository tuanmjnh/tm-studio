/**
 * Asset import states + cache fingerprint (zero-FFmpeg slice C).
 *
 * The audit row for this slice asks for two things a screenshot cannot show:
 * the six-state import machine, and a persisted record that never carries a
 * `File` object. Both are proven by running the real flows — the web leg
 * demuxes hand-written WAV bytes through MediaProbeService and writes the
 * localStorage mirror, and the desktop leg drives the Relink button through a
 * fake IPC that answers the way `electron/tools/tmcut.controller.cjs` does.
 *
 * What is pinned, in order:
 *  - the six verdicts are core's, and the table that maps a verdict onto the
 *    coarse byte-availability field (`status`) keeps `partial` usable;
 *  - one cache-key scheme: the app's fingerprint is core's `cacheKeyForPath`,
 *    and the retired inline `v2:` builder is gone from the composable;
 *  - a fresh record is deterministic and holds only JSON-safe fields;
 *  - the web import: a picked WAV ends `ready` with the duration the container
 *    reported, and the mirror round-trips through JSON with no `File`, `Blob`
 *    or `blob:` URL in it;
 *  - a file no demuxer can read lands as `error` and STAYS in the library —
 *    Q6: a failed probe is disclosed, the reference is never deleted;
 *  - a still is not demux-probed on web, so an SVG imported by a runtime that
 *    cannot draw it is still `ready` (slice D owns the pixels);
 *  - the whole queue is in the library before the first probe answers;
 *  - relink, on both legs: the clips move with the path, every fact the old
 *    probe learned is dropped, the picker's friendly name survives into the
 *    mirror, and an unreadable target leaves the asset missing but intact.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_asset_import.spec.ts
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Installs the Vue auto-import and localStorage shims the store is written
// against. Must stay before every dynamic import below.
import { freshStore } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const ASSET_STORAGE_KEY = 'tmcut_assets_v1'

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/**
 * A one-channel PCM WAV, written by hand so the suite needs no media fixture.
 * Same builder as the slice-B spec: one demuxer in, one honest verdict out.
 */
function wavBytes(seconds: number, sampleRate = 8000, channels = 1): Uint8Array {
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

/** Ranged HTTP, so one URL answers a demuxer the way `media://local` does. */
function serveWav(seconds: number): Promise<{ url: string, close: () => Promise<void> }> {
  const buffer = Buffer.from(wavBytes(seconds))
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
      if (range && (range[1] !== '' || range[2] !== '')) {
        const start = range[1] === '' ? Math.max(0, buffer.length - Number(range[2])) : Number(range[1])
        const end = range[2] === '' || range[1] === '' ? buffer.length - 1 : Number(range[2])
        res.writeHead(206, {
          'content-type': 'audio/wav',
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${buffer.length}`,
          'accept-ranges': 'bytes'
        })
        res.end(buffer.subarray(start, end + 1))
        return
      }
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': String(buffer.length), 'accept-ranges': 'bytes' })
      res.end(buffer)
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/uploads/tone.wav`,
        close: () => new Promise(done => server.close(() => done()))
      })
    })
  })
}

/** Every value a JSON round-trip cannot reproduce, with its location. */
function nonJsonValues(value: unknown, path = '$'): string[] {
  if (value === null || value === undefined) return []
  const type = typeof value
  if (type === 'number') return Number.isFinite(value) ? [] : [`${path}: ${value}`]
  if (type === 'string' || type === 'boolean') return []
  if (Array.isArray(value)) return value.flatMap((entry, i) => nonJsonValues(entry, `${path}[${i}]`))
  if (type === 'object') {
    if (value instanceof Blob || value instanceof File) return [`${path}: ${(value as Blob).constructor.name}`]
    return Object.values(value as Record<string, unknown>).flatMap(entry => nonJsonValues(entry, path))
  }
  return [`${path}: ${type}`]
}

/** The web mirror is one JSON array; read it back the way a reload would. */
function mirrored(): Record<string, unknown>[] {
  const raw = globalThis.localStorage.getItem(ASSET_STORAGE_KEY)
  assert.ok(raw, 'the registry mirror was written')
  return JSON.parse(String(raw)) as Record<string, unknown>[]
}

const RECORD_FIELDS = [
  'addedAt', 'filmstripPath', 'fingerprint', 'folderId', 'id', 'importStatus', 'kind', 'meta',
  'name', 'path', 'proxyPath', 'proxyStatus', 'status', 'thumbPath', 'usedBy', 'waveformPath'
]

async function main() {
  console.log('=== [TMCut asset import states] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  if (!g.useToast) g.useToast = () => ({ add: () => {} })

  const { TMCUT_IMPORT_STATES, assetStatusForImport, assetFingerprint, buildAssetRecord }
    = await import('../../app/utils/tmcut/assetImport')
  const core = await import('tmcut-core')
  const store = await freshStore()
  const media = (await import('../../app/composables/useTmcutMedia')).useTmcutMedia()
  const projectId = () => store.currentProject.value!.id

  // ===== the state machine =====

  await check('the six states are core\'s, in the order the pipeline walks them', () => {
    assert.deepEqual(TMCUT_IMPORT_STATES, ['queued', 'probing', 'ready', 'partial', 'unsupported', 'error'])
    // The union lives in core; a renamed or extra verdict there must fail here.
    const union = /export type TmcutImportStatus =([^\n]*)/.exec(read('packages/core/types/mediaInfo.ts'))?.[1]
    assert.ok(union, 'core declares the union')
    for (const state of TMCUT_IMPORT_STATES) {
      assert.ok(union.includes(`'${state}'`), `core is missing '${state}'`)
    }
  })

  await check('a verdict maps onto the byte axis without collapsing it', () => {
    assert.equal(assetStatusForImport('queued'), 'analyzing')
    assert.equal(assetStatusForImport('probing'), 'analyzing')
    assert.equal(assetStatusForImport('ready'), 'ready')
    // 'partial' is a usable clip with a disclosed warning (estimated duration,
    // variable frame rate); reading it as a failure would hide good footage.
    assert.equal(assetStatusForImport('partial'), 'ready')
    assert.equal(assetStatusForImport('unsupported'), 'error')
    assert.equal(assetStatusForImport('error'), 'error')
  })

  await check('the fingerprint is core\'s cache key, and only that', () => {
    const path = 'D:/Media/Clip.WAV'
    const meta = { mtimeMs: 1700000000000, fileSize: 4044 }
    assert.equal(assetFingerprint(path, meta), core.cacheKeyForPath(path, { mtimeMs: meta.mtimeMs, size: meta.fileSize }))
    // The same scheme spelled out: derived artifacts are named after this, so a
    // second builder anywhere is the drift that orphans a cache.
    assert.equal(
      assetFingerprint(path, meta),
      core.fnv1aHex(`v2:${core.mediaFileKey(path)}:${meta.mtimeMs}:${meta.fileSize}`)
    )
    assert.equal(assetFingerprint('d:/media/clip.wav', meta), assetFingerprint(path, meta), 'case is folded, as the key index does')
    assert.notEqual(assetFingerprint(path, { ...meta, fileSize: 4045 }), assetFingerprint(path, meta), 'a new revision misses the cache')
    const composable = read('app/composables/useTmcutMedia.ts')
    assert.match(composable, /cacheKeyForPath\(/, 'the migration pass asks core')
    assert.doesNotMatch(composable, /fnv1aHex\(/, 'no second copy of the hash scheme in the app')
  })

  await check('a fresh record is deterministic and holds only storable fields', () => {
    const now = 1700000000000
    const asset = buildAssetRecord({
      path: 'C:\\Media\\Old Clip.mp4',
      kind: 'video',
      projectId: 'proj_1',
      folderId: 'folder_1',
      now,
      nonce: 'ab12cd'
    })
    assert.equal(asset.id, 'asset_1700000000000_ab12cd')
    assert.equal(asset.path, 'C:/Media/Old Clip.mp4', 'stored normalized, never with backslashes')
    assert.equal(asset.name, 'Old Clip.mp4')
    assert.equal(asset.status, 'analyzing')
    assert.equal(asset.importStatus, 'queued')
    assert.equal(asset.fingerprint, null, 'no key until a probe answers')
    assert.deepEqual(asset.usedBy, ['proj_1'])
    assert.deepEqual(asset.folderByProject, { proj_1: 'folder_1' })
    assert.equal(asset.addedAt, new Date(now).toISOString())
    assert.deepEqual(asset.meta, {
      durationSec: 0, width: 0, height: 0, fps: 0, fileSize: 0, mtimeMs: 0, probedAt: null
    })
    assert.deepEqual(
      [asset.thumbPath, asset.filmstripPath, asset.waveformPath, asset.proxyPath, asset.proxyStatus],
      [null, null, null, null, 'none']
    )
    assert.deepEqual(nonJsonValues(asset), [], 'nothing a JSON round-trip cannot reproduce')
    const bare = buildAssetRecord({ path: 'D:/a.wav', kind: 'audio', now })
    assert.deepEqual(bare.usedBy, [], 'a record built outside any project links nothing')
    assert.equal(bare.folderId, null)
    assert.equal(bare.folderByProject, undefined)
  })

  // ===== the web import leg, run for real =====

  const uploads = installWebUploads()

  await check('a picked WAV imports as ready and the mirror stores no File', async () => {
    uploads.reset()
    media.assets.value = []
    const created = await media.importWebFiles([new File([wavBytes(1)], 'tone.wav', { type: 'audio/wav' })])
    assert.equal(created.length, 1)
    const asset = created[0]!
    assert.equal(asset.importStatus, 'ready', 'the probe answered, so the verdict is the verdict')
    assert.equal(asset.status, 'ready')
    assert.equal(asset.meta.durationSec, 1, 'one second read from the container, not defaulted')
    assert.equal(asset.meta.fileSize, 44 + 16000)
    assert.equal(asset.name, 'tone.wav', 'the picker\'s name, not the server\'s random one')
    assert.match(String(asset.fingerprint), /^[0-9a-f]{8}$/)
    assert.equal(asset.fingerprint, assetFingerprint(asset.path, asset.meta))
    assert.equal(typeof asset.meta.probedAt, 'string', 'the probe stamps when it answered')
    assert.equal(uploads.created, uploads.revoked, 'every object URL handed back')

    const persisted = mirrored()
    assert.equal(persisted.length, 1)
    const record = persisted[0]!
    assert.deepEqual(Object.keys(record).sort(), RECORD_FIELDS, 'the persisted shape is exactly the declared fields')
    assert.equal(record.path, asset.path)
    assert.ok(String(record.path).startsWith('/uploads/'), 'the path is the durable copy, never blob:')
    assert.ok(!String(globalThis.localStorage.getItem(ASSET_STORAGE_KEY)).includes('blob:'), 'no session-bound URL reached the store')
    assert.deepEqual(nonJsonValues(record), [], 'the mirror holds only JSON-safe values')
    assert.deepEqual(JSON.parse(JSON.stringify(record)), record, 'round-trips')
  })

  await check('a file no demuxer can read lands as error and stays in the library', async () => {
    uploads.reset()
    media.assets.value = []
    const junk = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5, 6, 7, 8])
    const created = await media.importWebFiles([new File([junk], 'broken.wav', { type: 'audio/wav' })])
    assert.equal(created.length, 1, 'Q6: a failed probe is disclosed, never silently dropped')
    const asset = created[0]!
    assert.equal(asset.importStatus, 'error')
    assert.equal(asset.status, 'error')
    assert.equal(asset.meta.durationSec, 0, 'no length is invented for an unreadable file')
    assert.equal(media.importError.value, null, 'an unreadable file is a verdict, not an upload failure')
    const persisted = mirrored()
    assert.equal(persisted.length, 1, 'the honest failure survives a reload')
    assert.equal(persisted[0]!.importStatus, 'error')
    assert.deepEqual(Object.keys(persisted[0]!).sort(), RECORD_FIELDS)
  })

  await check('a still is not demux-probed, so an SVG imported here is ready', async () => {
    uploads.reset()
    media.assets.value = []
    assert.equal(typeof g.createImageBitmap, 'undefined', 'this runtime could not draw a still at all')
    const created = await media.importWebFiles([new File([new Uint8Array(64)], 'logo.svg', { type: 'image/svg+xml' })])
    const asset = created[0]!
    assert.equal(asset.kind, 'image')
    // The only honest answer without a raster probe: the bytes are on the
    // server, so the import is ready. Whether this runtime can PAINT it is
    // slice D; claiming 'unsupported' here would reject a good SVG.
    assert.equal(asset.importStatus, 'ready')
    assert.equal(asset.thumbPath, asset.path, 'the cover of a still is the file itself')
    assert.equal(asset.meta.durationSec, 0, 'a still has no timeline')
    assert.match(String(asset.fingerprint), /^[0-9a-f]{8}$/, 'keyed by path + size, all a web copy is known by')
  })

  await check('the web relink keeps the picker\'s name in the mirror', async () => {
    uploads.reset()
    media.assets.value = []
    const host = await serveWav(0.5)
    try {
      const asset = buildAssetRecord({ path: host.url, kind: 'audio', projectId: projectId(), nonce: 'dead1' })
      asset.status = 'missing'
      asset.importStatus = 'error'
      asset.meta.durationSec = 99
      asset.fingerprint = 'deadbeef'
      media.assets.value.push(asset)
      const ok = await media.relink(asset.id, host.url, { name: 'Fixed Take.wav', size: 4044 })
      assert.equal(ok, true, 'the stored copy answered the probe, so the button says success')
      assert.equal(asset.name, 'Fixed Take.wav', 'the friendly name survives the relink')
      assert.equal(asset.importStatus, 'ready')
      assert.equal(asset.meta.durationSec, 0.5, 'the stale 99s from the old file is gone')
      assert.equal(asset.meta.fileSize, 4044, 'what only the picker knew is kept')
      assert.equal(asset.fingerprint, assetFingerprint(asset.path, asset.meta))
      const record = mirrored()[0]!
      assert.equal(record.name, 'Fixed Take.wav', 'and it reached the durable mirror — the bug this replaces')
      assert.equal(record.importStatus, 'ready')
    } finally {
      await host.close()
    }
  })

  // ===== the desktop leg =====

  const desktop = installDesktopIpc(media)
  g.window = desktop.window

  await check('the whole queue is in the library before the first probe answers', async () => {
    media.assets.value = []
    desktop.firstProbeCount = 0
    const result = await media.importFiles(['D:/Media/a.wav', 'D:/Media/b.wav'])
    assert.equal(result.added, 2)
    assert.equal(result.failed, 0)
    assert.equal(desktop.firstProbeCount, 2, 'two cards, not one at a time')
    assert.equal(media.assets.value.length, 2)
  })

  await check('the desktop relink re-points the clips and relearns the file', async () => {
    media.assets.value = []
    store.addClipToTrack('video', { src: 'D:/Media/old.mp4', in: 0, out: 240000, offset: 0 })
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/old.mp4', kind: 'video', projectId: projectId(), now: 1700000000000, nonce: 'old01'
    }))
    const asset = media.assets.value[0]!
    asset.status = 'ready'
    asset.thumbPath = 'D:/cache/stale-cover.png'
    asset.filmstripPath = 'D:/cache/stale-strip.png'
    asset.waveformPath = 'D:/cache/stale.json'
    asset.proxyPath = 'D:/cache/old-proxy.mp4'
    asset.proxyStatus = 'ready'
    asset.fingerprint = 'deadbeef'

    desktop.mode = 'video'
    const ok = await media.relink(asset.id, 'D:\\Media\\New Clip.mp4', { size: 999 })
    assert.equal(ok, true)
    assert.equal(asset.path, 'D:/Media/New Clip.mp4')
    assert.equal(asset.name, 'New Clip.mp4', 'no friendly name in, the new file\'s own name out')
    assert.equal(asset.importStatus, 'ready')
    assert.equal(asset.meta.durationSec, 2, 'the numbers come from the new probe')
    assert.equal(asset.meta.width, 1920)
    assert.equal(asset.meta.fileSize, desktop.videoStat.size, 'the host\'s stat outranks the caller\'s hint')
    assert.equal(asset.thumbPath, 'D:/cache/key-cover.png')
    assert.equal(asset.filmstripPath, 'D:/cache/key-strip.png')
    assert.equal(asset.waveformPath, 'D:/cache/key.json')
    assert.equal(asset.proxyPath, null, 'a proxy of the old file cannot describe the new one')
    assert.equal(asset.proxyStatus, 'none')
    assert.equal(
      asset.fingerprint,
      core.cacheKeyForPath(asset.path, { mtimeMs: desktop.videoStat.mtimeMs, size: desktop.videoStat.size })
    )
    assert.equal(
      store.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!.src,
      'D:/Media/New Clip.mp4',
      'the timeline moved with the asset'
    )
  })

  await check('an unreadable relink target leaves the asset missing but intact', async () => {
    media.assets.value = []
    store.addClipToTrack('audio', { src: 'D:/Media/voice.wav', in: 0, out: 120000, offset: 0 })
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/voice.wav', kind: 'audio', projectId: projectId(), now: 1700000000001, nonce: 'voc01'
    }))
    const asset = media.assets.value[0]!
    asset.status = 'ready'
    desktop.mode = 'missing'
    const ok = await media.relink(asset.id, 'D:/Media/gone.wav')
    assert.equal(ok, false, 'the button reports what actually happened')
    assert.equal(asset.status, 'missing', 'the byte axis owns this word')
    assert.equal(asset.importStatus, 'error', 'the probe axis records that this attempt learned nothing')
    assert.equal(asset.fingerprint, null, 'no key for bytes that were not read')
    assert.equal(media.assets.value.length, 1, 'Q6: the asset reference is never deleted')
    assert.deepEqual(asset.usedBy, [projectId()], 'nor is it cut off from the project')
    assert.equal(
      store.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!.items![0]!.src,
      'D:/Media/gone.wav',
      'the clip follows the path the user chose, so Media Offline names the real file'
    )
    assert.deepEqual(media.missingAssets.value.map(a => a.id), [asset.id], 'the Relink affordance has a truthful source')
  })

  await check('a relink that changes kind drops the video-derived pointers', async () => {
    media.assets.value = []
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/wrong.mp4', kind: 'video', projectId: projectId(), now: 1700000000002, nonce: 'knd01'
    }))
    const asset = media.assets.value[0]!
    desktop.mode = 'audio'
    assert.equal(await media.relink(asset.id, 'D:/Media/actually.wav'), true)
    assert.equal(asset.kind, 'audio', 'the container, not the old label, decides')
    assert.equal(asset.thumbPath, null)
    assert.equal(asset.filmstripPath, null)
    assert.equal(asset.waveformPath, 'D:/cache/audio.json')
    assert.equal(asset.meta.width, 0, 'no video stream, no invented frame size')
    assert.equal(asset.meta.hasVideo, false)
  })

  await check('an unknown id, a blank path and a throwing IPC all answer honestly', async () => {
    media.assets.value = []
    media.assets.value.push(buildAssetRecord({
      path: 'D:/Media/x.wav', kind: 'audio', projectId: projectId(), now: 1700000000003, nonce: 'thr01'
    }))
    const asset = media.assets.value[0]!
    desktop.analyzeCalls = 0
    assert.equal(await media.relink('asset_nope', 'D:/Media/y.wav'), false, 'nothing to relink')
    assert.equal(await media.relink(asset.id, '   '), false, 'a blank path is not a new file')
    assert.equal(desktop.analyzeCalls, 0, 'both guards run before any IPC')
    desktop.mode = 'throw'
    const logged: unknown[][] = []
    const previousError = console.error
    const capture = (...args: unknown[]) => logged.push(args)
    console.error = capture
    let ok: boolean
    try {
      ok = await media.relink(asset.id, 'D:/Media/z.wav')
    } finally {
      console.error = previousError
    }
    assert.equal(ok, false)
    assert.equal(asset.status, 'error', 'an IPC that died is not a missing file')
    assert.equal(asset.importStatus, 'error')
    assert.ok(
      logged.some(args => String(args[0]).includes('Media analysis failed')),
      'the failure is logged, not swallowed'
    )
    desktop.mode = 'audio'
  })

  await check('the desktop write survives structured clone', () => {
    desktop.writes.length = 0
    media.persistLibrary()
    assert.equal(desktop.writes.length, 1)
    const payload = desktop.writes[0]!
    // Electron structured-clones this payload; a Vue reactive proxy or a File
    // in it would throw there, not here.
    assert.doesNotThrow(() => structuredClone(payload))
    assert.deepEqual(nonJsonValues(payload), [])
  })

  await check('a record written before slice C gains a key and keeps its status', async () => {
    media.assets.value = []
    // Exactly what an older assets.json holds: no importStatus, no fingerprint.
    media.assets.value.push({
      id: 'asset_old', kind: 'audio', name: 'old.wav', path: 'D:/Media/old.wav',
      usedBy: [projectId()], status: 'ready',
      meta: { durationSec: 3, width: 0, height: 0, fps: 0, fileSize: 500, mtimeMs: 0, probedAt: null },
      thumbPath: null, filmstripPath: null, waveformPath: null, addedAt: '2026-01-01T00:00:00.000Z'
    } as never)
    desktop.mode = 'audio'
    desktop.statKey = 'D:/Media/old.wav'
    await media.checkMissing()
    const asset = media.assets.value[0] as never as Record<string, unknown>
    assert.equal(asset.status, 'ready', 'a byte fact restores the file, it does not re-probe it')
    assert.equal(asset.importStatus, undefined, 'and the probe axis stays absent until a real probe answers')
    assert.equal(
      asset.fingerprint,
      core.cacheKeyForPath('D:/Media/old.wav', { mtimeMs: desktop.audioStat.mtimeMs, size: desktop.audioStat.size }),
      'the one key scheme is backfilled from the stat that proved the bytes'
    )
  })

  await check('a component asks for a verdict and never reaches for a demuxer (rule 12)', () => {
    const panel = read('app/components/tmcut/TmcutMediaPanel.vue')
    assert.doesNotMatch(panel, /webProbe|mediaProbe|probeWebMetadata/, 'the panel does not probe the relink target')
    assert.ok(
      panel.includes('relink(asset.id, uploaded.url, { name: file.name, size: uploaded.size })'),
      'it hands the composable what only the picker knows'
    )
    // The bug this replaces: relink() saved its snapshot before the panel
    // mutated the record, so the name and thumbnail vanished on the next reload.
    assert.match(read('app/composables/useTmcutMedia.ts'), /persistLibrary\(\)\n\s*return asset\.status === 'ready'/,
      'the probe owns the last write')
  })

  console.log(`\n=== All ${passed} asset import checks passed ===`)
}

/**
 * The local Nitro upload endpoint replaced by what it answers: a durable
 * `/uploads/` URL and the byte count. Object URLs are counted so the
 * revoke-every-URL rule is measured rather than read off the source.
 */
function installWebUploads() {
  const g = globalThis as Record<string, unknown>
  const state = {
    created: 0,
    revoked: 0,
    reset() {
      state.created = 0
      state.revoked = 0
    }
  }
  g.$fetch = async (url: string, options: { body?: Blob }) => {
    const name = decodeURIComponent(String(url).split('name=')[1] ?? 'file')
    const extension = name.slice(name.lastIndexOf('.'))
    return {
      // A fresh unique name per upload, the way the server assigns them.
      url: `/uploads/${state.created}${extension}`,
      size: options?.body?.size ?? 0
    }
  }
  // Statics only: `new URL(...)` must keep working for the demuxer.
  const objectUrls = g.URL as unknown as {
    createObjectURL: (blob: Blob) => string
    revokeObjectURL: (url: string) => void
  }
  objectUrls.createObjectURL = (blob: Blob) => {
    state.created += 1
    // The picked bytes are the payload; the URL is only a handle for the thumb
    // capture, which the Node runtime never runs.
    assert.ok(blob.size > 0, 'an object URL is created over the picked bytes')
    return `blob:session/${state.created}`
  }
  objectUrls.revokeObjectURL = () => {
    state.revoked += 1
  }
  return state
}

/**
 * A stand-in for the preload bridge and `electron/tools/tmcut.controller.cjs`,
 * answering the three calls the import pipeline makes: analyze one file, stat a
 * list, write the registry.
 */
function installDesktopIpc(media: { assets: { value: unknown[] } }) {
  const writes: Record<string, unknown>[][] = []
  const state = {
    mode: 'audio' as 'video' | 'audio' | 'missing' | 'throw',
    analyzeCalls: 0,
    firstProbeCount: 0,
    statKey: 'D:/Media/old.wav',
    writes,
    videoStat: { size: 4096, mtimeMs: 1700000500000 },
    audioStat: { size: 640, mtimeMs: 1700000600000 },
    window: {} as Record<string, unknown>
  }
  state.window.electronAPI = {
    tmcut: {
      async analyzeAsset({ filePath, kind }: { filePath: string, kind: string }) {
        state.analyzeCalls++
        // The batch rule: when the first probe starts, the whole queue is
        // already in the library.
        if (state.firstProbeCount === 0) state.firstProbeCount = media.assets.value.length
        if (state.mode === 'throw') throw new Error('ipc channel closed')
        if (state.mode === 'missing') return { ok: false, error: `ENOENT: no such file ${filePath}` }
        // The controller only returns a cover and filmstrip for a video it
        // decoded, so the answer follows the kind the renderer asked about.
        if (state.mode === 'audio' || kind === 'audio') {
          return {
            ok: true,
            stat: state.audioStat,
            probe: { format: { duration: '0.500000' }, streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le' }] },
            waveCachePath: 'D:/cache/audio.json'
          }
        }
        return {
          ok: true,
          stat: state.videoStat,
          probe: {
            format: { duration: '2.000000' },
            streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '30000/1001' }]
          },
          thumbCachePath: 'D:/cache/key-cover.png',
          filmstripCachePath: 'D:/cache/key-strip.png',
          waveCachePath: 'D:/cache/key.json'
        }
      },
      async statFiles(paths: string[]) {
        const out: Record<string, { exists: boolean, size: number, mtimeMs: number }> = {}
        for (const path of paths) {
          out[path] = path === state.statKey ? { exists: true, ...state.audioStat } : { exists: true, ...state.videoStat }
        }
        return out
      },
      async writeAssetsFile(data: Record<string, unknown>[]) { writes.push(data) },
      async readAssetsFile() { return null },
      // The project store debounces a disk write after every timeline mutation;
      // without these the fake would log a failure that is the harness's, not
      // the code under test's.
      async writeProject() { return { ok: true } },
      async writeRecovery() { return { ok: true } },
      onDownloadProgress() { return () => {} }
    }
  }
  return state
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
