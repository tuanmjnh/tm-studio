/**
 * Single-frame extraction (roadmap G-1, core C14 plans the timestamps):
 * IPC to the Electron main process, which seeks FFmpeg and caches the PNG
 * per (path, mtime, size, time, width). Web sessions have no IPC — the
 * `available` flag lets callers hide controls instead of shipping dead
 * buttons, and every call resolves to null rather than throwing.
 *
 * All methods return cache FILE PATHS; run displayable values through
 * mediaUrl() / toURL (the privileged media:// protocol) before rendering.
 */

import { filmstripTimes, secToTicks, ticksToSec } from '@tmcut-core'

function tmcutIpc() {
  return typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
}

export interface TmcutFrameJob {
  id: string | number
  src: string
  atSec: number
  width?: number
}

// One bounded pool for ALL batches: N timeline clips mounting at once
// must not spawn N × 3 ffmpeg processes on the main side.
const MAX_CONCURRENT_FRAMES = 3
let activeFrameJobs = 0
const frameSlotWaiters: Array<() => void> = []

function acquireFrameSlot(): Promise<void> {
  return new Promise((resolve) => {
    const tryAcquire = () => {
      if (activeFrameJobs < MAX_CONCURRENT_FRAMES) {
        activeFrameJobs += 1
        resolve()
      } else {
        frameSlotWaiters.push(tryAcquire)
      }
    }
    tryAcquire()
  })
}

function releaseFrameSlot() {
  activeFrameJobs = Math.max(0, activeFrameJobs - 1)
  frameSlotWaiters.shift()?.()
}

// Session-level per-clip filmstrips: one entry per (src, in, out) shared
// across clip instances, so copies and remounts never re-extract. Keys are
// created after the caller's trim debounce, so drags do not flood them.
const clipStripCache = new Map<string, string[]>()
const clipStripInFlight = new Map<string, Promise<string[]>>()

export function useTmcutFrames() {
  const available = computed(() => !!tmcutIpc())

  async function extractFrame(src: string, atSec: number, width = 320): Promise<string | null> {
    const ipc = tmcutIpc()
    if (!ipc || !src || !Number.isFinite(atSec)) return null
    try {
      const result = await ipc.extractFrame({ src, atSec, width })
      return result?.ok && result.path ? result.path : null
    } catch {
      return null
    }
  }

  /** Bounded-concurrency batch extraction (segment thumbnail rows). */
  async function extractFrames(jobs: TmcutFrameJob[], concurrency = 3): Promise<Map<string | number, string>> {
    const frames = new Map<string | number, string>()
    if (!tmcutIpc() || jobs.length === 0) return frames
    let cursor = 0
    async function worker() {
      while (cursor < jobs.length) {
        const job = jobs[cursor]
        cursor += 1
        if (!job) continue
        await acquireFrameSlot()
        try {
          const frame = await extractFrame(job.src, job.atSec, job.width ?? 320)
          if (frame) frames.set(job.id, frame)
        } finally {
          releaseFrameSlot()
        }
      }
    }
    const workers = Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, () => worker())
    await Promise.all(workers)
    return frames
  }

  /**
   * Per-clip timeline filmstrip (roadmap G-1/R42): `count` frames across
   * the clip's own source range [inSec, outSec]. Timestamps come from core
   * C14 `filmstripTimes` (ticks) and cross the v1-seconds boundary here;
   * in/out are source time, so speed does not affect sampling. Failed
   * slots stay as '' so the layout keeps its positions — callers fall
   * back to the asset-level strip behind them.
   */
  async function clipFilmstrip(src: string, inSec: number, outSec: number, count = 8): Promise<string[]> {
    if (!src || !Number.isFinite(inSec) || !Number.isFinite(outSec) || outSec <= inSec) return []
    const key = `${src}|${Math.round(inSec * 1000)}|${Math.round(outSec * 1000)}`
    const cached = clipStripCache.get(key)
    if (cached) return cached
    const pending = clipStripInFlight.get(key)
    if (pending) return pending
    const times = filmstripTimes(secToTicks(inSec), secToTicks(outSec - inSec), count)
    if (times.length === 0) return []
    const jobs = times.map((time, index) => ({ id: index, src, atSec: ticksToSec(time), width: 160 }))
    const promise = extractFrames(jobs)
      .then((frames) => {
        const strip = times.map((_, index) => frames.get(index) ?? '')
        clipStripCache.set(key, strip)
        clipStripInFlight.delete(key)
        return strip
      })
      .catch(() => {
        clipStripInFlight.delete(key)
        return []
      })
    clipStripInFlight.set(key, promise)
    return promise
  }

  return { available, extractFrame, extractFrames, clipFilmstrip }
}
