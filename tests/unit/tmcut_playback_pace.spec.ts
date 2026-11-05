/**
 * The playhead is paced by core's frame grid (Zero-FFmpeg slice F6e).
 *
 * Slice F requirement 6: no wall-clock timer as the source of truth for
 * timeline position. The loop used to answer "where is the playhead now" by
 * integrating the rAF deltas it was handed — `playhead += (t - last) / 1000 *
 * shuttleRate` — twice over (forward, and the J-reverse branch). That makes the
 * position a running float sum of whatever the machine delivered between two
 * frames: the preview samples positions no exported frame ever sits at, and the
 * timecode readout drifts from the frame index the same tick renders.
 *
 * The law now: the host owns WHEN (it still supplies the rAF timestamp), core's
 * clock owns WHAT — elapsed time becomes a whole number of frames and the
 * playhead lands on that frame's START tick, the same sequence
 * `createFrameScheduler` hands a frame loop or an offline golden-frame dump.
 * Any move the pace did not produce (scrub, play, pause, a shuttle-rate change)
 * re-arms the anchor instead of leaking the interval it was carrying.
 *
 * Amounts are asserted to within one frame: that is the resolution the grid
 * itself has, and the anchor is the first timestamp the loop is given.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_playback_pace.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { createFrameScheduler } from 'tmcut-core'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const tk = (sec: number) => Math.round(sec * TICKS)

// Single-slot fake animation clock, the model tmcut_playback_duration uses:
// the loop re-arms through requestAnimationFrame, so one pending callback is
// all the loop needs. `tick` moves the wall clock and runs that callback once.
let pending: ((t: number) => void) | null = null
let clockMs = 0
let frameId = 0
const g = globalThis as Record<string, unknown>
g.requestAnimationFrame = (cb: (t: number) => void) => {
  pending = cb
  return ++frameId
}
g.cancelAnimationFrame = () => {
  pending = null
}

function tick(ms: number) {
  clockMs += ms
  const cb = pending
  pending = null
  if (cb) cb(clockMs)
}

function runFrames(count: number, ms: number) {
  for (let i = 0; i < count; i++) tick(ms)
}

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** One 8 s footage row, so the pace has room to run without reaching the end. */
async function project() {
  const s = await freshStore()
  s.addClipToTrack('video', { src: 'pace.mp4', in: 0, out: tk(8), offset: 0 })
  return createFrameScheduler(s.currentProject.value).ticksPerFrame
}

async function main() {
  console.log('=== [TMCut playback pace] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  const ticks = (p: { playhead: { value: number } }) => Math.round(p.playhead.value * TICKS)
  const assertOnGrid = (seen: number[], perFrame: number, what: string) => {
    const off = seen.filter(t => t % perFrame !== 0)
    assert.equal(off.length, 0,
      `${off.length}/${seen.length} ${what} samples sat between frames (first: ${off[0]} ticks, grid ${perFrame})`)
  }

  // 1. The grid is the shape of the answer: while the loop runs, the playhead
  // rests on a frame START — the position a frame loop would render.
  await check('every playhead position while playing is a frame start', async () => {
    const perFrame = await project()
    const p = useTmcutPlayback()
    p.seek(0)
    p.play()
    const seen: number[] = []
    for (let i = 0; i < 90; i++) {
      tick(16)
      seen.push(ticks(p))
    }
    p.pause()
    assertOnGrid(seen, perFrame, 'forward')
  })

  // 2. One law, one amount: a wall second paces a timeline second at 1x and
  // two seconds at 2x — core's frame count, not an accumulated float.
  await check('one wall second paces one timeline second at 1x and two at 2x', async () => {
    const perFrame = await project()
    const p = useTmcutPlayback()
    p.seek(0)
    p.play()
    runFrames(1000, 1) // 1000 ms of wall clock at 1x
    assert.ok(Math.abs(ticks(p) - tk(1)) <= perFrame,
      `1 s of wall clock at 1x must pace ~30 frames, got ${p.playhead.value}`)
    p.shuttleForward()
    p.shuttleForward()
    p.shuttleForward() // 1x -> 8x
    runFrames(125, 1) // 125 ms at 8x = one more timeline second
    // Two pace segments (1x then 8x), and a segment can only resolve whole
    // frames: the grid keeps at most one frame of each interval unspent.
    assert.ok(Math.abs(ticks(p) - tk(2)) <= 2 * perFrame,
      `1 s at 1x plus 0.125 s at 8x must pace ~60 frames, got ${p.playhead.value}`)
    assertOnGrid([ticks(p)], perFrame, 'shuttle')
    p.pause()
  })

  // 3. Re-arm, do not leak: the pace is measured from the moment the rate
  // changed, so the interval already carried at 1x is not re-spent at 8x.
  await check('a shuttle-rate change mid-play paces from the current frame', async () => {
    const perFrame = await project()
    const p = useTmcutPlayback()
    p.seek(0)
    p.play()
    runFrames(500, 1) // 0.5 s at 1x
    p.shuttleForward()
    p.shuttleForward()
    p.shuttleForward() // 8x
    runFrames(125, 1) // 0.125 s at 8x
    // Two segments again, so two frame widths of unspent remainder.
    assert.ok(Math.abs(ticks(p) - tk(1.5)) <= 2 * perFrame,
      `0.5 s at 1x + 0.125 s at 8x = 1.5 s of timeline, got ${p.playhead.value}`)
    p.pause()
  })

  // 4. Reverse rides the same grid: the J branch used to integrate its own
  // copy of the delta, and a negative pace must still land on frame starts.
  await check('reverse shuttle walks backwards on the same frame grid', async () => {
    const perFrame = await project()
    const p = useTmcutPlayback()
    p.seek(2)
    p.play()
    p.shuttleBackward() // J -> -1x
    const seen: number[] = []
    for (let i = 0; i < 60; i++) {
      tick(10)
      seen.push(ticks(p))
    }
    p.pause()
    assertOnGrid(seen, perFrame, 'reverse')
    assert.ok(Math.abs(seen[seen.length - 1] - (tk(2) - tk(0.6))) <= perFrame,
      `600 ms of reverse shuttle = 18 frames back, got ${p.playhead.value}`)
    assert.ok(seen[seen.length - 1] < tk(2), 'and it moved backwards')
  })

  // 5. A scrub while playing re-arms the anchor: the pace continues from the
  // new position instead of replaying the interval it was carrying.
  await check('a seek while playing restarts the pace from the sought frame', async () => {
    const perFrame = await project()
    const p = useTmcutPlayback()
    p.seek(0)
    p.play()
    runFrames(400, 1) // 0.4 s in
    p.seek(4)
    runFrames(200, 1) // 0.2 s after the scrub
    assert.ok(Math.abs(ticks(p) - tk(4.2)) <= perFrame,
      `a scrub to 4 s then 0.2 s of pace = 4.2 s, got ${p.playhead.value}`)
    assertOnGrid([ticks(p)], perFrame, 'post-scrub')
    p.pause()
  })

  // 6. No second copy of the pace law in the app: the loop asks core, and it
  // no longer turns a wall-clock interval into timeline position by itself.
  await check('the loop reads core clock and keeps no delta integral', () => {
    const source = read('app/composables/useTmcutPlayback.ts')
    assert.doesNotMatch(source, /const delta = \(timestamp - lastTimestamp\) \/ 1000/,
      'reading the rAF interval as seconds is the law F6e retires')
    assert.doesNotMatch(source, /playhead\.value \+ delta/,
      'and integrating it into the playhead is the second copy of the pace')
    assert.match(source, /clock\.frameIndexAt/, 'the frame count comes from core')
    assert.match(source, /clock\.frameStartAt/, 'and so does the frame position')
  })

  console.log(`\n=== All ${passed} playback-pace checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
