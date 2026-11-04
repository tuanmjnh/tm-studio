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
import { paintStackAt, selectFileRows, selectPaintRows } from '../src/paintStack.mjs'
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

// =============================================================================
//  The FILE-WIDE row law (Zero-FFmpeg F3).
//
//  `selectPaintRows` answers "which rows paint at t?". A host that builds one
//  static graph for the whole file needs the union of that answer over every t
//  — and until now it wrote its own version of that union (the app's
//  `selectExportTracks` filtered `hidden` and required a clip to carry a `src`,
//  then took `[0]` as the base). Two rules that disagree about a row are exactly
//  what these tests exist to make impossible, so the file law is asserted as
//  the PER-TICK LAW SEEN WHOLE, not as its own filter.
// =============================================================================
describe('selectFileRows — the same law, asked of the whole file', () => {
  /** Rows the sweep below walks, in authored order. */
  const SWEEP = [
    timelineOf(['row-a', [clip('a', 0, 4)]]),
    timelineOf(['row-a', [clip('a', 0, 4)]], ['row-b', [clip('b', 6, 4)]]),
    timelineOf(['row-a', [clip('a', 0, 8)]], ['row-b', [clip('b', 3, 8)]]),
    timelineOf(['row-a', [clip('a', 0, 8)], { hidden: true }], ['row-b', [clip('b', 0, 8)]]),
    timelineOf(['row-a', [clip('a', 0, 0)]], ['row-b', [clip('b', 0, 4)]]),
    timelineOf(
      ['cap', [clip('t', 1, 2)], { type: 'text' }],
      ['row-a', [clip('a', 0, 4)]],
      ['music', [clip('m', 0, 9)], { type: 'audio' }],
      ['row-b', [clip('b', 6, 4)]]
    )
  ]
  /** Whole-second probes — every clip in SWEEP lives across at least one. */
  const PROBE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 30].map(seconds => seconds * T)

  it('the footage rows of the file are exactly the union of the per-tick rows', () => {
    for (const timeline of SWEEP) {
      const seen = []
      for (const at of PROBE) {
        for (const row of paintStackAt(timeline, at).rows) {
          if (!seen.includes(row.trackId)) seen.push(row.trackId)
        }
      }
      const layout = timeline.tracks.map(t => `${t.id}${t.hidden ? '!' : ''}`).join(',')
      assert.deepEqual(
        selectFileRows(timeline).rows.map(r => r.trackId),
        seen,
        `the file must not name a row the canvas never paints, nor drop one it does [${layout}]`
      )
    }
  })

  it('a row is read from the timeline, not from a sample of ticks', () => {
    // A 0.1 s clip between the whole-second probes: no per-tick answer at those
    // ticks names it, and the file law still must.
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]], ['row-narrow', [clip('n', 0.2, 0.1)]])
    assert.deepEqual(
      selectFileRows(timeline).rows.map(r => r.trackId),
      ['row-a', 'row-narrow'],
      'the file reaches a clip between the probes'
    )
    assert.deepEqual(
      paintStackAt(timeline, 0).rows.map(r => r.trackId),
      ['row-a'],
      'and the tick sample alone would have missed it'
    )
  })

  it('the bottom of the file stack is the FIRST row, not the earliest clip', () => {
    const timeline = timelineOf(
      ['row-late', [clip('l', 6, 4)]],
      ['row-early', [clip('e', 0, 4)]]
    )
    const plan = selectFileRows(timeline)
    assert.deepEqual(plan.rows.map(r => r.trackId), ['row-late', 'row-early'])
    assert.equal(plan.base.trackId, 'row-late', 'authored order is the paint order, file-wide')
    assert.deepEqual(plan.stacked.map(r => r.trackId), ['row-early'])
    assert.equal(paintStackAt(timeline, 1 * T).base.trackId, 'row-early',
      'at one tick only the row with a layer paints')
  })

  it('a hidden row leaves the file and the row below takes the base', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4)], { hidden: true }],
      ['row-b', [clip('b', 0, 4)]],
      ['row-c', [clip('c', 0, 4)]]
    )
    const plan = selectFileRows(timeline)
    assert.deepEqual(plan.rows.map(r => r.trackId), ['row-b', 'row-c'])
    assert.equal(plan.base.trackId, 'row-b')
    assert.deepEqual(plan.stacked.map(r => r.trackId), ['row-c'])
  })

  it('a row whose clips are all zero-duration is not a row of the file', () => {
    // The old app rule asked only whether a clip carried media, so a row of
    // trimmed-to-nothing clips could become the BASE — and the rows that
    // actually had frames were stacked on top of a bottom that paints nothing.
    const timeline = timelineOf(
      ['row-empty', [clip('z', 0, 0), clip('z2', 4, 0)]],
      ['row-live', [clip('a', 0, 4)]]
    )
    const plan = selectFileRows(timeline)
    assert.deepEqual(plan.rows.map(r => r.trackId), ['row-live'])
    assert.equal(plan.base.trackId, 'row-live')
    assert.deepEqual(plan.stacked, [])
  })

  it('text rows are the overlay lane and never the footage stack', () => {
    const timeline = timelineOf(
      ['cap-late', [clip('t2', 6, 2)], { type: 'text' }],
      ['cap-hidden', [clip('t3', 0, 4)], { type: 'text', hidden: true }],
      ['cap-zero', [clip('t4', 0, 0)], { type: 'text' }],
      ['row-a', [clip('a', 0, 4)]]
    )
    const plan = selectFileRows(timeline)
    assert.deepEqual(plan.overlays.map(r => r.trackId), ['cap-late'],
      'a caption row counts for the file whether or not it is live at tick 0')
    assert.deepEqual(plan.rows.map(r => r.trackId), ['row-a'], 'and stays out of the paint stack')
  })

  it('audio keeps the picture rule out: a hidden row is still mixed', () => {
    const timeline = timelineOf(
      ['music', [clip('m', 0, 9)], { type: 'audio', hidden: true }],
      ['sfx', [clip('s', 0, 9)], { type: 'audio' }]
    )
    const plan = selectFileRows(timeline)
    assert.deepEqual(plan.audio.map(r => r.trackId), ['music', 'sfx'],
      '`hidden` is a picture control; the sound lane reads `muted`, which core does not gate')
    assert.deepEqual(plan.rows, [])
  })

  it('carries row identity only — the items stay with the host', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]])
    assert.deepEqual(selectFileRows(timeline).rows, [{ trackId: 'row-a', trackIndex: 0 }])
  })

  it('trackIndex joins back to the authored track, lane by lane', () => {
    const timeline = timelineOf(
      ['cap', [clip('t', 0, 4)], { type: 'text' }],
      ['row-a', [clip('a', 0, 4)]],
      ['music', [clip('m', 0, 4)], { type: 'audio' }],
      ['row-b', [clip('b', 6, 4)]]
    )
    const plan = selectFileRows(timeline)
    const lanes = [plan.rows, plan.stacked, plan.overlays, plan.audio]
    assert.ok(lanes.flat().length > 0, 'the layout names rows in more than one lane')
    for (const lane of lanes) {
      for (const row of lane) {
        assert.equal(timeline.tracks[row.trackIndex].id, row.trackId,
          'the index is the position in the input tracks, exactly like the evaluation')
      }
    }
  })

  it('accepts a project wrapper, a bare timeline and nothing at all', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]])
    const EMPTY = { rows: [], base: null, stacked: [], overlays: [], audio: [] }
    assert.deepEqual(Object.keys(selectFileRows(timeline)).sort(), Object.keys(EMPTY).sort())
    assert.equal(selectFileRows(timeline).base.trackId, 'row-a')
    assert.deepEqual(selectFileRows({ timeline }), selectFileRows(timeline))
    assert.deepEqual(selectFileRows(null), EMPTY)
    assert.deepEqual(selectFileRows(undefined), EMPTY)
    assert.deepEqual(selectFileRows({ tracks: [{ id: 'no-type' }] }), EMPTY)
    assert.deepEqual(selectFileRows({ timeline: { tracks: 'not-an-array' } }), EMPTY)
  })
})
