// The per-clip filmstrip, in one place both hosts can use (slice D3).
//
// A timeline clip asks a wider question than a player HUD: not "the frame at
// this instant" but "eight frames across MY trimmed source range, in order, and
// keep the positions if some of them fail". `frameStore.ts` answers the first
// question; this file answers the second by asking it `count` times. Nothing
// here decodes pixels or names frames — it only decides which instants are
// worth sampling (core does, in `filmstripTimes`) and which slot each sample
// belongs to.
//
// The slot name carries the law. It is named for the clip, not for the range:
//  - mount the same clip again → the same slots ask the same frames → the
//    service answers from its cache and no decoder opens;
//  - trim the same clip → the same slots ask different frames → the service
//    retires the older ask, so a strip the user dragged away cannot paint over
//    the one they are looking at.
// That is why there is no strip-level result cache: the frame cache is already
// keyed by (revision, instant, width), and a second cache of arrays would only
// add a way to hand back a revoked URL.

import { filmstripTimes, secToTicks, ticksToSec } from 'tmcut-core'
import type { TmcutFrameService } from './frameStore'

/** How many stills a timeline clip shows when nobody says. */
export const TMCUT_CLIP_STRIP_COUNT = 8

/** Timeline strips are small: 160px is the whole clip body on a dense track. */
export const TMCUT_CLIP_STRIP_WIDTH = 160

export interface TmcutStripAsk {
  /** Stable identity of the strip's owner — a clip id, never a trim range. */
  clipKey: string
  /** The C1 revision fingerprint; a junk value means every slot stays empty. */
  fingerprint: string | null | undefined
  /** Where to read when the client cache holds no copy. */
  src?: string | null
  /** Source time, so speed never shifts the sampling. */
  inSec: number
  outSec: number
  count?: number
  width?: number
  durationSec?: number | null
}

export interface TmcutStripReader {
  /** One URL or `''` per sampled instant, always `count` long or empty. */
  read(ask: TmcutStripAsk): Promise<string[]>
  /** The clip left the timeline: how many slots were handed back. */
  forget(clipKey: string): number
}

/** The slot one sampled instant is asked under. */
export function stripSlot(clipKey: string, index: number): string {
  return `strip:${clipKey}#${index}`
}

export function createStripReader(service: TmcutFrameService): TmcutStripReader {
  const ownedSlots = new Map<string, Set<string>>()

  async function read(ask: TmcutStripAsk): Promise<string[]> {
    const count = Number.isInteger(ask.count) ? Number(ask.count) : TMCUT_CLIP_STRIP_COUNT
    const width = Number.isInteger(ask.width) ? Number(ask.width) : TMCUT_CLIP_STRIP_WIDTH
    // Core owns the sampling, including "this range holds nothing": a negative
    // or zero span, a NaN bound and a zero count all answer an empty plan.
    const times = filmstripTimes(secToTicks(ask.inSec), secToTicks(ask.outSec - ask.inSec), count)
    if (times.length === 0) return []

    let held = ownedSlots.get(ask.clipKey)
    if (!held) {
      held = new Set<string>()
      ownedSlots.set(ask.clipKey, held)
    }
    const slots = held

    // Every instant is asked up front: the service's pool decides how many
    // decoders run, not the number of awaits written here.
    const urls = await Promise.all(times.map((time, index) => {
      const slot = stripSlot(ask.clipKey, index)
      slots.add(slot)
      return service.request({
        slot,
        fingerprint: ask.fingerprint,
        atSec: ticksToSec(time),
        width,
        durationSec: ask.durationSec,
        src: ask.src
      })
    }))
    return urls.map(url => url ?? '')
  }

  return {
    read,
    forget(clipKey: string) {
      const slots = ownedSlots.get(clipKey)
      if (!slots) return 0
      ownedSlots.delete(clipKey)
      for (const slot of slots) service.forget(slot)
      return slots.size
    }
  }
}
