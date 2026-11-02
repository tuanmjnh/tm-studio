/**
 * Text pixel gate (V4 M2 step 7, G7). The export specs prove what the filter
 * string SAYS; this one proves what the rendered frames DO, because a
 * `drawtext` chain can be perfectly written and still paint nothing — a font
 * the bundled FFmpeg cannot open, or a base canvas shorter than the caption
 * window. Both of those were live here when this gate was written, and each
 * check below is the measurement that caught one.
 *
 * Subjects, all read off decoded RGBA pixels of a real
 * `compileTimelineToFfmpeg` render:
 *  1. a pinned TrueType face paints ink on the canvas.
 *  2. a caption that starts after t=0 survives the export (the text track
 *     counts toward the timeline duration, as the store's contentDuration does).
 *  3. the ink lives only inside the half-open `[start, end)` window — ADR-018
 *     from the pixel side (tmcut_render_parity.spec.ts owns the arg-string and
 *     evaluator side; this check fails on its own if the rule is right in text
 *     but ignored on screen).
 *  4. a caption outliving the last frame of footage paints on a canvas-colour
 *     tail, the way the preview shows it.
 *  5. a bigger fontsize paints a strictly taller ink box.
 *  6. align moves the ink box (left < centre < right).
 *  7. the compiler is deterministic: the same project compiles to the same
 *     command and renders to the same pixels within the golden error budget.
 *  8. the app's own Inter face ships as WOFF2 and `drawtext fontfile=` cannot
 *     open it — the constraint that pins G7.
 *
 * A font-pinned PIXEL golden (a checked-in PNG) is still not shipped: it needs
 * a TTF/OTF in the repo, and every face readable on this host is Microsoft
 * licensed, so vendoring one is the owner's call. This gate is the portable
 * part — it compares frames against each other, never against a baseline PNG,
 * so any host with a system TTF gives the same verdict.
 *
 * Skips when no FFmpeg binary or no system TrueType font is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, compareFrames } from 'tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ffmpegCandidates = [
  process.env.TOOLS_FFMPEG_PATH,
  path.join(repoRoot, 'resources', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
]
const ffmpeg = ffmpegCandidates.find(candidate => candidate && fs.existsSync(candidate))

// A face FFmpeg's FreeType can open. Every entry is a system font, never a
// repo file — this gate measures geometry, not letterforms.
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arial.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/Library/Fonts/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf'
]
const fontFile = FONT_CANDIDATES.find(candidate => fs.existsSync(candidate))

if (!ffmpeg) {
  console.log('SKIP  text pixels: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)')
  process.exit(0)
}
if (!fontFile) {
  console.log('SKIP  text pixels: no system TrueType font (drawtext needs a face the repo does not ship)')
  process.exit(0)
}

const WIDTH = 320
const HEIGHT = 120
const FPS = 30
const FRAME_BYTES = WIDTH * HEIGHT * 4
const BG = { r: 0x10, g: 0x10, b: 0x18 }
const BG_BLACK = { r: 0, g: 0, b: 0 }
// One glyph of a 24pt face on a 320x120 canvas covers far more than this, and
// the backdrop is a solid colour, so the count reads the painted box directly.
const INK_MIN = 40
const INK_DISTANCE = 24
// The bundled ffmpeg cannot write under the OS temp dir on Windows; this dir
// prefix is gitignored, and the finally block removes it even on a crash.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-text-'))
const blackSource = path.join(workDir, 'black.mp4').replace(/\\/g, '/')
let checks = 0

function check(name: string, fn: () => void): void {
  fn()
  checks += 1
  console.log(`[ok] ${name}`)
}

function runFfmpeg(args: string[]): { status: number, stderr: string } {
  const res = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  return { status: res.status ?? -1, stderr: res.stderr ?? '' }
}

/** Fontconfig prints "Cannot load default config file" on a bare host; noise, not a failure. */
function ffmpegError(args: string[]): void {
  const res = runFfmpeg(args)
  assert.equal(
    res.status,
    0,
    `ffmpeg failed (${res.status}): ${res.stderr.split('\n').filter(line => line && !line.includes('ontconfig')).join(' | ')}`
  )
}

function ticks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND)
}

function textItem(overrides: Record<string, unknown>): Record<string, unknown> {
  return { id: 'text-1', trackId: 't1', text: 'Abc 0123', offset: 0, in: 0, out: ticks(1), fontSize: 24, color: 'white', fontFile, ...overrides }
}

/**
 * `footageTicks` puts a black clip of that length on the video track, so the
 * backdrop is a uniform black to measure ink against. Without it the project is
 * text-only, which is what the duration checks are about.
 */
function textProject(name: string, item: Record<string, unknown>, footageTicks: number | null): TmcutProject {
  return {
    version: 1,
    name,
    canvas: { width: WIDTH, height: HEIGHT, fps: FPS, background: { type: 'color', value: '#101018' } },
    timeline: {
      tracks: [
        {
          id: 'v1',
          type: 'video',
          name: 'Video',
          items: footageTicks === null
            ? []
            : [{ id: 'bg-1', trackId: 'v1', src: blackSource, in: 0, out: footageTicks, offset: 0, speed: 1, opacity: 100, scale: 100, x: 0, y: 0, rotation: 0, fit: 'fit' }]
        },
        { id: 't1', type: 'text', name: 'Text', items: [item] }
      ]
    }
  } as unknown as TmcutProject
}

function render(project: TmcutProject, fileName: string): { output: string, args: string[] } {
  const output = path.join(workDir, fileName).replace(/\\/g, '/')
  const compiled = compileTimelineToFfmpeg(project, output)
  ffmpegError(compiled.args)
  return { output, args: compiled.args }
}

// One rawvideo dump per rendered file, then indexed by frame: a `select` per
// probe decode re-opens the encoder each time and is the slower, flakier path.
const dumps = new Map<string, Uint8Array>()

function framesOf(file: string): { bytes: Uint8Array, count: number } {
  const cached = dumps.get(file)
  if (cached) return { bytes: cached, count: cached.length / FRAME_BYTES }
  const target = path.join(workDir, `dump-${dumps.size}.rgba`)
  ffmpegError(['-i', file, '-map', '0:v', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', target])
  const bytes = new Uint8Array(fs.readFileSync(target))
  fs.unlinkSync(target)
  assert.equal(bytes.length % FRAME_BYTES, 0, `${file} decodes to whole ${WIDTH}x${HEIGHT} RGBA frames`)
  dumps.set(file, bytes)
  return { bytes, count: bytes.length / FRAME_BYTES }
}

function frameAt(file: string, index: number): Uint8Array {
  const { bytes, count } = framesOf(file)
  assert.ok(index < count, `frame ${index} of ${file}: the export holds ${count} frames (${(count / FPS).toFixed(3)}s)`)
  return bytes.subarray(index * FRAME_BYTES, (index + 1) * FRAME_BYTES)
}

function rgbAt(frame: Uint8Array, x: number, y: number): { r: number, g: number, b: number } {
  const at = (y * WIDTH + x) * 4
  return { r: frame[at]!, g: frame[at + 1]!, b: frame[at + 2]! }
}

interface InkBox { pixels: number, left: number, right: number, top: number, bottom: number, height: number }

function inkBox(frame: Uint8Array, backdrop: { r: number, g: number, b: number }): InkBox {
  let pixels = 0
  let left = WIDTH
  let right = -1
  let top = HEIGHT
  let bottom = -1
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const colour = rgbAt(frame, x, y)
      const distance = Math.max(
        Math.abs(colour.r - backdrop.r),
        Math.abs(colour.g - backdrop.g),
        Math.abs(colour.b - backdrop.b)
      )
      if (distance <= INK_DISTANCE) continue
      pixels += 1
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
      if (y > bottom) bottom = y
    }
  }
  return { pixels, left, right, top, bottom, height: bottom < top ? 0 : bottom - top + 1 }
}

function describe(box: InkBox): string {
  return `ink ${box.pixels}px x[${box.left}..${box.right}] y[${box.top}..${box.bottom}]`
}

try {
  runFfmpeg([
    '-f', 'lavfi', '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=3`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', blackSource
  ])

  check('a pinned TrueType face paints the caption', () => {
    const { output } = render(textProject('Ink', textItem({}), null), 'ink.mp4')
    const box = inkBox(frameAt(output, 0), BG)
    assert.ok(box.pixels >= INK_MIN, `expected ink on frame 0, got ${describe(box)}`)
  })

  check('a caption that starts after t=0 survives the export', () => {
    const late = textProject('Late', textItem({ offset: ticks(1) }), null)
    const compiled = compileTimelineToFfmpeg(late, path.join(workDir, 'late.mp4').replace(/\\/g, '/'))
    const filterComplex = compiled.args[compiled.args.indexOf('-filter_complex') + 1]!
    assert.ok(
      filterComplex.includes('d=2.000[v_base]'),
      `the base canvas must run to the end of the last caption, got ${filterComplex}`
    )
    assert.equal(compiled.duration, 2, 'a text-only timeline is as long as its last caption')

    const { output } = render(late, 'late.mp4')
    const box = inkBox(frameAt(output, 30), BG)
    assert.ok(box.pixels >= INK_MIN, `frame 30 (1.000s) carries the caption, got ${describe(box)}`)
  })

  check('the ink lives only inside the half-open window', () => {
    const { output } = render(textProject('Window', textItem({ offset: ticks(1), out: ticks(1) }), ticks(3)), 'window.mp4')
    const before = inkBox(frameAt(output, 29), BG_BLACK)
    assert.ok(before.pixels < INK_MIN, `frame 29 (0.967s) is one frame before the window, got ${describe(before)}`)
    const opened = inkBox(frameAt(output, 30), BG_BLACK)
    assert.ok(opened.pixels >= INK_MIN, `frame 30 (1.000s) opens the window, got ${describe(opened)}`)
    const last = inkBox(frameAt(output, 59), BG_BLACK)
    assert.ok(last.pixels >= INK_MIN, `frame 59 (1.967s) is still inside, got ${describe(last)}`)
    const after = inkBox(frameAt(output, 60), BG_BLACK)
    assert.ok(after.pixels < INK_MIN, `frame 60 (2.000s) is the window END, got ${describe(after)}`)
  })

  check('a caption outliving the footage paints on the canvas tail', () => {
    // 1s of black footage, a caption that runs to 2s. The preview answers that
    // with the canvas background plus the caption, so the export must not stop
    // with the footage.
    const { output } = render(textProject('Tail', textItem({ out: ticks(2) }), ticks(1)), 'tail.mp4')
    assert.equal(framesOf(output).count, 60, 'the export holds the whole timeline, not just the footage')
    const box = inkBox(frameAt(output, 45), BG)
    assert.ok(box.pixels >= INK_MIN, `frame 45 (1.500s, past the footage) carries the caption, got ${describe(box)}`)
    for (const [x, y] of [[2, 2], [WIDTH - 3, 2], [2, HEIGHT - 3]] as const) {
      const corner = rgbAt(frameAt(output, 45), x, y)
      assert.ok(
        Math.max(Math.abs(corner.r - BG.r), Math.abs(corner.g - BG.g), Math.abs(corner.b - BG.b)) <= 8,
        `the tail must be the authored canvas colour ${JSON.stringify(BG)}, got ${JSON.stringify(corner)} at ${x},${y}`
      )
    }
  })

  check('a bigger fontsize paints a taller ink box', () => {
    const small = inkBox(frameAt(render(textProject('Small', textItem({ fontSize: 24 }), null), 'small.mp4').output, 0), BG)
    const large = inkBox(frameAt(render(textProject('Large', textItem({ fontSize: 48 }), null), 'large.mp4').output, 0), BG)
    assert.ok(small.pixels >= INK_MIN && large.pixels >= INK_MIN, `both sizes paint: ${describe(small)} vs ${describe(large)}`)
    assert.ok(
      large.height > Math.floor(small.height * 1.5),
      `doubling the font must nearly double the box: 24pt ${describe(small)} -> 48pt ${describe(large)}`
    )
  })

  check('align moves the ink box', () => {
    const boxFor = (align: 'left' | 'center' | 'right') => inkBox(
      frameAt(render(textProject(`Align ${align}`, textItem({ align }), null), `align-${align}.mp4`).output, 0),
      BG
    )
    const left = boxFor('left')
    const center = boxFor('center')
    const right = boxFor('right')
    assert.ok(left.pixels >= INK_MIN && center.pixels >= INK_MIN && right.pixels >= INK_MIN, 'all three aligns paint')
    assert.ok(left.left <= 4, `align left starts at the edge, got ${describe(left)}`)
    assert.ok(center.left > left.left, `center starts right of left: ${center.left} vs ${left.left}`)
    assert.ok(right.left > center.left, `right starts right of center: ${right.left} vs ${center.left}`)
    assert.ok(right.right >= WIDTH - 5, `align right reaches the far edge, got ${describe(right)}`)
  })

  check('the compiler is deterministic across runs', () => {
    const project = textProject('Determinism', textItem({ fontSize: 32 }), null)
    const first = render(project, 'first.mp4')
    const second = render(project, 'second.mp4')
    assert.deepEqual(second.args.slice(0, -1), first.args.slice(0, -1), 'the same project compiles to the same command, output path aside')
    const result = compareFrames(frameAt(first.output, 0), frameAt(second.output, 0), {
      meanTolerance: 2,
      channelTolerance: 3,
      diffRatioTolerance: 0.002
    })
    assert.ok(
      result.ok,
      `two renders of one project drifted: mean ${result.meanAbsError.toFixed(3)}, diffRatio ${result.diffRatio.toFixed(5)}`
    )
  })

  check('the app ships Inter as WOFF2 and drawtext cannot open it', () => {
    const requireFromRepo = createRequire(path.join(repoRoot, 'tests/unit/probe.ts'))
    let woff2: string
    try {
      woff2 = requireFromRepo.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
    } catch {
      console.log('[skip] the WOFF2 check — @fontsource-variable/inter is not installed')
      return
    }
    const output = path.join(workDir, 'woff2.mp4').replace(/\\/g, '/')
    const args = compileTimelineToFfmpeg(textProject('WOFF2', textItem({ fontFile: woff2 }), null), output).args
    const res = runFfmpeg(args)
    assert.notEqual(
      res.status,
      0,
      'drawtext fontfile= opened a WOFF2 — the bundled FFmpeg gained a woff2 backend, so the '
      + 'preview face can be the export face and the G7 decision needs re-opening'
    )
    assert.match(
      res.stderr,
      /drawtext|fontconfig/i,
      `expected a font-loading failure, got: ${res.stderr.slice(0, 200)}`
    )
  })

  console.log(`\n=== All ${checks} text-pixel checks passed ===`)
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
