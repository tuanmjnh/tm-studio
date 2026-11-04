// tmcut-core — composite plan tests. Run: node --test test/
//
// The plan is the answer BOTH hosts paint from: which layer of each footage row
// owns its slot, which layer is a transition's outgoing partner, and what is
// painted over the whole stack. It exists because the preview used to answer
// "top layer of row 0" and the exporter answered "row 0 for the whole file,
// then whatever rows 1..n the gap left" — two decisions, one screen. A test that
// re-ran the filters would pass if the order changed, so every case below is
// written as an OUTCOME: which clipId lands in which slot.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateTimeline } from '../src/evaluate.mjs'
import { compositePlan } from '../src/composite.mjs'
import { selectPaintRows } from '../src/paintStack.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const T = TICKS_PER_SECOND

/** A footage/text/audio track item; `at`/`for` are whole seconds. */
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

/** The plan's slots as `kind:role:clipId`, bottom of the stack first. */
function slotList(plan) {
  return plan.slots.map(slot => `${slot.kind}:${slot.role}:${slot.clipId}`)
}

describe('compositePlan — the footage stack', () => {
  it('every visible row with a live layer gets a slot, in track order', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 8)]],
      ['row-b', [clip('b', 0, 8)]],
      ['row-c', [clip('c', 0, 8)]]
    )
    const plan = compositePlan(evaluateTimeline(timeline, 1 * T))
    assert.deepEqual(slotList(plan), [
      'footage:paint:a', 'footage:paint:b', 'footage:paint:c'
    ])
  })

  it('a row whose clip has a gap holds no slot, and the rows beside it keep theirs', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4)]],
      ['row-b', [clip('b', 6, 4)]]
    )
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 1 * T))), ['footage:paint:a'])
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 7 * T))), ['footage:paint:b'])
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 5 * T))), [])
  })

  it('within one row the latest-starting layer paints, and the earlier one does not', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 8), clip('b', 2, 8)]])
    const plan = compositePlan(evaluateTimeline(timeline, 3 * T))
    assert.deepEqual(slotList(plan), ['footage:paint:b'])
  })

  it('a hidden row is dropped whole, so the row below it still paints', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 8)], { hidden: true }],
      ['row-b', [clip('b', 0, 8)]]
    )
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 1 * T))), ['footage:paint:b'])
  })

  it('a transparent layer keeps its slot — visible:false is a look, not a removal', () => {
    const timeline = timelineOf([
      'row-a',
      [clip('a', 0, 4, { transform: { opacity: 0 } })]
    ])
    const plan = compositePlan(evaluateTimeline(timeline, 1 * T))
    assert.deepEqual(slotList(plan), ['footage:paint:a'])
    assert.equal(plan.slots[0].layer.visible, false)
  })
})

describe('compositePlan — a transition belongs to its own row', () => {
  // The pair must OVERLAP: core derives a window from the incoming clip's
  // `transitionIn.duration` alone, starting at that clip's own start, and needs
  // a neighbour whose end lands on the window end. A butt cut (in at 4 s after
  // a 4 s clip) therefore has no window at all.
  const WINDOW_AT = 3 * T
  const WINDOW_MID = WINDOW_AT + T / 2

  function pairRow(rowId, trackOverrides = {}) {
    return [
      rowId,
      [
        clip('out', 0, 4),
        clip('in', 3, 4, { transitionIn: { type: 'fade', duration: 1 * T } })
      ],
      trackOverrides
    ]
  }

  it('inside the window the row gives two slots: outgoing under the paint layer', () => {
    const timeline = timelineOf(pairRow('row-a'))
    const plan = compositePlan(evaluateTimeline(timeline, WINDOW_MID))
    assert.deepEqual(slotList(plan), ['footage:outgoing:out', 'footage:paint:in'])
  })

  it('outside the window the row gives one slot again', () => {
    const timeline = timelineOf(pairRow('row-a'))
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 1 * T))), ['footage:paint:out'])
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 6 * T))), ['footage:paint:in'])
  })

  it('a window in one row does not touch the paint layer of another', () => {
    const timeline = timelineOf(pairRow('row-a'), ['row-b', [clip('b', 0, 8)]])
    const plan = compositePlan(evaluateTimeline(timeline, WINDOW_MID))
    assert.deepEqual(slotList(plan), [
      'footage:outgoing:out', 'footage:paint:in', 'footage:paint:b'
    ])
    assert.deepEqual(plan.slots.map(s => s.trackId), ['row-a', 'row-a', 'row-b'])
  })

  it('a window on a hidden row never reaches the screen', () => {
    const timeline = timelineOf(pairRow('row-a', { hidden: true }), ['row-b', [clip('b', 0, 8)]])
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, WINDOW_MID))), ['footage:paint:b'])
  })

  it('the outgoing slot carries its own layer, so the host seeks that clip instead of the playhead', () => {
    const timeline = timelineOf(pairRow('row-a'))
    const plan = compositePlan(evaluateTimeline(timeline, WINDOW_MID))
    const outgoing = plan.slots[0]
    assert.equal(outgoing.role, 'outgoing')
    assert.equal(outgoing.layer.sourceTicks, WINDOW_MID)
    assert.equal(outgoing.layer.transition.progress, 0.5)
    assert.equal(plan.slots[1].layer.transition.role, 'incoming')
  })
})

describe('compositePlan — overlays and exclusions', () => {
  it('text from EVERY visible text track enters, after all footage', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4)]],
      ['cap-top', [clip('t1', 0, 4)], { type: 'text' }],
      ['cap-bottom', [clip('t2', 0, 4)], { type: 'text' }]
    )
    const plan = compositePlan(evaluateTimeline(timeline, 1 * T))
    assert.deepEqual(slotList(plan), [
      'footage:paint:a', 'overlay:paint:t1', 'overlay:paint:t2'
    ])
  })

  it('a hidden text track and an audio track never enter the plan', () => {
    const timeline = timelineOf(
      ['row-a', [clip('a', 0, 4)]],
      ['cap', [clip('t1', 0, 4)], { type: 'text', hidden: true }],
      ['music', [clip('m1', 0, 4)], { type: 'audio' }]
    )
    assert.deepEqual(slotList(compositePlan(evaluateTimeline(timeline, 1 * T))), ['footage:paint:a'])
  })

  it('a slot carries the layer the evaluator produced, not a copy of a decision', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4, { transform: { opacity: 0.5 } })]])
    const evaluation = evaluateTimeline(timeline, 1 * T)
    const plan = compositePlan(evaluation)
    assert.equal(plan.slots[0].layer, evaluation.layers[0])
    assert.equal(plan.slots[0].layer.opacity, 0.5)
  })

  it('the plan is one pass over an evaluation it is handed — it never re-evaluates', () => {
    const timeline = timelineOf(['row-a', [clip('a', 0, 4)]])
    const evaluation = evaluateTimeline(timeline, 1 * T)
    // Same answer as the row law it is built on, so the two modules cannot drift.
    const rows = selectPaintRows(evaluation).rows
    const plan = compositePlan(evaluation)
    assert.deepEqual(plan.slots.filter(s => s.kind === 'footage').map(s => s.trackIndex),
      rows.map(r => r.trackIndex))
    assert.equal(plan.at, evaluation.at)
  })
})

describe('compositePlan — inputs that are not a plan', () => {
  it('a null evaluation, an empty timeline and a tick past the end all give an empty plan', () => {
    assert.deepEqual(compositePlan(null), { at: 0, slots: [] })
    assert.deepEqual(compositePlan(evaluateTimeline(timelineOf(), 0)), { at: 0, slots: [] })
    assert.deepEqual(compositePlan(evaluateTimeline(timelineOf(['row-a', [clip('a', 0, 4)]]), 60 * T)),
      { at: 60 * T, slots: [] })
  })

  it('a malformed track shape is tolerated without throwing', () => {
    assert.deepEqual(compositePlan({ at: 3, tracks: [{ type: 'video' }] }), { at: 3, slots: [] })
    assert.deepEqual(compositePlan({ at: 3, tracks: [{ type: 'text', layers: [{}] }] }).slots, [])
  })
})
