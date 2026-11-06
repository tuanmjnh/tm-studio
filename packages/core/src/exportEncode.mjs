// =============================================================================
//  tmcut-core — export encode laws (zero-FFmpeg slice H1; ladder in H2, the
//  audio clock in H3a, the mux order in H3b).
//
//  Slice A measured that nothing in this repo can export without FFmpeg, and
//  ADR-030 names the replacement: WebCodecs, asked first. These laws are
//  the parts of that loop that must not live in the IO layer, because an
//  exporter can only be reviewed by reading its decisions.
//
//  * `planEncodePresets` builds the list of configs worth ASKING about, which is
//    not the list of configs that work. The level comes from Annex A because
//    the level a file declares is what a phone checks later, and a codec comes
//    with the container that can hold it. Both spellings of AAC are asked: one
//    runtime answered `aac` false and `mp4a.40.2` true for the same encoder.
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
//  * `AUDIO_PACKET_FRAMES`, `encodeAudioSampleCount` and `planEncodeAudioSample`
//    are the second clock: a packet is placed by the samples it starts at, its
//    length is the difference of two rounded positions, and the last one carries
//    the remainder, so the audio end and the video end are the same number.
//  * `encodeAudioPacketCount` is that schedule counted up front, because a total
//    measured from packets as they arrive can only ever agree with itself.
//  * `planEncodeFinish` owns the order the file is closed in — feed both legs,
//    flush both encoders, drain, finalize — since every way to get it wrong writes
//    a short or unreadable file without an error, and a shortfall with nothing
//    outstanding is a stall, not a wait. `planEncodePacketMeta` writes the
//    encoder's decoder description with the first packet of a track and never
//    again, and `planEncodeProgress` reads the slower leg instead of the clock.
//
//  Pure: no timers, no browser globals, no encoder objects. The host owns the
//  API calls; this module owns what they mean.
// =============================================================================

import { rationalToFloat, TICKS_PER_SECOND } from './time.mjs'

/** The chroma rule, in the words the HTML-video contract already uses. */
export const ENCODER_EVEN_DIMENSION_REASON = 'the encoder subsamples chroma 2x2'

/** Frames allowed in the encoder at once when the caller names no limit. */
export const DEFAULT_ENCODE_IN_FLIGHT = 4

/**
 * Annex A levels worth asking about, tightest first. `maxMbPerFrame` and
 * `maxMbPerSecond` are the two constraints that decide whether a level may
 * carry a picture at all; the levels between them (3, 3.2, 4.1, 4.2) only ever
 * move those limits up, so leaving one out can make the answer looser than it
 * needs to be but never illegal — and 3.3/3.4/3.5 do not exist, measured on
 * this runtime they are refused at every raster.
 */
const AVC_LEVELS = Object.freeze([
  Object.freeze({ idc: '1f', maxMbPerFrame: 3600, maxMbPerSecond: 108_000 }),
  Object.freeze({ idc: '28', maxMbPerFrame: 8192, maxMbPerSecond: 245_760 }),
  Object.freeze({ idc: '32', maxMbPerFrame: 22_080, maxMbPerSecond: 589_824 }),
  Object.freeze({ idc: '33', maxMbPerFrame: 36_864, maxMbPerSecond: 983_040 }),
  Object.freeze({ idc: '34', maxMbPerFrame: 36_864, maxMbPerSecond: 2_073_600 })
])

/**
 * High profile: the one every player in scope decodes. It also matters for the
 * probe — Baseline 3.1 was measured refused at 1080p while High 4.0 was
 * accepted, so the profile and the level are one question, not two.
 */
const AVC_HIGH_PROFILE = '64'

/**
 * One candidate per family. Unlike H.264, VP9 and AV1 carry their level in a
 * field that is a code point count rather than a frame-size limit, and both
 * were measured accepted at every raster in scope up to 4K60, so there is
 * nothing for the ladder to choose.
 */
const VP9_CANDIDATE = 'vp09.00.50.08'
const AV1_CANDIDATE = 'av01.0.09M.08'

/**
 * The same codec, two spellings, two measured answers: this runtime refused
 * `aac` and accepted `mp4a.40.2`. An exporter that names one of them loses
 * audio on the machines that answer the other way.
 */
const MP4_AUDIO_CANDIDATES = Object.freeze(['mp4a.40.2', 'aac'])
const WEBM_AUDIO_CANDIDATE = 'opus'

/**
 * Samples one audio packet must carry, per codec spelling the ladder asks with.
 * This is not a tuning knob: AAC-LC IS 1024 samples per channel per frame, so
 * an AudioData of any other length is a different codec and the muxer would be
 * handed a file no decoder agrees to read. Opus allows several frame sizes and
 * 20 ms is the one the encoders in scope run at, which the app leg measures.
 */
export const AUDIO_PACKET_FRAMES = Object.freeze({
  'mp4a.40.2': 1024,
  'aac': 1024,
  'opus': 960
})

/**
 * A target bitrate is a quality decision, and the picture size alone sets it:
 * the bounds stop a 320x240 clip from being starved and a 4K60 clip from
 * asking for more than any encoder will accept.
 */
const ENCODE_BITS_PER_SAMPLE = 0.1
const ENCODE_BITRATE_FLOOR = 1_000_000
const ENCODE_BITRATE_CEILING = 40_000_000

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

/** Why a picture cannot be offered at any level, in the words a UI can show. */
function levelError(width, height, rate) {
  return `no Annex A level carries ${width}x${height} at ${rate.numerator}/${rate.denominator} fps; the export is refused instead of clamped to a level that would be illegal in the file`
}

/**
 * The levels worth asking about for one picture: the tightest that Annex A
 * allows, then the loosest, so a runtime that refuses the tight one for a
 * reason this module cannot see still gets a second question.
 */
function avcLevelsFor(width, height, fpsFloat) {
  const mbPerFrame = Math.ceil(width / 16) * Math.ceil(height / 16)
  const mbPerSecond = mbPerFrame * fpsFloat
  const fitting = AVC_LEVELS.filter(level => level.maxMbPerFrame >= mbPerFrame && level.maxMbPerSecond >= mbPerSecond)
  if (fitting.length === 0) return []
  const tightest = fitting[0]
  const loosest = fitting[fitting.length - 1]
  return tightest === loosest ? [tightest.idc] : [tightest.idc, loosest.idc]
}

function audioPresetErrors(audio) {
  if (audio === undefined || audio === null) return []
  if (!audio || typeof audio !== 'object') return ['audio: must be a { sampleRate, channelCount } pair or absent']
  const reasons = []
  if (!isInteger(audio.sampleRate) || audio.sampleRate <= 0) {
    reasons.push(`audio.sampleRate: must be a positive integer, got ${String(audio.sampleRate)}`)
  }
  if (!isInteger(audio.channelCount) || audio.channelCount <= 0) {
    reasons.push(`audio.channelCount: must be a positive integer, got ${String(audio.channelCount)}`)
  }
  return reasons
}

/**
 * The configs an exporter should ASK a runtime about, in preference order.
 *
 * This is not a capability table and must never be read as one: nothing here
 * knows what any machine can encode. The ladder only names the questions worth
 * asking — H.264 at the level the picture needs, VP9 and AV1 after it, each in
 * the container that can hold it, with both spellings of AAC because a runtime
 * was measured answering them differently. `planEncodeConfig` then decides with
 * the answers.
 *
 * @param {{ width?: number, height?: number, fps?: { numerator: number, denominator: number },
 *           audio?: { sampleRate: number, channelCount: number } | null }} input
 *   the output the user asked for
 * @returns {{ presets: object[], errors: string[] }}
 *   `presets` in preference order, empty when `errors` says why there are none
 */
export function planEncodePresets(input = {}) {
  const request = input && typeof input === 'object' ? input : {}
  const errors = []

  const widthError = evenDimensionError('width', request.width)
  if (widthError) errors.push(widthError)
  const heightError = evenDimensionError('height', request.height)
  if (heightError) errors.push(heightError)
  const fpsError = rationalError(request.fps)
  if (fpsError) errors.push(`fps: ${fpsError}`)
  errors.push(...audioPresetErrors(request.audio ?? null))
  if (errors.length > 0) return Object.freeze({ presets: Object.freeze([]), errors: Object.freeze(errors) })

  const { width, height, fps } = request
  const audio = request.audio ?? null
  const fpsFloat = rationalToFloat(fps)
  const bitrate = Math.min(
    ENCODE_BITRATE_CEILING,
    Math.max(ENCODE_BITRATE_FLOOR, Math.round(width * height * fpsFloat * ENCODE_BITS_PER_SAMPLE))
  )

  const levels = avcLevelsFor(width, height, fpsFloat)
  if (levels.length === 0) {
    return Object.freeze({ presets: Object.freeze([]), errors: Object.freeze([levelError(width, height, fps)]) })
  }

  const video = codec => Object.freeze({
    codec,
    width,
    height,
    fps: Object.freeze({ numerator: fps.numerator, denominator: fps.denominator }),
    bitrate
  })
  const withAudio = codec => (audio ? Object.freeze({ codec, sampleRate: audio.sampleRate, channelCount: audio.channelCount }) : null)

  const families = [
    ...levels.map(idc => ({ container: 'mp4', codec: `avc1.${AVC_HIGH_PROFILE}00${idc}`, audio: audio ? MP4_AUDIO_CANDIDATES : [null] })),
    { container: 'webm', codec: VP9_CANDIDATE, audio: audio ? [WEBM_AUDIO_CANDIDATE] : [null] },
    { container: 'webm', codec: AV1_CANDIDATE, audio: audio ? [WEBM_AUDIO_CANDIDATE] : [null] }
  ]

  const presets = families.flatMap(family => family.audio.map((audioCodec) => {
    const audioConfig = audio ? withAudio(audioCodec) : null
    const id = `${family.container}:${family.codec}:${width}x${height}@${fps.numerator}/${fps.denominator}`
      + (audioConfig ? `:${audioConfig.codec}` : '')
    return Object.freeze({ id, container: family.container, video: video(family.codec), audio: audioConfig })
  }))

  return Object.freeze({ presets: Object.freeze(presets), errors: Object.freeze([]) })
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
 * Where the audio of a project ends, in whole samples.
 *
 * @param {{ contentEndTicks?: number, sampleRate?: number }} input
 *   the same content end the video law is given, in ticks
 * @returns {number | null} the sample count, or null when either number is not
 *   a clock — the content usually ends BETWEEN two samples, so this is the one
 *   place that decision is rounded and it is never re-derived downstream
 */
export function encodeAudioSampleCount(input = {}) {
  const { contentEndTicks, sampleRate } = input
  if (!isFiniteNumber(contentEndTicks) || contentEndTicks <= 0) return null
  if (!isInteger(sampleRate) || sampleRate <= 0) return null
  return Math.round((contentEndTicks * sampleRate) / TICKS_PER_SECOND)
}

/**
 * One audio packet of the sequence, in the muxer's timescale.
 *
 * The audio half of the same rule {@link planEncodeSample} states for video: a
 * position is the count divided by the rate, rounded once. Multiplying one
 * packet's rounded length by the packet number is the tempting version and it
 * is wrong — 1024 samples at 44.1 kHz are 2089.80 units of a 90 kHz clock, so
 * the law rounds to 2090 and two of them say 4180, while the third packet's
 * real boundary is 6269.39: the file is one unit long by then and stays long.
 * The last packet carries what is left rather than a whole frame, which
 * is what lets the two clocks promise the muxer the same end.
 *
 * @param {{ index?: number, sampleRate?: number, framesPerPacket?: number,
 *           contentEndTicks?: number, timescale?: number }} input
 *   the packet's ordinal position, the rate the PCM was read at, and the frame
 *   size of the codec being encoded — `AUDIO_PACKET_FRAMES` names it
 * @returns {{ startSample: number, frames: number, timestamp: number, duration: number, isLast: boolean } | null}
 *   null when the packet starts at or after the end of the content, or when an
 *   input cannot describe a clock
 */
export function planEncodeAudioSample(input = {}) {
  const { index, sampleRate, framesPerPacket, timescale = 1_000_000 } = input
  if (!isInteger(index) || index < 0) return null
  if (!isInteger(sampleRate) || sampleRate <= 0) return null
  if (!isInteger(framesPerPacket) || framesPerPacket <= 0) return null
  if (!isFiniteNumber(timescale) || timescale <= 0) return null
  const totalSamples = encodeAudioSampleCount(input)
  if (totalSamples === null) return null

  const startSample = index * framesPerPacket
  if (startSample >= totalSamples) return null

  /** Where the sample at `position` starts — one rounding, from the count. */
  const startsAt = position => Math.round((position * timescale) / sampleRate)
  const frames = Math.min(framesPerPacket, totalSamples - startSample)
  const timestamp = startsAt(startSample)
  const end = startsAt(Math.min(startSample + framesPerPacket, totalSamples))
  return Object.freeze({
    startSample,
    frames,
    timestamp,
    duration: end - timestamp,
    isLast: startSample + frames >= totalSamples
  })
}

/** The output states a muxer reports, copied from the API the session drives. */
const ENCODE_OUTPUT_STATES = Object.freeze(['pending', 'started', 'canceled', 'finalizing', 'finalized'])

/** The highest a progress bar may read while the file is still open. */
export const ENCODE_PROGRESS_UNTIL_CLOSED = 0.99

/**
 * How many audio packets an export must carry.
 *
 * The session needs this before it starts: it is the number the last packet is
 * checked against, and a total that comes from counting packets as they arrive
 * can only ever agree with itself. The remainder is a packet of its own, so
 * this rounds UP where the sample count rounds to the nearest boundary — 48000
 * samples at 48 kHz are 46 whole AAC frames and 896 samples, and dropping those
 * samples writes a file 18.6 ms short that nothing reports.
 *
 * @param {{ contentEndTicks?: number, sampleRate?: number, framesPerPacket?: number }} input
 *   the same clock {@link planEncodeAudioSample} is given
 * @returns {number | null} the packet count, or null when an input cannot
 *   describe a clock or the codec has no frame size
 */
export function encodeAudioPacketCount(input = {}) {
  const { framesPerPacket } = input
  if (!isInteger(framesPerPacket) || framesPerPacket <= 0) return null
  const totalSamples = encodeAudioSampleCount(input)
  if (totalSamples === null) return null
  return Math.ceil(totalSamples / framesPerPacket)
}

/**
 * Whether the exporter may close the file, and what it still owes if it may not.
 *
 * Every failure mode of a flush is silent: finalize while the encoder still
 * holds frames and the tail is gone with no error; skip the flush and the last
 * frames die in a queue that was never asked to empty; write a second time after
 * a cancel and the container is corrupt. So the order is one function, in one
 * place, and the reasons come back as words the UI can show.
 *
 * Stall is its own answer. Every frame painted, both encoders flushed, nothing
 * in flight and the packet count still short is not a wait — no future callback
 * can add the packet that a flushed encoder will never emit (the common cause is
 * a first chunk that arrived without its decoder description and was held). A
 * driver told to `wait` there hangs with a half-written file and no error, which
 * is the one outcome worse than a refusal.
 *
 * @param {{ totalFrames?: number, framesQueued?: number, videoPackets?: number,
 *           audioPackets?: number, totalAudioPackets?: number, audioPacketsQueued?: number,
 *           videoInFlight?: number, audioInFlight?: number, videoParked?: number,
 *           audioParked?: number, videoFlushed?: boolean,
 *           audioFlushed?: boolean, outputState?: string, hasVideo?: boolean,
 *           hasAudio?: boolean }} input
 *   the counters of one running export; a leg the project does not have is
 *   named by `hasVideo` / `hasAudio` and never blocks on numbers it lacks.
 *   `audioPacketsQueued` counts samples handed to the audio encoder, which is
 *   what the close order waits on before it flushes that leg. `videoParked` /
 *   `audioParked` count packets that have left the encoder but are held back from
 *   the file for want of a decoder description; they default to zero because a
 *   driver with no such pile has nothing to report.
 * @returns {{ action: 'start'|'paint'|'pump'|'flush-video'|'flush-audio'|'wait'|'stalled'|'finalize'|'stop'|'done',
 *             ready: boolean, blocking: string[] } | null}
 *   `action` is the first thing still owed, `blocking` names everything owed;
 *   null when a counter or a state cannot be read, because a green light from
 *   nonsense numbers is worse than no green light
 */
export function planEncodeFinish(input = {}) {
  const {
    totalFrames, framesQueued, videoPackets, audioPackets, totalAudioPackets, audioPacketsQueued,
    videoInFlight, audioInFlight, videoParked = 0, audioParked = 0, videoFlushed, audioFlushed, outputState,
    hasVideo = true, hasAudio = true
  } = input
  const counters = [
    totalFrames, framesQueued, videoPackets, audioPackets, totalAudioPackets, audioPacketsQueued,
    videoInFlight, audioInFlight, videoParked, audioParked
  ]
  if (counters.some(value => !isInteger(value) || value < 0)) return null
  if (typeof videoFlushed !== 'boolean' || typeof audioFlushed !== 'boolean') return null
  if (!ENCODE_OUTPUT_STATES.includes(outputState)) return null

  if (outputState === 'finalized') {
    return Object.freeze({ action: 'done', ready: true, blocking: Object.freeze([]) })
  }
  if (outputState === 'canceled' || outputState === 'finalizing') {
    const reason = outputState === 'canceled' ? 'output-canceled' : 'output-finalizing'
    return Object.freeze({ action: 'stop', ready: false, blocking: Object.freeze([reason]) })
  }
  if (outputState === 'pending') {
    return Object.freeze({ action: 'start', ready: false, blocking: Object.freeze(['output-not-started']) })
  }

  const blocking = []
  if (hasVideo && framesQueued < totalFrames) blocking.push('frames-queued')
  if (hasAudio && audioPacketsQueued < totalAudioPackets) blocking.push('audio-not-queued')
  if (hasVideo && !videoFlushed) blocking.push('video-not-flushed')
  if (hasAudio && !audioFlushed) blocking.push('audio-not-flushed')
  if (hasVideo && videoInFlight > 0) blocking.push('video-in-flight')
  if (hasAudio && audioInFlight > 0) blocking.push('audio-in-flight')
  if (hasVideo && videoPackets < framesQueued) blocking.push('video-packets')
  if (hasAudio && audioPackets < totalAudioPackets) blocking.push('audio-packets')
  if (blocking.length === 0) {
    return Object.freeze({ action: 'finalize', ready: true, blocking: Object.freeze([]) })
  }

  // Only a packet count is still owed, and every encoder is flushed and drained:
  // nothing can arrive any more, so waiting would be a hang dressed as patience.
  // An in-flight count is the same kind of debt once every sample the leg was
  // handed has either been written into the file or is sitting in the seam's
  // parked pile: a slot is only released when a packet is parked or when its
  // write lands, and both of those are behind it — so a leg that still reports
  // work outstanding at that point has lost a release, and no future callback
  // will ever give it back.
  const drained = (inFlight, written, parked, handed) => inFlight > 0 && written + parked >= handed
  const owed = blocking.filter(reason => reason !== 'video-packets'
    && reason !== 'audio-packets'
    && !(reason === 'video-in-flight' && drained(videoInFlight, videoPackets, videoParked, framesQueued))
    && !(reason === 'audio-in-flight' && drained(audioInFlight, audioPackets, audioParked, audioPacketsQueued)))
  if (owed.length === 0) {
    return Object.freeze({ action: 'stalled', ready: false, blocking: Object.freeze(blocking) })
  }

  const first = blocking[0]
  const action = first === 'frames-queued'
    ? 'paint'
    : first === 'audio-not-queued'
      ? 'pump'
      : first === 'video-not-flushed'
        ? 'flush-video'
        : first === 'audio-not-flushed'
          ? 'flush-audio'
          : 'wait'
  return Object.freeze({ action, ready: false, blocking: Object.freeze(blocking) })
}

/**
 * What to hand the muxer alongside one packet.
 *
 * A container needs the encoder's decoder description — the `avcC` / `esds` a
 * WebCodecs encoder reports through its metadata callback — and it writes it
 * once, into the first packet of the track. A first packet written without it
 * produces a track no decoder can be pointed at, and writing it twice produces
 * a description that contradicts itself; so the description is passed with the
 * first packet only, and a first packet that arrives without one is held rather
 * than written bare.
 *
 * @param {{ packetsAdded?: number, hasMeta?: boolean }} input
 *   how many packets of this track the muxer already has, and whether this
 *   chunk arrived with a description attached
 * @returns {{ action: 'with-meta'|'hold'|'plain', reason?: string } | null}
 *   null when the count cannot be read
 */
export function planEncodePacketMeta(input = {}) {
  const { packetsAdded, hasMeta = false } = input
  if (!isInteger(packetsAdded) || packetsAdded < 0) return null
  if (typeof hasMeta !== 'boolean') return null
  if (packetsAdded > 0) {
    return Object.freeze({
      action: 'plain',
      reason: hasMeta ? 'description-already-written' : undefined
    })
  }
  return hasMeta
    ? Object.freeze({ action: 'with-meta', reason: 'first-packet' })
    : Object.freeze({ action: 'hold', reason: 'no-description' })
}

/**
 * How far the export has come, as a fraction of the work.
 *
 * The slowest leg is the whole answer: video cannot be ahead of the file, and a
 * bar that reads 100% while the muxer still holds packets is the reason people
 * do not trust progress bars. Nothing here is time-based — an export of the
 * same project on the same machine takes different seconds on every run, but it
 * always takes the same number of frames.
 *
 * @param {{ totalFrames?: number, framesDone?: number, totalAudioPackets?: number,
 *           audioPacketsDone?: number, outputState?: string }} input
 *   the counters of one running export; a leg the project does not have simply
 *   totals zero and is left out
 * @returns {number | null} 0..1, capped at
 *   {@link ENCODE_PROGRESS_UNTIL_CLOSED} until the output is finalized, and
 *   null when a counter cannot be read
 */
export function planEncodeProgress(input = {}) {
  const {
    totalFrames = 0, framesDone = 0, totalAudioPackets = 0, audioPacketsDone = 0, outputState
  } = input
  const counters = [totalFrames, framesDone, totalAudioPackets, audioPacketsDone]
  if (counters.some(value => !isInteger(value) || value < 0)) return null
  if (outputState !== undefined && !ENCODE_OUTPUT_STATES.includes(outputState)) return null

  const closed = outputState === 'finalized'
  if (closed) return 1
  const video = totalFrames === 0 ? null : Math.min(1, framesDone / totalFrames)
  const audio = totalAudioPackets === 0 ? null : Math.min(1, audioPacketsDone / totalAudioPackets)
  const shares = [video, audio].filter(share => share !== null)
  if (shares.length === 0) return 0
  const slowest = Math.min(...shares)
  return slowest >= 1 ? ENCODE_PROGRESS_UNTIL_CLOSED : slowest
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
