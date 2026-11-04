// Slice E3 — how several channels of PCM become one level series.
//
// `silencedetect` looks at a whole stream, and a decoded `AudioBuffer` hands the
// app one Float32Array per channel. Which channel decides whether a window is
// quiet is therefore a decision both hosts must share: average them and a dead
// mic pulls a talking track down, take the first and a stereo file is judged by
// one microphone. Core takes the LOUDEST channel, so a window is only ever
// called quiet when nothing in it is audible.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TMCUT_SILENCE_FLOOR_DBFS, TMCUT_SILENCE_NOISE_DB, levelSeries, loudestLevelSeries } from '../src/detection.mjs'

const rate = 8000
/** `count` samples at a constant absolute amplitude. */
const tone = (amplitude, count) => new Float32Array(count).fill(amplitude)

describe('loudestLevelSeries', () => {
  it('is the loudest channel per window, not a mix of them', () => {
    // 0.5 -> -6.02 dBFS, 0.05 -> -26.02 dBFS: the quiet one must not pull it down.
    const levels = loudestLevelSeries([tone(0.05, 8000), tone(0.5, 8000)], rate, 1)
    assert.deepEqual(levels, [-6.02])
    assert.ok(levels[0] > TMCUT_SILENCE_NOISE_DB, 'so one dead channel cannot call audible content quiet')
  })

  it('is quiet only when every channel is quiet', () => {
    const levels = loudestLevelSeries([tone(0.0001, 8000), tone(0.0002, 8000)], rate, 1)
    assert.deepEqual(levels, [-73.98])
    assert.ok(levels[0] <= TMCUT_SILENCE_NOISE_DB)
  })

  it('agrees with levelSeries when there is one channel', () => {
    const samples = tone(0.25, 12345)
    assert.deepEqual(loudestLevelSeries([samples], rate, 0.5), levelSeries(samples, rate, 0.5))
  })

  it('keeps the short last window, the way levelSeries does', () => {
    // 1.25 s of 1 s windows: two levels, the second measured over a quarter.
    const levels = loudestLevelSeries([tone(0.5, 10000)], rate, 1)
    assert.equal(levels.length, 2)
    assert.deepEqual(levels, [-6.02, -6.02])
  })

  it('skips a channel that is not there instead of scoring it as silence', () => {
    const levels = loudestLevelSeries([null, tone(0.5, 8000), [], new Uint8Array(0)], rate, 1)
    assert.deepEqual(levels, [-6.02])
  })

  it('answers nothing when no channel was delivered', () => {
    assert.deepEqual(loudestLevelSeries([], rate, 1), [])
    assert.deepEqual(loudestLevelSeries([null, undefined], rate, 1), [])
    assert.deepEqual(loudestLevelSeries([tone(0.5, 8000)], 0, 1), [])
    assert.deepEqual(loudestLevelSeries([tone(0.5, 8000)], rate, -1), [])
  })

  it('gives digital silence the floor, and one loud channel the window', () => {
    assert.deepEqual(
      loudestLevelSeries([new Float32Array(8000), new Float32Array(8000)], rate, 1),
      [TMCUT_SILENCE_FLOOR_DBFS]
    )
    assert.deepEqual(
      loudestLevelSeries([new Float32Array(8000), tone(0.5, 8000)], rate, 1),
      [-6.02],
      'one audible channel is enough to make the window loud'
    )
  })
})
