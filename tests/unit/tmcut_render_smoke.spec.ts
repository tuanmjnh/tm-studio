/**
 * Opt-in REAL-FFmpeg smoke test for the render graph (not part of the
 * per-round string-assertion gate). Generates tiny synthetic media with the
 * bundled ffmpeg, compiles real projects through compileTimelineToFfmpeg and
 * runs them, proving the emitted filter_complex actually parses — including
 * the R77 shared-canvas-background case where one `[v_bg]` stream feeds
 * several per-clip overlays, and the R79 removal of the bare relabel chain.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_render_smoke.spec.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import { TICKS_PER_SECOND } from '@tmcut-core'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

// C16-R3: store items are integer TICKS — fixtures follow the store.
function tk(sec: number): number {
  return Math.round(sec * TICKS_PER_SECOND)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FFMPEG = path.join(repoRoot, 'resources', 'ffmpeg.exe')
const FFPROBE = path.join(repoRoot, 'resources', 'ffprobe.exe')
const workDir = fs.mkdtempSync(path.join(tmpdir(), 'tmcut-render-smoke-'))

let passed = 0

function check(label: string, fn: () => void) {
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

/** Seconds the container actually reports for a rendered file. */
function probeDurationSec(file: string): number {
  const res = spawnSync(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', file
  ], { encoding: 'utf8' })
  assert.equal(res.status, 0, `ffprobe failed on ${file}: ${res.stderr}`)
  const sec = Number.parseFloat(String(res.stdout).trim())
  assert.ok(Number.isFinite(sec), `ffprobe returned no duration for ${file}: ${res.stdout}`)
  return sec
}

function mediaInputs(): { clip: string, clip2: string, bg: string } {
  const clip = path.join(workDir, 'clipA.mp4').replace(/\\/g, '/')
  const clip2 = path.join(workDir, 'clipB.mp4').replace(/\\/g, '/')
  const bg = path.join(workDir, 'bg.png').replace(/\\/g, '/')

  // Video clip A (testsrc + silent stereo audio)
  const a = runFFmpeg([
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '2', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip
  ])
  assert.equal(a.code, 0, `ffmpeg clipA failed: ${a.stderr}`)

  // Video clip B (smptebars so it is visually distinct)
  const b = runFFmpeg([
    '-y', '-f', 'lavfi', '-i', 'smptebars=size=320x240:rate=30', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '2', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip2
  ])
  assert.equal(b.code, 0, `ffmpeg clipB failed: ${b.stderr}`)

  // Still image background
  const c = runFFmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=blue:size=640x480:rate=1', '-frames:v', '1', bg])
  assert.equal(c.code, 0, `ffmpeg bg.png failed: ${c.stderr}`)

  return { clip, clip2, bg }
}

function main() {
  if (!fs.existsSync(FFMPEG)) {
    console.log(`[skip] bundled ffmpeg not found at ${FFMPEG}`)
    return
  }
  console.log('=== [TMCut Render SMOKE (real FFmpeg)] Starting ===\n')
  const { clip, clip2, bg } = mediaInputs()

  check('shared image background + two transformed clips renders (R77/R79)', () => {
    const project = {
      name: 'Smoke Shared BG',
      canvas: { width: 320, height: 240, fps: { numerator: 30, denominator: 1 }, background: { type: 'image', value: bg } },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'c1', src: clip, offset: 0, in: 0, out: tk(1), speed: 1, scale: 60, x: 10, y: 10, opacity: 100 },
              { id: 'c2', src: clip2, offset: tk(1), in: 0, out: tk(1), speed: 1, scale: 50, x: -20, y: 5, opacity: 100 }
            ]
          },
          { id: 't1', type: 'text', name: 'Text', items: [{ id: 'x1', text: 'SMOKE', offset: 0, in: 0, out: tk(2), fontSize: 24, color: 'white' }] },
          { id: 'a1', type: 'audio', name: 'Audio', items: [] }
        ],
        durationMs: 2000,
        markers: []
      },
      settings: { resolution: '320x240', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
      source: 'manual',
      created_at: '',
      updated_at: ''
    } as unknown as TmcutProject

    const out = path.join(workDir, 'shared_bg.mp4')
    const compiled = compileTimelineToFfmpeg(project, out)
    const fc = compiled.args[compiled.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('[v_bg_trim_1]') && fc.includes('[v_bg_trim_2]'), 'both clips should reuse the shared [v_bg]')
    assert.equal(fs.existsSync(out), false, 'output must not exist before render')

    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the graph: ${res.stderr}`)
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000, 'output file missing or empty')
  })

  check('transformed clip over color background renders', () => {
    const project = {
      name: 'Smoke Color BG',
      canvas: { width: 320, height: 240, fps: { numerator: 30, denominator: 1 }, background: { type: 'color', value: '#123456' } },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'c1', src: clip, offset: 0, in: 0, out: tk(1), speed: 1, scale: 55, x: 15, y: -10, opacity: 45 },
              { id: 'c2', src: clip2, offset: tk(1), in: 0, out: tk(1), speed: 1, scale: 100, x: 0, y: 0, opacity: 100 }
            ]
          },
          { id: 't1', type: 'text', name: 'Text', items: [] },
          { id: 'a1', type: 'audio', name: 'Audio', items: [] }
        ],
        durationMs: 2000,
        markers: []
      },
      settings: { resolution: '320x240', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
      source: 'manual',
      created_at: '',
      updated_at: ''
    } as unknown as TmcutProject

    const out = path.join(workDir, 'color_bg.mp4')
    const compiled = compileTimelineToFfmpeg(project, out)
    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the graph: ${res.stderr}`)
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000)
  })

  check('transition xfade pipeline renders', () => {
    const project = {
      name: 'Smoke Xfade',
      canvas: { width: 320, height: 240, fps: { numerator: 30, denominator: 1 }, background: { type: 'color', value: '#000000' } },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'c1', src: clip, offset: 0, in: 0, out: tk(2), speed: 1 },
              { id: 'c2', src: clip2, offset: tk(1.6), in: 0, out: tk(2), speed: 1, transitionIn: { type: 'dissolve', duration: tk(0.4) } }
            ]
          },
          { id: 't1', type: 'text', name: 'Text', items: [] },
          { id: 'a1', type: 'audio', name: 'Audio', items: [] }
        ],
        durationMs: 3600,
        markers: []
      },
      settings: { resolution: '320x240', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
      source: 'manual',
      created_at: '',
      updated_at: ''
    } as unknown as TmcutProject

    const out = path.join(workDir, 'xfade.mp4')
    const compiled = compileTimelineToFfmpeg(project, out)
    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the graph: ${res.stderr}`)
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000)
  })

  check('image clip on the video track renders (looped still + silent lane)', () => {
    // Regression: a still carries no audio stream, so the audio chain used to
    // emit `[i:a]` for it and ffmpeg rejected the whole graph.
    const project = {
      name: 'Smoke Image Clip',
      canvas: { width: 320, height: 240, fps: { numerator: 30, denominator: 1 }, background: { type: 'color', value: '#000000' } },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'i1', src: bg, offset: 0, in: 0, out: tk(1), speed: 1, scale: 80, x: 0, y: 0, opacity: 100 },
              { id: 'c2', src: clip, offset: tk(1), in: 0, out: tk(1), speed: 1, transitionIn: { type: 'dissolve', duration: tk(0.3) } }
            ]
          },
          { id: 't1', type: 'text', name: 'Text', items: [] },
          { id: 'a1', type: 'audio', name: 'Audio', items: [] }
        ],
        durationMs: 2000,
        markers: []
      },
      settings: { resolution: '320x240', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
      source: 'manual',
      created_at: '',
      updated_at: ''
    } as unknown as TmcutProject

    const out = path.join(workDir, 'image_clip.mp4')
    const compiled = compileTimelineToFfmpeg(project, out)
    const fc = compiled.args[compiled.args.indexOf('-filter_complex') + 1]!
    assert.ok(fc.includes('anullsrc'), 'the still must get a synthesised silent lane')
    assert.ok(!fc.includes('[0:a]'), 'no audio specifier for the still input')

    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the graph: ${res.stderr}`)
    assert.ok(fs.existsSync(out) && fs.statSync(out).size > 1000, 'output file missing or empty')
  })

  check('a short project exports exactly its content, not the padded ruler', () => {
    // The timeline UI keeps a 5-second ruler floor; the render must not inherit
    // it. This is the end of the chain for the contentDuration split: compile
    // says 2s, ffmpeg writes 2s, ffprobe agrees.
    const project = {
      name: 'Smoke Content Length',
      canvas: { width: 320, height: 240, fps: { numerator: 30, denominator: 1 }, background: { type: 'color', value: '#000000' } },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [{ id: 'c1', src: clip, offset: 0, in: 0, out: tk(2), speed: 1 }]
          },
          { id: 't1', type: 'text', name: 'Text', items: [] },
          { id: 'a1', type: 'audio', name: 'Audio', items: [] }
        ],
        durationMs: 5000, // what the padded ruler used to persist
        markers: []
      },
      settings: { resolution: '320x240', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
      source: 'manual',
      created_at: '',
      updated_at: ''
    } as unknown as TmcutProject

    const out = path.join(workDir, 'content_length.mp4')
    const compiled = compileTimelineToFfmpeg(project, out)
    assert.ok(Math.abs(compiled.duration - 2) < 0.11, `compiler padded to ${compiled.duration}s`)

    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the graph: ${res.stderr}`)
    const rendered = probeDurationSec(out)
    assert.ok(Math.abs(rendered - 2) < 0.25, `a 2s project rendered ${rendered.toFixed(2)}s`)
  })

  console.log(`\n=== SMOKE: all ${passed} real-FFmpeg renders passed ===`)
}

main()
