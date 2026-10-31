// @tmcut/core — keyframes tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  KEYFRAME_EASINGS,
  evalKeyframe,
  keyframeAt,
  setKeyframe,
  removeKeyframe,
  propsWithKeyframes,
  keyframeTimes,
  keyframeExpr
} from '../src/keyframes.mjs'

const T = 120000 // ticks per second

function clipWith(...kfs) {
  return { keyframes: kfs }
}

describe('keyframes', () => {
  it('clamps outside the keyframe range', () => {
    const clip = clipWith({ t: T, prop: 'scale', value: 50 }, { t: 3 * T, prop: 'scale', value: 200 })
    // Before the first keyframe -> first value; after the last -> last value.
    assert.equal(evalKeyframe(clip, 'scale', 0), 50)
    assert.equal(evalKeyframe(clip, 'scale', 10 * T), 200)
    // Exact keyframe times return their own value.
    assert.equal(evalKeyframe(clip, 'scale', T), 50)
    assert.equal(evalKeyframe(clip, 'scale', 3 * T), 200)
  })

  it('returns undefined for props without keyframes', () => {
    const clip = clipWith({ t: 0, prop: 'x', value: 10 })
    assert.equal(evalKeyframe(clip, 'scale', 0), undefined)
    assert.equal(evalKeyframe(null, 'scale', 0), undefined)
    assert.equal(evalKeyframe({}, 'x', 0), undefined)
    assert.equal(evalKeyframe(clip, 'x', Number.NaN), undefined)
  })

  it('interpolates linearly between keyframes', () => {
    const clip = clipWith(
      { t: 0, prop: 'x', value: 0, easing: 'linear' },
      { t: 2 * T, prop: 'x', value: 100 }
    )
    assert.equal(evalKeyframe(clip, 'x', T), 50)
    assert.equal(evalKeyframe(clip, 'x', T / 2), 25)
    assert.equal(evalKeyframe(clip, 'x', (3 * T) / 2), 75)
  })

  it('holds the old value with step easing until the next keyframe', () => {
    const clip = clipWith(
      { t: 0, prop: 'opacity', value: 40, easing: 'step' },
      { t: 2 * T, prop: 'opacity', value: 90 }
    )
    assert.equal(evalKeyframe(clip, 'opacity', T), 40)
    assert.equal(evalKeyframe(clip, 'opacity', 2 * T - 1), 40)
    assert.equal(evalKeyframe(clip, 'opacity', 2 * T), 90) // exact boundary flips
  })

  it('applies ease-in / ease-out / ease-in-out easing', () => {
    const mid = T
    const end = 2 * T
    const mk = easing => clipWith({ t: 0, prop: 'scale', value: 0, easing }, { t: end, prop: 'scale', value: 100 })
    // u =0.5 at the midpoint: ease-in =25, ease-out =75, linear =50.
    assert.equal(evalKeyframe(mk('ease-in'), 'scale', mid), 25)
    assert.equal(evalKeyframe(mk('ease-out'), 'scale', mid), 75)
    assert.equal(evalKeyframe(mk('linear'), 'scale', mid), 50)
    assert.notEqual(evalKeyframe(mk('ease-in'), 'scale', mid), evalKeyframe(mk('linear'), 'scale', mid))
    assert.notEqual(evalKeyframe(mk('ease-out'), 'scale', mid), evalKeyframe(mk('linear'), 'scale', mid))
    // ease-in-out is symmetric (= linear at exactly½ but not elsewhere).
    assert.equal(evalKeyframe(mk('ease-in-out'), 'scale', mid), 50)
    assert.equal(evalKeyframe(mk('ease-in-out'), 'scale', T / 2), 12.5)
    assert.notEqual(evalKeyframe(mk('ease-in-out'), 'scale', T / 2), evalKeyframe(mk('linear'), 'scale', T / 2))
  })

  it('finds keyframes exactly or within tolerance', () => {
    const clip = clipWith({ t: 100, prop: 'x', value: 1 }, { t: 500, prop: 'x', value: 2 })
    assert.equal(keyframeAt(clip, 'x', 100), clip.keyframes[0])
    assert.equal(keyframeAt(clip, 'x', 150), null) // exact by default
    assert.equal(keyframeAt(clip, 'x', 140, 50), clip.keyframes[0])
    assert.equal(keyframeAt(clip, 'x', 460, 50), clip.keyframes[1]) // nearest wins
    assert.equal(keyframeAt(clip, 'y', 100, 50), null)
    assert.equal(keyframeAt(null, 'x', 0), null)
  })

  it('sets, replaces and keeps the array sorted', () => {
    const clip = { keyframes: [] }
    const a = setKeyframe(clip, 'scale', 2 * T, 200)
    const b = setKeyframe(clip, 'scale', 0, 100, 'ease-in')
    assert.ok(a && b)
    assert.deepEqual(keyframeTimes(clip, 'scale'), [0, 2 * T])
    assert.equal(clip.keyframes[0].easing, 'ease-in')
    // Replacing an exact t mutates the stored row (no duplicates).
    const replaced = setKeyframe(clip, 'scale', 0, 120, 'linear')
    assert.equal(replaced, clip.keyframes[0])
    assert.equal(clip.keyframes.length, 2)
    assert.equal(evalKeyframe(clip, 'scale', 0), 120)
    // Other props live alongside without interference.
    setKeyframe(clip, 'x', T, 10)
    assert.equal(clip.keyframes.length, 3)
    assert.deepEqual(propsWithKeyframes(clip), ['scale', 'x'])
    // Invalid input returns null instead of throwing.
    assert.equal(setKeyframe(clip, 'scale', Number.NaN, 10), null)
    assert.equal(setKeyframe(null, 'scale', 0, 10), null)
  })

  it('removes keyframes with tolerance', () => {
    const clip = clipWith({ t: 0, prop: 'x', value: 1 }, { t: 100, prop: 'x', value: 2 }, { t: 100, prop: 'y', value: 3 })
    assert.equal(removeKeyframe(clip, 'x', 95, 10), true)
    assert.equal(clip.keyframes.length, 2)
    assert.equal(removeKeyframe(clip, 'x', 95, 10), false)
    assert.equal(removeKeyframe(null, 'x', 0), false)
    // Nearest match within tolerance is removed.
    assert.equal(removeKeyframe(clip, 'y', 99, 5), true)
  })

  it('lists props with keyframes in first-appearance order', () => {
    const clip = clipWith(
      { t: 0, prop: 'y', value: 1 },
      { t: 1, prop: 'x', value: 2 },
      { t: 2, prop: 'y', value: 3 },
      { t: 3, prop: 'opacity', value: 4 }
    )
    assert.deepEqual(propsWithKeyframes(clip), ['y', 'x', 'opacity'])
    assert.deepEqual(propsWithKeyframes({}), [])
    assert.deepEqual(propsWithKeyframes(null), [])
  })

  it('returns ascending keyframe times for one prop', () => {
    const clip = clipWith(
      { t: 3 * T, prop: 'scale', value: 3 },
      { t: T, prop: 'scale', value: 1 },
      { t: 2 * T, prop: 'scale', value: 2 },
      { t: 0, prop: 'x', value: 9 }
    )
    assert.deepEqual(keyframeTimes(clip, 'scale'), [T, 2 * T, 3 * T])
    assert.deepEqual(keyframeTimes(clip, 'missing'), [])
    assert.deepEqual(keyframeTimes(null, 'scale'), [])
  })

  it('exposes the easing names', () => {
    assert.deepEqual(KEYFRAME_EASINGS, ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'step'])
  })

  describe('keyframeExpr (Roadmap R2, core C3)', () => {
    it('returns null when prop has no keyframes or clip is empty', () => {
      assert.equal(keyframeExpr(null, 'scale'), null)
      assert.equal(keyframeExpr({}, 'scale'), null)
      assert.equal(keyframeExpr({ keyframes: [] }, 'scale'), null)
      assert.equal(keyframeExpr(clipWith({ t: 0, prop: 'x', value: 10 }), 'scale'), null)
    })

    it('returns constant number string for a single keyframe', () => {
      const clip = clipWith({ t: 0, prop: 'scale', value: 100 })
      assert.equal(keyframeExpr(clip, 'scale'), '100')
      const clip2 = clipWith({ t: T, prop: 'volume', value: 80.5 })
      assert.equal(keyframeExpr(clip2, 'volume'), '80.5')
    })

    it('builds linear interpolation expression across segments', () => {
      const clip = clipWith(
        { t: 0, prop: 'x', value: 0, easing: 'linear' },
        { t: 2 * T, prop: 'x', value: 100 }
      )
      const expr = keyframeExpr(clip, 'x', 't')
      assert.ok(expr.includes('if(lt(t,0),0,'))
      assert.ok(expr.includes('if(lt(t,2),'))
      assert.ok(expr.includes('(0+(100)*((t-0)/2))'))
      assert.ok(expr.endsWith(',100))'))
    })

    it('supports custom time variable (e.g. T in geq)', () => {
      const clip = clipWith(
        { t: 0, prop: 'opacity', value: 20 },
        { t: T, prop: 'opacity', value: 100 }
      )
      const expr = keyframeExpr(clip, 'opacity', 'T')
      assert.ok(expr.includes('T'))
      assert.ok(!expr.includes('(t-'))
    })

    it('supports all easing formulas in expression', () => {
      const clip = clipWith(
        { t: 0, prop: 'scale', value: 0, easing: 'ease-in' },
        { t: T, prop: 'scale', value: 50, easing: 'ease-out' },
        { t: 2 * T, prop: 'scale', value: 100, easing: 'ease-in-out' },
        { t: 3 * T, prop: 'scale', value: 150, easing: 'step' },
        { t: 4 * T, prop: 'scale', value: 200 }
      )
      const expr = keyframeExpr(clip, 'scale', 't')
      assert.ok(expr)
      // ease-in square
      assert.ok(expr.includes('*((t-0)/1)'))
      // ease-out (1 - (1-u)*(1-u))
      assert.ok(expr.includes('(1-(1-((t-1)/1))*(1-((t-1)/1)))'))
      // ease-in-out
      assert.ok(expr.includes('if(lt(((t-2)/1),0.5),2*'))
      // step
      assert.ok(expr.includes(',150,'))
    })
  })
})
