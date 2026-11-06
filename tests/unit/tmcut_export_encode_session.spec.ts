/**
 * The encode session: two encoders, one muxer, one order (zero-FFmpeg slice H3b,
 * ADR-029 and ADR-030).
 *
 * H1 put the timestamp law in core, H2 the question and the verdict, H3a the
 * audio clock, H3b the order the file is closed in. What is left is the loop
 * itself, and a loop is only worth a spec if the spec can watch it: this file
 * runs the session against a fake runtime and asserts the sequence, not the
 * pixels. Every assertion below is a way an exporter can produce a file that
 * opens, plays and is the wrong length — with no error thrown:
 *
 *  * Writing before `start()` is an API error, so the container has to be opened
 *    first; finalizing before the encoders flush drops their queues, which is
 *    the tail of the video.
 *  * The muxer needs the encoder's decoder description on the FIRST packet of a
 *    track. A runtime that hands it on a later chunk is answered by holding the
 *    packet, never by writing it bare.
 *  * `VideoFrame` and `AudioData` each hold a real buffer. One leaked per frame
 *    is a 1080p export that dies on a 90-second timeline.
 *  * The in-flight bound has to be the number core names, and a writer that
 *    backpressures has to be awaited, not raced.
 *  * A chunk has to give back the frame it was made from. An encoder may answer
 *    in decode order rather than the order it was handed, so "the oldest sample
 *    still open" is not always that frame — and closing a buffer the encoder
 *    still owns is a failure that only shows up on the machine that reorders.
 *  * An encoder error or a rejected `add()` has to fail the run. The alternative
 *    is a short file and a green progress bar.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_encode_session.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planEncodeAudioSample, planEncodeSample } from 'tmcut-core'
import { createEncodeSession, webEncodePorts } from '../../app/utils/tmcut/exportEncodeSession'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_2997 = { numerator: 30_000, denominator: 1001 }
const ONE_SECOND_TICKS = 120_000
const AAC = 'mp4a.40.2'
const VIDEO_CONFIG = { codec: 'avc1.640028', width: 640, height: 360, fps: RATE_30, bitrate: 2_000_000 }
const AUDIO_CONFIG = { codec: AAC, sampleRate: 48000, channelCount: 2 }

type Chunk = { type: 'key' | 'delta', timestamp: number, duration: number }
/**
 * WebCodecs hands the decoder description as the SECOND argument of `output`; an
 * `EncodedVideoChunk` has no `metadata` property to carry it. A seam that reads
 * the chunk is a seam that never finds a description on a real runtime.
 */
type Handlers = { output: (chunk: Chunk, meta?: unknown) => void, error: (error: Error) => void }
type Handle = { encode: (item: unknown) => void, flush: () => Promise<void>, close: () => void, queue: number }

/**
 * A runtime that behaves: every item it encodes comes back as a chunk a tick
 * later, the decoder description is passed to `output` the way the real API
 * passes it, and every counter the session needs is recorded in the order it
 * happened.
 */
function fakeRuntime(options: {
  videoDelay?: number
  stripVideoMeta?: boolean
  /** Which video chunk carries the description. Real H.264 encoders say the first. */
  videoMetaAt?: number
  failEncoderAt?: number
  failAddAt?: number
  /** Keep every frame until `flush()`, then give them back in decode order. */
  videoReorder?: boolean
} = {}) {
  const events: string[] = []
  const frames: { closed: number, timestamp: number, duration: number }[] = []
  const samples: { closed: number, init: Record<string, unknown> }[] = []
  const video: { chunk: Chunk, meta: unknown }[] = []
  const audio: { chunk: Chunk, meta: unknown }[] = []
  const configs: Record<string, unknown>[] = []
  const meta = { decoderConfig: { codec: 'avc1.640028' } }
  const audioMeta = { decoderConfig: { codec: AAC } }
  const state = {
    encodeCalls: 0, addCalls: 0, emittedVideo: 0, emittedAudio: 0,
    videoOutstanding: 0, maxVideoOutstanding: 0, closedVideo: 0, closedAudio: 0
  }
  // The rule the real API enforces: while the encoder holds a frame, closing it
  // is illegal, and reordering is what makes "the oldest one still open" the
  // wrong frame to close. Nothing else in this file can see the difference.
  const held = new Set<number>()
  const illegalCloses: number[] = []

  const makeEncoder = (kind: 'video' | 'audio', config: Record<string, unknown>, handlers: Handlers): Handle => {
    configs.push({ kind, ...config })
    const pending: { timestamp: number, duration: number }[] = []
    let closed = false
    return {
      get queue() {
        return kind === 'video' ? state.videoOutstanding : 0
      },
      encode(item: unknown) {
        if (closed) throw new Error(`${kind} encoder used after close`)
        state.encodeCalls++
        if (kind === 'video') {
          state.videoOutstanding++
          state.maxVideoOutstanding = Math.max(state.maxVideoOutstanding, state.videoOutstanding)
        }
        if (options.failEncoderAt === state.encodeCalls) {
          // An encoder that dies is an error, not a shorter file.
          handlers.error(new Error(`${kind} encoder died`))
          return
        }
        const timestamp = kind === 'video'
          ? Number((item as { timestamp: number }).timestamp)
          : Number((item as { init: Record<string, unknown> }).init.timestamp)
        const duration = kind === 'video'
          ? Number((item as { duration: number }).duration)
          : Math.round(Number((item as { init: Record<string, unknown> }).init.duration) * 1e6)
        const delay = kind === 'video' ? (options.videoDelay ?? 0) : 0
        if (kind === 'video') held.add(timestamp)
        if (kind === 'video' && options.videoReorder) {
          // Held, exactly as an encoder with a reorder window does: it gives
          // nothing back until `flush()`, and then it gives it back in decode
          // order, which is not the order it was handed.
          pending.push({ timestamp, duration })
          return
        }
        setTimeout(() => {
          if (kind === 'video') {
            state.videoOutstanding--
            held.delete(timestamp)
          }
          // Counted from the chunks this encoder handed out, not the packets the
          // session has managed to write: a session that holds a packet changes
          // nothing about what the runtime emits.
          const index = kind === 'video' ? state.emittedVideo++ : state.emittedAudio++
          const chunk: Chunk = { type: index === 0 ? 'key' : 'delta', timestamp, duration }
          const carries = kind === 'audio'
            ? index === 0
            : !options.stripVideoMeta && index === (options.videoMetaAt ?? 0)
          handlers.output(chunk, carries ? (kind === 'video' ? meta : audioMeta) : undefined)
        }, delay)
      },
      async flush() {
        events.push(`flush-${kind}`)
        if (kind !== 'video' || pending.length === 0) return
        // First the keyframe, then the frame the B-frame sits before, then the
        // frames between them: three presentation timestamps 0 / 33 333 / 66 667
        // come back as 0 / 66 667 / 33 333.
        const decodeOrder = pending.length > 2
          ? [pending[0], pending[pending.length - 1], ...pending.slice(1, pending.length - 1)]
          : [...pending]
        pending.length = 0
        for (const item of decodeOrder) {
          state.videoOutstanding--
          held.delete(item.timestamp)
          const index = state.emittedVideo++
          handlers.output(
            { type: index === 0 ? 'key' : 'delta', timestamp: item.timestamp, duration: item.duration },
            !options.stripVideoMeta && index === (options.videoMetaAt ?? 0) ? meta : undefined
          )
        }
      },
      close() {
        closed = true
        if (kind === 'video') state.closedVideo++
        else state.closedAudio++
      }
    }
  }

  /** A writer that stops accepting packets: `failAddAt` names which one fails. */
  const rejectSlowWriter = () => {
    state.addCalls += 1
    if (options.failAddAt === state.addCalls) throw new Error('writer rejected')
  }

  const muxer = {
    state: 'pending' as 'pending' | 'started' | 'canceled' | 'finalizing' | 'finalized',
    async start() {
      events.push('start')
      this.state = 'started'
    },
    async addVideo(chunk: Chunk, description?: unknown) {
      rejectSlowWriter()
      events.push(`video-${chunk.timestamp}`)
      video.push({ chunk, meta: description })
    },
    async addAudio(chunk: Chunk, description?: unknown) {
      rejectSlowWriter()
      events.push(`audio-${chunk.timestamp}`)
      audio.push({ chunk, meta: description })
    },
    async finalize() {
      events.push('finalize')
      this.state = 'finalized'
    },
    async cancel() {
      events.push('cancel')
      this.state = 'canceled'
    },
    async result() {
      return 'blob'
    }
  }

  return {
    events, frames, samples, video, audio, configs, muxer, state, illegalCloses,
    ports: {
      createVideoEncoder: (config: Record<string, unknown>, handlers: Handlers) => makeEncoder('video', config, handlers),
      createAudioEncoder: (config: Record<string, unknown>, handlers: Handlers) => makeEncoder('audio', config, handlers),
      createVideoFrame: (source: unknown, init: { timestamp: number, duration: number }) => {
        const frame = { closed: 0, timestamp: init.timestamp, duration: init.duration }
        frames.push(frame)
        const close = () => {
          frame.closed += 1
          if (held.has(frame.timestamp)) illegalCloses.push(frame.timestamp)
        }
        return { ...frame, close }
      },
      createAudioData: (init: Record<string, unknown>) => {
        const sample = { closed: 0, init }
        samples.push(sample)
        const close = () => {
          sample.closed += 1
        }
        return { ...sample, close }
      },
      createMuxer: () => muxer
    }
  }
}

const BASE = {
  container: 'mp4' as const,
  video: VIDEO_CONFIG,
  audio: AUDIO_CONFIG,
  totalFrames: 3,
  contentEndTicks: ONE_SECOND_TICKS,
  paint: () => ({ kind: 'canvas' }),
  pcm: async (packet: { frames: number }) => [
    new Float32Array(packet.frames),
    new Float32Array(packet.frames)
  ]
}

async function run(options: Parameters<typeof fakeRuntime>[0] = {}, ask: Record<string, unknown> = {}) {
  const runtime = fakeRuntime(options)
  const session = createEncodeSession({ ...BASE, ...ask }, runtime.ports as never)
  const outcome = await session.run()
  return { runtime, outcome, session }
}

/**
 * A run that cannot advance is not a run that is being careful. `inFlight` is a
 * rented slot, and the only way to prove a session gave a slot back is to refuse
 * it any more than it may hold: a session that keeps a slot it no longer needs
 * never paints the next frame, and the promise simply does not come. Naming the
 * deadline turns that hang into a failure with a sentence in it.
 */
async function settleWithin<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} never settled in ${ms}ms — it is waiting on work it already gave back`)), ms)
    })
    return await Promise.race([promise, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function main() {
  await check('the container is opened before a single packet is written', async () => {
    const { runtime } = await run()
    assert.equal(runtime.events[0], 'start', runtime.events.join(' '))
    assert.ok(runtime.events.includes('finalize'), 'the file has to be closed')
    assert.ok(runtime.events.indexOf('flush-video') >= 0, 'the video queue is drained, not dropped')
    assert.ok(runtime.events.indexOf('flush-audio') >= 0)
    assert.ok(runtime.events.indexOf('flush-video') < runtime.events.indexOf('finalize'))
  })

  await check('the config the runtime accepted is the config it is given', async () => {
    const { runtime } = await run()
    const video = runtime.configs.find(entry => entry.kind === 'video')!
    assert.equal(video!.codec, 'avc1.640028')
    assert.equal(video!.framerate, 30, 'the API wants a float frame rate, core keeps the rational one')
    assert.equal(video!.width, 640)
    const audio = runtime.configs.find(entry => entry.kind === 'audio')!
    assert.equal(audio!.numberOfChannels, 2, 'the API name for the channel count is numberOfChannels')
  })

  await check('frame timestamps come from core\'s rational rate, not a float fps', async () => {
    const { runtime } = await run({}, { totalFrames: 2, video: { ...VIDEO_CONFIG, fps: RATE_2997 } })
    assert.deepEqual(runtime.frames.map(frame => frame.timestamp), [0, 33_367])
    assert.deepEqual(runtime.video.map(entry => entry.chunk.timestamp), [0, 33_367])
  })

  await check('the tail of the video is the content, not a whole frame', async () => {
    // 11000 ticks is 91667 microseconds: three frames at 30 fps is 100000, so a
    // session that muxed whole frames would write a file 8333 microseconds long
    // and the timeline would be 91667. The durations are core's, re-read here.
    const contentEndTicks = 11_000
    const { runtime } = await run({}, { contentEndTicks })
    const expected = [0, 1, 2].map(index => planEncodeSample({ index, rate: RATE_30, contentEndTicks }))
    assert.deepEqual(runtime.frames.map(frame => frame.duration), expected.map(sample => sample!.duration))
    assert.deepEqual(runtime.frames.map(frame => frame.timestamp), expected.map(sample => sample!.timestamp))
    const sum = runtime.frames.reduce((total, frame) => total + frame.duration, 0)
    assert.equal(sum, 91_667, 'the frames add up to the content, not past it')
  })

  await check('the decoder description rides the first packet of each track only', async () => {
    const { runtime } = await run()
    assert.ok(runtime.video[0].meta, 'the muxer needs a codec description to write a track')
    assert.ok(runtime.video.slice(1).every(entry => entry.meta === undefined), 'a second copy is a second description')
    assert.ok(runtime.audio[0].meta)
    assert.ok(runtime.audio.slice(1).every(entry => entry.meta === undefined))
  })

  await check('a first packet with no description is held, not written bare', async () => {
    const runtime = fakeRuntime({ stripVideoMeta: true })
    const session = createEncodeSession(BASE, runtime.ports as never)
    // The encoder flushed with the video track still undescribed, so no callback
    // can ever fix it. The run has to end as a refusal; a session that waited for
    // a description that cannot arrive hangs with an open file and no error.
    await assert.rejects(() => session.run(), /stalled/)
    assert.equal(runtime.video.length, 0, 'no packet was written for a track nobody described')
    assert.ok(!runtime.events.includes('finalize'), 'and the file is not closed on top of it')
    assert.equal(runtime.muxer.state, 'canceled', 'the half-file is thrown away, not left open')
  })

  await check('a description that arrives late still rides the first packet', async () => {
    // A runtime that reports the codec description on its third chunk is legal, and
    // the two packets already produced still have to reach the file — in decode
    // order, with the description attached to the first one. A session that writes
    // them bare, out of order, or that releases their queue slots twice cannot be
    // told apart from one that works until the file is open in a player.
    const { runtime } = await run({ videoMetaAt: 2 })
    assert.deepEqual(runtime.video.map(entry => entry.chunk.timestamp), [0, 33_333, 66_667])
    assert.ok(runtime.video[0].meta, 'the first packet carries it')
    assert.ok(runtime.video.slice(1).every(entry => entry.meta === undefined), 'and only the first')
    assert.equal(runtime.frames.filter(frame => frame.closed === 1).length, 3)
  })

  await check('a packet held for its description gives back the queue slot it rented', async () => {
    // One slot, three frames, and the description only on the last chunk. The two
    // packets before it are parked, so they are no longer the encoder's work — if
    // a held packet keeps its slot, the third frame is never painted, the parked
    // pair is never flushed, and this run sits waiting for a free place in a queue
    // it has already emptied.
    const runtime = fakeRuntime({ videoMetaAt: 2 })
    const session = createEncodeSession({ ...BASE, inFlight: 1 }, runtime.ports as never)
    await settleWithin(session.run(), 3_000, 'a bounded export whose packets were parked')
    assert.equal(runtime.video.length, 3, 'every parked packet still reaches the file')
    assert.deepEqual(runtime.video.map(entry => entry.chunk.timestamp), [0, 33_333, 66_667], 'in decode order')
    assert.ok(runtime.video[0].meta, 'with the description on the first of them')
    assert.equal(runtime.frames.length, 3, 'and the queue never starved the paint')
  })

  await check('audio packets are placed by the sample count and every one arrives', async () => {
    const { runtime } = await run()
    // One second at 48 kHz is 46 full AAC frames and 896 samples left over.
    assert.equal(runtime.audio.length, 47)
    assert.deepEqual(runtime.audio.slice(0, 3).map(entry => entry.chunk.timestamp), [0, 21_333, 42_667])
    assert.deepEqual(runtime.samples.slice(0, 2).map(sample => sample.init.numberOfFrames), [1024, 1024])
    assert.equal(runtime.samples[46].init.numberOfFrames, 48000 - 46 * 1024, 'the last packet carries the remainder')
    const sum = runtime.audio.reduce((total, entry) => total + entry.chunk.duration, 0)
    assert.equal(sum, 1_000_000, 'the audio ends exactly where the content ends')
  })

  await check('AudioData is promised seconds while its timestamp stays microseconds', async () => {
    const { runtime } = await run()
    const first = runtime.samples[0].init
    // The number is core's, re-read: the session converts the unit, it does not
    // re-derive the clock.
    const packet = planEncodeAudioSample({
      index: 0, sampleRate: 48000, framesPerPacket: 1024, contentEndTicks: ONE_SECOND_TICKS
    })!
    assert.equal(first.timestamp, packet.timestamp, 'the timestamp the API wants is microseconds')
    assert.equal(first.duration, packet.duration / 1_000_000, 'the duration the API wants is seconds')
    assert.equal(first.format, 'f32-planar')
    assert.equal(first.numberOfChannels, 2)
  })

  await check('every frame and sample is given back', async () => {
    const { runtime } = await run({ videoDelay: 2 })
    assert.equal(runtime.frames.length, 3)
    assert.ok(runtime.frames.every(frame => frame.closed === 1), 'every VideoFrame is closed exactly once')
    assert.ok(runtime.samples.every(sample => sample.closed === 1), 'every AudioData is closed exactly once')
    assert.deepEqual(runtime.illegalCloses, [], 'no frame closed while the encoder still held it')
    assert.equal(runtime.state.closedVideo, 1)
    assert.equal(runtime.state.closedAudio, 1)
  })

  await check('a chunk gives back the sample it was made from, not the next one in line', async () => {
    // An encoder with a reorder window answers a B-frame pattern out of order:
    // handed 0 / 33 333 / 66 667, it returns 0 / 66 667 / 33 333, and the chunk
    // carrying 66 667 was made from the frame the session handed it third. Closing
    // "the oldest sample still open" therefore closes a frame the encoder still
    // owns — the real API does not tolerate that — while the frame that actually
    // produced the packet is never given back. Nothing about the file changes: the
    // export works, plays, and leaks or crashes on the machine that reorders.
    const runtime = fakeRuntime({ videoReorder: true })
    const session = createEncodeSession(BASE, runtime.ports as never)
    await settleWithin(session.run(), 3_000, 'a reordered encode')
    assert.deepEqual(runtime.video.map(entry => entry.chunk.timestamp), [0, 66_667, 33_333],
      'the container is fed decode order, not presentation order')
    assert.deepEqual(runtime.illegalCloses, [], 'each chunk closed its own frame')
    assert.ok(runtime.frames.every(frame => frame.closed === 1), 'and every frame exactly once')
  })

  await check('the in-flight bound is the one core names', async () => {
    const { runtime } = await run({ videoDelay: 4 }, { totalFrames: 6, inFlight: 1 })
    assert.equal(runtime.frames.length, 6, 'a bounded queue still writes every frame')
    assert.equal(runtime.state.maxVideoOutstanding, 1, `the queue reached ${runtime.state.maxVideoOutstanding} with a bound of 1`)
    const loose = await run({ videoDelay: 4 }, { totalFrames: 6 })
    assert.ok(loose.runtime.state.maxVideoOutstanding > 1, 'the bound is what makes it wait, not luck')
  })

  await check('an encoder error fails the run instead of shortening the file', async () => {
    const session = createEncodeSession(BASE, fakeRuntime({ failEncoderAt: 2 }).ports as never)
    await assert.rejects(() => session.run(), /encoder died/)
  })

  await check('a writer that rejects fails the run and closes what it opened', async () => {
    const runtime = fakeRuntime({ failAddAt: 3 })
    const session = createEncodeSession(BASE, runtime.ports as never)
    await assert.rejects(() => session.run(), /writer rejected/)
    assert.equal(runtime.muxer.state, 'canceled', 'a half-written file is not left open')
    assert.ok(!runtime.events.includes('finalize'))
  })

  await check('an audio-less project writes a video-only file', async () => {
    const { runtime } = await run({}, { audio: null })
    assert.equal(runtime.audio.length, 0)
    assert.ok(!runtime.events.includes('flush-audio'), 'a leg the project does not have never blocks the close')
    assert.ok(runtime.events.includes('finalize'))
  })

  await check('progress is the slower leg and never promises a file early', async () => {
    const seen: number[] = []
    const runtime = fakeRuntime({ videoDelay: 3 })
    const session = createEncodeSession({ ...BASE, onProgress: (value: number) => seen.push(value) }, runtime.ports as never)
    const outcome = await session.run()
    assert.ok(seen.length > 0, 'a caller can watch the run')
    assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'a bar that walks backwards is not a bar')
    assert.ok(seen.every(value => value >= 0 && value <= 1))
    assert.ok(seen.slice(0, -1).every(value => value < 1), 'not 100% while the muxer still holds the file')
    assert.equal(outcome.progress, 1, '100% means the muxer closed the file')
    assert.equal(outcome.videoPackets, 3)
    assert.equal(outcome.audioPackets, 47)
    assert.equal(outcome.output, 'blob')
  })

  await check('a cancelled run writes nothing more and cancels the container', async () => {
    const controller = new AbortController()
    const runtime = fakeRuntime({ videoDelay: 3 })
    const session = createEncodeSession(
      { ...BASE, totalFrames: 6, signal: controller.signal },
      runtime.ports as never
    )
    const pending = session.run()
    await new Promise(resolve => setTimeout(resolve, 5))
    await session.cancel()
    await assert.rejects(() => pending, /cancel/i)
    assert.ok(runtime.events.includes('cancel'))
    assert.ok(!runtime.events.includes('finalize'))
    assert.ok(runtime.frames.every(frame => frame.closed === 1), 'a cancelled run still gives its frames back')
  })

  /**
   * A stand-in for one of the runtime's encoders. It records the order the API is
   * used in and hands its `output` callback back, so a check can call it exactly
   * the way the browser does — chunk first, metadata beside it.
   */
  function stubEncoder(log: string[]) {
    let emit: ((chunk: unknown, meta?: unknown) => void) | null = null
    class Stub {
      constructor(init: { output: (chunk: unknown, meta?: unknown) => void, error: (error: Error) => void }) {
        emit = init.output
        log.push('construct')
      }

      configure(config: Record<string, unknown>) {
        log.push(`configure:${config.codec}`)
      }

      encode() {
        log.push('encode')
      }

      flush() {
        log.push('flush')
        return Promise.resolve()
      }

      close() {
        log.push('close')
      }
    }
    return { Stub, fire: (chunk: unknown, meta?: unknown) => emit?.(chunk, meta) }
  }

  /** Install a stubbed encoder for the duration of one call. */
  async function withStubEncoder(kind: 'Video' | 'Audio', build: (log: string[], stub: ReturnType<typeof stubEncoder>) => Promise<void>) {
    const slot = `${kind}Encoder`
    const previous = (globalThis as Record<string, unknown>)[slot]
    const log: string[] = []
    const stub = stubEncoder(log)
    ;(globalThis as Record<string, unknown>)[slot] = stub.Stub
    try {
      await build(log, stub)
    } finally {
      ;(globalThis as Record<string, unknown>)[slot] = previous
    }
  }

  await check('the encoder a default port builds is configured before it is used', async () => {
    // `new VideoEncoder(init)` does not set the codec; `encode()` on an
    // unconfigured encoder throws the moment a real export starts. A spec that
    // injects its own encoder can never see this, because the constructor is the
    // browser's.
    await withStubEncoder('Video', async (log, stub) => {
      const encoder = webEncodePorts.createVideoEncoder!(
        { codec: 'avc1.640028', width: 640, height: 360, framerate: 30 } as never,
        { output: () => {}, error: () => {} }
      )
      encoder.encode({})
      await encoder.flush()
      encoder.close()
      assert.deepEqual(log, ['construct', 'configure:avc1.640028', 'encode', 'flush', 'close'])
      void stub
    })
    await withStubEncoder('Audio', async (log, stub) => {
      const encoder = webEncodePorts.createAudioEncoder!(
        { codec: AAC, sampleRate: 48000, numberOfChannels: 2 } as never,
        { output: () => {}, error: () => {} }
      )
      encoder.encode({})
      await encoder.flush()
      encoder.close()
      assert.deepEqual(log, ['construct', `configure:${AAC}`, 'encode', 'flush', 'close'])
      void stub
    })
  })

  await check('a default port hands over the metadata the browser passes beside the chunk', async () => {
    // The decoder description is the output callback's SECOND argument. A port that
    // forwards only the chunk loses it, and the file it muxes has no track any
    // decoder can be pointed at — which is exactly what H3b's own law then refuses.
    const description = { decoderConfig: { codec: 'avc1.640028' } }
    await withStubEncoder('Video', async (_log, stub) => {
      const seen: unknown[][] = []
      webEncodePorts.createVideoEncoder!(
        { codec: 'avc1.640028', width: 640, height: 360, framerate: 30 } as never,
        { output: (chunk, meta) => seen.push([chunk, meta]), error: () => {} }
      )
      stub.fire({ type: 'key', timestamp: 0, duration: 33_333 }, description)
      assert.equal(seen.length, 1)
      assert.equal(seen[0][1], description, 'the metadata arrives with the chunk, not instead of it')
    })
    await withStubEncoder('Audio', async (_log, stub) => {
      const seen: unknown[][] = []
      webEncodePorts.createAudioEncoder!(
        { codec: AAC, sampleRate: 48000, numberOfChannels: 2 } as never,
        { output: (chunk, meta) => seen.push([chunk, meta]), error: () => {} }
      )
      const audioDescription = { decoderConfig: { codec: AAC } }
      stub.fire({ type: 'key', timestamp: 0, duration: 21_333 }, audioDescription)
      assert.equal(seen[0][1], audioDescription)
    })
  })

  await check('the arithmetic stays in core', () => {
    const source = read('app/utils/tmcut/exportEncodeSession.ts')
    for (const law of [
      'planEncodeSample', 'planEncodeAudioSample', 'encodeAudioPacketCount', 'planEncodeFinish',
      'planEncodePacketMeta', 'planEncodeProgress', 'planEncodeQueue', 'AUDIO_PACKET_FRAMES'
    ]) {
      assert.match(source, new RegExp(law), `${law} is core's decision`)
    }
    assert.doesNotMatch(source, /Math\.round\(/, 'no second place rounds a clock')
    assert.match(source, /from 'mediabunny'/, 'the muxer belongs here and nowhere else')
    // The description is not a chunk property: a seam that reads `chunk.metadata`
    // finds nothing on any real runtime and stalls every export it builds.
    assert.doesNotMatch(source, /\.metadata\b/, 'the metadata argument is the only place it lives')
  })

  await check('the seam reports every counter the close order reads', () => {
    const source = read('app/utils/tmcut/exportEncodeSession.ts')
    const block = source.slice(source.indexOf('function counters()'))
    const reported = new Set(
      Array.from(block.slice(0, block.indexOf('\n  }')).matchAll(/^ {6}(\w+)(?::|,)/gm), match => match[1])
    )
    // A counter core reads but the run never reports is read as `undefined`, and
    // the close order answers with `null` — or, for the parked pile, with a `wait`
    // on a slot that nothing will ever release again.
    for (const field of [
      'totalFrames', 'framesQueued', 'videoPackets', 'totalAudioPackets', 'audioPacketsQueued',
      'audioPackets', 'videoInFlight', 'audioInFlight', 'videoParked', 'audioParked',
      'videoFlushed', 'audioFlushed', 'outputState'
    ]) {
      assert.ok(reported.has(field), `planEncodeFinish reads ${field}, so this run has to report it`)
    }
  })

  console.log(`\n=== All ${passed} export-encode-session checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
