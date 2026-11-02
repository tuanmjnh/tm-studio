// tmcut-core — retime tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateSpeed, isRetimed, timelineToSource, sourceToTimeline, withSpeed, isRamped, speedAt, rampIntegral, rampTimelineToSource, SPEED_RAMP_PRESETS, buildRampPreset, rampSetptsExpr, splitSpeedPoints, splitRamp } from '../src/retime.mjs'
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

// V4 G5 follow-up: splitting a clip must inherit its TIME MAP, not copy it.
// The flat model derives timeline length as span/speed, so a half keeps the
// user's cut position only if its `speed` equals its own curve mean.
describe('splitSpeedPoints + splitRamp (V4 G5 follow-up)', () => {
  const D = 24 * T
  const easeIn = () => buildRampPreset('ease-in', D, 1) // 0.5 -> 1.5, mean 1
  const rampClip = () => ({ in: 0, out: D, speed: 1, speedPoints: easeIn() })

  it('splitSpeedPoints keeps a constant clip constant', () => {
    assert.deepEqual(splitSpeedPoints([], 5 * T), { head: [], tail: [] })
    assert.deepEqual(splitSpeedPoints(null, 5 * T), { head: [], tail: [] })
    assert.deepEqual(splitSpeedPoints(undefined, 5 * T), { head: [], tail: [] })
    // One valid point is not a curve (isRamped false) — no invented segment.
    assert.deepEqual(splitSpeedPoints([{ t: 0, speed: 2 }], 5 * T), { head: [], tail: [] })
  })

  it('splitSpeedPoints reproduces the original curve at every timeline position', () => {
    const pts = easeIn()
    for (const cut of [T, 6 * T, 12 * T, 20 * T, D - T]) {
      const { head, tail } = splitSpeedPoints(pts, cut)
      for (let t = 0; t <= D; t += T / 3) {
        const want = speedAt({ speedPoints: pts }, t)
        const got = t <= cut
          ? speedAt({ speedPoints: head }, t)
          : speedAt({ speedPoints: tail }, t - cut)
        assert.ok(Math.abs(got - want) < 1e-9, `cut=${cut} t=${t}: ${got} != ${want}`)
      }
      // The halves must meet at the cut: no speed step where the playhead was.
      assert.ok(Math.abs(speedAt({ speedPoints: head }, cut) - speedAt({ speedPoints: tail }, 0)) < 1e-9)
    }
  })

  it('splitSpeedPoints re-anchors the tail to its own t=0', () => {
    const pts = [{ t: 0, speed: 0.5 }, { t: 8 * T, speed: 1 }, { t: D, speed: 1.5 }]
    const { head, tail } = splitSpeedPoints(pts, 8 * T)
    assert.deepEqual(head, [{ t: 0, speed: 0.5 }, { t: 8 * T, speed: 1 }])
    assert.deepEqual(tail, [{ t: 0, speed: 1 }, { t: 16 * T, speed: 1.5 }])
    // A cut exactly on a control point does not duplicate it.
    const atPoint = splitSpeedPoints(pts, 12 * T)
    assert.equal(atPoint.head.filter(p => p.t === 12 * T).length, 1)
    assert.equal(atPoint.tail[0].t, 0)
  })

  it('splitRamp on a constant clip returns the classic numbers', () => {
    const r = splitRamp({ in: 2 * T, out: 10 * T, speed: 2 }, 1.5 * T)
    assert.equal(r.boundary, 5 * T, 'elapsed * speed, same as before this slice')
    assert.deepEqual(r.head, { in: 2 * T, out: 5 * T, speed: 2, speedPoints: null })
    assert.deepEqual(r.tail, { in: 5 * T, out: 10 * T, speed: 2, speedPoints: null })
  })

  it('splitRamp puts the boundary where the ramp actually is', () => {
    const r = splitRamp(rampClip(), 12 * T)
    // 12 timeline seconds under 0.5 -> 1.0 (mean 0.75 over the first half)
    // consume 9 source seconds, not the 12 the linear formula claims.
    assert.equal(r.boundary, 9 * T)
    assert.equal(r.head.out, 9 * T)
    assert.equal(r.tail.in, 9 * T)
    assert.equal(r.tail.out, D, 'the source is partitioned, nothing is skipped')
  })

  it('splitRamp gives each half the speed that keeps the cut in place', () => {
    for (const cut of [2 * T, 6 * T, 12 * T, 19 * T]) {
      const r = splitRamp(rampClip(), cut)
      const headSpan = r.head.out - r.head.in
      const tailSpan = r.tail.out - r.tail.in
      assert.equal(r.head.speed, headSpan / cut, 'head speed must be its own mean')
      assert.equal(r.tail.speed, tailSpan / (D - cut), 'tail speed must be its own mean')
      // The flat model's ONLY length formula is span/speed — this is what
      // keeps the tail where the user cut instead of shifting the timeline.
      assert.equal(Math.round(headSpan / r.head.speed), cut)
      assert.equal(Math.round(tailSpan / r.tail.speed), D - cut)
      assert.equal(headSpan + tailSpan, D, 'no source duplicated or lost')
    }
  })

  it('splitRamp replay covers the source exactly once', () => {
    const clip = rampClip()
    const cut = 12 * T
    const r = splitRamp(clip, cut)
    for (let t = 0; t < D; t += T / 2) {
      const want = rampTimelineToSource(clip, t)
      const half = t < cut ? r.head : r.tail
      const got = rampTimelineToSource({ ...clip, ...half }, t < cut ? t : t - cut)
      assert.ok(Math.abs(got - want) < 1, `t=${t}: replayed source ${got} != original ${want}`)
    }
  })

  it('splitRamp past the last control point yields a constant tail that still finishes the source', () => {
    const clip = { in: 0, out: 48 * T, speed: 2, speedPoints: [{ t: 0, speed: 2 }, { t: 12 * T, speed: 2 }] }
    const r = splitRamp(clip, 16 * T)
    assert.ok(isRamped({ ...clip, ...r.head }), 'the head still holds a curve')
    assert.equal(r.tail.speedPoints, null, 'a flat tail is not a curve — it is constant at its own speed')
    assert.equal(r.tail.speed, 2)
    assert.equal(rampTimelineToSource({ ...clip, ...r.tail }, (r.tail.out - r.tail.in) / r.tail.speed), r.tail.out)
  })

  it('splitRamp of a reversed clip hands the LATE source to the head', () => {
    const r = splitRamp({ in: 0, out: 10 * T, speed: 1, reverse: true }, 4 * T)
    assert.equal(r.head.in, 6 * T, 'reverse plays out -> in: the first 4 s show the last 4 s')
    assert.equal(r.head.out, 10 * T)
    assert.equal(r.tail.in, 0)
    assert.equal(r.tail.out, 6 * T)
    const rr = splitRamp({ in: 0, out: D, speed: 1, reverse: true, speedPoints: easeIn() }, 12 * T)
    assert.equal(rr.head.out, D)
    assert.equal(rr.head.in, D - 9 * T)
    assert.equal(rr.tail.out, D - 9 * T)
    assert.equal(rr.tail.in, 0)
  })

  it('splitRamp never returns a degenerate or non-finite half', () => {
    const contiguous = (clip, r) => (clip.reverse
      ? [r.tail.in === clip.in, r.tail.out === r.head.in, r.head.out === clip.out]
      : [r.head.in === clip.in, r.head.out === r.tail.in, r.tail.out === clip.out])
    for (const clip of [rampClip(), { in: T, out: 5 * T, speed: 0.01 }, { in: 0, out: 6 * T, speed: 8, reverse: true }]) {
      const dur = (clip.out - clip.in) / clip.speed
      for (const cut of [1, Math.round(T / 4), Math.round(dur - 1)]) {
        const r = splitRamp(clip, cut)
        for (const half of [r.head, r.tail]) {
          assert.ok(half.out > half.in, `empty source range: ${JSON.stringify(half)}`)
          assert.ok(Number.isFinite(half.speed) && half.speed >= 0.01, `bad speed: ${half.speed}`)
        }
        assert.deepEqual(contiguous(clip, r), [true, true, true], `source not partitioned once: ${JSON.stringify(r)}`)
      }
    }
  })
})
