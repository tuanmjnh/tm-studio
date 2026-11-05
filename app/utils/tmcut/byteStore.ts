// Where a second copy of an asset's bytes is kept in the browser, together with
// the artifacts derived from them.
//
// On the web host the durable copy of a media file is a server upload, so every
// re-open asks a machine that may not have it. Keeping our own copy — under the
// revision fingerprint slice C1 defined — makes playback, probing and liveness
// local questions (ADR-033). A derived artifact (a waveform, slice G2) is kept
// under its own name, `fingerprint-kind-vN`, which core says is storable but
// never a revision: a frame request cannot be answered from an artifact and an
// artifact dies with the revision it describes. This module is deliberately the
// only place in `app/` that opens OPFS or IndexedDB: one backend choice, one
// index, one eviction rule. Every decision (budget, key legality, what to free)
// is asked from `tmcut-core`, so the same law runs in plain node tests.
//
// The localStorage index is the authority on what the cache holds, and it is
// reconciled in both directions on every library load: an entry whose bytes are
// gone is forgotten, and bytes the index does not name are deleted. That is why
// reads self-heal instead of trusting a row that may be stale.

import { byteCacheBudgetBytes, byteCacheFits, isStoredByteCacheKey, planByteCacheEviction } from 'tmcut-core'
import { readStored, writeStored } from './localStore'

const INDEX_STORAGE_KEY = 'tmcut_byte_index_v1'
const CACHE_DIR_NAME = 'tmcut-bytes'
const DB_NAME = 'tmcut-byte-cache'
const STORE_NAME = 'bytes'

export type TmcutByteCacheBackend = 'opfs' | 'idb' | 'none'
export type TmcutByteIndexRow = { bytes: number, accessedAt: number }
export type TmcutByteCacheInfo = {
  backend: TmcutByteCacheBackend
  /** False when the browser offers no byte store at all: the UI says "off". */
  available: boolean
  entries: number
  usedBytes: number
  budgetBytes: number
}

type ByteIndex = Map<string, TmcutByteIndexRow>

// Minimal shapes of the two backends, so this file compiles against whatever
// lib.dom revision the host project carries.
interface RawFileHandle {
  getFile: () => Promise<Blob>
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>, close: () => Promise<void> }>
}
interface RawDirHandle {
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<RawDirHandle>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<RawFileHandle>
  removeEntry: (name: string, options?: { recursive?: boolean }) => Promise<void>
  entries: () => AsyncIterable<[string, { kind: string }]>
}
interface RawRequest<T> {
  result: T
  error: unknown
  onsuccess: (() => void) | null
  onerror: (() => void) | null
}
interface RawObjectStore {
  put: (record: unknown) => RawRequest<unknown>
  get: (key: string) => RawRequest<{ blob?: Blob } | undefined>
  delete: (key: string) => RawRequest<unknown>
  clear: () => RawRequest<unknown>
  getAllKeys: () => RawRequest<string[]>
}
interface RawIdb {
  open: (name: string, version?: number) => RawRequest<unknown> & { onupgradeneeded: (() => void) | null }
}

let probedBackend: TmcutByteCacheBackend | null = null
let cachedDir: RawDirHandle | null = null
let cachedDb: Promise<RawObjectStore> | null = null

type NavigatorStorage = {
  storage?: {
    getDirectory?: () => Promise<unknown>
    estimate?: () => Promise<{ quota?: number }>
  }
}

function nav(): NavigatorStorage | undefined {
  return (globalThis as { navigator?: unknown }).navigator as NavigatorStorage | undefined
}

function idbFactory(): RawIdb | undefined {
  const factory = (globalThis as { indexedDB?: unknown }).indexedDB as RawIdb | undefined
  return factory && typeof factory.open === 'function' ? factory : undefined
}

/**
 * The backend this runtime actually offers, memoised.
 * OPFS first (real files, no per-record overhead), then IndexedDB, then "off".
 */
export async function byteStoreBackend(): Promise<TmcutByteCacheBackend> {
  if (probedBackend) return probedBackend
  const storage = nav()?.storage
  if (typeof storage?.getDirectory === 'function') {
    try {
      const root = await storage.getDirectory() as RawDirHandle
      cachedDir = await root.getDirectoryHandle(CACHE_DIR_NAME, { create: true })
      probedBackend = 'opfs'
      return probedBackend
    } catch {
      cachedDir = null
    }
  }
  if (idbFactory()) {
    probedBackend = 'idb'
    return probedBackend
  }
  probedBackend = 'none'
  return probedBackend
}

/** Forget the probe and the handles — used when the storage environment changes. */
export function resetByteStoreProbe(): void {
  probedBackend = null
  cachedDir = null
  cachedDb = null
}

/** Bytes the cache may hold: the device quota shared through the core law. */
export async function byteCacheBudget(): Promise<number> {
  const estimate = nav()?.storage?.estimate
  if (typeof estimate !== 'function') return byteCacheBudgetBytes(Number.NaN)
  try {
    return byteCacheBudgetBytes((await estimate()).quota ?? Number.NaN)
  } catch {
    return byteCacheBudgetBytes(Number.NaN)
  }
}

function readIndex(): ByteIndex {
  const raw = readStored(INDEX_STORAGE_KEY)
  const index: ByteIndex = new Map()
  if (!raw) return index
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<TmcutByteIndexRow>>
    for (const [key, row] of Object.entries(parsed ?? {})) {
      if (!isStoredByteCacheKey(key) || !row) continue
      index.set(key, {
        bytes: Number.isFinite(row.bytes) && Number(row.bytes) > 0 ? Number(row.bytes) : 0,
        accessedAt: Number.isFinite(row.accessedAt) ? Number(row.accessedAt) : 0
      })
    }
    return index
  } catch {
    return index
  }
}

function writeIndex(index: ByteIndex): void {
  writeStored(INDEX_STORAGE_KEY, JSON.stringify(Object.fromEntries(index)))
}

/**
 * One row, written against whatever the index holds at this moment.
 *
 * A caller never hands back a whole snapshot. Two of them do overlap in a real
 * session — the media panel reads a revision while an import stores the one it
 * just took — and a snapshot carries the state of the moment it opened: the
 * later write forgets the earlier row and leaves its bytes behind as a file no
 * index names, which nothing can read and the next reconcile then frees.
 */
function touchIndexRow(key: string, row: TmcutByteIndexRow): void {
  const index = readIndex()
  index.set(key, row)
  writeIndex(index)
}

/** Stop naming one row; a row the index already does not name needs no write. */
function forgetIndexRow(key: string): void {
  const index = readIndex()
  if (!index.has(key)) return
  index.delete(key)
  writeIndex(index)
}

function indexEntries(index: ByteIndex) {
  return [...index].map(([key, row]) => ({ key, bytes: row.bytes, accessedAt: row.accessedAt }))
}

/** Every revision the index says is cached. Cheap: the index is the authority. */
export function cachedByteKeys(): Set<string> {
  return new Set(readIndex().keys())
}

async function opfsDir(): Promise<RawDirHandle> {
  if (cachedDir) return cachedDir
  const root = await nav()?.storage?.getDirectory?.() as RawDirHandle
  cachedDir = await root.getDirectoryHandle(CACHE_DIR_NAME, { create: true })
  return cachedDir
}

/**
 * One OPFS operation, retried once against a fresh directory handle.
 * A cache directory the browser reclaimed leaves the memoised handle pointing
 * at nothing; without this the store would stay dead for the whole session.
 */
async function opfsRun<T>(work: (dir: RawDirHandle) => Promise<T>): Promise<T> {
  const dir = await opfsDir()
  try {
    return await work(dir)
  } catch (error) {
    if (cachedDir === dir) cachedDir = null
    try {
      return await work(await opfsDir())
    } catch {
      throw error
    }
  }
}

function idbRequest<T>(request: RawRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB request failed'))
  })
}

/** The one object store the cache uses, created on the first open. */
function idbStore(): Promise<RawObjectStore> {
  if (cachedDb) return cachedDb
  const factory = idbFactory()
  if (!factory) return Promise.reject(new Error('indexedDB unavailable'))
  cachedDb = new Promise<RawObjectStore>((resolve, reject) => {
    const request = factory.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result as {
        objectStoreNames: { contains: (name: string) => boolean }
        createObjectStore: (name: string, options: { keyPath: string }) => unknown
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'key' })
    }
    request.onsuccess = () => {
      const db = request.result as { transaction: (name: string, mode?: string) => { objectStore: (name: string) => RawObjectStore } }
      resolve(db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME))
    }
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'))
  }).catch((error) => {
    cachedDb = null
    throw error
  })
  return cachedDb
}

/** Names of the files/records the backend really holds. */
async function listStoredKeys(backend: TmcutByteCacheBackend): Promise<Set<string>> {
  const found = new Set<string>()
  if (backend === 'opfs') {
    const names = await opfsRun(async (dir) => {
      const out: string[] = []
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'file') out.push(name)
      }
      return out
    })
    for (const name of names) found.add(name)
    return found
  }
  if (backend === 'idb') {
    for (const key of await idbRequest((await idbStore()).getAllKeys())) {
      if (typeof key === 'string') found.add(key)
    }
  }
  return found
}

async function deleteStored(backend: TmcutByteCacheBackend, key: string): Promise<void> {
  try {
    if (backend === 'opfs') await opfsRun(dir => dir.removeEntry(key))
    else if (backend === 'idb') await idbRequest((await idbStore()).delete(key))
  } catch {
    // Already gone: the index row is what matters, and the caller drops it.
  }
}

/**
 * Copy one revision — or one artifact of a revision — into the browser store.
 * Returns false — never throws — when the cache is off, the key names neither,
 * or the bytes are bigger than the whole budget. An import that cannot be cached
 * is still an import that worked.
 */
export async function putCachedBytes(key: string, blob: Blob, liveKeys: Set<string>): Promise<boolean> {
  if (!isStoredByteCacheKey(key) || !blob || blob.size <= 0) return false
  const backend = await byteStoreBackend()
  if (backend === 'none') return false
  const budget = await byteCacheBudget()
  if (!byteCacheFits(blob.size, budget)) return false

  try {
    if (backend === 'opfs') {
      await opfsRun(async (dir) => {
        const handle = await dir.getFileHandle(key, { create: true })
        const writable = await handle.createWritable()
        await writable.write(blob)
        await writable.close()
      })
    } else {
      await idbRequest((await idbStore()).put({ key, blob }))
    }
  } catch {
    forgetIndexRow(key)
    return false
  }
  // The row is written from what the browser took, after it took it: OPFS
  // truncates the file the moment the writable opens, so a row named before the
  // copy would advertise bytes the reader finds missing — and an empty read is
  // a worse answer than no row at all.
  touchIndexRow(key, { bytes: blob.size, accessedAt: Date.now() })

  const plan = planByteCacheEviction(indexEntries(readIndex()), budget, liveKeys)
  for (const doomed of [...plan.drop, ...plan.invalid]) {
    await deleteStored(backend, doomed)
    forgetIndexRow(doomed)
  }
  return true
}

/** The cached bytes one revision or one of its artifacts, or null. A row that cannot be served is dropped. */
export async function readCachedBytes(key: string): Promise<Blob | null> {
  if (!isStoredByteCacheKey(key)) return null
  const backend = await byteStoreBackend()
  if (backend === 'none') return null
  const index = readIndex()
  // A row the index does not name answers no reader, but the bytes may still be
  // on their way: only the reconcile pass decides to free them.
  if (!index.has(key)) return null
  try {
    const blob = backend === 'opfs'
      ? await opfsRun(async dir => (await dir.getFileHandle(key)).getFile())
      : await idbStore().then(store => idbRequest(store.get(key))).then(record => record?.blob)
    // Empty bytes are not a revision, however the row was written: a copy that
    // died halfway leaves a file of nothing, and drawing it as cached is how a
    // broken cache becomes permanent.
    if (!blob || blob.size === 0) throw new Error('no bytes behind the index row')
    // The index row is written from the browser's answer, not from the size the
    // caller handed over, so what the panel reports is what the file really is.
    touchIndexRow(key, { bytes: blob.size, accessedAt: Date.now() })
    return blob
  } catch {
    forgetIndexRow(key)
    return null
  }
}

/**
 * Free what the library no longer references and what no longer fits.
 * Reconciles the index against the backend first, in both directions, so a
 * relink, a delete or a browser reclaim cannot leave a lying row or an
 * unreachable file behind.
 */
export async function pruneByteCache(liveKeys: Set<string>): Promise<{ dropped: number, kept: number }> {
  const backend = await byteStoreBackend()
  if (backend === 'none') return { dropped: 0, kept: 0 }
  const index = readIndex()
  let stored: Set<string>
  try {
    stored = await listStoredKeys(backend)
  } catch (error) {
    // A store that cannot be listed cannot be judged: free nothing this pass
    // rather than drop rows whose files may still be there.
    console.error('Byte cache reconcile skipped:', error)
    return { dropped: 0, kept: index.size }
  }
  let dropped = 0

  for (const key of [...index.keys()]) {
    if (stored.has(key)) continue
    index.delete(key)
    forgetIndexRow(key)
    dropped += 1
  }
  for (const key of stored) {
    if (index.has(key)) continue
    await deleteStored(backend, key)
    dropped += 1
  }

  const budget = await byteCacheBudget()
  const plan = planByteCacheEviction(indexEntries(index), budget, liveKeys)
  for (const key of plan.drop) {
    await deleteStored(backend, key)
    index.delete(key)
    forgetIndexRow(key)
    dropped += 1
  }
  return { dropped, kept: plan.keep.length }
}

/** What the media panel shows: how much is cached and whether the store is on. */
export async function byteCacheInfo(): Promise<TmcutByteCacheInfo> {
  const backend = await byteStoreBackend()
  const entries = [...readIndex().values()]
  return {
    backend,
    available: backend !== 'none',
    entries: entries.length,
    usedBytes: entries.reduce((total, row) => total + row.bytes, 0),
    budgetBytes: await byteCacheBudget()
  }
}

/** The "Clear cache" control: every cached byte and every index row. */
export async function clearCachedBytes(): Promise<void> {
  const backend = await byteStoreBackend()
  try {
    if (backend === 'opfs') {
      for (const name of [...await listStoredKeys(backend)]) await deleteStored(backend, name)
    } else if (backend === 'idb') {
      await idbRequest((await idbStore()).clear())
    }
  } catch (error) {
    console.error('Byte cache clear left bytes behind:', error)
  }
  // The index is the authority on what the cache names, so it goes empty even
  // when the backend refused the delete: nothing unreachable is ever read back.
  writeIndex(new Map())
}
