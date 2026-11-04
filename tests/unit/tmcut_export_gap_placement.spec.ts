/**
 * The export paints a timeline, not a sequence (V4 Phase 2, slice #94).
 *
 * A row's clips carry an absolute `offset`, but the concat chain butted them
 * together, so a gap moved everything after it EARLIER than the preview shows
 * it — while the audio bus (`adelay`, audio.ts) and the drawtext windows stayed
 * at the authored time. Measured before this slice: a row of 2 s at 0 s plus 2 s
 * at 5 s compiled a 7 s timeline into a 4 s file whose picture was three seconds
 * early, its captions over the wrong footage.
 *
 * What is asserted, and how:
 *  1. a contiguous project is untouched — no pad filter is emitted at all, so
 *     every existing export keeps its exact command line.
 *  2. a gap becomes a leading pad of the authored canvas colour, and the audio
 *     lane of the same segment gets the matching silence (graph-level).
 *  3. a clip that starts late opens on the canvas, not on its footage.
 *  4. a crossfade pair is an overlap, never a gap: the xfade offset does not
 *     move (the pad walk and the fold share one window question).
 *  5. a gap shorter than one output frame is not painted and not padded.
 *  6. PIXELS: a real FFmpeg render of two authored plates proves WHERE each
 *     frame comes from — plate, canvas, plate — and the file is as long as the
 *     timeline claims. `evaluateTimeline` answers "is footage live at this
 *     tick?"; the rendered frame must agree, frame by frame.
 *  7. a source guard: the window law has one home, and the pad option is the
 *     one the bundled binary actually accepts.
 *
 * Skips when no FFmpeg binary is available.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_gap_placement.spec.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, compareFrames, evaluateTimeline } from 'tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ffmpegCandidates = [
  process.env.TOOLS_FFMPEG_PATH,
  path.join(repoRoot, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
]
const ffmpeg = ffmpegCandidates.find(candidate => candidate && fs.existsSync(candidate))

if (!ffmpeg) {
  console.log('SKIP  gap placement: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)')
  process.exit(0)
}

const W = 64
const H = 36
const FPS = 30
const BG: [number, number, number] = [16, 32, 48]
const PLATE_A: [number, number, number] = [30, 90, 200]
const PLATE_B: [number, number, number] = [210, 40, 40]
const hex = (c: [number, number, number]) => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('')
// The bundled ffmpeg cannot open files under the OS temp dir on Windows, and
// `.golden-render-*/` is the ignore pattern already in .gitignore.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-gap-'))
// Both exit paths below leave through `process.exit`, so the teardown rides on
// the process `exit` event rather than a finally block that would not run.
process.once('exit', () => {
  fs.rmSync(workDir, { recursive: true, force: true })
})

function runFfmpeg(args: string[]): void {
  const res = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffmpeg failed: ${res.stderr}`)
}

function probeDuration(file: string): number {
  const probe = path.join(repoRoot, 'resources', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  const res = spawnSync(probe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file
  ], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffprobe failed: ${res.stderr}`)
  return Number(res.stdout.trim())
}

/**
 * One authored plate: a solid colour, its own file, its own length — and a
 * silent stereo audio lane. The compiler emits `[i:a]atrim` for every footage
 * clip, so a plate without audio would make the whole graph fail to parse, and
 * the failure would look like a bug in the pad instead of a missing stream.
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

/** A solid expected frame, built from the authored colour — never from the render. */
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
  transitionIn?: { type: string, duration: number }
}

function projectOf(items: Item[]): TmcutProject {
  return {
    version: 1,
    name: 'gap placement',
    canvas: { width: W, height: H, fps: FPS, background: { type: 'color', value: hex(BG) } },
    timeline: {
      tracks: [
        { id: 'v1', type: 'video', name: 'Video', items },
        { id: 't1', type: 'text', name: 'Text', items: [] }
      ]
    }
  } as unknown as TmcutProject
}

const tk = (sec: number) => Math.round(sec * TICKS_PER_SECOND)
const clip = (id: string, src: string, offsetSec: number, spanSec: number): Item =>
  ({ id, src, offset: tk(offsetSec), in: 0, out: tk(spanSec) })

function filterComplexOf(compiled: { args: string[] }): string {
  const index = compiled.args.indexOf('-filter_complex')
  assert.ok(index >= 0, 'the compiled command has no filter graph')
  return compiled.args[index + 1]!
}

/** Every leading pad in the graph, as the seconds it paints and the colour it paints. */
function padsOf(graph: string): string[] {
  return [...graph.matchAll(/tpad=start_mode=add:start_duration=([\d.]+):color=([0-9a-fx]+)/g)]
    .map(m => `${m[1]}@${m[2]}`)
}

const starts: string[] = []
function check(label: string, fn: () => void): void {
  fn()
  starts.push(label)
  console.log(`   ${label} PASSED (${starts.length})`)
}

async function main(): void {
  console.log('=== [TMCut export gap placement] Starting ===\n')
  const plateA = plateFile('plate-a.mp4', PLATE_A, 2)
  const plateB = plateFile('plate-b.mp4', PLATE_B, 2)
  const srcs = [plateA, plateB]
  const bg = '0x102030'

  // 1. Contiguous stays byte-identical: nothing pads.
  check('a contiguous row emits no pad at all', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(
      projectOf([clip('a', srcs[0]!, 0, 2), clip('b', srcs[1]!, 2, 2)]), 'out.mp4'))
    assert.deepEqual(padsOf(graph), [], 'a gapless row must not gain a tpad')
    assert.ok(!/adelay/.test(graph), 'and no silence on its audio lanes')
  })

  // 2. A gap pads the footage AND delays the matching audio of the same segment.
  check('a gap pads the footage and its own audio lane', () => {
    const compiled = compileTimelineToFfmpeg(
      projectOf([clip('a', srcs[0]!, 0, 2), clip('b', srcs[1]!, 5, 2)]), 'out.mp4')
    const graph = filterComplexOf(compiled)
    assert.deepEqual(padsOf(graph), [`3.000@${bg}`], 'three canvas seconds between the plates')
    assert.ok(graph.includes('adelay=3000|3000'), 'the audio lane of that segment waits too')
    assert.equal(compiled.duration, 7, 'the timeline is 7 s and the chain is now 7 s')
    // The pad attaches to the CLIP stream, before the concat consumes it.
    assert.match(graph, /\[v_scaled_1\]tpad=start_mode=add[\s\S]{0,120}\[v_pad_1\]/)
    assert.match(graph, /\[v_scaled_0\]\[a_trim_0\]\[v_pad_1\]\[a_trim_1\]concat/)
  })

  // 3. A leading gap is a gap too: the file starts on the authored canvas.
  check('a clip that starts late opens on canvas, not on footage', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(
      projectOf([clip('b', srcs[1]!, 5, 2)]), 'out.mp4'))
    assert.deepEqual(padsOf(graph), [`5.000@${bg}`])
  })

  // 4. A crossfade overlaps — it must never read as a gap, and its offset must
  // not move: the pad walk asks the same window question as the fold.
  check('a crossfade pair pads nothing and keeps its xfade offset', () => {
    const withFade: Item[] = [clip('a', srcs[0]!, 0, 2), clip('b', srcs[1]!, 1.5, 2)]
    withFade[1]!.transitionIn = { type: 'fade', duration: tk(0.5) }
    const graph = filterComplexOf(compileTimelineToFfmpeg(projectOf(withFade), 'out.mp4'))
    assert.deepEqual(padsOf(graph), [], 'an overlap is not a gap')
    // The overlap starts where the first input ends: 2 s of plate A minus 0.5 s.
    assert.match(graph, /xfade=transition=fade:duration=0\.500:offset=1\.500/)
  })

  // 5. One frame is the smallest thing a file can paint.
  check('a sub-frame gap pads nothing', () => {
    const graph = filterComplexOf(compileTimelineToFfmpeg(
      projectOf([clip('a', srcs[0]!, 0, 2), clip('b', srcs[1]!, 2 + 1 / (FPS * 4), 2)]), 'out.mp4'))
    assert.deepEqual(padsOf(graph), [], 'a quarter frame cannot be painted, so it is not padded')
  })

  // 6. PIXELS: the rendered file agrees with core, frame by frame, and is as
  // long as the timeline claims.
  check('the rendered file paints canvas exactly where core has no footage', () => {
    const project = projectOf([clip('a', srcs[0]!, 0, 2), clip('b', srcs[1]!, 5, 2)])
    const output = path.join(workDir, 'gapped.mp4').replace(/\\/g, '/')
    runFfmpeg(compileTimelineToFfmpeg(project, output).args)
    const frames = decodeAllFrames(output)
    const total = frameCount(frames)
    const duration = probeDuration(output)
    assert.ok(Math.abs(duration - 7) < 0.06, `a 7 s timeline rendered ${duration.toFixed(3)} s`)
    assert.ok(Math.abs(total / FPS - 7) < 0.06, `${total} frames is not 7 s at ${FPS} fps`)

    const budget = { meanTolerance: 3, channelTolerance: 6, diffRatioTolerance: 0.02 }
    const expect = {
      a: solidFrame(PLATE_A), canvas: solidFrame(BG), b: solidFrame(PLATE_B)
    }
    let painted = 0
    let canvassed = 0
    for (let frame = 0; frame < total; frame++) {
      const at = frame / FPS
      const live = (evaluateTimeline(project, tk(at)).tracks.find(t => t.id === 'v1')?.layers ?? []).length > 0
      const actual = new Uint8Array(W * H * 4)
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const from = frame * W * H * 4 + (y * W + x) * 4
          const to = (y * W + x) * 4
          actual[to] = frames[from]!
          actual[to + 1] = frames[from + 1]!
          actual[to + 2] = frames[from + 2]!
          actual[to + 3] = 255
        }
      }
      const wanted = live ? (at < 2 ? expect.a : expect.b) : expect.canvas
      const result = compareFrames(wanted, actual, budget)
      assert.ok(
        result.ok,
        `frame ${frame} (${at.toFixed(3)} s, footage ${live ? 'live' : 'absent'}) drifted: `
        + `mean ${result.meanAbsError.toFixed(2)} diffRatio ${result.diffRatio.toFixed(4)} `
        + `pixel0 ${JSON.stringify(pixelAt(frames, frame, 0, 0))}`
      )
      if (live) painted++
      else canvassed++
    }
    assert.equal(painted, 120, 'four authored seconds of plate at 30 fps')
    assert.equal(canvassed, 90, 'three gap seconds painted as the authored canvas')
  })

  // 7. The law has one home, and the option name is the one this binary has.
  check('the window question is asked once, and both branches pay for pads', () => {
    const src = fs.readFileSync(path.join(repoRoot, 'app', 'utils', 'tmcut', 'render', 'video.ts'), 'utf8')
    const finds = src.match(/fromId ===/g) ?? []
    assert.equal(finds.length, 1, `the overlap law must live in ONE helper, found ${finds.length}`)
    // One declaration plus the two readers — the pad walk and the xfade fold —
    // so neither can re-decide on its own which cut has a window.
    const calls = src.match(/overlapSec\(/g) ?? []
    assert.equal(calls.length, 3, `expected one helper and two callers, found ${calls.length}`)
    assert.match(src, /function leadingPads\(/, 'the pad walk is its own function')
    assert.match(src, /const pads = leadingPads\(videoClips, ctx\)/)
    assert.match(src, /runningDuration \+= pads\[i\]/, 'the fold advances by the pad it just emitted')
    assert.match(src, /runningDuration = renderClipDuration\(videoClips\[0\]!\) \+ \(pads\[0\]/)
    // Measured against resources/ffmpeg.exe: `start_color` is not an option of
    // its tpad ("Option not found"), so a pad written with it never renders.
    assert.ok(!/start_color/.test(src), 'the bundled tpad only knows :color=')
  })

  console.log(`\n=== All ${starts.length} gap placement checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
