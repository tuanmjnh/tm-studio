// @tmcut/core — timeline tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  clipDurationTicks,
  clipEndTicks,
  totalDurationTicks,
  findClip,
  ensureTrack,
  nextTrackName,
  addTrack,
  removeTrack,
  addClip,
  removeClip,
  splitClip,
  moveClip,
  trimClip,
  validateTimeline
} from '../src/timeline.mjs'
import { secToTicks } from '../src/time.mjs'
import { defaultTimeline } from '../src/project.mjs'

function makeTimeline() {
  return defaultTimeline()
}

describe('timeline', () => {
  it('appends clips after the last clip end', () => {
    const timeline = makeTimeline()
    const first = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(10) } })
    const second = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(5) } })
    assert.equal(first.timeline.start, 0)
    assert.equal(second.timeline.start, secToTicks(10))
    assert.equal(totalDurationTicks(timeline), secToTicks(15))
  })

  it('adjusts media range by speed', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(10) }, speed: 2 })
    assert.equal(clipDurationTicks(clip), secToTicks(5))
    assert.equal(clipEndTicks(clip), secToTicks(5))
  })

  it('finds and removes clips', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(4) } })
    const found = findClip(timeline, clip.id)
    assert.equal(found.clip.id, clip.id)
    assert.equal(found.track.type, 'video')
    assert.equal(removeClip(timeline, clip.id), true)
    assert.equal(removeClip(timeline, clip.id), false)
    assert.equal(findClip(timeline, clip.id), null)
  })

  it('splits a clip into two exact pieces', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(10) } })
    const second = splitClip(timeline, clip.id, secToTicks(4))
    assert.ok(second)
    assert.equal(clip.source.out, secToTicks(4))
    assert.equal(second.source.in, secToTicks(4))
    assert.equal(second.source.out, secToTicks(10))
    assert.equal(second.timeline.start, secToTicks(4))
    assert.equal(totalDurationTicks(timeline), secToTicks(10))
  })

  it('does not hand the transition to the split tail', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', {
      source: { in: 0, out: secToTicks(10) },
      transitionIn: { type: 'fade', duration: secToTicks(0.5) }
    })
    const second = splitClip(timeline, clip.id, secToTicks(4))
    assert.ok(second)
    // The tail's incoming neighbor changed: only the first half keeps the
    // transition (its start still touches the original previous clip).
    assert.deepEqual(clip.transitionIn, { type: 'fade', duration: secToTicks(0.5) })
    assert.equal(second.transitionIn, undefined)
  })

  it('rejects out-of-range splits', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(10) } })
    assert.equal(splitClip(timeline, clip.id, 0), null)
    assert.equal(splitClip(timeline, clip.id, secToTicks(10)), null)
    assert.equal(splitClip(timeline, 'missing', secToTicks(5)), null)
  })

  it('moves and trims clips', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', { source: { in: secToTicks(2), out: secToTicks(12) } })
    assert.equal(moveClip(timeline, clip.id, secToTicks(5)), true)
    assert.equal(clip.timeline.start, secToTicks(5))
    assert.equal(moveClip(timeline, clip.id, -100), true)
    assert.equal(clip.timeline.start, 0)
    assert.equal(trimClip(timeline, clip.id, 'out', secToTicks(6)), true)
    assert.equal(clip.source.out, secToTicks(6))
    assert.equal(trimClip(timeline, clip.id, 'in', secToTicks(3)), true)
    assert.equal(clip.source.in, secToTicks(3))
    assert.equal(clip.timeline.start, secToTicks(1))
    assert.equal(trimClip(timeline, clip.id, 'middle', 0), false)
  })

  it('creates missing tracks on demand', () => {
    const timeline = { version: 3, tracks: [], markers: [] }
    const track = ensureTrack(timeline, 'audio', 'Audio 1')
    assert.equal(track.type, 'audio')
    assert.equal(timeline.tracks.length, 1)
    assert.equal(ensureTrack(timeline, 'audio'), track)
  })

  it('validates timeline structure', () => {
    const timeline = makeTimeline()
    addClip(timeline, 'video', { source: { in: 0, out: secToTicks(3) } })
    assert.deepEqual(validateTimeline(timeline), [])
    assert.ok(validateTimeline(null).length > 0)
    assert.ok(validateTimeline({ version: 2, tracks: [] }).length > 0)
    const bad = makeTimeline()
    bad.tracks.push({ id: 't-x', type: 'hologram', items: [{ id: 'c1', source: { in: 5, out: 5 }, timeline: { start: -1, duration: 0 }, speed: 0 }] })
    assert.ok(validateTimeline(bad).length >= 4)
  })

  it('adds uniquely named tracks and removes them (Roadmap C8)', () => {
    const timeline = makeTimeline() // Text, Video 1, Audio 1
    assert.equal(nextTrackName(timeline, 'video'), 'Video 2')
    const added = addTrack(timeline, 'video')
    assert.equal(added.name, 'Video 2')
    assert.equal(timeline.tracks.length, 4)
    assert.equal(nextTrackName(timeline, 'text'), 'Text 2')

    // keepClips re-homes the clips onto the other same-type track.
    addClip(timeline, 'video', { source: { in: 0, out: secToTicks(5) } })
    const before = totalDurationTicks(timeline)
    assert.equal(removeTrack(timeline, 't-video-1', { keepClips: true }), true)
    assert.equal(timeline.tracks.length, 3)
    assert.equal(totalDurationTicks(timeline), before)

    // keepClips refuses when no same-type target is left; track stays.
    assert.equal(removeTrack(timeline, added.id, { keepClips: true }), false)
    assert.equal(timeline.tracks.length, 3)

    // Locked tracks are refused (core lock guards).
    const held = timeline.tracks.find(track => track.id === added.id)
    held.locked = true
    assert.equal(removeTrack(timeline, added.id), false)
    held.locked = false

    // Unknown ids fail; plain removal drops the track with its clips.
    assert.equal(removeTrack(timeline, 'missing'), false)
    assert.equal(removeTrack(timeline, added.id), true)
    assert.equal(timeline.tracks.length, 2)
    assert.deepEqual(timeline.tracks.map(track => track.id), ['t-text-1', 't-audio-1'])
  })
})
