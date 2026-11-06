// =============================================================================
//  tmcut-core — export encode laws (zero-FFmpeg slice H1).
//
//  Slice A measured that nothing in this repo can export without FFmpeg, and
//  ADR-030 names the replacement: WebCodecs, asked first. These three laws are
//  the parts of that loop that must not live in the IO layer, because an
//  exporter can only be reviewed by reading its decisions.
//
//  * `planEncodeConfig` chooses the preset from RECORDED `isConfigSupported`
//    answers. An unmeasured preset is not a supported one, a runtime that
//    answered a different codec than the one asked is a substitution and not a
//    success, and the verdict matrix comes back even when the answer is good —
//    the exit criterion is the recorded result, not a working file alone.
//  * `planEncodeSample` turns a frame INDEX into a timestamp in the muxer's own
//    timescale. It multiplies the rational rate by the index and rounds once
//    (never a float FPS, never the wall clock), so frame 30 of 29.97 is 1.001 s
//    and 300 frames sum to exactly 10.01 s — the drift `canvasFpsValue`'s
//    three-decimal rounding introduces cannot reach a muxed file. The tail is
//    the content, not a whole frame, so the file is never longer than the
//    timeline it came from.
//  * `planEncodeQueue` bounds the in-flight frames. `VideoFrame` holds a real
//    buffer, so an unbounded queue dies mid-export, and a limit the loop honours
//    as zero would wait for a slot that can never exist.
//
//  Pure: no timers, no browser globals, no encoder objects. The host owns the
//  API calls; this module owns what they mean.
// =============================================================================

import { TICKS_PER_SECOND } from './time.mjs'

/** The chroma rule, in the words the HTML-video contract already uses. */
export const ENCODER_EVEN_DIMENSION_REASON = 'the encoder subsamples chroma 2x2'

/** Frames allowed in the encoder at once when the caller names no limit. */
export const DEFAULT_ENCODE_IN_FLIGHT = 4

function isInteger(value) {
  return typeof value === 'number' && Number.isInteger(value)
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** A frame rate is a rational pair; a float here would be the drift we refuse. */
function rationalError(value) {
  if (!value || typeof value !== 'object') return 'must be a { numerator, denominator } pair'
  if (!isInteger(value.numerator) || value.numerator <= 0) return `numerator must be a positive integer, got ${String(value.numerator)}`
  if (!isInteger(value.denominator) || value.denominator <= 0) return `denominator must be a positive integer, got ${String(value.denominator)}`
  return null
}

function evenDimensionError(name, value) {
  if (!isInteger(value) || value <= 0) return `${name}: must be a positive integer, got ${String(value)}`
  if (value % 2 !== 0) {
    // Not a quality preference: an odd edge has no complete 2x2 chroma block,
    // and an encoder that is asked for one either refuses the config or crops
    // the picture. Both hosts must fail the same way, before the encode.
    return `${name}: ${value} must be even (${ENCODER_EVEN_DIMENSION_REASON})`
  }
  return null
}

/** The shape rules, checked before any answer is trusted. */
function presetErrors(video, audio) {
  const reasons = []
  if (!video || typeof video !== 'object') {
    reasons.push('video: an encode preset needs a video config')
    return reasons
  }
  if (typeof video.codec !== 'string' || !video.codec) reasons.push('video.codec: must name the codec that will be encoded')
  const width = evenDimensionError('width', video.width)
  if (width) reasons.push(width)
  const height = evenDimensionError('height', video.height)
  if (height) reasons.push(height)
  const fps = rationalError(video.fps)
  reasons.push(...(fps ? [`fps: ${fps}`] : []))
  if (video.bitrate !== undefined && (!isFiniteNumber(video.bitrate) || video.bitrate <= 0)) {
    reasons.push(`video.bitrate: must be a positive number of bits per second, got ${String(video.bitrate)}`)
  }
  if (audio !== null && audio !== undefined) {
    if (!audio || typeof audio !== 'object') {
      reasons.push('audio: must be a config or absent')
    } else {
      if (typeof audio.codec !== 'string' || !audio.codec) reasons.push('audio.codec: must name the codec that will be encoded')
      if (!isInteger(audio.sampleRate) || audio.sampleRate <= 0) {
        reasons.push(`audio.sampleRate: must be a positive integer, got ${String(audio.sampleRate)}`)
      }
      if (!isInteger(audio.channelCount) || audio.channelCount <= 0) {
        reasons.push(`audio.channelCount: must be a positive integer, got ${String(audio.channelCount)}`)
      }
    }
  }
  return reasons
}

/** One preset, judged. `answer` is what the host recorded from isConfigSupported. */
function judgePreset(preset, answer) {
  const id = preset && typeof preset === 'object' ? preset.id : undefined
  const row = { id, verdict: 'unsupported', reasons: [], preset: null, config: null }
  if (!preset || typeof preset !== 'object' || typeof id !== 'string' || !id) {
    row.verdict = 'invalid'
    row.reasons = ['id: a preset must be named, or the matrix cannot report it']
    return row
  }
  row.preset = preset

  const shape = presetErrors(preset.video, preset.audio ?? null)
  if (shape.length > 0) {
    row.verdict = 'invalid'
    row.reasons = shape
    return row
  }

  const askedAudio = preset.audio ?? null
  if (!answer || typeof answer !== 'object' || !answer.video) {
    // The brief forbids guessing hardware H.264, so the absence of a measurement
    // is its own verdict — never a silent pass.
    row.verdict = 'unmeasured'
    row.reasons = [`no recorded VideoEncoder.isConfigSupported answer for ${id}`]
    return row
  }

  const reasons = []
  if (answer.video.supported !== true) reasons.push(`the runtime refused video ${preset.video.codec}`)
  const echoed = answer.video.config && answer.video.config.codec
  if (echoed && echoed !== preset.video.codec) {
    row.verdict = 'substituted'
    reasons.push(`asked ${preset.video.codec}, the runtime answered ${echoed} — the exporter does not swap codecs`)
  }

  if (askedAudio) {
    if (!answer.audio || typeof answer.audio !== 'object') {
      row.verdict = 'unmeasured'
      reasons.push(`no recorded AudioEncoder.isConfigSupported answer for ${id}`)
    } else if (answer.audio.supported !== true) {
      reasons.push(`the runtime refused audio ${askedAudio.codec}`)
    } else {
      const audioEchoed = answer.audio.config && answer.audio.config.codec
      if (audioEchoed && audioEchoed !== askedAudio.codec) {
        row.verdict = 'substituted'
        reasons.push(`asked ${askedAudio.codec}, the runtime answered ${audioEchoed} — the exporter does not swap codecs`)
      }
    }
  }

  row.reasons = reasons
  if (reasons.length === 0 && row.verdict !== 'substituted' && row.verdict !== 'unmeasured') {
    row.verdict = 'supported'
    row.config = {
      id,
      video: {
        codec: preset.video.codec,
        width: preset.video.width,
        height: preset.video.height,
        fps: { numerator: preset.video.fps.numerator, denominator: preset.video.fps.denominator },
        bitrate: preset.video.bitrate
      },
      audio: askedAudio
        ? { codec: askedAudio.codec, sampleRate: askedAudio.sampleRate, channelCount: askedAudio.channelCount }
        : null
    }
  }
  return row
}

/**
 * Decide which encode preset the exporter may use.
 *
 * @param {{ presets?: Array<{ id: string, video: object, audio?: object|null }>,
 *           answers?: Record<string, { video?: { supported?: boolean, config?: object },
 *                                      audio?: { supported?: boolean, config?: object } }> }} input
 *   `presets` in preference order; `answers` holds what the host measured with
 *   `VideoEncoder.isConfigSupported` / `AudioEncoder.isConfigSupported`
 * @returns {{ kind: 'ready', preset: object, config: object, checked: object[] }
 *          | { kind: 'refused', reason: 'no-presets'|'nothing-measured'|'nothing-supported', checked: object[] }}
 *   `checked` is the whole verdict matrix: `id`, `verdict`, `reasons` per preset
 */
export function planEncodeConfig(input = {}) {
  const presets = Array.isArray(input.presets) ? input.presets : []
  if (presets.length === 0) return { kind: 'refused', reason: 'no-presets', checked: [] }

  const answers = input.answers && typeof input.answers === 'object' ? input.answers : {}
  const checked = presets.map(preset => judgePreset(preset, preset && preset.id ? answers[preset.id] : undefined))

  const winner = checked.find(row => row.verdict === 'supported')
  if (winner) return { kind: 'ready', preset: winner.preset, config: winner.config, checked }

  const measured = checked.filter(row => row.verdict !== 'unmeasured')
  return {
    kind: 'refused',
    reason: measured.length === 0 ? 'nothing-measured' : 'nothing-supported',
    checked
  }
}

/**
 * One frame of the sequence, expressed in the muxer's timescale.
 *
 * @param {{ index?: number, rate?: { numerator: number, denominator: number },
 *           contentEndTicks?: number, timescale?: number }} input
 *   the frame's ordinal position, the project's rational rate, and the end of
 *   the content in ticks (`TICKS_PER_SECOND` units)
 * @returns {{ timestamp: number, duration: number, isLast: boolean } | null}
 *   integers in `timescale` units (microseconds by default), or null when the
 *   index is outside the content or the inputs are unusable
 */
export function planEncodeSample(input = {}) {
  const { index, rate, contentEndTicks, timescale = 1_000_000 } = input
  if (!isInteger(index) || index < 0) return null
  if (rationalError(rate)) return null
  if (!isFiniteNumber(timescale) || timescale <= 0) return null
  if (!isFiniteNumber(contentEndTicks) || contentEndTicks <= 0) return null

  /** Where frame `at` starts — one rounding, from the index and the rational rate. */
  const startsAt = position => Math.round((position * timescale * rate.denominator) / rate.numerator)
  const contentEnd = Math.round((contentEndTicks * timescale) / TICKS_PER_SECOND)

  const timestamp = startsAt(index)
  if (timestamp >= contentEnd) return null

  const next = startsAt(index + 1)
  return Object.freeze({
    timestamp,
    // A whole frame, unless the content ends first: muxing a full frame's
    // length past the timeline makes a file longer than the project.
    duration: Math.min(next - timestamp, contentEnd - timestamp),
    isLast: next >= contentEnd
  })
}

/**
 * Whether the exporter may hand the encoder another frame.
 *
 * @param {{ inFlight?: number, limit?: number }} input
 * @returns {{ action: 'push'|'wait', outstanding: number, limit: number, room: number }}
 *   `limit` falls back to {@link DEFAULT_ENCODE_IN_FLIGHT} unless it is a
 *   positive integer — a zero bound would wait for a slot that never opens
 */
export function planEncodeQueue(input = {}) {
  const { inFlight, limit } = input
  const bound = isInteger(limit) && limit > 0 ? limit : DEFAULT_ENCODE_IN_FLIGHT
  const outstanding = isFiniteNumber(inFlight) && inFlight > 0 ? Math.floor(inFlight) : 0
  return Object.freeze({
    action: outstanding >= bound ? 'wait' : 'push',
    outstanding,
    limit: bound,
    room: Math.max(0, bound - outstanding)
  })
}
