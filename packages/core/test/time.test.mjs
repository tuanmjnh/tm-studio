// @tmcut/core — time tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TICKS_PER_SECOND,
  secToTicks,
  ticksToSec,
  fpsToRational,
  rationalToFloat,
  ticksPerFrame,
  snapToFrame,
  ticksToFrames,
  formatTimecode
} from '../src/time.mjs'

describe('time', () => {
  it('uses 120000 ticks per second', () => {
    assert.equal(TICKS_PER_SECOND, 120_000)
    assert.equal(secToTicks(1), 120_000)
    assert.equal(secToTicks(0.5), 60_000)
    assert.equal(ticksToSec(60_000), 0.5)
  })

  it('clamps invalid inputs to zero', () => {
    assert.equal(secToTicks(NaN), 0)
    assert.equal(secToTicks(-3), 0)
    assert.equal(ticksToSec(Infinity), 0)
  })

  it('maps known frame rates to rationals', () => {
    assert.deepEqual(fpsToRational(30), { numerator: 30, denominator: 1 })
    assert.deepEqual(fpsToRational(29.97), { numerator: 30000, denominator: 1001 })
    assert.deepEqual(fpsToRational(23.976), { numerator: 24000, denominator: 1001 })
    assert.equal(rationalToFloat({ numerator: 30000, denominator: 1001 }), 30000 / 1001)
  })

  it('falls back safely for unknown fps', () => {
    assert.deepEqual(fpsToRational(0), { numerator: 30, denominator: 1 })
    assert.deepEqual(fpsToRational(48), { numerator: 48000, denominator: 1000 })
    assert.equal(rationalToFloat(fpsToRational(48)), 48)
  })

  it('converts between ticks and frames', () => {
    const rate = { numerator: 30, denominator: 1 }
    assert.equal(ticksPerFrame(rate), 4000)
    assert.equal(ticksToFrames(secToTicks(2.5), rate), 75)
    assert.equal(snapToFrame(4100, rate), 4000)
    assert.equal(snapToFrame(200, rate), 0)
  })

  it('formats timecodes', () => {
    const rate = { numerator: 30, denominator: 1 }
    assert.equal(formatTimecode(0, rate), '00:00:00')
    assert.equal(formatTimecode(secToTicks(65.5), rate), '01:05:15')
    assert.equal(formatTimecode(secToTicks(3723), { numerator: 25, denominator: 1 }), '01:02:03:00')
  })
})
