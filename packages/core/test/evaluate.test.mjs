// @tmcut/core — timeline evaluation tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateClip, evaluateTimeline } from '../src/evaluate.mjs'
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
