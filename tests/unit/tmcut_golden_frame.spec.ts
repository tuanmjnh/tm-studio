/**
 * Golden-frame gate (V4 M2): compile a tiny project, render it with the real
 * FFmpeg compiler, decode one frame and compare it to the checked-in PNG by
 * error budget (ADR-016), never by hash. The subject is a solid canvas on
 * purpose — text needs a host font, so a font-pinned text golden belongs to a
 * later slice. Skips when no FFmpeg binary is available.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareFrames } from 'tmcut-core'
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
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
