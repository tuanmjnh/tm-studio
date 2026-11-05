/**
 * V4 Phase 2 item (4), vector leg: a `.svg` on the timeline is a still, and
 * the file gets the same picture the canvas showed.
 *
 * Three things had to be true for that sentence, and each is measured here
 * against the bundled binary rather than assumed:
 *  1. the vector decodes at all (the build is `--enable-librsvg`);
 *  2. it loops like any other still — unlooped, a 2-second window over a still
 *     yields ONE frame, so the clip would export as a snapshot and ffmpeg
 *     would never complain;
 *  3. it is rasterised into the box it is drawn in — librsvg's own default is
 *     the file's width/height, or 100x100 when the file only carries a
 *     viewBox, which the fit filters then stretch across the canvas.
 *
 * The raster box is sent ONLY for a vector still. That is not tidiness: hand
 * `-width` to a PNG input and the export dies before the graph is built
 * ("Codec AVOption width ... has not been used for any stream"), so checks 1
 * and 2 together are what keep a mixed project alive.
 *
 * Skips when no FFmpeg binary is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, classifyAssetKind } from 'tmcut-core'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import { uploadKindForName, uploadsContentTypeForName, uploadsSecurityHeaders } from '../../server/utils/uploads'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FFMPEG = path.join(repoRoot, 'resources', 'ffmpeg.exe')
const FFPROBE = path.join(repoRoot, 'resources', 'ffprobe.exe')
if (!fs.existsSync(FFMPEG) || !fs.existsSync(FFPROBE)) {
  console.log('SKIP  svg still: no FFmpeg binary in resources/')
  process.exit(0)
}
// Inside the repo and git-ignored: this machine's binary cannot open an output
// file under %TEMP% (measured: "Permission denied", exit -13).
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-svg-'))

function tk(sec: number): number {
  return Math.round(sec * TICKS_PER_SECOND)
}

let passed = 0
function check(label: string, fn: () => void): void {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function runFFmpeg(args: string[]): { code: number, stderr: string } {
  const res = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return { code: res.status ?? -1, stderr: String(res.stderr ?? '') + String(res.stdout ?? '') }
}

/** A red plate with a white circle dead centre: one pixel says "it drew". */
const SVG_BODY = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">'
  + '<rect width="320" height="180" fill="#cc2222"/>'
  + '<circle cx="160" cy="90" r="40" fill="#ffffff"/></svg>\n'

function projectFor(src: string, canvasW: number, canvasH: number): TmcutProject {
  return {
    name: 'SVG Still',
    canvas: {
      width: canvasW,
      height: canvasH,
      fps: { numerator: 30, denominator: 1 },
      background: { type: 'color', value: '#000000' }
    },
    timeline: {
      version: 1,
      tracks: [
        {
          id: 'v1',
          type: 'video',
          name: 'Video',
          items: [{ id: 's1', src, offset: 0, in: 0, out: tk(2), speed: 1 }]
        },
        { id: 't1', type: 'text', name: 'Text', items: [] },
        { id: 'a1', type: 'audio', name: 'Audio', items: [] }
      ],
      durationMs: 2000,
      markers: []
    },
    settings: { resolution: `${canvasW}x${canvasH}`, fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
    source: 'manual',
    created_at: '',
    updated_at: ''
  } as unknown as TmcutProject
}

/**
 * The flags FFmpeg emits before this input's `-i`. `buildInputArgs` lays the
 * argv out as `flags -i file flags -i file ...`, so everything accumulated
 * since the previous `-i file` pair belongs to the next input.
 */
function inputFlagsFor(args: string[], file: string): string[] {
  const flags: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i') {
      if (args[i + 1] === file) return flags
      i += 1
      flags.length = 0
      continue
    }
    flags.push(args[i]!)
  }
  throw new Error(`${file} is not an input of the compiled command`)
}

function probeNumber(file: string, entries: string): number {
  const res = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', entries, '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffprobe failed on ${file}: ${res.stderr}`)
  return Number.parseFloat(String(res.stdout).trim())
}

function probeFrameCount(file: string): number {
  const res = spawnSync(FFPROBE, [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'default=noprint_wrappers=1:nokey=1', file
  ], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffprobe failed on ${file}: ${res.stderr}`)
  return Number.parseInt(String(res.stdout).trim(), 10)
}

/**
 * The FIRST frame of a rendered file, decoded whole to RGB24.
 * Cropping a single pixel is not an option: `crop=1:1:x:y` leaves a 1x1 frame
 * that the encoder rejects before it writes anything, so the whole frame is
 * decoded and the pixel is indexed from it.
 */
function firstFrame(file: string): { width: number, height: number, bytes: Uint8Array } {
  const raw = path.join(workDir, 'frame.rgb')
  const res = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
    '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw
  ], { encoding: 'utf8' })
  assert.equal(res.status, 0, `could not decode a frame from ${file}: ${res.stderr}`)
  const width = Math.round(probeNumber(file, 'stream=width'))
  const height = Math.round(probeNumber(file, 'stream=height'))
  const bytes = new Uint8Array(fs.readFileSync(raw))
  assert.equal(bytes.length, width * height * 3, 'the decode is not one whole RGB frame')
  return { width, height, bytes }
}

function pixelAt(frame: { width: number, height: number, bytes: Uint8Array }, x: number, y: number): number[] {
  const offset = (y * frame.width + x) * 3
  return [frame.bytes[offset]!, frame.bytes[offset + 1]!, frame.bytes[offset + 2]!]
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r},${g},${b})`
}

async function main() {
  try {
    await runChecks()
    console.log(`\n=== All ${passed} svg-still checks passed ===`)
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

async function runChecks(): Promise<void> {
  const svgPath = path.join(workDir, 'mark.svg').replace(/\\/g, '/')
  fs.writeFileSync(path.join(workDir, 'mark.svg'), SVG_BODY, 'utf8')
  const pngPath = path.join(workDir, 'plate.png').replace(/\\/g, '/')
  const plate = runFFmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=0xcc2222:s=320x180:r=30', '-frames:v', '1', pngPath])
  assert.equal(plate.code, 0, `could not make the raster plate: ${plate.stderr}`)

  check('core and the server both call a .svg a still', () => {
    assert.equal(classifyAssetKind(svgPath), 'image')
    assert.equal(uploadKindForName('mark.svg'), 'image')
    assert.equal(uploadsContentTypeForName('mark.svg'), 'image/svg+xml')
  })

  check('the vector input is looped, bounded and given the canvas box', () => {
    const compiled = compileTimelineToFfmpeg(projectFor(svgPath, 320, 180), path.join(workDir, 'a.mp4'))
    assert.deepEqual(inputFlagsFor(compiled.args, svgPath), [
      '-framerate', '30', '-loop', '1', '-width', '320', '-height', '180', '-t', '2.500'
    ])
    const fc = compiled.args[compiled.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('anullsrc'), 'a still carries no audio lane, so the graph must synthesise one')
  })

  check('a raster still in the same position gets no vector options at all', () => {
    // -width/-height on a PNG decoder is a hard failure before the graph
    // builds, so this is not a style question.
    const compiled = compileTimelineToFfmpeg(projectFor(pngPath, 320, 180), path.join(workDir, 'b.mp4'))
    const flags = inputFlagsFor(compiled.args, pngPath)
    assert.ok(!flags.includes('-width') && !flags.includes('-height'), `raster input got ${flags.join(' ')}`)
    assert.deepEqual(flags, ['-framerate', '30', '-loop', '1', '-t', '2.500'])
    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the raster graph: ${res.stderr}`)
  })

  check('the vector clip exports as two seconds of picture, not one frame', () => {
    const out = path.join(workDir, 'svg_clip.mp4')
    const compiled = compileTimelineToFfmpeg(projectFor(svgPath, 320, 180), out)
    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the vector graph: ${res.stderr}`)
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000, 'output file missing or empty')
    const frames = probeFrameCount(out)
    assert.ok(frames >= 55, `a 2 s clip decoded to ${frames} frames — the still was not looped`)
    assert.ok(probeNumber(out, 'format=duration') > 1.9, 'the container does not hold the clip window')
  })

  check('the exported pixels are the vector, drawn at the size it was given', () => {
    const out = path.join(workDir, 'svg_canvas.mp4')
    // A 640x360 canvas over the same 320x180 file. The geometry check alone
    // would pass even if the decoder handed the fit filters a postage stamp to
    // stretch, so the picture and the raster are both measured: the centre of
    // the circle is bright and its corner is the plate, and the flags the
    // compiler emitted make librsvg rasterise at the canvas box.
    const compiled = compileTimelineToFfmpeg(projectFor(svgPath, 640, 360), out)
    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the vector graph: ${res.stderr}`)
    assert.equal(probeNumber(out, 'stream=width'), 640)
    assert.equal(probeNumber(out, 'stream=height'), 360)
    const frame = firstFrame(out)
    const centre = pixelAt(frame, 320, 180)
    const corner = pixelAt(frame, 6, 6)
    assert.ok(centre.every(value => value > 180), `centre is ${rgb(...centre as [number, number, number])}, expected the white circle`)
    assert.ok(corner[0]! > 140 && corner[1]! < 90 && corner[2]! < 90, `corner is ${rgb(...corner as [number, number, number])}, expected the red plate`)

    const raster = path.join(workDir, 'as-fed.png')
    const fed = runFFmpeg([...inputFlagsFor(compiled.args, svgPath), '-i', svgPath, '-frames:v', '1', raster])
    assert.equal(fed.code, 0, `the emitted flags do not decode: ${fed.stderr}`)
    assert.equal(probeNumber(raster, 'stream=width'), 640, 'the still was rasterised smaller than its box')
    assert.equal(probeNumber(raster, 'stream=height'), 360)
  })

  check('the served SVG cannot run as a document of this origin', () => {
    const headers = uploadsSecurityHeaders('image/svg+xml')
    const csp = headers['content-security-policy'] ?? ''
    assert.ok(csp.includes('sandbox'), 'a same-origin SVG document must get its own opaque origin')
    assert.ok(csp.includes('default-src \'none\''), 'and must not be able to fetch')
    assert.equal(headers['x-content-type-options'], 'nosniff')
    assert.deepEqual(uploadsSecurityHeaders('video/mp4'), {}, 'media data needs no document policy')
  })

  check('the preview asks the one still question', () => {
    const here = path.resolve(repoRoot, 'app', 'components', 'tmcut', 'TmcutPreviewPlayer.vue')
    const source = fs.readFileSync(here, 'utf8')
    assert.ok(/classifyAssetKind\(src\) === 'image'/.test(source), 'the fallback must read the core list')
    assert.ok(!/isImageFile\(/.test(source), 'the second list must not decide what the canvas paints')
  })
}
