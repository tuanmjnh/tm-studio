// The two detection passes AutoCut needs, in one order both hosts run (slice E4).
//
// AutoCut asks "where does the camera cut" and "where is this track quiet".
// Until now the app decided which runtime answered: a desktop path went over IPC
// to an FFmpeg pass in the main process, a `/uploads/` path went to the server's
// copy of the same filters, and the raw stderr log was parsed back into seconds.
// Slices E2 and E3 replaced both halves of that answer with a decoder and core's
// laws; this file replaces the last of the routing, so the shot list and the
// silence list come from one place on either host.
//
// It owns exactly three decisions, and no decoding:
//  - which bytes the seams read — the client copy first, a location second, the
//    same precedence `frameStore.ts` set in slice D2, because two rules about
//    which copy wins is two chances for a scan and a thumbnail to disagree;
//  - the order: shots before sound, and the sound pass skipped when there are no
//    shots to score, since a clip that yields no cuts yields no draft either;
//  - what an empty answer MEANS. "This host cannot decode", "this file gave no
//    frames", "you cancelled" and "this clip has no audio" are four different
//    sentences, and the old code answered three of them with one desktop-only
//    message and the fourth by calling a silent file quiet.
//
// The seams are parameters, not imports, for the usual reason: pixels need
// WebCodecs and samples need Web Audio, which plain Node does not have. Times are
// source seconds throughout — the clip's own 0..duration, exactly what the FFmpeg
// passes were fed.

import { readCachedBytes } from './byteStore'
import { createSceneScan, type TmcutSceneScanResult } from './sceneScan'
import { createSilenceScan, type TmcutPcm, type TmcutSilenceScanResult } from './silenceScan'

export type TmcutDetectStage = 'scenes' | 'silence'

/** Why the lists are empty. Each one needs a different sentence in the UI. */
export type TmcutDetectError = 'no-decoder' | 'no-video' | 'cancelled'

/** Where one read gets its bytes: the client copy, or a location, never both. */
export interface TmcutDetectSource {
  bytes: Blob | null
  src: string | null
  signal: AbortSignal
}

export interface TmcutDetectSeams {
  /** Pixels: one luma grid per planned instant (`decodeLumaSeries`). */
  readGrids: (
    ask: TmcutDetectSource & { timesSec: number[] }
  ) => Promise<Array<ArrayLike<number> | null | undefined>>
  /** Sound: the PCM of one range (`decodePcm`), or null when there is none. */
  readPcm: (
    ask: TmcutDetectSource & { inSec: number, outSec: number }
  ) => Promise<TmcutPcm | null>
  /** Whether this runtime can decode video at all — a host without WebCodecs is
   *  not the file's fault, and the two answers must not share one message. */
  canDecodeVideo: () => boolean
}

export interface TmcutAutocutDetectAsk {
  /** The C1 revision fingerprint; with no fingerprint there is no cached copy. */
  fingerprint?: string | null
  /** Where to read when the cache holds none: a `media://`, `/uploads/` or http URL. */
  src: string
  /** How long the clip is, in source seconds. The scan covers 0..durationSec. */
  durationSec: number
  /** The analysis was cancelled: no read, no lists. */
  signal?: AbortSignal
  /** Which pass is running, so the UI can name the wait without inventing a percent. */
  onStage?: (stage: TmcutDetectStage) => void
}

export interface TmcutAutocutDetectResult {
  /** Seconds the scan saw a change at, in sample order. */
  cuts: number[]
  /** The shot list the scorer eats, in source seconds. Empty when nothing was usable. */
  shots: Array<{ start: number, end: number }>
  /** Quiet runs in source seconds. Empty when no sound was decoded. */
  silences: Array<{ start: number, end: number }>
  /** Instants the scene plan asked for, and how many the decoder could not deliver. */
  sampled: number
  missing: number
  /** Level windows the sound pass measured. */
  windows: number
  /** True only when samples were delivered — the difference between "this clip is
   *  quiet here" and "nothing was heard, so nothing is claimed quiet". */
  audioHeard: boolean
  error: TmcutDetectError | null
}

const NOTHING = {
  cuts: [] as number[],
  shots: [] as TmcutAutocutDetectResult['shots'],
  silences: [] as TmcutAutocutDetectResult['silences'],
  sampled: 0,
  missing: 0,
  windows: 0,
  audioHeard: false
}

export function createAutocutDetect(seams: TmcutDetectSeams) {
  async function detect(ask: TmcutAutocutDetectAsk): Promise<TmcutAutocutDetectResult> {
    const signal = ask.signal ?? new AbortController().signal
    if (signal.aborted) return { ...NOTHING, error: 'cancelled' }
    if (!seams.canDecodeVideo()) return { ...NOTHING, error: 'no-decoder' }
    const duration = Number(ask.durationSec)
    if (!Number.isFinite(duration) || duration <= 0) return { ...NOTHING, error: 'no-video' }

    const bytes = await readCachedBytes(ask.fingerprint ?? '')
    const source: TmcutDetectSource = {
      bytes: bytes ?? null,
      src: bytes ? null : (ask.src ? String(ask.src) : null),
      signal
    }
    if (!source.bytes && !source.src) return { ...NOTHING, error: 'no-video' }

    ask.onStage?.('scenes')
    let scenes: TmcutSceneScanResult
    try {
      scenes = await createSceneScan(
        timesSec => seams.readGrids({ ...source, timesSec })
      ).scan({ inSec: 0, outSec: duration, durationSec: duration, signal })
    } catch {
      // The signal is read before the throw is graded: a decoder that rejects
      // because the walk was stopped is a cancel, not a file with no frames.
      if (signal.aborted) {
        return { ...NOTHING, error: 'cancelled' }
      }
      // A decoder that throws on this file means the same thing to a draft as one
      // that hands back nothing: there are no frames. The stack is the seam's
      // business; the page gets the one sentence it can show.
      return { ...NOTHING, error: 'no-video' }
    }
    if (signal.aborted) {
      return { ...NOTHING, sampled: scenes.sampled, missing: scenes.missing, error: 'cancelled' }
    }
    // Fewer than two usable grids means no pair to compare, so there is no shot
    // list and no draft: the sound pass would be paid for and thrown away.
    if (scenes.sampled - scenes.missing < 2) {
      return { ...NOTHING, sampled: scenes.sampled, missing: scenes.missing, error: 'no-video' }
    }

    ask.onStage?.('silence')
    // Sound is the second half of the answer, not the price of the first: a pass
    // that dies leaves the shot list standing and claims no silence either.
    let silence: TmcutSilenceScanResult = { windows: 0, spans: [] }
    try {
      silence = await createSilenceScan(
        range => seams.readPcm({ ...source, inSec: range.inSec, outSec: range.outSec })
      ).scan({ inSec: 0, outSec: duration, signal })
    } catch {
      // Nothing heard, nothing claimed.
    }
    // A cancelled sound pass paints no EDL either, but the shots it already found
    // are not a failure of the file, so only the answer is dropped.
    if (signal.aborted) {
      return { ...NOTHING, sampled: scenes.sampled, missing: scenes.missing, error: 'cancelled' }
    }
    return {
      cuts: scenes.cuts,
      shots: scenes.shots,
      silences: silence.spans,
      sampled: scenes.sampled,
      missing: scenes.missing,
      windows: silence.windows,
      audioHeard: silence.windows > 0,
      error: null
    }
  }

  return { detect }
}
