/**
 * The frame legs the app uses (roadmap G-1/R42, zero-FFmpeg slice D).
 *
 * Every leg goes through the shared pipeline (`~/utils/tmcut/frameStore` plus
 * `frameStrip`): a batch of instants, a per-clip filmstrip, and the single
 * snapshot the HUD takes. Both hosts run them — core plans the timestamps, the
 * client byte cache supplies the bytes, one decoder pool bounds the work — so
 * a web session gets thumbnails for the first time and Electron has no second
 * answer to the same question. All three hand back `blob:` object URLs, ready
 * for `src` or a download.
 *
 * The snapshot used to be IPC because the FFmpeg leg reported the cache FILE
 * it wrote. Slice I deleted that leg; the frame now arrives as an object URL,
 * so the control is available on both hosts instead of hiding on web.
 */

import { canDecodeFrames, frameService, requestFrameBatch } from '~/utils/tmcut/frameStore'
import { createStripReader } from '~/utils/tmcut/frameStrip'
import type { TmcutStripAsk } from '~/utils/tmcut/frameStrip'

export interface TmcutFrameJob {
  id: string | number
  /** The C1 revision fingerprint; with no fingerprint there is no frame. */
  fingerprint: string | null | undefined
  /** Where to read when the client cache holds no copy. */
  src: string
  atSec: number
  width?: number
  durationSec?: number | null
  /** Who owns the ask; a re-run under the same slot retires the older one. */
  slot?: string
}

// One reader for the session, so every clip's slots live in one ledger and a
// copy of the same clip re-asks the same instants instead of opening decoders.
const clipStripReader = createStripReader(frameService)

export function useTmcutFrames() {
  // Kept as a name callers already branch on; every host can now answer, so it
  // reports the runtime's capability rather than the presence of a desktop IPC.
  const available = computed(() => canDecodeFrames())

  /**
   * One instant for the HUD snapshot. `fingerprint` is what the cache and the
   * dedup ledger are keyed by, so a still of a revision already decoded is not
   * decoded twice.
   *
   * A batch of one, not a single ask: the snapshot is shown once and nobody
   * re-asks under its slot, so the slot has to come back with the answer. The
   * long-lived `request` leg keeps its slot until `forget`/`dispose`, which for a
   * one-shot would track one slot per distinct instant for the whole session.
   */
  async function extractFrame(
    src: string,
    atSec: number,
    width = 320,
    fingerprint?: string | null,
    durationSec?: number | null
  ): Promise<string | null> {
    if (!src || !Number.isFinite(atSec)) return null
    const [url] = await requestFrameBatch([{
      slot: `snapshot:${src}:${atSec}:${width}`,
      fingerprint: fingerprint ?? null,
      src,
      atSec,
      width,
      durationSec
    }])
    return url ?? null
  }

  /**
   * One instant per entry, asked through the shared service. The pool core
   * names decides how many decoders run, so a caller asking for a hundred
   * stills and a caller asking for one pay the same concurrency.
   *
   * A batch is the service's batch leg, not a loop of single asks: the slots
   * these jobs were asked under are handed back as soon as the answers land.
   * Frame-by-frame asks would leave one tracked slot per job forever, and a
   * losing batch would have no way to tell whose slot it was releasing.
   */
  async function extractFrames(jobs: TmcutFrameJob[]): Promise<Map<string | number, string>> {
    const frames = new Map<string | number, string>()
    if (jobs.length === 0) return frames
    const urls = await requestFrameBatch(jobs.map(job => ({
      slot: job.slot ?? `batch:${job.id}`,
      fingerprint: job.fingerprint,
      atSec: job.atSec,
      width: job.width,
      durationSec: job.durationSec,
      src: job.src
    })))
    jobs.forEach((job, index) => {
      const url = urls[index]
      if (url) frames.set(job.id, url)
    })
    return frames
  }

  /**
   * Per-clip timeline filmstrip (roadmap G-1/R42): `count` stills sampled from
   * the clip's own source range. All the law — which instants, which slot, who
   * may paint, what happens to a dead frame — lives in `frameStrip.ts`.
   */
  function clipFilmstrip(ask: TmcutStripAsk): Promise<string[]> {
    return clipStripReader.read(ask)
  }

  /** The clip left the timeline: its pending asks stop costing decoder time. */
  function forgetStrip(clipKey: string): number {
    return clipStripReader.forget(clipKey)
  }

  return { available, extractFrame, extractFrames, clipFilmstrip, forgetStrip }
}
