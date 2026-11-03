/**
 * Golden-frame gate (V4 M2, roadmap Phase 2 item 6): compile a tiny project,
 * render it with the real FFmpeg compiler, decode one frame and compare it to
 * an expected frame by error budget (ADR-016), never by hash.
 *
 * Four checks. The canvas golden is a solid colour, checked in as a PNG. Then
 * one authored picture — a flat plate with one inset rectangle — is written
 * twice, as bytes for the image decoder and as geometry for the vector
 * decoder, and each file is checked to decode to the expected frame byte for
 * byte before anything is rendered. The rendered legs then compare each still
 * mp4 with that same frame, and with each other, with the pixels around every
 * edge masked out (see `edgeBand`) because 4:2:0 colour really does bleed.
 * Nothing in these goldens comes from the renderer being tested.
 * Text still needs a host font, so a font-pinned text golden belongs to a
 * later slice (ADR-025). Skips when no FFmpeg binary is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
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

if (!ffmpeg) {
  console.log('SKIP  golden frame: no FFmpeg binary (set TOOLS_FFMPEG_PATH to enable)')
  process.exit(0)
}

const WIDTH = 64
const HEIGHT = 36
const GOLDEN = path.join(repoRoot, 'tests', 'fixtures', 'golden', 'canvas-123456-64x36.png')
// The bundled ffmpeg cannot open files under the OS temp dir on Windows
// (permission denied), so the work dir lives in the repo and is gitignored.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-'))
let decoded = 0

function runFfmpeg(args: string[]): void {
  const res = spawnSync(ffmpeg!, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffmpeg failed: ${res.stderr}`)
}

function decodeFrame(file: string, inputArgs: string[] = []): Uint8Array {
  const target = path.join(workDir, `frame-${++decoded}.rgba`)
  runFfmpeg([...inputArgs, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-y', target])
  return new Uint8Array(fs.readFileSync(target))
}

// ---------------------------------------------------------------------------
// The two still legs share one picture, authored twice instead of rendered once
// and trusted: a flat plate with one inset rectangle, written as bytes for the
// image decoder and as geometry for the vector decoder. `expectedFrame()` is
// that picture computed from the same numbers, so nothing the golden asserts
// comes from the renderer under test.
// ---------------------------------------------------------------------------
const PLATE: readonly [number, number, number] = [32, 64, 128]
const INSET: readonly [number, number, number] = [224, 208, 64]
const INSET_X = 8
const INSET_Y = 6
const INSET_RIGHT = 56
const INSET_BOTTOM = 30

function isInset(x: number, y: number): boolean {
  return x >= INSET_X && x < INSET_RIGHT && y >= INSET_Y && y < INSET_BOTTOM
}

function hex(color: readonly [number, number, number]): string {
  return color.map(value => value.toString(16).padStart(2, '0')).join('')
}

function expectedFrame(): Uint8Array {
  const bytes = new Uint8Array(WIDTH * HEIGHT * 4)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = isInset(x, y) ? INSET : PLATE
      const index = (y * WIDTH + x) * 4
      bytes[index] = r
      bytes[index + 1] = g
      bytes[index + 2] = b
      bytes[index + 3] = 255
    }
  }
  return bytes
}

/**
 * One byte per pixel, 0 = not asserted. An mp4 is 4:2:0, so a lossy encode
 * blurs a real band around every region edge and that band has to be excluded
 * rather than the whole frame being tolerated. Widening the tolerance instead
 * would also cover a rectangle drawn one pixel off — the exact bug the golden
 * is for — so each leg keeps its colour budget tight and drops only the pixels
 * the encoder cannot place. How wide the drop is belongs to the caller: the
 * narrower the band, the more of the frame is asserted.
 */
function edgeBand(band: number): Uint8Array {
  const mask = new Uint8Array(WIDTH * HEIGHT)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const nearEdge = Math.abs(x - INSET_X) <= band || Math.abs(x - INSET_RIGHT) <= band
        || Math.abs(y - INSET_Y) <= band || Math.abs(y - INSET_BOTTOM) <= band
        || x <= band || y <= band || x >= WIDTH - 1 - band || y >= HEIGHT - 1 - band
      mask[y * WIDTH + x] = nearEdge ? 0 : 1
    }
  }
  return mask
}

/** A 24-bit uncompressed BMP, painted with the same rule `isInset` uses. */
function writeBmp(file: string): void {
  const rowBytes = WIDTH * 3 // 192 — a multiple of 4, so rows need no padding
  const buffer = Buffer.alloc(54 + rowBytes * HEIGHT)
  const header = buffer.subarray(0, 54)
  header.write('BM', 0)
  header.writeUInt32LE(buffer.length, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14) // BITMAPINFOHEADER
  header.writeInt32LE(WIDTH, 18)
  header.writeInt32LE(HEIGHT, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(rowBytes * HEIGHT, 34)
  header.writeInt32LE(2835, 38)
  header.writeInt32LE(2835, 42)
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = isInset(x, y) ? INSET : PLATE
      // Bottom-up rows in BGR order: file row 0 is the last line.
      const offset = 54 + (HEIGHT - 1 - y) * rowBytes + x * 3
      buffer[offset] = b
      buffer[offset + 1] = g
      buffer[offset + 2] = r
    }
  }
  fs.writeFileSync(file, buffer)
}

const SVG_STILL = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="36" viewBox="0 0 64 36">'
  + `<rect width="64" height="36" fill="#${hex(PLATE)}"/>`
  + `<rect x="${INSET_X}" y="${INSET_Y}" width="${INSET_RIGHT - INSET_X}" height="${INSET_BOTTOM - INSET_Y}" fill="#${hex(INSET)}"/></svg>\n`

function stillProject(src: string): TmcutProject {
  return {
    ...project,
    name: `Golden still ${path.basename(src)}`,
    timeline: {
      ...project.timeline,
      tracks: [
        {
          id: 'v1',
          type: 'video',
          name: 'Video',
          items: [{
            id: 's1',
            src,
            offset: 0,
            in: 0,
            out: 1 * TICKS_PER_SECOND,
            speed: 1
          }]
        },
        { id: 't1', type: 'text', name: 'Text', items: [] }
      ]
    }
  } as unknown as TmcutProject
}

function renderStill(src: string): Uint8Array {
  const output = path.join(workDir, `still-${path.basename(src)}.mp4`).replace(/\\/g, '/')
  const compiled = compileTimelineToFfmpeg(stillProject(src), output)
  runFfmpeg(compiled.args)
  return decodeFrame(output)
}

const project: TmcutProject = {
  version: 1,
  name: 'Golden canvas',
  canvas: { width: WIDTH, height: HEIGHT, fps: 30, background: { type: 'color', value: '#123456' } },
  timeline: {
    tracks: [
      { id: 'v1', type: 'video', name: 'Video', items: [] },
      { id: 't1', type: 'text', name: 'Text', items: [] }
    ]
  }
}

try {
  assert.ok(fs.existsSync(GOLDEN), `missing golden fixture: ${GOLDEN}`)

  const output = path.join(workDir, 'render.mp4').replace(/\\/g, '/')
  const compiled = compileTimelineToFfmpeg(project, output)
  runFfmpeg(compiled.args)

  const expected = decodeFrame(GOLDEN)
  const actual = decodeFrame(output)
  assert.equal(expected.length, WIDTH * HEIGHT * 4, 'golden dimensions')
  assert.equal(actual.length, expected.length, 'rendered frame dimensions')

  const result = compareFrames(expected, actual, {
    meanTolerance: 2,
    channelTolerance: 3,
    diffRatioTolerance: 0.002
  })
  assert.ok(
    result.ok,
    `golden frame drifted: mean ${result.meanAbsError.toFixed(3)} (max ${result.meanTolerance}), `
    + `diffRatio ${result.diffRatio.toFixed(5)} (max ${result.diffRatioTolerance})`
  )

  console.log(`=== golden frame PASSED — mean ${result.meanAbsError.toFixed(3)}, ${result.differingPixels}/${result.totalPixels} pixels differ ===`)

  // Legs 2 and 3: the same authored picture arriving through the two still
  // decoders, then compared with each other. Budgets are per CHANNEL and per
  // MEAN over the pixels the mask leaves in, so an out-of-band interior pixel
  // or a shifted edge fails even though the edge band itself is not asserted.
  // Every number below is a measurement plus headroom under 2x (worst mean
  // 2.08, worst channel 15, no pixel over budget). Widening one later means
  // re-measuring, not raising a ceiling that hides the drift.
  //
  // The two decoders get a zero-width band — every pixel except the rectangle's
  // own edge column/row and the canvas border is asserted, so a picture drawn
  // one pixel off fails. The cross-decoder leg gets the extra pixel: librsvg
  // and the BMP decoder land the same hard edge on neighbouring pixels after
  // the 4:2:0 round trip, and that leg was measured to fail band 0 with 47
  // pixels over budget and a worst channel of 24.
  const authored = expectedFrame()
  const renderMask = edgeBand(0)
  const crossMask = edgeBand(1)
  const budget = { meanTolerance: 4, channelTolerance: 20, diffRatioTolerance: 0.005 }

  const bmpPath = path.join(workDir, 'plate.bmp').replace(/\\/g, '/')
  writeBmp(bmpPath)
  const svgPath = path.join(workDir, 'plate.svg').replace(/\\/g, '/')
  fs.writeFileSync(svgPath, SVG_STILL, 'utf8')

  // Before the render is judged, the authored files themselves are checked:
  // each still, decoded straight by FFmpeg, must equal the expected frame
  // byte for byte. That leg is what makes the two render legs a test of the
  // pipeline rather than of this file's own authoring — a swapped channel, a
  // row offset or a rectangle written one pixel off fails here with zero
  // tolerance instead of showing up later as unexplained drift in the mp4.
  for (const [label, src] of [['raster', bmpPath], ['vector', svgPath]] as const) {
    const exact = compareFrames(authored, decodeFrame(src), {
      meanTolerance: 0,
      channelTolerance: 0,
      diffRatioTolerance: 0
    })
    assert.ok(
      exact.ok,
      `${label} still source does not decode to the authored picture: `
      + `mean ${exact.meanAbsError.toFixed(3)}, worst channel ${exact.maxChannelDelta}, `
      + `${exact.differingPixels}/${exact.totalPixels} pixels differ`
    )
    console.log(`=== ${label} still decoded exact (${exact.totalPixels} pixels, all equal) ===`)
  }

  const rasterFrame = renderStill(bmpPath)
  const vectorFrame = renderStill(svgPath)

  const legs: [string, ReturnType<typeof compareFrames>][] = [
    ['raster still', compareFrames(authored, rasterFrame, { ...budget, mask: renderMask })],
    ['vector still', compareFrames(authored, vectorFrame, { ...budget, mask: renderMask })],
    ['the two still legs agree', compareFrames(rasterFrame, vectorFrame, { ...budget, mask: crossMask })]
  ]
  for (const [label, outcome] of legs) {
    assert.ok(
      outcome.ok,
      `${label} golden drifted: mean ${outcome.meanAbsError.toFixed(3)} (max ${budget.meanTolerance}), `
      + `worst channel ${outcome.maxChannelDelta} (budget ${budget.channelTolerance}), `
      + `diffRatio ${outcome.diffRatio.toFixed(5)} (max ${budget.diffRatioTolerance}) `
      + `over ${outcome.assertedPixels} asserted pixels`
    )
    console.log(`=== ${label} PASSED — mean ${outcome.meanAbsError.toFixed(3)}, worst channel ${outcome.maxChannelDelta}, `
      + `${outcome.differingPixels}/${outcome.assertedPixels} differ, ${outcome.skippedPixels} masked ===`)
  }
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
