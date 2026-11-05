// tmcut-core — which layers make sound at one tick (Zero-FFmpeg slice G3).
// Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { audioMixAt } from '../src/audioMix.mjs'
import { compositePlan } from '../src/composite.mjs'
import { evaluateTimeline } from '../src/evaluate.mjs'
import { secToTicks } from '../src/time.mjs'

const T = secToTicks

/** One v3-shaped clip, long enough that a fade never swallows the sample point. */
function clip(id, startSec, durationSec, overrides = {}) {
  return {
    id,
    type: 'video',
    source: { in: T(startSec), out: T(startSec + durationSec) },
    timeline: { start: T(startSec), duration: T(durationSec) },
    speed: 1,
    ...overrides
  }
}

function footage(id, items, trackOverrides = {}) {
  return { id, type: 'video', items, ...trackOverrides }
}

function audio(id, items, trackOverrides = {}) {
  return { id, type: 'audio', items, ...trackOverrides }
}

/** The gain one source contributes, read by role and track — not by position. */
function gainOf(mix, clipId) {
  const hit = mix.sources.find(source => source.clipId === clipId)
  return hit ? hit.gain : null
}

describe('audioMixAt', () => {
  it('one footage row sounds, and it is the row whose picture paints', () => {
    const project = {
      timeline: {
        tracks: [
          footage('v1', [clip('a', 0, 4, { volume: 50 })]),
          footage('v2', [clip('b', 0, 4, { volume: 100 })])
        ]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(2)))
    assert.equal(mix.sources.filter(source => source.role === 'footage').length, 1)
    // The bottom row owns the sound — the same row the export concatenates.
    assert.equal(gainOf(mix, 'a'), 0.5)
    assert.equal(gainOf(mix, 'b'), null)
  })

  it('a hidden bottom row hands the sound to the row that paints', () => {
    const project = {
      timeline: {
        tracks: [
          footage('v1', [clip('a', 0, 4, { volume: 100 })], { hidden: true }),
          footage('v2', [clip('b', 0, 4, { volume: 40 })])
        ]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(2)))
    assert.equal(gainOf(mix, 'a'), null)
    assert.equal(gainOf(mix, 'b'), 0.4)
  })

  it('a muted footage row sounds like nothing', () => {
    const project = { timeline: { tracks: [footage('v1', [clip('a', 0, 4, { volume: 80 })], { muted: true })] } }
    const mix = audioMixAt(evaluateTimeline(project, T(2)))
    assert.equal(gainOf(mix, 'a'), 0)
  })

  it('during a crossfade only the incoming clip sounds', () => {
    const project = {
      timeline: {
        tracks: [{
          id: 'v1',
          type: 'video',
          items: [
            clip('out', 0, 4, { volume: 100 }),
            {
              ...clip('in', 3, 4, { volume: 100 }),
              transition: { in: { type: 'fade', duration: T(1) } }
            }
          ]
        }]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(3.5)))
    assert.equal(gainOf(mix, 'in'), 1)
    assert.equal(gainOf(mix, 'out'), null)
  })

  it('a transition window leaves the sound with the layer that paints', () => {
    // The applied shape of a crossfade: `transitionIn` lives on the incoming
    // clip and its duration shifts the clip left over the cut, so the window
    // is [3s, 4s] and the clip underneath is the one ending at 4s.
    const track = {
      id: 'v1',
      type: 'video',
      items: [
        clip('out', 0, 4, { volume: 100 }),
        {
          ...clip('in', 3, 4, { volume: 60 }),
          transitionIn: { type: 'fade', duration: T(1) }
        }
      ]
    }
    const evaluation = evaluateTimeline({ timeline: { tracks: [track] } }, T(3.5))
    const roles = compositePlan(evaluation).slots
      .filter(slot => slot.kind === 'footage')
      .map(slot => `${slot.role}/${slot.clipId}`)
    // The guard below is worth nothing if the plan never had a second layer.
    assert.deepEqual(roles, ['outgoing/out', 'paint/in'])

    const mix = audioMixAt(evaluation)
    assert.equal(mix.sources.filter(source => source.role === 'footage').length, 1)
    assert.equal(gainOf(mix, 'in'), 0.6)
    assert.equal(gainOf(mix, 'out'), null)
  })

  it('every audio row mixes, and a hidden one still mixes', () => {
    const project = {
      timeline: {
        tracks: [
          footage('v1', [clip('a', 0, 4, { volume: 100 })]),
          audio('b1', [clip('bed', 0, 4, { type: 'audio', volume: 30 })]),
          audio('b2', [clip('sfx', 0, 4, { type: 'audio', volume: 60 })], { hidden: true })
        ]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(2)))
    assert.equal(gainOf(mix, 'bed'), 0.3)
    // `hidden` is a picture control; `muted` is the sound one.
    assert.equal(gainOf(mix, 'sfx'), 0.6)
  })

  it('a track volume scales its clips and a muted audio row sounds like nothing', () => {
    const project = {
      timeline: {
        tracks: [
          audio('b1', [clip('bed', 0, 4, { type: 'audio', volume: 50 })], { volume: 40 }),
          audio('b2', [clip('voice', 0, 4, { type: 'audio', volume: 100 })], { muted: true })
        ]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(2)))
    assert.ok(Math.abs(gainOf(mix, 'bed') - 0.2) < 1e-9)
    assert.equal(gainOf(mix, 'voice'), 0)
  })

  it('the fade envelope reaches an audio clip, not only a video one', () => {
    const project = {
      timeline: {
        tracks: [audio('b1', [
          clip('bed', 0, 4, { type: 'audio', volume: 100, fade: { in: T(1), out: 0 } })
        ])]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(0.5)))
    assert.ok(Math.abs(gainOf(mix, 'bed') - 0.5) < 1e-9)
  })

  it('a volume keyframe is the value the mix reads', () => {
    const project = {
      timeline: {
        tracks: [audio('b1', [
          clip('bed', 0, 4, {
            type: 'audio',
            volume: 100,
            keyframes: [{ prop: 'volume', t: T(2), value: 25 }]
          })
        ])]
      }
    }
    const mix = audioMixAt(evaluateTimeline(project, T(3)))
    assert.equal(gainOf(mix, 'bed'), 0.25)
  })

  it('a gap contributes nothing and the sources keep track order', () => {
    const project = {
      timeline: {
        tracks: [
          footage('v1', [clip('a', 0, 2, { volume: 100 })]),
          audio('b1', [clip('late', 3, 2, { type: 'audio', volume: 100 })])
        ]
      }
    }
    assert.deepEqual(audioMixAt(evaluateTimeline(project, T(2.5))).sources, [])
    const mix = audioMixAt(evaluateTimeline(project, T(1)))
    assert.deepEqual(mix.sources.map(source => source.clipId), ['a'])
    assert.deepEqual(mix.sources[0], {
      role: 'footage',
      clipId: 'a',
      trackId: 'v1',
      trackIndex: 0,
      gain: 1
    })
  })

  it('nothing answers for a timeline that is not an evaluation', () => {
    assert.deepEqual(audioMixAt(undefined), { at: 0, sources: [] })
    assert.deepEqual(audioMixAt({ at: T(1), tracks: null }), { at: T(1), sources: [] })
  })
})
