// Slice E3 — where a decoded PCM run really begins.
//
// A decoder hands back whole packets. Asked for 0.5 s of a 44.1 kHz AAC file it
// started at 0.48762 s (measured in Chromium, one packet of 1024 samples early),
// and a level window that overlaps the tone by 12 ms is loud enough to lose the
// whole window, which moved a quiet span half a second late. So the seam
// trims the head before the laws see it, and that arithmetic is core's.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { peakLevelSeries, pcmHeadTrim, silenceSpans } from '../src/detection.mjs'

const rate = 44100

describe('pcmHeadTrim', () => {
  it('counts the samples delivered before the asked start', () => {
    // Chromium measured this exact run: an ask of 0.5 s came back starting at the
    // 21st AAC packet, so 22050 - 21504 samples of it are not the asked range.
    assert.equal(pcmHeadTrim(22050 / rate, 21504 / rate, rate), 546)
    assert.equal(pcmHeadTrim(0.5, 0.48762, rate), 546)
  })

  it('counts nothing when the run already starts at or after the ask', () => {
    assert.equal(pcmHeadTrim(0.5, 0.5, rate), 0)
    assert.equal(pcmHeadTrim(0.5, 0.52322, rate), 0)
  })

  it('answers nothing about a range it cannot trust', () => {
    assert.equal(pcmHeadTrim(Number.NaN, 0.4, rate), 0)
    assert.equal(pcmHeadTrim(0.5, Number.POSITIVE_INFINITY, rate), 0)
    assert.equal(pcmHeadTrim(0.5, 0.48762, 0), 0)
    assert.equal(pcmHeadTrim(undefined, 0.48762, rate), 0)
  })

  it('moves a span that a packet of tone would otherwise push one window late', () => {
    const windowSec = 0.5
    const packet = 1024
    /** Three seconds: one of tone, two of nothing. */
    const signal = new Float32Array(rate * 3)
    signal.fill(0.28, 0, rate)
    const ask = { inSec: 0.5, outSec: 2 }
    // A decoder asked for 0.5 s hands over the packet that contains it, which
    // started `packet` samples earlier than the ask.
    const delivered = signal.slice(Math.round(ask.inSec * rate) - packet, Math.round(ask.outSec * rate))
    const treated = silenceSpans(peakLevelSeries(delivered, rate, windowSec),
      { windowSec, offsetSec: ask.inSec })
    assert.equal(treated[0].start, 1.5, 'untrimmed, the first window carries tone and the span starts a window late')
    const trimmed = delivered.slice(pcmHeadTrim(ask.inSec, ask.inSec - packet / rate, rate))
    const aligned = silenceSpans(peakLevelSeries(trimmed, rate, windowSec),
      { windowSec, offsetSec: ask.inSec })
    assert.deepEqual(aligned, [{ start: 1, end: 2 }], 'trimmed, the span sits on the second it was asked at')
  })
})
