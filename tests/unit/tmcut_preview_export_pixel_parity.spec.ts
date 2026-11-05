/**
 * F8: the composite plan PREDICTS the exported pixels (V4 Phase 2, slice #134).
 *
 * Slice F's exit criterion is "Preview và export dùng cùng evaluator/composition
 * rules", and every gate before this one compared the two hosts on their own
 * vocabulary: the paint-stack spec matched core's row set against the `enable`
 * expressions the compiler emitted, the layer specs matched the numbers the DOM
 * reads. None of them asked the question a viewer asks: if I take the answer the
 * PREVIEW gets at each frame — `compositePlan` — and composite it myself, do I
 * land on the colour the FILE actually holds?
 *
 * So the expectation here is built from core's plan alone. No authored clip
 * field is read, no colour table is indexed by frame index, nothing is taken
 * from the render. Three footage rows (opaque base, a half-transparent row, a
 * row whose opacity is keyframed 0->100) and one caption:
 *
 *  1. MODEL — the caption's `enable` window in the compiled graph is exactly the
 *     frames the plan calls the overlay live, boundaries included. Runs with no
 *     FFmpeg on the box.
 *  2. MODEL — the prediction actually varies: the fixture would silently degrade
 *     to a flat-colour test if the windows or the ramp were edited away.
 *  3. GUARD — the expectation reads `slot.layer.*` and nothing else, so a future
 *     edit cannot quietly re-derive the answer from the authored project.
 *  4. PIXELS — every scheduled frame of a real render equals the prediction at
 *     four corner samples (measured here: 480 samples, worst drift 5 of 12).
 *  5. PIXELS — the boundary frames are named one by one: the frame before a row
 *     starts, its first frame (the keyframed row starts at opacity 0, so the
 *     pixel does not move), the frame its keyframe lands on, and the frame after
 *     it ends.
 *  6. PIXELS — the caption has ink on exactly the frames the plan names it, and
 *     none outside them.
 *
 * The pixel legs skip (out loud, so `run-all.mts` reports PARTIAL, not PASS)
 * when no FFmpeg binary is available; the model and guard legs always run.
 *
 * The fixture was falsified before it was trusted: swapping which plate file
 * carries which colour makes check 4 fail on frame 30 (`got [125,52,107], want
 * within 12 of [15,145,150]`), and compositing the slots in the wrong order
 * makes check 2 collapse to two distinct colours. Both mutations were reverted;
 * the numbers above are from the run with the file in its committed state.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_preview_export_pixel_parity.spec.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, compositePlan, createFrameScheduler, evaluateTimeline } from 'tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ffmpegCandidates = [
  process.env.TOOLS_FFMPEG_PATH,
  path.join(repoRoot, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
]
const ffmpeg = ffmpegCandidates.find(candidate => candidate && fs.existsSync(candidate))
// The caption leg needs a face FreeType can open; every entry is a system font.
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/Library/Fonts/Arial.ttf'
]
const fontFile = FONT_CANDIDATES.find(candidate => fs.existsSync(candidate))

const W = 128
const H = 72
const FPS = 30
type RGB = [number, number, number]
const BG: RGB = [16, 32, 48]
const BLUE: RGB = [30, 90, 200]
const RED: RGB = [220, 20, 20]
const GREEN: RGB = [0, 200, 100]
/**
 * Measured on the bundled binary for this fixture: an authored flat colour lands
 * within 3 units of itself through yuv420p, and a 50 % composite of two of them
 * lands within 6 of the RGB-space mix the plan predicts (the overlay mixes in
 * YUV, so the error of the two round trips adds up). 12 is the honest ceiling,
 * not a slack number — the check is still 300x finer than "is there a picture".
 */
const MODEL_TOL = 12
/** A pixel this far from the predicted plate is ink, not encoder noise. */
const INK_DISTANCE = 24
/** One 20 px word on a 128x72 canvas covers far more than this. */
const INK_MIN = 30
// The bundled ffmpeg cannot open files under the OS temp dir on Windows, and
// `.golden-render-*/` is the ignore pattern already in .gitignore.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-parity-'))

const hex = (c: RGB) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
const tk = (sec: number) => Math.round(sec * TICKS_PER_SECOND)

function runFfmpeg(args: string[]): void {
  const res = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffmpeg failed: ${res.stderr}`)
}

/** A solid plate with a silent audio lane, so the base row's concat always pairs. */
function plateFile(name: string, color: RGB, seconds: number): string {
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
function decodeAllFrames(file: string): Buffer {
  const target = path.join(workDir, `frames-${++decoded}.rgba`)
  runFfmpeg(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', target])
  return fs.readFileSync(target)
}

const STRIDE = W * H * 4
function frameBytes(frames: Buffer, index: number): Uint8Array {
  return new Uint8Array(frames.buffer.slice(
    frames.byteOffset + index * STRIDE, frames.byteOffset + (index + 1) * STRIDE))
}
function pixelAt(frames: Buffer, frame: number, x: number, y: number): RGB {
  const base = frame * STRIDE + (y * W + x) * 4
  return [frames[base]!, frames[base + 1]!, frames[base + 2]!]
}
function frameCount(frames: Buffer): number {
  return frames.length / STRIDE
}

interface Item {
  id: string
  src?: string
  text?: string
  offset: number
  in: number
  out: number
  opacity?: number
  keyframes?: { t: number, prop: string, value: number }[]
  fontSize?: number
  color?: string
  fontFile?: string
}

interface TrackSeed {
  id: string
  type: 'video' | 'text'
  items: Item[]
}

function projectOf(tracks: TrackSeed[]): TmcutProject {
  return {
    version: 1,
    name: 'preview-vs-export parity',
    canvas: { width: W, height: H, fps: FPS, background: { type: 'color', value: hex(BG) } },
    timeline: {
      tracks: tracks.map(t => ({
        id: t.id,
        type: t.type,
        name: t.id,
        items: t.items.map(item => ({ ...item, trackId: t.id }))
      }))
    }
  } as unknown as TmcutProject
}

const clip = (id: string, src: string, offsetSec: number, spanSec: number, extra: Item = {}): Item =>
  ({ id, src, offset: tk(offsetSec), in: 0, out: tk(spanSec), ...extra })

/** The authored plate behind each footage clip — the only place a colour enters. */
const PLATE: Record<string, RGB> = { a: BLUE, b: RED, c: GREEN }

/**
 * What the PREVIEW paints at one tick: `compositePlan` in slot order, each
 * layer composited with the opacity core answered for it. Nothing here reads
 * the authored project — that is the whole point of the fixture.
 */
function modelAt(project: TmcutProject, atTicks: number): RGB {
  const out: RGB = [BG[0], BG[1], BG[2]]
  for (const slot of compositePlan(evaluateTimeline(project, atTicks)).slots) {
    if (slot.kind !== 'footage') continue
    const plate = PLATE[slot.clipId]
    const alpha = slot.layer.opacity
    if (!plate || !(alpha > 0)) continue
    out[0] += (plate[0] - out[0]) * alpha
    out[1] += (plate[1] - out[1]) * alpha
    out[2] += (plate[2] - out[2]) * alpha
  }
  return out
}

function planTextFrames(project: TmcutProject, clipId: string): number[] {
  const live: number[] = []
  for (const frame of createFrameScheduler(project).frames()) {
    const overlay = compositePlan(evaluateTimeline(project, frame.startTicks)).slots
      .find(slot => slot.kind === 'overlay' && slot.clipId === clipId)
    if (overlay && overlay.layer.opacity > 0) live.push(frame.index)
  }
  return live
}

function filterComplexOf(compiled: { args: string[] }): string {
  const index = compiled.args.indexOf('-filter_complex')
  assert.ok(index >= 0, 'the compiled command has no filter graph')
  return compiled.args[index + 1]!
}

/** The half-open window one `drawtext` paints in, in seconds. */
function drawtextWindows(graph: string): [number, number][] {
  return [...graph.matchAll(/drawtext=[\s\S]*?:enable='gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)'/g)]
    .map(m => [Number(m[1]), Number(m[2])] as [number, number])
}

function framesOfWindow([start, end]: [number, number]): number[] {
  const out: number[] = []
  for (let i = Math.round(start * FPS); i < Math.round(end * FPS); i++) out.push(i)
  return out
}

/** Pixels far enough from the predicted plate to be the caption's ink. */
function inkCount(frame: Uint8Array, model: RGB): number {
  let ink = 0
  for (let i = 0; i < W * H; i++) {
    const worst = Math.max(
      Math.abs(frame[i * 4]! - model[0]),
      Math.abs(frame[i * 4 + 1]! - model[1]),
      Math.abs(frame[i * 4 + 2]! - model[2])
    )
    if (worst > INK_DISTANCE) ink++
  }
  return ink
}

const CORNERS: [number, number][] = [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2]]

let passed = 0
function check(label: string, fn: () => void): void {
  fn()
  passed++
  console.log(`   ${label} PASSED (${passed})`)
}

/**
 * Base row opaque 0-3 s, a 50 % row 1-3 s, a row whose opacity is keyframed
 * 0->100 over its own first second, and a caption 1.5-2.5 s. `plates` maps the
 * authored file names to the real files, so the graph-only project keeps the
 * placeholders and still compiles.
 */
function seededProject(plates: Record<string, string>, caption: boolean): TmcutProject {
  const tracks: TrackSeed[] = [
    { id: 'v1', type: 'video', items: [clip('a', 'bottom.mp4', 0, 3)] },
    { id: 'v2', type: 'video', items: [clip('b', 'top.mp4', 1, 2, { opacity: 50 })] },
    {
      id: 'v3',
      type: 'video',
      items: [clip('c', 'third.mp4', 2, 2, {
        keyframes: [{ t: 0, prop: 'opacity', value: 0 }, { t: tk(1), prop: 'opacity', value: 100 }]
      })]
    }
  ]
  if (caption) {
    tracks.push({
      id: 't1',
      type: 'text',
      items: [clip('cap', '', 1.5, 1, { text: 'ABCD 0123', fontSize: 20, color: 'white', fontFile })]
    })
  }
  return projectOf(tracks.map(t => ({
    ...t,
    items: t.items.map(item => ({ ...item, ...(item.src ? { src: plates[item.src] ?? item.src } : {}) }))
  })))
}

/** Alpha-composite `top` over `bottom`, the way a host composites a layer. */
function mix(bottom: RGB, top: RGB, alpha: number): RGB {
  return [
    bottom[0] + (top[0] - bottom[0]) * alpha,
    bottom[1] + (top[1] - bottom[1]) * alpha,
    bottom[2] + (top[2] - bottom[2]) * alpha
  ]
}

function assertColorNear(frames: Buffer, index: number, want: RGB, msg: string): void {
  const got = pixelAt(frames, index, W >> 1, H >> 1)
  const worst = Math.max(...got.map((v, i) => Math.abs(v - want[i]!)))
  assert.ok(worst <= MODEL_TOL,
    `${msg}: got ${JSON.stringify(got.map(Math.round))}, want within ${MODEL_TOL} of ${JSON.stringify(want.map(Math.round))}`)
}

function assertColorSeen(frames: Buffer, want: RGB, msg: string): void {
  for (let index = 0; index < frameCount(frames); index++) {
    const got = pixelAt(frames, index, W >> 1, H >> 1)
    if (Math.max(...got.map((v, i) => Math.abs(v - want[i]!))) <= 5) return
  }
  assert.fail(`no frame reads as ${msg}: ${JSON.stringify(want)}`)
}

function main(): void {
  console.log('=== [TMCut preview-vs-export pixel parity] Starting ===\n')

  const graphProject = seededProject({}, true)

  // 1. MODEL, no FFmpeg: the file's caption window is the plan's caption frames.
  check('the caption window in the graph is the window the plan names', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(graphProject, 'out.mp4'))
    const windows = drawtextWindows(graph)
    assert.equal(windows.length, 1, `one caption, one drawtext window, got ${JSON.stringify(windows)}`)
    assert.ok(!graph.includes('between(t,'), 'between() includes its upper bound; the window must not')
    const fromFile = framesOfWindow(windows[0]!)
    const fromPlan = planTextFrames(graphProject, 'cap')
    assert.deepEqual(fromFile, fromPlan,
      `file ${JSON.stringify(fromFile.slice(0, 3))}..${fromFile.length}, plan ${JSON.stringify(fromPlan.slice(0, 3))}..${fromPlan.length}`)
    assert.equal(fromPlan[0], tk(1.5) / TICKS_PER_SECOND * FPS, 'the caption starts on its own frame')
    assert.equal(fromPlan.length, 1 * FPS, 'and holds exactly its own span')
  })

  // 2. MODEL: the prediction varies frame to frame, or the fixture is worthless.
  check('the prediction is a per-frame answer, not one colour', () => {
    const scheduler = createFrameScheduler(graphProject)
    const seen = new Set<string>()
    let stacked = 0
    for (const frame of scheduler.frames()) {
      const slots = compositePlan(evaluateTimeline(graphProject, frame.startTicks)).slots
        .filter(slot => slot.kind === 'footage')
      if (slots.length > 1) stacked++
      const colour = modelAt(graphProject, frame.startTicks).map(v => Math.round(v))
      seen.add(colour.join(','))
    }
    assert.equal(scheduler.frameCount, 4 * FPS, 'the file is as long as the last row')
    assert.ok(stacked >= 2 * FPS, `the sweep must sit in the stacked region, got ${stacked} frames`)
    // Measured: 4 s gives 32 distinct answers — one for the base alone, one for
    // the 50 % mix, one per ramp frame (30, rounded) and one for full green.
    // A project edited until the ramp disappears drops this under 30.
    assert.ok(seen.size >= FPS,
      `the keyframed row must move the answer on nearly every frame, got ${seen.size} distinct colours`)
  })

  // 3. GUARD: the expectation is allowed to read the plan and the plate table only.
  check('the expectation is derived from the plan alone', () => {
    const own = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')
    const body = /function modelAt[\s\S]*?\n\}/.exec(own)?.[0] ?? ''
    assert.ok(body.length > 0, 'the fixture lost its model function')
    assert.match(body, /compositePlan\(evaluateTimeline/, 'the model must come from the plan')
    assert.match(body, /slot\.layer\.opacity/, 'the number composited is the layer opacity')
    assert.doesNotMatch(body, /\bclip\.(opacity|keyframes|offset|in|out)\b/, 'no authored field is read')
    assert.doesNotMatch(body, /PLATE\[slot\.clipId\]\s*===/, 'the plate is looked up, never keyed by frame')
  })

  if (!ffmpeg) {
    console.log('\nSKIP  the pixel gate: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)')
  } else {
    const seconds = 6
    const plates: Record<string, string> = {
      'bottom.mp4': plateFile('plate-bottom.mp4', BLUE, seconds),
      'top.mp4': plateFile('plate-top.mp4', RED, seconds),
      'third.mp4': plateFile('plate-third.mp4', GREEN, seconds)
    }

    function renderTo(name: string, project: TmcutProject): string {
      const file = path.join(workDir, name).replace(/\\/g, '/')
      runFfmpeg(compileTimelineToFfmpeg(project, file).args)
      return file
    }

    // 4. PIXELS: every frame of a real render is the frame the plan predicts.
    check('the rendered file matches the plan on every frame', () => {
      const project = seededProject(plates, false)
      const frames = decodeAllFrames(renderTo('parity-footage.mp4', project))
      const total = frameCount(frames)
      assert.equal(total, 4 * FPS, `4 s at ${FPS} fps, got ${total} frames`)

      let worstDiff = 0
      let compared = 0
      for (const frame of createFrameScheduler(project).frames()) {
        const want = modelAt(project, frame.startTicks)
        for (const [x, y] of CORNERS) {
          const got = pixelAt(frames, frame.index, x, y)
          compared++
          const diff = Math.max(...got.map((v, i) => Math.abs(v - want[i]!)))
          if (diff > worstDiff) worstDiff = diff
          assert.ok(diff <= MODEL_TOL,
            `frame ${frame.index} @ ${frame.startTicks} ticks (${(frame.index / FPS).toFixed(3)} s) at ${x},${y}: `
            + `got ${JSON.stringify(got.map(Math.round))}, want within ${MODEL_TOL} of ${JSON.stringify(want.map(Math.round))}`)
        }
      }
      console.log(`   (measured: ${compared} samples, worst drift ${worstDiff} of ${MODEL_TOL})`)
      // Each plate must reach the pixels: the base on its own, the half-open
      // mix while row two is up, and full green after the ramp lands.
      assertColorSeen(frames, BLUE, 'the base row alone')
      assertColorSeen(frames, mix(BLUE, RED, 0.5), 'the half-transparent row over the base')
      assertColorSeen(frames, GREEN, 'the keyframed row at full opacity')
    })

    // 5. PIXELS: the boundaries are named one by one (req 7: first/mid/last frame,
    //    transition + keyframe boundary).
    check('each boundary lands on the frame the plan puts it on', () => {
      const project = seededProject(plates, false)
      const frames = decodeAllFrames(renderTo('parity-bounds.mp4', project))
      const expectAt = (index: number, want: RGB, msg: string) => {
        assertColorNear(frames, index, want, `${msg} (frame ${index}, ${(index / FPS).toFixed(3)} s)`)
      }
      expectAt(0, BLUE, 'first frame: the base row alone')
      expectAt(29, BLUE, 'the frame before the half-transparent row starts')
      expectAt(30, mix(BLUE, RED, 0.5), 'its first frame, at the opacity the layer answers')
      expectAt(59, mix(BLUE, RED, 0.5), 'the frame before the keyframed row starts')
      // The keyframe boundary: the row is LIVE at 2 s and its alpha is 0, so the
      // plan names it and the pixel does not change. ADR-018 half-open, one way.
      expectAt(60, mix(BLUE, RED, 0.5), 'the keyframed row starts at opacity 0')
      expectAt(75, nearGreen(BLUE, RED, 0.5, 0.5), 'mid-ramp is neither endpoint')
      expectAt(89, nearGreen(BLUE, RED, 0.5, 29 / 30), 'the frame before the keyframe lands')
      expectAt(90, GREEN, 'the keyframe: full opacity, and the base row has ended')
      expectAt(119, GREEN, 'last frame of the file')
    })

    // 6. PIXELS: the caption has ink on exactly the frames the plan names it.
    if (!fontFile) {
      console.log('\nSKIP  the caption gate: no system TrueType font for drawtext')
    } else {
      check('the caption paints on exactly the frames the plan names', () => {
        const project = seededProject(plates, true)
        const frames = decodeAllFrames(renderTo('parity-caption.mp4', project))
        const live = new Set(planTextFrames(project, 'cap'))
        assert.equal(live.size, FPS, 'the plan holds the caption for 1 s')
        let painted = 0
        for (const frame of createFrameScheduler(project).frames()) {
          const ink = inkCount(frameBytes(frames, frame.index), modelAt(project, frame.startTicks))
          const expected = live.has(frame.index)
          if (expected) {
            painted++
            assert.ok(ink >= INK_MIN,
              `frame ${frame.index}: the plan says the caption is up, ink ${ink} < ${INK_MIN}`)
          } else {
            assert.ok(ink === 0,
              `frame ${frame.index}: the plan says no caption, but ${ink} pixels leave the plate`)
          }
        }
        assert.equal(painted, FPS, 'every planned caption frame carries ink')
      })
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true })
  console.log(`\n=== All ${passed} preview-vs-export parity checks passed ===`)
}

/** The mid-ramp frame is two composites deep, so it is built the way the plan is. */
function nearGreen(base: RGB, over: RGB, overAlpha: number, greenAlpha: number): RGB {
  return mix(mix(base, over, overAlpha), GREEN, greenAlpha)
}

try {
  main()
} catch (error) {
  // The scratch dir is inside the repo on purpose; a failure must not leave it.
  fs.rmSync(workDir, { recursive: true, force: true })
  console.error('FAILED:', error)
  process.exit(1)
}
