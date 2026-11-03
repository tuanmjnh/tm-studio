// tmcut-core — renderAt tests (V4 Phase 2, item 1). Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { renderAt } from '../src/renderAt.mjs'
import { evaluateTimeline } from '../src/evaluate.mjs'
import { createFrameScheduler } from '../src/scheduler.mjs'
import { createClock } from '../src/clock.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_2997 = { numerator: 30000, denominator: 1001 }
const FRAME_30 = TICKS_PER_SECOND / 30 // 4000

const tk = sec => Math.round(sec * TICKS_PER_SECOND)

function v3Project(clipSpans, rate = RATE_30) {
  return {
    canvas: { fps: rate },
    timeline: {
      tracks: [{
        id: 'v1',
        type: 'video',
        items: clipSpans.map((span, index) => ({
          id: `c${index}`,
          type: 'video',
          timeline: { start: span.start, duration: span.duration },
          source: { in: span.in ?? 0, out: (span.in ?? 0) + span.duration }
        }))
      }]
    }
  }
}

/** The app store's flat shape: `offset` + `in`/`out`/`speed`, no `timeline`. */
function flatProject(clipSpans, rate = RATE_30) {
  return {
    canvas: { fps: rate },
    timeline: {
      tracks: [{
        id: 'v1',
        type: 'video',
        items: clipSpans.map((span, index) => ({
          id: `c${index}`,
          type: 'video',
          offset: span.start,
          in: span.in ?? 0,
          out: (span.in ?? 0) + span.duration,
          speed: 1
        }))
      }]
    }
  }
}

describe('renderAt', () => {
  it('answers the frame, not the instant, so one frame is one picture', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }, { start: tk(1), duration: tk(1), in: tk(5) }])
    const early = renderAt(project, 3 * FRAME_30)
    for (const offset of [1, 200, FRAME_30 - 1]) {
      const inside = renderAt(project, 3 * FRAME_30 + offset)
      assert.equal(inside.at, early.at, `frame ${offset} ticks in must render from the frame start`)
      assert.equal(inside.index, 3)
      assert.deepEqual(inside.evaluation, early.evaluation)
    }
    assert.equal(early.at, 3 * FRAME_30)
    assert.equal(renderAt(project, 4 * FRAME_30).index, 4, 'the next frame starts the next answer')
  })

  it('hands back the evaluator answer at that position, unchanged', () => {
    const project = v3Project([{ start: 0, duration: tk(2) }])
    for (const ticks of [0, 1234, FRAME_30, tk(1.7), tk(2)]) {
      const frame = renderAt(project, ticks)
      assert.deepEqual(frame.evaluation, evaluateTimeline(project, frame.at))
      assert.deepEqual(frame.frame?.evaluation, frame.evaluation, 'frame and contract must be one answer')
    }
  })

  it('parks a request past the content on the last renderable frame', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }])
    const plan = createFrameScheduler(project)
    const last = plan.frameCount - 1
    for (const ticks of [tk(1), tk(1) + 1, tk(60)]) {
      const frame = renderAt(project, ticks)
      assert.equal(frame.index, last, `${ticks} must park on the final frame`)
      assert.equal(frame.at, plan.frameAt(last).startTicks)
      assert.equal(frame.beyond, true, `${ticks} is at or after the content end`)
      assert.equal(frame.evaluation.layers.length, 1, 'and the picture is the last frame, not black')
    }
    assert.equal(renderAt(project, tk(1) - 1).beyond, false, 'a tick inside the content is not beyond it')
  })

  it('keeps the continuous position inside the content in scrub mode', () => {
    const project = v3Project([{ start: 0, duration: tk(2) }])
    const clock = createClock(RATE_30)
    const endTicks = project.timeline.tracks[0].items[0].timeline.duration
    const lastRenderable = clock.frameStartAt(clock.durationFrames(endTicks) - 1)
    for (const ticks of [0, 1234, FRAME_30 + 7, tk(1.5) + 999]) {
      const scrub = renderAt(project, ticks, { snapToFrame: false })
      assert.equal(scrub.at, Math.min(ticks, lastRenderable), `${ticks} renders at its own position`)
      assert.equal(scrub.beyond, false)
      assert.deepEqual(scrub.evaluation, evaluateTimeline(project, ticks))
      assert.ok(scrub.frame, 'the frame the scrub position lies in is still reported')
      assert.equal(scrub.frame.startTicks, Math.floor(ticks / scrub.ticksPerFrame) * scrub.ticksPerFrame)
    }
  })

  it('steps a scrub request at or after the end back to the last frame (ADR-018)', () => {
    const project = v3Project([{ start: 0, duration: tk(2) }])
    const clock = createClock(RATE_30)
    const lastRenderable = clock.frameStartAt(clock.durationFrames(tk(2)) - 1)
    assert.equal(lastRenderable, tk(2) - FRAME_30, 'the law steps back one whole frame')
    for (const ticks of [tk(2), tk(2) + 1, tk(9)]) {
      const scrub = renderAt(project, ticks, { snapToFrame: false })
      assert.equal(scrub.at, lastRenderable)
      assert.equal(scrub.beyond, true)
      assert.equal(scrub.evaluation.layers.length, 1, 'the final frame keeps its picture')
    }
    // A caption on the last frame must still paint there — that is the whole
    // reason the position steps back instead of evaluating the end instant.
    const captioned = v3Project([{ start: 0, duration: tk(2) }])
    captioned.timeline.tracks[0].items[0].text = 'tail'
    assert.ok(renderAt(captioned, tk(2), { snapToFrame: false }).evaluation.layers[0].text)
  })

  it('reports the frame identity and the plan it came from', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }])
    const plan = createFrameScheduler(project)
    const frame = renderAt(project, 7 * FRAME_30 + 5)
    assert.equal(frame.requestedTicks, 7 * FRAME_30 + 5)
    assert.equal(frame.index, 7)
    assert.equal(frame.frame.index, 7)
    assert.equal(frame.frame.startTicks, 7 * FRAME_30)
    assert.equal(frame.frame.endTicks, 8 * FRAME_30)
    assert.equal(frame.endTicks, tk(1))
    assert.equal(frame.frameCount, plan.frameCount)
    assert.equal(frame.fps, 30)
    assert.equal(frame.ticksPerFrame, FRAME_30)
    assert.equal(frame.snapped, true)
  })

  it('takes the rate from the canvas and lets an explicit rate win', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }])
    assert.equal(renderAt(project, 1234).snapped, true)
    assert.equal(renderAt(project, 1234, { rate: RATE_30 }).at, 0)
    const at2997 = renderAt(project, 1234, { rate: RATE_2997 })
    const at30 = renderAt(project, 1234, { rate: RATE_30 })
    assert.ok(at2997.ticksPerFrame > at30.ticksPerFrame, '29.97 frames are wider than 30 ones')
    assert.equal(at2997.at, at2997.frame.startTicks)
    assert.equal(renderAt(project, 1234, { rate: { numerator: 0, denominator: 1 } }).ticksPerFrame, FRAME_30,
      'an unusable rate falls back to 30 fps the way createClock does')
  })

  it('renders nothing for an empty or unusable project without throwing', () => {
    for (const input of [null, undefined, {}, { timeline: { tracks: [] } }, { timeline: { tracks: [{ items: [] }] } }]) {
      const frame = renderAt(input, tk(3))
      assert.equal(frame.frameCount, 0)
      assert.equal(frame.endTicks, 0)
      assert.equal(frame.index, null, 'no frame exists to name')
      assert.equal(frame.frame, null)
      assert.equal(frame.at, tk(3), 'nothing bounds the request, so the position stands')
      assert.equal(frame.beyond, false)
      assert.deepEqual(frame.evaluation, evaluateTimeline(input, tk(3)))
    }
  })

  it('clamps a request before zero, the way the evaluator does', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }])
    const frame = renderAt(project, -5000)
    assert.equal(frame.requestedTicks, 0, 'the reported request is the one honoured')
    assert.equal(frame.at, 0)
    assert.equal(frame.index, 0)
    assert.deepEqual(frame.evaluation, evaluateTimeline(project, 0))
    assert.equal(renderAt(project, -5000, { snapToFrame: false }).at, 0)
  })

  it('is pure: the same call twice answers identically and the object is frozen', () => {
    const project = flatProject([{ start: 0, duration: tk(1) }, { start: tk(1), duration: tk(1), in: tk(3) }])
    const first = renderAt(project, tk(1) + 40)
    const again = renderAt(project, tk(1) + 40)
    assert.deepEqual(first, again)
    assert.equal(JSON.stringify(first), JSON.stringify(again))
    assert.equal(Object.isFrozen(first), true)
    assert.equal(Object.isFrozen(first.evaluation), false, 'the evaluator answer keeps its own shape')
    assert.throws(() => {
      first.at = 0
    }, TypeError)
  })

  it('answers the app store shape identically to the DSL shape', () => {
    const spans = [{ start: 0, duration: tk(1) }, { start: tk(1), duration: tk(1), in: tk(5) }]
    const flat = flatProject(spans)
    const dsl = v3Project(spans)
    for (const ticks of [0, 41, FRAME_30, tk(1), tk(1) + 40, tk(9)]) {
      for (const options of [{}, { snapToFrame: false }]) {
        assert.deepEqual(
          renderAt(flat, ticks, options),
          renderAt(dsl, ticks, options),
          `${ticks} ${JSON.stringify(options)}`
        )
      }
    }
  })

  it('agrees with the scheduler on every frame of the sequence', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }, { start: tk(1), duration: tk(1), in: tk(2) }])
    const plan = createFrameScheduler(project)
    for (const frame of plan.frames()) {
      const answered = renderAt(project, frame.startTicks)
      assert.equal(answered.index, frame.index)
      assert.equal(answered.at, frame.startTicks)
      assert.deepEqual(answered.evaluation, frame.evaluation)
    }
  })
})
