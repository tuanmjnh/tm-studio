// tmcut-core — timeline evaluation tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { clipSourceRange, evaluateClip, evaluateTimeline, textAnimationAt } from '../src/evaluate.mjs'
import { maskAlphaExpr, maskCssMaskImage } from '../src/mask.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const T = TICKS_PER_SECOND

function videoClip(overrides = {}) {
  return {
    id: 'clip-v',
    type: 'video',
    assetId: null,
    locator: { runtime: 'local', path: 'C:/media/a.mp4' },
    source: { in: 0, out: 10 * T },
    timeline: { start: 0, duration: 10 * T },
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    effects: [],
    keyframes: [],
    ...overrides
  }
}

function timelineOf(clips, trackOverrides = {}) {
  return {
    version: 3,
    markers: [],
    tracks: [{ id: 't-video', type: 'video', items: clips, ...trackOverrides }]
  }
}

function only(layerList) {
  assert.equal(layerList.length, 1, 'expected exactly one live layer')
  return layerList[0]
}

describe('evaluateTimeline — active range', () => {
  it('returns no layers for an empty timeline', () => {
    const result = evaluateTimeline(timelineOf([]), 0)
    assert.deepEqual(result.layers, [])
    assert.equal(result.at, 0)
  })

  it('includes the start tick and excludes the end tick', () => {
    const timeline = timelineOf([videoClip({ timeline: { start: 2 * T, duration: 4 * T } })])
    assert.equal(evaluateTimeline(timeline, 2 * T).layers.length, 1)
    assert.equal(evaluateTimeline(timeline, 6 * T - 1).layers.length, 1)
    assert.equal(evaluateTimeline(timeline, 6 * T).layers.length, 0)
    assert.equal(evaluateTimeline(timeline, 2 * T - 1).layers.length, 0)
  })

  it('ignores zero-duration clips', () => {
    const timeline = timelineOf([videoClip({ timeline: { start: 0, duration: 0 } })])
    assert.deepEqual(evaluateTimeline(timeline, 0).layers, [])
  })

  it('accepts a project wrapper and normalizes the time', () => {
    const timeline = timelineOf([videoClip()])
    const result = evaluateTimeline({ version: 3, canvas: {}, timeline }, 1.6 * T)
    assert.equal(result.at, Math.round(1.6 * T))
    assert.equal(result.layers.length, 1)
  })

  it('is deterministic for the same input', () => {
    const timeline = timelineOf([videoClip({ keyframes: [
      { t: 0, prop: 'x', value: 0 },
      { t: 2 * T, prop: 'x', value: 100 }
    ] })])
    assert.deepEqual(evaluateTimeline(timeline, 1.25 * T), evaluateTimeline(timeline, 1.25 * T))
  })
})

describe('evaluateTimeline — source mapping', () => {
  it('reports clip-local ticks and source ticks', () => {
    const timeline = timelineOf([
      videoClip({ source: { in: 2 * T, out: 12 * T }, timeline: { start: 4 * T, duration: 4 * T } })
    ])
    const layer = only(evaluateTimeline(timeline, 5 * T).layers)
    assert.equal(layer.localTicks, T)
    assert.equal(layer.sourceTicks, 3 * T)
  })

  it('honours speed', () => {
    const timeline = timelineOf([
      videoClip({ source: { in: T, out: 9 * T }, timeline: { start: 0, duration: 4 * T }, speed: 2 })
    ])
    assert.equal(only(evaluateTimeline(timeline, 2 * T).layers).sourceTicks, 5 * T)
  })

  it('honours reverse', () => {
    const timeline = timelineOf([
      videoClip({ source: { in: 0, out: 10 * T }, timeline: { start: 0, duration: 10 * T }, reverse: true })
    ])
    assert.equal(only(evaluateTimeline(timeline, 2 * T).layers).sourceTicks, 8 * T)
  })

  it('maps a speed curve through the integral, not the base speed', () => {
    const timeline = timelineOf([
      videoClip({
        source: { in: 0, out: 10 * T },
        timeline: { start: 0, duration: 10 * T },
        speedPoints: [{ t: 0, speed: 1 }, { t: 2 * T, speed: 2 }]
      })
    ])
    const atCurve = only(evaluateTimeline(timeline, 2 * T).layers)
    assert.equal(atCurve.ramped, true)
    assert.equal(atCurve.sourceTicks, 3 * T, 'area of 1→2 over 2 s is 3 s')
    assert.equal(only(evaluateTimeline(timeline, 4 * T).layers).sourceTicks, 7 * T, 'then the clamped 2× tail adds 4 s')
  })

  it('runs a speed curve backwards for reversed clips', () => {
    const timeline = timelineOf([
      videoClip({
        source: { in: 0, out: 10 * T },
        timeline: { start: 0, duration: 10 * T },
        reverse: true,
        speedPoints: [{ t: 0, speed: 1 }, { t: 2 * T, speed: 2 }]
      })
    ])
    assert.equal(only(evaluateTimeline(timeline, 2 * T).layers).sourceTicks, 7 * T)
  })

  it('does not flag a curve with fewer than two valid points', () => {
    const timeline = timelineOf([
      videoClip({
        timeline: { start: 0, duration: 10 * T },
        speedPoints: [null, { t: 0, speed: 2 }]
      })
    ])
    const layer = only(evaluateTimeline(timeline, 2 * T).layers)
    assert.equal(layer.ramped, false)
    assert.equal(layer.sourceTicks, 2 * T)
  })

  it('leaves sourceTicks null for text clips', () => {
    const text = {
      id: 'clip-t',
      type: 'text',
      text: 'Hello',
      timeline: { start: 0, duration: 3 * T },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: []
    }
    const layer = only(evaluateTimeline(timelineOf([text]), T).layers)
    assert.equal(layer.sourceTicks, null)
    assert.equal(layer.text.content, 'Hello')
    assert.equal(layer.text.align, 'center')
  })
})

describe('evaluateTimeline — transform, opacity, audio', () => {
  it('interpolates keyframed opacity and normalizes it to 0..1', () => {
    const timeline = timelineOf([videoClip({ keyframes: [
      { t: 0, prop: 'opacity', value: 40 },
      { t: 2 * T, prop: 'opacity', value: 90, easing: 'linear' }
    ] })])
    const layer = only(evaluateTimeline(timeline, T).layers)
    assert.ok(Math.abs(layer.opacity - 0.65) < 1e-9)
  })

  it('resolves transform with base values, keyframes and legacy scale', () => {
    const timeline = timelineOf([videoClip({
      transform: { x: 10, y: 20, scaleX: 1.5, scaleY: 1.5, rotation: 15, opacity: 1 },
      keyframes: [
        { t: 0, prop: 'x', value: 100 },
        { t: 2 * T, prop: 'x', value: 300 }
      ]
    })])
    const layer = only(evaluateTimeline(timeline, T).layers)
    assert.equal(layer.transform.x, 200)
    assert.equal(layer.transform.y, 20)
    assert.equal(layer.transform.rotation, 15)
    assert.equal(layer.transform.scaleX, 1.5)

    const legacy = only(evaluateTimeline(timelineOf([videoClip({ scale: 200 })]), 0).layers)
    assert.equal(legacy.transform.scaleX, 2)
    assert.equal(legacy.transform.scaleY, 2)
  })

  it('applies the fade envelope to the audio gain', () => {
    const timeline = timelineOf([videoClip({ volume: 100, fade: { in: 2 * T, out: 0 } })], { type: 'audio' })
    const layer = only(evaluateTimeline(timeline, T).layers)
    assert.ok(Math.abs(layer.volume - 0.5) < 1e-9)
    assert.equal(layer.audible, true)
  })

  it('multiplies clip volume by track volume', () => {
    const timeline = timelineOf([videoClip({ volume: 80 })], { type: 'audio', volume: 50 })
    const layer = only(evaluateTimeline(timeline, T).layers)
    assert.ok(Math.abs(layer.volume - 0.4) < 1e-9)
  })

  it('lets a volume keyframe override the flat clip volume', () => {
    const timeline = timelineOf([videoClip({ volume: 80, keyframes: [
      { t: 0, prop: 'volume', value: 50 }
    ] })], { type: 'audio', volume: 50 })
    const layer = only(evaluateTimeline(timeline, T).layers)
    assert.ok(Math.abs(layer.volume - 0.25) < 1e-9)
  })

  it('marks muted tracks silent and hidden tracks invisible', () => {
    const muted = only(evaluateTimeline(timelineOf([videoClip()], { muted: true }), 0).layers)
    assert.equal(muted.audible, false)
    const hidden = only(evaluateTimeline(timelineOf([videoClip()], { hidden: true }), 0).layers)
    assert.equal(hidden.visible, false)
  })
})

describe('evaluateTimeline — transitions', () => {
  it('assigns incoming and outgoing roles inside the overlap', () => {
    const outgoing = videoClip({ id: 'a', source: { in: 0, out: 4 * T }, timeline: { start: 0, duration: 4 * T } })
    const incoming = videoClip({
      id: 'b',
      source: { in: 0, out: 4 * T },
      timeline: { start: 3 * T, duration: 4 * T },
      transitionIn: { type: 'fade', duration: T }
    })
    const timeline = timelineOf([outgoing, incoming])

    const mid = evaluateTimeline(timeline, 3.5 * T).layers
    assert.equal(mid.length, 2)
    const a = mid.find(layer => layer.clipId === 'a')
    const b = mid.find(layer => layer.clipId === 'b')
    assert.equal(a.transition.role, 'outgoing')
    assert.equal(b.transition.role, 'incoming')
    assert.ok(Math.abs(a.transition.progress - 0.5) < 1e-9)
    assert.equal(a.transition.type, 'fade')

    const after = evaluateTimeline(timeline, 4 * T).layers
    assert.equal(after.length, 1)
    assert.equal(after[0].clipId, 'b')
    assert.equal(after[0].transition, null)
  })

  it('ignores a transition whose neighbour no longer ends at the window', () => {
    const broken = videoClip({
      id: 'b',
      timeline: { start: 3 * T, duration: 4 * T },
      transitionIn: { type: 'slide', duration: T }
    })
    const layer = only(evaluateTimeline(timelineOf([broken]), 3.5 * T).layers)
    assert.equal(layer.transition, null)
  })
})

describe('evaluateTimeline — ordering and flags', () => {
  it('returns layers in track order, then clip start order', () => {
    const late = videoClip({ id: 'late', timeline: { start: 4 * T, duration: 4 * T } })
    const early = videoClip({ id: 'early', timeline: { start: 0, duration: 6 * T } })
    const timeline = {
      version: 3,
      markers: [],
      tracks: [
        { id: 't1', type: 'video', items: [late, early] },
        { id: 't2', type: 'text', items: [{
          id: 'title',
          type: 'text',
          text: 'Hi',
          timeline: { start: 0, duration: 6 * T },
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
          effects: [],
          keyframes: []
        }] }
      ]
    }
    const result = evaluateTimeline(timeline, 5 * T)
    assert.deepEqual(result.layers.map(layer => layer.clipId), ['early', 'late', 'title'])
    assert.deepEqual(result.tracks.map(track => track.layers.length), [2, 1])
  })

  it('flags speed-ramped clips', () => {
    const layer = only(evaluateTimeline(timelineOf([videoClip({
      speedPoints: [{ t: 0, speed: 1 }, { t: 2 * T, speed: 2 }]
    })]), 0).layers)
    assert.equal(layer.ramped, true)
  })
})

describe('textAnimationAt', () => {
  const clip = (overrides = {}) => ({ animIn: 'none', animOut: 'none', ...overrides })

  it('is the identity without animations', () => {
    assert.deepEqual(textAnimationAt(clip(), 0, 4 * T), { opacity: 1, deltaX: 0, deltaY: 0, scale: 1 })
  })

  it('fades in over the requested duration', () => {
    const anim = clip({ animIn: 'fade', animInDuration: 0.5 })
    assert.equal(textAnimationAt(anim, 0, 4 * T).opacity, 0)
    assert.equal(textAnimationAt(anim, 0.25 * T, 4 * T).opacity, 0.5)
    assert.equal(textAnimationAt(anim, 0.5 * T, 4 * T).opacity, 1)
  })

  it('slides and zooms from the direction tables', () => {
    const anim = clip({ animIn: 'slide-left', animInDuration: 0.5 })
    assert.deepEqual(textAnimationAt(anim, 0, 4 * T), { opacity: 0, deltaX: 100, deltaY: 0, scale: 1 })
    const zoom = clip({ animIn: 'zoom-in', animInDuration: 0.5 })
    assert.equal(textAnimationAt(zoom, 0, 4 * T).scale, 0.3)
    assert.equal(textAnimationAt(zoom, 0.5 * T, 4 * T).scale, 1)
  })

  it('ramps out towards the clip end', () => {
    const anim = clip({ animOut: 'zoom-out', animOutDuration: 0.5 })
    assert.equal(textAnimationAt(anim, 3.75 * T, 4 * T).opacity, 0.5)
    const end = textAnimationAt(anim, 4 * T, 4 * T)
    assert.equal(end.opacity, 0)
    assert.equal(end.scale, 0.3)
  })

  it('clamps each window to half the clip with a 0.05 s floor', () => {
    const long = clip({ animIn: 'fade', animInDuration: 5 })
    assert.equal(textAnimationAt(long, 0.2 * T, 0.4 * T).opacity, 1, 'half of 0.4 s wins over 5 s')
    const tiny = clip({ animIn: 'fade' })
    assert.equal(textAnimationAt(tiny, 0, 0).opacity, 0, 'zero-length clip still gets the floor window')
  })

  it('is exposed on the evaluated text layer', () => {
    const text = {
      id: 'clip-t',
      type: 'text',
      text: 'Hi',
      animIn: 'fade',
      animInDuration: 2,
      timeline: { start: 0, duration: 4 * T },
      transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      effects: [],
      keyframes: []
    }
    const layer = only(evaluateTimeline(timelineOf([text]), T).layers)
    assert.equal(layer.text.animation.opacity, 0.5)
  })
})

describe('evaluateTimeline — flat app-model clips', () => {
  // The app store keeps geometry flat (`offset` + `in`/`out`/`speed`) and
  // visual values in percent/canvas px; no `timeline`/`source` objects.
  function flatClip(overrides = {}) {
    return {
      id: 'clip-flat',
      type: 'video',
      in: 0,
      out: 4 * T,
      offset: 0,
      speed: 1,
      opacity: 100,
      scale: 100,
      x: 0,
      y: 0,
      rotation: 0,
      keyframes: [],
      effects: [],
      ...overrides
    }
  }

  it('derives the span from offset/in/out/speed and maps the source', () => {
    const timeline = timelineOf([flatClip({ in: 2 * T, out: 10 * T, offset: 3 * T, speed: 2 })])
    const layer = only(evaluateTimeline(timeline, 4 * T).layers)
    assert.equal(layer.startTicks, 3 * T)
    assert.equal(layer.endTicks, 7 * T, '(10 - 2) s of source at 2x lasts 4 s')
    assert.equal(layer.localTicks, T)
    assert.equal(layer.sourceTicks, 4 * T)
    assert.equal(evaluateTimeline(timeline, 7 * T).layers.length, 0, 'end tick is exclusive')
    assert.equal(only(evaluateTimeline(timeline, 3 * T).layers).sourceTicks, 2 * T)
  })

  it('runs reverse and ramp flat clips through the shared retime math', () => {
    const reversed = timelineOf([flatClip({ in: 0, out: 4 * T, reverse: true })])
    assert.equal(only(evaluateTimeline(reversed, T).layers).sourceTicks, 3 * T)

    const ramped = timelineOf([flatClip({
      in: 0,
      out: 10 * T,
      speedPoints: [{ t: 0, speed: 1 }, { t: 2 * T, speed: 2 }]
    })])
    const layer = only(evaluateTimeline(ramped, 2 * T).layers)
    assert.equal(layer.ramped, true)
    assert.equal(layer.sourceTicks, 3 * T)
  })

  it('resolves flat visual fields (percent scale/opacity, canvas px)', () => {
    const timeline = timelineOf([flatClip({ scale: 150, opacity: 40, x: 12, y: -8, rotation: 5 })])
    const layer = only(evaluateTimeline(timeline, T).layers)
    assert.equal(layer.opacity, 0.4)
    assert.deepEqual(layer.transform, { x: 12, y: -8, scaleX: 1.5, scaleY: 1.5, rotation: 5 })
  })

  it('pairs flat transition windows like DSL v3 clips', () => {
    const outgoing = flatClip({ id: 'a', out: 2 * T })
    const incoming = flatClip({
      id: 'b',
      out: 2 * T,
      offset: 1.5 * T,
      transitionIn: { type: 'fade', duration: 0.5 * T }
    })
    const timeline = timelineOf([outgoing, incoming])

    const mid = evaluateTimeline(timeline, 1.75 * T).layers
    assert.equal(mid.length, 2)
    assert.equal(mid.find(layer => layer.clipId === 'a').transition.role, 'outgoing')
    const inLayer = mid.find(layer => layer.clipId === 'b')
    assert.equal(inLayer.transition.role, 'incoming')
    assert.equal(inLayer.transition.type, 'fade')
    assert.ok(Math.abs(inLayer.transition.progress - 0.5) < 1e-9)

    assert.equal(only(evaluateTimeline(timeline, 0.5 * T).layers).transition, null)
  })

  it('skips a flat transition whose neighbour was trimmed away', () => {
    const broken = flatClip({
      id: 'b',
      out: 2 * T,
      offset: 1.5 * T,
      transitionIn: { type: 'fade', duration: 0.5 * T }
    })
    const layer = only(evaluateTimeline(timelineOf([broken]), 1.75 * T).layers)
    assert.equal(layer.transition, null)
  })
})

describe('evaluateClip', () => {
  it('resolves flat app-model fields without a timeline', () => {
    const visual = evaluateClip({
      scale: 150,
      opacity: 40,
      x: 12,
      y: -8,
      rotation: 5,
      volume: 70,
      keyframes: []
    }, 0)
    assert.deepEqual(visual, {
      opacity: 0.4,
      volume: 70,
      transform: { x: 12, y: -8, scaleX: 1.5, scaleY: 1.5, rotation: 5 }
    })
  })

  it('prefers keyframes, then flat fields, then the DSL transform', () => {
    const visual = evaluateClip({
      transform: { x: 4, scaleX: 0.5, rotation: 10, opacity: 0.8 },
      keyframes: [{ t: 0, prop: 'scale', value: 200 }]
    }, 0)
    assert.equal(visual.transform.scaleX, 2)
    assert.equal(visual.transform.scaleY, 2)
    assert.equal(visual.transform.x, 4)
    assert.equal(visual.transform.rotation, 10)
    assert.equal(visual.opacity, 0.8)
    assert.equal(visual.volume, 100)
  })
})

// V4 M3: the layer is the answer BOTH renderers read. A mask or a fit mode
// that only exists on the stored clip is not in the model yet, so a host that
// consumes the layer alone (the WebCodecs/WASM renderers queued at M5/M8)
// would have to re-derive app fields — the exact split M3 exists to remove.
describe('evaluateTimeline — mask geometry', () => {
  it('reports the sanitized geometry, not the stored fragment', () => {
    const clip = videoClip({ mask: { shape: 'circle', x: 0.25, y: 0.2 } })
    const layer = only(evaluateTimeline(timelineOf([clip]), 0).layers)
    assert.deepEqual(layer.mask, {
      shape: 'circle',
      x: 0.25,
      y: 0.2,
      w: 1,
      h: 1,
      feather: 0,
      rotation: 0,
      invert: false,
      axis: 'x'
    })
  })

  it('clamps a stored value that escaped its range', () => {
    const clip = videoClip({ mask: { shape: 'rectangle', x: 1.6, w: -0.4, feather: 300, rotation: -540 } })
    const layer = only(evaluateTimeline(timelineOf([clip]), 0).layers)
    assert.equal(layer.mask.x, 1)
    assert.equal(layer.mask.w, 0.001)
    assert.equal(layer.mask.feather, 100)
    assert.equal(layer.mask.rotation, -180)
  })

  it('a shape no builder knows is no mask', () => {
    // This used to be a lie in the other direction: `{ shape: 'star' }`
    // reached the layer as truthy data, so "is this clip masked?" answered yes
    // while BOTH alpha builders returned empty — masked in the model,
    // unmasked on screen.
    const clip = videoClip({ mask: { shape: 'star', x: 0.2, y: 0.2 } })
    const layer = only(evaluateTimeline(timelineOf([clip]), 0).layers)
    assert.equal(layer.mask, null)
  })

  it('absent and null both mean no mask', () => {
    assert.equal(only(evaluateTimeline(timelineOf([videoClip()]), 0).layers).mask, null)
    assert.equal(only(evaluateTimeline(timelineOf([videoClip({ mask: null })]), 0).layers).mask, null)
  })

  it('the geometry the layer reports is the geometry both builders render', () => {
    // The sharing proof: normalizeMask runs inside maskAlphaExpr (export) and
    // maskCssMaskImage (preview), so handing out its output can never move a
    // pixel — and a renderer that reads only the layer gets the same edge.
    const stored = { shape: 'circle', x: 0.2, y: 0.1, w: 0.6, h: 0.8, feather: 25, rotation: 30, invert: true, axis: 'y' }
    const layer = only(evaluateTimeline(timelineOf([videoClip({ mask: stored })]), 0).layers)
    assert.notEqual(maskAlphaExpr(layer.mask), '', 'a real mask must produce a real alpha expression')
    assert.equal(maskAlphaExpr(layer.mask), maskAlphaExpr(stored))
    assert.equal(maskCssMaskImage(layer.mask, 64, 36), maskCssMaskImage(stored, 64, 36))
  })
})

describe('evaluateTimeline — media layout', () => {
  it('resolves the fit defaults both renderers assume', () => {
    const layer = only(evaluateTimeline(timelineOf([videoClip({ fit: 'fill', focusX: 0.3 })]), 0).layers)
    assert.deepEqual(layer.layout, { fit: 'fill', focusX: 0.3, focusY: 0.5, cropRect: null })
  })

  it('passes a stored crop rect through untouched', () => {
    // Core clamps the rect inside each builder (clamp01 in computeFitObjectStyle
    // and buildFfmpegFitFilters), so the model hands the SAME geometry to both
    // instead of normalizing twice with a third rule.
    const cropRect = { x: 0.1, y: 0.2, w: 0.7, h: 0.6 }
    const layer = only(evaluateTimeline(timelineOf([videoClip({ fit: 'crop', cropRect })]), 0).layers)
    assert.equal(layer.layout.cropRect, cropRect)
    assert.equal(layer.layout.fit, 'crop')
  })

  it('a non-finite focus falls back to the centre', () => {
    const layer = only(evaluateTimeline(timelineOf([videoClip({ focusX: Number.NaN })]), 0).layers)
    assert.equal(layer.layout.focusX, 0.5)
  })

  it('resolves layout for the flat app-store clip shape too', () => {
    const flat = { id: 'a', type: 'video', offset: 0, in: 0, out: 2 * T, speed: 1, fit: 'crop', focusY: 0.25 }
    const layer = only(evaluateTimeline({ tracks: [{ id: 'v1', type: 'video', items: [flat] }] }, 0).layers)
    assert.equal(layer.layout.fit, 'crop')
    assert.equal(layer.layout.focusY, 0.25)
    assert.equal(layer.layout.focusX, 0.5)
  })
})

describe('clipSourceRange — the media range a clip reads, in both stored shapes', () => {
  it('reads DSL v3 source.{in,out} in ticks', () => {
    const range = clipSourceRange({ source: { in: 2 * T, out: 5 * T } })
    assert.deepEqual(range, { in: 2 * T, out: 5 * T })
  })

  it('reads the app store flat in/out ticks', () => {
    const range = clipSourceRange({ in: 1 * T, out: 3 * T, offset: 4 * T })
    assert.deepEqual(range, { in: 1 * T, out: 3 * T })
  })

  it('answers null for a clip that carries no media range', () => {
    assert.equal(clipSourceRange({ id: 't1', type: 'text', text: 'hi' }), null)
  })
})
