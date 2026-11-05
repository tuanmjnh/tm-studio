/**
 * The export stacks every footage row the paint rule says paints (V4 Phase 2,
 * slice #95, gap G18).
 *
 * `selectPaintRows` (core, slice #93) answers "which rows paint at this tick",
 * in paint order. The exporter used to read only the first answer of the whole
 * file and drop the rest: `videoBase` was one row, `extraVideoTracks` was
 * footage that existed in the timeline, in the warning and in the duration —
 * but in no pixels. Measured before this slice: two visible footage rows of
 * different colours produced a file containing exactly one of them.
 *
 * What is asserted, and how:
 *  1. a stacked row is DECODED — its media reaches the command line.
 *  2. the overlays chain in core's paint order, so the row later in track order
 *     lands on top.
 *  3. each row's windows are its own clips' half-open spans (ADR-018), added
 *     into one `enable` expression — one overlay per row, because a filter
 *     output can be consumed once.
 *  4. FRAME BY FRAME: for every planned frame, the set of rows the file paints
 *     equals the set core returns at that tick. This is what makes the two
 *     surfaces one rule rather than two vocabularies.
 *  5. `hidden` is still hidden — a hidden row is neither decoded nor overlaid.
 *  6. a stacked row carries no audio lane: the preview plays the sound of the
 *     row that owns the canvas, so the file may not mix more than the screen.
 *  7. a one-row project is untouched — no overlay, no rgba bus, no stack tail.
 *  8. a row that outlives the base extends the bus, so the file runs to the end
 *     of the footage instead of cutting the stack off where the base ends.
 *  9. PIXELS (real FFmpeg): an opaque row over the base, a 50 % row that must
 *     let the base through, and three rows whose windows share only frame edges,
 *     read frame by frame — the boundary slice #93 pinned, closed on purpose.
 * 10. a source guard: the stack comes from the shared selector, and one
 *     function owns the overlay law.
 *
 * The pixel check skips when no FFmpeg binary is available; graph checks always
 * run.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_paint_stack.spec.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TICKS_PER_SECOND, compareFrames, createFrameScheduler, evaluateTimeline, selectPaintRows
} from 'tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ffmpegCandidates = [
  process.env.TOOLS_FFMPEG_PATH,
  path.join(repoRoot, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
]
const ffmpeg = ffmpegCandidates.find(candidate => candidate && fs.existsSync(candidate))

const W = 64
const H = 36
const FPS = 30
const BG: [number, number, number] = [16, 32, 48]
const PLATE_BOTTOM: [number, number, number] = [30, 90, 200]
const PLATE_TOP: [number, number, number] = [220, 20, 20]
const PLATE_THIRD: [number, number, number] = [0, 200, 100]
/** The most a flat authored colour may drift through the yuv420p round trip. */
const COLOR_TOL = 5
const hex = (c: [number, number, number]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
// The bundled ffmpeg cannot open files under the OS temp dir on Windows, and
// `.golden-render-*/` is the ignore pattern already in .gitignore.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-stack-'))

function runFfmpeg(args: string[]): void {
  const res = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffmpeg failed: ${res.stderr}`)
}

/**
 * One authored plate: solid colour, own file, own length, plus a silent stereo
 * audio lane — the base row's concat expects `[i:a]` for every footage clip,
 * and a missing lane would look like a bug in the stack instead of a missing
 * stream.
 */
function plateFile(name: string, color: [number, number, number], seconds: number): string {
  const file = path.join(workDir, name).replace(/\\/g, '/')
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=${hex(color)}:s=${W}x${H}:r=${FPS}`,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(seconds), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-y', file
  ])
  return file
}

let decoded = 0
/** Every frame of a file, RGBA, in order. */
function decodeAllFrames(file: string): Buffer {
  const target = path.join(workDir, `frames-${++decoded}.rgba`)
  runFfmpeg(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', target])
  return fs.readFileSync(target)
}

function pixelAt(frames: Buffer, frame: number, x: number, y: number): [number, number, number] {
  const base = frame * W * H * 4 + (y * W + x) * 4
  return [frames[base]!, frames[base + 1]!, frames[base + 2]!]
}

function frameCount(frames: Buffer): number {
  return frames.length / (W * H * 4)
}

function frameBytes(frames: Buffer, index: number): Uint8Array {
  const stride = W * H * 4
  return new Uint8Array(frames.buffer.slice(
    frames.byteOffset + index * stride, frames.byteOffset + (index + 1) * stride))
}

/**
 * An authored colour, read back out of a yuv420p file. Measured on the bundled
 * binary: a flat colour plate lands within 3 units of what was authored
 * (208,37,38 for 210,40,40), because the RGB->YUV420->RGB round trip is lossy
 * even when the encoder is not. So the law is "this colour, to within the
 * conversion", never exact bytes.
 */
function assertColorAt(frames: Buffer, index: number, want: [number, number, number], msg: string): void {
  const got = pixelAt(frames, index, W >> 1, H >> 1)
  const worst = Math.max(...got.map((v, i) => Math.abs(v - want[i]!)))
  assert.ok(worst <= COLOR_TOL,
    `${msg}: got ${JSON.stringify(got)}, want within ${COLOR_TOL} of ${JSON.stringify(want)}`)
}

/** A solid expected frame, built from the authored colours — never from the render. */
function solidFrame(color: [number, number, number]): Uint8Array {
  const bytes = new Uint8Array(W * H * 4)
  for (let i = 0; i < W * H; i++) {
    bytes[i * 4] = color[0]
    bytes[i * 4 + 1] = color[1]
    bytes[i * 4 + 2] = color[2]
    bytes[i * 4 + 3] = 255
  }
  return bytes
}

interface Item {
  id: string
  src: string
  offset: number
  in: number
  out: number
  opacity?: number
}

interface TrackSeed {
  id: string
  type: 'video' | 'text'
  hidden?: boolean
  items: Item[]
}

function projectOf(tracks: TrackSeed[]): TmcutProject {
  return {
    version: 1,
    name: 'paint stack export',
    canvas: { width: W, height: H, fps: FPS, background: { type: 'color', value: hex(BG) } },
    timeline: {
      tracks: tracks.map(t => ({
        id: t.id,
        type: t.type,
        name: t.id,
        ...(t.hidden ? { hidden: true } : {}),
        items: t.items.map(item => ({ ...item, trackId: t.id }))
      }))
    }
  } as unknown as TmcutProject
}

const tk = (sec: number) => Math.round(sec * TICKS_PER_SECOND)
const clip = (id: string, src: string, offsetSec: number, spanSec: number, opacity?: number): Item =>
  ({ id, src, offset: tk(offsetSec), in: 0, out: tk(spanSec), ...(opacity === undefined ? {} : { opacity }) })

function filterComplexOf(compiled: { args: string[] }): string {
  const index = compiled.args.indexOf('-filter_complex')
  assert.ok(index >= 0, 'the compiled command has no filter graph')
  return compiled.args[index + 1]!
}

function decodedSrcs(args: string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '-i') out.push(String(args[index + 1]))
  }
  return out
}

/** Every stacked-row overlay: which stack slot it fills, and the windows it paints in. */
function stackWindows(graph: string): { slot: string, windows: [number, number][] }[] {
  return [...graph.matchAll(/\[v_stack_rgba_(\d+)\]overlay=enable='([^']*)'/g)].map(m => ({
    slot: m[1]!,
    windows: [...m[2]!.matchAll(/gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)/g)]
      .map(w => [Number(w[1]), Number(w[2])] as [number, number])
  }))
}

let passed = 0
function check(label: string, fn: () => void): void {
  fn()
  passed++
  console.log(`   ${label} PASSED (${passed})`)
}

const BOTTOM: TrackSeed = { id: 'v1', type: 'video', items: [clip('a', 'bottom.mp4', 0, 4)] }
const TOP_EARLY: TrackSeed = { id: 'v2', type: 'video', items: [clip('b', 'top.mp4', 2, 4)] }
const THIRD_LATE: TrackSeed = {
  id: 'v3',
  type: 'video',
  items: [clip('c', 'third.mp4', 5, 4), clip('d', 'third.mp4', 10, 1)]
}

async function main(): void {
  console.log('=== [TMCut export paint stack] Starting ===\n')

  // 1. The row that used to be dropped is now a media input.
  check('the stacked row is decoded', () => {
    const compiled = compileTimelineToFfmpeg(projectOf([BOTTOM, TOP_EARLY]), 'out.mp4')
    const srcs = decodedSrcs(compiled.args)
    assert.ok(srcs.some(s => s.includes('bottom.mp4')), `the base row is decoded, got ${srcs}`)
    assert.ok(srcs.some(s => s.includes('top.mp4')), `the stacked row must be decoded too, got ${srcs}`)
  })

  // 2. One overlay per stacked row, chained bottom to top in core's paint order.
  //    The base bus is first, and a row that outlives it extends that bus first
  //    (check 8), so the first overlay lands on the extended stream.
  check('the rows composite in paint order, bottom to top', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(
      projectOf([BOTTOM, TOP_EARLY, THIRD_LATE]), 'out.mp4'))
    const overlays = [...graph.matchAll(/\[([a-zA-Z_\d]+)\]\[(v_stack_rgba_\d+)\]overlay=/g)]
      .map(m => `${m[1]}+${m[2]}`)
    assert.deepEqual(overlays, ['v_stack_tail+v_stack_rgba_0', 'v_stack_0+v_stack_rgba_1'],
      `the stack must chain base -> row 2 -> row 3, got ${JSON.stringify(overlays)}`)
  })

  // 3. Half-open windows, one expression per row, decoded from whole ticks.
  check('each row paints inside its own clips, and nowhere else', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(
      projectOf([BOTTOM, TOP_EARLY, THIRD_LATE]), 'out.mp4'))
    const rows = stackWindows(graph)
    assert.equal(rows.length, 2, `two stacked rows, got ${JSON.stringify(rows)}`)
    assert.deepEqual(rows[0]!.windows, [[2, 6]], 'one 4 s clip starting at 2 s')
    assert.deepEqual(rows[1]!.windows, [[5, 9], [10, 11]],
      'both clips of one row share a single enable expression')
    assert.ok(!graph.includes('between(t,'),
      'the stack must not use between(), which includes its upper bound')
  })

  // 4. The heavy gate: frame by frame, the rows the file paints are the rows
  //    core says paint at that tick — same set, same paint order.
  check('every planned frame paints the rows core says paint', () => {
    const p = projectOf([BOTTOM, TOP_EARLY, THIRD_LATE])
    const graph = filterComplexOf(compileTimelineToFfmpeg(p, 'out.mp4'))
    const stacked = stackWindows(graph)
    assert.equal(stacked.length, 2, 'the two rows above the base are overlaid')
    const windowsInTrackOrder: [string, [number, number][]][] = [
      ['v1', [[0, 4]]],
      ['v2', stacked[0]!.windows],
      ['v3', stacked[1]!.windows]
    ]

    const plan = createFrameScheduler(p)
    assert.ok(plan.frameCount > 0, 'the project schedules frames')
    let compared = 0
    let stackedFrames = 0
    for (const frame of plan.frames()) {
      const sec = frame.startTicks / TICKS_PER_SECOND
      const fromFile = windowsInTrackOrder
        .filter(([, wins]) => wins.some(([start, end]) => sec >= start - 1e-6 && sec < end - 1e-6))
        .map(([id]) => id)
      const fromCore = selectPaintRows(evaluateTimeline(p, frame.startTicks)).rows
        .map(r => String(r.trackId))
      compared++
      if (fromCore.length > 1) stackedFrames++
      assert.deepEqual(fromFile, fromCore,
        `frame ${frame.index} @ ${frame.startTicks} ticks (${sec} s): file ${fromFile}, core ${fromCore}`)
    }
    assert.ok(compared >= 300, `the sweep must cover the whole timeline, got ${compared} frames`)
    assert.ok(stackedFrames >= 30, `the sweep must cover stacked regions, got ${stackedFrames}`)
  })

  // 5. The rule slice #87 closed still holds with a compositor in the graph.
  check('a hidden row is not decoded and not overlaid', () => {
    const compiled = compileTimelineToFfmpeg(
      projectOf([BOTTOM, { ...TOP_EARLY, hidden: true }, THIRD_LATE]), 'out.mp4')
    const srcs = decodedSrcs(compiled.args)
    assert.ok(!srcs.some(s => s.includes('top.mp4')), `a hidden row must not reach the file, got ${srcs}`)
    const rows = stackWindows(filterComplexOf(compiled))
    assert.equal(rows.length, 1, 'only the visible row above the base is stacked')
    assert.deepEqual(rows[0]!.windows, [[5, 9], [10, 11]])
  })

  // 6. Picture only: a stacked row opens no audio lane, so the file cannot be
  //    louder than the one footage element the preview plays.
  check('the stacked row contributes no sound', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(projectOf([BOTTOM, TOP_EARLY]), 'out.mp4'))
    assert.equal((graph.match(/\[\d+:v\]trim=/g) ?? []).length, 2,
      'both footage clips decode their video lane')
    const lanes = graph.match(/\[\d+:a\]atrim/g) ?? []
    assert.equal(lanes.length, 1, `only the base row may open an audio lane, got ${JSON.stringify(lanes)}`)
    assert.equal((graph.match(/concat=n=1:v=1:a=1/g) ?? []).length, 1,
      'the base row keeps its audio lane')
    assert.match(graph, /concat=n=1:v=1:a=0/, 'the stacked row is a video-only chain')
  })

  // 7. No second row, no new filter: every existing export keeps its command line.
  check('a one-row project is untouched', () => {
    const compiled = compileTimelineToFfmpeg(projectOf([BOTTOM]), 'out.mp4')
    const graph = filterComplexOf(compiled)
    assert.ok(!graph.includes('overlay=enable='), 'nothing stacks, so no overlay is emitted')
    assert.ok(!graph.includes('v_stack'), 'no stack labels at all')
    assert.ok(!graph.includes('format=rgba'), 'the bus keeps its own format')
    assert.equal(compiled.duration, 4, 'the extent still comes from the single row')
  })

  // 8. A row that outlives the base must not be cut off with it.
  check('a row that outlives the base extends the bus', () => {
    const compiled = compileTimelineToFfmpeg(projectOf([
      { id: 'v1', type: 'video', items: [clip('a', 'bottom.mp4', 0, 2)] },
      { id: 'v2', type: 'video', items: [clip('b', 'top.mp4', 0, 8)] }
    ]), 'out.mp4')
    assert.equal(compiled.duration, 8, 'the file is as long as the footage')
    assert.match(filterComplexOf(compiled),
      /\[v_concat\]tpad=stop_mode=add:stop_duration=6\.000:color=0x102030,settb=1\/30,fps=30\[v_stack_tail\]/,
      'the base bus extends by exactly the footage that outlives it, on the frame grid')
  })

  // 9. PIXELS. Only with a real binary.
  if (!ffmpeg) {
    console.log('\nSKIP  the pixel gate: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)')
  } else {
    const bottomPlate = plateFile('plate-bottom.mp4', PLATE_BOTTOM, 8)
    const topPlate = plateFile('plate-top.mp4', PLATE_TOP, 8)
    const thirdPlate = plateFile('plate-third.mp4', PLATE_THIRD, 8)
    const plates: Record<string, string> = {
      'bottom.mp4': bottomPlate, 'top.mp4': topPlate, 'third.mp4': thirdPlate
    }

    function pixelProject(rows: Item[][]): TmcutProject {
      return projectOf(rows.map((items, index) => ({
        id: `v${index + 1}`,
        type: 'video' as const,
        items: items.map(item => ({ ...item, src: plates[item.src]! }))
      })))
    }

    function renderTo(name: string, project: TmcutProject): string {
      const compiled = compileTimelineToFfmpeg(project, 'out.mp4')
      const file = path.join(workDir, name).replace(/\\/g, '/')
      const args = compiled.args.slice(0, compiled.args.indexOf('-y'))
      runFfmpeg([...args, '-y', file])
      return file
    }

    check('an opaque row really lands on top of the row below', () => {
      const file = renderTo('stack-opaque.mp4', pixelProject([
        [clip('a', 'bottom.mp4', 0, 4)],
        [clip('b', 'top.mp4', 2, 4)]
      ]))
      const frames = decodeAllFrames(file)
      const total = frameCount(frames)
      assert.equal(total, 6 * FPS, `6 s at ${FPS} fps, got ${total} frames`)
      const below = solidFrame(PLATE_BOTTOM)
      const above = solidFrame(PLATE_TOP)
      let paintedTop = 0
      for (let index = 0; index < total; index++) {
        const sec = index / FPS
        const expected = sec >= 2 ? above : below
        const result = compareFrames(expected, frameBytes(frames, index), {
          meanTolerance: 3, channelTolerance: 8, diffRatioTolerance: 0
        })
        assert.ok(result.ok,
          `frame ${index} (${sec.toFixed(3)} s): ${JSON.stringify(result)}`)
        if (sec >= 2) paintedTop++
      }
      assert.equal(paintedTop, 4 * FPS, 'the stacked row paints its own 4 s window')
      assertColorAt(frames, 3 * FPS, PLATE_TOP,
        'inside the overlap the row above is what the screen gets')
    })

    check('a half-transparent row lets the row below through', () => {
      const file = renderTo('stack-alpha.mp4', pixelProject([
        [clip('a', 'bottom.mp4', 0, 4)],
        [clip('b', 'top.mp4', 0, 4, 50)]
      ]))
      const frames = decodeAllFrames(file)
      const mid = pixelAt(frames, FPS, W >> 1, H >> 1)
      const want = PLATE_TOP.map((v, i) => Math.round((v + PLATE_BOTTOM[i]!) / 2))
      const worst = Math.max(...mid.map((v, i) => Math.abs(v - want[i]!)))
      assert.ok(worst <= 8,
        `50 % over the row below must mix, not fall back to the canvas: got ${JSON.stringify(mid)}, want ${JSON.stringify(want)}`)
    })

    check('a stacked row owns exactly its own frames, gaps stay the canvas', () => {
      // Three rows, three windows: the base ends at 2 s, row two paints [3,5),
      // row three [6,7). Every boundary is a frame edge AND the bus is a
      // `tpad` stop-mode tail — the case where an off-grid bus makes a row
      // start one frame late (measured before the regrid: frames 91..149).
      const file = renderTo('stack-bounds.mp4', pixelProject([
        [clip('a', 'bottom.mp4', 0, 2)],
        [clip('b', 'top.mp4', 3, 2)],
        [clip('c', 'third.mp4', 6, 1)]
      ]))
      const frames = decodeAllFrames(file)
      assert.equal(frameCount(frames), 7 * FPS, 'the file runs to the last row frame')
      const runs: [number, number, [number, number, number]][] = [
        [0, 2 * FPS, PLATE_BOTTOM],
        [2 * FPS, 3 * FPS, BG],
        [3 * FPS, 5 * FPS, PLATE_TOP],
        [5 * FPS, 6 * FPS, BG],
        [6 * FPS, 7 * FPS, PLATE_THIRD]
      ]
      for (const [from, to, color] of runs) {
        for (let index = from; index < to; index++) {
          assertColorAt(frames, index, color, `frame ${index} (${(index / FPS).toFixed(4)} s)`)
        }
      }
    })
  }

  // 10. The stack comes from the shared selector, and one function owns the law.
  check('the graph has one place that stacks rows', () => {
    const compiler = fs.readFileSync(path.join(repoRoot, 'app/utils/tmcut/render/index.ts'), 'utf8')
    const video = fs.readFileSync(path.join(repoRoot, 'app/utils/tmcut/render/video.ts'), 'utf8')
    assert.match(compiler, /selection\.extraVideoTracks\.map/,
      'the stack reads the selector, not a filter of its own')
    assert.equal((video.match(/overlay=enable=/g) ?? []).length, 1, 'the overlay law has one home')
    assert.equal((compiler.match(/overlay=enable=/g) ?? []).length, 0,
      'the compiler does not hand-roll a second overlay')
    assert.equal((video.match(/export function compileVideoPipeline/g) ?? []).length, 1,
      'one row builder')
    assert.equal((video.match(/compileVideoPipeline\(graph, clips/g) ?? []).length, 1,
      'and one place stacks a row through it')
    assert.equal((compiler.match(/compileVideoPipeline\(graph/g) ?? []).length, 1,
      'the base row is built by that same function')
  })

  fs.rmSync(workDir, { recursive: true, force: true })
  console.log(`\n=== All ${passed} export paint-stack checks passed ===`)
}

main().catch((error) => {
  fs.rmSync(workDir, { recursive: true, force: true })
  console.error('FAILED:', error)
  process.exit(1)
})
