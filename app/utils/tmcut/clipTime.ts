import type { TmcutTimelineItem } from '~/composables/useTmcutProject'
import { ticksToSec } from 'tmcut-core'

/**
 * C16-R2/R3: single accessors for clip TIME GEOMETRY.
 *
 * C16-R3 flipped the store: `in`/`out`/`offset` are INTEGER TICKS
 * (TICKS_PER_SECOND = 120000, tmcut-core time.mjs). This module is the
 * only place that knows, and it exposes BOTH units on purpose:
 *  - `*Sec` helpers: SECONDS for the UI/playhead world (unchanged since
 *    R2 — every pre-flip consumer keeps compiling and behaves the same);
 *  - `*Ticks` helpers: the store unit, for drag/trim math and core calls
 *    that must not round-trip through float seconds.
 * Nothing else may spread `clip.out - clip.in` — that is how a unit bug
 * becomes impossible to write instead of impossible to review.
 */

/** Speed with the legacy 0/undefined → 1 fallback. */
export function clipSpeed(clip: Pick<TmcutTimelineItem, 'speed'>): number {
  return clip.speed || 1
}

// ---- Store-unit helpers (integer ticks) ----

/** Source-range length in ticks. */
export function clipSourceRangeTicks(clip: Pick<TmcutTimelineItem, 'in' | 'out'>): number {
  return clip.out - clip.in
}

/** Timeline span in ticks: source range divided by playback speed. */
export function clipDurationTicks(clip: Pick<TmcutTimelineItem, 'in' | 'out' | 'speed'>): number {
  return Math.max(1, Math.round(clipSourceRangeTicks(clip) / clipSpeed(clip)))
}

/** Timeline start in ticks. */
export function clipStartTicks(clip: Pick<TmcutTimelineItem, 'offset'>): number {
  return clip.offset || 0
}

/** Timeline end in ticks. */
export function clipEndTicks(clip: Pick<TmcutTimelineItem, 'in' | 'out' | 'speed' | 'offset'>): number {
  return clipStartTicks(clip) + clipDurationTicks(clip)
}

// ---- Seconds-facing API (the UI contract from R2) ----

/** Source-range length, source seconds. */
export function clipSourceRange(clip: Pick<TmcutTimelineItem, 'in' | 'out'>): number {
  return ticksToSec(clipSourceRangeTicks(clip))
}

/** Timeline span, seconds: source range divided by playback speed. */
export function clipDurationSec(clip: Pick<TmcutTimelineItem, 'in' | 'out' | 'speed'>): number {
  return ticksToSec(clipDurationTicks(clip))
}

/** Timeline start, seconds. */
export function clipStartSec(clip: Pick<TmcutTimelineItem, 'offset'>): number {
  return ticksToSec(clipStartTicks(clip))
}

/** Timeline end, seconds. */
export function clipEndSec(clip: Pick<TmcutTimelineItem, 'in' | 'out' | 'speed' | 'offset'>): number {
  return clipStartSec(clip) + clipDurationSec(clip)
}
