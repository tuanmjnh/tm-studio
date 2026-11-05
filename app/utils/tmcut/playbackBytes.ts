/**
 * Playback bytes (zero-FFmpeg slice G4b, ADR-033).
 *
 * The client cache has held a second copy of every imported revision since C2b, and
 * three readers have been using it — frames (D2), waveforms (G2), silence (E4). The
 * one left out is the one the user hears: the preview asked the server for the file
 * on every play (`GET /uploads/… [206]`, measured in the route sweep). This module is
 * the host seam that closes that half: it turns core's answer into a real `blob:`
 * URL and hands the URL back when no surface wants it.
 *
 * The two decisions are core's, not duplicated here — `planPlaybackByteSource` says
 * whether a revision plays from the cache, from the stream or from nothing, and
 * `planBlobUrlLifecycle` says which URLs to create, keep and revoke. What lives here
 * is the IO around them, and four facts the browser forces:
 *
 *  * A revision is mounted by several surfaces at once — a clip's footage plate and
 *    its `<audio>` element are the same file. The ledger is keyed by revision, so one
 *    read serves every mount and unmounting one surface cannot silence another.
 *  * Reading is async, playback is not: a surface asks synchronously and gets the
 *    stream URL until the bytes land. The ledger therefore belongs to the host
 *    (`ledger`/`setLedger`) rather than to this module — a host that keeps it in a
 *    `shallowRef` re-renders the swap, and nothing here has to know about Vue.
 *  * The index can name bytes the store no longer has (a browser reclaim). A read
 *    that returns nothing is a stream, not a broken clip.
 *  * A read is slower than a scrub: a URL made for a revision that already left the
 *    screen is named by nothing and revoked by nobody.
 */
import { planBlobUrlLifecycle, planPlaybackByteSource } from 'tmcut-core'
import { cachedByteKeys, readCachedBytes } from './byteStore'

export interface TmcutPlaybackBytesDeps {
  /** The media library's answer: which revision one stored src points at. */
  fingerprintFor: (src: string) => string | null | undefined
  /** Where the host keeps `revision -> object url`. Replaced whole on every change. */
  ledger: () => Record<string, string>
  setLedger: (next: Record<string, string>) => void
  /** Overridable so the seam runs in tests and on a host with its own store. */
  cachedKeys?: () => Set<string>
  readBytes?: (key: string) => Promise<Blob | null>
  createUrl?: (bytes: Blob) => string
  revokeUrl?: (url: string) => void
}

export interface TmcutPlaybackBytes {
  /** The src one surface should mount now: its blob once held, else the stream. */
  srcFor: (src: string, streamUrl: string) => string
  /** Reconcile the ledger against the revisions currently on screen. */
  sync: (wantedSrcs: Iterable<string>) => Promise<void>
  /** Give every URL back (leaving the preview, switching project). */
  releaseAll: () => void
}

/** One index read per reconciliation, not one per surface per render pass. */
function cachedSet(keys: () => Set<string>): Set<string> {
  try {
    return keys()
  } catch {
    // A storage layer the browser refused (private mode, quota pressure) is a cache
    // with nothing in it — playback still runs off the stream.
    return new Set()
  }
}

export function createPlaybackBytes(deps: TmcutPlaybackBytesDeps): TmcutPlaybackBytes {
  const cachedKeys = deps.cachedKeys ?? cachedByteKeys
  const readBytes = deps.readBytes ?? readCachedBytes
  const createUrl = deps.createUrl ?? ((bytes: Blob) => URL.createObjectURL(bytes))
  const revokeUrl = deps.revokeUrl ?? ((url: string) => URL.revokeObjectURL(url))

  /** Reads still running, so two passes over one revision make one OPFS read. */
  const inflight = new Map<string, Promise<void>>()
  /** What the last `sync` decided is on screen; a landed read checks this first. */
  let wanted = new Set<string>()

  function revisionOf(src: string): string | null {
    try {
      return deps.fingerprintFor(src) ?? null
    } catch {
      return null
    }
  }

  function hold(key: string, url: string): void {
    deps.setLedger({ ...deps.ledger(), [key]: url })
  }

  function start(key: string): Promise<void> {
    const running = inflight.get(key)
    if (running) return running
    const job = (async () => {
      let bytes: Blob | null
      try {
        bytes = await readBytes(key)
      } catch {
        bytes = null
      }
      // The revision may have left the screen while this read was running, and a url
      // made for it would be named by nothing and revoked by nobody.
      if (!bytes || !wanted.has(key)) return
      hold(key, createUrl(bytes))
    })()
    inflight.set(key, job)
    job.catch(() => undefined).finally(() => inflight.delete(key))
    return job
  }

  return {
    srcFor(src, streamUrl) {
      const key = revisionOf(src)
      const url = key ? deps.ledger()[key] : undefined
      return url || streamUrl
    },

    async sync(wantedSrcs) {
      const cached = cachedSet(cachedKeys)
      const next = new Set<string>()
      for (const src of wantedSrcs) {
        const key = revisionOf(src)
        if (!key) continue
        // Core owns the refusal: a waveform key, an illegal digest or a revision the
        // store does not have is not a playback source, whatever this map says.
        const plan = planPlaybackByteSource({ fingerprint: key, cached: cached.has(key) })
        if (plan.kind === 'cache') next.add(key)
      }
      wanted = next

      const lifecycle = planBlobUrlLifecycle(deps.ledger(), next)
      if (lifecycle.revoke.length > 0) {
        const freed = new Set(lifecycle.revoke.map(row => row.key))
        const kept: Record<string, string> = {}
        for (const [key, url] of Object.entries(deps.ledger())) {
          if (!freed.has(key)) kept[key] = url
        }
        for (const row of lifecycle.revoke) revokeUrl(row.url)
        deps.setLedger(kept)
      }
      await Promise.all(lifecycle.create.map(start))
    },

    releaseAll() {
      wanted = new Set()
      const held = deps.ledger()
      for (const url of Object.values(held)) revokeUrl(url)
      // An empty ledger is written empty: waking the host to change nothing is a
      // re-render for no reason.
      if (Object.keys(held).length > 0) deps.setLedger({})
      inflight.clear()
    }
  }
}
