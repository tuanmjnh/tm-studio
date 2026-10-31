// @tmcut/core — audio fade / gain tests (Roadmap C12). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fadeDuration, gainAt, volumeExpr, panFilter, isTrackMuted } from '../src/audio.mjs'
import { secToTicks } from '../src/time.mjs'

function v3Clip(overrides = {}) {
  return {
    source: { in: 0, out: secToTicks(5) },
    timeline: { start: 0, duration: secToTicks(5) },
    speed: 1,
    volume: 80,
    fade: { in: secToTicks(1), out: secToTicks(1) },
    ...overrides
  }
}

describe('audio fades (C12)', () => {
  it('fadeDuration clamps to half the clip duration', () => {
    const clip = v3Clip()
    assert.equal(fadeDuration(clip, 'in'), secToTicks(1))
    assert.equal(fadeDuration(clip, 'out'), secToTicks(1))
    // A fade longer than half the clip clamps — both edges never overlap.
    assert.equal(fadeDuration(v3Clip({ fade: { in: secToTicks(10), out: 0 } }), 'in'), secToTicks(2.5))
    assert.equal(fadeDuration(v3Clip({ fade: undefined }), 'in'), 0)
    assert.equal(fadeDuration(clip, 'sideways'), 0)
    assert.equal(fadeDuration(null, 'in'), 0)
  })

  it('gainAt ramps 0 -> volume -> 0 with both edges', () => {
    const clip = v3Clip()
    assert.equal(gainAt(clip, 0), 0)
    assert.ok(Math.abs(gainAt(clip, secToTicks(0.5)) - 0.4) < 1e-9)
    assert.ok(Math.abs(gainAt(clip, secToTicks(2.5)) - 0.8) < 1e-9)
    assert.equal(gainAt(clip, secToTicks(5)), 0)
    // Outside the clip clamps to the edge value (silence).
    assert.equal(gainAt(clip, secToTicks(99)), 0)
    assert.equal(gainAt(clip, secToTicks(-3)), 0)
  })

  it('gainAt multiplies volume and tolerates the legacy v1 shape', () => {
    assert.ok(Math.abs(gainAt(v3Clip({ volume: 50 }), secToTicks(2.5)) - 0.5) < 1e-9)
    // No fades: plain volume everywhere.
    assert.ok(Math.abs(gainAt(v3Clip({ fade: undefined }), 0) - 0.8) < 1e-9)
    // Legacy v1 flat item: in/out are SECONDS, fade stays in ticks.
    const v1 = { in: 0, out: 5, speed: 1, volume: 100, fade: { in: secToTicks(1), out: 0 } }
    assert.equal(gainAt(v1, 0), 0)
    assert.ok(Math.abs(gainAt(v1, secToTicks(2)) - 1) < 1e-9)
    // Missing volume defaults to 100%.
    assert.ok(Math.abs(gainAt({ ...v1, volume: undefined, fade: undefined }, 0) - 1) < 1e-9)
  })

  it('volumeExpr contains every marker and stays clean', () => {
    const expr = volumeExpr(v3Clip())
    assert.match(expr, /lt\(t,1\)/) // fade-in end A
    assert.match(expr, /gt\(t,4\)/) // fade-out start D-B
    assert.match(expr, /\(5-t\)/) // clip end D
    assert.equal(volumeExpr(v3Clip({ fade: undefined })), '1')
    assert.equal(volumeExpr(null), '1')
    // Float noise stays trimmed.
    assert.match(volumeExpr(v3Clip({ fade: { in: secToTicks(0.5), out: 0 } })), /lt\(t,0\.5\)/)
  })
})

describe('track-level audio (R124 A1)', () => {
  it('panFilter returns empty for neutral / invalid pan', () => {
    assert.equal(panFilter(0), '')
    assert.equal(panFilter(NaN), '')
    assert.equal(panFilter(undefined), '')
  })

  it('panFilter emits a stereotools filter with balanced gain', () => {
    // Center stays 0.5/0.5.
    assert.equal(panFilter(0), '')
    // Hard left: L gets full, R gets 0.
    const left = panFilter(-100)
    assert.match(left, /^stereotools=level_in=/)
    // Hard right mirror.
    const right = panFilter(100)
    assert.ok(left !== right)
  })

  it('isTrackMuted reads the track flag defensively', () => {
    assert.equal(isTrackMuted({ muted: true }), true)
    assert.equal(isTrackMuted({ muted: false }), false)
    assert.equal(isTrackMuted({}), false)
    assert.equal(isTrackMuted(null), false)
    assert.equal(isTrackMuted(undefined), false)
  })
})
