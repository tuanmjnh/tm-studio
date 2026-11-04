// The scene scan, in one place both hosts can use (zero-FFmpeg slice E2).
//
// AutoCut asks "where does the camera cut". Until slice E the answer came from an
// FFmpeg pass and a stderr parse; slices D and E1 made the two halves of a
// replacement possible — a decoder that can deliver frames on demand, and core
// laws that say what a change of pixels means. This file is the seam between
// them, and it decides nothing of its own:
//
//  - core plans the instants (`sceneSampleTimes`, which is the C14 filmstrip law
//    at the scene rate, so a scan and a strip of the same clip stand on the same
//    seconds);
//  - an injected reader delivers one luma grid per instant, or `null` when the
//    decoder had nothing for it;
//  - core scores the pairs (`sceneCuts`) and turns cuts into shots
//    (`cutsToShots`, the same law the stderr reader now shares).
//
// The reader is a parameter, not an import, for the same reason `frameStore.ts`
// takes its decoder: pixel work needs WebCodecs, which plain Node does not have.
// Every decision around it stays testable, and the ten lines that need a browser
// stay in `frameDecode.ts`.

import { cutsToShots, sceneCuts, sceneSampleTimes, secToTicks, ticksToSec } from 'tmcut-core'

export interface TmcutSceneScanAsk {
  /** Source range to look at, seconds — the clip's own in/out, not the timeline. */
  inSec: number
  outSec: number
  /** What the shot list closes at; the scanned range when the container is unknown. */
  durationSec?: number | null
  /** Looks per second. Core owns the default. */
  sampleHz?: number
  /** Cut score. Core owns the default. */
  threshold?: number
  /** The analysis was cancelled: no read, no cuts, no shots. */
  signal?: AbortSignal
}

export interface TmcutSceneScanResult {
  /** Instants the plan asked for. */
  sampled: number
  /** Instants the reader could not deliver a grid for. */
  missing: number
  /** Seconds the scan saw a change at, in sample order. */
  cuts: number[]
  /** The shot list the scorer eats. Empty when nothing was usable. */
  shots: Array<{ start: number, end: number }>
}

/** One luma grid per requested instant, `null` where the decoder gave nothing. */
export type TmcutGridReader = (
  timesSec: number[],
  signal: AbortSignal
) => Promise<Array<ArrayLike<number> | null | undefined>>

function emptyResult(sampled = 0, missing = 0): TmcutSceneScanResult {
  return { sampled, missing, cuts: [], shots: [] }
}

export function createSceneScan(readGrids: TmcutGridReader) {
  async function scan(ask: TmcutSceneScanAsk): Promise<TmcutSceneScanResult> {
    const from = Number(ask.inSec)
    const to = Number(ask.outSec)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return emptyResult()
    const signal = ask.signal ?? new AbortController().signal
    if (signal.aborted) return emptyResult()

    const times = sceneSampleTimes(secToTicks(from), secToTicks(to - from), ask.sampleHz)
    if (times.length === 0) return emptyResult()
    const seconds = times.map(ticks => ticksToSec(ticks))

    const grids = await readGrids(seconds, signal)
    const missing = seconds.reduce(
      (total, _atSec, index) => total + (grids[index]?.length ? 0 : 1),
      0
    )
    if (signal.aborted) return emptyResult(seconds.length, missing)
    // One usable grid scores nothing: there is no pair, and a shot list built
    // from zero cuts would claim the whole file is one continuous shot.
    if (seconds.length - missing < 2) return emptyResult(seconds.length, missing)

    const cuts = sceneCuts(seconds, grids, ask.threshold === undefined ? {} : { threshold: ask.threshold })
    const duration = Number.isFinite(Number(ask.durationSec)) && Number(ask.durationSec) > 0
      ? Number(ask.durationSec)
      : to
    return { sampled: seconds.length, missing, cuts, shots: cutsToShots(cuts, duration) }
  }

  return { scan }
}
