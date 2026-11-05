/**
 * Waveform service (zero-FFmpeg slice G2, ADR-033).
 *
 * Slice G1 put the law in core: bars on the scale the decoder returns, an
 * envelope that says which algorithm measured them, and a cache key that names
 * an artifact without pretending to be a media revision. This slice is the
 * wiring that makes the law pay for itself: the app produces a waveform in the
 * browser from `decodePcm`, stores it under that key, and — the part the slice
 * exists for — READS it back before it opens a decoder again.
 *
 * That read is the third one in the app (`frameStore.ts` for pixels,
 * `autocutDetect.ts` for silence, this for bars), which is what ADR-033 asks
 * for before its status can change. It also retires a dependency the web host
 * never satisfied: every caller used to gate the strip on
 * `asset.waveformPath` — a file the FFmpeg controller writes — so a browser
 * import had no waveform at all, and a decode that FAILED was answered with
 * `ok:true` and zero bars (tmcut.controller.cjs:422-427), which the panel drew
 * as silence forever.
 *
 * What is pinned, in order:
 *  - the byte store takes an artifact key for real, index included, because a
 *    law that only lives in core cannot be read back by anyone;
 *  - a cached waveform is read instead of decoded, and the bars that come out
 *    are the bars that went in;
 *  - the first ask decodes once, writes through the real store, and a service
 *    with no memory of it reads the same bars from disk — generate AND re-read;
 *  - a decode that answers nothing stores nothing, so the next ask tries again
 *    instead of inheriting a lie; silence, by contrast, is stored;
 *  - bars measured by a generation this app does not know are refused and made
 *    again;
 *  - two callers of one revision share one decode;
 *  - no revision means no waveform, and no decoder call;
 *  - the app asks the service, not a path on a server disk.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_waveform_service.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Installs the Vue auto-import and localStorage shims the store is written
// against. Must stay before every dynamic import below.
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

const FP = 'deadbeef'

/** What `decodePcm` answers: sample rate and one Float32 run per channel. */
type PcmAnswer = { sampleRate: number, channels: Float32Array[] } | null
type PcmAsk = { bytes: Blob | null, src: string | null, inSec: number, outSec: number, signal: AbortSignal }
type PcmDecode = (ask: PcmAsk) => Promise<PcmAnswer>

function pcm(value: number, samples = 800, channels = 1): PcmAnswer {
  return {
    sampleRate: 8000,
    channels: Array.from({ length: channels }, () => Float32Array.from({ length: samples }, () => value))
  }
}

/** A fake OPFS of the size the other media specs use, with the probe forgotten. */
async function freshStore() {
  clearByteIndex()
  installOpfs(10 * 1024 * 1024)
  store.resetByteStoreProbe()
}

const core = await import('tmcut-core')
const store = await import('../../app/utils/tmcut/byteStore')
const service = await import('../../app/utils/tmcut/waveformService')
const { createWaveformService } = service

/**
 * A service whose library holds this one revision. `liveKeys` is required
 * because writing runs the eviction law, which frees whatever the library does
 * not name — a service handed a narrower set would delete the cache it is
 * adding to, so no caller gets to pass one by accident.
 */
function makeService(decode: PcmDecode) {
  return createWaveformService(decode, () => new Set([FP]))
}

async function main() {
  console.log('=== [TMCut waveform service] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}

  await check('the byte store really keeps an artifact next to its source', async () => {
    // Core decided in G1 that a derived key is storable. Run through the real
    // store to prove the index filter did not quietly drop the row on reload.
    await freshStore()
    const key = core.waveformCacheKey(FP)
    assert.equal(key, `${FP}-wave-v1`)
    assert.equal(await store.putCachedBytes(key, blobOf(64, 'w'), new Set([FP])), true)
    const back = await store.readCachedBytes(key)
    assert.equal(back?.size, 64, 'the artifact comes back byte for byte')
    assert.ok(store.cachedByteKeys().has(key), 'and the index still names it after a reload')
    assert.equal(await store.putCachedBytes(`${FP}-wave-v0`, blobOf(8, 'x'), new Set([FP])), false,
      'a key of a generation nobody produces is not a cache entry')
    assert.equal(await store.readCachedBytes('../escape'), null, 'and a path is never a key')
  })

  await check('an eviction pass keeps a waveform while its file is in the library', async () => {
    // The library hands the store the revisions it knows. An artifact is not one
    // of them, so a reconcile that asked for the artifact's own name would free
    // every waveform on the next import.
    await freshStore()
    const key = core.waveformCacheKey(FP)
    assert.equal(await store.putCachedBytes(key, blobOf(64, 'w'), new Set([FP])), true)
    const kept = await store.pruneByteCache(new Set([FP]))
    assert.equal(kept.dropped, 0, 'the artifact and its source both stay')
    assert.equal((await store.readCachedBytes(key))?.size, 64)
    const gone = await store.pruneByteCache(new Set())
    assert.ok(gone.dropped >= 1, 'and a revision nobody owns loses its bars with it')
    assert.equal(await store.readCachedBytes(key), null)
  })

  await check('a cached waveform is read instead of decoded', async () => {
    await freshStore()
    const payload = core.buildWaveformPayload({
      peaks: [0.5, 0.25, 0.75],
      sampleRate: 8000,
      channelCount: 1,
      durationSec: 12
    })
    const asBytes = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    assert.equal(await store.putCachedBytes(core.waveformCacheKey(FP), asBytes, new Set([FP])), true,
      'the artifact is in the store')

    const asks: PcmAsk[] = []
    const svc = makeService(async (ask) => {
      asks.push(ask)
      return pcm(0.9)
    })
    const peaks = await svc.load({ fingerprint: FP, src: 'media://local/a.wav', durationSec: 12 })
    assert.deepEqual(peaks, [0.5, 0.25, 0.75], 'the bars that were stored are the bars drawn')
    assert.equal(asks.length, 0, 'and the decoder never opened')
  })

  await check('the first ask decodes, writes through the store, and a later service reads it back', async () => {
    await freshStore()
    let decoded = 0
    const decoder = async (ask: PcmAsk) => {
      decoded += 1
      assert.equal(ask.inSec, 0, 'a waveform covers the whole revision')
      assert.equal(ask.outSec, 12, 'and the range is what the probe learned')
      return pcm(0.35)
    }
    const svc = makeService(decoder)
    const peaks = await svc.load({ fingerprint: FP, src: 'media://local/a.wav', durationSec: 12 })
    assert.equal(decoded, 1)
    assert.ok(peaks && peaks.length === 200, `200 buckets, got ${peaks?.length}`)
    assert.ok(peaks.every(p => Math.abs(p - 0.35) < 1e-9),
      'bars on the scale decodePcm returns — the int16 reducer would have drawn 1.07e-5')

    const stored = await store.readCachedBytes(core.waveformCacheKey(FP))
    assert.ok(stored, 'the artifact landed in the browser store')
    const record = core.readWaveformPayload(JSON.parse(await stored.text()))
    assert.ok(record, 'and it is a payload this version can read')
    assert.equal(record.channelCount, 1)
    assert.equal(record.sampleRate, 8000)
    assert.equal(record.bucketCount, 200)

    // A service with no memory of the first ask — this is the re-read the slice
    // is judged on: the same browser, a new page, no decoder, the same bars.
    let again = 0
    const second = makeService(async () => {
      again += 1
      return pcm(0.35)
    })
    assert.deepEqual(await second.load({ fingerprint: FP, src: 'media://local/a.wav', durationSec: 12 }), peaks)
    assert.equal(again, 0, 'the second page never decoded')
  })

  await check('a decode that answers nothing stores nothing', async () => {
    await freshStore()
    let calls = 0
    const svc = makeService(async () => {
      calls += 1
      return null
    })
    assert.equal(await svc.load({ fingerprint: FP, src: 'media://local/silent.wav', durationSec: 12 }), null)
    assert.equal(calls, 1)
    assert.equal(await store.readCachedBytes(core.waveformCacheKey(FP)), null,
      'nothing was written, so the controller zeros-as-truth cannot be inherited')
    assert.equal(await svc.load({ fingerprint: FP, src: 'media://local/silent.wav', durationSec: 12 }), null)
    assert.equal(calls, 2, 'and the next ask tries again instead of drawing silence forever')

    // Silence is a real answer, and it is stored: bars of zero height, with the
    // channel count that says the file does have a track.
    const quiet = makeService(async () => pcm(0))
    const bars = await quiet.load({ fingerprint: FP, src: 'media://local/silent.wav', durationSec: 12 })
    assert.ok(bars && bars.length === 200 && bars.every(p => p === 0), 'a silent file has bars')
    assert.ok(await store.readCachedBytes(core.waveformCacheKey(FP)), 'and they are kept')
  })

  await check('bars from a generation this app does not know are remade', async () => {
    await freshStore()
    const stale = { ...core.buildWaveformPayload({ peaks: [0.5], sampleRate: 8000, channelCount: 1, durationSec: 12 }), algorithm: 'rms-v9' }
    assert.equal(await store.putCachedBytes(core.waveformCacheKey(FP), new Blob([JSON.stringify(stale)], { type: 'application/json' }), new Set([FP])), true)

    let calls = 0
    const svc = makeService(async () => {
      calls += 1
      return pcm(0.4)
    })
    const peaks = await svc.load({ fingerprint: FP, src: 'media://local/a.wav', durationSec: 12 })
    assert.equal(calls, 1, 'the unreadable record was not drawn')
    assert.ok(peaks && peaks.length === 200)
    const record = core.readWaveformPayload(JSON.parse(await (await store.readCachedBytes(core.waveformCacheKey(FP)))!.text()))
    assert.equal(record.algorithm, core.TMCUT_WAVEFORM_ALGORITHM, 'and it was replaced by a readable one')
  })

  await check('two callers of one revision share one decode', async () => {
    await freshStore()
    let calls = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const svc = makeService(async () => {
      calls += 1
      await gate
      return pcm(0.2)
    })
    const ask = { fingerprint: FP, src: 'media://local/a.wav', durationSec: 12 }
    const first = svc.load(ask)
    const second = svc.load(ask)
    await Promise.resolve()
    assert.equal(svc.inFlight(), 1, 'one revision, one job')
    release()
    assert.deepEqual(await first, await second)
    assert.equal(calls, 1, 'a panel and a timeline clip cost one decode')
    assert.equal(svc.inFlight(), 0, 'and the bookkeeping empties when it lands')
  })

  await check('the bytes come from the client cache when the browser holds them', async () => {
    await freshStore()
    // Local-first, the same rule the frame service runs: a copy the app already
    // owns is not re-fetched over a URL that may not exist anymore.
    assert.equal(await store.putCachedBytes(FP, blobOf(2048, 'm'), new Set([FP])), true)
    const asks: PcmAsk[] = []
    const svc = makeService(async (ask) => {
      asks.push(ask)
      return pcm(0.3)
    })
    await svc.load({ fingerprint: FP, src: 'http://localhost:4003/uploads/a.wav', durationSec: 12 })
    assert.equal(asks.length, 1)
    assert.equal(asks[0]!.bytes?.size, 2048, 'the decoder is handed the browser copy')
    assert.equal(asks[0]!.src, null, 'and never reaches for the server when it has the file')
  })

  await check('no revision, no waveform, no decoder', async () => {
    await freshStore()
    let calls = 0
    const svc = makeService(async () => {
      calls += 1
      return pcm(0.3)
    })
    for (const fingerprint of [null, undefined, '', 'DEADBEEF', 'not-a-revision']) {
      assert.equal(await svc.load({ fingerprint, src: 'media://local/a.wav', durationSec: 12 }), null,
        `${String(fingerprint)} cannot name a file`)
    }
    assert.equal(calls, 0, 'a read that cannot be cached is not worth a decode')
    assert.equal(await svc.load({ fingerprint: FP, src: 'media://local/a.wav', durationSec: 0 }), null,
      'a file with no known length has no waveform either')
    assert.equal(calls, 0)
  })

  await check('the app asks the service, not a file the FFmpeg controller wrote', () => {
    const composable = read('app/composables/useTmcutMedia.ts')
    assert.match(composable, /waveformService|loadWaveformPeaks/, 'the composable goes through the service')
    assert.match(composable, /from '~\/utils\/tmcut\/waveformService'/, 'and imports it from the seam, not a copy')
    // Every consumer used to refuse on `asset.waveformPath`, a path only the
    // desktop controller ever fills — the web host had no waveform to ask for.
    for (const file of ['app/composables/useTmcutMedia.ts', 'app/components/tmcut/TmcutTimelineClip.vue', 'app/components/tmcut/TmcutMediaPanel.vue']) {
      assert.doesNotMatch(read(file), /asset\.waveformPath\s*(&&|\?|===|!==|\|\|)/,
        `${file} still gates a waveform on a server path`)
    }
    const declarations = read('packages/core/src/index.d.ts')
    for (const name of ['waveformCacheKey', 'TMCUT_WAVEFORM_CACHE_KIND', 'TMCUT_WAVEFORM_CACHE_VERSION']) {
      assert.ok(declarations.includes(name), `tmcut-core does not declare ${name}`)
    }
    const barrel = read('app/utils/tmcut/waveform.ts')
    assert.match(barrel, /waveformCacheKey/, 'the app barrel re-exports the key law')
  })

  await check('clearing the cache forgets the bars the app is still holding', () => {
    // The in-memory row is a convenience, so it must die with the store it
    // mirrors: a relink changes the revision, and "Clear cache" gives back
    // everything the browser holds.
    const composable = read('app/composables/useTmcutMedia.ts')
    assert.match(composable, /waveformCache\.clear\(\)/, 'the memory goes when the store is cleared')
    assert.doesNotMatch(composable, /waveformCache\.delete\(oldWaveformPath\)/,
      'a relink is no longer judged by the name of a file on disk')
  })

  console.log(`\n=== Waveform service: ${passed}/${passed} checks PASSED ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
