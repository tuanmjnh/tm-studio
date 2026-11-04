// The silence scan, in one place both hosts can use (zero-FFmpeg slice E3).
//
// AutoCut asks "where is the track quiet". Until slice E the answer came from an
// FFmpeg pass and a stderr parse. Slice E1 put the numbers in core, slice E2 put
// pixels in reach of them; this file does the same for sound and decides nothing
// of its own:
//
//  - an injected reader delivers the PCM for the asked range, or null when this
//    host cannot decode audio;
//  - core turns channels into one level per window (`loudestPeakSeries`, so a
//    dead channel can never make audible content look quiet) and decides what
//    quiet is (`silenceSpans`, the same measure FFmpeg's `silencedetect` used —
//    the loudest sample of the window, at the window width slice E4 measured).
//
// The reader is a parameter, not an import, for the same reason the scene scan
// takes its grid reader: sample work needs Web Audio and WebCodecs, which plain
// Node does not have. Every decision around it stays testable, and the handful of
// lines that need a browser stay in `audioDecode.ts`.
//
// Times are source seconds. A trimmed clip's reader starts at the clip's in point,
// and core is told so (`offsetSec`) — the glue never adds the two numbers itself,
// so a scan of the same file cannot report different seconds on a different host.

import { loudestPeakSeries, silenceSpans } from 'tmcut-core'

export interface TmcutSilenceScanAsk {
  /** Source range to listen to, seconds — the clip's own in/out, not the timeline. */
  inSec: number
  outSec: number
  /** Width of one level window. Core owns the default. */
  windowSec?: number
  /** Quiet, in dBFS. Core owns the default. */
  noiseDb?: number
  /** How long quiet must last to count. Core owns the default. */
  minDurationSec?: number
  /** The analysis was cancelled: no read, no spans. */
  signal?: AbortSignal
}

export interface TmcutSilenceScanResult {
  /** Level windows the series covers — zero when nothing was delivered. */
  windows: number
  /** Quiet runs in source seconds, in the shape the stderr reader used. */
  spans: Array<{ start: number, end: number }>
}

/** The PCM of one range: every channel of one sample rate, or nothing at all. */
export interface TmcutPcm {
  sampleRate: number
  channels: ArrayLike<ArrayLike<number> | null | undefined>
}

export type TmcutPcmReader = (
  ask: { inSec: number, outSec: number, signal: AbortSignal }
) => Promise<TmcutPcm | null>

function emptyResult(windows = 0): TmcutSilenceScanResult {
  return { windows, spans: [] }
}

export function createSilenceScan(readPcm: TmcutPcmReader) {
  async function scan(ask: TmcutSilenceScanAsk): Promise<TmcutSilenceScanResult> {
    const from = Number(ask.inSec)
    const to = Number(ask.outSec)
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return emptyResult()
    const signal = ask.signal ?? new AbortController().signal
    if (signal.aborted) return emptyResult()

    const pcm = await readPcm({ inSec: from, outSec: to, signal })
    if (!pcm) return emptyResult()
    const levels = loudestPeakSeries(pcm.channels, pcm.sampleRate, ask.windowSec)
    if (signal.aborted) return emptyResult(levels.length)

    const options = {
      windowSec: ask.windowSec,
      noiseDb: ask.noiseDb,
      minDurationSec: ask.minDurationSec,
      offsetSec: from,
      // A span may not claim a second the scan never listened to, so the ceiling
      // is the read itself rather than whatever the container says.
      durationSec: to - from
    }
    return { windows: levels.length, spans: silenceSpans(levels, options) }
  }

  return { scan }
}
