/**
 * Playback byte source (zero-FFmpeg slice G4b, ADR-033).
 *
 * ADR-033 let the server become storage only: the browser keeps its own copy of
 * every imported revision, and slices D2/G2/E4 already read that copy for
 * frames, waveforms and silence. Playback was the half still asking the server
 * (`GET /uploads/… [206]` on every play, measured in the route sweep). This
 * composable is where that change becomes visible to the preview: it owns the
 * `revision -> blob:` ledger and hands it to the seam in
 * `~/utils/tmcut/playbackBytes`, which reads the bytes and makes the URLs.
 *
 * The ledger is a `shallowRef` holding a NEW record on every change, and that is
 * the whole reason it lives here rather than inside the seam: a surface reads
 * its src in a `computed`, so the arrival of a blob has to be a reactive write
 * or the clip keeps the stream URL it first asked for and the slice silently
 * does nothing. `shallowRef` (not `ref`) because the record's keys are revisions
 * and its values are opaque strings — deep reactivity over both buys nothing.
 *
 * One ledger for the session, keyed by revision: the same file mounted by the
 * footage plate, the `<audio>` element and a second clip is ONE read and ONE
 * url. The player's `releaseAll` on unmount is what makes that safe to keep
 * beyond one preview.
 */
import { createPlaybackBytes } from '~/utils/tmcut/playbackBytes'
import type { TmcutPlaybackBytes } from '~/utils/tmcut/playbackBytes'
import { useTmcutMedia } from '~/composables/useTmcutMedia'

type PlaybackBytesLedger = Record<string, string>

const urls = shallowRef<PlaybackBytesLedger>({})

/** Built on first use, in a component context: the fingerprint answer is the media library's. */
let seam: TmcutPlaybackBytes | null = null

function getSeam(): TmcutPlaybackBytes {
  if (seam) return seam
  const { findAssetBySrc } = useTmcutMedia()
  seam = createPlaybackBytes({
    // A clip stores its own path; the revision is the asset's fingerprint, which is
    // also the byte-cache key. No fingerprint (an unlinked or relink-pending asset)
    // means no cache answer for that src, whatever the index holds.
    fingerprintFor: src => findAssetBySrc(src)?.fingerprint ?? null,
    ledger: () => urls.value,
    setLedger: (next) => { urls.value = next }
  })
  return seam
}

export function useTmcutPlaybackBytes() {
  const bytes = getSeam()

  /**
   * The src one surface should mount: its blob once the bytes land, the stream URL
   * until then. `streamUrl` is what the host's engine already answered, so a
   * revision the cache does not name plays exactly as it did before this slice.
   */
  function srcFor(src: string | null | undefined, streamUrl: string): string {
    if (!src) return streamUrl
    return bytes.srcFor(src, streamUrl)
  }

  /** Reconcile the ledger with the revisions on screen (empty them out on unmount). */
  function sync(wantedSrcs: Iterable<string>): Promise<void> {
    if (!import.meta.client) return Promise.resolve()
    return bytes.sync(wantedSrcs)
  }

  function releaseAll(): void {
    if (!import.meta.client) return
    bytes.releaseAll()
  }

  return { urls, srcFor, sync, releaseAll }
}
