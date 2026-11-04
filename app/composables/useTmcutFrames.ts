/**
 * The frame legs the app uses (roadmap G-1/R42, zero-FFmpeg slice D).
 *
 * Two of them go through the shared pipeline (`~/utils/tmcut/frameStore` plus
 * `frameStrip`): a batch of instants and a per-clip filmstrip. Both hosts run
 * them — core plans the timestamps, the client byte cache supplies the bytes,
 * one decoder pool bounds the work — so a web session gets thumbnails for the
 * first time and Electron has no second answer to the same question. Both hand
 * back `blob:` object URLs, ready for `src`.
 *
 * The third leg is the desktop HUD snapshot, and it stays IPC: that button
 * reports the FILE it saved, which only the main process can hand out.
 * `available` lets the control hide itself on web instead of shipping dead.
 */

import { tmcutHostIpc } from '~/utils/tmcut/hostBridge'
import { frameService, requestFrame } from '~/utils/tmcut/frameStore'
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
  const available = computed(() => !!tmcutHostIpc())

  /** Desktop only: an FFmpeg cache file path, for controls that name a file. */
  async function extractFrame(src: string, atSec: number, width = 320): Promise<string | null> {
    const ipc = tmcutHostIpc()
    if (!ipc || !src || !Number.isFinite(atSec)) return null
    try {
      const result = await ipc.extractFrame({ src, atSec, width })
      return result?.ok && result.path ? result.path : null
    } catch {
      return null
    }
  }

  /**
   * One instant per entry, asked through the shared service. The pool core
   * names decides how many decoders run, so a caller asking for a hundred
   * stills and a caller asking for one pay the same concurrency.
   */
  async function extractFrames(jobs: TmcutFrameJob[]): Promise<Map<string | number, string>> {
    const frames = new Map<string | number, string>()
    if (jobs.length === 0) return frames
    const urls = await Promise.all(jobs.map(job => requestFrame({
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
