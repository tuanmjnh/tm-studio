/**
 * One pace law for every live preview (Zero-FFmpeg slice F, req 6 — F6b).
 *
 * F6e moved the editor's playhead onto core's frame grid by writing the pace
 * inside `useTmcutPlayback`. The html-video studio runs its OWN loop — `tick()`
 * integrates `(now - lastFrameAt) / 1000` and adds it to a float — which is the
 * same law a second time, in a second host. Two copies is exactly what this
 * slice exists to retire, so the pace moves DOWN into core and both hosts call
 * it: the host still owns WHEN (it hands over the rAF timestamp), core owns
 * WHAT position that timestamp buys.
 *
 * The contract, in three sentences. A position is always a frame START on the
 * clock's grid — never a float between two frames. An interval only ever buys a
 * WHOLE number of frames, so a segment can leave up to one frame unspent but
 * never accumulates error. Anything the pace did not produce (a scrub, a jump,
 * a new rate, a play after a pause) re-arms the anchor instead of leaking the
 * interval it was carrying.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_frame_pace.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClock, createFramePace, fpsToRational } from 'tmcut-core'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

const clock30 = createClock(fpsToRational(30))
const PER = clock30.ticksPerFrame // 4000 ticks at 30 fps
const MS_PER_FRAME = 1000 / 30

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

async function main() {
  console.log('=== [TMCut frame pace] Starting ===\n')

  await check('every position the pace returns is a frame start', () => {
    const pace = createFramePace(clock30)
    let frame = 0
    // 14–20 ms intervals: the real rAF cadence measured on Chromium (:4003).
    for (let ms = 0; ms <= 2000; ms += 17) {
      const at = pace.at(ms, 1, frame)
      frame = at.frame
      assert.equal(at.startTicks % PER, 0, `t=${ms} ms landed between frames (${at.startTicks} ticks)`)
      assert.equal(at.startTicks, frame * PER, 'the frame and its position must agree')
    }
    assert.ok(Math.abs(frame - 60) <= 1, `2 s of wall clock paces 60 frames at 1x (got ${frame})`)
  })

  await check('a rate change re-arms: an interval spent at 1x is not re-spent at 8x', () => {
    const pace = createFramePace(clock30)
    const first = pace.at(0, 1, 0)
    assert.equal(first.frame, 0, 'the arming call moves nothing')
    const oneSecond = pace.at(1000, 1, first.frame)
    assert.ok(Math.abs(oneSecond.frame - 30) <= 1, `1 s at 1x = 30 frames (got ${oneSecond.frame})`)
    const switched = pace.at(1000, 8, oneSecond.frame)
    assert.equal(switched.frame, oneSecond.frame, 'the switch itself must not teleport the playhead')
    const sped = pace.at(1125, 8, switched.frame)
    assert.ok(Math.abs(sped.frame - 60) <= 1, `125 ms at 8x is one more timeline second (got ${sped.frame})`)
  })

  await check('a position the pace did not produce re-arms from there', () => {
    const pace = createFramePace(clock30)
    pace.at(0, 1, 0)
    const before = pace.at(MS_PER_FRAME * 10, 1, 0)
    assert.ok(before.frame > 0, 'the pace had moved')
    // A scrub lands the playhead on frame 100; the next interval counts from 100.
    const jumped = pace.at(MS_PER_FRAME * 10, 1, 100)
    assert.equal(jumped.frame, 100, 'the sought frame wins')
    assert.equal(jumped.startTicks, 100 * PER)
    const after = pace.at(MS_PER_FRAME * 10 + MS_PER_FRAME * 3, 1, 100)
    assert.ok(Math.abs(after.frame - 103) <= 1, `three frames past the scrub (got ${after.frame})`)
  })

  await check('reset disarms, so a paused interval is never replayed', () => {
    const pace = createFramePace(clock30)
    pace.at(0, 1, 0)
    const played = pace.at(1000, 1, 0)
    assert.ok(played.frame > 0, 'the segment paced')
    pace.reset()
    // The host was paused for four seconds; the first frame after resuming must
    // not spend them.
    const resumed = pace.at(5000, 1, played.frame)
    assert.equal(resumed.frame, played.frame, 'resuming starts the pace at the current frame')
    const next = pace.at(5000 + MS_PER_FRAME * 2, 1, resumed.frame)
    assert.ok(Math.abs(next.frame - played.frame - 2) <= 1, `only the new interval counts (got ${next.frame})`)
  })

  await check('reverse rides the same grid and clamps at the first frame', () => {
    const pace = createFramePace(clock30)
    pace.at(0, -1, 60)
    const back = pace.at(300, -1, 60)
    assert.equal(back.startTicks % PER, 0, 'a negative pace still lands on a frame start')
    assert.ok(Math.abs(back.frame - 51) <= 1, `300 ms back = 9 frames (got ${back.frame})`)
    const tail = pace.at(10_000, -1, back.frame)
    assert.equal(tail.frame, 0, 'reverse cannot walk off the beginning')
    assert.equal(tail.startTicks, 0)
  })

  await check('the position is measured from the anchor, never accumulated', () => {
    // The same wall interval delivered as 700 five-millisecond steps must buy
    // exactly what one clean call buys. A running float sum of the delivered
    // intervals cannot promise that; `anchor + f(elapsed)` can.
    const jagged = 3480
    const stepwise = createFramePace(clock30)
    stepwise.at(0, 1, 0)
    let frame = 0
    for (let ms = 5; ms <= jagged; ms += 5) frame = stepwise.at(ms, 1, frame).frame
    const single = createFramePace(clock30)
    single.at(0, 1, 0)
    const jumped = single.at(jagged, 1, 0).frame
    assert.equal(frame, jumped, `jittered delivery changed the position (${frame} vs ${jumped})`)
    assert.ok(Math.abs(frame - 104) <= 1, `3.48 s at 1x paces ~104 frames (got ${frame})`)
  })

  await check('both hosts read core pace instead of integrating the rAF interval', () => {
    const editor = read('app/composables/useTmcutPlayback.ts')
    const studio = read('app/components/tmcut/TmcutHtmlVideoStudio.vue')
    for (const [name, source] of [['editor', editor], ['studio', studio]] as const) {
      assert.match(source, /createFramePace/, `${name} must pace through core`)
      assert.doesNotMatch(source, /playhead\.value \+ delta|previewTime\.value \+ delta/,
        `${name} must not integrate a wall-clock interval into its position`)
      assert.doesNotMatch(source, /const delta = \w*[Ll]ast/,
        `${name} must not convert the rAF interval to seconds by itself`)
    }
    assert.doesNotMatch(editor, /elapsedTicks \* Math\.abs/,
      'and the ms→ticks→frames conversion belongs to core, not to a host')
  })

  await check('the studio scrub walks the clock, not hundredths of a second', () => {
    const studio = read('app/components/tmcut/TmcutHtmlVideoStudio.vue')
    assert.doesNotMatch(studio, /step="0\.01"/,
      'a 0.01 s slider asks the composition for times the rendered file never contains')
    assert.match(studio, /:max="lastPreviewFrame"/,
      'the scrub stops on the same frames the capture job paints')
  })

  console.log(`\n=== All ${passed} frame-pace checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
