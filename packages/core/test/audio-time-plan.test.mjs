// tmcut-core — where a sound is in its own file, and how fast it runs (Zero-FFmpeg slice G4).
// Run: node --test "test/*.test.mjs"
//
// G3 answered WHICH layers sound and at WHAT gain. The screen still decided the
// other half of a media element privately: the position inside the file came from
// an app map (`clipMediaTimeSec`), the element rate from an inline clamp
// (`clip.speed >= 0.25 && <= 4 ? clip.speed : 1`), and whether a clip plays at all
// from a store scan. Three answers to "where is this sound now" is how a 6x clip
// runs its picture at 6x and its audio at 1x, and how a ramped bed drifts a
// quarter of its own length off the screen. The evaluator already folds speed,
// ramp and trim into `layer.sourceTicks`; this plan hands the same number to the
// audio leg and adds the one law core did not have — the element's rate.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { audioMixAt } from '../src/audioMix.mjs'
import { evaluateTimeline } from '../src/evaluate.mjs'
import { secToTicks, ticksToSec } from '../src/time.mjs'

const T = secToTicks

/**
 * One v3-shaped clip. `source` is the file range it reads and `timeline` where it
 * sits, so trim/speed can be varied without the two shapes disagreeing.
 */
function clip(id, sourceInSec, sourceOutSec, startSec, durationSec, overrides = {}) {
  return {
    id,
    type: 'audio',
    source: { in: T(sourceInSec), out: T(sourceOutSec) },
    timeline: { start: T(startSec), duration: T(durationSec) },
    speed: 1,
    ...overrides
  }
}

function row(id, items, trackOverrides = {}) {
  return { id, type: 'audio', items, ...trackOverrides }
}

function footageRow(id, items, trackOverrides = {}) {
  return { id, type: 'video', items, ...trackOverrides }
}

function project(...tracks) {
  return { timeline: { tracks } }
}

/** The time answer for one clip, read by id (never by position in the list). */
function sourceOf(mix, clipId) {
  return mix.sources.find(source => source.clipId === clipId) ?? null
}

describe('audioMixAt — the time half', () => {
  it('the sound rides the same media position the picture was built from', () => {
    const played = clip('a1', 2, 12, 0, 10)
    const evaluation = evaluateTimeline(project(row('t-a', [played])), T(4))
    const mix = audioMixAt(evaluation)
    const layer = evaluation.tracks[0].layers[0]
    // One answer: the plan hands back the evaluator's own number, not a copy of
    // its formula. A host that re-derives it is a third clock.
    assert.equal(sourceOf(mix, 'a1').mediaTicks, layer.sourceTicks)
    assert.equal(ticksToSec(layer.sourceTicks), 6)
  })

  it('a trimmed clip starts inside its own file', () => {
    // The edit that started this: source.in is the trim point, so a clip that
    // begins its life 3s into the file must be 3s into the file at tick 0.
    const trimmed = clip('bed', 3, 13, 0, 10)
    const mix = audioMixAt(evaluateTimeline(project(row('t-a', [trimmed])), 0))
    assert.equal(ticksToSec(sourceOf(mix, 'bed').mediaTicks), 3)
  })

  it('a gap answers with no source, and the next clip keeps its own position', () => {
    const first = clip('c1', 0, 2, 0, 2)
    const second = clip('c2', 30, 32, 4, 2)
    const inGap = audioMixAt(evaluateTimeline(project(row('t-a', [first, second])), T(3)))
    assert.equal(inGap.sources.length, 0, 'a gap is silence, not a held note')
    const after = audioMixAt(evaluateTimeline(project(row('t-a', [first, second])), T(5)))
    assert.deepEqual(after.sources.map(s => s.clipId), ['c2'])
    // 1s into the second clip, measured from ITS trim point — the gap did not
    // push its file position forward.
    assert.equal(ticksToSec(sourceOf(after, 'c2').mediaTicks), 31)
  })

  it('two overlapping clips on one row are two sources with two positions', () => {
    const a = clip('a', 0, 4, 0, 4)
    const b = clip('b', 40, 44, 3, 4)
    const mix = audioMixAt(evaluateTimeline(project(row('t-a', [a, b])), T(3.5)))
    assert.deepEqual(mix.sources.map(s => s.clipId), ['a', 'b'])
    assert.equal(ticksToSec(sourceOf(mix, 'a').mediaTicks), 3.5)
    assert.equal(ticksToSec(sourceOf(mix, 'b').mediaTicks), 40.5)
  })

  it('a 2x clip runs the element at 2x and its clock at 2x', () => {
    // 8s of source in 4s of timeline. The two questions a host asks must be
    // answered from one law: rate 2 AND the position advancing 2 ticks per tick.
    const fast = clip('f', 0, 8, 0, 4, { speed: 2 })
    const atOne = audioMixAt(evaluateTimeline(project(row('t-a', [fast])), T(1)))
    const atTwo = audioMixAt(evaluateTimeline(project(row('t-a', [fast])), T(2)))
    assert.equal(atOne.sources[0].rate, 2)
    assert.equal(ticksToSec(sourceOf(atOne, 'f').mediaTicks), 2)
    assert.equal(ticksToSec(sourceOf(atTwo, 'f').mediaTicks), 4)
  })

  it('a ramp gives the sound the rate the picture is riding', () => {
    // 1x -> 2x sampled linearly across 10s. At the halfway tick the curve is at
    // 1.5x and the file position is the trapezoid under it (6.25s), not the
    // constant-speed map (5s) — the drift that made a ramped bed arrive late.
    const ramped = clip('r', 0, 20, 0, 10, {
      speedPoints: [{ t: 0, speed: 1 }, { t: T(10), speed: 2 }]
    })
    const mix = audioMixAt(evaluateTimeline(project(row('t-a', [ramped])), T(5)))
    assert.equal(sourceOf(mix, 'r').rate, 1.5)
    assert.equal(ticksToSec(sourceOf(mix, 'r').mediaTicks), 6.25)
  })

  it('a clip past the old audio ceiling runs at its own speed', () => {
    // The app's inline clamp refused anything above 4x by falling back to 1, so
    // the element played its sound at normal speed while the file was read 6x
    // ahead and the export ran asetpts/6. Refusing a rate is not the same as
    // naming one.
    const very = clip('v', 0, 24, 0, 4, { speed: 6 })
    const mix = audioMixAt(evaluateTimeline(project(row('t-a', [very])), T(1)))
    assert.equal(sourceOf(mix, 'v').rate, 6)
    assert.equal(ticksToSec(sourceOf(mix, 'v').mediaTicks), 6)
    // The ceiling is the media element's own, and it clamps instead of falling back.
    const absurd = clip('w', 0, 400, 0, 10, { speed: 40 })
    assert.equal(audioMixAt(evaluateTimeline(project(row('t-a', [absurd])), T(1))).sources[0].rate, 16)
  })

  it('the host clock multiplies the rate and the clamp binds', () => {
    // A shuttle is a fact about the playhead, not about the timeline: the host
    // supplies it, core composes it with the clip's own speed and applies the
    // element's playable window.
    const half = clip('h', 0, 8, 0, 4, { speed: 2 })
    const evaluation = evaluateTimeline(project(row('t-a', [half])), T(1))
    assert.equal(audioMixAt(evaluation, { shuttle: 4 }).sources[0].rate, 8)
    assert.equal(audioMixAt(evaluation, { shuttle: 100 }).sources[0].rate, 16)
    assert.equal(audioMixAt(evaluation, { shuttle: 0.01 }).sources[0].rate, 0.25)
    // A shuttle of 0 is not a rate — silence is a level, not a clock.
    assert.equal(audioMixAt(evaluation, { shuttle: 0 }).sources[0].rate, 2)
  })

  it('a reverse clip refuses the element and names the reason', () => {
    // HTMLMediaElement has no backward playback, so the preview dropped these
    // clips in silence. The plan says so, and keeps the level it would have had
    // — the file does have sound; the element cannot run it.
    const back = clip('rev', 0, 6, 0, 6, { reverse: true })
    const mix = audioMixAt(evaluateTimeline(project(row('t-a', [back])), T(1)))
    const source = sourceOf(mix, 'rev')
    assert.equal(source.plays, false)
    assert.equal(source.refusal, 'reverse')
    assert.equal(source.gain, 1)
  })

  it('the sound and the picture are handed the same rate at the same tick', () => {
    // Both legs under a 1x -> 2x curve at their halfway point. One law answers
    // for the frame and for the bed, so no host can retime one of them apart —
    // which is what the two private clamps (0.25..16 and 0.25..4) allowed.
    const curve = [{ t: 0, speed: 1 }, { t: T(10), speed: 2 }]
    const shot = { ...clip('v1', 0, 20, 0, 10, { speedPoints: curve }), type: 'video' }
    const bed = clip('a1', 0, 20, 0, 10, { speedPoints: curve })
    const mix = audioMixAt(evaluateTimeline(
      project(footageRow('t-v', [shot]), row('t-a', [bed])),
      T(5)
    ))
    assert.deepEqual(mix.sources.map(s => s.clipId).sort(), ['a1', 'v1'])
    assert.equal(sourceOf(mix, 'v1').rate, 1.5)
    assert.equal(sourceOf(mix, 'a1').rate, 1.5)
    assert.equal(sourceOf(mix, 'a1').mediaTicks, sourceOf(mix, 'v1').mediaTicks)
  })

  it('the footage leg is asked the same time questions', () => {
    const shot = { ...clip('v1', 100, 104, 0, 4), type: 'video' }
    const evaluation = evaluateTimeline(project(footageRow('t-v', [shot])), T(2))
    const mix = audioMixAt(evaluation)
    const source = sourceOf(mix, 'v1')
    const layer = evaluation.tracks[0].layers[0]
    assert.equal(source.role, 'footage')
    assert.equal(source.mediaTicks, layer.sourceTicks)
    assert.equal(ticksToSec(source.mediaTicks), 102)
    assert.equal(source.rate, 1)
    assert.equal(source.plays, true)
  })
})
