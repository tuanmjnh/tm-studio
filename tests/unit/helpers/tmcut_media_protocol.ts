/**
 * The desktop host's two answers, doubled for a plain Node run.
 *
 * Slice I deleted the `analyzeAsset` IPC — the one FFmpeg round-trip that also
 * wrote the cover, filmstrip and waveform — so the app demuxes on both hosts
 * through MediaProbeService. On desktop the bytes arrive over the privileged
 * `media://local` protocol, which the real Electron main serves with ranged 206s
 * (`electron/media-protocol.cjs`, proven by `tests/e2e/electron_media_probe.cjs`).
 * Node's fetch knows no custom schemes, so without the double below mediabunny's
 * UrlSource retries `unknown scheme` forever instead of probing: the suite hangs
 * rather than fails. The double answers the protocol, not the probe.
 *
 * The bridge fake deliberately exposes no `analyzeAsset`: a fake for a deleted
 * channel would let the app quietly grow the call back.
 */

export interface MediaProtocol {
  /** Registered paths, keyed the way `toURL()` encodes them: forward slashes. */
  files: Map<string, Uint8Array>
  state: { firstFetchCount: number, fetches: number, partial: number }
  mtimeMs: number
  restore: () => void
}

/**
 * Registered paths answer ranged bytes exactly as the real handler does;
 * anything else answers the 404 it returns for a file that is not there. Every
 * other scheme passes through to the real fetch, so a web leg's loopback server
 * keeps answering for itself.
 */
export function installMediaProtocol(media: { assets: { value: unknown[] } }): MediaProtocol {
  const files = new Map<string, Uint8Array>()
  const state = { firstFetchCount: 0, fetches: 0, partial: 0 }
  const realFetch = globalThis.fetch
  const protocol: MediaProtocol = {
    files,
    state,
    mtimeMs: 1700000500000,
    restore() { globalThis.fetch = realFetch }
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith('media://local')) return realFetch(input as RequestInfo, init)
    state.fetches++
    // The batch rule, measured where the bytes are actually asked for: when the
    // first probe starts, the whole queue is already in the library.
    if (state.firstFetchCount === 0) state.firstFetchCount = media.assets.value.length
    const filePath = decodeURIComponent(new URL(url).searchParams.get('file') ?? '').replace(/\\/g, '/')
    const bytes = files.get(filePath)
    if (!bytes) return new Response(`File not found: ${filePath}`, { status: 404 })
    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
      'accept-ranges': 'bytes'
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(new Headers(init?.headers).get('range') ?? '')
    if (range && (range[1] !== '' || range[2] !== '')) {
      const start = range[1] === '' ? Math.max(0, bytes.byteLength - Number(range[2])) : Number(range[1])
      const end = range[2] === '' || range[1] === '' ? bytes.byteLength - 1 : Number(range[2])
      state.partial++
      headers['content-length'] = String(end - start + 1)
      headers['content-range'] = `bytes ${start}-${end}/${bytes.byteLength}`
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers })
    }
    headers['content-length'] = String(bytes.byteLength)
    return new Response(bytes, { status: 200, headers })
  }) as typeof fetch
  return protocol
}

export interface DesktopIpc {
  statCalls: number
  throwOnStat: boolean
  writes: Record<string, unknown>[][]
  window: Record<string, unknown>
}

/**
 * A stand-in for the preload bridge and `electron/tools/tmcut.controller.cjs`,
 * answering only what the host still owns: the byte stat, the registry write and
 * the project's debounced disk writes. `statFiles` reads the same registry the
 * protocol serves, so a path with no bytes is `exists: false` — the verdict the
 * real host gives, and the one that must settle a dead path before any fetch.
 */
export function installDesktopIpc(protocol: MediaProtocol): DesktopIpc {
  const writes: Record<string, unknown>[][] = []
  const state: DesktopIpc = {
    statCalls: 0,
    throwOnStat: false,
    writes,
    window: {}
  }
  state.window.electronAPI = {
    tmcut: {
      async statFiles(paths: string[]) {
        state.statCalls++
        if (state.throwOnStat) throw new Error('ipc channel closed')
        const out: Record<string, { exists: boolean, size: number, mtimeMs: number }> = {}
        for (const path of paths) {
          const bytes = protocol.files.get(path.replace(/\\/g, '/'))
          out[path] = bytes
            ? { exists: true, size: bytes.byteLength, mtimeMs: protocol.mtimeMs }
            : { exists: false, size: 0, mtimeMs: 0 }
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
