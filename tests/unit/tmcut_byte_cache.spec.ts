/**
 * Client byte cache (zero-FFmpeg slice C2b, ADR-033).
 *
 * ADR-033 says the bytes stay on this machine by default and leaving is a
 * visible choice. On the web host the durable copy is a server file, so every
 * re-open asks a machine that may not have it. This slice keeps a second copy
 * in the browser, under the revision fingerprint slice C1 made, and it is the
 * only place in `app/` allowed to open a byte store.
 *
 * What is pinned, in order:
 *  - the law lives in core and is pure: budget from quota (unknown quota is
 *    never a licence for unlimited storage), a legal key is exactly one
 *    fingerprint, and eviction drops orphaned bytes first, then least recently
 *    used, and refuses an entry bigger than the whole budget;
 *  - the storage layer runs on OPFS, falls back to IndexedDB, and degrades to
 *    "off" without breaking a single caller;
 *  - the index is the authority in both directions: an entry whose bytes are
 *    gone is forgotten, bytes the index does not name are deleted;
 *  - a write that the cache refuses is not an import failure;
 *  - (part 2, below) the media pipeline writes on import and relink, and prefers
 *    its own bytes when probing or when proving a file is alive.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_byte_cache.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Installs the Vue auto-import and localStorage shims the store is written
// against. Must stay before every dynamic import below.
import './helpers/tmcut_store_env'
import {
  blobOf, clearByteIndex, installIdbOnly, installNoStorage, installOpfs,
  opfsLive, readByteIndex, writeByteIndex
} from './helpers/tmcut_browser_storage'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** The eight hex characters `cacheKeyForPath` produces, spelled by hand. */
const KEYS = ['00000001', '00000002', '00000003', '0000000a', 'deadbeef'] as const

function slow(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function walkApp(dir: string, prefix = 'app'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...walkApp(full, rel))
    else if (/\.(ts|vue)$/.test(entry)) out.push(rel)
  }
  return out
}

async function main() {
  console.log('=== [TMCut client byte cache] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  if (!g.useToast) g.useToast = () => ({ add: () => {} })

  const core = await import('tmcut-core')

  await check('core owns the byte-cache law, not the app', () => {
    assert.equal(typeof core.byteCacheBudgetBytes, 'function', 'the budget answers from core')
    assert.equal(typeof core.isByteCacheKey, 'function', 'key legality answers from core')
    assert.equal(typeof core.byteCacheFits, 'function', 'refusing an oversized file answers from core')
    assert.equal(typeof core.planByteCacheEviction, 'function', 'eviction answers from core')
  })

  await check('a budget is never unlimited, even when the device says nothing', () => {
    const max = core.TMCUT_BYTE_CACHE_MAX_BYTES
    assert.equal(core.byteCacheBudgetBytes(Number.NaN), max, 'no quota signal still has a ceiling')
    assert.equal(core.byteCacheBudgetBytes(0), max, 'a zero quota is not a licence to fill the disk')
    assert.equal(core.byteCacheBudgetBytes(-5), max, 'a nonsense quota is not either')
    assert.equal(core.byteCacheBudgetBytes(1000), 400, 'a reported quota is shared, not spent')
    assert.equal(core.byteCacheBudgetBytes(40 * 1024 ** 3), max, 'a huge disk does not remove the ceiling')
    assert.ok(core.byteCacheBudgetBytes(1024 ** 3) <= max, 'never more than the ceiling')
  })

  await check('a cache key is exactly one revision fingerprint', () => {
    const fingerprint = core.cacheKeyForPath('D:/Media/tone.wav', { mtimeMs: 0, size: 16044 })
    assert.equal(core.isByteCacheKey(fingerprint), true, 'the fingerprint core issues is a legal key')
    assert.equal(core.isByteCacheKey('deadbeef'), true)
    assert.equal(core.isByteCacheKey('../deadbe'), false, 'a key is never a path')
    assert.equal(core.isByteCacheKey('DEADBEEF'), false, 'uppercase is not the digest core writes')
    assert.equal(core.isByteCacheKey('deadbee'), false, 'seven chars is truncated')
    assert.equal(core.isByteCacheKey('deadbeef0'), false, 'nine chars is not one digest')
    assert.equal(core.isByteCacheKey(''), false)
    assert.equal(core.isByteCacheKey(null), false, 'a record with no fingerprint has no bytes')
    assert.equal(core.isByteCacheKey(undefined), false)
  })

  await check('a file larger than the whole budget is never copied', () => {
    assert.equal(core.byteCacheFits(1, 100), true)
    assert.equal(core.byteCacheFits(100, 100), true, 'exactly the budget fits')
    assert.equal(core.byteCacheFits(101, 100), false, 'it would be evicted the moment it landed')
    assert.equal(core.byteCacheFits(0, 100), false, 'an empty read is not bytes to keep')
    assert.equal(core.byteCacheFits(10, 0), false, 'no budget means no caching')
    assert.equal(core.byteCacheFits(Number.NaN, 100), false)
  })

  await check('eviction drops the leak first, then the least recently used', () => {
    const plan = core.planByteCacheEviction([
      { key: KEYS[0], bytes: 100, accessedAt: 3000 },
      { key: KEYS[1], bytes: 100, accessedAt: 1000 },
      { key: KEYS[2], bytes: 100, accessedAt: 2000 }
    ], 200, [KEYS[0], KEYS[1], KEYS[2]])
    assert.deepEqual(plan.drop, [KEYS[1]], 'all three are live, so the oldest revision goes')
    assert.equal(plan.keptBytes, 200, 'the keep list answers inside the budget')
    assert.deepEqual(plan.keep.map(entry => entry.key).sort(), [KEYS[0], KEYS[2]])
  })

  await check('bytes whose asset is gone are dropped before the LRU runs', () => {
    const plan = core.planByteCacheEviction([
      { key: KEYS[0], bytes: 100, accessedAt: 1000 },
      { key: KEYS[1], bytes: 100, accessedAt: 2000 }
    ], 10_000, [KEYS[1]])
    assert.deepEqual(plan.drop, [KEYS[0]], 'a relink or delete leaves bytes behind; nothing else cleans them')
    assert.equal(plan.keep.length, 1)
  })

  await check('an entry that cannot fit the budget alone is dropped even when live', () => {
    const plan = core.planByteCacheEviction([
      { key: KEYS[0], bytes: 5000, accessedAt: 1000 },
      { key: KEYS[1], bytes: 100, accessedAt: 2000 }
    ], 400, [KEYS[0], KEYS[1]])
    assert.deepEqual(plan.drop, [KEYS[0]], 'the cache loses to the file, and says so')
    assert.deepEqual(plan.keep.map(entry => entry.key), [KEYS[1]])
    assert.equal(plan.keptBytes, 100)
  })

  await check('an index entry that is not a fingerprint is reported, not obeyed', () => {
    const plan = core.planByteCacheEviction([
      { key: '../escape', bytes: 100, accessedAt: 1000 },
      { key: KEYS[0], bytes: 100, accessedAt: 1000 }
    ], 400, ['../escape', KEYS[0]])
    assert.deepEqual(plan.invalid, ['../escape'], 'a key that cannot name a file is only noise')
    assert.deepEqual(plan.drop, ['../escape'], 'and it still leaves the index')
    assert.deepEqual(plan.keep.map(entry => entry.key), [KEYS[0]])
  })

  await check('eviction is deterministic and tolerates a messy index', () => {
    const entries = [
      { key: KEYS[3], bytes: 100, accessedAt: 1000 },
      { key: KEYS[0], bytes: 100, accessedAt: 1000 }
    ]
    const first = core.planByteCacheEviction(entries, 100, entries.map(entry => entry.key))
    const second = core.planByteCacheEviction([...entries].reverse(), 100, entries.map(entry => entry.key))
    assert.deepEqual([...first.drop].sort(), [...second.drop].sort(), 'same budget, input order must not matter')
    assert.equal(first.drop[0], KEYS[0], 'a tie in access time breaks by key, so one file always wins')
    const junk = core.planByteCacheEviction(undefined as never, 100, [])
    assert.deepEqual(junk.drop, [])
    const unknownBudget = core.planByteCacheEviction([{ key: KEYS[0], bytes: 5, accessedAt: 1 }], Number.NaN, [KEYS[0]])
    assert.deepEqual(unknownBudget.drop, [KEYS[0]], 'a budget nobody can read caches nothing')
    const negative = core.planByteCacheEviction([{ key: KEYS[0], bytes: -50, accessedAt: 1 }], 100, [KEYS[0]])
    assert.equal(negative.keptBytes, 0, 'a corrupt size never subtracts from the total')
  })

  // -------------------------------------------------------------------------
  // The storage layer, on each backend it can meet.
  // -------------------------------------------------------------------------

  const store = await import('../../app/utils/tmcut/byteStore')
  const {
    byteStoreBackend, byteCacheBudget, byteCacheInfo, cachedByteKeys,
    clearCachedBytes, pruneByteCache, putCachedBytes, readCachedBytes,
    resetByteStoreProbe
  } = store

  const live = (keys: string[]) => new Set(keys)

  await check('the store names the backend it actually reached', async () => {
    clearByteIndex()
    installOpfs(1024)
    resetByteStoreProbe()
    assert.equal(await byteStoreBackend(), 'opfs', 'OPFS wins when the browser offers it')
    installNoStorage()
    installIdbOnly()
    resetByteStoreProbe()
    assert.equal(await byteStoreBackend(), 'idb', 'IndexedDB is the fallback, not a dead end')
    installNoStorage()
    resetByteStoreProbe()
    assert.equal(await byteStoreBackend(), 'none', 'and no storage at all is an answer, not a crash')
  })

  await check('a stored revision reads back as the same bytes', async () => {
    clearByteIndex()
    const opfs = installOpfs(1024 * 1024)
    resetByteStoreProbe()
    const blob = blobOf(1200, 'a')
    assert.equal(await putCachedBytes(KEYS[0], blob, live([KEYS[0]])), true)
    const back = await readCachedBytes(KEYS[0])
    assert.ok(back, 'the cache answers')
    assert.equal(back!.size, blob.size, 'byte for byte')
    assert.equal(readByteIndex()[KEYS[0]]?.bytes, blob.size, 'the index carries the size the UI shows')
    assert.equal(opfs.bytes(KEYS[0]), blob.size, 'and the file is really there')
    assert.equal((await byteCacheInfo()).usedBytes, blob.size)
  })

  await check('the index is written one row at a time, never as a snapshot', async () => {
    clearByteIndex()
    // The browser is slow to hand the file over, so the reader's view of the
    // index is taken before the writer's row exists and lands after it.
    let releaseReads: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    const opfs = installOpfs(1024 * 1024, { holdReadsFor: () => held })
    resetByteStoreProbe()
    await putCachedBytes(KEYS[0], blobOf(500, 'a'), live([KEYS[0]]))
    // A panel reads the revision it already holds while the library stores the
    // one it just took — the waveform ask and the import copy do exactly this in
    // the same tick. A writer that rebuilds the whole index from the snapshot it
    // opened forgets the other's row: an OPFS file no index row names, unreadable
    // and freed by the next reconcile.
    const reading = readCachedBytes(KEYS[0])
    await slow(0)
    assert.equal(await putCachedBytes(KEYS[1], blobOf(600, 'b'), live([KEYS[0], KEYS[1]])), true)
    assert.equal(readByteIndex()[KEYS[1]]?.bytes, 600, 'the write indexed its own row')
    releaseReads()
    assert.ok(await reading, 'and the read still answers')
    assert.equal(opfs.bytes(KEYS[1]), 600, 'the bytes are on the machine')
    assert.equal(readByteIndex()[KEYS[1]]?.bytes, 600, 'and the index still names them')
    assert.equal(readByteIndex()[KEYS[0]]?.bytes, 500, 'including the row the read touched')
  })

  await check('a row never claims bytes the file does not have', async () => {
    clearByteIndex()
    // OPFS truncates the file the moment the writable opens, so a panel that asks
    // for this revision while an import is still copying it reads an empty file.
    let releaseWrite: () => void = () => undefined
    const heldWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    const opfs = installOpfs(1024 * 1024, { holdWritesFor: () => heldWrite })
    resetByteStoreProbe()
    const writing = putCachedBytes(KEYS[1], blobOf(600, 'b'), live([KEYS[1]]))
    await slow(0)
    assert.equal(opfs.bytes(KEYS[1]), 0, 'the file is open and empty')
    assert.equal(await readCachedBytes(KEYS[1]), null, 'and an empty file answers nothing')
    releaseWrite()
    assert.equal(await writing, true)
    assert.equal(opfs.bytes(KEYS[1]), 600)
    assert.equal(readByteIndex()[KEYS[1]]?.bytes, 600, 'the row says what the file really is')
  })

  await check('a read the cache cannot serve is forgotten, not trusted', async () => {
    clearByteIndex()
    const opfs = installOpfs(1024 * 1024)
    resetByteStoreProbe()
    await putCachedBytes(KEYS[0], blobOf(500, 'b'), live([KEYS[0]]))
    opfs.dropAll()
    assert.equal(await readCachedBytes(KEYS[0]), null, 'the browser reclaimed the file')
    assert.equal(readByteIndex()[KEYS[0]], undefined, 'and the index stopped lying about it')
    assert.equal(await putCachedBytes(KEYS[1], blobOf(300, 'c'), live([KEYS[1]])), true,
      'the store re-opens its directory instead of staying dead')
    assert.equal(opfs.bytes(KEYS[1]), 300)
  })

  await check('an unknown or illegal key never reaches the filesystem', async () => {
    clearByteIndex()
    const opfs = installOpfs(1024 * 1024)
    resetByteStoreProbe()
    assert.equal(await putCachedBytes('../escape', blobOf(10), live([])), false)
    assert.equal(await putCachedBytes(null as never, blobOf(10), live([])), false)
    assert.equal(await putCachedBytes('DEADBEEF', blobOf(10), live([])), false)
    assert.deepEqual(opfs.keys(), [], 'no file was created for any of them')
    assert.equal(await readCachedBytes('../escape'), null)
  })

  await check('a file bigger than the budget stays uncached', async () => {
    clearByteIndex()
    const opfs = installOpfs(100)
    resetByteStoreProbe()
    assert.equal(await byteCacheBudget(), 40, 'the quota the browser reports is shared, not spent')
    assert.equal(await putCachedBytes(KEYS[0], blobOf(1000), live([KEYS[0]])), false)
    assert.deepEqual(opfs.keys(), [])
    assert.deepEqual(cachedByteKeys(), new Set())
    assert.equal(await putCachedBytes(KEYS[1], blobOf(30), live([KEYS[1]])), true, 'a file that fits still lands')
  })

  await check('the store off is a state, not an exception', async () => {
    clearByteIndex()
    installNoStorage()
    resetByteStoreProbe()
    assert.equal(await putCachedBytes(KEYS[0], blobOf(10), live([KEYS[0]])), false)
    assert.equal(await readCachedBytes(KEYS[0]), null)
    const info = await byteCacheInfo()
    assert.equal(info.backend, 'none')
    assert.equal(info.available, false, 'the UI is allowed to say it is off')
    assert.equal(info.entries, 0)
    assert.equal((await pruneByteCache(live([KEYS[0]]))).dropped, 0)
  })

  await check('the IndexedDB fallback really stores and really evicts', async () => {
    clearByteIndex()
    const idb = installIdbOnly()
    resetByteStoreProbe()
    assert.equal(await putCachedBytes(KEYS[0], blobOf(1000), live([KEYS[0]])), true)
    assert.equal(await putCachedBytes(KEYS[1], blobOf(1000), live([KEYS[0], KEYS[1]])), true)
    assert.equal((await readCachedBytes(KEYS[1]))?.size, 1000)
    assert.deepEqual(idb.keys().sort(), [KEYS[0], KEYS[1]])
    const pruned = await pruneByteCache(live([KEYS[1]]))
    assert.ok(pruned.dropped >= 1, 'the revision the library stopped naming is freed')
    assert.deepEqual(idb.keys(), [KEYS[1]], 'and it is gone from the store, not only from the index')
    assert.equal(readByteIndex()[KEYS[0]], undefined)
    await clearCachedBytes()
    assert.deepEqual(idb.keys(), [], 'the clear control empties the backend')
    assert.deepEqual(readByteIndex(), {}, 'and the index with it')
  })

  await check('the index and the bytes are reconciled both ways', async () => {
    clearByteIndex()
    const opfs = installOpfs(10 * 1024 * 1024)
    resetByteStoreProbe()
    await putCachedBytes(KEYS[0], blobOf(1000), live([KEYS[0]]))
    // An orphan the index never named: unreachable bytes, the leak ADR-033 fears.
    await opfs.writeOrphan(KEYS[3], 4096)
    // And an index entry whose file somebody else deleted.
    writeByteIndex({ ...readByteIndex(), [KEYS[2]]: { bytes: 123, accessedAt: 1 } })
    const pruned = await pruneByteCache(live([KEYS[0], KEYS[2]]))
    assert.equal(pruned.dropped, 2, 'one file with no index entry, one entry with no file')
    assert.deepEqual(opfs.keys(), [KEYS[0]], 'the orphan was deleted from the browser')
    assert.equal(readByteIndex()[KEYS[2]], undefined, 'the lie was deleted from the index')
    assert.equal(readByteIndex()[KEYS[0]]?.bytes, 1000, 'the honest entry survived both passes')
  })

  await check('over budget, the least recently used revision is the one freed', async () => {
    clearByteIndex()
    const opfs = installOpfs(600)
    resetByteStoreProbe()
    assert.equal(await byteCacheBudget(), 240)
    await putCachedBytes(KEYS[0], blobOf(100), live([KEYS[0]]))
    await slow(5)
    await putCachedBytes(KEYS[1], blobOf(100), live([KEYS[0], KEYS[1]]))
    assert.deepEqual(opfs.keys().sort(), [KEYS[0], KEYS[1]].sort(), 'two fit under 240 bytes')
    await slow(5)
    await putCachedBytes(KEYS[2], blobOf(100), live([KEYS[0], KEYS[1], KEYS[2]]))
    assert.deepEqual(opfs.keys().sort(), [KEYS[1], KEYS[2]].sort(), 'the third makes three over budget, so the oldest goes')
    assert.equal(readByteIndex()[KEYS[0]], undefined, 'and the index agrees')
    // Touch KEYS[2] so the next write frees KEYS[1] instead.
    assert.ok(await readCachedBytes(KEYS[2]))
    await slow(5)
    await putCachedBytes(KEYS[3], blobOf(100), live([KEYS[1], KEYS[2], KEYS[3]]))
    assert.equal(opfs.bytes(KEYS[2]), 100, 'the revision just read stays')
    assert.equal(opfs.bytes(KEYS[1]), 0, 'the one nobody opened goes')
  })

  await check('only one module in the app opens a browser byte store', () => {
    const files = walkApp(join(root, 'app'))
    const withOpfs = files.filter(file => read(file).includes('getDirectory()')).sort()
    const withIdb = files.filter(file => read(file).includes('indexedDB')).sort()
    assert.deepEqual(withOpfs, ['app/utils/tmcut/byteStore.ts'], 'one place decides where bytes live')
    assert.deepEqual(withIdb, ['app/composables/useSystemStorage.ts', 'app/utils/tmcut/byteStore.ts'],
      'the only other reader deletes databases; it never stores a byte')
  })

  await check('the storage layer asks core for every decision', () => {
    const source = read('app/utils/tmcut/byteStore.ts')
    assert.match(source, /from 'tmcut-core'/, 'budget, keys and eviction come from core')
    // `isStoredByteCacheKey` is core's union of a revision fingerprint and an
    // artifact of one (slice G1/G2): the store keeps both, so it asks that, and
    // the revision-only predicate stays a question for the library.
    for (const name of ['byteCacheBudgetBytes', 'isStoredByteCacheKey', 'byteCacheFits', 'planByteCacheEviction']) {
      assert.ok(source.includes(name), `${name} is used, not re-implemented`)
    }
    assert.doesNotMatch(source, /fnv1aHex\(/, 'the storage layer does not re-hash')
    assert.doesNotMatch(source, /localStorage\.setItem/, 'localStorage goes through the never-throwing helper')
  })

  await check('core declares the byte-cache law to the app', () => {
    // The app types tmcut-core from hand-written declarations, so a runtime
    // export nobody declared is invisible to the app that must call it.
    const dts = read('packages/core/src/index.d.ts')
    for (const name of [
      'TMCUT_BYTE_CACHE_MAX_BYTES', 'byteCacheBudgetBytes', 'isByteCacheKey',
      'byteCacheFits', 'planByteCacheEviction'
    ]) {
      assert.ok(dts.includes(name), `${name} is declared, not only exported`)
    }
    assert.match(dts, /TmcutByteCachePlan/, 'the eviction answer has a named shape')
  })

  // =========================================================================
  // Part 2 — the media pipeline hands the store its bytes.
  //
  // A cache nobody writes to is a demo, so these checks run the real web
  // import and the real relink flow and look at the browser afterwards.
  // Reading the copy (probe, thumbnails, export) belongs to slices D and H;
  // nothing here claims the cache proves a file alive.
  // =========================================================================

  const server = await startUploadServer()
  installWebRuntime(server)
  g.useI18n = () => ({ t: (key: string) => key })
  const toasts: string[] = []
  g.useToast = () => ({
    add: (toast: { title?: string }) => {
      toasts.push(String(toast?.title))
    }
  })

  const media = (await import('../../app/composables/useTmcutMedia')).useTmcutMedia()
  const { assetFingerprint } = await import('../../app/utils/tmcut/assetImport')

  /** One picked file, the way `pickWebFiles` returns it. */
  function pickedWav(name = 'tone.wav') {
    return new File([wavBytes(0.5)], name, { type: 'audio/wav' })
  }

  function libraryRows() {
    const raw = globalThis.localStorage?.getItem('tmcut_assets_v1')
    return raw ? JSON.parse(String(raw)) as Array<{ path: string, fingerprint: string | null }> : []
  }

  await check('an import keeps its own copy of the bytes', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    resetByteStoreProbe()
    media.assets.value = []
    const file = pickedWav()
    const created = await media.importWebFiles([file])
    assert.equal(created.length, 1, 'the import itself happened')
    const asset = created[0]!
    assert.equal(asset.status, 'ready', 'the probe answered over the picked bytes')
    assert.ok(asset.fingerprint, 'the record carries its revision')
    assert.ok(cachedByteKeys().has(asset.fingerprint!),
      'the library keeps a copy under the fingerprint it wrote')
    assert.equal(opfsLive().bytes(asset.fingerprint!), file.size, 'and the copy is the whole file')
    assert.deepEqual(libraryRows().map(row => row.path), [asset.path], 'the mirror still holds paths, not bytes')
  })

  await check('a browser with no byte store does not fail the import', async () => {
    clearByteIndex()
    installNoStorage()
    resetByteStoreProbe()
    media.assets.value = []
    const created = await media.importWebFiles([pickedWav('quiet.wav')])
    assert.equal(created.length, 1, 'a cache that cannot open is not an upload error')
    assert.equal(created[0]!.status, 'ready')
    assert.equal(media.importError.value, null, 'a cache that is off is never reported as an import error')
    assert.deepEqual([...cachedByteKeys()], [], 'and it kept nothing, having nowhere to keep it')
    const info = await byteCacheInfo()
    assert.equal(info.available, false)
    assert.equal(info.entries, 0)
  })

  await check('a relink caches the bytes it just took', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    resetByteStoreProbe()
    media.assets.value = []
    const first = (await media.importWebFiles([pickedWav('take-01.wav')]))[0]!
    assert.ok(first.fingerprint)
    first.status = 'missing'
    first.importStatus = 'error'
    installWebPicker([pickedWav('take-02.wav')])
    const { relinkWithPicker } = (await import('../../app/composables/useTmcutRelink')).useTmcutRelink()
    const ok = await relinkWithPicker(first)
    assert.equal(ok, true, 'the replacement was readable')
    assert.notEqual(first.path, '', 'and the asset points at it')
    assert.ok(first.fingerprint, 'a fresh revision was learned')
    assert.ok(cachedByteKeys().has(first.fingerprint!), 'the new copy is the one kept')
    assert.equal(assetFingerprint(first.path, first.meta), first.fingerprint, 'under the fingerprint the record carries')
  })

  await check('bytes the library stopped naming are freed on the next open', async () => {
    clearByteIndex()
    const opfs = installOpfs(10 * 1024 * 1024)
    resetByteStoreProbe()
    media.assets.value = []
    media.libraryLoaded.value = false
    const keep = (await media.importWebFiles([pickedWav('keep.wav')]))[0]!
    const gone = (await media.importWebFiles([pickedWav('gone.wav')]))[0]!
    assert.equal(opfs.bytes(keep.fingerprint!), keep.meta.fileSize)
    assert.equal(opfs.bytes(gone.fingerprint!), gone.meta.fileSize)
    // A delete, then a reload: the registry lost the row, the cache must not
    // keep an orphan nobody can name.
    media.removeAsset(gone.id)
    media.libraryLoaded.value = false
    await media.loadLibrary()
    assert.ok(cachedByteKeys().has(keep.fingerprint!), 'the asset still in the library keeps its copy')
    assert.equal(opfs.bytes(gone.fingerprint!), 0, 'and the deleted one leaves no bytes behind')
    assert.ok(!cachedByteKeys().has(gone.fingerprint!))
  })

  await check('the library panel tells what is kept and can give it back', () => {
    const panel = read('app/components/tmcut/TmcutMediaPanel.vue')
    assert.match(panel, /byteCache/, 'the panel reads the cache state the store exposes')
    assert.match(panel, /t\('tmcut\.media\.cacheSummary'/, 'one line says how much is kept')
    assert.match(panel, /clearMediaByteCache/, 'and the user, not the browser, decides when it goes')
    const { en, vi } = locales()
    for (const key of ['tmcut.media.cacheSummary', 'tmcut.media.cacheOff', 'tmcut.media.cacheClear', 'tmcut.media.cacheCleared']) {
      assert.ok(en.get(key)?.trim(), `${key} missing from en`)
      assert.ok(vi.get(key)?.trim(), `${key} missing from vi`)
      assert.notEqual(en.get(key), key, 'a label is not a key echo')
    }
  })

  await server.close()
  console.log(`\n=== All ${passed} byte cache checks passed ===`)
}

/** Flatten the tmcut.media subtree of both locales for label checks. */
function locales() {
  const flat = (rel: string) => {
    const json = JSON.parse(read(rel)) as Record<string, unknown>
    const media = (json.tmcut as { media?: Record<string, unknown> })?.media ?? {}
    return new Map(Object.entries(media).map(([key, value]) => [`tmcut.media.${key}`, String(value)]))
  }
  return { en: flat('i18n/locales/en.json'), vi: flat('i18n/locales/vi.json') }
}

/**
 * A local server that holds uploaded bytes and can be closed, so a check can
 * say "this machine no longer has the file" without pretending.
 */
function startUploadServer(): Promise<UploadServer> {
  const files = new Map<string, Uint8Array>()
  return new Promise((resolve) => {
    const http = createServer((req, res) => {
      const name = decodeURIComponent(String(req.url ?? '').split('/').pop() ?? '')
      const body = files.get(name)
      if (!body) {
        res.writeHead(404)
        res.end()
        return
      }
      const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''))
      if (range && (range[1] !== '' || range[2] !== '')) {
        const start = range[1] === '' ? Math.max(0, body.length - Number(range[2])) : Number(range[1])
        const end = range[2] === '' || range[1] === '' ? body.length - 1 : Number(range[2])
        res.writeHead(206, {
          'content-type': 'application/octet-stream',
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'accept-ranges': 'bytes'
        })
        res.end(Buffer.from(body.subarray(start, end + 1)))
        return
      }
      res.writeHead(200, { 'content-length': String(body.length), 'accept-ranges': 'bytes' })
      res.end(Buffer.from(body))
    })
    http.listen(0, '127.0.0.1', () => {
      const address = http.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        port,
        files,
        close: () => new Promise<void>(done => http.close(() => done()))
      })
    })
  })
}

type UploadServer = { port: number, files: Map<string, Uint8Array>, close: () => Promise<void> }

/**
 * The web runtime the store is written against: `$fetch` for the upload, object
 * URLs for the thumb capture. Uploads land in the server above, so a path is a
 * real, fetchable URL.
 */
function installWebRuntime(server: UploadServer) {
  const g = globalThis as Record<string, unknown>
  let count = 0
  g.$fetch = async (url: string, options: { body?: Blob }) => {
    const name = `upload-${count += 1}.bin`
    const bytes = new Uint8Array(await (options?.body as Blob).arrayBuffer())
    server.files.set(name, bytes)
    return { url: `http://127.0.0.1:${server.port}/${name}`, size: bytes.byteLength }
  }
  const objectUrls = g.URL as unknown as {
    createObjectURL: (blob: Blob) => string
    revokeObjectURL: (url: string) => void
  }
  let created = 0
  objectUrls.createObjectURL = () => `blob:session/${created += 1}`
  objectUrls.revokeObjectURL = () => {}
}

/**
 * A file picker the test can answer, so the relink flow runs through the real
 * `pickWebFiles` (app/composables/useFileSystem.ts) instead of a stubbed
 * composable: the input it creates hands over these files when clicked.
 */
function installWebPicker(files: File[]) {
  const g = globalThis as Record<string, unknown>
  Object.defineProperty(g, 'window', {
    value: { addEventListener: () => {}, removeEventListener: () => {} },
    configurable: true,
    writable: true
  })
  const element: {
    type: string
    name: string
    multiple: boolean
    accept: string
    files: File[]
    onchange: null | (() => void)
    setAttribute: (name: string, value: string) => void
    style: Record<string, string>
    click: () => void
    remove: () => void
  } = {
    type: '',
    name: '',
    multiple: false,
    accept: '',
    files: [],
    onchange: null,
    setAttribute: () => {},
    style: {},
    click: () => {
      element.files = files
      element.onchange?.()
    },
    remove: () => {}
  }
  Object.defineProperty(g, 'document', {
    value: { createElement: () => element, body: { appendChild: () => {} } },
    configurable: true,
    writable: true
  })
}

/**
 * A one-channel PCM WAV, written by hand so the suite needs no media fixture
 * (same builder the slice-C spec uses).
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
  view.setUint32(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataSize, true)
  for (let i = 0; i < frames; i++) view.setInt16(44 + i * bytesPerFrame, 1000, true)
  return new Uint8Array(view.buffer)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
