// tmcut-core — scheduler tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createFrameScheduler } from '../src/scheduler.mjs'
import { evaluateTimeline } from '../src/evaluate.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_2997 = { numerator: 30000, denominator: 1001 }
const FRAME_30 = TICKS_PER_SECOND / 30 // 4000

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

function tk(sec) {
  return Math.round(sec * TICKS_PER_SECOND)
}

describe('createFrameScheduler', () => {
  it('counts one frame per grid slot covering the content', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(2) }]))
    assert.equal(plan.endTicks, tk(2))
    assert.equal(plan.fps, 30)
    assert.equal(plan.ticksPerFrame, FRAME_30)
    assert.equal(plan.frameCount, 60)
  })

  it('counts a partial last frame instead of dropping it', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(2) + 1 }]))
    assert.equal(plan.frameCount, 61)
    assert.equal(plan.frameAt(60).startTicks, 60 * FRAME_30)
    assert.ok(plan.frameAt(60).startTicks < plan.endTicks, 'the last frame starts inside the content')
    assert.equal(plan.frameAt(61), null, 'and the sequence ends there')
  })

  it('answers the same way twice for one index', () => {
    const plan = createFrameScheduler(v3Project([
      { start: 0, duration: tk(1) },
      { start: tk(1), duration: tk(1), in: tk(5) }
    ]))
    const first = plan.frameAt(37)
    const again = plan.frameAt(37)
    assert.deepEqual(first, again)
    assert.equal(JSON.stringify(first), JSON.stringify(again))
    assert.equal(JSON.stringify(plan.frames()), JSON.stringify(createFrameScheduler(
      v3Project([
        { start: 0, duration: tk(1) },
        { start: tk(1), duration: tk(1), in: tk(5) }
      ])
    ).frames()))
  })

  it('puts every frame on the clock grid in increasing order', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(1.5) }]))
    const frames = plan.frames()
    assert.equal(frames.length, plan.frameCount)
    assert.equal(frames[0].index, 0)
    assert.equal(frames[0].startTicks, 0)
    frames.forEach((frame, index) => {
      assert.equal(frame.index, index)
      assert.equal(frame.startTicks, plan.clock.frameStartAt(index))
      assert.equal(frame.endTicks, frame.startTicks + plan.ticksPerFrame)
      if (index > 0) {
        assert.ok(frame.startTicks > frames[index - 1].startTicks, `frame ${index} must start after ${index - 1}`)
      }
    })
  })

  it('hands back the evaluator answer at the frame position', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }, { start: tk(1), duration: tk(1) }])
    const plan = createFrameScheduler(project)
    for (const index of [0, 29, 30, 44, 59]) {
      const frame = plan.frameAt(index)
      assert.equal(frame.evaluation.at, frame.startTicks)
      assert.deepEqual(frame.evaluation, evaluateTimeline(project, frame.startTicks))
    }
  })

  it('refuses indices outside the sequence without throwing', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(1) }]))
    assert.equal(plan.frameAt(-1), null)
    assert.equal(plan.frameAt(plan.frameCount), null)
    assert.equal(plan.frameAt(Number.NaN), null)
    assert.equal(plan.frameAt(undefined), null)
    assert.equal(plan.frameAt('3'), null)
  })

  it('maps a tick position to the frame containing it, clamped', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(1) }]))
    assert.equal(plan.indexOf(0), 0)
    assert.equal(plan.indexOf(FRAME_30 - 1), 0)
    assert.equal(plan.indexOf(FRAME_30), 1)
    assert.equal(plan.indexOf(tk(1)), plan.frameCount - 1, 'the end instant has no frame of its own')
    assert.equal(plan.indexOf(-500), 0)
    assert.equal(plan.indexOf(tk(60)), plan.frameCount - 1)
  })

  it('plans a half-open slice of the sequence', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(1) }]))
    assert.equal(plan.frameCount, 30)
    assert.deepEqual(plan.frames(2, 5).map(frame => frame.index), [2, 3, 4])
    assert.deepEqual(plan.frames(28, 500).map(frame => frame.index), [28, 29])
    assert.deepEqual(plan.frames(10, 10), [])
    assert.deepEqual(plan.frames(-5, -1), [])
    assert.equal(plan.frames(0, plan.frameCount).length, plan.frameCount)
  })

  it('schedules nothing for an empty or unusable project', () => {
    for (const input of [null, undefined, {}, { timeline: { tracks: [] } }, { timeline: { tracks: [{ items: [] }] } }]) {
      const plan = createFrameScheduler(input)
      assert.equal(plan.frameCount, 0, `frameCount for ${JSON.stringify(input)}`)
      assert.equal(plan.endTicks, 0)
      assert.equal(plan.frameAt(0), null)
      assert.deepEqual(plan.frames(), [])
      assert.equal(plan.indexOf(4000), 0)
    }
  })

  it('ignores a zero-length clip, the way the evaluator ignores it', () => {
    const plan = createFrameScheduler(v3Project([
      { start: 0, duration: tk(1) },
      { start: tk(3), duration: 0 }
    ]))
    assert.equal(plan.frameCount, 30)
    assert.equal(plan.endTicks, tk(1))
  })

  it('keeps a hidden track in the plan: frames are positions, not visibility', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }])
    project.timeline.tracks[0].hidden = true
    const plan = createFrameScheduler(project)
    assert.equal(plan.frameCount, 30)
    assert.equal(plan.frameAt(15).evaluation.layers.length, 1)
    assert.equal(plan.frameAt(15).evaluation.tracks[0].hidden, true)
  })

  it('schedules the app store shape identically to the DSL shape', () => {
    const flat = {
      canvas: { fps: RATE_30 },
      timeline: {
        tracks: [{
          id: 'v1',
          type: 'video',
          items: [
            { id: 'a', type: 'video', offset: 0, in: tk(1), out: tk(2), speed: 1 },
            { id: 'b', type: 'video', offset: tk(1), in: 0, out: tk(1), speed: 1 }
          ]
        }]
      }
    }
    const dsl = {
      canvas: { fps: RATE_30 },
      timeline: {
        tracks: [{
          id: 'v1',
          type: 'video',
          items: [
            { id: 'a', type: 'video', timeline: { start: 0, duration: tk(1) }, source: { in: tk(1), out: tk(2) } },
            { id: 'b', type: 'video', timeline: { start: tk(1), duration: tk(1) }, source: { in: 0, out: tk(1) } }
          ]
        }]
      }
    }
    const flatPlan = createFrameScheduler(flat)
    const dslPlan = createFrameScheduler(dsl)
    assert.equal(flatPlan.frameCount, 60)
    assert.deepEqual(flatPlan.frames(), dslPlan.frames())
  })

  it('takes the rate from the project canvas and lets an explicit rate win', () => {
    const project = v3Project([{ start: 0, duration: tk(1) }])
    assert.equal(createFrameScheduler(project).fps, 30)
    const sixty = createFrameScheduler(project, { rate: { numerator: 60, denominator: 1 } })
    assert.equal(sixty.fps, 60)
    assert.equal(sixty.ticksPerFrame, TICKS_PER_SECOND / 60)
    assert.equal(sixty.frameCount, 60)
    assert.equal(sixty.frameAt(59).startTicks, 59 * (TICKS_PER_SECOND / 60))
    assert.equal(sixty.frameAt(60), null)
    assert.equal(sixty.endTicks, project.timeline.tracks[0].items[0].timeline.duration, 'the content span is the project, not the rate')
  })

  it('falls back to 30 fps when the canvas carries no usable rate', () => {
    const plan = createFrameScheduler({ canvas: { fps: { numerator: 0, denominator: 0 } }, timeline: { tracks: [] } })
    assert.equal(plan.fps, 30)
    assert.equal(plan.ticksPerFrame, FRAME_30)
    assert.equal(createFrameScheduler({ timeline: { tracks: [] } }).fps, 30)
  })

  it('keeps 29.97 whole-second spans on exact NTSC frame counts', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(2) }], RATE_2997))
    assert.equal(plan.ticksPerFrame, 4004)
    assert.equal(plan.frameCount, 60)
    assert.equal(plan.frameAt(59).startTicks, 59 * 4004)
    assert.equal(plan.frameAt(60), null)
    assert.equal(plan.indexOf(tk(2)), 59, 'the end instant parks on the last frame')
  })

  it('starts a project that begins after zero at tick zero, not at its first clip', () => {
    const plan = createFrameScheduler(v3Project([{ start: tk(1), duration: tk(1) }]))
    assert.equal(plan.frameCount, 60)
    assert.equal(plan.frameAt(0).startTicks, 0)
    assert.equal(plan.frameAt(0).evaluation.layers.length, 0, 'the leading gap is a real frame of the sequence')
    assert.equal(plan.frameAt(30).evaluation.layers.length, 1)
  })

  it('freezes the plan and hands back a fresh array per call', () => {
    const plan = createFrameScheduler(v3Project([{ start: 0, duration: tk(1) }]))
    assert.equal(Object.isFrozen(plan), true)
    assert.equal(Object.isFrozen(plan.frameAt(0)), true)
    const slice = plan.frames(0, 3)
    slice.pop()
    assert.equal(plan.frames(0, 3).length, 3, 'mutating a plan must not shorten the sequence')
  })
})
