/**
 * Render parity gate (V4 M2): the compiled FFmpeg export must place and
 * colour a clip where `evaluateTimeline` says it is. The evaluator is the
 * shared answer both renderers consume (Phase 1), so this spec renders a
 * tiny project with the real compiler + bundled FFmpeg and samples pixels
 * against geometry DERIVED FROM THE EVALUATOR — not from the compiler's own
 * transform helper, which would make the check circular.
 *
 * Five subjects, all font-free:
 *  1. transform clip (scale 50, x 6, y -4, opacity 60) — pixel rect + alpha.
 *  2. speed-2 clip over a red→green source — timeline tick → source tick.
 *  3. the clip window boundary — the export, the evaluator and the preview all
 *     stop a clip on the same frame (ADR-018, half-open `[start, end)`).
 *  4. the mask — the shape the model reports is the shape the export cuts,
 *     including `invert` (V4 M3).
 *  5. the transition — the window and the frame level follow the progress the
 *     model reports, not the graph's own arithmetic (V4 M3).
 *
 * Skips when no FFmpeg binary is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, createClock, evaluateTimeline } from 'tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import { lastRenderableTicks } from '../../app/utils/tmcut/clipTime'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ffmpegCandidates = [
  process.env.TOOLS_FFMPEG_PATH,
  path.join(repoRoot, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
]
const ffmpeg = ffmpegCandidates.find(candidate => candidate && fs.existsSync(candidate))

if (!ffmpeg) {
  console.log('SKIP  render parity: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)')
  process.exit(0)
}

const WIDTH = 64
const HEIGHT = 36
const BG = { r: 0x12, g: 0x34, b: 0x56 }
// The bundled ffmpeg cannot open OS-temp files on Windows; keep the work dir here.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-parity-'))
let checks = 0
let decoded = 0

function check(name: string, fn: () => void): void {
  fn()
  checks += 1
  console.log(`[ok] ${name}`)
}

function runFfmpeg(args: string[]): void {
  const res = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffmpeg failed: ${res.stderr}`)
}

function decodeTo(target: string, seekArgs: string[]): Uint8Array {
  runFfmpeg([...seekArgs, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', target])
  const bytes = new Uint8Array(fs.readFileSync(target))
  assert.equal(bytes.length, WIDTH * HEIGHT * 4, 'decoded frame is one canvas RGBA frame')
  return bytes
}

function decodeFrame(file: string, atSec: number): Uint8Array {
  return decodeTo(path.join(workDir, `frame-${++decoded}.rgba`), ['-ss', atSec.toFixed(3), '-i', file])
}

/** Frame-exact decode: `-ss` seeks to the nearest keyframe, boundary checks need `n`. */
function decodeFrameIndex(file: string, index: number): Uint8Array {
  return decodeTo(path.join(workDir, `frame-${++decoded}.rgba`), ['-i', file, '-vf', `select=eq(n\\,${index})`])
}

function pixel(frame: Uint8Array, x: number, y: number): { r: number, g: number, b: number } {
  const at = (y * WIDTH + x) * 4
  return { r: frame[at]!, g: frame[at + 1]!, b: frame[at + 2]! }
}

function near(actual: number, expected: number, tolerance: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: got ${actual}, expected ${expected} ± ${tolerance}`
  )
}

function baseProject(name: string): TmcutProject {
  return {
    version: 1,
    name,
    canvas: {
      width: WIDTH,
      height: HEIGHT,
      fps: 30,
      background: { type: 'color', value: '#123456' }
    },
    timeline: {
      tracks: [
        { id: 'v1', type: 'video', name: 'Video', items: [] },
        { id: 't1', type: 'text', name: 'Text', items: [] }
      ]
    }
  } as unknown as TmcutProject
}

function render(project: TmcutProject, fileName: string): string {
  const output = path.join(workDir, fileName).replace(/\\/g, '/')
  const compiled = compileTimelineToFfmpeg(project, output)
  runFfmpeg(compiled.args)
  return output
}

try {
  const whiteSource = path.join(workDir, 'white-64x36.mp4').replace(/\\/g, '/')
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=white:s=${WIDTH}x${HEIGHT}:r=30:d=2`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', whiteSource
  ])

  // --- 1. transform geometry + opacity -------------------------------------
  const transformProject = baseProject('Parity transform')
  transformProject.timeline.tracks[0]!.items = [{
    id: 'clip-a',
    src: whiteSource,
    in: 0,
    out: 2 * TICKS_PER_SECOND,
    offset: 0,
    speed: 1,
    opacity: 60,
    scale: 50,
    x: 6,
    y: -4,
    rotation: 0,
    fit: 'fit'
  }]
  const transformOutput = render(transformProject, 'transform.mp4')

  const at = 0.5 * TICKS_PER_SECOND
  const layer = evaluateTimeline(transformProject, at).layers.find(item => item.clipId === 'clip-a')

  check('evaluator resolves the transform clip at 0.5s', () => {
    assert.ok(layer, 'clip-a layer should be live at 0.5s')
    assert.equal(layer.startTicks, 0)
    assert.equal(layer.endTicks, 2 * TICKS_PER_SECOND)
    assert.equal(layer.sourceTicks, at)
    near(layer.transform.scaleX, 0.5, 1e-9, 'scaleX')
    near(layer.transform.scaleY, 0.5, 1e-9, 'scaleY')
    near(layer.transform.x, 6, 1e-9, 'x')
    near(layer.transform.y, -4, 1e-9, 'y')
    near(layer.opacity, 0.6, 1e-9, 'opacity')
  })

  check('evaluator drops the clip at its exclusive end', () => {
    assert.equal(evaluateTimeline(transformProject, 2 * TICKS_PER_SECOND).layers.length, 0)
  })

  // Independent oracle: the centred box scaled by the evaluator's
  // multipliers, shifted by its (unscaled) canvas offsets, rasterised.
  assert.ok(layer, 'transform layer')
  const w = Math.max(2, Math.round(WIDTH * layer.transform.scaleX / 2) * 2)
  const h = Math.max(2, Math.round(HEIGHT * layer.transform.scaleY / 2) * 2)
  const left = Math.round((WIDTH - w) / 2 + layer.transform.x)
  const top = Math.round((HEIGHT - h) / 2 + layer.transform.y)
  const expected = {
    r: layer.opacity * 255 + (1 - layer.opacity) * BG.r,
    g: layer.opacity * 255 + (1 - layer.opacity) * BG.g,
    b: layer.opacity * 255 + (1 - layer.opacity) * BG.b
  }
  const frame = decodeFrame(transformOutput, 0.5)

  check('export paints the evaluator rect at the evaluator opacity', () => {
    const inside = pixel(frame, left + Math.floor(w / 2), top + Math.floor(h / 2))
    near(inside.r, expected.r, 8, 'rect red')
    near(inside.g, expected.g, 8, 'rect green')
    near(inside.b, expected.b, 8, 'rect blue')
  })

  check('export keeps the canvas background outside the evaluator rect', () => {
    const centreX = left + Math.floor(w / 2)
    const centreY = top + Math.floor(h / 2)
    const probes: Array<[number, number]> = [
      [Math.max(0, left - 3), centreY],
      [Math.min(WIDTH - 1, left + w + 2), centreY],
      [centreX, Math.max(0, top - 3)],
      [centreX, Math.min(HEIGHT - 1, top + h + 2)]
    ]
    for (const [x, y] of probes) {
      const bg = pixel(frame, x, y)
      near(bg.r, BG.r, 6, `background red at ${x},${y}`)
      near(bg.g, BG.g, 6, `background green at ${x},${y}`)
      near(bg.b, BG.b, 6, `background blue at ${x},${y}`)
    }
  })

  // --- 2. speed changes the timeline -> source mapping ---------------------
  const timedSource = path.join(workDir, 'red-green-64x36.mp4').replace(/\\/g, '/')
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=red:s=${WIDTH}x${HEIGHT}:r=30:d=1`,
    '-f', 'lavfi', '-i', `color=c=#00FF00:s=${WIDTH}x${HEIGHT}:r=30:d=1`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
    '-map', '[v]', '-map', '2:a', '-shortest',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', timedSource
  ])

  const speedProject = baseProject('Parity speed')
  speedProject.timeline.tracks[0]!.items = [{
    id: 'clip-b',
    src: timedSource,
    in: 0,
    out: 2 * TICKS_PER_SECOND,
    offset: 0,
    speed: 2,
    opacity: 100,
    scale: 100,
    x: 0,
    y: 0,
    rotation: 0,
    fit: 'fit'
  }]
  const speedOutput = render(speedProject, 'speed.mp4')
  const evalAt = (sec: number) => evaluateTimeline(speedProject, Math.round(sec * TICKS_PER_SECOND))
    .layers.find(item => item.clipId === 'clip-b')

  check('evaluator maps a speed-2 timeline tick to double the source tick', () => {
    assert.equal(evalAt(0.25)?.sourceTicks, 0.5 * TICKS_PER_SECOND)
    assert.equal(evalAt(0.75)?.sourceTicks, 1.5 * TICKS_PER_SECOND)
    assert.equal(evalAt(0.99)?.endTicks, TICKS_PER_SECOND)
    assert.equal(evalAt(1), undefined)
  })

  check('export reads the same source position the evaluator reports', () => {
    const firstHalf = pixel(decodeFrame(speedOutput, 0.25), WIDTH >> 1, HEIGHT >> 1)
    assert.ok(firstHalf.r > 180 && firstHalf.g < 90 && firstHalf.b < 90, `expected red, got ${JSON.stringify(firstHalf)}`)
    const secondHalf = pixel(decodeFrame(speedOutput, 0.75), WIDTH >> 1, HEIGHT >> 1)
    assert.ok(secondHalf.g > 180 && secondHalf.r < 90 && secondHalf.b < 90, `expected green, got ${JSON.stringify(secondHalf)}`)
  })

  // --- 3. the clip window boundary (ADR-018) --------------------------------
  // One rule for every consumer: a clip window is half-open, `[start, end)`.
  // FFmpeg's between() INCLUDES its upper bound, so the previous export
  // expression painted a finished caption onto the first frame of the window
  // after it — and the preview agreed, so both were wrong together. gte*lt is
  // measured here rather than trusted: the frame starting exactly at the end
  // must be back to the background.
  const windowOutput = path.join(workDir, 'window.mp4').replace(/\\/g, '/')
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=30:d=3`,
    '-f', 'lavfi', '-i', `color=c=red:s=16x9:r=30:d=3`,
    '-filter_complex', `[0:v][1:v]overlay=x=24:y=13:enable='gte(t,1)*lt(t,2)'[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', windowOutput
  ])

  check('the half-open window stops before the frame that starts at its end', () => {
    const before = pixel(decodeFrameIndex(windowOutput, 59), WIDTH >> 1, HEIGHT >> 1)
    assert.ok(before.r > 180, `frame 59 (1.967s) carries the plate, got ${JSON.stringify(before)}`)
    const boundary = pixel(decodeFrameIndex(windowOutput, 60), WIDTH >> 1, HEIGHT >> 1)
    assert.ok(boundary.r < 40, `frame 60 (2.000s, the window end) is back to the background, got ${JSON.stringify(boundary)}`)
    const after = pixel(decodeFrameIndex(windowOutput, 61), WIDTH >> 1, HEIGHT >> 1)
    assert.ok(after.r < 40, `frame 61 (2.033s) is back to the background, got ${JSON.stringify(after)}`)
  })

  const windowProject = baseProject('Parity window')
  windowProject.timeline.tracks[1]!.items = [{
    id: 'text-1',
    trackId: 't1',
    text: 'X',
    offset: TICKS_PER_SECOND,
    in: 0,
    out: TICKS_PER_SECOND,
    speed: 1,
    fontSize: 24,
    color: 'white'
  }]
  const windowCompiled = compileTimelineToFfmpeg(windowProject, 'window-export.mp4')
  const windowFilter = windowCompiled.args[windowCompiled.args.indexOf('-filter_complex') + 1]!

  check('export text window uses the evaluator half-open rule', () => {
    assert.ok(
      windowFilter.includes(`enable='gte(t,1)*lt(t,2)'`),
      `expected the half-open export window, got ${windowFilter}`
    )
    assert.ok(!windowFilter.includes('between(t,'), `no inclusive window may remain, got ${windowFilter}`)
    assert.equal(evaluateTimeline(windowProject, 2 * TICKS_PER_SECOND).layers.find(item => item.clipId === 'text-1'), undefined)
    assert.ok(evaluateTimeline(windowProject, TICKS_PER_SECOND).layers.find(item => item.clipId === 'text-1'), 'the window opens on its first frame')
  })

  // The same rule taken to the end of the timeline: parked at the total
  // duration the playhead sits one instant past the last frame, where a
  // half-open window answers "nothing" — so the preview renders from the start
  // of that last frame instead (lastRenderableTicks, ADR-018).
  check('the final frame of the timeline still renders its closing caption', () => {
    const endTicks = 2 * TICKS_PER_SECOND
    const at = lastRenderableTicks(createClock({ numerator: 30, denominator: 1 }), endTicks)
    assert.equal(at, endTicks - 4000, 'one frame before the end, not past it')
    assert.equal(evaluateTimeline(windowProject, endTicks).layers.find(item => item.clipId === 'text-1'), undefined, 'the raw end belongs to no clip')
    assert.ok(evaluateTimeline(windowProject, at).layers.find(item => item.clipId === 'text-1'), 'the last frame keeps its text')
  })

  // --- 4. the mask the model reports is the mask the export paints ---------
  // V4 M3: mask geometry used to be a verbatim passthrough on the layer and a
  // `raw.mask` read in the compiler. Both builders call core normalizeMask, so
  // the pixels below are the first proof that the shape the model reports is
  // the shape that actually gets cut — and that `invert` travels.
  const MASK_BOX = { shape: 'circle', x: 0.25, y: 0.2, w: 0.5, h: 0.6, feather: 0, rotation: 0, invert: false, axis: 'x' }

  function maskedProject(name: string, invert: boolean): TmcutProject {
    const project = baseProject(name)
    project.timeline.tracks[0]!.items = [{
      id: 'clip-m',
      src: whiteSource,
      in: 0,
      out: 2 * TICKS_PER_SECOND,
      offset: 0,
      speed: 1,
      opacity: 100,
      scale: 100,
      x: 0,
      y: 0,
      rotation: 0,
      fit: 'fit',
      mask: { ...MASK_BOX, invert }
    }]
    return project
  }

  /**
   * The geq samples at `X/W`, `Y/H` with X the pixel index, so the oracle is
   * written the same way from the layer's NORMALIZED mask: hypot of the
   * axis-relative distance is < 1 inside the shape and > 1 outside it. Nothing
   * here comes from the compiler's own fit/mask helpers.
   */
  function maskCoverage(mask: { x: number, y: number, w: number, h: number }, x: number, y: number): number {
    const dx = (x / WIDTH - (mask.x + mask.w / 2)) / (mask.w / 2)
    const dy = (y / HEIGHT - (mask.y + mask.h / 2)) / (mask.h / 2)
    return Math.hypot(dx, dy)
  }

  const maskProject = maskedProject('Parity mask', false)
  const maskLayer = evaluateTimeline(maskProject, 0.5 * TICKS_PER_SECOND).layers.find(item => item.clipId === 'clip-m')
  check('the evaluator reports normalized mask geometry for the stored shape', () => {
    assert.ok(maskLayer, 'clip-m should be live at 0.5s')
    assert.ok(maskLayer.mask, 'a valid circle must report a mask')
    assert.equal(maskLayer.mask.shape, 'circle')
    assert.equal(maskLayer.mask.feather, 0, 'feather 0 stays a hard edge')
  })

  const maskOutput = render(maskProject, 'mask.mp4')
  const maskFrame = decodeFrame(maskOutput, 0.5)

  check('the export cuts exactly the ellipse the model describes', () => {
    assert.ok(maskLayer?.mask, 'mask geometry needed for the oracle')
    const painted: Array<[number, number]> = [[32, 18], [24, 18], [32, 12]]
    const cleared: Array<[number, number]> = [[0, 18], [63, 18], [32, 1], [32, 34]]
    for (const [x, y] of painted) {
      assert.ok(maskCoverage(maskLayer.mask, x, y) < 0.75, `probe ${x},${y} is not well inside the model shape`)
      const p = pixel(maskFrame, x, y)
      near(p.r, 255, 8, `inside the mask at ${x},${y} shows the source`)
      near(p.g, 255, 8, `inside the mask at ${x},${y} shows the source`)
    }
    for (const [x, y] of cleared) {
      assert.ok(maskCoverage(maskLayer.mask, x, y) > 1.3, `probe ${x},${y} is not well outside the model shape`)
      const p = pixel(maskFrame, x, y)
      near(p.r, BG.r, 6, `outside the mask at ${x},${y} shows the canvas background`)
      near(p.b, BG.b, 6, `outside the mask at ${x},${y} shows the canvas background`)
    }
  })

  const invertedOutput = render(maskedProject('Parity mask inverted', true), 'mask-invert.mp4')
  const invertedLayer = evaluateTimeline(maskedProject('Parity mask inverted', true), 0.5 * TICKS_PER_SECOND)
    .layers.find(item => item.clipId === 'clip-m')
  const invertedFrame = decodeFrame(invertedOutput, 0.5)

  check('the invert flag in the model flips the painted side', () => {
    assert.equal(invertedLayer?.mask?.invert, true, 'the model must carry invert through')
    const centre = pixel(invertedFrame, 32, 18)
    near(centre.r, BG.r, 6, 'inverted: the shape interior is cleared')
    const corner = pixel(invertedFrame, 0, 1)
    near(corner.r, 255, 8, 'inverted: outside the shape shows the source')
  })

  // --- 5. the transition window and ramp the model reports are the ones
  // the export crossfades (V4 M3) ------------------------------------------
  // Two achromatic plates: xfade blends the planes, and an affine
  // limited-range round-trip preserves the blend, so the expected level is the
  // model's own progress — not a number read off the graph.
  const graySource = path.join(workDir, 'gray-64x36.mp4').replace(/\\/g, '/')
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=#404040:s=${WIDTH}x${HEIGHT}:r=30:d=2`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', graySource
  ])

  const transitionProject = baseProject('Parity transition')
  transitionProject.timeline.tracks[0]!.items = [{
    id: 'clip-t1',
    src: graySource,
    in: 0,
    out: 2 * TICKS_PER_SECOND,
    offset: 0,
    speed: 1,
    opacity: 100,
    scale: 100,
    x: 0,
    y: 0,
    rotation: 0,
    fit: 'fit'
  }, {
    id: 'clip-t2',
    src: whiteSource,
    in: 0,
    out: 2 * TICKS_PER_SECOND,
    offset: Math.round(1.6 * TICKS_PER_SECOND),
    speed: 1,
    opacity: 100,
    scale: 100,
    x: 0,
    y: 0,
    rotation: 0,
    fit: 'fit',
    transitionIn: { type: 'fade', duration: Math.round(0.4 * TICKS_PER_SECOND) }
  }]
  const transitionOutput = render(transitionProject, 'transition.mp4')

  check('the overlap window the model reports is the window both clips are live in', () => {
    const at = Math.round(1.6 * TICKS_PER_SECOND)
    const opening = evaluateTimeline(transitionProject, at).layers
    assert.deepEqual(opening.map(layer => layer.clipId).sort(), ['clip-t1', 'clip-t2'], 'the window opens on its first tick')
    const before = evaluateTimeline(transitionProject, at - 1).layers
    assert.deepEqual(before.map(layer => layer.clipId), ['clip-t1'], 'one tick earlier is still a single clip')
    const after = evaluateTimeline(transitionProject, 2 * TICKS_PER_SECOND).layers
    assert.deepEqual(after.map(layer => layer.clipId), ['clip-t2'], 'the window end belongs to the incoming clip only')
  })

  check('the exported ramp follows the progress the model reports', () => {
    for (const frame of [48, 51, 54, 57, 60]) {
      const at = frame * (TICKS_PER_SECOND / 30)
      const incoming = evaluateTimeline(transitionProject, at).layers.find(layer => layer.clipId === 'clip-t2')
      assert.ok(incoming, `clip-t2 must be live at frame ${frame}`)
      const progress = at >= 2 * TICKS_PER_SECOND ? 1 : incoming.transition?.progress
      assert.notEqual(progress, undefined, `the model must report a progress at frame ${frame}`)
      // Gray plate (64) into white plate (255), mixed by the MODEL's progress.
      const expected = 64 + (255 - 64) * (progress as number)
      const p = pixel(decodeFrameIndex(transitionOutput, frame), WIDTH >> 1, HEIGHT >> 1)
      near(p.r, expected, 8, `frame ${frame}: export level vs model progress ${progress}`)
      near(p.g, expected, 8, `frame ${frame}: the mix stays achromatic`)
      near(p.b, expected, 8, `frame ${frame}: the mix stays achromatic`)
    }
  })

  console.log(`\n=== All ${checks} render-parity checks passed ===`)
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
