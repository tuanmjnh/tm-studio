// tmcut-core — retime tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { validateSpeed, isRetimed, timelineToSource, sourceToTimeline, withSpeed, isRamped, speedAt, rampIntegral, rampTimelineToSource, SPEED_RAMP_PRESETS, buildRampPreset, splitSpeedPoints, splitRamp, rampElapsedForConsumed, trimRamp } from '../src/retime.mjs'
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

  it('rampElapsedForConsumed inverts the speed integral (numeric roundtrip)', () => {
    // The inverse law the export used to encode as a filter expression, kept
    // as arithmetic: for each sample of SOURCE ticks u, the timeline time that
    // has consumed exactly u must integrate back to u.
    const rc = { in: 0, out: 10 * T, speed: 1, speedPoints: clip.speedPoints }
    for (const uSec of [0, 0.5, 1, 2, 3, 4, 4.5, 5, 6, 8, 10, 12]) {
      const tau = rampElapsedForConsumed(rc, uSec * T)
      const back = rampIntegral(rc, tau) / T
      assert.ok(Math.abs(back - uSec) < 0.01, `u=${uSec} -> tau=${tau} -> ${back}`)
    }
    // Monotone: more consumed source never maps to an earlier timeline time.
    let prev = -1
    for (const uSec of [0, 1, 2, 3, 4, 6, 10]) {
      const tau = rampElapsedForConsumed(rc, uSec * T)
      assert.ok(tau > prev, `not monotone at u=${uSec}`)
      prev = tau
    }
  })

  it('rampElapsedForConsumed degrades to the constant form for an equal-speed curve', () => {
    const constClip = { speedPoints: [{ t: 0, speed: 2 }, { t: 4 * T, speed: 2 }] }
    // 4s of source at 2x is 2s of timeline, exactly like the plain division.
    assert.ok(Math.abs(rampElapsedForConsumed(constClip, 4 * T) - 2 * T) < 1e-6)
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

// V4 ADR-027: trimming is a split whose discarded half is thrown away. The
// curve stays anchored to the SOURCE content (the speed a source second had
// when the user drew it), and the survivor takes its own mean speed because
// the flat model derives timeline length from span/speed.
describe('rampElapsedForConsumed + trimRamp (V4 ADR-027)', () => {
  const D = 24 * T
  const easeIn = () => buildRampPreset('ease-in', D, 1) // 0.5x -> 1.5x, mean 1x
  const rampClip = () => ({ in: 0, out: D, speed: 1, speedPoints: easeIn() })

  it('rampElapsedForConsumed inverts rampIntegral exactly', () => {
    const clip = rampClip()
    for (let t = 0; t <= D; t += T / 3) {
      const back = rampElapsedForConsumed(clip, rampIntegral(clip, t))
      assert.ok(Math.abs(back - t) < 1e-6, `t=${t} round-tripped to ${back}`)
    }
    // The two anchors this slice depends on: 9 s of source is the first 12 s
    // of an ease-in 0.5x -> 1.5x clip, and the whole 24 s span is 24 s.
    assert.equal(rampElapsedForConsumed(clip, 9 * T), 12 * T)
    assert.equal(rampElapsedForConsumed(clip, D), D)
  })

  it('rampElapsedForConsumed uses the linear formula for a constant clip', () => {
    const clip = { in: 0, out: 10 * T, speed: 2 }
    assert.equal(rampElapsedForConsumed(clip, 6 * T), 3 * T)
    assert.equal(rampElapsedForConsumed(clip, 0), 0)
    assert.equal(rampElapsedForConsumed(clip, -5), 0, 'never returns a negative elapsed')
  })

  it('rampElapsedForConsumed walks every segment of a multi-point curve', () => {
    const pts = [{ t: 0, speed: 1 }, { t: 4 * T, speed: 3 }, { t: 8 * T, speed: 1 }, { t: 12 * T, speed: 2 }]
    const clip = { in: 0, out: 18 * T, speed: 1, speedPoints: pts }
    for (const t of [T, 4 * T, 6 * T, 8 * T, 11 * T]) {
      const back = rampElapsedForConsumed(clip, rampIntegral(clip, t))
      assert.ok(Math.abs(back - t) < 1e-6, `crossing at ${t / T}s -> ${back / T}s`)
    }
    // Past the last control point the curve clamps to 2x: 8 s of source is 4 s.
    assert.equal(rampElapsedForConsumed(clip, rampIntegral(clip, 12 * T) + 8 * T), 16 * T)
  })

  it('trimRamp re-anchors the curve when the in-edge is pulled forward', () => {
    const r = trimRamp(rampClip(), 'in', 9 * T)
    assert.equal(r.in, 9 * T)
    assert.equal(r.out, 24 * T)
    assert.equal(r.shiftTicks, 12 * T, 'the clip moves right by what it played away')
    assert.ok(Math.abs(r.speed - 1.25) < 1e-9, `surviving 1.0x -> 1.5x mean: ${r.speed}`)
    assert.equal(Math.round((r.out - r.in) / r.speed), 12 * T, 'the timeline length survives the trim')
    assert.deepEqual(r.speedPoints, [{ t: 0, speed: 1 }, { t: 12 * T, speed: 1.5 }])
  })

  it('trimRamp keeps the head curve and does not move the clip on an out trim', () => {
    const r = trimRamp(rampClip(), 'out', 9 * T)
    assert.equal(r.in, 0)
    assert.equal(r.out, 9 * T)
    assert.equal(r.shiftTicks, 0)
    assert.ok(Math.abs(r.speed - 0.75) < 1e-9, `head 0.5x -> 1.0x mean: ${r.speed}`)
    assert.equal(Math.round((r.out - r.in) / r.speed), 12 * T)
    assert.deepEqual(r.speedPoints, [{ t: 0, speed: 0.5 }, { t: 12 * T, speed: 1 }])
  })

  it('trimRamp of a constant clip returns exactly the classic numbers', () => {
    const clip = { in: 2 * T, out: 10 * T, speed: 2 }
    const head = trimRamp(clip, 'out', 6 * T)
    assert.deepEqual(head, { in: 2 * T, out: 6 * T, speed: 2, speedPoints: null, shiftTicks: 0 })
    const tail = trimRamp(clip, 'in', 4 * T)
    assert.deepEqual(tail, { in: 4 * T, out: 10 * T, speed: 2, speedPoints: null, shiftTicks: 1 * T })
  })

  it('trimRamp shaves the end of the play order for a reversed in-trim', () => {
    // Reversed playback consumes source downwards from `out`, so raising `in`
    // removes what plays LAST: the clip keeps its position, shortens, and the
    // surviving window still opens with the FIRST ticks of the curve.
    const r = trimRamp({ ...rampClip(), reverse: true }, 'in', 9 * T)
    assert.equal(r.shiftTicks, 0, 'a back-shaved clip must not move')
    assert.equal(r.in, 9 * T)
    assert.equal(r.out, 24 * T)
    assert.equal(r.speedPoints[0].speed, 0.5, 'the curve phase follows the play order, not the source range')
    assert.ok(r.speed > 0.8 && r.speed < 0.9, `mean of the early slow part: ${r.speed}`)
    assert.equal(Math.round((r.out - r.in) / r.speed), Math.round(rampElapsedForConsumed(rampClip(), 15 * T)))
  })

  it('trimRamp shaves the front of the play order for a reversed out-trim', () => {
    const r = trimRamp({ ...rampClip(), reverse: true }, 'out', 15 * T)
    assert.equal(r.in, 0)
    assert.equal(r.out, 15 * T)
    assert.equal(r.shiftTicks, 12 * T, '1.5x down to 1.0x covers the first 9 s of source in 12 s')
    assert.ok(Math.abs(r.speed - 1.25) < 1e-9, `surviving span 15 s over 12 s: ${r.speed}`)
    assert.deepEqual(r.speedPoints, [{ t: 0, speed: 1 }, { t: 12 * T, speed: 1.5 }])
  })

  it('every trimRamp result replays its source range exactly once', () => {
    const mountain = { in: T, out: 9 * T, speed: 0.5, speedPoints: buildRampPreset('mountain', 16 * T, 0.5) }
    for (const clip of [rampClip(), { ...rampClip(), reverse: true }, mountain]) {
      const span = clip.out - clip.in
      // Precondition, or this test would prove nothing: the model's rule is
      // that the curve spans the clip's derived length and its MEAN equals
      // `speed`. A fixture that breaks it (curve over 8 s, length 16 s) fails
      // here instead of blaming trimRamp for the author's arithmetic.
      const length = span / validateSpeed(clip.speed)
      assert.ok(Math.abs(rampIntegral(clip, length) - span) < 1,
        `fixture does not hold the mean-preserving invariant: ${JSON.stringify(clip.speedPoints)}`)
      for (const edge of ['in', 'out']) {
        for (const target of [2 * T, 9 * T, 12 * T, 21 * T]) {
          const r = trimRamp(clip, edge, target)
          assert.ok(r.out - r.in >= 1, `empty source range after ${edge}@${target / T}: ${JSON.stringify(r)}`)
          assert.ok(Number.isFinite(r.speed) && r.speed >= 0.01, `bad speed ${r.speed}`)
          const keptSpan = r.out - r.in
          const exact = rampIntegral(r, keptSpan / r.speed)
          assert.ok(Math.abs(exact - keptSpan) < 1,
            `${edge}@${target / T}s: mean ${r.speed} does not reproduce the ${keptSpan / T} s range (got ${exact / T})`)
          // The integer length a consumer actually derives is `round(length)`,
          // so the residual is at most a tick of the half's own speed.
          const rounded = rampIntegral(r, Math.round(keptSpan / r.speed))
          assert.ok(Math.abs(rounded - keptSpan) <= 2 * r.speed + 2,
            `${edge}@${target / T}s covers ${rounded / T} s of a ${keptSpan / T} s range (speed ${r.speed})`)
        }
      }
    }
  })
})
