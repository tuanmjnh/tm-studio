/**
 * The export glue (zero-FFmpeg slice H3d-2c, ADR-029/030) — the first real caller
 * of the encode session.
 *
 * H3d-1 put two laws in core (which projects may be painted, where a plate
 * lands) and H3d-2a the sample law for one audio packet; H3c proved the session
 * can turn samples into a file. What was missing is the caller that stands
 * between a project in memory and that session: it asks the runtime, hands the
 * session one painted canvas per frame index, and reports an honest outcome.
 * That caller is `app/utils/tmcut/webCodecsExport.ts`, and like every other glue
 * in this directory it holds NO platform code — the plate reader, the canvas,
 * the surface law and the mixer are parameters, so all of it runs under plain
 * Node.
 *
 * What is pinned, in order:
 *  - the content law runs FIRST: a refused project costs one core call — no
 *    runtime probe, no canvas, no decode — and core's words come back verbatim;
 *  - a runtime that accepts nothing is a second, separate refusal, and it starts
 *    neither a session nor a canvas;
 *  - what the session is ASKED FOR is core's answer and nobody else's: the
 *    container and config from the capability, the frame count and content end
 *    from the verdict, the canvas size from the verdict;
 *  - the tick a frame paints at is core's grid at the index the session named —
 *    not a counter this file keeps, and not a playhead it integrates;
 *  - the picture is the plan's `paint`-role surfaces only, in the plan's order,
 *    and every plate lands on the rect `planEncodePlate` answered for it;
 *  - a frame begins at `encodeCanvasFill`'s colour, so a plate that moved cannot
 *    leave the previous frame behind;
 *  - a plate that will not decode is a FAILURE, not a black frame: the file would
 *    otherwise carry a moment the preview never showed;
 *  - the mixer and the progress callback are handed over UNCHANGED, because a
 *    glue that re-stamps an audio request or re-scales a progress number is a
 *    second clock;
 *  - a project with sound and no mixer wired refuses to run rather than mixing
 *    silence into the file, and a silent project gets a mixer that throws — a
 *    silent file has no answer to give;
 *  - the canvas is created once per export and given back once, however it ended;
 *  - an aborted caller stops before anything is asked, and an export that dies
 *    with the caller's signal is reported as cancelled, not failed;
 *  - the glue never invents a refusal word of its own.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_web_codecs_export.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Assigned from core in `main` — the fixtures are only built after that. */
let T = 0
const FPS = Object.freeze({ numerator: 30, denominator: 1 })
const CANVAS = Object.freeze({ width: 640, height: 360 })

/** An eligible project: one footage row, one clip, a colour background. */
function project(overrides: Record<string, unknown> = {}) {
  return {
    version: 3,
    canvas: { ...CANVAS, fps: FPS, background: { type: 'color', value: '#101820' } },
    markers: [],
    tracks: [{
      id: 'row-a',
      type: 'video',
      items: [{
        id: 'a',
        type: 'video',
        src: 'C:/media/a.mp4',
        source: { in: 0, out: 3 * T },
        timeline: { start: 0, duration: 3 * T },
        speed: 1,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        effects: [],
        keyframes: []
      }]
    }],
    ...overrides
  }
}

/** A 16:9 plate, so one `fit` on a 16:9 canvas covers it exactly. */
const PLATE = { width: 1920, height: 1080, image: { marker: 'plate' } }

/** One footage surface, in the shape the injected surface law answers with. */
function surface(overrides: Record<string, unknown> = {}) {
  return {
    role: 'paint',
    clip: { id: 'a', src: 'C:/media/a.mp4' },
    layer: {
      layout: { fit: 'fit', focusX: 0.5, focusY: 0.5, cropRect: null },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
      opacity: 1
    },
    mediaTimeSec: 0,
    ...overrides
  }
}

const VIDEO_CONFIG = Object.freeze({
  codec: 'avc1.42001f', width: 640, height: 360, fps: FPS
})
const AUDIO_CONFIG = Object.freeze({ codec: 'mp4a.40.2', sampleRate: 48_000, channelCount: 2 })

interface SpyCanvas {
  element: unknown
  created: [number, number]
  began: Array<string | null>
  drawn: Array<{ plate: unknown, rect: unknown }>
  disposed: number
}

interface HarnessOptions {
  surfaces?: (evaluation: { at: number }) => unknown[]
  decision?: Record<string, unknown> | null
  plate?: unknown
  indices?: number[]
  outcome?: Record<string, unknown>
  sessionThrows?: Error | null
  /** The fake session also pumps one audio packet, to prove who the mixer is. */
  pump?: boolean
  /** The harness aborts the caller's signal while the session runs. */
  abortWhileRunning?: boolean
  pcm?: unknown
  /** A file with sound and NO mixer wired: the one shape the glue must refuse. */
  noMixer?: boolean
}

interface Harness {
  canvases: SpyCanvas[]
  asks: Record<string, unknown>[]
  plateAsks: Record<string, unknown>[]
  ticks: number[]
  decided: unknown[]
  controller: AbortController
  run: (ask: Record<string, unknown>) => Promise<Record<string, unknown>>
}

/** The module under test, with its ports left plain so the fake can hand anything. */
interface GlueModule {
  createWebCodecsExport: (deps: Record<string, unknown>) => {
    run: (ask: Record<string, unknown>) => Promise<Record<string, unknown>>
  }
}

/**
 * The whole browser, faked: a canvas that remembers every call, a decoder that
 * answers, a runtime that accepts, a session that paints in whatever order it
 * likes. Only `webCodecsExport.ts` is real here.
 */
function harness(glue: GlueModule, options: HarnessOptions = {}): Harness {
  const spy: Harness = {
    canvases: [],
    asks: [],
    plateAsks: [],
    ticks: [],
    decided: [],
    controller: new AbortController(),
    run: async () => ({})
  }
  const surfaces = options.surfaces ?? (() => [surface()])
  // The capability answers a config WITH sound by default, so a mixer is wired
  // by default too; only the check that proves the no-mixer refusal opts out.
  const mixer = options.noMixer
    ? null
    : (options.pcm ?? (async () => [new Float32Array(4), new Float32Array(4)]))

  function createCanvas(width: number, height: number): unknown {
    const canvas: SpyCanvas = {
      element: { marker: `canvas-${spy.canvases.length}` },
      created: [width, height],
      began: [],
      drawn: [],
      disposed: 0
    }
    spy.canvases.push(canvas)
    return {
      element: canvas.element,
      begin: (fill: string | null) => { canvas.began.push(fill ?? null) },
      draw: (plate: unknown, rect: unknown) => { canvas.drawn.push({ plate, rect }) },
      dispose: () => { canvas.disposed++ }
    }
  }

  function readPlate(ask: Record<string, unknown>): Promise<unknown> {
    spy.plateAsks.push(ask)
    return Promise.resolve(options.plate === undefined ? PLATE : options.plate)
  }

  const capability = {
    async decide(request: unknown): Promise<unknown> {
      spy.decided.push(request)
      if (options.decision === null) throw new Error('the probe died')
      return options.decision ?? {
        kind: 'ready',
        container: 'mp4',
        errors: [],
        config: { id: 'avc1-640', video: VIDEO_CONFIG, audio: AUDIO_CONFIG }
      }
    }
  }

  function session(ask: Record<string, unknown>) {
    spy.asks.push(ask)
    return {
      async run() {
        // The way an abort really lands: the caller says stop while the session
        // is working, and the session dies with it.
        if (options.abortWhileRunning) spy.controller.abort()
        if (options.sessionThrows) throw options.sessionThrows
        for (const index of options.indices ?? [0, 1, 2]) {
          await (ask.paint as (i: number) => unknown)(index)
        }
        if (options.pump) await (ask.pcm as (r: unknown) => unknown)({ index: 0, startSample: 0, frames: 4, timestamp: 0, duration: 1000 })
        return options.outcome ?? { videoPackets: 3, audioPackets: 1, progress: 1, output: { marker: 'blob' } }
      },
      async cancel() {}
    }
  }

  const deps: Record<string, unknown> = {
    readPlate,
    createCanvas,
    surfaces: (evaluation: { at: number }) => {
      spy.ticks.push(evaluation.at)
      return surfaces(evaluation)
    },
    capability,
    session
  }
  if (mixer) deps.pcm = mixer
  const exporter = glue.createWebCodecsExport(deps)
  spy.run = ask => exporter.run(ask)
  return spy
}

async function main() {
  console.log('=== [TMCut web codecs export] Starting ===\n')
  const core = await import('tmcut-core')
  T = core.TICKS_PER_SECOND
  const glue = await import('../../app/utils/tmcut/webCodecsExport') as unknown as GlueModule

  await check('the glue is its own module and holds no platform', () => {
    const path = 'app/utils/tmcut/webCodecsExport.ts'
    assert.ok(existsSync(join(root, path)), `${path} must own the first real exporter`)
    const source = read(path)
    assert.ok(!/from 'mediabunny'/.test(source), 'the container belongs to the session, not to the glue')
    assert.ok(!/globalThis\.(VideoFrame|VideoEncoder|AudioEncoder|OffscreenCanvas)|document\.|getContext\(|createImageBitmap/.test(source),
      'a canvas and a codec are injected, never reached for')
    assert.ok(!/['"](bad-canvas|background-image|background-transparent|stacked-rows|text|effects|mask|blend|transition|reverse|stabilize|fit-unsupported|rotation)['"]/.test(source),
      'the glue reports the words core chose; a second vocabulary is a second decision')
  })

  await check('a refused project costs one core call and nothing else', async () => {
    const refused = project({
      tracks: [
        { id: 'row-a', type: 'video', items: [{ id: 'a', type: 'video', src: 'C:/media/a.mp4', source: { in: 0, out: T }, timeline: { start: 0, duration: T } }] },
        { id: 'row-t', type: 'text', items: [{ id: 't', type: 'text', text: 'hello', timeline: { start: 0, duration: T } }] }
      ]
    })
    const spy = harness(glue)
    const result = await spy.run({ project: refused })
    assert.equal(result.kind, 'content-refused')
    assert.deepEqual([...(result.reasons as string[])], ['text'], 'the verdict word, verbatim, in the verdict order')
    assert.equal(result.output, null, 'a refusal has no file')
    assert.equal(spy.decided.length, 0, 'nothing was asked of the runtime')
    assert.equal(spy.canvases.length, 0, 'nothing was painted')
    assert.equal(spy.plateAsks.length, 0, 'nothing was decoded')
  })

  await check('a canvas the content law cannot size stops before the probe', async () => {
    const spy = harness(glue)
    const result = await spy.run({ project: project({ canvas: { width: 0, height: 0, fps: FPS } }) })
    assert.equal(result.kind, 'content-refused')
    assert.deepEqual([...(result.reasons as string[])], ['bad-canvas'])
    assert.equal(spy.decided.length, 0)
  })

  await check('what the session is asked for is core answer, field by field', async () => {
    const target = project()
    const verdict = core.planEncodeContent(target)
    const signal = new AbortController().signal
    const onProgress = () => {}
    const mixer = async () => [new Float32Array(4), new Float32Array(4)]
    const spy = harness(glue, { pcm: mixer })
    const result = await spy.run({ project: target, signal, onProgress, inFlight: 7 })
    assert.equal(result.kind, 'exported')
    assert.equal(spy.asks.length, 1)
    const ask = spy.asks[0] as Record<string, unknown>
    assert.equal(ask.container, 'mp4', 'the container the capability chose')
    assert.deepEqual(ask.video, VIDEO_CONFIG, 'the config the capability accepted')
    assert.deepEqual(ask.audio, AUDIO_CONFIG)
    assert.equal(ask.totalFrames, verdict.totalFrames, 'the frame count is the verdict answer, not a rate multiplied out')
    assert.equal(ask.contentEndTicks, verdict.contentEndTicks)
    assert.equal(ask.signal, signal, 'the abort the caller handed in, unchanged')
    assert.equal(ask.onProgress, onProgress, 'progress is the session to report, not the glue to re-scale')
    assert.equal(ask.inFlight, 7)
    assert.equal(ask.pcm, mixer, 'the mixer is handed over as it came')
    assert.deepEqual(spy.canvases[0].created, [verdict.canvas?.width, verdict.canvas?.height])
  })

  await check('a runtime that accepts nothing never starts a session', async () => {
    const spy = harness(glue, {
      decision: { kind: 'refused', config: null, container: null, errors: ['no encode config this runtime accepts'], checked: [] }
    })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'runtime-refused')
    assert.deepEqual([...(result.errors as string[])], ['no encode config this runtime accepts'])
    assert.equal(spy.asks.length, 0)
    assert.equal(spy.canvases.length, 0)
    assert.equal(result.output, null)
  })

  await check('a ready config with no container is still a refusal', async () => {
    const spy = harness(glue, {
      decision: { kind: 'ready', config: { id: 'x', video: VIDEO_CONFIG, audio: null }, container: null, errors: [], checked: [] }
    })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'runtime-refused')
    assert.equal(spy.asks.length, 0)
    assert.match(String(result.message), /container/, 'and it says which half was missing')
  })

  await check('a silent file has no mixer to ask', async () => {
    const quiet = project({
      tracks: [{
        id: 'row-a',
        type: 'video',
        muted: true,
        items: [{ id: 'a', type: 'video', src: 'C:/media/a.mp4', source: { in: 0, out: 3 * T }, timeline: { start: 0, duration: 3 * T } }]
      }]
    })
    assert.equal(core.planEncodeContent(quiet).request?.audio, null, 'core already says this file is silent')
    let mixed = 0
    const spy = harness(glue, {
      pump: true,
      pcm: async () => {
        mixed++
        return [new Float32Array(4)]
      },
      decision: {
        kind: 'ready', container: 'mp4', errors: [],
        config: { id: 'avc1', video: VIDEO_CONFIG, audio: null }
      }
    })
    const result = await spy.run({ project: quiet })
    assert.equal((spy.asks[0] as Record<string, unknown>).audio, null)
    assert.equal(mixed, 0, 'nothing was mixed for a silent track')
    assert.equal(result.kind, 'failed', 'and a session that asked anyway is told so, not answered with zeros')
    assert.match(String(result.message), /silent/)
  })

  await check('a file with sound and no mixer refuses to run', async () => {
    const spy = harness(glue, { noMixer: true })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'failed')
    assert.match(String(result.message), /mixer/)
    assert.equal(spy.asks.length, 0, 'a half-written file is not an outcome')
    assert.equal(spy.canvases.length, 0)
  })

  await check('the tick a frame paints at is core grid at the index asked for', async () => {
    const target = project()
    const scheduler = core.createFrameScheduler(target, { rate: FPS })
    const spy = harness(glue, { indices: [2, 0, 1] })
    await spy.run({ project: target })
    assert.deepEqual(spy.ticks, [
      scheduler.frameAt(2)?.startTicks,
      scheduler.frameAt(0)?.startTicks,
      scheduler.frameAt(1)?.startTicks
    ], 'frameAt(index), in the order the session named — no counter of its own')
    assert.equal(spy.canvases[0].began.length, 3)
  })

  await check('only the plan paint surfaces draw, in the plan order', async () => {
    const second = surface({ clip: { id: 'b', src: 'C:/media/b.mp4' }, mediaTimeSec: 1.5 })
    // One frame, so the order below is the plan's order and not a repeat count.
    const spy = harness(glue, {
      indices: [0],
      surfaces: () => [
        surface({ role: 'outgoing', clip: { id: 'z', src: 'C:/media/z.mp4' } }),
        surface(),
        second
      ]
    })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'exported')
    assert.deepEqual(spy.plateAsks.map(ask => ask.src), ['C:/media/a.mp4', 'C:/media/b.mp4'])
    assert.equal(spy.canvases[0].drawn.length, 2, 'two plates on one frame, in that order')
  })

  await check('every plate lands on the rect core answered for it', async () => {
    const painted = surface({
      layer: {
        layout: { fit: 'fill', focusX: 0.5, focusY: 0.5, cropRect: null },
        transform: { x: 12, y: -8, scaleX: 2, scaleY: 2 },
        opacity: 0.5
      },
      mediaTimeSec: 1
    })
    const spy = harness(glue, { surfaces: () => [painted] })
    const target = project()
    const verdict = core.planEncodeContent(target)
    await spy.run({ project: target })
    const expected = core.planEncodePlate({
      media: { width: PLATE.width, height: PLATE.height },
      canvas: verdict.canvas,
      layout: painted.layer.layout,
      transform: painted.layer.transform,
      opacity: painted.layer.opacity
    })
    assert.ok(expected, 'the fixture must stay placeable')
    assert.deepEqual(spy.canvases[0].drawn[0].rect, expected)
    assert.equal(spy.canvases[0].drawn[0].plate, PLATE, 'the plate read is the plate drawn')
    assert.equal(spy.plateAsks[0].atSec, 1, 'the media position core answered for this surface, unchanged')
    assert.deepEqual(spy.plateAsks[0].canvas, verdict.canvas, 'the decoder is handed the canvas core validated, not a copy the glue reshaped')
  })

  await check('a frame begins at the colour core says the canvas shows', async () => {
    const spy = harness(glue)
    await spy.run({ project: project() })
    assert.deepEqual(spy.canvases[0].began, ['#101820', '#101820', '#101820'],
      'one fill per frame: a plate that moved must not leave the previous frame behind')
  })

  await check('a plate that will not decode fails instead of painting black', async () => {
    const spy = harness(glue, { plate: null })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'failed')
    assert.match(String(result.message), /C:\/media\/a\.mp4/, 'and it names which file could not be read')
    assert.equal(spy.canvases[0].drawn.length, 0)
    assert.equal(result.output, null)
    assert.equal(spy.canvases[0].disposed, 1, 'the canvas is given back even on the way out')
  })

  await check('a probe that throws is a failure with its own name', async () => {
    const spy = harness(glue, { decision: null })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'failed')
    assert.match(String(result.message), /probe died/)
    assert.equal(spy.asks.length, 0)
  })

  await check('a session that dies is a failure, and the canvas still goes back', async () => {
    const spy = harness(glue, { sessionThrows: new Error('the encoder said no') })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'failed')
    assert.match(String(result.message), /encoder said no/)
    assert.equal(result.output, null, 'a file that never closed is not handed over')
    assert.equal(spy.canvases[0].disposed, 1)
  })

  await check('an aborted caller stops before anything is asked', async () => {
    const controller = new AbortController()
    controller.abort()
    const spy = harness(glue)
    const result = await spy.run({ project: project(), signal: controller.signal })
    assert.equal(result.kind, 'canceled')
    assert.equal(spy.decided.length, 0)
    assert.equal(spy.canvases.length, 0)
    assert.equal(result.output, null)
  })

  await check('an export that dies with the caller signal is cancelled, not failed', async () => {
    const spy = harness(glue, {
      sessionThrows: new Error('the encode session was cancelled'),
      abortWhileRunning: true
    })
    const result = await spy.run({ project: project(), signal: spy.controller.signal })
    assert.equal(result.kind, 'canceled', 'the caller said stop; that is not an encoder failure')
    assert.equal(spy.canvases[0].disposed, 1)
    assert.equal(result.output, null)
  })

  await check('the file the session closed with is the file reported', async () => {
    const blob = { marker: 'blob' }
    const spy = harness(glue, { outcome: { videoPackets: 3, audioPackets: 2, progress: 1, output: blob } })
    const result = await spy.run({ project: project() })
    assert.equal(result.kind, 'exported')
    assert.equal(result.output, blob, 'the glue does not wrap or copy what the muxer returned')
    assert.deepEqual(
      { p: result.progress, v: result.videoPackets, a: result.audioPackets },
      { p: 1, v: 3, a: 2 }
    )
  })

  console.log(`\n=== [TMCut web codecs export] ${passed} passed ===`)
}

main().catch((error) => {
  console.error('WEB CODECS EXPORT SPEC FAILED:', error)
  process.exit(1)
})
