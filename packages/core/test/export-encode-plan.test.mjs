// Slice H1 — the exporter asks, records, and refuses; it never guesses.
//
// Slice A measured that nothing in this repo can export without FFmpeg — the
// Phase-0 audit says it plainly: "không tồn tại đường export nào không cần
// FFmpeg trong repo hôm nay" — and ADR-030 names what replaces it: WebCodecs,
// but only after `VideoEncoder.isConfigSupported()` has been asked on the preset
// the runtime will actually encode, with the answer written down. That last
// clause is the whole reason these laws exist. A browser can report hardware
// H.264 on one machine and nothing on the next, so an exporter that assumes a
// codec either produces no file or silently produces a different one — and the
// export brief forbids both ("Unsupported config phải báo rõ, không tự đổi
// container/codec").
//
// Three decisions the loop would otherwise make in the IO layer, where they
// cannot be tested:
//
//  * WHICH preset to encode with. An unmeasured preset is not a supported one,
//    and an answer whose codec differs from the codec asked is a substitution,
//    not a success. The matrix of verdicts comes back even on success, because
//    the exit criterion is the recorded result, not just the chosen preset.
//  * WHEN each sample plays. A loop that reads the wall clock can never be
//    replayed, and a loop that divides by a float FPS drifts: 30 frames of
//    29.97 are 1.001 s, not 1.000 s and not 1.002 s. The answer comes from the
//    tick grid the preview already walks (clock.frameStartAt), converted once,
//    so audio and video cannot disagree — and the final partial frame is as
//    long as the content, not as long as a frame.
//  * HOW MANY frames may be in flight. `VideoFrame` holds a real buffer, so an
//    unbounded queue runs the tab out of memory mid-export; a limit of zero
//    that the loop honours deadlocks it before the first frame.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createClock } from '../src/clock.mjs'
import {
  DEFAULT_ENCODE_IN_FLIGHT,
  planEncodeConfig,
  planEncodeQueue,
  planEncodeSample
} from '../src/exportEncode.mjs'

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_2997 = { numerator: 30000, denominator: 1001 }

/** The shortest preset that can pass every shape rule. */
function preset(id, over = {}) {
  return {
    id,
    video: { codec: 'avc1.42001f', width: 1920, height: 1080, fps: RATE_30, bitrate: 4_000_000 },
    ...over
  }
}

function supported() {
  return { video: { supported: true, config: { codec: 'avc1.42001f' } } }
}

describe('planEncodeConfig — the preset comes from recorded answers, never from hope', () => {
  it('takes the first fully supported preset, in the order the caller prefers', () => {
    const plan = planEncodeConfig({
      presets: [preset('a'), preset('b')],
      answers: { a: supported(), b: supported() }
    })
    assert.equal(plan.kind, 'ready')
    assert.equal(plan.preset.id, 'a')
    assert.deepEqual(plan.config.video, {
      codec: 'avc1.42001f',
      width: 1920,
      height: 1080,
      fps: RATE_30,
      bitrate: 4_000_000
    })
  })

  it('a preset with a supported video and an unsupported audio is not supported', () => {
    const plan = planEncodeConfig({
      presets: [preset('a', { audio: { codec: 'mp4a.40.2', sampleRate: 48000, channelCount: 2 } }), preset('b')],
      answers: {
        a: { video: { supported: true, config: { codec: 'avc1.42001f' } }, audio: { supported: false } },
        b: supported()
      }
    })
    assert.equal(plan.kind, 'ready')
    assert.equal(plan.preset.id, 'b', 'the audio-less preset wins; a silent export is honest, a broken mix is not')
    assert.equal(plan.checked.find(row => row.id === 'a').verdict, 'unsupported')
  })

  it('names every preset still unmeasured instead of encoding on a guess', () => {
    const plan = planEncodeConfig({ presets: [preset('a'), preset('b')], answers: {} })
    assert.equal(plan.kind, 'refused')
    assert.equal(plan.reason, 'nothing-measured')
    assert.deepEqual(plan.checked.map(row => row.id), ['a', 'b'])
    assert.deepEqual(plan.checked.map(row => row.verdict), ['unmeasured', 'unmeasured'])
  })

  it('an unmeasured preset is never treated as the supported one', () => {
    const plan = planEncodeConfig({
      presets: [preset('a'), preset('b')],
      answers: { b: supported() }
    })
    assert.equal(plan.preset.id, 'b')
    assert.equal(plan.checked[0].verdict, 'unmeasured')
  })

  it('refuses when the runtime swapped the codec it was asked about', () => {
    const plan = planEncodeConfig({
      presets: [preset('a')],
      answers: { a: { video: { supported: true, config: { codec: 'vp09.00.10.08' } } } }
    })
    assert.equal(plan.kind, 'refused')
    assert.equal(plan.reason, 'nothing-supported')
    assert.equal(plan.checked[0].verdict, 'substituted')
    assert.match(plan.checked[0].reasons[0], /avc1\.42001f/)
    assert.match(plan.checked[0].reasons[0], /vp09\.00\.10\.08/, 'the report must say what the runtime actually answered')
  })

  it('kills an odd height before the answer matters, naming the chroma law', () => {
    const plan = planEncodeConfig({
      presets: [preset('a', { video: { ...preset('a').video, height: 1081 } })],
      answers: { a: supported() }
    })
    assert.equal(plan.kind, 'refused')
    assert.equal(plan.checked[0].verdict, 'invalid')
    assert.match(plan.checked[0].reasons.join(' '), /height/)
    assert.match(plan.checked[0].reasons.join(' '), /subsamples chroma 2x2/)
  })

  it('rejects a preset with no usable frame rate', () => {
    const plan = planEncodeConfig({
      presets: [preset('a', { video: { ...preset('a').video, fps: { numerator: 0, denominator: 1 } } })],
      answers: { a: supported() }
    })
    assert.equal(plan.checked[0].verdict, 'invalid')
    assert.match(plan.checked[0].reasons.join(' '), /fps/)
  })

  it('says what it was given when the preset list itself is empty', () => {
    assert.deepEqual(
      { kind: planEncodeConfig({ presets: [], answers: {} }).kind, reason: planEncodeConfig({ presets: [], answers: {} }).reason },
      { kind: 'refused', reason: 'no-presets' }
    )
  })

  it('carries the verdict matrix even on success, because the matrix is the deliverable', () => {
    const plan = planEncodeConfig({
      presets: [preset('a'), preset('b')],
      answers: { a: { video: { supported: false } }, b: supported() }
    })
    assert.equal(plan.kind, 'ready')
    assert.deepEqual(plan.checked.map(row => `${row.id}:${row.verdict}`), ['a:unsupported', 'b:supported'])
  })
})

describe('planEncodeSample — a timestamp is the frame index, in the muxer timebase', () => {
  it('answers whole microseconds for a whole frame', () => {
    assert.deepEqual(
      planEncodeSample({ index: 3, rate: RATE_30, contentEndTicks: 120_000, timescale: 1_000_000 }),
      { timestamp: 100_000, duration: 33_333, isLast: false }
    )
  })

  it('keeps 29.97 exact where a float FPS drifts', () => {
    // The trap the app currently ships: `canvasFpsValue` rounds 30000/1001 to
    // 29.97 and every consumer divides by that. Frame 30 is 1.001 s, not 1 s.
    const at = index => planEncodeSample({
      index,
      rate: RATE_2997,
      contentEndTicks: 120_000 * 60,
      timescale: 1_000_000
    }).timestamp
    assert.equal(at(30), 1_001_000)
    assert.equal(at(600), 20_020_000)
    assert.equal(at(0), 0)
  })

  it('sizes a frame so the durations always add up to the timeline', () => {
    // One frame of 29.97 is 33367 µs sometimes and 33366 µs sometimes; a law
    // that repeats one number drifts a full second in half an hour.
    const at = index => planEncodeSample({
      index,
      rate: RATE_2997,
      contentEndTicks: 120_000 * 60,
      timescale: 1_000_000
    }).duration
    assert.deepEqual(
      [at(0), at(1), at(2)].map(value => (value === 33_367 || value === 33_366) ? 'ok' : value),
      ['ok', 'ok', 'ok'],
      'the frame width alternates, it does not accumulate'
    )
    let total = 0
    for (let index = 0; index < 300; index++) total += at(index)
    assert.equal(total, 10_010_000, '300 frames of 29.97 are exactly 10.01 s')
  })

  it('converts to any muxer timescale without re-deriving the grid', () => {
    const plan = planEncodeSample({ index: 30, rate: RATE_30, contentEndTicks: 120_000 * 60, timescale: 90_000 })
    assert.deepEqual(plan, { timestamp: 90_000, duration: 3_000, isLast: false })
  })

  it('gives the last frame the length of the content, not the length of a frame', () => {
    // A project that ends 100 ticks into a frame is 833 µs of picture, and a
    // muxer told otherwise writes a file longer than the timeline.
    const clock = createClock(RATE_30)
    const plan = planEncodeSample({
      index: 960,
      rate: RATE_30,
      contentEndTicks: clock.frameStartAt(960) + 100,
      timescale: 1_000_000
    })
    assert.equal(plan.isLast, true)
    assert.equal(plan.duration, 833)
  })

  it('returns nothing for an index outside the sequence', () => {
    // A positive control in the same block: a law that answers null to
    // everything would pass this test otherwise.
    assert.deepEqual(planEncodeSample({ index: 29, rate: RATE_30, contentEndTicks: 120_000 }), {
      timestamp: 966_667,
      duration: 33_333,
      isLast: true
    })
    assert.equal(planEncodeSample({ index: -1, rate: RATE_30, contentEndTicks: 120_000 }), null)
    assert.equal(planEncodeSample({ index: 30, rate: RATE_30, contentEndTicks: 120_000 }), null, 'a 1 s project has no frame 30')
    assert.equal(planEncodeSample({ index: 0, rate: RATE_30, contentEndTicks: 0 }), null, 'an empty project muxes nothing')
    assert.equal(planEncodeSample({ index: 0, rate: null, contentEndTicks: 120_000 }), null)
    assert.equal(planEncodeSample({ index: 0, rate: RATE_30, contentEndTicks: Number.NaN }), null)
    assert.equal(planEncodeSample({ index: 0, rate: { numerator: 30, denominator: 0 }, contentEndTicks: 120_000 }), null)
  })

  it('never answers a sample that occupies no time', () => {
    // 4001 ticks at 30 fps is one whole frame plus one tick. At a coarse
    // timescale the tail cannot name a unit, and the honest answer is "no
    // sample here" — not a zero-length packet a player cannot place.
    const plan = planEncodeSample({ index: 0, rate: RATE_30, contentEndTicks: 4001, timescale: 1000 })
    assert.deepEqual(plan, { timestamp: 0, duration: 33, isLast: true })
    assert.equal(planEncodeSample({ index: 1, rate: RATE_30, contentEndTicks: 4001, timescale: 1000 }), null)
  })
})

describe('planEncodeQueue — in-flight frames are bounded, and the bound cannot deadlock', () => {
  it('pushes while under the limit and holds at it', () => {
    assert.equal(planEncodeQueue({ inFlight: 0, limit: 4 }).action, 'push')
    assert.equal(planEncodeQueue({ inFlight: 3, limit: 4 }).action, 'push')
    assert.equal(planEncodeQueue({ inFlight: 4, limit: 4 }).action, 'wait')
    assert.equal(planEncodeQueue({ inFlight: 9, limit: 4 }).action, 'wait')
  })

  it('a limit of zero falls back to the default instead of waiting forever', () => {
    const plan = planEncodeQueue({ inFlight: 0, limit: 0 })
    assert.equal(plan.limit, DEFAULT_ENCODE_IN_FLIGHT)
    assert.equal(plan.action, 'push', 'a loop told to wait for a free slot that can never exist never encodes a frame')
    assert.equal(planEncodeQueue({ inFlight: DEFAULT_ENCODE_IN_FLIGHT, limit: -3 }).action, 'wait')
  })

  it('treats a negative in-flight count as empty, not as permission to overflow', () => {
    assert.equal(planEncodeQueue({ inFlight: -5, limit: 2 }).outstanding, 0)
    assert.equal(planEncodeQueue({ inFlight: -5, limit: 2 }).action, 'push')
  })

  it('says how much room is left, so the caller can batch instead of polling per frame', () => {
    assert.equal(planEncodeQueue({ inFlight: 1, limit: 4 }).room, 3)
    assert.equal(planEncodeQueue({ inFlight: 4, limit: 4 }).room, 0)
  })
})
