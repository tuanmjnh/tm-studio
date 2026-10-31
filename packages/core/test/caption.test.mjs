// @tmcut/core — caption / SRT tests (Roadmap C11). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  splitLongCue,
  cuesToCaptionClips,
  parseSrt,
  serializeSrt
} from '../src/caption.mjs'
import { secToTicks } from '../src/time.mjs'

describe('caption (C11)', () => {
  it('splitLongCue splits on word bounds, contiguous, pinned end', () => {
    const cue = { text: 'one two three four five six seven eight nine ten', start: 1, end: 3 }
    const chunks = splitLongCue(cue, 15)
    assert.ok(chunks.length > 1)
    // Every word survives whole — the text rejoins to the original.
    assert.equal(chunks.map(chunk => chunk.text).join(' '), cue.text)
    // Timings: start at the cue start, contiguous, pin the original end.
    assert.equal(chunks[0].start, 1)
    assert.equal(chunks[chunks.length - 1].end, 3)
    for (let index = 1; index < chunks.length; index++) {
      assert.equal(chunks[index].start, chunks[index - 1].end)
      assert.ok(chunks[index].end > chunks[index].start)
    }
    // Short cues pass through untouched.
    assert.deepEqual(splitLongCue({ text: 'hi there', start: 0, end: 1 }, 42), [{ text: 'hi there', start: 0, end: 1 }])
    // A single oversized word is never cut — it stays intact alone.
    const long = splitLongCue({ text: 'supercalifragilisticexpialidocious rock', start: 0, end: 2 }, 10)
    assert.equal(long[0].text, 'supercalifragilisticexpialidocious')
    assert.deepEqual(splitLongCue(null, 10), [])
  })

  it('parseSrt reads the standard format, tolerating CRLF and junk', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:03,500\r\nHello world\r\n\r\n2\r\n00:01:02,250 --> 00:01:04,000\r\nSecond\r\nline\r\n'
    const cues = parseSrt(srt)
    assert.equal(cues.length, 2)
    assert.deepEqual(cues[0], { text: 'Hello world', start: 1, end: 3.5 })
    assert.deepEqual(cues[1], { text: 'Second\nline', start: 62.25, end: 64 })
    // Index lines are optional, dot decimals tolerated, junk skipped.
    assert.deepEqual(
      parseSrt('garbage\n\n00:00:00.500 --> 00:00:01.000 X1:20 X2:600 Y1:20 Y2:500\nDot\n'),
      [{ text: 'Dot', start: 0.5, end: 1 }]
    )
    assert.deepEqual(parseSrt(''), [])
  })

  it('serializeSrt round-trips through parseSrt', () => {
    const cues = [
      { text: 'Hello world', start: 1, end: 3.5 },
      { text: 'Multi\nline', start: 62.25, end: 64 }
    ]
    const text = serializeSrt(cues)
    assert.match(text, /^1\n00:00:01,000 --> 00:00:03,500\nHello world\n/)
    assert.match(text, /\n2\n00:01:02,250 --> 00:01:04,000\nMulti\nline\n$/)
    assert.deepEqual(parseSrt(text), cues)
    assert.equal(serializeSrt([]), '')
    // Invalid/empty cues drop so the round-trip stays clean.
    assert.equal(serializeSrt([{ text: '  ', start: 0, end: 1 }, { text: 'x', start: 2, end: 2 }]), '')
  })

  it('cuesToCaptionClips lands captions as tick text clips', () => {
    assert.deepEqual(
      cuesToCaptionClips([{ text: 'Hello world', start: 1, end: 3 }]),
      [{ text: 'Hello world', in: 0, out: secToTicks(2), offset: secToTicks(1) }]
    )
    // maxChars splits one long cue into several clips; fromTicks anchors them.
    const split = cuesToCaptionClips(
      [{ text: 'one two three four five six seven eight nine ten', start: 0, end: 4 }],
      { maxChars: 15, fromTicks: secToTicks(10) }
    )
    assert.ok(split.length > 1)
    assert.equal(split[0].offset, secToTicks(10))
    assert.deepEqual(split.map(clip => clip.out).reduce((a, b) => a + b, 0), secToTicks(4))
    // rangeTicks clamps the window: outside cues drop, straddling trims.
    const ranged = cuesToCaptionClips(
      [
        { text: 'early', start: 0, end: 2 },
        { text: 'mid', start: 4, end: 8 },
        { text: 'late', start: 9, end: 10 }
      ],
      { rangeTicks: { start: secToTicks(5), end: secToTicks(9) } }
    )
    assert.equal(ranged.length, 1)
    assert.equal(ranged[0].text, 'mid')
    assert.equal(ranged[0].offset, secToTicks(5))
    assert.equal(ranged[0].out, secToTicks(3))
    assert.deepEqual(cuesToCaptionClips('nope'), [])
  })

  it('cuesToCaptionClips time-slices cues longer than maxDurTicks', () => {
    const slices = cuesToCaptionClips(
      [{ text: 'a b c d e f g h', start: 0, end: 16 }],
      { maxDurTicks: secToTicks(6) }
    )
    assert.equal(slices.length, 3)
    for (const slice of slices) assert.ok(slice.out <= secToTicks(6))
    assert.equal(slices.map(slice => slice.out).reduce((a, b) => a + b, 0), secToTicks(16))
    assert.equal(slices.map(slice => slice.text).join(' '), 'a b c d e f g h')
  })
})
