// @tmcut/core — clock tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClock } from '../src/clock.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_2997 = { numerator: 30000, denominator: 1001 }

describe('createClock', () => {
  it('derives frame width from the rational rate', () => {
    const clock = createClock(RATE_30)
    assert.equal(clock.fps, 30)
    assert.equal(clock.ticksPerFrame, 4000)
    assert.equal(createClock(RATE_2997).ticksPerFrame, 4004)
  })

  it('maps ticks to frames on the same grid as ticksToFrames', () => {
    const clock = createClock(RATE_30)
    assert.equal(clock.frameIndexAt(0), 0)
    assert.equal(clock.frameIndexAt(3999), 0)
    assert.equal(clock.frameIndexAt(4000), 1)
    assert.equal(clock.frameIndexAt(8001), 2)
  })

  it('maps frame indices back to start ticks', () => {
    const clock = createClock(RATE_30)
    assert.equal(clock.frameStartAt(0), 0)
    assert.equal(clock.frameStartAt(2), 8000)
    assert.equal(clock.frameStartAt(1.9), 4000)
    assert.equal(clock.frameStartAt(-3), 0)
  })

  it('steps to the next frame boundary and snaps', () => {
    const clock = createClock(RATE_30)
    assert.equal(clock.nextFrameStart(0), 4000)
    assert.equal(clock.nextFrameStart(4000), 8000)
    assert.equal(clock.snap(4100), 4000)
    assert.equal(clock.snap(1999), 0)
    assert.equal(clock.snap(3999), 4000)
  })

  it('lists frame starts in a half-open span', () => {
    const clock = createClock(RATE_30)
    assert.deepEqual(clock.frameStarts(0, 8000), [0, 4000])
    assert.deepEqual(clock.frameStarts(4000, 4000), [])
    assert.deepEqual(clock.frameStarts(100, 7900), [4000])
    assert.deepEqual(clock.frameStarts(-500, 4000), [0])
  })

  it('counts partial frames when covering a duration', () => {
    const clock = createClock(RATE_30)
    assert.equal(clock.durationFrames(8000), 2)
    assert.equal(clock.durationFrames(8001), 3)
    assert.equal(clock.durationFrames(0), 0)
    assert.equal(clock.durationFrames(-10), 0)
  })

  it('keeps 29.97 whole-second spans on exact NTSC frame counts', () => {
    const clock = createClock(RATE_2997)
    const twoSeconds = 2 * TICKS_PER_SECOND
    const starts = clock.frameStarts(0, twoSeconds)
    assert.equal(starts.length, 60)
    assert.equal(starts[59], 59 * 4004)
    assert.equal(clock.durationFrames(twoSeconds), 60)
  })

  it('falls back to 30 fps for an invalid rate', () => {
    const clock = createClock({ numerator: 0, denominator: 0 })
    assert.equal(clock.fps, 30)
    assert.equal(clock.ticksPerFrame, 4000)
  })

  it('is frozen and deterministic', () => {
    const clock = createClock(RATE_30)
    assert.equal(Object.isFrozen(clock), true)
    assert.deepEqual(clock.frameStarts(0, 40000), createClock(RATE_30).frameStarts(0, 40000))
  })
})
