// Slice E4 — what one window of sound is MEASURED by.
//
// "-30 dB" has meant the same number in AutoCut since the first FFmpeg pass, but
// the number only means something with a metric attached to it. FFmpeg's
// `silencedetect` tests every SAMPLE: one sample over the level ends the silence.
// A window reduced to its energy does not — measured on a fixture of one click at
// -29.0 dBFS inside a field whose energy is -56.3 dBFS, FFmpeg said "loud" and an
// energy window said "silence". So core measures the loudest sample of the
// window, which is the same question FFmpeg asked, and the window got smaller for
// the second half of the answer: a 0.5 s window cannot tell where a sentence ends.
//
// The numbers this file pins were chosen on the real-voice table in
// docs/audit/zero-ffmpeg-audit.md (peak-0.02: 0.00 s false silence, <= 0.13 s
// missed per 120 s of podcast, edge error 7 ms mean / 16 ms worst).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TMCUT_SILENCE_FLOOR_DBFS,
  TMCUT_SILENCE_NOISE_DB,
  TMCUT_SILENCE_WINDOW_SEC,
  loudestPeakSeries,
  peakLevelSeries,
  silenceSpans
} from '../src/detection.mjs'

const rate = 100

/** `count` samples of one value. */
const run = (value, count) => new Float32Array(count).fill(value)
/** A quiet window carrying exactly one loud sample — the click FFmpeg hears. */
function clickWindow(amplitude, count = rate) {
  const samples = new Float32Array(count)
  samples[Math.floor(count / 2)] = amplitude
  return samples
}

describe('peakLevelSeries', () => {
  it('is the loudest sample of the window, not its energy', () => {
    // One sample at 0.0355 (-29 dBFS) among 99 zeros. The energy of that window
    // is a tenth of it: -49 dBFS, which is quiet. The click is not.
    const levels = peakLevelSeries(clickWindow(0.0355), rate, 1)
    assert.deepEqual(levels, [-29])
    assert.ok(levels[0] > TMCUT_SILENCE_NOISE_DB, 'so one click inside a gap is not silence')
    assert.ok(dbfsOfEnergy(clickWindow(0.0355)) < TMCUT_SILENCE_NOISE_DB,
      'and the energy law we replaced would have called it silence')
  })

  it('is 0 dBFS for a full-scale window and the floor for digital silence', () => {
    assert.deepEqual(peakLevelSeries(run(1, rate), rate, 1), [0])
    assert.deepEqual(peakLevelSeries(run(-1, rate), rate, 1), [0], 'magnitude, so polarity is not a level')
    assert.deepEqual(peakLevelSeries(run(0.5, rate), rate, 1), [-6.02])
    assert.deepEqual(peakLevelSeries(run(0, rate), rate, 1), [TMCUT_SILENCE_FLOOR_DBFS])
  })

  it('keeps the short last window, like the series before it', () => {
    const levels = peakLevelSeries(run(0.5, 125), rate, 1)
    assert.equal(levels.length, 2)
    assert.deepEqual(levels, [-6.02, -6.02])
  })

  it('measures the calibrated 20 ms window by default', () => {
    assert.equal(TMCUT_SILENCE_WINDOW_SEC, 0.02)
    assert.ok(TMCUT_SILENCE_WINDOW_SEC < 0.5,
      'a window wider than a word cannot place the end of a sentence')
    // 100 samples at 100 Hz is one second; a 20 ms window is two samples, so fifty levels.
    assert.equal(peakLevelSeries(run(0.5, rate), rate).length, 50)
  })

  it('answers nothing for input it cannot measure', () => {
    assert.deepEqual(peakLevelSeries([], rate, 1), [])
    assert.deepEqual(peakLevelSeries(null, rate, 1), [])
    assert.deepEqual(peakLevelSeries(run(1, rate), 0, 1), [])
    assert.deepEqual(peakLevelSeries(run(1, rate), rate, 0), [])
  })

  it('ignores a sample that is not a number instead of hearing silence in it', () => {
    // NaN at the head of the window, a real click behind it: the click still
    // decides, because a hole is not a measurement.
    const samples = clickWindow(0.5, rate)
    samples[0] = Number.NaN
    assert.deepEqual(peakLevelSeries(samples, rate, 1), [-6.02])
    assert.deepEqual(peakLevelSeries(new Float32Array([Number.NaN, Number.NaN]), rate, 1),
      [TMCUT_SILENCE_FLOOR_DBFS])
  })
})

describe('loudestPeakSeries', () => {
  it('takes the loudest channel per window, so a dead one cannot add silence', () => {
    // 0.0001 (-80 dBFS) and one click at -29 dBFS: the quiet channel must not
    // win the window it shares with the click.
    const channels = [clickWindow(0.0001, rate), clickWindow(0.0355, rate)]
    assert.deepEqual(loudestPeakSeries(channels, rate, 1), [-29])
  })

  it('agrees with peakLevelSeries for one channel', () => {
    const samples = run(0.25, 125)
    assert.deepEqual(loudestPeakSeries([samples], rate, 1), peakLevelSeries(samples, rate, 1))
  })

  it('skips a channel that was not delivered', () => {
    assert.deepEqual(loudestPeakSeries([null, run(0.5, rate), []], rate, 1), [-6.02])
    assert.deepEqual(loudestPeakSeries([null, undefined], rate, 1), [])
  })
})

describe('silenceSpans on the peak law', () => {
  it('does not swallow a click at the head of a quiet run', () => {
    // 4 s: one click window, then three seconds of nothing. Only the last three
    // seconds are silence; the click's window is not, and neither is the run
    // that would have started at it.
    const samples = new Float32Array(4 * rate)
    samples[Math.floor(rate / 2)] = 0.0355
    const levels = peakLevelSeries(samples, rate, 1)
    assert.deepEqual(
      silenceSpans(levels, { windowSec: 1, noiseDb: -30, minDurationSec: 1, durationSec: 4 }),
      [{ start: 1, end: 4 }]
    )
  })

  it('defaults its window to the same 20 ms the series was built on', () => {
    const levels = peakLevelSeries(run(0.0001, rate), rate)
    assert.equal(levels.length, 50)
    assert.deepEqual(
      silenceSpans(levels, { noiseDb: -30, minDurationSec: 0.5, durationSec: 1 }),
      [{ start: 0, end: 1 }]
    )
  })
})

/** The energy of a window as dBFS — the law this slice retired, kept here to prove the difference. */
function dbfsOfEnergy(samples) {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  const rms = Math.sqrt(sum / samples.length)
  return rms > 0 ? Math.round(20 * Math.log10(rms) * 100) / 100 : TMCUT_SILENCE_FLOOR_DBFS
}
