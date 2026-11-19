/**
 * The playhead is TIMELINE seconds — a held picture must be mapped, not copied.
 *
 * The reported bug: with a trimmed or offset clip, pressing Play parked the
 * playhead at the SOURCE position of the picture. `planPlaybackFollow` answers
 * in ELEMENT seconds because that is the unit it compares (`targetSec` is the
 * surface's `mediaTimeSec`, `elementSec` is `el.currentTime`), and while the
 * element cannot present it answers with the element's own position so the
 * transport does not run ahead of the picture. The preview wrote that answer
 * straight into `playhead`, which lives on the TIMELINE.
 *
 * The two worlds coincide only when `in = 0`, `offset = 0` and `speed = 1` —
 * the shape every manual check used. With `in = 10 s` a hold at source 11 s
 * teleported the timeline to 11 s instead of 31 s (offset 30 s), the next tick
 * evaluated a different clip, and the element was re-seeked to a different
 * source instant — the preview looked like it had stalled or jumped.
 *
 * Two contracts, one for each half:
 *  * `mediaSecToTimelineSec` maps a source second through the clip's own
 *    geometry (trim, offset, speed, reverse) — the inverse of the position the
 *    surface already reads from core;
 *  * the preview's hold/stall branch writes the MAPPED value, never the raw
 *    plan answer, and the source contract keeps the next reader honest.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_playhead_hold_units.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const tk = (sec: number) => Math.round(sec * TICKS)

// Single-slot fake animation clock (the model the pace/duration specs use).
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

// The freeze budget is measured with `performance.now`, so the fake clock has
// to drive that too — otherwise two ticks are always "0 ms apart" in real time.
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { now: () => clockMs }
})

/** A media element that cannot present: the hold branch, not the seek branch. */
function deadElement(currentTime: number) {
  return {
    currentTime,
    readyState: 1,
    seeking: false,
    paused: false,
    playbackRate: 1,
    play() {
      this.paused = false
      return Promise.resolve()
    },
    pause() {
      this.paused = true
    }
  } as unknown as HTMLVideoElement
}

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

async function main() {
  console.log('=== [TMCut playhead hold units] Starting ===\n')
  const { mediaSecToTimelineSec } = await import('../../app/utils/tmcut/clipTime')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  // 1. The mapping itself: source seconds -> timeline seconds.
  await check('a trimmed, offset clip maps its source second onto the timeline', () => {
    const clip = { in: tk(10), out: tk(20), offset: tk(30), speed: 1 }
    assert.equal(mediaSecToTimelineSec(clip, 11), 31,
      'source 11 s of a clip trimmed at 10 s and placed at 30 s is timeline 31 s')
  })

  await check('speed divides the source distance like the surface law does', () => {
    const clip = { in: tk(10), out: tk(20), offset: tk(30), speed: 2 }
    assert.equal(mediaSecToTimelineSec(clip, 12), 31,
      'a 2x clip covers 2 source seconds per timeline second')
  })

  await check('a reversed clip maps from its out edge', () => {
    const clip = { in: tk(10), out: tk(20), offset: tk(30), speed: 1, reverse: true }
    assert.equal(mediaSecToTimelineSec(clip, 12), 38,
      'reverse plays out -> in, so source 12 s sits 8 s into the clip')
  })

  await check('the mapping is clamped to the clip, never outside it', () => {
    const clip = { in: tk(10), out: tk(20), offset: tk(30), speed: 1 }
    assert.equal(mediaSecToTimelineSec(clip, 5), 30, 'before the source range is the clip start')
    assert.equal(mediaSecToTimelineSec(clip, 25), 40, 'past the source range is the clip end')
  })

  // 2. The branch that wrote the wrong unit, driven through the real loop.
  await check('a held picture parks the playhead on the TIMELINE second', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'trim.mp4', in: tk(10), out: tk(20), offset: tk(30) })
    const p = useTmcutPlayback()
    p.videoRef.value = deadElement(11)
    p.seek(31)
    p.videoRef.value!.currentTime = 11
    p.play()
    tick(16)
    assert.ok(Math.abs(p.playhead.value - 31) < 0.05,
      `playhead must hold at timeline 31 s, got ${p.playhead.value} (11 s is the media second)`)
    assert.equal(p.playhead.value > 30, true, 'a held picture must never fall back into source seconds')
    p.pause()
  })

  await check('a stalled picture parks the playhead on the TIMELINE second too', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'trim.mp4', in: tk(10), out: tk(20), offset: tk(30) })
    const p = useTmcutPlayback()
    p.videoRef.value = deadElement(11)
    p.seek(31)
    p.videoRef.value!.currentTime = 11
    p.play()
    tick(16) // first position is recorded
    tick(16) // same position again: the freeze clock starts here
    tick(3100) // ... and the budget is spent
    assert.equal(p.playbackStalled.value, true, 'the frozen budget has been spent')
    assert.ok(Math.abs(p.playhead.value - 31) < 0.05,
      `a stalled preview holds at timeline 31 s, got ${p.playhead.value}`)
    p.pause()
  })

  // 3. Source contract: the hold branch must go through the mapping, so a
  //    future edit cannot reintroduce the raw write next to it.
  await check('the hold branch writes the mapped value, never the raw plan answer', () => {
    const source = read('app/composables/useTmcutPlayback.ts')
    assert.match(source, /mediaSecToTimelineSec/,
      'the preview has no source->timeline mapping in its hold branch')
    assert.doesNotMatch(source, /playhead\.value = plan\.playheadSec/,
      'writing the plan\'s element second into the playhead is the reported bug')
  })

  console.log(`\n=== All ${passed} playhead-hold-unit checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
