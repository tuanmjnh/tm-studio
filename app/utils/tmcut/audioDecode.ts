// The one place `app/` turns media bytes into decoded sound (zero-FFmpeg slice E3).
//
// Slice D2 gave this repo one pixel seam; slice E2 gave it a sparse luma read on
// top of it. Sound is the third thing a demuxer can hand over, and it goes in its
// own file because it is a different kind of answer: not one instant of one frame,
// but the whole range at once, because a level window has no meaning without the
// samples around it.
//
// What lives here is the reading, and nothing else. Which windows are quiet, how
// several channels become one number and what seconds a span is reported in are
// core laws (`loudestPeakSeries`, `silenceSpans`) — see `silenceScan.ts`, which
// stays importable by plain Node precisely because it holds no decoder.

import { AudioBufferSink } from 'mediabunny'
import { pcmHeadTrim } from 'tmcut-core'
import { openMedia, type TmcutMediaRead } from './frameDecode'

/**
 * The decoder is Web Audio over a WebCodecs sample stream. A runtime without both
 * (plain Node, an old browser) is not offered a substitute: false means "this host
 * cannot make samples", and the caller keeps its placeholder.
 */
export function hasAudioDecoder(): boolean {
  return typeof globalThis.AudioDecoder !== 'undefined'
    && typeof globalThis.AudioBuffer !== 'undefined'
}

export interface TmcutPcmAsk extends TmcutMediaRead {
  /** Source range to decode, seconds, ascending — the caller's clip in/out. */
  inSec: number
  outSec: number
}

/**
 * Read the PCM of one range: every channel, one flat run each, in source order.
 *
 * `buffers()` is the whole reason this is one function — it walks the track once
 * and decodes each packet at most once, which a loop of `getBuffer()` calls would
 * not. `null` is an answer, not an error: no audio track, a host that cannot
 * decode, or a cancelled read all mean "here is nothing to measure".
 *
 * The channel arrays are kept apart rather than averaged into one mix. A mix would
 * let a loud left channel and a dead right one agree on a middle level, and quiet
 * is a claim about everything the viewer can hear — measured against FFmpeg, which
 * applies the same rule (a stereo pair at -28.5 dBFS per channel is not silence).
 *
 * The run is aligned to the asked range before it is handed over. A decoder returns
 * whole packets, so Chromium answered an ask of 0.5 s with the packet starting at
 * 0.48762 s, and 546 samples of tone at the head of a level window were enough to
 * call a quiet second loud half a second later than it is. `pcmHeadTrim` is core's.
 *
 * Only the head is trimmed. The run can end up to one packet past `outSec`, which
 * the browser harness measures rather than assumes: five ranged reads of a
 * real Opus stream came back 3 to 13 ms long at 48 kHz. That is fine for a level
 * window and would not be for a sample-exact join.
 */
export async function decodePcm(ask: TmcutPcmAsk): Promise<{ sampleRate: number, channels: Float32Array[] } | null> {
  const from = Number(ask.inSec)
  const to = Number(ask.outSec)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return null
  if (!hasAudioDecoder()) return null

  const opened = openMedia(ask)
  if (!opened) return null
  const { input, close } = opened
  const channels: Float32Array[] = []
  let sampleRate = 0
  let firstPacketSec = Number.NaN
  try {
    if (ask.signal.aborted) return null
    if (!(await input.canRead())) return null
    const [track] = await input.getAudioTracks()
    if (!track) return null
    const sink = new AudioBufferSink(track)
    for await (const wrapped of sink.buffers(from, to)) {
      if (ask.signal.aborted) return null
      const buffer = wrapped?.buffer ?? null
      if (!buffer) continue
      sampleRate = buffer.sampleRate
      if (!Number.isFinite(firstPacketSec)) firstPacketSec = wrapped.timestamp
      for (let index = 0; index < buffer.numberOfChannels; index++) {
        const part = buffer.getChannelData(index)
        const held = channels[index] ?? new Float32Array(0)
        const merged = new Float32Array(held.length + part.length)
        merged.set(held)
        merged.set(part, held.length)
        channels[index] = merged
      }
    }
  } finally {
    close()
  }
  if (sampleRate <= 0 || channels.length === 0) return null
  const head = pcmHeadTrim(from, firstPacketSec, sampleRate)
  if (head > 0) {
    for (const [index, channel] of channels.entries()) {
      channels[index] = channel.subarray(Math.min(head, channel.length))
    }
  }
  return { sampleRate, channels }
}
