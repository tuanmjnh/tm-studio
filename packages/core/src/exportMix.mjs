// =============================================================================
//  tmcut-core — the export packet mix
//  The samples one audio packet of an exported file holds (Zero-FFmpeg G4 + H3d).
//
//  Three modules already answer three parts of this question and none of them
//  answers the fourth. `audioMixAt` says WHICH layers sound at one tick, at what
//  gain, at what position inside their own file and at what rate — and its own
//  header says it never sums a sample. `evaluateTimeline` owns the position.
//  `exportEncode.mjs` owns how many samples a packet is and where it sits on the
//  file's clock. What nothing owned is the arithmetic between them, so the first
//  real exporter would have had to invent it inside `app/` — and an invented
//  position law is how a bed that starts at 30 seconds plays its first second
//  forever.
//
//  POSITION is the load-bearing part. `mediaTicks` is the evaluator's own number
//  with trim, speed and a ramp already folded into it, and it is the position AT
//  the tick that was evaluated. So a sample at output index `k` reads the media at
//  `mediaTicks + rate * (elapsed timeline seconds since that tick)`. Two wrong
//  readings are available and both sound plausible: treating `mediaTicks` as
//  packet-relative restarts the file on every packet, and measuring elapsed time
//  from zero instead of from the tick shifts every packet that follows a cut. This
//  law is stateless — the same inputs give the same run — so consecutive packets
//  line up by construction, which is the boundary a buffered resampler gets wrong.
//
//  RESAMPLE is not optional. `AudioBufferSink` has no sample-rate option: a decoder
//  hands over the media's native rate, while `ENCODE_AUDIO_REQUEST` is 48 kHz and
//  the encoder is promised that number. Interpolation is linear against an absolute
//  media second, and a tap outside the media reads zero, so a run ends rather than
//  looping or inventing a tail. Linear is a documented choice, not a claim of
//  equivalence: it aliases upward when a 48 kHz file is read at 2x, and the proof
//  of what that costs against FFmpeg belongs to the live slice, not to this file.
//
//  GAIN and SUM: each source contributes its samples times its own gain, and
//  sources add. No normalisation and no compressor, because the preview's Web
//  Audio graph adds too — an export that ducked the sum would be a file that
//  sounds different from the screen the user cut on. A sum above full scale is
//  therefore honest arithmetic whose clipping belongs to the encoder, and is
//  counted here rather than hidden.
//
//  A source that cannot be played is NAMED, never dropped: a reversed clip has no
//  forward sample walk, and a clip whose bytes are not in the client cache has no
//  PCM at all. `app/` shows these words; it must not re-invent them.
//
//  What this deliberately does NOT do: read bytes, decode, or hold state. The
//  caller supplies one decoded run per source and asks one packet at a time.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'
import { ENCODE_AUDIO_REQUEST } from './exportContent.mjs'

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

/**
 * The reasons a source can be left out of the mix, in one closed list so the UI
 * can show them verbatim. `reverse` is the one `audioMixAt` already names; the
 * rest are facts about the PCM the caller handed over.
 */
export const EXPORT_MIX_REFUSALS = Object.freeze([
  'reverse',
  'not-playable',
  'no-position',
  'no-pcm',
  'bad-rate',
  'bad-gain'
])

/**
 * How many source channels land in one target channel. `min` keeps the leading
 * pair when the media carries more than the file holds (a 5.1 run exports its two
 * mains rather than a fold no law here owns) and repeats the only plane when the
 * media is mono, so a mono bed is not exported out of phase with itself.
 */
function planeIndexFor(targetChannel, channelCount) {
  return Math.min(targetChannel, channelCount - 1)
}

/** A tap outside the run reads silence — the reason a finished clip goes quiet. */
function tapAt(samples, index) {
  if (!samples || index < 0 || index >= samples.length) return 0
  const value = Number(samples[index])
  return Number.isFinite(value) ? value : 0
}

/** One source, or the reason it is not in this packet. */
function contributionOf(source, atSec, target) {
  if (source.plays === false) {
    return { refusal: typeof source.refusal === 'string' ? source.refusal : 'not-playable' }
  }
  const gain = Number(source.gain)
  if (gain === 0) return null
  if (!isFiniteNumber(gain)) return { refusal: 'bad-gain' }
  if (!isFiniteNumber(source.mediaTicks)) return { refusal: 'no-position' }

  const planes = Array.isArray(source.channels) ? source.channels : []
  if (planes.length === 0) return { refusal: 'no-pcm' }

  const sampleRate = Number(source.sampleRate)
  if (!isFiniteNumber(sampleRate) || sampleRate <= 0) return { refusal: 'bad-rate' }

  const rate = isFiniteNumber(source.rate) ? source.rate : 1
  const mediaStartSec = source.mediaTicks / TICKS_PER_SECOND
  return {
    clipId: source.clipId ?? null,
    trackId: source.trackId ?? null,
    gain,
    rate,
    mediaStartSec,
    sampleRate,
    planes,
    atSec,
    targetRate: target.sampleRate
  }
}

/** Where this contribution sits in its own file at one output sample. */
function mediaIndexOf(who, startSample, offset) {
  const timelineSec = (startSample + offset) / who.targetRate
  const mediaSec = who.mediaStartSec + who.rate * (timelineSec - who.atSec)
  return mediaSec * who.sampleRate
}

/**
 * The samples one packet of an exported file holds.
 *
 * @param {{ at?: number, startSample?: number, frames?: number,
 *           target?: { sampleRate?: number, channelCount?: number },
 *           sources?: Array<object> }} input
 *   `at` the tick the `sources` were evaluated at — the same number
 *   `audioMixAt` answered from, so the position cannot be re-derived;
 *   `startSample`/`frames`/`target` come from `planEncodeAudioSample`, and
 *   `sources` are `audioMixAt`'s entries with the decoded run hung off each one
 *   (`channels`: one flat run per source channel, `sampleRate`: the native rate
 *   the decoder returned)
 * @returns {{ at: number, startSample: number, frames: number, target: object,
 *   channels: Float32Array[], mixed: Array<{ clipId, trackId, gain, rate,
 *   mediaStartSec, sampleRate, overRange }>, refused: Array<{ clipId, reason }> }
 *   | null} `null` when the packet itself is not a packet; otherwise exactly
 *   `target.channelCount` runs of exactly `frames` samples, in target order, with
 *   every source either in `mixed` or in `refused`.
 */
export function planExportMixPacket(input = {}) {
  const request = input && typeof input === 'object' ? input : {}
  const frames = request.frames
  const startSample = request.startSample
  const at = request.at ?? 0
  if (!isPositiveInteger(frames)) return null
  if (!Number.isInteger(startSample) || startSample < 0) return null
  if (!isFiniteNumber(at)) return null

  const asked = request.target && typeof request.target === 'object' ? request.target : {}
  const target = Object.freeze({
    sampleRate: asked.sampleRate ?? ENCODE_AUDIO_REQUEST.sampleRate,
    channelCount: asked.channelCount ?? ENCODE_AUDIO_REQUEST.channelCount
  })
  if (!isPositiveInteger(target.sampleRate) || !isPositiveInteger(target.channelCount)) return null

  const channels = []
  for (let index = 0; index < target.channelCount; index++) channels.push(new Float32Array(frames))

  const atSec = at / TICKS_PER_SECOND
  const entries = Array.isArray(request.sources) ? request.sources : []
  const mixed = []
  const refused = []

  for (const source of entries) {
    if (!source || typeof source !== 'object') continue
    const who = contributionOf(source, atSec, target)
    if (who === null) continue
    if (who.refusal) {
      refused.push(Object.freeze({ clipId: source.clipId ?? null, reason: who.refusal }))
      continue
    }

    let overRange = 0
    for (let channel = 0; channel < target.channelCount; channel++) {
      const plane = who.planes[planeIndexFor(channel, who.planes.length)]
      const run = channels[channel]
      for (let offset = 0; offset < frames; offset++) {
        const position = mediaIndexOf(who, startSample, offset)
        const head = Math.floor(position)
        const fraction = position - head
        const value = who.gain * (tapAt(plane, head) + (tapAt(plane, head + 1) - tapAt(plane, head)) * fraction)
        run[offset] += value
        // Counted on the running sum, not on this source alone, and per channel
        // sample: what the encoder is handed is the sum, and a mix that leaves
        // full scale is a fact the caller should see rather than a thing a law
        // hides behind a normaliser the preview does not run.
        if (run[offset] > 1 || run[offset] < -1) overRange += 1
      }
    }

    mixed.push(Object.freeze({
      clipId: who.clipId,
      trackId: who.trackId,
      gain: who.gain,
      rate: who.rate,
      mediaStartSec: who.mediaStartSec,
      sampleRate: who.sampleRate,
      overRange
    }))
  }

  return Object.freeze({
    at,
    startSample,
    frames,
    target,
    channels,
    mixed: Object.freeze(mixed),
    refused: Object.freeze(refused)
  })
}
