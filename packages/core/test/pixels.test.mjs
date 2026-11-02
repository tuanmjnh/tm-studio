// tmcut-core — golden-frame comparison tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_FRAME_COMPARE, compareFrames } from '../src/pixels.mjs'

function frame(pixels) {
  return Uint8Array.from(pixels.flat())
}

describe('compareFrames', () => {
  it('passes identical frames with zero error', () => {
    const rgba = [[10, 20, 30, 255], [40, 50, 60, 255]]
    const result = compareFrames(frame(rgba), frame(rgba))
    assert.equal(result.ok, true)
    assert.equal(result.meanAbsError, 0)
    assert.equal(result.maxChannelDelta, 0)
    assert.equal(result.differingPixels, 0)
    assert.equal(result.totalPixels, 2)
    assert.equal(result.diffRatio, 0)
  })

  it('averages error over every channel, alpha included', () => {
    const a = [[0, 0, 0, 0], [0, 0, 0, 0]]
    const b = [[1, 1, 1, 1], [1, 1, 1, 1]]
    const result = compareFrames(frame(a), frame(b))
    assert.equal(result.meanAbsError, 1)
    assert.equal(result.maxChannelDelta, 1)
    assert.equal(result.differingPixels, 2)
    assert.equal(result.diffRatio, 1)
    assert.equal(result.ok, false, 'ratio exceeds the default 0.1% budget')
  })

  it('counts a pixel once however many channels moved', () => {
    const a = [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]
    const b = [[255, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]
    const result = compareFrames(frame(a), frame(b))
    assert.equal(result.differingPixels, 1)
    assert.equal(result.diffRatio, 0.25)
    assert.equal(result.maxChannelDelta, 255)
    assert.equal(result.meanAbsError, 765 / 16)
  })

  it('ignores channel moves inside the per-channel tolerance', () => {
    const a = [[100, 100, 100, 255]]
    const b = [[105, 105, 105, 255]]
    const result = compareFrames(frame(a), frame(b), { channelTolerance: 8, meanTolerance: 4 })
    assert.equal(result.differingPixels, 0)
    assert.equal(result.diffRatio, 0)
    assert.equal(result.meanAbsError, 3.75)
    assert.equal(result.ok, true, 'no pixel counted as changed and mean is inside budget')
  })

  it('honours explicit mean and ratio budgets', () => {
    const a = [[0, 0, 0, 0], [0, 0, 0, 0]]
    const b = [[1, 1, 1, 1], [1, 1, 1, 1]]
    assert.equal(compareFrames(frame(a), frame(b), { meanTolerance: 1, diffRatioTolerance: 1 }).ok, true)
    assert.equal(compareFrames(frame(a), frame(b), { meanTolerance: 0.5, diffRatioTolerance: 1 }).ok, false)
  })

  it('accepts clamped arrays from ImageData', () => {
    const data = new Uint8ClampedArray([1, 2, 3, 4])
    assert.equal(compareFrames(data, data).ok, true)
    assert.equal(DEFAULT_FRAME_COMPARE.meanTolerance, 2)
    assert.equal(Object.isFrozen(DEFAULT_FRAME_COMPARE), true)
  })

  it('rejects malformed frames instead of guessing', () => {
    assert.throws(() => compareFrames([0, 0, 0, 0], frame([[0, 0, 0, 0]])), TypeError)
    assert.throws(() => compareFrames(frame([]), frame([])), TypeError)
    assert.throws(() => compareFrames(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), TypeError)
    assert.throws(
      () => compareFrames(frame([[0, 0, 0, 0]]), frame([[0, 0, 0, 0], [0, 0, 0, 0]])),
      TypeError
    )
  })
})
