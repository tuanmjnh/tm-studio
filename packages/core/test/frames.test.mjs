// @tmcut/core — frame plan tests (Roadmap C14). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filmstripTimes, frameTimesForSegments, clampFrameTime } from '../src/frames.mjs'
import { secToTicks } from '../src/time.mjs'

describe('frames (C14)', () => {
  it('filmstripTimes spreads count marks evenly inside the guarded range', () => {
    const times = filmstripTimes(0, 100_000, 8)
    assert.equal(times.length, 8)
    for (let index = 1; index < times.length; index++) {
      assert.ok(times[index] > times[index - 1])
      // Equal slice steps.
      assert.equal(times[index] - times[index - 1], times[1] - times[0])
    }
    // At least 2% away from both edges.
    assert.ok(times[0] >= 2_000)
    assert.ok(times[times.length - 1] <= 98_000)
    // Anchored to a non-zero start: same plan, shifted by the start.
    const shifted = filmstripTimes(500_000, 100_000, 4)
    assert.deepEqual(shifted, filmstripTimes(0, 100_000, 4).map(time => time + 500_000))
  })

  it('filmstripTimes refuses empty spans and bad counts', () => {
    assert.deepEqual(filmstripTimes(0, 0, 8), [])
    assert.deepEqual(filmstripTimes(0, -5, 8), [])
    assert.deepEqual(filmstripTimes(0, 100_000, 0), [])
    assert.deepEqual(filmstripTimes(0, 100_000, -3), [])
    assert.deepEqual(filmstripTimes(0, 100_000, NaN), [])
    assert.deepEqual(filmstripTimes(NaN, 100_000, 8), [])
    // Fractional counts floor to whole marks.
    assert.equal(filmstripTimes(0, 100_000, 8.9).length, 8)
  })

  it('frameTimesForSegments plans both clip shapes', () => {
    const plans = frameTimesForSegments([
      { id: 'clip_1', timeline: { start: secToTicks(10), duration: secToTicks(4) } },
      // Legacy v1 flat item: offset/in/out in SECONDS.
      { id: 'clip_2', offset: 2, in: 1, out: 5, speed: 2 },
      // Valid id, unusable span: keeps its slot with empty times.
      { id: 'clip_3', offset: 0, in: 3, out: 3 },
      // No id / not an object: dropped.
      { offset: 0, in: 0, out: 1 },
      null
    ], 3)
    assert.deepEqual(plans.map(plan => plan.id), ['clip_1', 'clip_2', 'clip_3'])
    assert.equal(plans[0].times.length, 3)
    for (const time of plans[0].times) {
      assert.ok(time >= secToTicks(10) && time <= secToTicks(14))
    }
    assert.equal(plans[1].times.length, 3)
    for (const time of plans[1].times) {
      assert.ok(time >= secToTicks(2) && time <= secToTicks(4))
    }
    assert.deepEqual(plans[2].times, [])
    assert.deepEqual(frameTimesForSegments('nope', 3), [])
  })

  it('clampFrameTime pins seek times into the segment range', () => {
    assert.equal(clampFrameTime(secToTicks(3), secToTicks(2), secToTicks(4)), secToTicks(3))
    assert.equal(clampFrameTime(secToTicks(-1), secToTicks(2), secToTicks(4)), secToTicks(2))
    assert.equal(clampFrameTime(secToTicks(99), secToTicks(2), secToTicks(4)), secToTicks(6))
    // Bad duration or time pins to the start.
    assert.equal(clampFrameTime(secToTicks(3), secToTicks(2), 0), secToTicks(2))
    assert.equal(clampFrameTime(NaN, secToTicks(2), secToTicks(4)), secToTicks(2))
    assert.equal(clampFrameTime(secToTicks(3), NaN, secToTicks(4)), 0)
  })
})
