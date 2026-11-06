// Slice H3a — the audio clock is a sample count, and it must end where the video ends.
//
// H1 wrote the video half of this: a frame's timestamp comes from its index and
// the rational frame rate, never from a timer. H3 runs a real exporter, and an
// exporter has two clocks. If the audio clock is the wall clock, or the video
// frame rate, or a rounded packet length multiplied by the packet number, the
// file drifts: 1024 samples at 44.1 kHz is 23.219954... ms, so the rounding
// error is paid once per packet and never repaid.
//
// What the muxer needs beyond the law is one number: how many samples each
// packet must carry. AAC is not a preference — the format is 1024 samples per
// channel per frame, so an AudioData of any other length is a different codec.
// Opus accepts several frame sizes and 20 ms is the one this runtime's encoder
// is documented at, which is 960 samples at 48 kHz. Whether a real encoder
// accepts either is measured by the app leg, not claimed here.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '../src/time.mjs'
import {
  AUDIO_PACKET_FRAMES,
  encodeAudioSampleCount,
  planEncodeAudioSample,
  planEncodeSample
} from '../src/exportEncode.mjs'

const RATE_30 = { numerator: 30, denominator: 1 }
const AAC_FRAMES = AUDIO_PACKET_FRAMES['mp4a.40.2']
const ONE_SECOND = TICKS_PER_SECOND
const STEREO_48K = { sampleRate: 48000, framesPerPacket: AAC_FRAMES }

/** One packet of a one-second 48 kHz export, in microseconds. */
function ask(index, input = {}) {
  return planEncodeAudioSample({ ...STEREO_48K, contentEndTicks: ONE_SECOND, index, ...input })
}

/** Every packet until the schedule says there is none. */
function schedule(input) {
  const packets = []
  for (let index = 0; index < 1000; index += 1) {
    const packet = planEncodeAudioSample({ ...input, index })
    if (packet === null) return packets
    packets.push(packet)
  }
  throw new Error('the audio schedule never ended')
}

describe('AUDIO_PACKET_FRAMES — the frame size a codec is, not the one the exporter likes', () => {
  it('requires 1024 samples per channel for AAC, in either spelling', () => {
    assert.equal(AUDIO_PACKET_FRAMES['mp4a.40.2'], 1024)
    assert.equal(AUDIO_PACKET_FRAMES.aac, 1024)
  })

  it('packs Opus at its 20 ms frame, 960 samples at 48 kHz', () => {
    assert.equal(AUDIO_PACKET_FRAMES.opus, 960)
  })

  it('says nothing about a codec it has not been told', () => {
    // An invented default here would silently re-frame an unknown encoder,
    // which is the failure mode ADR-030 forbids for codecs generally.
    assert.equal(AUDIO_PACKET_FRAMES.flac, undefined)
  })
})

describe('encodeAudioSampleCount — one rounding between the timeline and the sample rate', () => {
  it('carries the whole second at both rates the exporter can be asked for', () => {
    assert.equal(encodeAudioSampleCount({ contentEndTicks: ONE_SECOND, sampleRate: 48000 }), 48000)
    assert.equal(encodeAudioSampleCount({ contentEndTicks: ONE_SECOND, sampleRate: 44100 }), 44100)
  })

  it('rounds a content end that is not a whole sample, once', () => {
    // 1000 ticks is 1/120 s: 367.5 samples at 44.1 kHz, so a packet boundary
    // has to be chosen and the same position must never be rounded twice.
    assert.equal(encodeAudioSampleCount({ contentEndTicks: 1000, sampleRate: 44100 }), 368)
  })

  it('refuses a clock it cannot count on', () => {
    assert.equal(encodeAudioSampleCount(), null)
    assert.equal(encodeAudioSampleCount({}), null)
    for (const bad of [{ contentEndTicks: 0, sampleRate: 48000 }, { contentEndTicks: ONE_SECOND, sampleRate: 0 },
      { contentEndTicks: ONE_SECOND, sampleRate: 48000.5 }, { contentEndTicks: Number.NaN, sampleRate: 48000 },
      { contentEndTicks: -ONE_SECOND, sampleRate: 48000 }]) {
      assert.equal(encodeAudioSampleCount(bad), null, `accepted ${JSON.stringify(bad)}`)
    }
  })
})

describe('planEncodeAudioSample — timestamps fall out of the sample count', () => {
  it('divides the packet number by the rate instead of multiplying a rounded duration', () => {
    const first = ask(1)
    // 1024 / 48000 s = 21.3333 ms: the position is rounded once, and the
    // duration is the next position minus this one, so it lands on 21334.
    assert.equal(first.startSample, 1024)
    assert.equal(first.timestamp, 21333)
    assert.equal(first.duration, 21334)
    assert.equal(first.isLast, false)
  })

  it('keeps positions exact at 90 kHz, the timescale a muxer really uses', () => {
    const at44100 = index => planEncodeAudioSample({
      sampleRate: 44100,
      framesPerPacket: AAC_FRAMES,
      contentEndTicks: ONE_SECOND,
      timescale: 90_000,
      index
    })
    // 1024 samples at 44.1 kHz are 2089.8 units of a 90 kHz clock, so the
    // boundary after one packet is 2090. Twice that rounded value is still
    // 4180, but three of them are 6270 while the real third boundary is 6269:
    // a packet length multiplied by the packet number lands one unit late and
    // keeps paying for it, which is the drift H1 killed on the video side.
    assert.equal(at44100(1).timestamp, 2090)
    assert.equal(at44100(2).timestamp, 4180)
    assert.equal(at44100(3).timestamp, 6269)
    assert.notEqual(at44100(3).timestamp, at44100(1).timestamp * 3, 'the clock was multiplied, not divided')
    assert.equal(at44100(1).duration, 2090)
    assert.equal(at44100(2).duration, 2089, 'a packet length was treated as a constant')
  })

  it('packets the whole content and sums to exactly the content length', () => {
    // 48000 samples / 1024 = 46.875 packets, so 47 with a short tail.
    const packets = schedule({ ...STEREO_48K, contentEndTicks: ONE_SECOND })
    assert.equal(packets.length, 47)
    assert.equal(packets[46].frames, 48000 - 46 * 1024)
    assert.equal(packets[46].isLast, true)
    assert.equal(packets.reduce((sum, packet) => sum + packet.duration, 0), 1_000_000)
    for (let i = 1; i < packets.length; i += 1) {
      assert.equal(
        packets[i].timestamp,
        packets[i - 1].timestamp + packets[i - 1].duration,
        `packet ${i} was placed away from where packet ${i - 1} ended`
      )
    }
  })

  it('cuts the final packet to what is left rather than writing past the project', () => {
    const tail = ask(46)
    assert.equal(tail.startSample, 46 * 1024)
    assert.equal(tail.frames, 896)
    assert.equal(tail.isLast, true)
    assert.equal(ask(47), null, 'a packet that starts at the end is not a packet')
  })

  it('refuses a packet outside the content or an unusable clock', () => {
    // The content ends where packet 46 starts, so packet 46 does not exist.
    assert.equal(ask(46, { contentEndTicks: 117_760 }), null)
    assert.equal(planEncodeAudioSample(), null)
    for (const bad of [{ index: -1 }, { index: 1.5 }, { index: Number.NaN }, { sampleRate: 0 },
      { framesPerPacket: 0 }, { framesPerPacket: 1024.5 }, { contentEndTicks: 0 },
      { contentEndTicks: Number.POSITIVE_INFINITY }, { timescale: 0 }]) {
      assert.equal(
        planEncodeAudioSample({ ...STEREO_48K, contentEndTicks: ONE_SECOND, index: 0, ...bad }),
        null,
        `accepted ${JSON.stringify(bad)}`
      )
    }
  })

  it('answers the last question by the frame size it was given, not by 1024', () => {
    const opus = { sampleRate: 48000, framesPerPacket: AUDIO_PACKET_FRAMES.opus, contentEndTicks: ONE_SECOND }
    assert.equal(planEncodeAudioSample({ ...opus, index: 1 }).startSample, 960)
    assert.equal(planEncodeAudioSample({ ...opus, index: 1 }).timestamp, 20_000)
    // 48000 / 960 is exact, so the last packet is a whole frame and there is no tail.
    const packets = schedule(opus)
    assert.equal(packets.length, 50)
    assert.equal(packets[49].isLast, true)
    assert.equal(packets[49].frames, 960)
    assert.equal(packets[49].timestamp + packets[49].duration, 1_000_000)
  })
})

describe('the two clocks of one export — audio must end where the video ends', () => {
  it('reports the same end position for the last frame and the last packet', () => {
    const frames = 30
    const contentEndTicks = frames * (TICKS_PER_SECOND / 30)
    const lastFrame = planEncodeSample({ index: frames - 1, rate: RATE_30, contentEndTicks })
    assert.ok(lastFrame.isLast, 'the video law did not mark its own last frame')

    const packets = schedule({ ...STEREO_48K, contentEndTicks })
    const lastPacket = packets[packets.length - 1]
    assert.equal(
      lastPacket.timestamp + lastPacket.duration,
      lastFrame.timestamp + lastFrame.duration,
      'the muxer was promised two different lengths'
    )
  })

  it('puts a 29.97 frame and the packet under it on the same microsecond, without a float frame rate', () => {
    // The point of H1 was that 30 frames of 29.97 are 1.001 s, not 1.001001 s.
    // Audio does not care about the frame rate, so the only shared clock is the
    // content end in ticks — which is what this pins.
    const rate = { numerator: 30000, denominator: 1001 }
    const contentEndTicks = 30 * (TICKS_PER_SECOND * 1001 / 30000)
    const frame = planEncodeSample({ index: 29, rate, contentEndTicks })
    assert.equal(frame.timestamp + frame.duration, 1_001_000)
    assert.equal(encodeAudioSampleCount({ contentEndTicks, sampleRate: 48000 }), 48048)
  })

  it('lets a fractional content end differ by at most one sample, the price of a whole-sample boundary', () => {
    // 1000 ticks is 1/120 s: 8333.33 microseconds for the video clock and
    // 367.5 samples for the audio clock. Audio cannot start between two
    // samples, so it rounds up to 368 and its end moves by less than one
    // sample. This is the whole tolerance the app leg may claim as sync.
    const contentEndTicks = 1000
    const frame = planEncodeSample({ index: 0, rate: RATE_30, contentEndTicks })
    const packet = planEncodeAudioSample({
      sampleRate: 44100,
      framesPerPacket: AAC_FRAMES,
      contentEndTicks,
      index: 0
    })
    const oneSampleMicroseconds = 1_000_000 / 44100
    const videoEnd = frame.timestamp + frame.duration
    const audioEnd = packet.timestamp + packet.duration
    assert.equal(videoEnd, 8333)
    assert.equal(audioEnd, 8345)
    assert.ok(Math.abs(audioEnd - videoEnd) < oneSampleMicroseconds, `${audioEnd} vs ${videoEnd}`)
  })
})
