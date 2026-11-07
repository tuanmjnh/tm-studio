// The export's sound leg: one decode per file, core's sum per packet.
//
// §53.6 declared `pcm` as a port and stopped there, because the honest answer is
// two different jobs and only one of them belongs to the seam that reads bytes:
// decoding a file's samples is `decodePcm`'s (E3), and summing those runs into
// one packet is `planExportMixPacket`'s (H3d-2a), which owns position, resample,
// gain and the refusal vocabulary. What is left is the walk between them.
//
// It is not glue for glue's sake. The encode session asks about 47 times per
// second of file, for the same handful of clips, so a leg that decoded per packet
// would re-open a container every ~21 ms — the audio twin of the per-frame open
// the plate leg retired in §53.8. And a leg that summed locally would be a second
// answer to what the file sounds like, next to the one the preview's Web Audio
// graph reads from the same core law.
//
// The alignment is the load-bearing part. `planExportMixPacket` taps a source at
// `mediaSeconds * sampleRate` — an ABSOLUTE index into the file — so the run a
// source carries has to start at media second 0. Handing the law a run that
// began at a clip's in-point would read a trimmed bed 30 s into a 30-second
// buffer and export silence. So each sounding file is decoded once, from 0 to the
// furthest second any clip uses of it, and the law's own out-of-run tap answers
// silence past the end.

import { TICKS_PER_SECOND, audioMixAt, clipSourceRange, evaluateTimeline, planExportMixPacket } from 'tmcut-core'
import type { TmcutTrack } from '~/composables/useTmcutProject'
import { decodePcm, hasAudioDecoder } from './audioDecode'

/** One decoded file: its native rate and one flat run per channel, from media 0. */
export interface ExportMixRun {
  sampleRate: number
  channels: Float32Array[]
}

export interface ExportMixDecodeAsk {
  src: string
  inSec: number
  outSec: number
  signal: AbortSignal
}

export interface ExportMixLegDeps {
  decode?: (ask: ExportMixDecodeAsk & { bytes?: Blob | null }) => Promise<ExportMixRun | null>
  hasDecoder?: () => boolean
}

/** The request the encode session makes — `TmcutPcmRequest`, structurally. */
export interface ExportMixPacketRequest {
  index: number
  startSample: number
  frames: number
  /** Microseconds, from core's sample clock. */
  timestamp: number
  duration: number
}

export interface ExportMixPacketAsk {
  project: { tracks?: TmcutTrack[] }
  request: ExportMixPacketRequest
  target: { sampleRate: number, channelCount: number }
  signal?: AbortSignal
}

/** One source that did reach the packet, and one that could not. */
export interface ExportMixRefusal {
  clipId: string | null
  reason: string
}

/** Core's refusal carries the authored id, which the app types as a string. */
function clipIdOf(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

export function createExportMixLeg(deps: ExportMixLegDeps = {}) {
  const decode = deps.decode ?? decodePcm
  const canDecode = deps.hasDecoder ?? hasAudioDecoder
  const runs = new Map<string, Promise<ExportMixRun | null>>()
  const refusals: ExportMixRefusal[] = []
  let done = false

  /**
   * The furthest second any clip uses of this file. The mix law reads absolute
   * indices, so the run has to cover every second a clip can play, not the span
   * the first packet happens to need.
   */
  function mediaEndOf(tracks: readonly TmcutTrack[] | undefined, src: string): number {
    let end = 0
    for (const track of tracks ?? []) {
      for (const item of track?.items ?? []) {
        if (item.src !== src) continue
        const range = clipSourceRange(item)
        const out = range ? range.out / TICKS_PER_SECOND : 0
        if (Number.isFinite(out) && out > end) end = out
      }
    }
    return end
  }

  /** One read per file, shared by every packet that asks for it. */
  function runFor(src: string, tracks: readonly TmcutTrack[] | undefined, signal: AbortSignal) {
    const held = runs.get(src)
    if (held) return held
    const work = decode({ src, inSec: 0, outSec: mediaEndOf(tracks, src), signal, bytes: null })
    runs.set(src, work)
    return work
  }

  async function mix(ask: ExportMixPacketAsk): Promise<Float32Array[]> {
    const silence = () => Array.from({ length: ask.target.channelCount }, () => new Float32Array(ask.request.frames))
    if (done) return silence()
    // A silent file written as a successful export is the audio twin of a black
    // frame: the timeline makes a sound the file would not have.
    if (!canDecode()) throw new Error('this host has no audio decoder, so the export cannot write its sound')
    const signal = ask.signal ?? new AbortController().signal

    const atTicks = Math.round((ask.request.timestamp / 1_000_000) * TICKS_PER_SECOND)
    const planned = audioMixAt(evaluateTimeline(ask.project, atTicks)).sources

    const sources: Array<Record<string, unknown>> = []
    for (const source of planned) {
      // Core names a muted layer too, at gain 0, and `planExportMixPacket` drops
      // it. Skipping it here changes no sample and saves a whole decode.
      if (!(Number(source.gain) > 0)) continue
      const clip = ask.project.tracks
        ?.flatMap(track => track?.items ?? [])
        .find(item => item.id === source.clipId)
      const src = clip?.src
      if (!src) continue
      const run = await runFor(src, ask.project.tracks, signal)
      if (!run) {
        refusals.push({ clipId: clipIdOf(source.clipId), reason: 'no-pcm' })
        continue
      }
      sources.push({ ...source, ...run })
    }

    const packet = planExportMixPacket({
      at: atTicks,
      startSample: ask.request.startSample,
      frames: ask.request.frames,
      target: ask.target,
      sources
    })
    if (!packet) return silence()
    for (const entry of packet.refused) refusals.push({ clipId: clipIdOf(entry.clipId), reason: entry.reason })
    return packet.channels.map(channel => channel.slice())
  }

  function close() {
    if (done) return
    done = true
    runs.clear()
  }

  return {
    mix,
    close,
    refused: () => refusals.slice()
  }
}
