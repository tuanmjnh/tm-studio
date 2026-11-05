/**
 * One media-clock rate law for every footage element (Zero-FFmpeg slice F4).
 *
 * F2b gave the stacked rows an element and ONE clock function to drive them,
 * and that function set `playbackRate` from the shuttle rate alone. The seek
 * target it is handed, though, comes from `layer.sourceTicks` — core's answer
 * for a clip running at `speed` 2, or along a speed ramp. So a sped row above
 * the base free-ran at 1x while its own target advanced at 2x: the drift check
 * fired every few frames, forever, and the picture was a thrash of seeks rather
 * than a fast clip. The main element had the same split in a different shape —
 * it rides the ramp (`speedAt`) only when the clip HAS a ramp, so a constant
 * 1.5x clip played at 1x and leaned on the corrective seek.
 *
 * The export has always been unambiguous here: `setpts` divides by the clip's
 * speed for EVERY row, ramped or not (`render/video.ts`). The law these checks
 * demand is the preview-side reading of that same number — core's
 * `elementRate(clip, local, shuttle)`, once, for every element the plan names.
 * G4 moved the 0.25..16 clamp into core, so the composable no longer holds any
 * rate arithmetic of its own.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_speed_clock.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const CLOCK = 'app/composables/useTmcutPlayback.ts'
const tk = (sec: number) => Math.round(sec * TICKS)

// The composable registers stacked elements through an `instanceof
// HTMLVideoElement` guard, so the stub has to BE one for the runtime that
// evaluates that guard. Node has no DOM: declare the class, then extend it.
class VideoStub {
  currentTime = 0
  playbackRate = 1
  paused = true
  volume = 1
  muted = false
  play() {
    this.paused = false
    return Promise.resolve()
  }

  pause() {
    this.paused = true
    return Promise.resolve()
  }
}
const g = globalThis as Record<string, unknown>
if (!('HTMLVideoElement' in g)) g.HTMLVideoElement = VideoStub

// Single-slot fake animation clock, same model as tmcut_playback_duration: the
// loop re-arms itself, so one pending callback is all the clock needs.
let pending: ((t: number) => void) | null = null
let clock = 0
let frameId = 0
g.requestAnimationFrame = (cb: (t: number) => void) => {
  pending = cb
  return ++frameId
}
g.cancelAnimationFrame = () => {
  pending = null
}

function tick(ms: number) {
  clock += ms
  const cb = pending
  pending = null
  if (cb) cb(clock)
}

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Two visible footage rows at 0-4 s: `bottom` owns the audio, `top` is stacked. */
async function spedRows(topSpeed: number) {
  const s = await freshStore()
  s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0, speed: 1 })
  s.addTrackToProject('video')
  const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
  s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0, speed: topSpeed }, rows[1]!.id)
  return s
}

async function main() {
  console.log('=== [TMCut speed clock] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  // 1. The bug this slice exists for: the stacked row's target is already
  // speed-resolved, so its rate has to be too.
  await check('a sped stacked row runs at its clip speed, not at the shuttle rate', async () => {
    await spedRows(2)
    const p = useTmcutPlayback()
    p.seek(1)
    const main = new VideoStub()
    const stacked = new VideoStub()
    const surface = p.stackedSurfaces.value.find(s => s.clip.src === 'top.mp4')
    assert.ok(surface, 'core stacks the 2x row above the base')
    p.videoRef.value = main as unknown as HTMLVideoElement
    p.setStackedVideoEl(surface.key, stacked as unknown as HTMLVideoElement)
    p.play()
    tick(0)
    assert.equal(stacked.playbackRate, 2,
      'a 2x row must advance at 2x; at 1x its own seek target outruns it every frame')
    assert.equal(main.playbackRate, 1, 'the 1x base row is untouched by its neighbour')
    p.pause()
  })

  // 2. The same law on the element that already had a ramp branch: a CONSTANT
  // speed is a speed. `speedAt` answers both, so the preview may not gate on
  // `isRamped` and leave a plain 1.5x clip to the corrective seek.
  await check('the main element rides a constant clip speed', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'solo.mp4', in: 0, out: tk(4), offset: 0, speed: 1.5 })
    const p = useTmcutPlayback()
    p.seek(1)
    const main = new VideoStub()
    p.videoRef.value = main as unknown as HTMLVideoElement
    p.play()
    tick(0)
    assert.equal(main.playbackRate, 1.5,
      'the export divides setpts by 1.5 for a constant-speed clip; the screen must match')
    p.pause()
  })

  // 3. Ramp and shuttle multiply into ONE number: L to 4x on a clip whose curve
  // reads 1.5x at this tick gives 6x, the same product the file's setpts draws.
  await check('shuttle and ramp compose into one rate', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'ramp.mp4', in: 0, out: tk(4), offset: 0, speed: 1 })
    const item = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!
    item.speedPoints = [{ t: 0, speed: 1 }, { t: tk(4), speed: 3 }]
    const p = useTmcutPlayback()
    p.seek(1)
    const main = new VideoStub()
    p.videoRef.value = main as unknown as HTMLVideoElement
    p.play()
    tick(0)
    // Local 1 s of a 0-4 s curve 1 -> 3 is 1.5x.
    assert.equal(main.playbackRate, 1.5, 'the ramp is read at the tick the plan was built for')
    p.shuttleForward()
    p.shuttleForward()
    tick(0)
    assert.equal(main.playbackRate, 6,
      'L L is 4x the timeline rate, so the element runs 4 x 1.5 = 6x')
    p.shuttleStop()
    p.pause()
  })

  // 4. Reverse rows keep the seek branch: an HTMLMediaElement cannot decode
  // backwards, so this is the one place a rate must NOT be invented.
  await check('a reverse stacked row stays seek-driven', async () => {
    const s = await spedRows(1)
    const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
    rows[1]!.items![0]!.reverse = true
    const p = useTmcutPlayback()
    p.seek(1)
    const surface = p.stackedSurfaces.value.find(x => x.clip.src === 'top.mp4')
    assert.ok(surface)
    const main = new VideoStub()
    const stacked = new VideoStub()
    p.videoRef.value = main as unknown as HTMLVideoElement
    p.setStackedVideoEl(surface.key, stacked as unknown as HTMLVideoElement)
    p.play()
    tick(0)
    assert.equal(stacked.paused, true, 'a reverse element is never left playing forward')
    p.pause()
  })

  // 5. The law is one function, not a per-surface copy with its own clamp.
  await check('one rate law drives every footage element', () => {
    const src = read(CLOCK)
    assert.equal((src.match(/elementRate\(/g) || []).length, 1,
      'core elementRate is read in exactly one place')
    assert.equal((src.match(/speedAt\(/g) || []).length, 0,
      'the composable does not sample the curve itself — core answers the rate')
    const writes = src.split('\n').filter(line => line.includes('.playbackRate ='))
    assert.ok(writes.length > 0, 'the composable still owns the element rate')
    for (const line of writes) {
      const paused = /playbackRate = 1\b/.test(line)
      const shared = /= \w*mediaRate\(/.test(line)
      assert.ok(paused || shared, `rate write is not the shared law: ${line.trim()}`)
    }
  })

  console.log(`\n=== All ${passed} speed-clock checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
