// tmcut-core — timeline tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  clipDurationTicks,
  clipEndTicks,
  clipSpan,
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
import { rampTimelineToSource } from '../src/retime.mjs'
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

  // V4 G5 follow-up: the split must inherit the clip's TIME MAP. Before this
  // slice the boundary used `elapsed * speed` and the curve was copied to
  // both halves verbatim, so each half replayed its own curve from t=0 over
  // a shorter span — measured below: 6 s of source never appeared.
  it('re-times a speed ramp so the split replays every source second once', () => {
    const timeline = makeTimeline()
    const D = secToTicks(24)
    const clip = addClip(timeline, 'video', {
      source: { in: 0, out: D },
      speedPoints: [{ t: 0, speed: 0.5 }, { t: D, speed: 1.5 }]
    })
    assert.ok(clip.speedPoints, 'addClip must carry the curve or a created clip cannot ramp')
    const before = { in: 0, out: D, speed: clip.speed, speedPoints: clip.speedPoints }
    const cut = secToTicks(12)
    const second = splitClip(timeline, clip.id, cut)
    assert.ok(second)
    // 1) boundary = the speed integral (0.5 -> 1.0 over 12 s = 9 s of source)
    assert.equal(clip.source.out, secToTicks(9))
    assert.equal(second.source.in, secToTicks(9))
    assert.equal(second.source.out, D)
    // 2) the flat model derives length as span/speed, so each half must carry
    //    its own mean: that is what keeps the cut exactly where the user put it
    assert.equal(clipEndTicks(clip), cut, 'head must end on the cut')
    assert.equal(clipDurationTicks(second), secToTicks(12))
    assert.equal(totalDurationTicks(timeline), D)
    // 3) the strongest one: at every timeline position the two halves show the
    //    same source the single clip showed before the cut
    const asFlat = c => ({ in: c.source.in, out: c.source.out, speed: c.speed, reverse: c.reverse, speedPoints: c.speedPoints })
    for (let t = 0; t < D; t += secToTicks(1)) {
      const want = rampTimelineToSource(before, t)
      const got = t < cut
        ? rampTimelineToSource(asFlat(clip), t)
        : rampTimelineToSource(asFlat(second), t - cut)
      assert.ok(Math.abs(got - want) < 1, `t=${t / secToTicks(1)}s: ${got / secToTicks(1)} != ${want / secToTicks(1)}`)
    }
    // 4) the curve is continuous across the cut: no speed step at the join
    assert.equal(second.speedPoints[0].t, 0)
    assert.equal(second.speedPoints[0].speed, 1, 'the tail starts where the head ended')
  })

  it('splitClip of a reversed clip hands the late source to the head', () => {
    const timeline = makeTimeline()
    const clip = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(10) }, reverse: true })
    const second = splitClip(timeline, clip.id, secToTicks(4))
    assert.ok(second)
    // Reverse plays out -> in, so the first 4 timeline seconds show the LAST
    // 4 source seconds; the tail continues with the earlier 6 s.
    assert.equal(clip.source.in, secToTicks(6))
    assert.equal(clip.source.out, secToTicks(10))
    assert.equal(second.source.in, 0)
    assert.equal(second.source.out, secToTicks(6))
    assert.equal(clipEndTicks(clip), secToTicks(4))
    assert.equal(second.timeline.start, secToTicks(4))
    assert.equal(totalDurationTicks(timeline), secToTicks(10))
  })

  it('a constant clip splits exactly as before this slice', () => {
    const timeline = makeTimeline()
    // 16 s of source at 2x = 8 s on the timeline, occupying [0, 8].
    const clip = addClip(timeline, 'video', { source: { in: secToTicks(2), out: secToTicks(18) }, speed: 2 })
    const second = splitClip(timeline, clip.id, secToTicks(5))
    assert.ok(second)
    assert.equal(clip.source.out, secToTicks(12), '5 s of timeline at 2x consume 10 s of source')
    assert.equal(second.source.in, secToTicks(12))
    assert.equal(second.source.out, secToTicks(18))
    assert.equal(clip.speed, 2)
    assert.equal(second.speed, 2)
    assert.equal(clip.speedPoints, undefined)
    assert.equal(second.speedPoints, undefined)
    assert.equal(clipEndTicks(clip), secToTicks(5))
    assert.equal(clipDurationTicks(second), secToTicks(3))
    assert.equal(totalDurationTicks(timeline), secToTicks(8))
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

  it('resolves a span for DSL v3 and flat app-model clips (clipSpan)', () => {
    const timeline = makeTimeline()
    const v3 = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(10) }, speed: 2 })
    assert.deepEqual(clipSpan(v3), { start: 0, duration: secToTicks(5), end: secToTicks(5) })

    assert.deepEqual(
      clipSpan({ in: 0, out: secToTicks(10), offset: secToTicks(2), speed: 2 }),
      { start: secToTicks(2), duration: secToTicks(5), end: secToTicks(7) }
    )
    // Speed 0/absent falls back to 1, matching the app store accessor.
    assert.deepEqual(
      clipSpan({ in: 0, out: secToTicks(2), offset: 0, speed: 0 }),
      { start: 0, duration: secToTicks(2), end: secToTicks(2) }
    )
    // Text/sticker layers carry no media range: empty, never a throw.
    assert.deepEqual(clipSpan({ id: 't', type: 'text', text: 'Hi' }), { start: 0, duration: 0, end: 0 })
    assert.deepEqual(clipSpan(null), { start: 0, duration: 0, end: 0 })
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
