// @tmcut/core — transitions tests (Roadmap C5). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  KNOWN_TRANSITIONS,
  canApplyTransition,
  applyTransition,
  clearTransition,
  transitionWindows
} from '../src/transitions.mjs'
import { addClip } from '../src/timeline.mjs'
import { defaultTimeline } from '../src/project.mjs'
import { secToTicks } from '../src/time.mjs'

// Two adjacent 2 s clips: A [0..2s], B [2s..4s] (addClip appends).
function pair() {
  const timeline = defaultTimeline()
  const a = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) } })
  const b = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) } })
  const track = timeline.tracks.find(t => t.type === 'video')
  return { timeline, track, a, b }
}

describe('transitions (C5)', () => {
  it('refuses unknown types and non-positive durations', () => {
    // R128 froze this exact 45-key list: the 6 legacy keys first (stored
    // projects), then the remaining xfade names in alphabetical order.
    // The app-side catalog test pins the same list — change one, change both.
    assert.deepEqual(KNOWN_TRANSITIONS, [
      'fade', 'dissolve', 'wipe-left', 'wipe-right', 'slide-left', 'zoom-in',
      'circleclose', 'circlecrop', 'circleopen', 'diagbl', 'diagbr', 'diagtl',
      'diagtr', 'distance', 'fadeblack', 'fadegrays', 'fadewhite', 'hblur',
      'hlslice', 'hrslice', 'horzclose', 'horzopen', 'pixelize', 'radial',
      'rectcrop', 'slidedown', 'slideright', 'slideup', 'smoothdown',
      'smoothleft', 'smoothright', 'smoothup', 'squeezeh', 'squeezev',
      'vertclose', 'vertopen', 'vdslice', 'vuslice', 'wipebl', 'wipebr',
      'wipedown', 'wipetl', 'wipetr', 'wipeup', 'zoomin'
    ])
    assert.equal(new Set(KNOWN_TRANSITIONS).size, KNOWN_TRANSITIONS.length)
    // R128 keys must validate as known types (canApplyTransition gate).
    const fresh = pair()
    assert.deepEqual(canApplyTransition(fresh.timeline, fresh.b.id, 'circleopen', secToTicks(0.5)), { ok: true, overlapTicks: secToTicks(0.5) })
    const { timeline, b } = pair()
    assert.deepEqual(
      canApplyTransition(timeline, b.id, 'star-wipe', secToTicks(0.5)),
      { ok: false, reason: 'unknown-type' }
    )
    assert.equal(canApplyTransition(timeline, b.id, 'fade', 0).reason, 'too-long')
    assert.equal(canApplyTransition(timeline, b.id, 'fade', -5).reason, 'too-long')
    assert.equal(applyTransition(timeline, b.id, 'star-wipe', secToTicks(0.5)), false)
  })

  it('refuses the first clip and unknown ids (no-neighbor)', () => {
    const { timeline, a, b } = pair()
    assert.deepEqual(canApplyTransition(timeline, a.id, 'fade', secToTicks(0.5)), { ok: false, reason: 'no-neighbor' })
    assert.deepEqual(canApplyTransition(timeline, 'ghost', 'fade', secToTicks(0.5)), { ok: false, reason: 'no-neighbor' })
    assert.equal(applyTransition(timeline, 'ghost', 'fade', secToTicks(0.5)), false)
    assert.equal(clearTransition(timeline, 'ghost'), false)
    // Valid request on B for contrast.
    assert.equal(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)).ok, true)
  })

  it('refuses a gap between the neighbor and the cut', () => {
    const { timeline, b } = pair()
    b.timeline.start = secToTicks(3) // B no longer touches A's end
    assert.deepEqual(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)), { ok: false, reason: 'gap' })
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), false)
    // The untouched cut position must remain (apply failed atomically).
    assert.equal(b.timeline.start, secToTicks(3))
    assert.equal(b.transitionIn, undefined)
  })

  it('refuses overlaps longer than either clip of the pair', () => {
    const { timeline, b } = pair() // both clips are 2 s
    assert.deepEqual(
      canApplyTransition(timeline, b.id, 'fade', secToTicks(3)),
      { ok: false, reason: 'too-long' }
    )
    const exact = canApplyTransition(timeline, b.id, 'dissolve', secToTicks(2))
    assert.equal(exact.ok, true)
    assert.equal(exact.overlapTicks, secToTicks(2))
  })

  it('applies the overlap and reports the window', () => {
    const { timeline, track, a, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    // B shifted LEFT by 0.5 s so both layers overlap.
    assert.equal(b.timeline.start, secToTicks(1.5))
    assert.deepEqual(b.transitionIn, { type: 'fade', duration: secToTicks(0.5) })
    assert.deepEqual(transitionWindows(track), [
      { fromId: a.id, toId: b.id, startTicks: secToTicks(1.5), endTicks: secToTicks(2) }
    ])
    // Neighbor A never moves.
    assert.equal(a.timeline.start, 0)
    // Broken pair (neighbor no longer ends at the overlap end) is skipped.
    a.source.out = secToTicks(1)
    a.timeline.duration = secToTicks(1)
    assert.deepEqual(transitionWindows(track), [])
  })

  it('re-applying replaces the previous shift instead of stacking', () => {
    const { timeline, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    assert.equal(b.timeline.start, secToTicks(1.5))
    assert.equal(applyTransition(timeline, b.id, 'wipe-left', secToTicks(1)), true)
    // Total shift is exactly 1 s — the old 0.5 s shift was restored first.
    assert.equal(b.timeline.start, secToTicks(1))
    assert.deepEqual(b.transitionIn, { type: 'wipe-left', duration: secToTicks(1) })
    // The effective cut (start + stored duration) still touches A's end.
    assert.equal(canApplyTransition(timeline, b.id, 'zoom-in', secToTicks(0.5)).ok, true)
  })

  it('keeps validating against the un-shifted cut once applied', () => {
    const { timeline, a, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    // Trim A shorter: the ORIGINAL cut (start + stored duration) now has a
    // gap, even though raw B.start touches A's new end.
    a.source.out = secToTicks(1.5)
    a.timeline.duration = secToTicks(1.5)
    assert.equal(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)).reason, 'gap')
  })

  it('clearing restores the original cut position', () => {
    const { timeline, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    assert.equal(clearTransition(timeline, b.id), true)
    assert.equal(b.timeline.start, secToTicks(2))
    assert.equal(b.transitionIn, undefined)
    assert.equal(clearTransition(timeline, b.id), false) // nothing left
  })

  it('locked tracks refuse apply and clear (core lock-guard)', () => {
    const { timeline, track, b } = pair()
    track.locked = true
    assert.deepEqual(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)), { ok: false, reason: 'locked' })
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), false)
    assert.equal(clearTransition(timeline, b.id), false)
    track.locked = false
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    track.locked = true
    assert.equal(clearTransition(timeline, b.id), false)
    assert.equal(b.timeline.start, secToTicks(1.5)) // still shifted, untouched
  })
})
