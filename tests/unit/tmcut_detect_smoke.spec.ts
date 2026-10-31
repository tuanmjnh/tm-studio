/**
 * Opt-in REAL-FFmpeg smoke test for the AutoCut detection passes.
 *
 * The unit suites mock the analyzer, so nothing else in the repo proves that
 * the argv in shared/utils/detection-args.cjs actually runs on the FFmpeg
 * build shipped in resources/. That is exactly how AutoCut broke for months:
 * `-vsync` was removed in FFmpeg 7-era builds, the desktop call site still
 * passed it, and every scene-detection run died with "Unrecognized option
 * 'vsync'" — a plain exit-code failure no string assertion can see.
 *
 * This generates a clip with one hard cut and one silent half, runs BOTH
 * shared vectors verbatim, and feeds the logs through the same @tmcut/core
 * parsers the renderer uses, so the whole desktop/web detection contract is
 * covered end to end.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_detect_smoke.spec.ts
 *   (or the whole gate with --smoke)
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import detectionArgs from '../../shared/utils/detection-args.cjs'
import { parseSceneOutput, parseSilenceOutput } from '@tmcut-core'

const { sceneDetectionArgs, silenceDetectionArgs } = detectionArgs

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FFMPEG = path.join(repoRoot, 'resources', 'ffmpeg.exe')
const workDir = fs.mkdtempSync(path.join(tmpdir(), 'tmcut-detect-smoke-'))

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Build a clip. Extra global flags are fine here — this is not under test. */
function runFFmpeg(args: string[]): { code: number, log: string } {
  const res = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return { code: res.status ?? -1, log: String(res.stderr ?? '') + String(res.stdout ?? '') }
}

/**
 * Run a shared vector EXACTLY as the two runtimes do: no prefix, no extra
 * flags, so an unsupported option fails here the way it fails in the app.
 */
function runExact(args: string[]): { code: number, log: string } {
  const res = spawnSync(FFMPEG, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { code: res.status ?? -1, log: String(res.stderr ?? '') + String(res.stdout ?? '') }
}

/** 2 s clip: testsrc2 -> smptebars cut at 1 s, tone then digital silence. */
function sourceClip(): string {
  const clip = path.join(workDir, 'detect.mp4')
  const res = runFFmpeg([
    '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=128x128:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'smptebars=size=128x128:rate=30:duration=1',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v];[2:a][3:a]concat=n=2:v=0:a=1[a]',
    '-map', '[v]', '-map', '[a]', '-t', '2',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', clip
  ])
  assert.equal(res.code, 0, `fixture clip failed: ${res.log}`)
  return clip
}

function main() {
  if (!fs.existsSync(FFMPEG)) {
    console.log(`[skip] bundled ffmpeg not found at ${FFMPEG}`)
    return
  }
  console.log('=== [TMCut Detect SMOKE (real FFmpeg)] Starting ===\n')
  const clip = sourceClip()

  check('scene detection argv runs and core parses the real cut', () => {
    const args = sceneDetectionArgs(clip, 0.4)
    const { code, log } = runExact(args)
    assert.equal(code, 0, `scene pass exited ${code}: ${log.slice(-400)}`)
    const segments = parseSceneOutput(log, 2)
    assert.ok(segments.length >= 2, `expected the hard cut to split the clip, got ${JSON.stringify(segments)}`)
    assert.ok(
      segments.some(s => Math.abs(s.start - 1) < 0.2),
      `expected a shot starting at the 1 s cut, got ${JSON.stringify(segments)}`
    )
  })

  check('silence detection argv runs and core parses the real silence', () => {
    const args = silenceDetectionArgs(clip, -30, 0.5)
    const { code, log } = runExact(args)
    assert.equal(code, 0, `silence pass exited ${code}: ${log.slice(-400)}`)
    const ranges = parseSilenceOutput(log, 2)
    assert.ok(ranges.length >= 1, `expected the silent half to be detected, got ${JSON.stringify(ranges)}`)
    assert.ok(
      ranges.some(r => Math.abs(r.start - 1) < 0.3),
      `expected silence to start at the 1 s tone boundary, got ${JSON.stringify(ranges)}`
    )
  })

  check('both vectors are null-muxer passes and free of removed options', () => {
    for (const args of [sceneDetectionArgs(clip, 0.4), silenceDetectionArgs(clip, -30, 0.5)]) {
      assert.deepEqual(args.slice(-3), ['-f', 'null', '-'], 'detection must not write an output file')
      // -vsync disappeared from the bundled build; passthrough replaced it.
      assert.ok(!args.includes('-vsync'), 'argv still passes the removed -vsync option')
    }
  })

  check('both runtimes build detection argv through the shared module', () => {
    const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8')
    const desktop = read('electron/tools/tmcut.controller.cjs')
    const web = read('server/api/v1/media/analyze.post.ts')
    for (const [label, src] of [['desktop', desktop], ['web', web]] as const) {
      assert.match(src, /sceneDetectionArgs\(/, `${label} no longer uses the shared scene argv`)
      assert.match(src, /silenceDetectionArgs\(/, `${label} no longer uses the shared silence argv`)
      // A re-spliced filter string here would silently diverge from the other
      // runtime, which is how the -vsync bug survived in the first place.
      assert.ok(!/['"]-vf['"],\s*`select=/.test(src), `${label} hand-rolls its own scene filter argv`)
    }
  })

  console.log(`\n=== SMOKE: all ${passed} real-FFmpeg detection checks passed ===`)
}

main()
