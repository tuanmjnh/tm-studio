// Slice G1 — the shape a waveform is STORED in, and what decodes it.
//
// `int16ToPeaks` divides by 32768 because the thing that fed it for four years was
// FFmpeg's `-f s16le` pipe (electron/tools/tmcut.controller.cjs:429-443). The zero-
// FFmpeg path feeds it something else: `decodePcm` (app/utils/tmcut/audioDecode.ts)
// hands back Float32 in −1..1, and 0.5 / 32768 is a flat line. So the reducer for
// the new path is written for the new scale, and the old one keeps its promise to
// the old input.
//
// The second half of the file is the cache envelope: a waveform that cannot say
// which algorithm produced it cannot be re-read after an app version changes, and
// one that caches `[]` for a decode that FAILED is worse than no cache — the
// controller did exactly that (ok:true with zeros, :422-427) and the panel drew
// silence for a file it never managed to open. Three states, therefore:
// silent has bars of zero height, no audio track has channelCount 0, and a failed
// decode stores nothing at all.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TMCUT_WAVEFORM_ALGORITHM,
  TMCUT_WAVEFORM_PEAK_PRECISION,
  buildWaveformPayload,
  clampWaveformPoints,
  floatPeakBuckets,
  int16ToPeaks,
  readWaveformPayload
} from '../src/waveform.mjs'

const rate = 100

/** `count` samples of one value, on the float scale `decodePcm` returns. */
const run = (value, count) => Float32Array.from({ length: count }, () => value)
/** One window carrying exactly one loud sample. */
function clickWindow(amplitude, count = rate) {
  const samples = new Float32Array(count)
  samples[Math.floor(count / 2)] = amplitude
  return samples
}

describe('floatPeakBuckets', () => {
  it('reads full scale as 1, not as 1/32768', () => {
    const peaks = floatPeakBuckets([new Float32Array([0, 0.5, -0.25, 0.1])], 2)
    assert.deepEqual(peaks, [0.5, 0.25], 'magnitude, so polarity is not a height')
    // The trap this exists to avoid: the int16 reducer on the same input.
    const flat = int16ToPeaks(new Float32Array([0, 0.5, -0.25, 0.1]), 2)
    assert.ok(flat[0] < 1e-4, 'and the old reducer really does draw a flat line here')
  })

  it('is 1 for a full-scale window and 0 for digital silence', () => {
    assert.deepEqual(floatPeakBuckets([run(1, rate)], 1), [1])
    assert.deepEqual(floatPeakBuckets([run(-1, rate)], 1), [1])
    assert.deepEqual(floatPeakBuckets([run(0, rate)], 1), [0])
    assert.deepEqual(floatPeakBuckets([run(0.5, rate)], 1), [0.5])
  })

  it('folds channels by the loudest one, like the silence law does', () => {
    // Averaging would halve a hot left channel; RMS would shrink it too. The
    // timeline shows how loud the file gets, so the loudest channel wins.
    assert.deepEqual(floatPeakBuckets([run(1, rate), run(0, rate)], 1), [1])
    assert.deepEqual(floatPeakBuckets([clickWindow(0.0001, rate), clickWindow(0.5, rate)], 1), [0.5])
  })

  it('agrees with int16ToPeaks once the int16 scale is applied', () => {
    const asInt16 = Int16Array.from([0, 16384, -32768, 8192])
    const asFloat = Float32Array.from([0, 0.5, -1, 0.25])
    assert.deepEqual(floatPeakBuckets([asFloat], 2), int16ToPeaks(asInt16, 2))
  })

  it('keeps the short last window and pads a missing one', () => {
    assert.equal(floatPeakBuckets([run(0.5, 125)], 2).length, 2)
    assert.deepEqual(floatPeakBuckets([run(0.5, 125)], 2), [0.5, 0.5])
    // 3 samples across 4 buckets cannot fill four: a bucket with no sample is 0.
    assert.equal(floatPeakBuckets([run(0.5, 3)], 4).length, 4)
  })

  it('ignores a sample that is not a number instead of drawing silence in it', () => {
    const samples = clickWindow(0.5, rate)
    samples[0] = Number.NaN
    assert.deepEqual(floatPeakBuckets([samples], 1), [0.5])
    assert.deepEqual(floatPeakBuckets([new Float32Array([Number.NaN, Infinity])], 1), [0],
      'a window of nothing measurable has no height, but still answers')
  })

  it('answers zeros, never a crash, for input it cannot measure', () => {
    assert.deepEqual(floatPeakBuckets([], 4), [0, 0, 0, 0])
    assert.deepEqual(floatPeakBuckets(null, 4), [0, 0, 0, 0])
    assert.deepEqual(floatPeakBuckets([null, undefined, []], 1), [0])
    assert.equal(floatPeakBuckets([run(0.5, rate)], 0).length, 1, 'at least one bucket')
    assert.equal(floatPeakBuckets([run(0.5, rate)]).length, 200, 'and the timeline default')
  })

  it('clamps an input that claims more than full scale', () => {
    assert.deepEqual(floatPeakBuckets([run(4, rate)], 1), [1], 'a bar has no height above the frame')
    assert.deepEqual(floatPeakBuckets([run(-4, rate)], 1), [1])
  })
})

describe('buildWaveformPayload', () => {
  const peaks = [0.1, 0.2, 0.3]

  it('stamps what it measured so a re-read can tell who measured it', () => {
    const payload = buildWaveformPayload({ peaks, sampleRate: 8000, channelCount: 1, durationSec: 12.5 })
    assert.equal(payload.algorithm, TMCUT_WAVEFORM_ALGORITHM)
    assert.equal(payload.bucketCount, 3)
    assert.equal(payload.sampleRate, 8000)
    assert.equal(payload.channelCount, 1)
    assert.equal(payload.durationSec, 12.5)
    assert.deepEqual(payload.peaks, peaks)
    assert.ok(Object.isFrozen(payload), 'a cached answer is not something the app may edit')
  })

  it('rounds the bars to the precision it declares and no finer', () => {
    const payload = buildWaveformPayload({ peaks: [0.12349, 0.987654], sampleRate: 8000, channelCount: 1, durationSec: 1 })
    assert.deepEqual(payload.peaks, [0.123, 0.988])
    assert.equal(TMCUT_WAVEFORM_PEAK_PRECISION, 3)
    for (const p of payload.peaks) {
      assert.equal(p, Math.round(p * 1000) / 1000, 'stored to three decimals, so the artifact stays small')
    }
  })

  it('refuses to be written for input that is not a waveform', () => {
    // Each null here is the producer saying "store nothing", which is the third
    // state the controller used to collapse into `ok:true` with zeros.
    assert.equal(buildWaveformPayload({ peaks: [], sampleRate: 8000, channelCount: 1, durationSec: 1 }), null)
    assert.equal(buildWaveformPayload({ peaks: null, sampleRate: 8000, channelCount: 1, durationSec: 1 }), null)
    assert.equal(buildWaveformPayload({ peaks: '0.1,0.2', sampleRate: 8000, channelCount: 1, durationSec: 1 }), null)
    assert.equal(buildWaveformPayload({ peaks: [0.1, Number.NaN], sampleRate: 8000, channelCount: 1, durationSec: 1 }), null)
    assert.equal(buildWaveformPayload({ peaks, sampleRate: 8000, channelCount: 1, durationSec: 0 }), null,
      'a zero-length file has no timeline to draw on')
    assert.equal(buildWaveformPayload({ peaks, sampleRate: 8000, channelCount: 1, durationSec: Number.NaN }), null)
    assert.equal(buildWaveformPayload({ peaks, sampleRate: 8000, channelCount: 1.5, durationSec: 1 }), null)
    assert.equal(buildWaveformPayload({ peaks, sampleRate: 8000, channelCount: -1, durationSec: 1 }), null)
    assert.equal(buildWaveformPayload(null), null)
  })

  it('still writes a silent track, because silence is a measurement', () => {
    const payload = buildWaveformPayload({ peaks: [0, 0, 0], sampleRate: 8000, channelCount: 1, durationSec: 3 })
    assert.deepEqual(payload.peaks, [0, 0, 0])
    assert.equal(payload.channelCount, 1, 'one channel that decoded to nothing')
  })

  it('lets "no audio track at all" say so', () => {
    const payload = buildWaveformPayload({ peaks: [0], sampleRate: 0, channelCount: 0, durationSec: 3 })
    assert.equal(payload.channelCount, 0)
    assert.equal(payload.sampleRate, 0)
  })
})

describe('readWaveformPayload', () => {
  it('reads back what was written', () => {
    const payload = buildWaveformPayload({ peaks: [0.5, 0.25], sampleRate: 8000, channelCount: 2, durationSec: 4 })
    assert.deepEqual(readWaveformPayload(payload), payload)
    assert.deepEqual(readWaveformPayload(JSON.parse(JSON.stringify(payload))), payload,
      'the cache round-trips through JSON without losing the stamp')
  })

  it('rejects a payload it did not write, and any shape that could not be one', () => {
    const good = buildWaveformPayload({ peaks: [0.5], sampleRate: 8000, channelCount: 1, durationSec: 1 })
    assert.equal(readWaveformPayload({ ...good, algorithm: 'rms-v2' }), null,
      'a different metric is not the same bars')
    assert.equal(readWaveformPayload({ ...good, algorithm: 'peak-v0' }), null)
    assert.equal(readWaveformPayload({ ...good, peaks: [] }), null, 'empty is not silence')
    assert.equal(readWaveformPayload({ ...good, peaks: [0.5, Number.NaN] }), null)
    assert.equal(readWaveformPayload({ ...good, durationSec: -1 }), null)
    assert.equal(readWaveformPayload({ ...good, channelCount: 'mono' }), null)
    assert.equal(readWaveformPayload({ ...good, bucketCount: 9 }), null,
      'the count it claims must match the bars it carries')
    assert.equal(readWaveformPayload(null), null)
    assert.equal(readWaveformPayload(undefined), null)
    assert.equal(readWaveformPayload([]), null)
    assert.equal(readWaveformPayload('peak-v1'), null)
    assert.equal(readWaveformPayload({ peaks: [0.5] }), null, 'an unstamped record is not a waveform')
    assert.equal(readWaveformPayload(good.peaks), null, 'the bars alone are not the artifact')
  })

  it('clamps a bar that escaped the frame instead of discarding the row', () => {
    const read = readWaveformPayload({ ...buildWaveformPayload({ peaks: [0.5], sampleRate: 8000, channelCount: 1, durationSec: 1 }), peaks: [1.8] })
    assert.deepEqual(read.peaks, [1], 'one bad bar is not a reason to re-decode the file')
  })

  it('keeps the reducer honest about the clamp it already applies', () => {
    assert.deepEqual(clampWaveformPoints([1.8, -0.2, 0.4]), [1, 0, 0.4])
  })
})
