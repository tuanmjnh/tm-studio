/**
 * Opt-in REAL-FFmpeg smoke test for the render graph (not part of the
 * per-round string-assertion gate). Generates tiny synthetic media with the
 * bundled ffmpeg, compiles real projects through compileTimelineToFfmpeg and
 * runs them, proving the emitted filter_complex actually parses — including
 * the R77 shared-canvas-background case where one `[v_bg]` stream feeds
 * several per-clip overlays, and the R79 removal of the bare relabel chain.
 *
 * The last two blocks grade the picture, not just the graph: a black->white
 * plate pair as a real two-clip project, decoded frame by frame and compared
 * with the core preview model — whole-frame area AND the left/centre/right
 * column profile, so a positional wipe cannot pass by matching a crossfade's
 * area (V4 G2), plus the same project carrying a key the registry calls
 * unrenderable (V4 G16 export leg).
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_render_smoke.spec.ts
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTimelineToFfmpeg, mapXfadeTransition } from '../../app/utils/tmcut/render'
import { TICKS_PER_SECOND, previewTransitionRamp } from 'tmcut-core'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

// C16-R3: store items are integer TICKS — fixtures follow the store.
function tk(sec: number): number {
  return Math.round(sec * TICKS_PER_SECOND)
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FFMPEG = path.join(repoRoot, 'resources', 'ffmpeg.exe')
const FFPROBE = path.join(repoRoot, 'resources', 'ffprobe.exe')
// The work dir lives inside the repo and is git-ignored (`.golden-render-*/`),
// for a measured reason: this machine's bundled binary cannot open an output
// file under `%TEMP%` (`Error opening output …: Permission denied`, exit -13),
// so a tmpdir-based fixture could never run here. Same convention as
// `tmcut_render_parity.spec.ts`.
const workDir = fs.mkdtempSync(path.join(repoRoot, '.golden-render-smoke-'))

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

function mediaInputs(): { clip: string, clip2: string, bg: string, black: string, white: string } {
  const clip = path.join(workDir, 'clipA.mp4').replace(/\\/g, '/')
  const clip2 = path.join(workDir, 'clipB.mp4').replace(/\\/g, '/')
  const bg = path.join(workDir, 'bg.png').replace(/\\/g, '/')
  const black = path.join(workDir, 'plateBlack.mp4').replace(/\\/g, '/')
  const white = path.join(workDir, 'plateWhite.mp4').replace(/\\/g, '/')

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

  // Solid plates, written as real files. `tmcut_transition_preview` measures the
  // xfade filters straight out of lavfi; these two let a compiled PROJECT carry
  // the same black->white reveal, so the numbers are read off the pipeline the
  // export actually runs (container, encoder, audio lanes and all).
  // `-t` is what stops the encode: `d=2` bounds only the `color` source, while
  // the `anullsrc` lane is endless, so without it ffmpeg muxes forever.
  for (const [colour, file] of [['black', black], ['white', white]] as const) {
    const plate = runFFmpeg([
      '-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=320x180:r=30:d=2`,
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
      '-t', '2', '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', file
    ])
    assert.equal(plate.code, 0, `ffmpeg ${colour} plate failed: ${plate.stderr}`)
  }

  return { clip, clip2, bg, black, white }
}

/**
 * Covered fraction per frame of a rendered file, read the same way the plate
 * probe reads it: mean luma of a gray decode, black plate = 0, white = 1.
 * Returns `count` values starting at frame index `from` (0-based).
 */
function decodeFrames(file: string, from: number, count: number): Buffer[] {
  const res = spawnSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-i', file,
    '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1'
  ], { maxBuffer: 1 << 26, encoding: 'buffer', timeout: 120_000 })
  assert.equal(res.status, 0, `could not decode ${file} to gray frames`)
  const frameBytes = 320 * 180
  const out: Buffer[] = []
  for (let i = 0; i < count; i++) {
    const frame = res.stdout.subarray((from + i) * frameBytes, (from + i + 1) * frameBytes)
    assert.equal(frame.length, frameBytes,
      `${file} has no frame ${from + i} — the render is shorter than the timeline says`)
    out.push(frame)
  }
  return out
}

function meanLuma(frame: Buffer, x0: number, x1: number): number {
  let sum = 0
  for (let y = 0; y < 180; y++) {
    const row = y * 320
    for (let x = x0; x < x1; x++) {
      const px = frame[row + x]
      // A NaN average once silently hid an out-of-range column offset here.
      assert.equal(typeof px, 'number', `no pixel at column ${x}, row ${y}`)
      sum += px
    }
  }
  return sum / ((x1 - x0) * 180) / 255
}

/** Whole frame plus the left / centre / right quarter columns, per frame. */
function renderedProfile(file: string, from: number, count: number) {
  const frames = decodeFrames(file, from, count)
  return {
    area: frames.map(f => meanLuma(f, 0, 320)),
    left: frames.map(f => meanLuma(f, 0, 80)),
    mid: frames.map(f => meanLuma(f, 120, 200)),
    right: frames.map(f => meanLuma(f, 240, 320))
  }
}

/**
 * The box the core model says is revealed at progress `p`, read out of the same
 * `clipPath` the preview paints — so the strip numbers below are predicted by
 * the model, not by a formula written in the test.
 */
function revealedBoxAt(type: string, p: number): { left: number, right: number } {
  const clip = previewTransitionRamp(type, p).incoming.clipPath
  assert.ok(typeof clip === 'string', `${type} is not painted by a clip-path, so the strip check has no model`)
  const m = /^inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%\)$/.exec(clip)
  assert.ok(m, `${type} emitted an unparsable clip-path: ${clip}`)
  return { left: Number(m[4])! / 100, right: 1 - Number(m[2])! / 100 }
}

/** Fraction of the column strip [x0, x1] inside the revealed box. */
function stripCover(type: string, p: number, x0: number, x1: number): number {
  const box = revealedBoxAt(type, p)
  return Math.max(0, Math.min(x1, box.right) - Math.max(x0, box.left)) / (x1 - x0)
}

function renderedCoverage(file: string, from: number, count: number): number[] {
  return decodeFrames(file, from, count).map(f => meanLuma(f, 0, 320))
}

function main() {
  if (!fs.existsSync(FFMPEG)) {
    console.log(`[skip] bundled ffmpeg not found at ${FFMPEG}`)
    return
  }
  console.log('=== [TMCut Render SMOKE (real FFmpeg)] Starting ===\n')
  const { clip, clip2, bg, black, white } = mediaInputs()

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

  // Two plates as a real two-clip project: the same black -> white reveal the
  // probe spec measures out of lavfi, but carried through compileTimelineToFfmpeg
  // and an mp4 container, so what is graded is the pipeline the export runs.
  function plateProject(type: string): TmcutProject {
    return {
      name: `Smoke Plate ${type}`,
      canvas: { width: 320, height: 180, fps: { numerator: 30, denominator: 1 }, background: { type: 'color', value: '#000000' } },
      timeline: {
        version: 1,
        tracks: [
          {
            id: 'v1',
            type: 'video',
            name: 'Video',
            items: [
              { id: 'p1', src: black, offset: 0, in: 0, out: tk(2), speed: 1 },
              { id: 'p2', src: white, offset: tk(1.6), in: 0, out: tk(2), speed: 1, transitionIn: { type, duration: tk(0.4) } }
            ]
          },
          { id: 't1', type: 'text', name: 'Text', items: [] },
          { id: 'a1', type: 'audio', name: 'Audio', items: [] }
        ],
        durationMs: 3600,
        markers: []
      },
      settings: { resolution: '320x180', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 2000 },
      source: 'manual',
      created_at: '',
      updated_at: ''
    } as unknown as TmcutProject
  }

  /** Compile and render one plate project; returns the filtergraph and output. */
  function renderPlates(type: string, file: string): { fc: string, out: string } {
    const out = path.join(workDir, file)
    const compiled = compileTimelineToFfmpeg(plateProject(type), out)
    const fc = compiled.args[compiled.args.indexOf('-filter_complex') + 1]!
    const res = runFFmpeg(compiled.args)
    assert.equal(res.code, 0, `ffmpeg rejected the ${type} project graph: ${res.stderr}`)
    return { fc, out }
  }

  check('a rendered project transition window matches the core preview model (V4 G2)', () => {
    const { fc, out } = renderPlates('wipe-left', 'plate_wipeleft.mp4')
    assert.ok(fc.includes('xfade=transition=wipeleft:duration=0.400:offset=1.600'),
      `the project did not emit the window the timeline describes: ${fc.slice(0, 200)}`)
    const rendered = probeDurationSec(out)
    assert.ok(Math.abs(rendered - 3.6) < 0.25, `a 3.6s overlap project rendered ${rendered.toFixed(2)}s`)

    // Frame 48 (offset 1.6s at 30fps) is the last pure-outgoing frame, 49..60
    // carry progress 1/12..12/12, and 61 is the first pure-incoming frame.
    const prof = renderedProfile(out, 48, 14)
    assert.ok(prof.area[0]! < 0.02, `frame 48 should be the black plate, measured ${prof.area[0]!.toFixed(3)}`)
    assert.ok(prof.area[13]! > 0.98, `frame 61 should be the white plate, measured ${prof.area[13]!.toFixed(3)}`)

    const worstArea = prof.area.slice(1, 13).reduce((acc, value, i) => {
      const predicted = previewTransitionRamp('wipe-left', (i + 1) / 12).coverage
      assert.ok(predicted !== null, 'wipe-left coverage is aspect-free and must be modelled')
      return Math.max(acc, Math.abs(predicted! - value))
    }, 0)
    // The same 3% limit the plate probe puts on an `exact` row — but here the
    // container, the encoder and both audio lanes are in the loop, so passing it
    // says the model survives the whole export path, not only the filtergraph.
    // Measured on this machine: 0.3%.
    assert.ok(worstArea <= 0.03,
      `the rendered project diverges from the CSS model by ${(worstArea * 100).toFixed(1)}% of the frame (limit 3%)`)

    // Area alone cannot tell a wipe from a crossfade — both cover a linear share
    // of the box — so grade WHERE the white plate has arrived. The expected
    // profile comes out of the model's own `clipPath` (the CSS the preview
    // paints), not a formula written in this file. Measured here: left 0.8%,
    // centre 1.2%, right 1.3%.
    for (const [name, values, x0, x1] of [
      ['left', prof.left, 0, 0.25],
      ['centre', prof.mid, 0.375, 0.625],
      ['right', prof.right, 0.75, 1]
    ] as const) {
      const worst = values.slice(1, 13).reduce((acc, value, i) =>
        Math.max(acc, Math.abs(stripCover('wipe-left', (i + 1) / 12, x0, x1) - value)), 0)
      assert.ok(worst <= 0.03,
        `the rendered ${name} quarter diverges from the modelled reveal by ${(worst * 100).toFixed(1)}% of the strip (limit 3%) — the project is not painting the positional wipe the preview shows`)
    }

    // A grading that also passes on a crossfade would prove nothing, so score the
    // SAME project rendered with `fade` against the wipe model: the profile has
    // to be far off. Measured here: left 74.9%, centre 33.3%, right 75.3% — two
    // orders of magnitude above the 1.3% the real wipe sits at.
    const fadeRun = renderPlates('fade', 'plate_fade_compare.mp4')
    const fadeProf = renderedProfile(fadeRun.out, 48, 14)
    for (const [name, values, x0, x1] of [
      ['left', fadeProf.left, 0, 0.25],
      ['centre', fadeProf.mid, 0.375, 0.625],
      ['right', fadeProf.right, 0.75, 1]
    ] as const) {
      const worst = values.slice(1, 13).reduce((acc, value, i) =>
        Math.max(acc, Math.abs(stripCover('wipe-left', (i + 1) / 12, x0, x1) - value)), 0)
      assert.ok(worst > 0.15,
        `a crossfade now scores ${(worst * 100).toFixed(1)}% against the wipe profile — the ${name}-strip grading no longer separates a wipe from a fade, so the block above grades nothing`)
    }
  })

  check('the key the registry calls unrenderable is degraded in a real project graph (V4 G16 export leg)', () => {
    // What this grades is the CONTRACT, not the crash: a project carries the key,
    // the graph must carry `fade`, and the window must survive the swap. Measured
    // here as well (see the roadmap G16 note): this compiled graph finishes even
    // when the degradation is mutated off, because its window is the legal one
    // (`offset = firstClipLength - duration`, here 2.0 - 0.4 = 1.600). The crash
    // the registry was written from reproduces on the bare probe chain, whose
    // `offset=0.6` is not legal for 1.2 s plates. Grading both shapes is what
    // keeps that finding from becoming an assumption again.
    const { fc, out } = renderPlates('squeezev', 'plate_squeezev.mp4')
    assert.ok(!fc.includes('squeezev'), 'a name the registry calls unrenderable reached the filtergraph')
    assert.ok(fc.includes('xfade=transition=fade:duration=0.400:offset=1.600'),
      'the degraded key lost the window the timeline describes')
    const frames = renderedCoverage(out, 48, 14)
    const ramp = frames.slice(1, 13)
    assert.ok(ramp.every((value, i) => Math.abs(value - (i + 1) / 12) < 0.03),
      `the real project did not render the plain fade the preview paints: ${ramp.map(v => v.toFixed(3)).join(' ')}`)
    // Its sibling is untouched by the degradation and still squeezes.
    assert.equal(mapXfadeTransition('squeezeh'), 'squeezeh')
  })

  console.log(`\n=== SMOKE: all ${passed} real-FFmpeg renders passed ===`)
}

// Cleanup even when a check fails, so a red run cannot litter the repo with
// rendered media (same shape as tmcut_render_parity.spec.ts).
try {
  main()
} finally {
  fs.rmSync(workDir, { recursive: true, force: true })
}
