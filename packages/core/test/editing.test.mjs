// @tmcut/core — editing + lock-guard tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  moveClips,
  duplicateClips,
  copyClips,
  pasteClips,
  rippleDelete,
  insertClipRipple,
  closeGaps,
  snapTime,
  snapTimeDetailed
} from '../src/editing.mjs'
import { addClip, removeClip, splitClip, moveClip, trimClip, totalDurationTicks } from '../src/timeline.mjs'
import { secToTicks, TICKS_PER_SECOND } from '../src/time.mjs'
import { defaultTimeline } from '../src/project.mjs'

function videoTimeline() {
  const timeline = defaultTimeline()
  const first = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(4) } })
  const second = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(4) } })
  return { timeline, first, second }
}

describe('lock guards', () => {
  it('refuses every mutation on locked tracks', () => {
    const { timeline, first } = videoTimeline()
    const track = timeline.tracks.find(t => t.type === 'video')
    track.locked = true
    assert.equal(addClip(timeline, 'video', { source: { in: 0, out: 10 } }), null)
    assert.equal(removeClip(timeline, first.id), false)
    assert.equal(splitClip(timeline, first.id, secToTicks(2)), null)
    assert.equal(moveClip(timeline, first.id, secToTicks(9)), false)
    assert.equal(trimClip(timeline, first.id, 'out', secToTicks(2)), false)
    assert.equal(first.timeline.start, 0)
  })
})

describe('editing', () => {
  it('moves clip sets with group expansion', () => {
    const { timeline, first, second } = videoTimeline()
    const result = moveClips(timeline, [first.id], secToTicks(2))
    assert.deepEqual(result, { moved: 1, skippedLocked: 0 })
    assert.equal(first.timeline.start, secToTicks(2))
    assert.equal(second.timeline.start, secToTicks(4))
  })

  it('skips locked members when moving sets', () => {
    const timeline = defaultTimeline()
    const free = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) }, groupId: 'g' })
    addClip(timeline, 'audio', { source: { in: 0, out: secToTicks(2) }, groupId: 'g' })
    const audioTrack = timeline.tracks.find(t => t.type === 'audio')
    audioTrack.locked = true
    const result = moveClips(timeline, [free.id], secToTicks(1))
    assert.equal(result.moved, 1)
    assert.equal(result.skippedLocked, 1)
  })

  it('duplicates clips with fresh ids and regrouped copies', () => {
    const timeline = defaultTimeline()
    const original = addClip(timeline, 'video', {
      source: { in: secToTicks(1), out: secToTicks(5) },
      groupId: 'g1',
      linkId: 'l1'
    })
    const copies = duplicateClips(timeline, [original.id], secToTicks(10))
    assert.equal(copies.length, 1)
    const copy = copies[0]
    assert.notEqual(copy.id, original.id)
    assert.equal(copy.linkId, null)
    assert.equal(copy.timeline.start, secToTicks(10))
    assert.equal(copy.source.in, original.source.in)
    assert.deepEqual(duplicateClips(timeline, ['ghost']), [])
  })

  it('copies and pastes preserving relative offsets', () => {
    const timeline = defaultTimeline()
    const first = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) } })
    const second = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) } })
    const clipboard = copyClips(timeline, [first.id, second.id])
    assert.ok(clipboard)
    assert.equal(copyClips(timeline, ['ghost']), null)
    const ids = pasteClips(timeline, clipboard, secToTicks(20))
    assert.equal(ids.length, 2)
    assert.equal(totalDurationTicks(timeline), secToTicks(24))
    assert.deepEqual(pasteClips(timeline, { version: 99 }, 0), [])
  })

  it('ripple-deletes and closes the gap', () => {
    const { timeline, first, second } = videoTimeline()
    const shifted = rippleDelete(timeline, first.id)
    assert.equal(shifted, 1)
    assert.equal(second.timeline.start, 0)
    assert.equal(totalDurationTicks(timeline), secToTicks(4))
    assert.equal(rippleDelete(timeline, 'ghost'), null)
  })

  it('leaves locked tracks untouched on cross-track ripple', () => {
    const timeline = defaultTimeline()
    const video = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(4) } })
    const following = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(4) } })
    const audio = addClip(timeline, 'audio', {
      source: { in: secToTicks(4), out: secToTicks(8) },
      offset: secToTicks(4)
    })
    const audioTrack = timeline.tracks.find(t => t.type === 'audio')
    audioTrack.locked = true
    const shifted = rippleDelete(timeline, video.id, { acrossTracks: true })
    assert.equal(shifted, 1)
    assert.equal(following.timeline.start, 0)
    assert.equal(audio.timeline.start, secToTicks(4))
  })

  it('snaps to playhead, edges and markers', () => {
    const { timeline, second } = videoTimeline()
    const near = second.timeline.start + Math.round(TICKS_PER_SECOND * 0.05)
    assert.equal(snapTime(timeline, near, {}), second.timeline.start)
    const far = second.timeline.start + TICKS_PER_SECOND
    assert.equal(snapTime(timeline, far, {}), far)
    assert.equal(snapTime(timeline, 50, { playheadTicks: 55 }), 55)
    assert.equal(snapTime(timeline, 50, { playheadTicks: 55, ignoreIds: [] }), 55)
    assert.equal(snapTime(timeline, -30, {}), 0)
  })

  it('snapTimeDetailed reports what it snapped to', () => {
    const { timeline, first, second } = videoTimeline()
    const secondEnd = second.timeline.start + secToTicks(4)

    // Just past the shared boundary between the two clips: the position
    // snaps to that boundary (second's start === first's end; the first
    // candidate pushed wins the tie, so either kind is valid).
    const near = second.timeline.start + Math.round(TICKS_PER_SECOND * 0.04)
    const toStart = snapTimeDetailed(timeline, near, {})
    assert.equal(toStart.ticks, second.timeline.start)
    assert.ok(toStart.snapped)
    assert.ok(['clip-start', 'clip-end'].includes(toStart.snapped.kind))
    assert.ok([first.id, second.id].includes(toStart.snapped.fromId))

    // Playhead beats a distant clip edge (tight threshold).
    const toPlayhead = snapTimeDetailed(timeline, 50, { playheadTicks: 55, thresholdTicks: 60 })
    assert.equal(toPlayhead.ticks, 55)
    assert.equal(toPlayhead.snapped?.kind, 'playhead')

    // Project start (0) is a candidate.
    const toZero = snapTimeDetailed(timeline, 40, { thresholdTicks: 60 })
    assert.equal(toZero.ticks, 0)
    assert.equal(toZero.snapped?.kind, 'zero')

    // Nothing within the threshold: position is only clamped, snapped is null.
    const far = second.timeline.start + TICKS_PER_SECOND
    const noSnap = snapTimeDetailed(timeline, far, {})
    assert.equal(noSnap.ticks, far)
    assert.equal(noSnap.snapped, null)

    // ignoreIds excludes the dragged clip's OWN edges: near its end there
    // is no other candidate, so nothing snaps...
    const own = snapTimeDetailed(timeline, secondEnd - 10, {
      thresholdTicks: 60,
      ignoreIds: [second.id]
    })
    assert.equal(own.snapped, null)
    // ...while the same spot snaps to its own end when not ignored.
    const selfSnap = snapTimeDetailed(timeline, secondEnd - 10, { thresholdTicks: 60 })
    assert.equal(selfSnap.snapped?.kind, 'clip-end')
    assert.equal(selfSnap.snapped?.fromId, second.id)
  })
})

describe('ripple insert & close gaps (C2)', () => {
  it('inserts with ripple: later clips shift by the new duration', () => {
    const timeline = defaultTimeline()
    addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) }, timeline: { start: 0 } })
    addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) }, timeline: { start: secToTicks(2) } })
    const result = insertClipRipple(timeline, 'video', { source: { in: 0, out: secToTicks(1) } }, secToTicks(1))
    assert.ok(result)
    // Only the clip at 2s starts at/after 1s → it moves to 3s; 0s stays.
    assert.equal(result.shifted, 1)
    const track = timeline.tracks.find(t => t.type === 'video')
    const inserted = track.items.find(i => i.id === result.clip.id)
    assert.equal(inserted.timeline.start, secToTicks(1))
    const starts = track.items.filter(i => i.id !== result.clip.id).map(i => i.timeline.start).sort((a, b) => a - b)
    assert.deepEqual(starts, [0, secToTicks(3)])
  })

  it('shifts across tracks on request and never touches locked tracks', () => {
    const timeline = defaultTimeline()
    const video = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) }, timeline: { start: secToTicks(2) } })
    const audio = addClip(timeline, 'audio', { source: { in: 0, out: secToTicks(2) }, timeline: { start: secToTicks(2) } })
    const result = insertClipRipple(timeline, 'video', { source: { in: 0, out: secToTicks(1) } }, 0, { acrossTracks: true })
    assert.ok(result)
    assert.equal(result.shifted, 2)
    assert.equal(video.timeline.start, secToTicks(3))
    assert.equal(audio.timeline.start, secToTicks(3))
    // A locked target track refuses the insert entirely.
    timeline.tracks.find(t => t.type === 'video').locked = true
    assert.equal(insertClipRipple(timeline, 'video', { source: { in: 0, out: 100 } }, 0), null)
  })

  it('inserts into empty timelines and past the end without shifting', () => {
    const timeline = defaultTimeline()
    const empty = insertClipRipple(timeline, 'video', { source: { in: 0, out: secToTicks(3) } }, 0)
    assert.ok(empty)
    assert.equal(empty.shifted, 0)
    const past = insertClipRipple(timeline, 'video', { source: { in: 0, out: secToTicks(1) } }, secToTicks(30))
    assert.ok(past)
    assert.equal(past.shifted, 0)
  })

  it('closes gaps per track and reports seconds', () => {
    const timeline = defaultTimeline()
    // video: [0..2s] [5..7s] → 3s of gap; audio keeps a 4s gap.
    addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) }, timeline: { start: 0 } })
    const videoSecond = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) }, timeline: { start: secToTicks(5) } })
    const audioOnly = addClip(timeline, 'audio', { source: { in: 0, out: secToTicks(1) }, timeline: { start: secToTicks(4) } })
    assert.equal(closeGaps(timeline, { trackType: 'video' }), 3)
    assert.equal(videoSecond.timeline.start, secToTicks(2))
    assert.equal(audioOnly.timeline.start, secToTicks(4)) // untouched
    assert.equal(closeGaps(timeline), 4) // the audio gap now closes too
    assert.equal(audioOnly.timeline.start, 0)
    assert.equal(closeGaps(timeline), 0) // nothing left to close
    // Locked tracks are skipped entirely.
    const locked = defaultTimeline()
    addClip(locked, 'video', { source: { in: 0, out: secToTicks(1) }, timeline: { start: secToTicks(3) } })
    locked.tracks.find(t => t.type === 'video').locked = true
    assert.equal(closeGaps(locked), 0)
  })
})
