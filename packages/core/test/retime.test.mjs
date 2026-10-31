// @tmcut/core — retime tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateSpeed, isRetimed, timelineToSource, sourceToTimeline, withSpeed, isRamped, speedAt, rampIntegral, rampTimelineToSource, SPEED_RAMP_PRESETS, buildRampPreset, rampSetptsExpr } from '../src/retime.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const T = TICKS_PER_SECOND // 120000 ticks per second

// Timeline duration of a clip (what consumers derive from the fields).
const durationOf = clip => (clip.out - clip.in) / validateSpeed(clip.speed)

describe('retime', () => {
  it('validateSpeed clamps the floor and sanitizes bad input', () => {
    assert.equal(validateSpeed(2), 2)
    assert.equal(validateSpeed(0.5), 0.5)
    assert.equal(validateSpeed(0.005), 0.01) // below floor -> 0.01
    assert.equal(validateSpeed(-3), 0.01) // negative -> floor (reverse is a flag)
    assert.equal(validateSpeed(Number.NaN), 1) // invalid -> normal speed
    assert.equal(validateSpeed(undefined), 1)
  })

  it('isRetimed flags speed and reverse', () => {
    assert.equal(isRetimed({ speed: 1 }), false)
    assert.equal(isRetimed({ speed: 1, reverse: false }), false)
    assert.equal(isRetimed({}), false)
    assert.equal(isRetimed(null), false)
    assert.equal(isRetimed({ speed: 2 }), true)
    assert.equal(isRetimed({ speed: 1, reverse: true }), true)
    assert.equal(isRetimed({ speed: 0.5 }), true)
  })

  it('speed 2 halves the timeline duration, speed 0.5 doubles it', () => {
    const base = { in: T, out: 5 * T, speed: 1 } // 4s source span
    assert.equal(durationOf({ ...base, speed: 2 }), 2 * T)
    assert.equal(durationOf({ ...base, speed: 0.5 }), 8 * T)
  })

  it('maps timeline -> source forward (in + t * speed)', () => {
    const clip = { in: T, out: 5 * T, speed: 2 }
    assert.equal(timelineToSource(clip, 0), T)
    assert.equal(timelineToSource(clip, T), 3 * T)
    assert.equal(timelineToSource(clip, 2 * T), 5 * T) // end of source at clip end
    // Clamped outside the clip.
    assert.equal(timelineToSource(clip, 10 * T), 5 * T)
    assert.equal(timelineToSource(clip, -T), T)
  })

  it('maps timeline -> source reverse (out - t * speed): ends swap', () => {
    const clip = { in: T, out: 5 * T, speed: 2, reverse: true }
    assert.equal(durationOf(clip), 2 * T)
    assert.equal(timelineToSource(clip, 0), 5 * T) // starts at source end
    assert.equal(timelineToSource(clip, 2 * T), T) // ends at source start
  })

  it('roundtrips sourceToTimeline ∘ timelineToSource within ±1 tick', () => {
    for (const speed of [1, 2, 0.5]) {
      for (const reverse of [false, true]) {
        const clip = { in: T, out: 9 * T, speed, reverse }
        const dur = durationOf(clip)
        for (const t of [0, dur / 3, dur / 2, dur]) {
          const back = sourceToTimeline(clip, timelineToSource(clip, t))
          assert.ok(Math.abs(back - t) <= 1, `speed=${speed} reverse=${reverse} t=${t} -> ${back}`)
        }
      }
    }
  })

  it('withSpeed keeps the source range and normalizes the speed', () => {
    const clip = { id: 'c1', in: T, out: 7 * T, speed: 1, offset: 4 * T }
    const fast = withSpeed(clip, 2)
    assert.equal(fast.speed, 2)
    assert.equal(fast.in, T) // source in untouched
    assert.equal(fast.out, 7 * T) // source out untouched -> duration halves
    assert.equal(fast.offset, 4 * T) // clip start untouched
    assert.equal(durationOf(fast), 3 * T)
    assert.equal(clip.speed, 1) // pure: original unchanged
    // Broken source range (out <= in) gets a usable floor.
    const broken = withSpeed({ in: T, out: T }, 1)
    assert.equal(broken.out, T + T / 5) // 0.2 s minimum span
    assert.ok(broken.out > (broken.in ?? 0))
    // Invalid speed input falls back to normal speed.
    assert.equal(withSpeed(clip, Number.NaN).speed, 1)
  })
})

// Port a setpts expression into an evaluable JS function by providing the
// FFmpeg math functions as locals (lt/sqrt) and renaming the reserved-ish
// `if` -> `_if`; commas stay plain JS argument separators. `^` -> `**`,
// and the u-var `(PTS-STARTPTS)` -> the `u` parameter.
function jsify(expr) {
  const js = expr
    .replace(/\(PTS-STARTPTS\)/g, 'u')
    .replace(/\bif\(/g, '_if(')
    .replace(/\^/g, '**')
  return new Function('u', `const lt=(a,b)=>a<b, sqrt=Math.sqrt, _if=(c,a,b)=>c?a:b; return (${js});`)
}

describe('speed ramping (R124 A4)', () => {
  const clip = { in: 0, out: 4 * T, speed: 1, speedPoints: [
    { t: 0, speed: 1 },
    { t: 2 * T, speed: 3 }
  ] } // 4s span, ramp 1x -> 3x over 2s

  it('isRamped needs at least two valid points', () => {
    assert.equal(isRamped({}), false)
    assert.equal(isRamped({ speedPoints: [{ t: 0, speed: 1 }] }), false)
    assert.equal(isRamped(clip), true)
    assert.equal(isRamped({ speedPoints: [null, { t: 1, speed: 1 }, { t: 2, speed: 2 }] }), true)
  })

  it('speedAt interpolates linearly and clamps at the ends', () => {
    assert.equal(speedAt(clip, 0), 1)
    assert.equal(speedAt(clip, T), 2) // midpoint of the ramp
    assert.equal(speedAt(clip, 2 * T), 3)
    assert.equal(speedAt(clip, 10 * T), 3) // clamp: last speed continues
    assert.equal(speedAt({ speed: 2, speedPoints: [] }, T), 2) // fallback
  })

  it('rampIntegral is the exact trapezoid: mean speed x width', () => {
    // 0..2s: mean (1+3)/2 = 2 -> 4s of source; 2..4s: constant 3 -> 6s.
    assert.equal(rampIntegral(clip, 2 * T), 4 * T)
    assert.equal(rampIntegral(clip, 4 * T), 10 * T)
    // Constant curve equals plain speed*t.
    assert.equal(rampIntegral({ speed: 2, speedPoints: null }, 3 * T), 6 * T)
  })

  it('rampTimelineToSource: the curve consumes source faster later', () => {
    const plain = { in: 0, out: 10 * T, speed: 1, speedPoints: null }
    assert.equal(rampTimelineToSource(plain, 4 * T), 4 * T) // identical fallback
    assert.equal(rampTimelineToSource({ ...plain, speedPoints: clip.speedPoints }, 2 * T), 4 * T)
    assert.equal(rampTimelineToSource({ ...plain, speedPoints: clip.speedPoints }, 4 * T), 10 * T)
    assert.equal(rampTimelineToSource(clip, 10 * T), 4 * T) // clamped at source end
    assert.equal(rampTimelineToSource(clip, -T), 0)
  })

  it('buildRampPreset keeps the mean speed (timeline length survives)', () => {
    for (const kind of SPEED_RAMP_PRESETS) {
      const pts = buildRampPreset(kind, 4 * T, 1)
      assert.equal(pts.length, kind === 'ease-in' || kind === 'ease-out' ? 2 : 3)
      // Trapezoid area over [0, last] = source consumed; with mean = base
      // the clip keeps its constant-speed timeline length.
      const area = rampIntegral({ speedPoints: pts }, pts[pts.length - 1].t)
      const span = pts[pts.length - 1].t
      assert.ok(Math.abs(area / span - 1) < 0.02, `${kind} mean=${area / span}`)
    }
    assert.deepEqual(buildRampPreset('nope', 4 * T), [])
  })

  it('rampSetptsExpr null for non-ramped, else a nested-if of closed forms', () => {
    assert.equal(rampSetptsExpr({}), null)
    assert.equal(rampSetptsExpr({ speedPoints: [{ t: 0, speed: 1 }] }), null)
    const expr = rampSetptsExpr(clip)
    assert.ok(expr.startsWith('if(lt('), expr)
    assert.ok(expr.includes('sqrt('))
  })

  it('rampSetptsExpr inverts the speed integral (numeric roundtrip)', () => {
    const plain = { in: 0, out: 10 * T, speed: 1 }
    const rc = { ...plain, speedPoints: clip.speedPoints }
    const expr = rampSetptsExpr(rc)
    const evalU = jsify(expr)
    // For each sample of SOURCE time u (seconds), the expr gives output
    // time τ; the inverse map (JS rampIntegral in seconds) must agree:
    // u = ∫₀ᵗ s dt evaluated at t = τ.
    const integralSec = (tSec) => rampIntegral(rc, tSec * T) / T
    for (const uSec of [0, 0.5, 1, 2, 3, 4, 4.5, 5, 6, 8, 10, 12]) {
      const tau = evalU(uSec)
      const back = integralSec(tau)
      assert.ok(Math.abs(back - uSec) < 0.01, `u=${uSec} -> τ=${tau} -> ${back}`)
    }
    // Monotone increasing output times.
    let prev = -1
    for (const uSec of [0, 1, 2, 3, 4, 6, 10]) {
      const tau = evalU(uSec)
      assert.ok(tau > prev, `not monotone at u=${uSec}`)
      prev = tau
    }
    // Ends: u=0 -> τ=0; the full source span 10s consumed at τ=4s (clip dur).
    assert.ok(Math.abs(evalU(0)) < 1e-6)
    assert.ok(Math.abs(evalU(10) - 4) < 0.01)
  })

  it('rampSetptsExpr constant segment degrades to the linear form', () => {
    const constClip = { speedPoints: [{ t: 0, speed: 2 }, { t: 4 * T, speed: 2 }] }
    const expr = rampSetptsExpr(constClip)
    assert.ok(expr, 'ramped even with equal speeds')
    assert.ok(!expr.includes('sqrt('), `expected linear form, got: ${expr}`)
    const evalU = jsify(expr)
    assert.ok(Math.abs(evalU(4) - 2) < 1e-6) // 4s source at 2x = 2s out
  })
})
