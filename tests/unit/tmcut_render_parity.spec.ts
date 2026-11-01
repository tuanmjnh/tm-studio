/**
 * Render parity gate (V4 M2): the compiled FFmpeg export must place and
 * colour a clip where `evaluateTimeline` says it is. The evaluator is the
 * shared answer both renderers consume (Phase 1), so this spec renders a
 * tiny project with the real compiler + bundled FFmpeg and samples pixels
 * against geometry DERIVED FROM THE EVALUATOR — not from the compiler's own
 * transform helper, which would make the check circular.
 *
 * Two subjects, both font-free:
 *  1. transform clip (scale 50, x 6, y -4, opacity 60) — pixel rect + alpha.
 *  2. speed-2 clip over a red→green source — timeline tick → source tick.
 *
 * Skips when no FFmpeg binary is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, evaluateTimeline } from '@tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
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

function decodeFrame(file: string, atSec: number): Uint8Array {
  const target = path.join(workDir, `frame-${++decoded}.rgba`)
  runFfmpeg(['-ss', atSec.toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', target])
  const bytes = new Uint8Array(fs.readFileSync(target))
  assert.equal(bytes.length, WIDTH * HEIGHT * 4, 'decoded frame is one canvas RGBA frame')
  return bytes
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

  console.log(`\n=== All ${checks} render-parity checks passed ===`)
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
