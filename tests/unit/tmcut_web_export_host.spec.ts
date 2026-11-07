/**
 * The export button's other half: the real ports, assembled in one place.
 *
 * `createWebCodecsExport` (H3d-2c) takes four browser things as parameters and
 * decides nothing about them. Two legs now exist — the plate reader (§53.8) and
 * the sound leg (§53.9) — and the surface law has been shared since §53.7. What
 * is left is the assembly, and it is the only place in `app/` that names all
 * four, which is why it is a module with a test rather than an object literal
 * inside a 1600-line component: a modal that assembles them again is a second
 * answer to "what does an export open", and that is the drift class this slice
 * exists to close.
 *
 * Two rules are why it is not just `Object.assign`:
 *  - the reader and the mixer own resources: both are given back in `finally`,
 *    on every path, including a refusal that never created them;
 *  - the authored `clip.src` is not a location a decoder can open. It goes
 *    through the host's resolver (`resolveMediaSrc` in the app), and that is the
 *    one function an export could quietly skip — a `UrlSource('a.mp4')` fails as
 *    "no plate", not as "you forgot to resolve".
 *
 * The canvas is the one thing with no law of its own: it fills, draws and hands
 * out its element, and `planEncodePlate` already decided the rectangle. `begin`
 * must clear every frame — a painter that does not is a smear, which is the bug
 * §53.5 pinned in core as `encodeCanvasFill`.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_web_export_host.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createWebExportHost } from '../../app/utils/tmcut/webExportHost'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const FPS = Object.freeze({ numerator: 30, denominator: 1 })
const TICKS = 120_000

function projectOf() {
  return {
    version: 3,
    canvas: {
      width: 640,
      height: 360,
      fps: FPS,
      background: { type: 'color', value: '#101820' }
    },
    markers: [],
    tracks: [{
      id: 'row-v',
      type: 'video',
      items: [{
        id: 'v1',
        type: 'video',
        src: 'C:/media/v.mp4',
        source: { in: 0, out: 2 * TICKS },
        timeline: { start: 0, duration: 2 * TICKS },
        speed: 1,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        effects: [],
        keyframes: []
      }]
    }]
  }
}

/**
 * The same footage row, in the shape the store actually keeps: rows live under
 * `project.timeline.tracks`, not at the project's top level. Core reads both
 * (`timelineOf` in `evaluate`, `scheduler` and `paintStack`), so a law never
 * sees a difference — but the two app-side consumers the host joins (`surfacesAt`
 * and the mix leg) are handed a `tracks` array, and reading the wrong one is a
 * silent export: core says eligible, nothing is painted, and the file opens.
 */
function storedProject() {
  const flat = projectOf()
  return {
    id: 'p1',
    name: 'store shaped',
    version: 3,
    canvas: flat.canvas,
    timeline: { version: 3, durationMs: 2000, markers: [], tracks: flat.tracks }
  }
}

/** Everything the host is allowed to touch, faked, with every touch recorded. */
function fixture(options: { silent?: boolean, plates?: boolean } = {}) {
  const log: string[] = []
  const draws: Array<{ fill?: string, sx?: number, dest?: unknown }> = []
  const readAsks: Array<{ src: string, atSec: number, authoredSrc?: string | null }> = []
  const mixAsks: Array<Record<string, unknown>> = []
  const sessions: Array<Record<string, unknown>> = []
  const canvases: Array<{ width: number, height: number, disposed: boolean }> = []
  const reader = { closed: 0 }
  const mixer = { closed: 0 }
  const readerPorts: Array<Record<string, unknown>> = []
  const mixerPorts: Array<Record<string, unknown>> = []

  const host = createWebExportHost({
    createReader: (ports: Record<string, unknown> = {}) => {
      readerPorts.push(ports)
      return {
        read: async (ask: { src: string | null, atSec: number, authoredSrc?: string | null }) => {
          readAsks.push({ src: String(ask.src), atSec: ask.atSec, authoredSrc: ask.authoredSrc ?? null })
          return options.plates === false ? null : { width: 1920, height: 1080, image: { marker: 'plate' } }
        },
        close: () => {
          reader.closed += 1
          log.push('reader:close')
        }
      }
    },
    createMixer: (_project?: unknown, ports: Record<string, unknown> = {}) => {
      mixerPorts.push(ports)
      return {
        mix: async (ask: Record<string, unknown>) => {
          mixAsks.push(ask)
          return [new Float32Array(1024), new Float32Array(1024)]
        },
        close: () => {
          mixer.closed += 1
          log.push('mixer:close')
        },
        refused: () => []
      }
    },
    createCanvas: (width: number, height: number) => {
      const canvas = { width, height, disposed: false }
      canvases.push(canvas)
      return {
        element: { marker: 'canvas' },
        begin: (fill: string) => {
          draws.push({ fill })
        },
        draw: (_plate: unknown, rect: { source: { sx: number }, dest: unknown }) => {
          draws.push({ sx: rect.source.sx, dest: rect.dest })
        },
        dispose: () => {
          canvas.disposed = true
          log.push('canvas:dispose')
        }
      }
    },
    capability: {
      decide: async () => ({
        kind: 'ready',
        container: options.silent ? 'webm' : 'mp4',
        errors: [],
        config: {
          id: 'avc1-640',
          video: { codec: 'avc1.42001f', width: 640, height: 360, fps: FPS },
          audio: options.silent ? null : { codec: 'mp4a.40.2', sampleRate: 48_000, channelCount: 2 }
        }
      })
    },
    session: (ask: Record<string, unknown>) => {
      sessions.push(ask)
      return {
        async run() {
          const total = Math.min(Number(ask.totalFrames), 2)
          for (let index = 0; index < total; index++) await (ask.paint as (i: number) => unknown)(index)
          if (ask.audio) await (ask.pcm as (r: unknown) => unknown)({ index: 0, startSample: 0, frames: 1024, timestamp: 0, duration: 21_333 })
          return { videoPackets: total, audioPackets: ask.audio ? 1 : 0, progress: 1, output: { marker: 'blob' } }
        },
        async cancel() {}
      }
    }
  })

  return { host, log, draws, readAsks, mixAsks, sessions, canvases, reader, mixer, readerPorts, mixerPorts }
}

async function main() {
  console.log('=== [TMCut web export host] Starting ===\n')

  await check('the host is the one place that assembles the four ports', () => {
    const source = read('app/utils/tmcut/webExportHost.ts')
    assert.match(source, /createWebCodecsExport/, 'the glue is created here')
    assert.match(source, /createPlateReader/, 'the plate leg is its readPlate')
    assert.match(source, /createExportMixLeg/, 'the sound leg is its pcm')
    assert.match(source, /surfacesAt/, 'and the surface law is its surfaces')
    assert.match(source, /planEncodeContent/, 'the audio target is core\'s request, not a local constant')
    assert.doesNotMatch(source, /mediabunny|CanvasSink|VideoDecoder/, 'no decoder is named in this file')
  })

  await check('a project core refuses never opens a reader, a mixer or a canvas', async () => {
    const f = fixture()
    const result = await f.host.run({
      project: { version: 3, canvas: { width: 640, height: 360, background: { type: 'color', value: '#101820' } }, tracks: [] } as never,
      resolveSrc: (src: string) => src
    })
    assert.equal(result.kind, 'content-refused')
    assert.ok(result.reasons.length > 0, 'core\'s words come back verbatim')
    assert.equal(f.canvases.length, 0, 'no canvas was created')
    assert.equal(f.readAsks.length, 0, 'and nothing was decoded')
  })

  await check('the authored source is resolved before it reaches a decoder', async () => {
    const f = fixture()
    const result = await f.host.run({ project: projectOf() as never, resolveSrc: src => `media://${src}` })
    assert.equal(result.kind, 'exported', `the export ran: ${result.message ?? ''}`)
    assert.deepEqual([...new Set(f.readAsks.map(ask => ask.src))], ['media://C:/media/v.mp4'],
      'the reader saw a location, not the authored path')
  })

  await check('every frame is cleared before it is drawn, and the drawn rect is core\'s', async () => {
    const f = fixture()
    await f.host.run({ project: projectOf() as never, resolveSrc: src => src })
    const fills = f.draws.filter(entry => entry.fill !== undefined)
    const drawn = f.draws.filter(entry => entry.dest !== undefined)
    assert.deepEqual(fills.map(entry => entry.fill), ['#101820', '#101820'],
      'one background fill per painted frame, in core\'s colour')
    assert.equal(drawn.length, 2, 'one plate per frame')
    assert.deepEqual(drawn[0]!.dest, { dx: 0, dy: 0, dw: 640, dh: 360 },
      'a 1920x1080 plate fitted into a 640x360 canvas')
  })

  await check('a silent project asks the mixer for nothing', async () => {
    const f = fixture({ silent: true })
    const result = await f.host.run({ project: projectOf() as never, resolveSrc: src => src })
    assert.equal(result.kind, 'exported')
    assert.equal(f.mixAsks.length, 0, 'no packet was mixed for a file with no sound')
  })

  await check('a project with sound asks the mixer with core\'s own target', async () => {
    const f = fixture()
    await f.host.run({ project: projectOf() as never, resolveSrc: src => src })
    assert.equal(f.mixAsks.length, 1, 'one packet was mixed')
    assert.deepEqual((f.mixAsks[0] as { target: unknown }).target, { sampleRate: 48_000, channelCount: 2 },
      'the rate and channel count come from core\'s encode request')
  })

  await check('the reader, the mixer and the canvas are given back on every path', async () => {
    const ok = fixture()
    await ok.host.run({ project: projectOf() as never, resolveSrc: src => src })
    assert.equal(ok.reader.closed, 1, 'the reader closed once')
    assert.equal(ok.mixer.closed, 1, 'the mixer closed once')
    assert.equal(ok.canvases.every(canvas => canvas.disposed), true, 'and the canvas was disposed')

    const refused = fixture()
    await refused.host.run({
      project: { version: 3, canvas: { width: 640, height: 360, background: { type: 'color', value: '#101820' } }, tracks: [] } as never,
      resolveSrc: src => src
    })
    assert.equal(refused.reader.closed, 1, 'a refusal still closes the reader it was handed')
    assert.equal(refused.mixer.closed, 1, 'and the mixer')
  })

  await check('a plate that will not decode fails the export instead of painting black', async () => {
    const f = fixture({ plates: false })
    const result = await f.host.run({ project: projectOf() as never, resolveSrc: src => src })
    assert.equal(result.kind, 'failed')
    assert.match(String(result.message), /no plate could be decoded/, 'in the glue\'s own words')
    assert.equal(f.canvases.every(canvas => canvas.disposed), true)
  })

  await check('an aborted run is cancelled, and still gives its resources back', async () => {
    const f = fixture()
    const controller = new AbortController()
    controller.abort()
    const result = await f.host.run({ project: projectOf() as never, resolveSrc: src => src, signal: controller.signal })
    assert.equal(result.kind, 'canceled')
    assert.equal(f.reader.closed, 1)
    assert.equal(f.mixer.closed, 1)
  })

  await check('a store-shaped project paints its frames, not silence under a still canvas', async () => {
    const f = fixture()
    const result = await f.host.run({ project: storedProject() as never, resolveSrc: src => src })
    assert.equal(result.kind, 'exported', `the export ran: ${result.message ?? ''}`)
    assert.equal(f.readAsks.length, 2, 'one plate per frame was read from the row under timeline.tracks')
    assert.deepEqual([...new Set(f.readAsks.map(ask => ask.src))], ['C:/media/v.mp4'],
      'and it was the authored file, not an empty source')
    assert.equal(f.draws.filter(entry => entry.dest !== undefined).length, 2, 'two plates were drawn')
  })

  await check('the result carries the file and a progress number the button can show', async () => {
    const f = fixture()
    const seen: number[] = []
    const result = await f.host.run({
      project: projectOf() as never,
      resolveSrc: src => src,
      onProgress: (value: number) => seen.push(value)
    })
    assert.deepEqual(result.output, { marker: 'blob' }, 'the muxer\'s output comes back untouched')
    assert.equal(result.progress, 1)
    assert.deepEqual(seen, [], 'no progress was invented by the host')
  })

  await check('the client cache is the first copy both legs read', async () => {
    const f = fixture()
    const blob = new Blob([new Uint8Array(8)])
    const result = await f.host.run({
      project: projectOf() as never,
      resolveSrc: (src: string) => `media://local?file=${src}`,
      bytesFor: async () => blob
    })
    assert.equal(result.kind, 'exported', `the export ran: ${result.message ?? ''}`)
    assert.deepEqual([...new Set(f.readAsks.map(ask => ask.authoredSrc))], ['C:/media/v.mp4'],
      'the plate ask carries the AUTHORED path, so the reader can key the cache by it')
    assert.deepEqual([...new Set(f.readAsks.map(ask => ask.src))], ['media://local?file=C:/media/v.mp4'],
      'and the location is still resolved: a cache miss has to be able to fall back')
    assert.deepEqual(f.readerPorts.map(ports => typeof ports.bytesFor), ['function'],
      'the reader factory was handed the port it opens its containers with')
    assert.deepEqual(f.mixerPorts.map(ports => typeof ports.bytesFor), ['function'],
      'the sound leg was handed the same answer, so the two legs cannot disagree')
    const source = read('app/utils/tmcut/webExportHost.ts')
    assert.match(source, /createPlateReader\(ports\)/, 'the real reader is built with the port, not without it')
    assert.match(source, /createExportMixLeg\(ports\)/, 'and so is the real sound leg')
  })

  await check('no byte port means the export reads by location, as it always did', async () => {
    const f = fixture()
    await f.host.run({ project: projectOf() as never, resolveSrc: (src: string) => src })
    assert.deepEqual(f.readerPorts.map(ports => ports.bytesFor ?? null), [null],
      'the reader was created without a cache port')
    assert.deepEqual(f.mixerPorts.map(ports => ports.bytesFor ?? null), [null],
      'and so was the mixer')
    assert.deepEqual(f.readAsks.map(ask => ask.authoredSrc), ['C:/media/v.mp4', 'C:/media/v.mp4'],
      'the authored path is still named, so a caller that adds a cache later needs no change here')
  })

  console.log(`\n=== All ${passed} web-export-host checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
