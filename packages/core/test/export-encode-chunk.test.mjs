// Slice H3c — what a real encoder answers, and what the exporter must believe.
//
// H3b wrote the seam against a fake runtime and against the WebCodecs spec, and
// both said the same thing: a packet comes back carrying the timestamp of the
// sample it was made from. The runtime measured on 2026-11-06 (§52) answers that
// way for VIDEO and refuses it for AUDIO — an `AudioEncoder` rebuilds its own
// clock from the first timestamp plus the samples it has seen, so the third
// packet of a 48 kHz stream comes back at 42 666 us when 42 667 was handed it,
// and an `Opus` encoder hands back one packet more than the schedule has place
// for. A seam that matched audio by timestamp would fail its own export on the
// third packet; a seam that wrote the extra packet would end the audio track
// 20 ms past the video.
//
// So the two decisions an IO layer would otherwise make inside a callback are
// here, as one function of the counters, with the measured numbers in the words.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '../src/time.mjs'
import {
  AUDIO_PACKET_FRAMES,
  AUDIO_MIN_HAND_PACKETS,
  encodeAudioHandCount,
  encodeAudioPacketCount,
  planEncodeAudioPadding,
  planEncodeAudioSample,
  planEncodeFinish,
  planEncodeChunk
} from '../src/exportEncode.mjs'

const AAC_FRAMES = AUDIO_PACKET_FRAMES['mp4a.40.2']
const OPUS_FRAMES = AUDIO_PACKET_FRAMES['opus']
const ticksFor = (samples, sampleRate) => Math.round((samples * TICKS_PER_SECOND) / sampleRate)

describe('planEncodeChunk — which sample one packet releases, and whether the file gets it', () => {
  it('hands a video packet to the sample with its own timestamp', () => {
    // Measured: every video run echoed the frame timestamps exactly, in four
    // configs and over 120 frames, so a timestamp is a name here.
    const step = planEncodeChunk({ kind: 'video', openSamples: 3, packetsAdmitted: 0, packetTotal: 5 })
    assert.equal(step.identity, 'timestamp')
    assert.equal(step.action, 'write')
  })

  it('matches an audio packet to the order it was handed in, never to a timestamp', () => {
    // Measured: 42 666 back for 42 667 handed at 48 kHz, and 23 219 for 23 220
    // at 44.1 kHz — the encoder regenerates the clock, so only the order is a name.
    const step = planEncodeChunk({ kind: 'audio', openSamples: 2, packetsAdmitted: 0, packetTotal: 2 })
    assert.equal(step.identity, 'ordinal')
    assert.equal(step.action, 'write')
  })

  it('keeps the packet an encoder emits past the schedule out of the file', () => {
    // Measured: an Opus stream whose sample total fills whole frames answers one
    // packet more than was handed — 50 in, 51 out, the last 3 bytes of silence.
    const step = planEncodeChunk({ kind: 'audio', openSamples: 0, packetsAdmitted: 47, packetTotal: 47 })
    assert.equal(step.action, 'drop-tail')
    assert.equal(step.identity, 'ordinal')
  })

  it('drops the padding hand too, which still owns a sample', () => {
    // The second packet handed to a one-packet aac stream exists only so the
    // encoder can flush (§52); the file was promised one packet, so this is a
    // tail even though something is still open.
    const step = planEncodeChunk({ kind: 'audio', openSamples: 1, packetsAdmitted: 1, packetTotal: 1 })
    assert.equal(step.action, 'drop-tail')
  })

  it('refuses to drop a video packet past the schedule', () => {
    // A frame the run never scheduled is not padding: it is a packet nobody
    // painted, and the file cannot carry a timestamp no frame owns.
    const step = planEncodeChunk({ kind: 'video', openSamples: 0, packetsAdmitted: 5, packetTotal: 5 })
    assert.equal(step.action, 'fail')
    assert.equal(step.reason, 'packet-past-the-schedule')
  })

  it('refuses an audio packet with nothing behind it while the file still owes one', () => {
    // Same shape as a tail, opposite meaning: the schedule is short, so this
    // packet is owed a sample and guessing would release one packet too early.
    const step = planEncodeChunk({ kind: 'audio', openSamples: 0, packetsAdmitted: 0, packetTotal: 5 })
    assert.equal(step.action, 'fail')
    assert.equal(step.reason, 'no-sample-behind-packet')
  })

  it('writes while the schedule still has place, however full the queue is', () => {
    for (let packetsAdmitted = 0; packetsAdmitted < 4; packetsAdmitted += 1) {
      const step = planEncodeChunk({ kind: 'audio', openSamples: 1, packetsAdmitted, packetTotal: 4 })
      assert.equal(step.action, 'write', `packet ${packetsAdmitted}`)
    }
  })

  it('refuses counters it cannot read, and a leg it does not know', () => {
    assert.equal(planEncodeChunk({ openSamples: 1, packetsAdmitted: 0, packetTotal: 1 }), null)
    assert.equal(planEncodeChunk({ kind: 'audio', packetsAdmitted: 0, packetTotal: 1 }), null)
    assert.equal(planEncodeChunk({ kind: 'audio', openSamples: 1, packetTotal: 1 }), null)
    assert.equal(planEncodeChunk({ kind: 'audio', openSamples: 1, packetsAdmitted: -1, packetTotal: 1 }), null)
    assert.equal(planEncodeChunk({ kind: 'audio', openSamples: -1, packetsAdmitted: 0, packetTotal: 1 }), null)
    assert.equal(planEncodeChunk({ kind: 'audio', openSamples: 1, packetsAdmitted: 0, packetTotal: 1.5 }), null)
    assert.equal(planEncodeChunk({ kind: 'text', openSamples: 1, packetsAdmitted: 0, packetTotal: 1 }), null)
  })
})

describe('encodeAudioHandCount — how many packets the encoder must be given', () => {
  it('hands what the schedule counts once the stream is long enough', () => {
    const input = { codec: 'mp4a.40.2', contentEndTicks: ticksFor(48000, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
    assert.equal(encodeAudioPacketCount(input), 47)
    assert.equal(encodeAudioHandCount(input), 47)
  })

  it('hands a second packet to an aac stream the runtime cannot flush on one', () => {
    // Measured: one AudioData into an AAC encoder, then flush, throws
    // "EncodingError: Flushing error." with silence and with a tone alike; two
    // packets flush and answer two packets back.
    const input = { codec: 'mp4a.40.2', contentEndTicks: ticksFor(896, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
    assert.equal(encodeAudioPacketCount(input), 1, 'the file is promised one packet')
    assert.equal(encodeAudioHandCount(input), 2, 'the encoder needs two hands to give it')
  })

  it('pads an aac stream named by either spelling', () => {
    for (const codec of ['mp4a.40.2', 'aac']) {
      const input = { codec, contentEndTicks: ticksFor(1024, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
      assert.equal(encodeAudioHandCount(input), 2, codec)
    }
  })

  it('does not pad opus, which flushes on a single packet', () => {
    const input = { codec: 'opus', contentEndTicks: ticksFor(960, 48000), sampleRate: 48000, framesPerPacket: OPUS_FRAMES }
    assert.equal(encodeAudioPacketCount(input), 1)
    assert.equal(encodeAudioHandCount(input), 1)
  })

  it('asks nothing of a codec it has not measured', () => {
    const input = { codec: 'mp4a.40.5', contentEndTicks: ticksFor(896, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
    assert.equal(encodeAudioHandCount(input), encodeAudioPacketCount(input))
  })

  it('never un-counts a schedule: the floor is a minimum, not a length', () => {
    const input = { codec: 'mp4a.40.2', contentEndTicks: ticksFor(48000, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
    assert.equal(encodeAudioHandCount(input), 47, 'a long stream is not lengthened by a floor')
  })

  it('is null wherever the packet count is null', () => {
    assert.equal(encodeAudioHandCount({ codec: 'mp4a.40.2', sampleRate: 48000, framesPerPacket: AAC_FRAMES }), null)
    assert.equal(encodeAudioHandCount({ codec: 'mp4a.40.2', contentEndTicks: 120_000, framesPerPacket: AAC_FRAMES }), null)
  })

  it('counts the schedule alone when no codec is named', () => {
    // A missing codec is a missing floor, not a broken clock: the answer is the
    // number of packets, exactly as the file promises them.
    const input = { contentEndTicks: ticksFor(48000, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
    assert.equal(encodeAudioHandCount(input), encodeAudioPacketCount(input))
  })

  it('names the measured floor per codec, and nothing else', () => {
    assert.deepEqual({ ...AUDIO_MIN_HAND_PACKETS }, { 'mp4a.40.2': 2, 'aac': 2, 'opus': 1 })
  })
})

describe('planEncodeAudioPadding — the hand past the schedule, on the same grid', () => {
  const clock = { contentEndTicks: ticksFor(896, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }

  it('answers the second hand a one-packet aac stream needs to flush', () => {
    // Measured (§52): handed ONE packet, this runtime's AAC encoder throws
    // `EncodingError: Flushing error.` on flush — with a tone in the buffer and
    // with digital silence alike. Handed two, it answers two. The extra hand is a
    // whole frame of nothing, and planEncodeChunk keeps it out of the file.
    const hand = planEncodeAudioPadding({ ...clock, codec: 'mp4a.40.2', index: 1 })
    assert.equal(hand.frames, AAC_FRAMES, 'a whole frame, not the remainder')
    assert.equal(hand.startSample, AAC_FRAMES, 'the next position on the same grid')
    // The same arithmetic the schedule uses, re-read from a stream long enough to
    // schedule this packet: a padding hand is not a second clock.
    const same = planEncodeAudioSample({ ...clock, contentEndTicks: ticksFor(2 * AAC_FRAMES, 48000), index: 1 })
    assert.equal(hand.timestamp, same.timestamp)
    assert.equal(hand.duration, same.duration)
  })

  it('refuses a hand the schedule already owns', () => {
    assert.equal(planEncodeAudioPadding({ ...clock, codec: 'mp4a.40.2', index: 0 }), null)
  })

  it('refuses a hand past its own padding', () => {
    // One padding frame is the whole of what the measured floor asks for; a second
    // would be a longer file wearing a shorter one's name.
    assert.equal(planEncodeAudioPadding({ ...clock, codec: 'mp4a.40.2', index: 2 }), null)
  })

  it('answers nothing to a codec whose floor the schedule already meets', () => {
    // Opus flushes on one hand (§52), so a one-packet opus stream has no padding.
    assert.equal(
      planEncodeAudioPadding({ contentEndTicks: ticksFor(896, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES, codec: 'opus', index: 1 }),
      null
    )
    // And a stream the floor does not reach needs no padding either.
    assert.equal(planEncodeAudioPadding({ ...clock, codec: 'mp4a.40.2', index: 1, framesPerPacket: AAC_FRAMES, contentEndTicks: ticksFor(3 * AAC_FRAMES, 48000) }), null)
  })

  it('is null wherever the clock is unreadable', () => {
    assert.equal(planEncodeAudioPadding({ sampleRate: 48000, framesPerPacket: AAC_FRAMES, codec: 'mp4a.40.2', index: 1 }), null)
    assert.equal(planEncodeAudioPadding({ ...clock, codec: 'mp4a.40.2' }), null)
    assert.equal(planEncodeAudioPadding({ ...clock, index: -1, codec: 'mp4a.40.2' }), null)
  })
})

describe('planEncodeFinish — what the exporter still owes the encoder, not only the file', () => {
  /** A run with the video leg complete and the audio leg one packet short. */
  const counters = (overrides = {}) => ({
    totalFrames: 3, framesQueued: 3, videoPackets: 3, videoInFlight: 0, videoFlushed: true,
    totalAudioPackets: 1, audioPacketsQueued: 1, audioPackets: 1, audioInFlight: 1, audioFlushed: false,
    outputState: 'started', hasVideo: true, hasAudio: true, ...overrides
  })

  it('pumps the hand the encoder needs before it will flush', () => {
    // The file is already complete by its own schedule; only the encoder's floor
    // (§52: AAC throws on flush with one packet) is not. A close order that knows
    // one number says `flush-audio` here and the export dies on an EncodingError.
    const plan = planEncodeFinish(counters({ totalAudioHands: 2, audioInFlight: 2 }))
    assert.equal(plan.action, 'pump')
    assert.ok(plan.blocking.includes('audio-not-queued'), plan.blocking.join(','))
  })

  it('flushes once every hand is made', () => {
    const plan = planEncodeFinish(counters({ totalAudioHands: 2, audioPacketsQueued: 2, audioInFlight: 2 }))
    assert.equal(plan.action, 'flush-audio')
  })

  it('keeps H3b\'s answer when no hand count is reported', () => {
    // The default is the packet count, so a driver written before the measurement
    // still gets the order it was written against.
    assert.equal(planEncodeFinish(counters()).action, 'flush-audio')
  })

  it('refuses a hand count it cannot read', () => {
    assert.equal(planEncodeFinish(counters({ totalAudioHands: 1.5 })), null)
    assert.equal(planEncodeFinish(counters({ totalAudioHands: -1 })), null)
  })
})
