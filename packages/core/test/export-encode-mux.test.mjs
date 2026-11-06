// Slice H3b — the order the muxer is closed in is a law, not a habit.
//
// H1..H3a decided what each packet says. This decides when the exporter is
// allowed to stop writing, which is the part of an exporter that produces a
// file that opens, plays, and is the length the timeline was. Every failure
// mode here is silent: finalize one callback early and the tail of the video is
// gone with exit code 0; skip the flush and the encoder's last frames die in its
// queue; add the first packet before its decoder description and the container
// holds a track no decoder can be pointed at.
//
// The IO layer cannot review these decisions by reading them, because in an IO
// layer they are spread across three callbacks and a promise chain. Here they
// are one function with one order.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '../src/time.mjs'
import {
  AUDIO_PACKET_FRAMES,
  encodeAudioPacketCount,
  planEncodeAudioSample,
  planEncodeFinish,
  planEncodePacketMeta,
  planEncodeProgress
} from '../src/exportEncode.mjs'

const AAC_FRAMES = AUDIO_PACKET_FRAMES['mp4a.40.2']
/** Ticks for exactly `samples` samples at `sampleRate`, so the clock is honest. */
const ticksFor = (samples, sampleRate) => Math.round((samples * TICKS_PER_SECOND) / sampleRate)

/** The whole audio schedule of an export, as H3a's law writes it. */
function schedule(sampleRate, contentEndTicks, framesPerPacket = AAC_FRAMES) {
  const packets = []
  for (let index = 0; index < 100_000; index += 1) {
    const packet = planEncodeAudioSample({ sampleRate, framesPerPacket, contentEndTicks, index })
    if (packet === null) return packets
    packets.push(packet)
  }
  throw new Error('the audio schedule never ended')
}

describe('encodeAudioPacketCount — how many packets the file must carry', () => {
  it('counts the remainder as a packet of its own', () => {
    // One second at 48 kHz is 46 full AAC frames and 896 samples left over.
    // Dropping the last one is a file 18.6 ms short, and nothing reports it.
    const contentEndTicks = ticksFor(48000, 48000)
    assert.equal(encodeAudioPacketCount({ contentEndTicks, sampleRate: 48000, framesPerPacket: AAC_FRAMES }), 47)
  })

  it('does not invent a packet when the content ends on a frame boundary', () => {
    const contentEndTicks = ticksFor(46 * AAC_FRAMES, 48000)
    assert.equal(encodeAudioPacketCount({ contentEndTicks, sampleRate: 48000, framesPerPacket: AAC_FRAMES }), 46)
  })

  it('equals the number of packets H3a schedules', () => {
    for (const samples of [1, 1023, 1024, 1025, 48000, 48_128]) {
      const input = { contentEndTicks: ticksFor(samples, 48000), sampleRate: 48000, framesPerPacket: AAC_FRAMES }
      assert.equal(encodeAudioPacketCount(input), schedule(48000, input.contentEndTicks).length, `${samples} samples`)
    }
  })

  it('refuses an input that cannot describe a clock', () => {
    assert.equal(encodeAudioPacketCount({ sampleRate: 48000, framesPerPacket: AAC_FRAMES }), null)
    assert.equal(encodeAudioPacketCount({ contentEndTicks: 120_000, framesPerPacket: AAC_FRAMES }), null)
    assert.equal(encodeAudioPacketCount({ contentEndTicks: 120_000, sampleRate: 48000 }), null)
    assert.equal(encodeAudioPacketCount({ contentEndTicks: 0, sampleRate: 48000, framesPerPacket: AAC_FRAMES }), null)
    assert.equal(
      encodeAudioPacketCount({ contentEndTicks: 120_000, sampleRate: 48000, framesPerPacket: 0 }),
      null,
      'a codec with no frame size has no schedule'
    )
  })
})

describe('planEncodeFinish — the only order that closes a file', () => {
  const FULL = {
    totalFrames: 300, framesQueued: 300, videoPackets: 300, audioPackets: 47, totalAudioPackets: 47,
    audioPacketsQueued: 47, videoInFlight: 0, audioInFlight: 0, videoFlushed: true, audioFlushed: true,
    outputState: 'started'
  }

  it('lets the exporter write the file when every leg is owed nothing', () => {
    const step = planEncodeFinish(FULL)
    assert.equal(step.action, 'finalize')
    assert.equal(step.ready, true)
    assert.deepEqual(step.blocking, [])
  })

  it('keeps painting while frames are still queued', () => {
    const step = planEncodeFinish({ ...FULL, framesQueued: 299, videoFlushed: false, audioFlushed: false })
    assert.equal(step.action, 'paint')
    assert.equal(step.ready, false, 'a flush before the last frame is a truncated file')
    assert.deepEqual(step.blocking, ['frames-queued', 'video-not-flushed', 'audio-not-flushed'])
  })

  it('keeps feeding the audio encoder while samples are still owed', () => {
    // The reason the loop needs this number: a driver that flushes the audio leg
    // before it has been handed every sample loses the middle of the file, and
    // the loss shows up as a short audio track in a video that plays fine.
    const step = planEncodeFinish({ ...FULL, audioPacketsQueued: 40, audioFlushed: false })
    assert.equal(step.action, 'pump')
    assert.deepEqual(step.blocking, ['audio-not-queued', 'audio-not-flushed'])
  })

  it('fills both legs before it flushes either', () => {
    const step = planEncodeFinish({
      ...FULL, framesQueued: 10, audioPacketsQueued: 10, videoFlushed: false, audioFlushed: false
    })
    assert.deepEqual(step.blocking, ['frames-queued', 'audio-not-queued', 'video-not-flushed', 'audio-not-flushed'])
  })

  it('flushes the encoders before it waits for their packets', () => {
    const step = planEncodeFinish({ ...FULL, videoFlushed: false })
    assert.equal(step.action, 'flush-video', 'flushing is what drains the queue')
    const audio = planEncodeFinish({ ...FULL, audioFlushed: false })
    assert.equal(audio.action, 'flush-audio')
  })

  it('will not finalize while an encoder still owes the muxer a packet', () => {
    // The shape this describes is a sample that has been handed over and not yet
    // written, so the count is still able to come down: `wait`, not a verdict.
    const inflight = planEncodeFinish({ ...FULL, videoPackets: 299, videoInFlight: 1 })
    assert.equal(inflight.action, 'wait')
    assert.deepEqual(inflight.blocking, ['video-in-flight', 'video-packets'])
  })

  it('refuses a leg whose in-flight count cannot come down any more', () => {
    // Every sample this leg handed over has already been written into the file,
    // yet it still reports work outstanding. A count only falls when a chunk is
    // parked or when its write lands, and both of those have happened for every
    // sample there is — so nothing can lower it again. A `wait` here is the
    // exporter sitting in front of an open file forever, and the run that ends
    // like that is a lost queue slot, not a slow machine.
    const lost = planEncodeFinish({ ...FULL, videoInFlight: 2 })
    assert.equal(lost.action, 'stalled')
    assert.deepEqual(lost.blocking, ['video-in-flight'])

    const audioLost = planEncodeFinish({ ...FULL, audioInFlight: 1 })
    assert.equal(audioLost.action, 'stalled', 'the audio leg is held to the same order')

    // The payable shape, for contrast: one sample has not been written yet, so
    // its write is still able to land and lower the number.
    const midAir = planEncodeFinish({ ...FULL, videoPackets: 299, videoInFlight: 1 })
    assert.equal(midAir.action, 'wait')
    assert.deepEqual(midAir.blocking, ['video-in-flight', 'video-packets'])
  })

  it('refuses the same lost slot when the packets are all parked', () => {
    // The shape a runtime that never describes its track leaves behind: every
    // sample has come back out of the encoder, none of it has been written, and
    // the leg still says it is holding work. Packets held for want of a decoder
    // description are not with the encoder any more either, so the count can no
    // longer come down, and a `wait` here is the exporter hanging over an open
    // file with nothing left to wait for.
    const parked = planEncodeFinish({
      ...FULL, totalFrames: 3, framesQueued: 3, videoPackets: 0, videoInFlight: 3, videoParked: 3
    })
    assert.equal(parked.action, 'stalled')
    assert.deepEqual(parked.blocking, ['video-in-flight', 'video-packets'])

    // Payable by contrast: one sample has not been handed back yet, so the leg
    // really is still busy and its packet count is still able to grow.
    const midFlight = planEncodeFinish({
      ...FULL, totalFrames: 3, framesQueued: 3, videoPackets: 1, videoInFlight: 2, videoParked: 1
    })
    assert.equal(midFlight.action, 'wait')

    // And the pile is a counter like every other one: a number this function
    // cannot read is a number it must refuse, not one it may round into a verdict.
    assert.equal(planEncodeFinish({ ...FULL, videoParked: -1 }), null, 'a negative parked pile')
    assert.equal(planEncodeFinish({ ...FULL, audioParked: Number.NaN }), null, 'and one it cannot read')
  })

  it('calls a debt nothing can pay a stall, not a wait', () => {
    // Flushed and drained, but the audio output callback never landed. Waiting
    // here is a hang with a half-written file and no error; the file is dead and
    // the exporter has to say so.
    const short = planEncodeFinish({ ...FULL, audioPackets: 46 })
    assert.equal(short.action, 'stalled')
    assert.equal(short.ready, false)
    assert.deepEqual(short.blocking, ['audio-packets'])

    const lost = planEncodeFinish({ ...FULL, videoPackets: 299 })
    assert.equal(lost.action, 'stalled', 'a frame the flushed encoder never emitted is gone')

    // A held first packet — the runtime never described the track — is the same
    // shape: everything drained, packets short.
    const undescribed = planEncodeFinish({ ...FULL, videoPackets: 0 })
    assert.equal(undescribed.action, 'stalled')
  })

  it('still waits when a packet is short and the encoder is busy', () => {
    // The difference between the two cases is the in-flight counter: while a
    // chunk can still arrive, the shortfall is a wait, not a verdict.
    const step = planEncodeFinish({ ...FULL, audioPackets: 46, audioInFlight: 2 })
    assert.equal(step.action, 'wait')
    assert.deepEqual(step.blocking, ['audio-in-flight', 'audio-packets'])
  })

  it('names every reason it is still blocking', () => {
    const step = planEncodeFinish({
      ...FULL, framesQueued: 100, videoFlushed: false, audioFlushed: false, videoInFlight: 4, audioPackets: 12
    })
    assert.equal(step.ready, false)
    assert.deepEqual(step.blocking, ['frames-queued', 'video-not-flushed', 'audio-not-flushed', 'video-in-flight', 'audio-packets'])
  })

  it('skips a leg the project does not have', () => {
    const silent = planEncodeFinish({
      ...FULL, hasAudio: false, audioPackets: 0, totalAudioPackets: 0, audioPacketsQueued: 0, audioFlushed: false
    })
    assert.equal(silent.action, 'finalize', 'an audio-less export is not blocked by audio it never had')

    const pictureless = planEncodeFinish({
      ...FULL, hasVideo: false, framesQueued: 0, totalFrames: 0, videoPackets: 0, videoInFlight: 0, videoFlushed: false
    })
    assert.equal(pictureless.action, 'finalize')
  })

  it('refuses a second finalize and any write after a cancel', () => {
    const finalizing = planEncodeFinish({ ...FULL, outputState: 'finalizing' })
    assert.equal(finalizing.action, 'stop')
    assert.equal(finalizing.ready, false)

    const canceled = planEncodeFinish({ ...FULL, outputState: 'canceled' })
    assert.equal(canceled.action, 'stop')
    assert.deepEqual(canceled.blocking, ['output-canceled'])

    const done = planEncodeFinish({ ...FULL, outputState: 'finalized' })
    assert.equal(done.action, 'done')
    assert.equal(done.ready, true, 'the file is closed; there is nothing left to do')
  })

  it('will not write a file the muxer has not opened', () => {
    // Adding samples before start() is an API error, so the law that decides
    // whether to write has to know the container is not open yet.
    const step = planEncodeFinish({ ...FULL, outputState: 'pending' })
    assert.equal(step.action, 'start')
    assert.deepEqual(step.blocking, ['output-not-started'])
  })

  it('refuses counters it cannot read', () => {
    assert.equal(planEncodeFinish({ ...FULL, framesQueued: 1.5 }), null)
    assert.equal(planEncodeFinish({ ...FULL, videoInFlight: -1 }), null)
    assert.equal(planEncodeFinish({ ...FULL, outputState: 'writing' }), null)
    assert.equal(planEncodeFinish({ ...FULL, audioPacketsQueued: undefined }), null, 'a leg nobody counts is a leg that never ends')
  })
})

describe('planEncodePacketMeta — the decoder description goes with the first packet', () => {
  it('holds a first packet that has no description yet', () => {
    const step = planEncodePacketMeta({ packetsAdded: 0, hasMeta: false })
    assert.equal(step.action, 'hold')
    assert.equal(step.reason, 'no-description', 'a bare first packet is a track no decoder can be pointed at')
  })

  it('passes the description with the first packet only', () => {
    assert.equal(planEncodePacketMeta({ packetsAdded: 0, hasMeta: true }).action, 'with-meta')
    const later = planEncodePacketMeta({ packetsAdded: 1, hasMeta: true })
    assert.equal(later.action, 'plain')
    assert.equal(later.reason, 'description-already-written', 'a second copy is a second codec description')
  })

  it('refuses a count it cannot read', () => {
    assert.equal(planEncodePacketMeta({ packetsAdded: -1 }), null)
    assert.equal(planEncodePacketMeta({}), null)
  })
})

describe('planEncodeProgress — the bar counts work, never the clock', () => {
  it('reports the slower leg, because the file cannot be ahead of it', () => {
    const legs = { totalFrames: 100, framesDone: 50, totalAudioPackets: 50, audioPacketsDone: 10 }
    assert.equal(planEncodeProgress(legs), 0.2)
    assert.equal(planEncodeProgress({ ...legs, framesDone: 5, audioPacketsDone: 40 }), 0.05)
  })

  it('ignores a leg the export does not have', () => {
    assert.equal(planEncodeProgress({ totalFrames: 100, framesDone: 50, totalAudioPackets: 0, audioPacketsDone: 0 }), 0.5)
    assert.equal(planEncodeProgress({ totalFrames: 0, framesDone: 0, totalAudioPackets: 40, audioPacketsDone: 10 }), 0.25)
  })

  it('does not claim a finished file before the muxer closed it', () => {
    const all = { totalFrames: 10, framesDone: 10, totalAudioPackets: 4, audioPacketsDone: 4 }
    assert.equal(planEncodeProgress(all), 0.99, 'a bar at 100% promises a file that is not written')
    assert.equal(planEncodeProgress({ ...all, outputState: 'finalized' }), 1)
  })

  it('answers zero, not NaN, when there is nothing to count', () => {
    assert.equal(planEncodeProgress({ totalFrames: 0, framesDone: 0, totalAudioPackets: 0, audioPacketsDone: 0 }), 0)
    assert.equal(planEncodeProgress({}), 0)
  })

  it('clamps counters that overshoot their own totals', () => {
    const overshoot = { totalFrames: 10, framesDone: 12, totalAudioPackets: 4, audioPacketsDone: 9 }
    assert.equal(planEncodeProgress(overshoot), 0.99)
  })

  it('refuses counters it cannot read', () => {
    assert.equal(planEncodeProgress({ totalFrames: 10, framesDone: -1, totalAudioPackets: 4, audioPacketsDone: 0 }), null)
    assert.equal(planEncodeProgress({ totalFrames: 1.5, framesDone: 0, totalAudioPackets: 4, audioPacketsDone: 0 }), null)
  })
})
