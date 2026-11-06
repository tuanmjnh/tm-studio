// tmcut-core — the samples one export packet holds. Run: node --test test/
//
// `audioMixAt.mjs` answers WHICH layers sound at one tick, at what gain, at what
// position in their own file and at what rate — and its own header says it never
// sums a sample. `exportEncode.mjs` answers how many samples one packet is and
// where it sits on the clock. Nothing in between answered the question the first
// real exporter has to answer on every one of its ~47 packets per second of file:
// what are the numbers?
//
// That is a law with four parts, and each part has a way to be wrong that the
// screen cannot show:
//
//  - POSITION. A packet reads media from `mediaTicks` — the evaluator's own
//    number, so trim and a speed ramp are already folded into it — plus `rate`
//    times the seconds since the tick that produced it. Reading from `mediaTicks`
//    as if it were a *packet-relative* offset is what makes a bed that starts at
//    30 s play its first second forever, and re-deriving the position from the
//    clip's stored `in` splits it from the picture, which is the drift
//    `audioMix.mjs` was written to stop.
//  - RATE. `rate` multiplies elapsed timeline seconds, so 2x advances through the
//    file twice as fast. Half-open at both ends, like the window ADR-018 adopted.
//  - RESAMPLE. `AudioBufferSink` has no sample-rate option: a decoder hands over
//    the media's native rate, and `ENCODE_AUDIO_REQUEST` asks 48 kHz. Interpolation
//    is linear against an absolute media second, so consecutive packets line up
//    exactly instead of stepping at a boundary.
//  - GAIN and SUM. One source's contribution is its samples times its own gain;
//    several sources add. No normalisation: the preview's Web Audio graph adds too,
//    so a quieter export would be a file that sounds different from the screen.
//
// Refusals are named, never dropped silently: `audioMixAt` marks a reversed
// source `plays: false`, and a clip whose bytes are not in the client cache has no
// PCM to read. Both must show up in the answer rather than as an unexplained hole.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '../src/time.mjs'
import { ENCODE_AUDIO_REQUEST } from '../src/exportContent.mjs'
import { planExportMixPacket, EXPORT_MIX_REFUSALS } from '../src/exportMix.mjs'

const T = TICKS_PER_SECOND
const RATE_48 = 48_000

/** `frames` samples of an exact linear ramp, which interpolation reproduces exactly. */
function ramp(length, step = 1) {
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index++) samples[index] = index * step
  return samples
}

/** One source shaped like `audioMixAt`'s answer, with PCM hung off it. */
function source(overrides = {}) {
  return {
    role: 'audio',
    clipId: 'a1',
    trackId: 't1',
    trackIndex: 0,
    gain: 1,
    mediaTicks: 0,
    rate: 1,
    plays: true,
    refusal: null,
    channels: [ramp(RATE_48 * 4), ramp(RATE_48 * 4)],
    sampleRate: RATE_48,
    ...overrides
  }
}

function packet(input) {
  return planExportMixPacket({ frames: 4, startSample: 0, at: 0, sources: [source()], ...input })
}

describe('planExportMixPacket — the position law', () => {
  it('reads from mediaTicks, not from the start of the file', () => {
    const answer = packet({ sources: [source({ mediaTicks: T })] })
    assert.deepEqual(Array.from(answer.channels[0]), [RATE_48, RATE_48 + 1, RATE_48 + 2, RATE_48 + 3])
  })

  it('advances through the media at the source rate from the tick that produced it', () => {
    const answer = packet({ sources: [source({ mediaTicks: T, rate: 2 })] })
    assert.deepEqual(Array.from(answer.channels[0]), [RATE_48, RATE_48 + 2, RATE_48 + 4, RATE_48 + 6])
  })

  it('measures elapsed seconds against the evaluation tick, not against zero', () => {
    const answer = packet({ at: T, startSample: RATE_48, sources: [source({ mediaTicks: 2 * T })] })
    assert.deepEqual(Array.from(answer.channels[0]), [2 * RATE_48, 2 * RATE_48 + 1, 2 * RATE_48 + 2, 2 * RATE_48 + 3])
  })

  it('gives two consecutive packets the same run the one double packet would', () => {
    const halves = [0, 1].map(index => packet({ startSample: index * 4, sources: [source({ mediaTicks: T / 3 })] }))
    const whole = packet({ frames: 8, sources: [source({ mediaTicks: T / 3 })] })
    assert.deepEqual(
      [...Array.from(halves[0].channels[0]), ...Array.from(halves[1].channels[0])],
      Array.from(whole.channels[0])
    )
  })

  it('reads a tap past the end of the media as zero, so a run ends instead of looping', () => {
    const tail = { target: { sampleRate: 4, channelCount: 2 }, sources: [source({ channels: [ramp(3), ramp(3)], sampleRate: 1, mediaTicks: 2 * T })] }
    assert.deepEqual(Array.from(packet(tail).channels[0]), [2, 1.5, 1, 0.5])
  })

  it('answers silence once the whole window is past the end of the media', () => {
    const past = { target: { sampleRate: 4, channelCount: 2 }, sources: [source({ channels: [ramp(3), ramp(3)], sampleRate: 1, mediaTicks: 3 * T })] }
    const answer = packet(past)
    assert.deepEqual(Array.from(answer.channels[0]), [0, 0, 0, 0])
    assert.deepEqual(answer.mixed.map(entry => entry.clipId), ['a1'])
  })
})

describe('planExportMixPacket — the resample law', () => {
  it('interpolates a 24 kHz media run into the 48 kHz the file asks for', () => {
    const answer = packet({ sources: [source({ channels: [ramp(RATE_48), ramp(RATE_48)], sampleRate: 24_000 })] })
    assert.deepEqual(Array.from(answer.channels[0]), [0, 0.5, 1, 1.5])
  })

  it('asks the target rate that exportEncode promised, not a number of its own', () => {
    const answer = packet({ sources: [source()] })
    assert.equal(answer.target.sampleRate, ENCODE_AUDIO_REQUEST.sampleRate)
    assert.equal(answer.channels.length, ENCODE_AUDIO_REQUEST.channelCount)
  })

  it('resamples the rate as well as the clock, so a 4x clip at 24 kHz lands on every other source sample', () => {
    const answer = packet({ sources: [source({ channels: [ramp(RATE_48 * 8)], sampleRate: 24_000, rate: 4 })] })
    assert.deepEqual(Array.from(answer.channels[0]), [0, 2, 4, 6])
  })
})

describe('planExportMixPacket — gain, channels and sum', () => {
  it('scales each source by its own gain', () => {
    const answer = packet({ sources: [source({ gain: 0.25 })] })
    assert.deepEqual(Array.from(answer.channels[0]), [0, 0.25, 0.5, 0.75])
  })

  it('adds two sources without normalising, because the preview graph adds too', () => {
    const answer = packet({ sources: [source({ clipId: 'a1', gain: 0.5 }), source({ clipId: 'a2', gain: 0.5 })] })
    assert.deepEqual(Array.from(answer.channels[0]), [0, 1, 2, 3])
    assert.deepEqual(answer.mixed.map(entry => entry.clipId), ['a1', 'a2'])
  })

  it('counts the samples of a mix that leave full scale, rather than hiding them', () => {
    const half = [ramp(RATE_48, 0.5)]
    const answer = packet({
      target: { sampleRate: RATE_48, channelCount: 1 },
      sources: [source({ channels: half }), source({ clipId: 'a2', channels: half })]
    })
    assert.equal(answer.mixed[0].overRange, 1)
    assert.equal(answer.mixed[1].overRange, 2)
  })

  it('feeds a mono media run into every target channel', () => {
    const answer = packet({ sources: [source({ channels: [ramp(RATE_48)] })] })
    assert.deepEqual(Array.from(answer.channels[1]), Array.from(answer.channels[0]))
  })

  it('keeps the first target channels when the media carries more than the file holds', () => {
    const answer = packet({ sources: [source({ channels: [ramp(RATE_48), ramp(RATE_48, 100), ramp(RATE_48, 1000)] })] })
    assert.deepEqual(Array.from(answer.channels[1]), [0, 100, 200, 300])
  })

  it('answers one plane when the file asks one channel', () => {
    const answer = packet({ target: { sampleRate: RATE_48, channelCount: 1 }, sources: [source()] })
    assert.equal(answer.channels.length, 1)
    assert.deepEqual(Array.from(answer.channels[0]), [0, 1, 2, 3])
  })
})

describe('planExportMixPacket — named refusals', () => {
  it('names the reversed source it cannot play', () => {
    const answer = packet({ sources: [source({ plays: false, refusal: 'reverse' })] })
    assert.deepEqual(Array.from(answer.channels[0]), [0, 0, 0, 0])
    assert.deepEqual(answer.refused, [{ clipId: 'a1', reason: 'reverse' }])
    assert.equal(answer.mixed.length, 0)
  })

  it('names a source with no PCM decoded, rather than mixing it as silence', () => {
    const answer = packet({ sources: [source({ channels: null })] })
    assert.deepEqual(answer.refused, [{ clipId: 'a1', reason: 'no-pcm' }])
  })

  it('names a source with no media position', () => {
    const answer = packet({ sources: [source({ mediaTicks: null })] })
    assert.deepEqual(answer.refused, [{ clipId: 'a1', reason: 'no-position' }])
  })

  it('names a source whose PCM carries no usable sample rate', () => {
    const answer = packet({ sources: [source({ sampleRate: 0 })] })
    assert.deepEqual(answer.refused, [{ clipId: 'a1', reason: 'bad-rate' }])
  })

  it('leaves a muted source out of the mix without calling it a refusal', () => {
    const answer = packet({ sources: [source({ gain: 0 })] })
    assert.deepEqual(Array.from(answer.channels[0]), [0, 0, 0, 0])
    assert.deepEqual(answer.refused, [])
    assert.deepEqual(answer.mixed, [])
  })

  it('names a source whose gain is not a number, rather than assuming 1', () => {
    const answer = packet({ sources: [source({ gain: Number.NaN })] })
    assert.deepEqual(answer.refused, [{ clipId: 'a1', reason: 'bad-gain' }])
  })

  it('names a source the mix law cannot play without a reason of its own', () => {
    const answer = packet({ sources: [source({ plays: true, refusal: null })] })
    assert.equal(answer.mixed.length, 1)
    assert.deepEqual(packet({ sources: [source({ plays: false })] }).refused, [{ clipId: 'a1', reason: 'not-playable' }])
  })

  it('keeps the refusal names in one closed list a UI can show verbatim', () => {
    assert.ok(Array.isArray(EXPORT_MIX_REFUSALS))
    assert.deepEqual(EXPORT_MIX_REFUSALS, ['reverse', 'not-playable', 'no-position', 'no-pcm', 'bad-rate', 'bad-gain'])
    assert.equal(Object.isFrozen(EXPORT_MIX_REFUSALS), true)
  })
})

describe('planExportMixPacket — unusable shape', () => {
  it('refuses a packet length that is not a positive count', () => {
    assert.equal(packet({ frames: 0 }), null)
    assert.equal(packet({ frames: Number.NaN }), null)
  })

  it('refuses a start sample that is not a whole number', () => {
    assert.equal(packet({ startSample: 1.5 }), null)
  })

  it('refuses a target clock that is not a rate', () => {
    assert.equal(packet({ target: { sampleRate: 0, channelCount: 2 } }), null)
  })

  it('answers silence, not null, for a project with nothing sounding', () => {
    const answer = packet({ sources: [] })
    assert.equal(answer.channels.length, ENCODE_AUDIO_REQUEST.channelCount)
    assert.deepEqual(Array.from(answer.channels[0]), [0, 0, 0, 0])
    assert.deepEqual(answer.refused, [])
  })
})
