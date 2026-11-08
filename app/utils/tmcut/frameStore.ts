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
//
// A third belongs to the end of a session rather than to one frame (slice F10):
// everything this file takes on a caller's behalf — object URLs, decoders, slot
// tokens — is given back when the session that asked for it is over, because no
// other code holds the list of what to release.

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
import { decodeFrame, hasFrameDecoder } from './frameDecode'
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
  /**
   * A list of instants somebody wants now and will not re-ask: each slot is
   * handed back when its answer lands, so a batch never leaves the ledger
   * holding slots nobody owns anymore.
   */
  requestBatch(asks: TmcutFrameAsk[]): Promise<Array<string | null>>
  /** The owner of a slot left: its pending ask may no longer paint. */
  forget(slot: string): boolean
  /** Frame keys currently held. */
  cached(): string[]
  /** Frames being read or decoded right now. */
  inFlight(): number
  /** Slots still owned — a batch that never handed back shows up here. */
  trackedSlots(): number
  /**
   * End the session: stop every decode, revoke every frame location and hand
   * back every slot. Returns how many frames were let go.
   *
   * The service keeps answering afterwards — the app shares one instance, and a
   * law that returns nothing forever is worse than one that costs a re-decode.
   */
  dispose(): number
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
  // Bumped by `dispose()`: a decode that finishes into a younger generation
  // belongs to a session that already left.
  let generation = 0

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

  /** A batch is done with its slot: drop the waiter and the token it issued. */
  function finishBatchSlot(slot: string, token: number) {
    const waiter = slotWaiters.get(slot)
    if (waiter && waiter.token === token) {
      slotWaiters.delete(slot)
      waiter.task.waiters.delete(waiter)
    }
    // Token-guarded in core: a newer ask that took this slot over keeps it.
    ledger.release(slot, token)
  }

  /**
   * End the session. Everything the service was holding on behalf of the page
   * that is going — decoders, object URLs, slots — goes back.
   */
  function dispose(): number {
    generation += 1
    let released = 0
    for (const row of held.values()) {
      URL.revokeObjectURL(row.url)
      released += 1
    }
    held.clear()
    for (const task of tasks.values()) task.controller.abort()
    tasks.clear()
    slotWaiters.clear()
    ledger.clear()
    return released
  }

  function startTask(key: string, fingerprint: string, atSec: number, width: number, src: string | null): FrameTask {
    const born = generation
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
        // The session this decode belongs to ended while it was running. The
        // bytes are already paid for, but a URL minted now would outlive the
        // only cache that could ever revoke it.
        if (born !== generation) return null
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

  type AskEntry = { slot: string, token: number, promise: Promise<string | null> }

  /** Take the slot and point the ask at the frame that answers it. */
  function beginAsk(ask: TmcutFrameAsk): AskEntry | null {
    const atSec = frameTimeWithinMedia(ask.atSec, ask.durationSec)
    const width = frameRequestWidth(ask.width)
    const key = atSec === null ? null : frameRequestKey(ask.fingerprint, atSec, width)
    if (key === null || atSec === null) return null

    const entry = ledger.begin(ask.slot, key)
    const previous = slotWaiters.get(ask.slot)
    slotWaiters.delete(ask.slot)
    retire(previous, previous?.task.key === key)

    const cachedRow = held.get(key)
    if (cachedRow) {
      cachedRow.accessedAt = Date.now()
      return { slot: ask.slot, token: entry.token, promise: Promise.resolve(cachedRow.url) }
    }

    let task = tasks.get(key)
    if (!task) task = startTask(key, String(ask.fingerprint), atSec, width, ask.src ? String(ask.src) : null)
    const waiter: Waiter = { slot: ask.slot, token: entry.token, task }
    task.waiters.add(waiter)
    slotWaiters.set(ask.slot, waiter)
    return {
      slot: ask.slot,
      token: entry.token,
      promise: task.promise.then(url => (url !== null && ledger.isCurrent(ask.slot, entry.token) ? url : null))
    }
  }

  function request(ask: TmcutFrameAsk): Promise<string | null> {
    const entry = beginAsk(ask)
    return entry ? entry.promise : Promise.resolve(null)
  }

  async function requestBatch(list: TmcutFrameAsk[]): Promise<Array<string | null>> {
    const entries = list.map(ask => beginAsk(ask))
    const urls = await Promise.all(entries.map(entry => (entry ? entry.promise : Promise.resolve(null))))
    entries.forEach((entry) => {
      if (entry) finishBatchSlot(entry.slot, entry.token)
    })
    return urls
  }

  return {
    request,
    requestBatch,
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
    },
    trackedSlots() {
      return ledger.size()
    },
    dispose
  }
}

/** The service the whole app shares: one cache, one pool, one set of answers. */
export const frameService = createFrameService(decodeFrame)

/**
 * Whether this runtime can answer a frame ask at all. The capability lives
 * behind the entry point so a control asks the store it already uses, rather
 * than reaching past it into the decoder module for a second answer.
 */
export function canDecodeFrames(): boolean {
  return hasFrameDecoder()
}

export function requestFrame(ask: TmcutFrameAsk): Promise<string | null> {
  return frameService.request(ask)
}

export function forgetFrameSlot(slot: string): boolean {
  return frameService.forget(slot)
}

/** A list of instants that will not be re-asked; their slots come back with their answers. */
export function requestFrameBatch(asks: TmcutFrameAsk[]): Promise<Array<string | null>> {
  return frameService.requestBatch(asks)
}

/** The TMCut session is closing: the frames it held are no longer anyone's to show. */
export function disposeFrameService(): number {
  return frameService.dispose()
}
