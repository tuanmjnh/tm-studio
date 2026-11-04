// Slice E3 — a silence scan may cover part of a file, but the timeline speaks
// source seconds. The reader starts wherever the clip was trimmed to, so the
// law needs to know where its first window sits; the glue must not add the two
// numbers itself.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { silenceSpans } from '../src/detection.mjs'

const quiet = [-60, -60, -60, -60]
const loud = [0, 0, 0, 0]

describe('silenceSpans offsetSec', () => {
  it('measures the span from the offset, not from the first window', () => {
    assert.deepEqual(
      silenceSpans(quiet, { windowSec: 1, noiseDb: -30, minDurationSec: 1, offsetSec: 12 }),
      [{ start: 12, end: 16 }]
    )
  })

  it('defaults to zero, so an untrimmed read is unchanged', () => {
    assert.deepEqual(
      silenceSpans(quiet, { windowSec: 1, noiseDb: -30, minDurationSec: 1 }),
      [{ start: 0, end: 4 }]
    )
  })

  it('keeps the duration ceiling relative to the read, then shifts it', () => {
    assert.deepEqual(
      silenceSpans(quiet, { windowSec: 1, noiseDb: -30, minDurationSec: 1, durationSec: 2.5, offsetSec: 12 }),
      [{ start: 12, end: 14.5 }]
    )
  })

  it('measures the run without the offset, so shifting can neither invent nor lose a span', () => {
    const levels = [...loud, ...quiet, ...loud]
    assert.deepEqual(
      silenceSpans(levels, { windowSec: 1, noiseDb: -30, minDurationSec: 2, offsetSec: 30 }),
      [{ start: 34, end: 38 }]
    )
    assert.deepEqual(
      silenceSpans(levels, { windowSec: 1, noiseDb: -30, minDurationSec: 5, offsetSec: 30 }),
      []
    )
  })

  it('treats a nonsense offset as the start of the file', () => {
    const options = { windowSec: 1, noiseDb: -30, minDurationSec: 1 }
    assert.deepEqual(silenceSpans(quiet, { ...options, offsetSec: -5 }), [{ start: 0, end: 4 }])
    assert.deepEqual(silenceSpans(quiet, { ...options, offsetSec: Number.NaN }), [{ start: 0, end: 4 }])
    assert.deepEqual(silenceSpans(quiet, { ...options, offsetSec: 'x' }), [{ start: 0, end: 4 }])
  })
})
