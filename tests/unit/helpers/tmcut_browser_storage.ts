/**
 * The two browser byte stores, faked well enough that the real
 * `app/utils/tmcut/byteStore.ts` runs in plain Node.
 *
 * Slice C2b was the first user; slice D is the second (the frame service reads
 * the cached bytes back, so it needs a cache that really holds a file). Keeping
 * the fakes here means one definition of "what the browser offers" instead of
 * two that can quietly stop agreeing about OPFS semantics.
 *
 * The shims are installed on `globalThis`, so a check picks its runtime by
 * calling one of the `install*` functions and then resetting the store's probe.
 */

const INDEX_STORAGE_KEY = 'tmcut_byte_index_v1'
const CACHE_DIR_NAME = 'tmcut-bytes'

/** Deterministic bytes: same size and seed means the same content. */
export function blobOf(size: number, seed = 'x'): Blob {
  return new Blob([new Uint8Array(size).fill(seed.charCodeAt(0) & 0xff)])
}

// ---------------------------------------------------------------------------
// A fake OPFS: one directory of files, exactly the handles the store uses.
// ---------------------------------------------------------------------------

type FakeFile = { kind: 'file', name: string, blob: Blob }
type FakeDir = { kind: 'directory', name: string, children: Map<string, FakeNode>, detached?: boolean }
type FakeNode = FakeFile | FakeDir

function notFound(name: string): Error {
  const error = new Error(`NotFoundError: ${name}`) as Error & { name: string }
  error.name = 'NotFoundError'
  return error
}

function fakeDirectory(name: string): FakeDir {
  return { kind: 'directory', name, children: new Map<string, FakeNode>() }
}

function fileHandleOf(node: FakeFile, reads?: () => Promise<void>, writes?: () => Promise<void>) {
  return {
    kind: 'file' as const,
    name: node.name,
    async getFile() {
      // A read the check controls: the browser takes a moment to hand the file
      // over, and anything the caller read from the index before that moment is
      // already history by the time it lands.
      if (reads) await reads()
      return node.blob
    },
    async createWritable() {
      // OPFS truncates the file the moment the writable opens, so a reader that
      // looks while a write is in flight really does see zero bytes.
      node.blob = new Blob([])
      let pending = node.blob
      return {
        async write(value: Blob | ArrayBuffer) {
          if (writes) await writes()
          pending = value instanceof Blob ? value : new Blob([value])
        },
        async close() {
          node.blob = pending
        }
      }
    }
  }
}

function directoryHandleOf(dir: FakeDir, reads?: () => Promise<void>, writes?: () => Promise<void>) {
  // A directory the browser reclaimed keeps no files: a handle to it must fail,
  // exactly as a detached OPFS handle does.
  const live = <T>(run: () => T): T => {
    if (dir.detached) throw notFound(dir.name || 'cache')
    return run()
  }
  return {
    kind: 'directory',
    name: dir.name,
    async getDirectoryHandle(childName: string, options: { create?: boolean } = {}) {
      return live(() => {
        const existing = dir.children.get(childName)
        if (existing && existing.kind === 'directory') return directoryHandleOf(existing, reads, writes)
        if (options.create) {
          const created = fakeDirectory(childName)
          dir.children.set(childName, created)
          return directoryHandleOf(created, reads, writes)
        }
        throw notFound(childName)
      })
    },
    async getFileHandle(fileName: string, options: { create?: boolean } = {}) {
      return live(() => {
        const existing = dir.children.get(fileName)
        if (existing && existing.kind === 'file') return fileHandleOf(existing, reads, writes)
        if (options.create) {
          const created: FakeFile = { kind: 'file', name: fileName, blob: new Blob([]) }
          dir.children.set(fileName, created)
          return fileHandleOf(created, reads, writes)
        }
        throw notFound(fileName)
      })
    },
    async removeEntry(target: string) {
      live(() => dir.children.delete(target))
    },
    async* entries() {
      if (dir.detached) return
      for (const [key, value] of [...dir.children]) {
        yield [key, value.kind === 'directory'
          ? directoryHandleOf(value, reads, writes)
          : fileHandleOf(value, reads, writes)] as [string, unknown]
      }
    }
  }
}

export type OpfsHandle = {
  /** File names currently held inside the cache directory. */
  keys: () => string[]
  /** Bytes actually on the fake disk for one name; 0 when it is not there. */
  bytes: (name: string) => number
  /** The browser reclaimed the whole directory: the index now lies. */
  dropAll: () => void
  /** The cache dir is deleted, but one orphan file is placed in it. */
  writeOrphan: (name: string, size: number) => Promise<void>
}

let lastOpfs: OpfsHandle | undefined

/**
 * `holdReadsFor` is awaited before the browser hands a file over and
 * `holdWritesFor` before a write lands, which is how a check makes two callers
 * really overlap instead of hoping the microtask queue happens to interleave them.
 */
export function installOpfs(quotaBytes: number, options: { holdReadsFor?: () => Promise<void>, holdWritesFor?: () => Promise<void> } = {}): OpfsHandle {
  const g = globalThis as Record<string, unknown>
  const rootDir = fakeDirectory('')
  const quota = quotaBytes
  const reads = options.holdReadsFor
  const writes = options.holdWritesFor

  const cacheDir = (): FakeDir | undefined => {
    const cache = rootDir.children.get(CACHE_DIR_NAME)
    return cache && cache.kind === 'directory' ? cache : undefined
  }

  const navigator_ = {
    userAgent: 'node',
    storage: {
      async getDirectory() {
        return directoryHandleOf(rootDir, reads, writes)
      },
      async estimate() {
        const files = cacheDir()?.children.values() ?? []
        let usage = 0
        for (const node of files) if (node.kind === 'file') usage += node.blob.size
        return { quota, usage }
      }
    }
  }
  Object.defineProperty(g, 'navigator', { value: navigator_, configurable: true, writable: true })

  const handle: OpfsHandle = {
    keys: () => [...cacheDir()?.children.keys() ?? []],
    bytes: (name: string) => cacheDir()?.children.get(name)?.kind === 'file'
      ? (cacheDir()!.children.get(name) as FakeFile).blob.size
      : 0,
    dropAll: () => {
      const cache = rootDir.children.get(CACHE_DIR_NAME)
      if (cache && cache.kind === 'directory') cache.detached = true
      rootDir.children.delete(CACHE_DIR_NAME)
    },
    writeOrphan: async (name: string, size: number) => {
      const dir = await directoryHandleOf(rootDir, reads, writes)
        .getDirectoryHandle(CACHE_DIR_NAME, { create: true })
      const file = await dir.getFileHandle(name, { create: true })
      const writable = await file.createWritable()
      await writable.write(blobOf(size, 'o'))
      await writable.close()
    }
  }
  lastOpfs = handle
  return handle
}

/** The OPFS the current check installed, for flows that do not hold the handle. */
export function opfsLive(): OpfsHandle {
  if (!lastOpfs) throw new Error('no OPFS installed for this check')
  return lastOpfs
}

/** No OPFS, no IndexedDB: the runtime the store must live with. */
export function installNoStorage() {
  const g = globalThis as Record<string, unknown>
  Object.defineProperty(g, 'navigator', { value: { userAgent: 'node' }, configurable: true, writable: true })
  Object.defineProperty(g, 'indexedDB', { value: undefined, configurable: true, writable: true })
}

/** No OPFS, IndexedDB only: the fallback path. */
export function installIdbOnly(): IdbHandle {
  const g = globalThis as Record<string, unknown>
  Object.defineProperty(g, 'navigator', { value: { userAgent: 'node' }, configurable: true, writable: true })
  return installIdb()
}

// ---------------------------------------------------------------------------
// A fake IndexedDB: one object store per database, the calls the store makes.
// ---------------------------------------------------------------------------

type IdbRecord = { key: string, blob: Blob }

export type IdbHandle = { keys: () => string[], bytes: (key: string) => number }

function requestFor<T>(result: T) {
  const request = {
    result,
    error: null as Error | null,
    onsuccess: null as ((() => void) | null),
    onerror: null as ((() => void) | null)
  }
  queueMicrotask(() => request.onsuccess?.())
  return request
}

export function installIdb(): IdbHandle {
  const g = globalThis as Record<string, unknown>
  const records = new Map<string, IdbRecord>()
  // Per database name, so a second `open` of the same DB sees the store it
  // created on the first upgrade — the way a real browser does.
  const stores = new Map<string, Set<string>>()
  const factory = {
    open(name: string) {
      const isNew = !stores.has(name)
      if (isNew) stores.set(name, new Set<string>())
      const db = {
        name,
        objectStoreNames: { contains: (store: string) => stores.get(name)?.has(store) ?? false },
        createObjectStore: (store: string) => {
          stores.get(name)?.add(store)
          return {}
        },
        transaction: () => ({
          objectStore: (store: string) => {
            if (!stores.get(name)?.has(store)) throw new Error(`NotFoundError: ${store}`)
            return {
              put: (record: IdbRecord) => {
                records.set(record.key, record)
                return requestFor(undefined)
              },
              get: (key: string) => requestFor(records.get(key)),
              delete: (key: string) => {
                records.delete(key)
                return requestFor(undefined)
              },
              getAllKeys: () => requestFor([...records.keys()]),
              clear: () => {
                records.clear()
                return requestFor(undefined)
              }
            }
          },
          get done() {
            return Promise.resolve()
          }
        }),
        close: () => {}
      }
      const request = {
        result: db as unknown,
        error: null as Error | null,
        onupgradeneeded: null as ((() => void) | null),
        onsuccess: null as ((() => void) | null),
        onerror: null as ((() => void) | null)
      }
      queueMicrotask(() => {
        if (isNew) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
    deleteDatabase: (name: string) => {
      stores.delete(name)
      for (const key of [...records.keys()]) records.delete(key)
      return requestFor(undefined)
    }
  }
  Object.defineProperty(g, 'indexedDB', { value: factory, configurable: true, writable: true })
  return {
    keys: () => [...records.keys()],
    bytes: (key: string) => records.get(key)?.blob.size ?? 0
  }
}

// ---------------------------------------------------------------------------
// The byte cache's localStorage index: a check may plant a lie in it.
// ---------------------------------------------------------------------------

export type ByteIndexRow = { bytes: number, accessedAt: number }

export function clearByteIndex() {
  globalThis.localStorage?.removeItem(INDEX_STORAGE_KEY)
}

export function readByteIndex(): Record<string, ByteIndexRow> {
  const raw = globalThis.localStorage?.getItem(INDEX_STORAGE_KEY)
  return raw ? JSON.parse(String(raw)) as Record<string, ByteIndexRow> : {}
}

export function writeByteIndex(rows: Record<string, ByteIndexRow>) {
  globalThis.localStorage?.setItem(INDEX_STORAGE_KEY, JSON.stringify(rows))
}
