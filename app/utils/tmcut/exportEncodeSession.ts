/**
 * The encode session (zero-FFmpeg slice H3b, ADR-029 and ADR-030) — the loop that
 * turns painted frames and mixed PCM into one muxed file with no FFmpeg in it.
 *
 * Every decision is already core's: which config to encode with (H2), where a
 * frame sits (`planEncodeSample`), where a packet of audio sits
 * (`planEncodeAudioSample`), how many packets the file must carry
 * (`encodeAudioPacketCount`), how much may be in flight (`planEncodeQueue`),
 * whether the file may be closed and in what order (`planEncodeFinish`), what
 * rides with a packet (`planEncodePacketMeta`) and what a progress bar may
 * promise (`planEncodeProgress`). What lives here is the part that cannot be a
 * pure function: the calls themselves, and the bookkeeping a browser forces on a
 * loop that holds real buffers.
 *
 * One loop, one awaited step per iteration, no timers. The version this replaces
 * in every exporter that ever shipped — two concurrent legs and a closer racing
 * them — is the one where a file is finalized while an encoder still holds
 * frames, and it cannot be reviewed by reading it. `planEncodeFinish` says what
 * is owed; this file does exactly that, then asks again.
 *
 * The ports exist so a spec can watch the sequence: the run against a fake
 * runtime asserts the order, the giving-back of every frame and each failure path
 * without a GPU. The defaults are the browser's own WebCodecs and `mediabunny`,
 * which is imported here and nowhere else — the two specs that count the modules
 * allowed to hold a container now name this one as their only writer.
 */
import {
  AUDIO_PACKET_FRAMES,
  encodeAudioPacketCount,
  planEncodeAudioSample,
  planEncodeFinish,
  planEncodePacketMeta,
  planEncodeProgress,
  planEncodeQueue,
  planEncodeSample,
  rationalToFloat
} from 'tmcut-core'
import type { CoreEncodePreset } from 'tmcut-core'
import {
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat
} from 'mediabunny'

export type TmcutEncodeContainer = 'mp4' | 'webm'
export type TmcutEncodeAudio = NonNullable<CoreEncodePreset['audio']>
export type TmcutEncodeOutputState = 'pending' | 'started' | 'canceled' | 'finalizing' | 'finalized'
export type TmcutEncodeAction = 'start' | 'paint' | 'pump' | 'flush-video' | 'flush-audio' | 'wait' | 'stalled' | 'finalize' | 'stop' | 'done'

/** One encoded chunk, as the encoder hands it over. */
export interface TmcutEncodeChunk {
  type: 'key' | 'delta'
  /** Microseconds, from core's clock. */
  timestamp: number
  duration: number | null
}

/**
 * The WebCodecs metadata object. It is the output callback's SECOND argument and
 * belongs to no chunk — an `EncodedVideoChunk` has no `metadata` property, so a
 * seam that reads the chunk never finds the description and never writes a file.
 */
export interface TmcutEncodeMeta {
  decoderConfig?: unknown
}

export interface TmcutEncodeHandlers {
  output: (chunk: TmcutEncodeChunk, meta?: TmcutEncodeMeta) => void
  error: (error: Error) => void
}

/** The part of an encoder this session uses. */
export interface TmcutEncoderHandle {
  encode: (sample: unknown) => void
  flush: () => Promise<void>
  close: () => void
}

export interface TmcutCloseable {
  close: () => void
}

/** One `AudioData`, in the units the API asks for. */
export interface TmcutAudioDataInit {
  format: 'f32-planar'
  sampleRate: number
  numberOfChannels: number
  numberOfFrames: number
  /** Microseconds, like every other clock here. */
  timestamp: number
  /** Seconds — the one place the API disagrees with the laws. */
  duration: number
  /** `AudioDataInit` wants a view over a plain ArrayBuffer, which is what `planar` builds. */
  data: Float32Array<ArrayBuffer>
}

/** The muxer as this session sees it: open, two tracks, close, throw away. */
export interface TmcutMuxer {
  readonly state: TmcutEncodeOutputState
  start: () => Promise<void>
  addVideo: (chunk: TmcutEncodeChunk, description?: unknown) => Promise<void>
  addAudio: (chunk: TmcutEncodeChunk, description?: unknown) => Promise<void>
  finalize: () => Promise<void>
  cancel: () => Promise<void>
  result: () => Promise<unknown>
}

export interface TmcutMuxerTarget {
  container: TmcutEncodeContainer
  videoCodec: string | null
  audioCodec: string | null
}

export interface TmcutEncodePorts {
  createVideoEncoder?: (config: VideoEncoderConfig, handlers: TmcutEncodeHandlers) => TmcutEncoderHandle
  createAudioEncoder?: (config: AudioEncoderConfig, handlers: TmcutEncodeHandlers) => TmcutEncoderHandle
  createVideoFrame?: (source: unknown, init: { timestamp: number, duration: number }) => TmcutCloseable
  createAudioData?: (init: TmcutAudioDataInit) => TmcutCloseable
  createMuxer?: (target: TmcutMuxerTarget) => TmcutMuxer
}

/** One audio packet, in the samples the mixer has to fill. */
export interface TmcutPcmRequest {
  index: number
  startSample: number
  frames: number
  /** Microseconds, from core. */
  timestamp: number
  /** Microseconds, from core. */
  duration: number
}

export interface TmcutEncodeSessionAsk {
  container: TmcutEncodeContainer
  video: CoreEncodePreset['video'] | null
  audio: TmcutEncodeAudio | null
  /** Frames the project paints; the content end is what actually bounds it. */
  totalFrames: number
  contentEndTicks: number
  /** The compositor: one painted surface per frame index. */
  paint: (index: number) => unknown | Promise<unknown>
  /** The mixer: one plane per channel, starting at the sample the clock names. */
  pcm: (request: TmcutPcmRequest) => Float32Array[] | Promise<Float32Array[]>
  inFlight?: number
  signal?: AbortSignal
  onProgress?: (value: number) => void
}

export interface TmcutEncodeOutcome {
  videoPackets: number
  audioPackets: number
  /** 1 only once the muxer closed the file. */
  progress: number
  output: unknown
}

export interface TmcutEncodeSession {
  run: () => Promise<TmcutEncodeOutcome>
  cancel: () => Promise<void>
}

type LegKind = 'video' | 'audio'

/** One encoder's side of the run, and the counters `planEncodeFinish` reads. */
interface Leg {
  kind: LegKind
  /** Samples the encoder holds, or whose write has not landed. */
  inFlight: number
  /** Samples handed to the encoder. */
  queued: number
  /** Packets the muxer has taken. */
  packets: number
  flushed: boolean
  /** The decoder description, once this track's encoder has reported one. */
  description: unknown
  /** Chunks parked because the first packet must not be written without it. */
  parked: TmcutEncodeChunk[]
  /**
   * Samples the encoder has not returned yet, keyed by the timestamp it was
   * handed with. An encoder may reorder, so the chunk that comes back is not
   * necessarily the oldest sample still open, and closing the wrong one closes
   * a buffer the encoder still owns.
   */
  handed: Map<number, TmcutCloseable>
  chain: Promise<void>
}

/** The config as `VideoEncoder` must see it: a float frame rate, and an `avc`
 *  block only beside an `avc1` string — H2's probe config has the same shape
 *  because it is the same API. */
function videoEncoderConfig(video: CoreEncodePreset['video']): VideoEncoderConfig {
  const config: VideoEncoderConfig = {
    codec: video.codec,
    width: video.width,
    height: video.height,
    framerate: rationalToFloat(video.fps)
  }
  if (video.bitrate) config.bitrate = video.bitrate
  if (video.codec.startsWith('avc1.')) config.avc = { format: 'avc' }
  return config
}

function audioEncoderConfig(audio: TmcutEncodeAudio): AudioEncoderConfig {
  return { codec: audio.codec, sampleRate: audio.sampleRate, numberOfChannels: audio.channelCount }
}

/** `f32-planar` is one channel plane after another, which is how the mixer hands them out. */
function planar(planes: Float32Array[]): Float32Array<ArrayBuffer> {
  const frames = planes[0]?.length ?? 0
  // Over an explicit ArrayBuffer, because that is the buffer `AudioData` is allowed
  // to take ownership of; a view of a shared buffer would not typecheck here.
  const data = new Float32Array(new ArrayBuffer(frames * planes.length * 4))
  planes.forEach((plane, channel) => data.set(plane.subarray(0, frames), channel * frames))
  return data
}

function webVideoEncoder(config: VideoEncoderConfig, handlers: TmcutEncodeHandlers): TmcutEncoderHandle {
  if (typeof globalThis.VideoEncoder === 'undefined') {
    throw new Error('this runtime has no VideoEncoder; the encode capability should have refused first')
  }
  const encoder = new globalThis.VideoEncoder({
    output: (chunk, metadata) => handlers.output(chunk, metadata),
    error: handlers.error
  })
  // The constructor takes only the callbacks: a `VideoEncoder` handed a frame
  // before `configure` throws, and the H2 probe config is the same object.
  encoder.configure(config)
  return {
    encode: sample => encoder.encode(sample as VideoFrame),
    flush: () => encoder.flush(),
    close: () => encoder.close()
  }
}

function webAudioEncoder(config: AudioEncoderConfig, handlers: TmcutEncodeHandlers): TmcutEncoderHandle {
  if (typeof globalThis.AudioEncoder === 'undefined') {
    throw new Error('this runtime has no AudioEncoder; the encode capability should have refused first')
  }
  const encoder = new globalThis.AudioEncoder({
    output: (chunk, metadata) => handlers.output(chunk, metadata),
    error: handlers.error
  })
  encoder.configure(config)
  return {
    encode: sample => encoder.encode(sample as AudioData),
    flush: () => encoder.flush(),
    close: () => encoder.close()
  }
}

function webVideoFrame(source: unknown, init: { timestamp: number, duration: number }): TmcutCloseable {
  if (typeof globalThis.VideoFrame === 'undefined') {
    throw new Error('this runtime has no VideoFrame; it cannot paint an export')
  }
  return new globalThis.VideoFrame(source as CanvasImageSource, init)
}

function webAudioData(init: TmcutAudioDataInit): TmcutCloseable {
  if (typeof globalThis.AudioData === 'undefined') {
    throw new Error('this runtime has no AudioData; it cannot encode audio')
  }
  return new globalThis.AudioData(init)
}

/** `mediabunny` names a codec family, not a fourcc; its vocabulary stays in this file. */
function videoFamily(codec: string): 'avc' | 'hevc' | 'vp9' | 'vp8' | 'av1' {
  if (codec.startsWith('avc1.') || codec.startsWith('avc3.')) return 'avc'
  if (codec.startsWith('hvc1.') || codec.startsWith('hev1.')) return 'hevc'
  if (codec.startsWith('vp09')) return 'vp9'
  if (codec.startsWith('vp8')) return 'vp8'
  if (codec.startsWith('av01')) return 'av1'
  throw new Error(`the muxer has no codec family for ${codec}`)
}

function audioFamily(codec: string): 'aac' | 'opus' {
  if (codec.startsWith('mp4a') || codec === 'aac') return 'aac'
  if (codec.startsWith('opus')) return 'opus'
  throw new Error(`the muxer has no codec family for ${codec}`)
}

/** The default muxer: pre-encoded packets, straight into an MP4 or a WebM. */
function mediabunnyMuxer(target: TmcutMuxerTarget): TmcutMuxer {
  const format = target.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat()
  const buffer = new BufferTarget()
  const output = new Output({ format, target: buffer })
  const videoSource = target.videoCodec ? new EncodedVideoPacketSource(videoFamily(target.videoCodec)) : null
  const audioSource = target.audioCodec ? new EncodedAudioPacketSource(audioFamily(target.audioCodec)) : null
  // Tracks belong to the container before it starts, and the packet sources are how
  // pre-encoded packets reach them without the muxer running an encoder of its own.
  if (videoSource) output.addVideoTrack(videoSource)
  if (audioSource) output.addAudioTrack(audioSource)

  return {
    // The law reads the container's own state, never a copy of it.
    get state() {
      return output.state
    },
    start: () => output.start(),
    // Each leg is written through its own source: the two `add()` signatures differ
    // in the metadata they accept, and a shared helper would have to pretend they
    // do not. Both awaits are the writer's backpressure, not a receipt — ignoring
    // one is how an export outruns its own file.
    addVideo: async (chunk, description) => {
      if (!videoSource) return
      await videoSource.add(
        EncodedPacket.fromEncodedChunk(chunk as unknown as EncodedVideoChunk),
        description as EncodedVideoChunkMetadata | undefined
      )
    },
    addAudio: async (chunk, description) => {
      if (!audioSource) return
      await audioSource.add(
        EncodedPacket.fromEncodedChunk(chunk as unknown as EncodedAudioChunk),
        description as EncodedAudioChunkMetadata | undefined
      )
    },
    finalize: async () => {
      if (!output.hasEnoughTracks()) throw new Error('the file has no track to finalize')
      await output.finalize()
    },
    cancel: () => output.cancel(),
    // The buffer exists only once the file is closed.
    result: async () => new Blob([buffer.buffer ?? new ArrayBuffer(0)], { type: await output.getMimeType() })
  }
}

/**
 * The browser's own implementations, exported because they are the part of this
 * file a spec cannot reach by injecting ports: what the session hands a real
 * `VideoEncoder`, and what it expects back. A caller may override one port and
 * keep the rest by spreading this object.
 */
export const webEncodePorts: Required<TmcutEncodePorts> = {
  createVideoEncoder: webVideoEncoder,
  createAudioEncoder: webAudioEncoder,
  createVideoFrame: webVideoFrame,
  createAudioData: webAudioData,
  createMuxer: mediabunnyMuxer
}

/**
 * A session for one export of one project, driven by one accepted config.
 */
export function createEncodeSession(
  ask: TmcutEncodeSessionAsk,
  ports: TmcutEncodePorts = {}
): TmcutEncodeSession {
  const makeVideoEncoder = ports.createVideoEncoder ?? webVideoEncoder
  const makeAudioEncoder = ports.createAudioEncoder ?? webAudioEncoder
  const makeVideoFrame = ports.createVideoFrame ?? webVideoFrame
  const makeAudioData = ports.createAudioData ?? webAudioData
  const makeMuxer = ports.createMuxer ?? mediabunnyMuxer

  const hasVideo = Boolean(ask.video)
  const hasAudio = Boolean(ask.audio)
  const framesPerPacket = ask.audio ? AUDIO_PACKET_FRAMES[ask.audio.codec] : undefined

  const legs = new Map<LegKind, Leg>()
  const encoders = new Map<LegKind, TmcutEncoderHandle>()
  let muxer: TmcutMuxer | null = null
  let totalFrames = ask.totalFrames
  let totalAudioPackets = 0

  let failure: Error | null = null
  let cancelled = false
  let settled = false
  let wakes = 0
  let waiters: (() => void)[] = []
  let lastProgress = -1
  let running: Promise<TmcutEncodeOutcome> | null = null
  let releaseSignal: (() => void) | null = null

  function notify() {
    wakes += 1
    const list = waiters
    waiters = []
    for (const wake of list) wake()
  }

  /**
   * Sleep until a counter moves. `since` is taken before the plan is read, so a
   * chunk that lands while a step is being decided is never missed.
   */
  async function sleep(since: number): Promise<void> {
    if (wakes !== since) return
    await new Promise<void>(resolve => waiters.push(resolve))
  }

  function fail(error: Error) {
    if (failure || settled) return
    failure = error
    notify()
  }

  function leg(kind: LegKind): Leg {
    const found = legs.get(kind)
    if (!found) throw new Error(`this export has no ${kind} leg`)
    return found
  }

  function packetsOf(kind: LegKind): number {
    return legs.get(kind)?.packets ?? 0
  }

  function closeAll(who: Leg) {
    for (const [timestamp, sample] of who.handed) {
      who.handed.delete(timestamp)
      sample.close()
    }
  }

  /**
   * One chunk leaving an encoder: give back the sample it was made from, take the
   * description the browser passed beside it, then ask core whether the muxer may
   * have the packet yet.
   */
  function onChunk(who: Leg, chunk: TmcutEncodeChunk, meta?: TmcutEncodeMeta) {
    if (settled) return
    const sample = who.handed.get(chunk.timestamp)
    if (sample === undefined) {
      // The chunk's timestamp is the media timestamp of the sample it came from,
      // so one that matches nothing handed is a runtime contradicting core's
      // clock. Guessing which sample it owns would close a buffer another packet
      // still needs, and the file would carry a timestamp nobody painted.
      fail(new Error(`${who.kind}: the encoder returned a packet at ${chunk.timestamp} us that this run never handed it`))
      return
    }
    who.handed.delete(chunk.timestamp)
    sample.close()
    // Any chunk may carry it, and most runtimes put it on the first. Whatever
    // arrives first is the description this track will be pointed at.
    if (meta?.decoderConfig !== undefined && who.description === undefined) who.description = meta

    const step = planEncodePacketMeta({ packetsAdded: who.packets, hasMeta: who.description !== undefined })
    if (step === null) {
      fail(new Error(`${who.kind}: core could not read the packet counters`))
      return
    }
    if (step.action === 'hold') {
      // Held, not written bare: a track whose first packet carries no description is
      // a track no decoder can be pointed at. Its queue is released with it,
      // because the only thing that can change a hold is a description arriving —
      // and a slot kept by a packet that has already left the encoder is a count
      // nothing can ever lower again, which core now answers by refusing.
      who.parked.push(chunk)
      who.inFlight -= 1
      notify()
      return
    }
    // A parked chunk paid for its slot when it was held, so it must not release one
    // again here — a double release puts `inFlight` below zero and the close order
    // rightly refuses to read counters that cannot both be true.
    const parked = who.parked.splice(0, who.parked.length)
    write(who, [...parked.map(parkedChunk => ({ chunk: parkedChunk, credit: false })), { chunk, credit: true }])
  }

  /**
   * Serialize one leg's writes: a container takes packets in decode order, and the
   * promise `add()` returns is backpressure rather than a receipt.
   */
  function write(who: Leg, items: { chunk: TmcutEncodeChunk, credit: boolean }[]) {
    for (const item of items) {
      who.chain = who.chain.then(async () => {
        if (settled || !muxer) return
        const step = planEncodePacketMeta({ packetsAdded: who.packets, hasMeta: who.description !== undefined })
        if (step === null || step.action === 'hold') {
          fail(new Error(`${who.kind}: the first packet of this track reached the muxer with no decoder description`))
          return
        }
        const description = step.action === 'with-meta' ? who.description : undefined
        try {
          if (who.kind === 'video') await muxer.addVideo(item.chunk, description)
          else await muxer.addAudio(item.chunk, description)
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
          return
        }
        who.packets += 1
        // The queue slot is released with the write, never before: while a packet is
        // on its way the file still owes it, and `planEncodeFinish` must say `wait`
        // rather than `stalled`.
        if (item.credit) who.inFlight -= 1
        notify()
      })
    }
  }

  function openLeg(kind: LegKind) {
    const who: Leg = {
      kind,
      inFlight: 0,
      queued: 0,
      packets: 0,
      flushed: false,
      description: undefined,
      parked: [],
      handed: new Map(),
      chain: Promise.resolve()
    }
    legs.set(kind, who)
    const handlers: TmcutEncodeHandlers = {
      output: (chunk, meta) => onChunk(who, chunk, meta),
      error: error => fail(error)
    }
    const encoder = kind === 'video' && ask.video
      ? makeVideoEncoder(videoEncoderConfig(ask.video), handlers)
      : kind === 'audio' && ask.audio
        ? makeAudioEncoder(audioEncoderConfig(ask.audio), handlers)
        : null
    if (!encoder) throw new Error(`no ${kind} config was accepted for this export`)
    encoders.set(kind, encoder)
  }

  /** Hand one frame to the video encoder. False means the queue has no room. */
  async function paintOne(): Promise<boolean> {
    const video = ask.video
    if (!video || !hasVideo) return false
    const who = leg('video')
    if (who.queued >= totalFrames) return false
    if (planEncodeQueue({ inFlight: who.inFlight, limit: ask.inFlight }).action === 'wait') return false

    const sample = planEncodeSample({ index: who.queued, rate: video.fps, contentEndTicks: ask.contentEndTicks })
    if (sample === null) {
      // The content ends before the caller's frame count does. The clock wins: the
      // file gets the shorter length instead of hanging on a frame that is not there.
      totalFrames = who.queued
      return false
    }
    const source = await ask.paint(who.queued)
    const frame = makeVideoFrame(source, { timestamp: sample.timestamp, duration: sample.duration })
    handSample(who, sample.timestamp, frame)
    return true
  }

  /** Hand one packet of PCM to the audio encoder. */
  async function pumpOne(): Promise<boolean> {
    const audio = ask.audio
    if (!audio || !hasAudio) return false
    const who = leg('audio')
    if (who.queued >= totalAudioPackets) return false
    if (planEncodeQueue({ inFlight: who.inFlight, limit: ask.inFlight }).action === 'wait') return false

    const packet = planEncodeAudioSample({
      index: who.queued,
      sampleRate: audio.sampleRate,
      framesPerPacket: framesPerPacket ?? 0,
      contentEndTicks: ask.contentEndTicks
    })
    if (packet === null) {
      totalAudioPackets = who.queued
      return false
    }
    const planes = await ask.pcm({
      index: who.queued,
      startSample: packet.startSample,
      frames: packet.frames,
      timestamp: packet.timestamp,
      duration: packet.duration
    })
    const sample = makeAudioData({
      format: 'f32-planar',
      sampleRate: audio.sampleRate,
      numberOfChannels: planes.length,
      numberOfFrames: packet.frames,
      timestamp: packet.timestamp,
      // The one unit the API disagrees with the laws about: seconds, not microseconds.
      duration: packet.duration / 1_000_000,
      data: planar(planes)
    })
    handSample(who, packet.timestamp, sample)
    return true
  }

  function handSample(who: Leg, timestamp: number, sample: TmcutCloseable) {
    const encoder = encoders.get(who.kind)
    if (!encoder) throw new Error(`this export has no ${who.kind} encoder`)
    // Registered before the call, so the first chunk the encoder queues — every
    // one of them, when a runtime gives its whole queue back during `flush()` —
    // already finds the sample it was made from.
    who.handed.set(timestamp, sample)
    who.inFlight += 1
    who.queued += 1
    encoder.encode(sample)
    if (failure) throw failure
    notify()
  }

  async function feedOne(): Promise<void> {
    let moved = false
    if (hasVideo) moved = (await paintOne()) || moved
    if (hasAudio) moved = (await pumpOne()) || moved
    if (!moved) await sleep(wakes)
  }

  function counters() {
    const video = legs.get('video')
    const audio = legs.get('audio')
    return {
      totalFrames,
      framesQueued: video?.queued ?? 0,
      videoPackets: video?.packets ?? 0,
      totalAudioPackets,
      audioPacketsQueued: audio?.queued ?? 0,
      audioPackets: audio?.packets ?? 0,
      videoInFlight: video?.inFlight ?? 0,
      audioInFlight: audio?.inFlight ?? 0,
      videoParked: video?.parked.length ?? 0,
      audioParked: audio?.parked.length ?? 0,
      videoFlushed: video?.flushed ?? !hasVideo,
      audioFlushed: audio?.flushed ?? !hasAudio,
      outputState: muxer?.state ?? 'pending'
    }
  }

  function progressValue(): number {
    const counts = counters()
    const value = planEncodeProgress({
      totalFrames: counts.totalFrames,
      framesDone: counts.videoPackets,
      totalAudioPackets: counts.totalAudioPackets,
      audioPacketsDone: counts.audioPackets,
      outputState: counts.outputState
    })
    // The close order has just read and accepted these same counters, so a refusal
    // here is this file disagreeing with itself, not a state an export can be in.
    if (value === null) throw new Error('the progress bar could not read the counters')
    return value
  }

  function report() {
    if (!ask.onProgress) return
    const value = progressValue()
    if (value === lastProgress) return
    lastProgress = value
    ask.onProgress(value)
  }

  async function flushLeg(kind: LegKind) {
    const encoder = encoders.get(kind)
    if (!encoder) throw new Error(`this export has no ${kind} encoder`)
    await encoder.flush()
    leg(kind).flushed = true
    notify()
  }

  async function act(action: TmcutEncodeAction, since: number, blocking: readonly string[]): Promise<void> {
    switch (action) {
      case 'start':
        if (!muxer) throw new Error('the muxer was never created')
        await muxer.start()
        return
      case 'paint':
      case 'pump':
        await feedOne()
        return
      case 'flush-video':
        await flushLeg('video')
        return
      case 'flush-audio':
        await flushLeg('audio')
        return
      case 'finalize':
        if (!muxer) throw new Error('the muxer was never created')
        await muxer.finalize()
        return
      case 'stop':
        // A container that says it is closed for writes is not going to change its
        // mind, and waiting on one is a run that never ends. Both of its states —
        // canceled underneath us, or already being finalized by someone else — mean
        // this export cannot be the one that closes the file.
        throw new Error(`the container is ${muxer ? muxer.state : 'gone'} and this run may not write into it`)
      case 'stalled':
        throw new Error(
          `the encode stalled, still owing ${blocking.join(', ')}: `
          + `${packetsOf('video')}/${totalFrames} video and ${packetsOf('audio')}/${totalAudioPackets} audio packets reached the file`
        )
      default:
        await sleep(since)
    }
  }

  async function execute(): Promise<TmcutEncodeOutcome> {
    if (hasAudio && !framesPerPacket) {
      throw new Error(`core has no packet size for audio codec ${ask.audio?.codec ?? '?'}, so its clock cannot be scheduled`)
    }
    if (hasAudio) {
      const packets = encodeAudioPacketCount({
        contentEndTicks: ask.contentEndTicks,
        sampleRate: ask.audio?.sampleRate ?? 0,
        framesPerPacket
      })
      if (packets === null) throw new Error('the audio clock could not be counted')
      totalAudioPackets = packets
    }

    muxer = makeMuxer({
      container: ask.container,
      videoCodec: ask.video?.codec ?? null,
      audioCodec: ask.audio?.codec ?? null
    })
    if (hasVideo) openLeg('video')
    if (hasAudio) openLeg('audio')

    while (true) {
      if (cancelled) throw new Error('the encode session was cancelled')
      if (failure) throw failure
      const since = wakes
      const plan = planEncodeFinish(counters())
      if (plan === null) throw new Error('the close order refused these counters; the export cannot be promised')
      report()
      if (plan.action === 'done') break
      await act(plan.action as TmcutEncodeAction, since, plan.blocking)
    }

    const output = await muxer.result()
    report()
    return {
      videoPackets: packetsOf('video'),
      audioPackets: packetsOf('audio'),
      progress: progressValue(),
      output
    }
  }

  /**
   * Whatever happened, the samples and the encoders this run opened are given
   * back, and a file that will not be finished is thrown away rather than left
   * half-written.
   */
  async function teardown() {
    settled = true
    if (releaseSignal) releaseSignal()
    for (const who of legs.values()) closeAll(who)
    for (const encoder of encoders.values()) encoder.close()
    if (muxer && muxer.state !== 'finalized') await muxer.cancel()
    notify()
  }

  return {
    run(): Promise<TmcutEncodeOutcome> {
      if (running) return running
      if (ask.signal) {
        if (ask.signal.aborted) cancelled = true
        const signal = ask.signal
        const onAbort = () => {
          cancelled = true
          notify()
        }
        signal.addEventListener('abort', onAbort)
        // The caller's signal outlives the export; a listener left on it is a leak
        // the next export would inherit.
        releaseSignal = () => signal.removeEventListener('abort', onAbort)
      }
      running = execute()
        .then(async (outcome) => {
          await teardown()
          return outcome
        })
        .catch(async (error: unknown) => {
          await teardown()
          throw error instanceof Error ? error : new Error(String(error))
        })
      return running
    },
    async cancel() {
      cancelled = true
      notify()
      if (!running) return
      await running.catch(() => undefined)
    }
  }
}
