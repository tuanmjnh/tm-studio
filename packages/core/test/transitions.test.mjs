// tmcut-core — transitions tests (Roadmap C5). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  KNOWN_TRANSITIONS,
  canApplyTransition,
  applyTransition,
  clearTransition,
  transitionWindows,
  XFADE_PREVIEW,
  XFADE_POSITION_LAWS,
  XFADE_COMB_PERIOD,
  previewTransitionRamp
} from '../src/transitions.mjs'
import { addClip } from '../src/timeline.mjs'
import { defaultTimeline } from '../src/project.mjs'
import { secToTicks, TICKS_PER_SECOND } from '../src/time.mjs'

/**
 * Read a comb back out of the CSS the model emits: one tooth per inked/gap stop
 * pair, `start` the tooth's low edge as a fraction of the axis and `fill` its
 * fill fraction (0..1), both ordered along the direction the gradient runs.
 */
function combTeeth(css) {
  const body = String(css).replace(/^linear-gradient\(([a-z -]+), /, '$1|').split('|')[1]
    .replace(/\)$/, '')
  const stops = body.split(', ').map((stop) => {
    const [colour, from, to] = stop.trim().split(/\s+/)
    return { colour, from: Number.parseFloat(from) / 100, to: Number.parseFloat(to) / 100 }
  })
  const teeth = []
  for (let i = 0; i < stops.length; i += 2) {
    const ink = stops[i]
    const gap = stops[i + 1]
    assert.equal(ink.colour, '#000', 'a comb tooth must open on the inked stop')
    assert.equal(gap.colour, 'transparent', 'a comb tooth must close on the gap')
    teeth.push({ start: ink.from, fill: (ink.to - ink.from) / XFADE_COMB_PERIOD })
  }
  return teeth.sort((a, b) => a.start - b.start)
}

const SHAPES = ['crossfade', 'wipe', 'softwipe', 'slide', 'squeeze', 'diag', 'band', 'comb',
  'corner', 'iris', 'hole', 'rect', 'pie']
const FIDELITIES = ['exact', 'shape', 'approximate']

// Two adjacent 2 s clips: A [0..2s], B [2s..4s] (addClip appends).
function pair() {
  const timeline = defaultTimeline()
  const a = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) } })
  const b = addClip(timeline, 'video', { source: { in: 0, out: secToTicks(2) } })
  const track = timeline.tracks.find(t => t.type === 'video')
  return { timeline, track, a, b }
}

describe('transitions (C5)', () => {
  it('refuses unknown types and non-positive durations', () => {
    // R128 froze this exact 45-key list: the 6 legacy keys first (stored
    // projects), then the remaining xfade names in alphabetical order.
    // The app-side catalog test pins the same list — change one, change both.
    assert.deepEqual(KNOWN_TRANSITIONS, [
      'fade', 'dissolve', 'wipe-left', 'wipe-right', 'slide-left', 'zoom-in',
      'circleclose', 'circlecrop', 'circleopen', 'diagbl', 'diagbr', 'diagtl',
      'diagtr', 'distance', 'fadeblack', 'fadegrays', 'fadewhite', 'hblur',
      'hlslice', 'hrslice', 'horzclose', 'horzopen', 'pixelize', 'radial',
      'rectcrop', 'slidedown', 'slideright', 'slideup', 'smoothdown',
      'smoothleft', 'smoothright', 'smoothup', 'squeezeh', 'squeezev',
      'vertclose', 'vertopen', 'vdslice', 'vuslice', 'wipebl', 'wipebr',
      'wipedown', 'wipetl', 'wipetr', 'wipeup', 'zoomin'
    ])
    assert.equal(new Set(KNOWN_TRANSITIONS).size, KNOWN_TRANSITIONS.length)
    // R128 keys must validate as known types (canApplyTransition gate).
    const fresh = pair()
    assert.deepEqual(canApplyTransition(fresh.timeline, fresh.b.id, 'circleopen', secToTicks(0.5)), { ok: true, overlapTicks: secToTicks(0.5) })
    const { timeline, b } = pair()
    assert.deepEqual(
      canApplyTransition(timeline, b.id, 'star-wipe', secToTicks(0.5)),
      { ok: false, reason: 'unknown-type' }
    )
    assert.equal(canApplyTransition(timeline, b.id, 'fade', 0).reason, 'too-long')
    assert.equal(canApplyTransition(timeline, b.id, 'fade', -5).reason, 'too-long')
    assert.equal(applyTransition(timeline, b.id, 'star-wipe', secToTicks(0.5)), false)
  })

  it('refuses the first clip and unknown ids (no-neighbor)', () => {
    const { timeline, a, b } = pair()
    assert.deepEqual(canApplyTransition(timeline, a.id, 'fade', secToTicks(0.5)), { ok: false, reason: 'no-neighbor' })
    assert.deepEqual(canApplyTransition(timeline, 'ghost', 'fade', secToTicks(0.5)), { ok: false, reason: 'no-neighbor' })
    assert.equal(applyTransition(timeline, 'ghost', 'fade', secToTicks(0.5)), false)
    assert.equal(clearTransition(timeline, 'ghost'), false)
    // Valid request on B for contrast.
    assert.equal(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)).ok, true)
  })

  it('refuses a gap between the neighbor and the cut', () => {
    const { timeline, b } = pair()
    b.timeline.start = secToTicks(3) // B no longer touches A's end
    assert.deepEqual(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)), { ok: false, reason: 'gap' })
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), false)
    // The untouched cut position must remain (apply failed atomically).
    assert.equal(b.timeline.start, secToTicks(3))
    assert.equal(b.transitionIn, undefined)
  })

  it('refuses overlaps longer than either clip of the pair', () => {
    const { timeline, b } = pair() // both clips are 2 s
    assert.deepEqual(
      canApplyTransition(timeline, b.id, 'fade', secToTicks(3)),
      { ok: false, reason: 'too-long' }
    )
    const exact = canApplyTransition(timeline, b.id, 'dissolve', secToTicks(2))
    assert.equal(exact.ok, true)
    assert.equal(exact.overlapTicks, secToTicks(2))
  })

  it('applies the overlap and reports the window', () => {
    const { timeline, track, a, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    // B shifted LEFT by 0.5 s so both layers overlap.
    assert.equal(b.timeline.start, secToTicks(1.5))
    assert.deepEqual(b.transitionIn, { type: 'fade', duration: secToTicks(0.5) })
    assert.deepEqual(transitionWindows(track), [
      { fromId: a.id, toId: b.id, startTicks: secToTicks(1.5), endTicks: secToTicks(2) }
    ])
    // Neighbor A never moves.
    assert.equal(a.timeline.start, 0)
    // Broken pair (neighbor no longer ends at the overlap end) is skipped.
    a.source.out = secToTicks(1)
    a.timeline.duration = secToTicks(1)
    assert.deepEqual(transitionWindows(track), [])
  })

  it('reports windows for the app store flat clip shape', () => {
    // Same pair as above, but with `offset` + `in`/`out`/`speed` (no
    // `timeline`/`source`) — the shape the editor preview hands the core.
    const items = [
      { id: 'a', type: 'video', in: 0, out: secToTicks(2), offset: 0, speed: 1 },
      { id: 'b', type: 'video', in: 0, out: secToTicks(2), offset: secToTicks(1.5), speed: 1, transitionIn: { type: 'fade', duration: secToTicks(0.5) } }
    ]
    assert.deepEqual(transitionWindows({ type: 'video', items }), [
      { fromId: 'a', toId: 'b', startTicks: secToTicks(1.5), endTicks: secToTicks(2) }
    ])
    items[0].out = secToTicks(1)
    assert.deepEqual(transitionWindows({ type: 'video', items }), [], 'trimmed neighbour breaks the pair')
  })

  it('pins the adjacency tolerance: grid drift is a cut, a real gap is not', () => {
    // Positions round-trip the app's 1e-4 s grid (12 ticks), so a stored pair
    // can sit a fraction of a millisecond off exact ticks. `ADJACENCY_EPS` is
    // the ONLY place that tolerance lives, and BOTH the preview (through
    // `evaluateTimeline`) and the export (through `transitionWindows`) read the
    // same two calls — so the boundary must not drift silently in either
    // direction. Widening it makes broken pairs crossfade; narrowing it drops
    // real ones.
    const EPS = TICKS_PER_SECOND / 1000 // 1 ms
    const GRID_QUANTUM = TICKS_PER_SECOND / 10_000 // the app grid: 1e-4 s
    assert.ok(GRID_QUANTUM < EPS, 'the grid must stay inside the tolerance')

    const overlap = secToTicks(0.5)
    const flatPairWith = drift => ({
      type: 'video',
      items: [
        { id: 'a', type: 'video', in: 0, out: secToTicks(2), offset: 0, speed: 1 },
        { id: 'b', type: 'video', in: 0, out: secToTicks(2), offset: secToTicks(1.5) + drift, speed: 1, transitionIn: { type: 'fade', duration: overlap } }
      ]
    })
    // The window travels with the drifted clip; only its EXISTENCE is at stake.
    const windowAt = drift => ({
      fromId: 'a',
      toId: 'b',
      startTicks: secToTicks(1.5) + drift,
      endTicks: secToTicks(2) + drift
    })

    for (const drift of [0, GRID_QUANTUM, -GRID_QUANTUM, EPS, -EPS]) {
      assert.deepEqual(
        transitionWindows(flatPairWith(drift)),
        [windowAt(drift)],
        `${drift} ticks of drift is inside the tolerance`
      )
    }
    assert.deepEqual(transitionWindows(flatPairWith(EPS + 1)), [], '1 tick past it is a broken pair, not a transition')
    assert.deepEqual(transitionWindows(flatPairWith(-EPS - 1)), [], 'and the same on the other side')
    assert.deepEqual(transitionWindows(flatPairWith(50 * EPS)), [], 'the 50 ms the old export check admitted is 50x too loose')

    // The same constant gates applying a transition onto a cut.
    const near = (drift) => {
      const { timeline, b } = pair()
      b.timeline.start = secToTicks(2) + drift
      return { timeline, clipId: b.id }
    }
    const atTolerance = near(EPS)
    assert.equal(canApplyTransition(atTolerance.timeline, atTolerance.clipId, 'fade', overlap).ok, true)
    const pastTolerance = near(EPS + 1)
    assert.deepEqual(
      canApplyTransition(pastTolerance.timeline, pastTolerance.clipId, 'fade', overlap),
      { ok: false, reason: 'gap' }
    )
  })

  it('re-applying replaces the previous shift instead of stacking', () => {
    const { timeline, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    assert.equal(b.timeline.start, secToTicks(1.5))
    assert.equal(applyTransition(timeline, b.id, 'wipe-left', secToTicks(1)), true)
    // Total shift is exactly 1 s — the old 0.5 s shift was restored first.
    assert.equal(b.timeline.start, secToTicks(1))
    assert.deepEqual(b.transitionIn, { type: 'wipe-left', duration: secToTicks(1) })
    // The effective cut (start + stored duration) still touches A's end.
    assert.equal(canApplyTransition(timeline, b.id, 'zoom-in', secToTicks(0.5)).ok, true)
  })

  it('keeps validating against the un-shifted cut once applied', () => {
    const { timeline, a, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    // Trim A shorter: the ORIGINAL cut (start + stored duration) now has a
    // gap, even though raw B.start touches A's new end.
    a.source.out = secToTicks(1.5)
    a.timeline.duration = secToTicks(1.5)
    assert.equal(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)).reason, 'gap')
  })

  it('clearing restores the original cut position', () => {
    const { timeline, b } = pair()
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    assert.equal(clearTransition(timeline, b.id), true)
    assert.equal(b.timeline.start, secToTicks(2))
    assert.equal(b.transitionIn, undefined)
    assert.equal(clearTransition(timeline, b.id), false) // nothing left
  })

  it('locked tracks refuse apply and clear (core lock-guard)', () => {
    const { timeline, track, b } = pair()
    track.locked = true
    assert.deepEqual(canApplyTransition(timeline, b.id, 'fade', secToTicks(0.5)), { ok: false, reason: 'locked' })
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), false)
    assert.equal(clearTransition(timeline, b.id), false)
    track.locked = false
    assert.equal(applyTransition(timeline, b.id, 'fade', secToTicks(0.5)), true)
    track.locked = true
    assert.equal(clearTransition(timeline, b.id), false)
    assert.equal(b.timeline.start, secToTicks(1.5)) // still shifted, untouched
  })
})

describe('xfade preview geometry (V4 G16)', () => {
  const FRAMES = Array.from({ length: 12 }, (_, i) => (i + 1) / 12)

  // The fraction of the box an `inset()` or `polygon()` clip-path keeps, in
  // proportion units. `pct()` rounds to 2 decimals of a percent, so a shape can
  // be off by ~0.001 of the area from rounding alone — the tests below use a
  // tolerance around that, not around the assertion they want to pass.
  function shapeArea(css) {
    if (css.startsWith('inset(')) {
      const v = css.slice(6, -1).trim().split(/\s+/).map(part => Number.parseFloat(part) / 100)
      const sides = v.length === 1
        ? [v[0], v[0], v[0], v[0]]
        : v.length === 2
          ? [v[0], v[1], v[0], v[1]]
          : v
      const [top, right, bottom, left] = sides
      return Math.max(0, 1 - top - bottom) * Math.max(0, 1 - left - right)
    }
    const points = css.slice(8, -1).split(',').map(pair =>
      pair.trim().split(/\s+/).map(part => Number.parseFloat(part) / 100))
    let area = 0
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % points.length]
      area += x1 * y2 - x2 * y1
    }
    return Math.abs(area) / 2
  }

  it('classifies every published key', () => {
    for (const key of KNOWN_TRANSITIONS) {
      const spec = XFADE_PREVIEW[key]
      assert.ok(spec, `${key} has no preview geometry`)
      assert.ok(SHAPES.includes(spec.shape), `${key}: unknown shape ${spec.shape}`)
      assert.ok(spec.law in XFADE_POSITION_LAWS, `${key}: unknown law ${spec.law}`)
      assert.ok(FIDELITIES.includes(spec.fidelity), `${key}: unknown fidelity ${spec.fidelity}`)
    }
    assert.deepEqual(Object.keys(XFADE_PREVIEW).sort(), [...KNOWN_TRANSITIONS].sort(),
      'the geometry table and the published key list must not drift apart')
  })

  it('an unknown key falls back to a plain crossfade instead of inventing a wipe', () => {
    const ramp = previewTransitionRamp('not-a-transition', 0.5)
    assert.equal(ramp.shape, 'crossfade')
    assert.equal(ramp.fidelity, 'approximate')
    assert.equal(ramp.incoming.opacity, 0.5)
    assert.equal(ramp.incoming.clipPath, undefined)
  })

  it('reveals nothing at the head and everything at the tail of the overlap', () => {
    for (const key of KNOWN_TRANSITIONS) {
      const head = previewTransitionRamp(key, 0)
      const tail = previewTransitionRamp(key, 1)
      if (head.coverage !== null) {
        assert.equal(head.coverage, 0, `${key} leaks ${head.coverage} at p=0`)
        assert.equal(tail.coverage, 1, `${key} leaves a hole at p=1 (${tail.coverage})`)
      } else {
        // The three families whose area depends on the canvas aspect still
        // have to reach an empty and a full shape at the two endpoints.
        const css = head.incoming.clipPath || head.incoming.maskImage
        const last = tail.incoming.clipPath || tail.incoming.maskImage
        assert.ok(css, `${key} has no reveal geometry at p=0`)
        if (head.shape === 'iris') assert.match(css, /circle\(0\.00% at/)
        if (head.shape === 'hole') assert.match(css, /circle 70\.71% at/)
        if (head.shape === 'pie') assert.match(css, /#000 0\.00deg/)
        if (tail.shape === 'iris') assert.match(last, /circle\(70\.71% at/)
        if (tail.shape === 'hole') assert.match(last, /circle 0\.00% at/)
        if (tail.shape === 'pie') assert.match(last, /#000 360\.00deg/)
      }
      assert.equal(head.incoming.opacity, key === 'zoom-in' || key === 'zoomin' || key === 'fadeblack' || key === 'fadewhite' || head.shape === 'crossfade' ? 0 : 1, `${key} head opacity`)
      assert.equal(tail.incoming.opacity, 1, `${key} tail opacity`)
    }
  })

  it('travels forward, never back', () => {
    for (const key of KNOWN_TRANSITIONS) {
      let previousTravel = -1
      let previousCoverage = -1
      for (const p of FRAMES) {
        const ramp = previewTransitionRamp(key, p)
        assert.ok(ramp.travel >= 0 && ramp.travel <= 1, `${key} @${p}: travel ${ramp.travel}`)
        assert.ok(ramp.travel >= previousTravel - 1e-12, `${key} @${p}: travel went backwards`)
        previousTravel = ramp.travel
        if (ramp.coverage !== null) {
          assert.ok(ramp.coverage >= previousCoverage - 1e-12, `${key} @${p}: coverage went backwards`)
          previousCoverage = ramp.coverage
        }
      }
    }
  })

  it('reports the diagonal as an area, not as a front position', () => {
    // `travel` is where the 45-degree front has reached; what the preview has to
    // publish is the AREA it uncovered, which is leg^2 / 2 in a unit square =
    // travel^2. Pinning the square is what keeps a future law change from
    // silently re-defining coverage back to front position — and it is the only
    // coverage in the table that is aspect-free, because the line is 45 degrees
    // in proportions, not in pixels (measured identical at 320x180, 180x320,
    // 200x200 to within 0.1% of the frame).
    for (const key of ['diagbl', 'diagbr', 'diagtl', 'diagtr']) {
      for (const p of FRAMES) {
        const ramp = previewTransitionRamp(key, p)
        assert.equal(ramp.coverage, ramp.travel * ramp.travel, `${key} @${p}: coverage ${ramp.coverage} != travel^2`)
      }
      assert.equal(previewTransitionRamp(key, 0.5).coverage, 0.25, `${key} mid-frame covers a quarter`)
    }
  })

  it('paints exactly the area it claims to cover', () => {
    // `coverage` is the number the render-parity spec compares against FFmpeg,
    // but the browser never reads it — it clips to `incoming.clipPath`. If the
    // two ever disagree, the spec grades a number the preview does not draw.
    // This closes that loop without a browser: measure the published shape.
    for (const key of KNOWN_TRANSITIONS) {
      for (const p of [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1]) {
        const ramp = previewTransitionRamp(key, p)
        const css = ramp.incoming.clipPath
        if (ramp.coverage === null || !css || css.startsWith('circle(')) continue
        const area = shapeArea(css)
        assert.ok(Math.abs(area - ramp.coverage) < 0.002,
          `${key} @${p}: the shape covers ${(area * 100).toFixed(2)}% but the model says ${(ramp.coverage * 100).toFixed(2)}% — ${css}`)
      }
    }
  })

  it('emits parseable CSS with no numbers left undefined', () => {
    for (const key of KNOWN_TRANSITIONS) {
      for (const p of [0, 0.25, 0.5, 0.75, 1]) {
        const ramp = previewTransitionRamp(key, p)
        for (const layer of [ramp.incoming, ramp.outgoing]) {
          const json = JSON.stringify(layer)
          assert.ok(!/NaN|undefined|null/.test(json), `${key} @${p}: ${json}`)
          if (layer.clipPath) {
            assert.match(layer.clipPath, /^(inset|circle|polygon)\(/, `${key} @${p}: ${layer.clipPath}`)
            const opens = layer.clipPath.split('(').length - 1
            assert.equal(layer.clipPath.split(')').length - 1, opens, `${key} unbalanced parens`)
            assert.ok(!layer.clipPath.includes('-0.00%'), `${key} @${p}: negative inset ${layer.clipPath}`)
          }
          if (layer.maskImage) {
            assert.match(layer.maskImage, /^(linear|radial|repeating-linear|conic)-gradient\(/, `${key} @${p}: ${layer.maskImage}`)
            // The alpha-mask convention of this project is opaque #000 = visible.
            assert.ok(layer.maskImage.includes('#000'), `${key} @${p}: mask has no opaque stop`)
            assert.equal(layer.maskSize, '100% 100%')
          }
        }
      }
    }
  })

  it('only slide moves the outgoing layer, and only fadeblack dims it', () => {
    for (const key of KNOWN_TRANSITIONS) {
      const ramp = previewTransitionRamp(key, 0.5)
      if (ramp.outgoing.transform) assert.equal(ramp.shape, 'slide', `${key} moves the outgoing layer`)
      if (ramp.outgoing.opacity < 1) assert.equal(key, 'fadeblack', `${key} dims the outgoing layer`)
    }
  })

  it('every key paints a reveal of its own — nothing is degraded to a fade', () => {
    // There used to be one exception: `squeezev` carried shape `unavailable`
    // because a probe put the xfade window at offset=0.6 on 1.2 s plates, where
    // the filter reads past the first input and dies. On the window the export
    // actually emits (offset = firstInputLength - duration) all 45 keys render,
    // so the vocabulary for "the binary refuses this name" is gone and no key
    // may fall back to a bare opacity ramp.
    assert.equal(XFADE_PREVIEW.squeezev.shape, 'squeeze')
    assert.ok(!SHAPES.includes('unavailable'), 'the shape retired with its last row')
    for (const key of KNOWN_TRANSITIONS) {
      const ramp = previewTransitionRamp(key, 0.5)
      if (ramp.shape === 'crossfade') continue // an opacity ramp IS the geometry
      const css = ramp.incoming.clipPath || ramp.incoming.maskImage || ramp.incoming.transform
      assert.ok(css, `${key} (${ramp.shape}) reaches p=0.5 with no reveal geometry`)
      assert.equal(ramp.incoming.opacity, 1, `${key} (${ramp.shape}) fades as well as reveals`)
    }
  })

  it('the two squeezes paint perpendicular fronts', () => {
    // Their area curves are identical — each covers exactly `travel` of the box
    // — so a sweep of mean luminance cannot tell them apart and the letters were
    // swapped for a whole slice without any spec noticing. What separates them is
    // the axis the band front moves along, which is what the pixels say (guards
    // tmcut_transition_preview and tmcut_render_smoke measure it on solid plates).
    assert.equal(XFADE_PREVIEW.squeezeh.travel, 'y')
    assert.equal(XFADE_PREVIEW.squeezev.travel, 'x')
    const h = previewTransitionRamp('squeezeh', 0.5).incoming.maskImage
    const v = previewTransitionRamp('squeezev', 0.5).incoming.maskImage
    assert.match(h, /linear-gradient\(to bottom/, 'squeezeh must band from the top and bottom edges')
    assert.match(v, /linear-gradient\(to right/, 'squeezev must band from the left and right edges')
    // The band family names the same variable, and its letters are measured too:
    // horzopen cuts a horizontal band (front along y), vertopen a vertical one.
    assert.equal(XFADE_PREVIEW.horzopen.travel, 'y')
    assert.equal(XFADE_PREVIEW.vertopen.travel, 'x')
  })

  it('the slice family is ten teeth on a travelling band, not one front', () => {
    // FFmpeg's `HLSLICE_TRANSITION` compares `fract(10 * x / w)` against a
    // smoothstep band whose position is `x / w - 1.5 * progress`: ten teeth, a
    // band half the axis wide, and a front that moves LINEARLY with progress.
    // Each tooth fills on the side still outgoing, so the teeth nearest the entry
    // edge are the last to fill.
    const FROM = { hlslice: 'right', hrslice: 'left', vdslice: 'top', vuslice: 'bottom' }
    for (const [key, from] of Object.entries(FROM)) {
      assert.equal(XFADE_PREVIEW[key].shape, 'comb', `${key} is not a comb`)
      assert.equal(XFADE_PREVIEW[key].from, from, `${key} reveals from the wrong edge`)
      assert.equal(XFADE_PREVIEW[key].law, 'linear', `${key} lost the slice timing`)
      const teeth = combTeeth(previewTransitionRamp(key, 0.5).incoming.maskImage)
      assert.equal(teeth.length, Math.round(1 / XFADE_COMB_PERIOD), `${key}: wrong tooth count`)
      assert.ok(teeth[teeth.length - 1].fill > 0.94, `${key}: the entry-edge tooth is not whole at p=0.5`)
      for (let k = 1; k < teeth.length; k++) {
        assert.ok(teeth[k].fill >= teeth[k - 1].fill - 0.06, `${key}: fills must grow toward ${from}`)
        assert.ok(Math.abs(teeth[k].start - k * XFADE_COMB_PERIOD) < 1e-6, `${key}: tooth ${k} is off-grid`)
      }
    }
    // The tooth fills of `hlslice` at p=0.5, read band by band off the rendered
    // frame. A single hard front cannot produce this row.
    const MEASURED = [0, 0, 0, 0.06, 0.31, 0.72, 0.97, 1, 1, 1]
    combTeeth(previewTransitionRamp('hlslice', 0.5).incoming.maskImage).forEach((tooth, k) => {
      assert.ok(Math.abs(tooth.fill - MEASURED[k]) <= 0.08,
        `hlslice tooth ${k}: model ${tooth.fill.toFixed(2)} against measured ${MEASURED[k].toFixed(2)}`)
    })
    // Coverage is the mean of the teeth, and it rises over the window even though
    // the individual fills jump.
    let previous = -1
    for (const p of FRAMES) {
      const ramp = previewTransitionRamp('hlslice', p)
      const sum = combTeeth(ramp.incoming.maskImage).reduce((acc, tooth) => acc + tooth.fill, 0)
      assert.ok(Math.abs(ramp.coverage - sum / 10) < 0.006, `hlslice @${p}: coverage is not the mean tooth fill`)
      assert.ok(ramp.coverage >= previous - 1e-9, `hlslice @${p}: coverage went backwards`)
      previous = ramp.coverage
    }
    assert.equal(previewTransitionRamp('hlslice', 0).coverage, 0)
    assert.equal(previewTransitionRamp('hlslice', 1).coverage, 1)
    for (const key of KNOWN_TRANSITIONS) {
      for (const p of [0.25, 0.5, 0.75]) {
        const ramp = previewTransitionRamp(key, p)
        for (const layer of [ramp.incoming, ramp.outgoing]) {
          assert.ok(!String(layer.maskImage || '').startsWith('repeating'),
            `${key} @${p}: a tiled mask is back — no rendered key stripes`)
        }
      }
    }
  })

  it('the crop and the sweep start late, as the 12 frames measured', () => {
    // `circlecrop` shows no incoming at all through the first half of the window
    // (radius 0 at p=0.5, 0.125 of the covering radius at 0.75) and `radial`
    // holds its angle below the linear ramp until p passes 0.18. Both are fits,
    // and a fit only means something while these numbers hold.
    assert.equal(XFADE_POSITION_LAWS.lateCube(0.5), 0)
    assert.equal(XFADE_POSITION_LAWS.lateCube(0.75), 0.125)
    assert.equal(XFADE_POSITION_LAWS.lateCube(1), 1)
    assert.equal(previewTransitionRamp('circlecrop', 0.5).incoming.clipPath, 'circle(0.00% at 50% 50%)')
    assert.equal(XFADE_POSITION_LAWS.radialLag(0.18), 0)
    assert.ok(XFADE_POSITION_LAWS.radialLag(0.5) < 0.5, 'the sweep must lag the linear ramp mid-window')
    assert.ok(XFADE_POSITION_LAWS.radialLag(0.5) > 0.35,
      `the sweep only lagged ${(XFADE_POSITION_LAWS.radialLag(0.5) * 100).toFixed(1)}% of the box`)
  })

  it('the disc radius that covers the box is aspect-independent', () => {
    // circle() percentages resolve against sqrt(w^2+h^2)/sqrt(2) and the
    // covering radius is sqrt(w^2+h^2)/2, so the number is always 100/sqrt(2).
    assert.match(previewTransitionRamp('circleopen', 1).incoming.clipPath, /circle\(70\.71% at 50% 50%\)/)
  })
})
