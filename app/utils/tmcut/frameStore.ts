// The frame pipeline both hosts share (zero-FFmpeg slice D2, ADR-029/030/033).
//
// One question — "show me the frame at this instant of this revision" — has one
// answer path here: core turns the ask into a key, the client byte cache is
// asked for the file, the decoder (`frameDecode.ts`) is called once, and the
// pixels are handed back as an object URL. Anything the app used to decide on
// its own about thumbnails lives in `tmcut-core` or in this file, so the web
// host and Electron cannot drift apart.
//
// Two rules shape the shape of the code:
//  - the UI never gets an exception. A missing fingerprint, a dead decoder or a
//    browser with no byte store all answer `null`, and the caller keeps the
//    placeholder it already drew;
//  - a frame nobody is waiting for is cancelled, but its bytes are still kept.
//    A scrub asks ten frames and shows one; the nine that lost are exactly the
//    frames the user may scrub back to, so they are cached rather than painted.

import {
  TMCUT_FRAME_CACHE_MAX_ENTRIES,
  TMCUT_FRAME_MAX_CONCURRENT,
  createFrameSlotLedger,
  frameRequestKey,
  frameRequestWidth,
  frameTimeWithinMedia,
  planFrameCacheEviction
} from 'tmcut-core'
import { readCachedBytes } from './byteStore'
import { decodeFrame } from './frameDecode'
import type { TmcutFrameDecodeAsk } from './frameDecode'

/** One frame somebody wants to see. */
export interface TmcutFrameAsk {
  /** Who is asking. A new ask for the same slot retires the previous one. */
  slot: string
  /** The C1 revision fingerprint; anything else is a refusal, not a seek. */
  fingerprint: string | null | undefined
  /** Seconds into the source media. */
  atSec: number
  /** Output width; clamped by core. */
  width?: number
  /** Duration if known, so a seek past the end becomes the last real frame. */
  durationSec?: number | null
  /** Where to read when the client cache holds no copy. */
  src?: string | null
}

export interface TmcutFrameService {
  /** An object URL to show, or null when there is nothing to show. */
  request(ask: TmcutFrameAsk): Promise<string | null>
  /** The owner of a slot left: its pending ask may no longer paint. */
  forget(slot: string): boolean
  /** Frame keys currently held. */
  cached(): string[]
  /** Frames being read or decoded right now. */
  inFlight(): number
}

type Waiter = { slot: string, token: number, task: FrameTask }

type FrameTask = {
  key: string
  controller: AbortController
  waiters: Set<Waiter>
  promise: Promise<string | null>
}

/**
 * A frame cache plus a bounded decoder pool.
 *
 * `decode` is a parameter, not an import inside the law: the pixel work needs
 * WebCodecs, which plain Node does not have, so every rule around it — which
 * bytes, how many at a time, who may paint, what is still held — stays
 * testable and only the last ten lines need a browser.
 */
export function createFrameService(
  decode: (ask: TmcutFrameDecodeAsk) => Promise<Blob | null>,
  options: { maxEntries?: number } = {}
): TmcutFrameService {
  const maxEntries = Number.isInteger(options.maxEntries) && Number(options.maxEntries) > 0
    ? Number(options.maxEntries)
    : TMCUT_FRAME_CACHE_MAX_ENTRIES

  const ledger = createFrameSlotLedger()
  const held = new Map<string, { url: string, accessedAt: number }>()
  const tasks = new Map<string, FrameTask>()
  const slotWaiters = new Map<string, Waiter>()

  let decoding = 0
  const queue: Array<() => void> = []

  function acquire(): Promise<void> {
    if (decoding < TMCUT_FRAME_MAX_CONCURRENT) {
      decoding += 1
      return Promise.resolve()
    }
    return new Promise(resolve => queue.push(resolve))
  }

  function release() {
    const next = queue.shift()
    if (next) next()
    else decoding -= 1
  }

  /** Free the frames core says the cache no longer has room for. */
  function evict() {
    const rows = [...held].map(([key, row]) => ({ key, accessedAt: row.accessedAt }))
    const plan = planFrameCacheEviction(rows, maxEntries)
    for (const key of [...plan.drop, ...plan.invalid]) {
      const row = held.get(key)
      if (!row) continue
      URL.revokeObjectURL(row.url)
      held.delete(key)
    }
  }

  /** The ask that lost its slot: stop paying for it, keep what it produced. */
  function retire(waiter: Waiter | undefined, stillWanted: boolean) {
    if (!waiter) return
    waiter.task.waiters.delete(waiter)
    // Only a frame nobody waits for anymore is worth cancelling. Re-asking the
    // same instant (a player that redraws the HUD) joins the decode in flight
    // instead of cancelling it and starting the same work again.
    if (waiter.task.waiters.size > 0 || stillWanted) return
    waiter.task.controller.abort()
    if (tasks.get(waiter.task.key) === waiter.task) tasks.delete(waiter.task.key)
  }

  function startTask(key: string, fingerprint: string, atSec: number, width: number, src: string | null): FrameTask {
    const task: FrameTask = {
      key,
      controller: new AbortController(),
      waiters: new Set(),
      promise: Promise.resolve(null)
    }
    tasks.set(key, task)
    task.promise = (async () => {
      await acquire()
      try {
        if (task.controller.signal.aborted) return null
        const bytes = await readCachedBytes(fingerprint)
        if (!bytes && !src) return null
        const blob = await decode({
          key,
          atSec,
          width,
          bytes: bytes ?? null,
          src: bytes ? null : String(src),
          signal: task.controller.signal
        })
        if (!blob || blob.size <= 0) return null
        const url = URL.createObjectURL(blob)
        held.set(key, { url, accessedAt: Date.now() })
        evict()
        return url
      } catch {
        // A frame that cannot be made is a placeholder, not a crash: the
        // timeline, the grid and the player all have something to show without it.
        return null
      } finally {
        release()
        if (tasks.get(key) === task) tasks.delete(key)
      }
    })()
    return task
  }

  function request(ask: TmcutFrameAsk): Promise<string | null> {
    const atSec = frameTimeWithinMedia(ask.atSec, ask.durationSec)
    const width = frameRequestWidth(ask.width)
    const key = atSec === null ? null : frameRequestKey(ask.fingerprint, atSec, width)
    if (key === null || atSec === null) return Promise.resolve(null)

    const entry = ledger.begin(ask.slot, key)
    const previous = slotWaiters.get(ask.slot)
    slotWaiters.delete(ask.slot)
    retire(previous, previous?.task.key === key)

    const cachedRow = held.get(key)
    if (cachedRow) {
      cachedRow.accessedAt = Date.now()
      return Promise.resolve(cachedRow.url)
    }

    let task = tasks.get(key)
    if (!task) task = startTask(key, String(ask.fingerprint), atSec, width, ask.src ? String(ask.src) : null)
    const waiter: Waiter = { slot: ask.slot, token: entry.token, task }
    task.waiters.add(waiter)
    slotWaiters.set(ask.slot, waiter)

    return task.promise.then(url => (url !== null && ledger.isCurrent(ask.slot, entry.token) ? url : null))
  }

  return {
    request,
    forget(slot: string) {
      retire(slotWaiters.get(slot), false)
      slotWaiters.delete(slot)
      return ledger.forget(slot)
    },
    cached() {
      return [...held.keys()]
    },
    inFlight() {
      return tasks.size
    }
  }
}

/** The service the whole app shares: one cache, one pool, one set of answers. */
export const frameService = createFrameService(decodeFrame)

export function requestFrame(ask: TmcutFrameAsk): Promise<string | null> {
  return frameService.request(ask)
}

export function forgetFrameSlot(slot: string): boolean {
  return frameService.forget(slot)
}
