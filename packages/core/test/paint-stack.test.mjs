// tmcut-core — paint stack tests. Run: node --test test/
//
// The row law (G18) is asserted as OUTCOMES — which track is at the BOTTOM of
// the stack — never as a re-run of the filter: a test that recomputed
// `!hidden && layers.length` would pass if the rule changed order or dropped
// the gap hand-off, and the whole point of the module is that the rule can
// only change HERE.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTimeline } from '../src/evaluate.mjs'
import { paintStackAt, selectPaintRows } from '../src/paintStack.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const T = TICKS_PER_SECOND

/** A DSL v3 footage clip on a row; `at`/`for` are whole seconds. */
function clip(id, at = 0, forSeconds = 4, overrides = {}) {
  return {
    id,
    type: 'video',
    locator: { runtime: 'local', path: `C:/media/${id}.mp4` },
    source: { in: 0, out: forSeconds * T },
    timeline: { start: at * T, duration: forSeconds * T },
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: [],
    ...overrides
  }
}

/** Tracks given as `[id, clips, trackOverrides]`, in array (paint) order. */
function timelineOf(...rows) {
  return {
    version: 3,
    markers: [],
    tracks: rows.map(([id, clips, overrides]) => ({
      id,
      type: 'video',
      items: clips,
      ...overrides
    }))
  }
}

/** Which row owns the canvas at `atTicks` (null when nothing footage paints). */
function baseIdAt(timeline, atTicks) {
  const stack = paintStackAt(timeline, atTicks)
  return stack.base ? stack.base.trackId : null
}

describe('selectPaintRows — the row law, bottom of the stack first', () => {
  it('one footage row owns the canvas for its whole window', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]])
    assert.deepEqual(paintStackAt(timeline, 0).rows.map(r => r.trackId), ['row-a'])
    assert.equal(baseIdAt(timeline, 0), 'row-a')
    assert.equal(baseIdAt(timeline, 4 * T - 1), 'row-a')
  })

  it('the half-open window boundary hands the canvas over at the end tick', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]])
    assert.equal(baseIdAt(timeline, 4 * T), null)
  })

  it('no rows for an empty timeline, a null input or a tick past the end', () => {
    assert.deepEqual(paintStackAt(timelineOf(), 0), { at: 0, rows: [], base: null })
    assert.deepEqual(paintStackAt(null, 0), { at: 0, rows: [], base: null })
    assert.equal(baseIdAt(timelineOf(['row-a', [clip('a', 0, 4)]]), 60 * T), null)
  })

  it('a gap paints no row, and the next row takes the canvas when it starts', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4)]],
      ['row-b', [clip('b', 6, 4)]]
    )
    assert.equal(baseIdAt(timeline, 1 * T), 'row-a')
    assert.equal(baseIdAt(timeline, 5 * T), null, 'the gap paints no row')
    assert.equal(baseIdAt(timeline, 6 * T), 'row-b')
    assert.equal(baseIdAt(timeline, 7 * T), 'row-b')
    // The hand-off the preview already does: row A has a gap where row B lives.
    const handoff = timelineOf(
      ['row-a', [clip('a', 0, 4)]],
      ['row-b', [clip('b', 3, 8)]]
    )
    assert.equal(baseIdAt(handoff, 1 * T), 'row-a')
    assert.equal(baseIdAt(handoff, 5 * T), 'row-b')
    // Overlap window: both rows are paintable, and the BOTTOM of the stack —
    // the row a single-surface host paints — is the FIRST.
    const both = timelineOf(
      ['row-a', [clip('a', 0, 8)]],
      ['row-b', [clip('b', 2, 8)]]
    )
    assert.equal(baseIdAt(both, 3 * T), 'row-a')
  })

  it('a hidden row never paints, so the row below it takes the canvas', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 8)], { hidden: true }],
      ['row-b', [clip('b', 0, 8)]]
    )
    assert.equal(baseIdAt(timeline, 1 * T), 'row-b')
  })

  it('rows are reported in track order, so the dropped ones are identifiable', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 8)]],
      ['row-b', [clip('b', 0, 8)]],
      ['row-c', [clip('c', 0, 8)]]
    )
    const stack = paintStackAt(timeline, 1 * T)
    assert.deepEqual(stack.rows.map(r => r.trackId), ['row-a', 'row-b', 'row-c'])
    assert.deepEqual(stack.rows.map(r => r.trackIndex), [0, 1, 2])
    assert.equal(stack.base.trackId, 'row-a')
  })

  it('only footage rows count: text and audio tracks never enter the stack', () => {
    const timeline = timelineOf(
      ['cap', [clip('t', 0, 4)], { type: 'text' }],
      ['row-a', [clip('a', 0, 4)]],
      ['music', [clip('m', 0, 4)], { type: 'audio' }]
    )
    assert.deepEqual(paintStackAt(timeline, 1 * T).rows.map(r => r.trackId), ['row-a'])
  })

  it('a row of zero-duration clips does not own the canvas', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 0)]],
      ['row-b', [clip('b', 0, 4)]]
    )
    assert.equal(baseIdAt(timeline, 1 * T), 'row-b')
  })

  it('a transparent layer still claims its row (measured, not assumed)', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4, { transform: { opacity: 0 } })]],
      ['row-b', [clip('b', 0, 4)]]
    )
    const layer = evaluateTimeline(timeline, 1 * T).tracks[0].layers[0]
    assert.equal(layer.visible, false, 'the evaluator marks it invisible')
    assert.equal(baseIdAt(timeline, 1 * T), 'row-a', 'and the row still owns the canvas')
  })
})

describe('paintStackAt — inputs and entry points', () => {
  it('accepts the app store flat shape (offset + in/out + percent opacity)', () => {
    const timeline = {
      tracks: [
        { id: 'row-a', type: 'video', hidden: true, items: [{ id: 'a', type: 'video', src: 'C:/media/a.mp4', offset: 0, in: 0, out: 4 * T }] },
        { id: 'row-b', type: 'video', items: [{ id: 'b', type: 'video', src: 'C:/media/b.mp4', offset: 0, in: 0, out: 4 * T, opacity: 100 }] }
      ]
    }
    assert.equal(baseIdAt(timeline, 1 * T), 'row-b')
  })

  it('accepts a project wrapper, not only a bare timeline', () => {
    const project = { timeline: timelineOf(['row-a', [clip('a', 0, 4)]]) }
    assert.equal(baseIdAt(project, 1 * T), 'row-a')
  })

  it('the cached-evaluation entry point and the one-shot entry point agree', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4)]],
      ['row-b', [clip('b', 2, 4)]],
      ['cap', [clip('t', 0, 4)], { type: 'text' }]
    )
    for (const at of [0, 1, 3, 5, 6, 10]) {
      const ticks = at * T
      assert.deepEqual(
        selectPaintRows(evaluateTimeline(timeline, ticks)),
        paintStackAt(timeline, ticks),
        `both entry points must give one answer at ${at}s`
      )
    }
  })

  it('trackIndex is the row the host authored, so joining back is one lookup', () => {
    const timeline = timelineOf(
      ['cap', [clip('t', 0, 4)], { type: 'text' }],
      ['row-a', [clip('a', 0, 4)]],
      ['music', [clip('m', 0, 4)], { type: 'audio' }],
      ['row-b', [clip('b', 0, 4)]]
    )
    const stack = paintStackAt(timeline, 1 * T)
    assert.deepEqual(stack.rows.map(r => r.trackIndex), [1, 3])
    for (const row of stack.rows) {
      assert.equal(timeline.tracks[row.trackIndex].id, row.trackId)
      assert.equal(evaluateTimeline(timeline, 1 * T).tracks[row.trackIndex].id, row.trackId)
    }
  })

  it('reports the tick it was asked about, clamped and rounded like the evaluator', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]])
    assert.equal(paintStackAt(timeline, 1234.7).at, 1235)
    assert.equal(paintStackAt(timeline, -5).at, 0)
    assert.equal(paintStackAt(timeline, Number.NaN).at, 0)
  })

  it('tolerates a malformed evaluation without throwing', () => {
    assert.deepEqual(selectPaintRows(null), { at: 0, rows: [], base: null })
    assert.deepEqual(selectPaintRows({ at: 5, tracks: [{ type: 'video', hidden: false }] }), { at: 5, rows: [], base: null })
    assert.equal(selectPaintRows({ at: 5, tracks: [{ type: 'video', layers: [{}] }] }).rows[0].trackId, null)
  })
})
