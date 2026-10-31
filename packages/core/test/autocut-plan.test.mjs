// Roadmap v3 Phase 7 — the AutoCut EDL converts into a standard Edit Plan,
// so the deterministic pipeline flows through the SAME validated apply path
// as the AI Editor. Captions inside dropped spans must never leak.
import test from 'node:test'
import assert from 'node:assert/strict'
import { editPlanFromEdl, validateEditPlan, applyEditPlan } from '../src/index.mjs'

const TICK = 120_000

const edl = {
  version: 1,
  profile: 'viral-shorts',
  assetId: 'asset-1',
  segments: [
    { id: 's1', start: 0, end: 3, score: 0.9, reason: 'speech' },
    { id: 's2', start: 10, end: 12, score: 0.8, reason: 'speech' },
    { id: 's3', start: 20, end: 22, score: 0.2, reason: 'silence' }
  ]
}

test('EDL segments become video add-clip ops through the shared contract', () => {
  const { plan } = editPlanFromEdl(edl, [edl.segments[0], edl.segments[1]], {
    mediaRef: 'asset-1',
    name: 'Interview'
  })
  const check = validateEditPlan(plan, { mediaRefs: ['asset-1'] })
  assert.deepEqual(check.errors, [])
  assert.equal(plan.operations.length, 2)
  assert.deepEqual(
    plan.operations.map(op => [op.type, op.offset]),
    [['add-clip', 0], ['add-clip', 3 * TICK]]
  )
})

test('applies through applyEditPlan end to end', () => {
  const { plan } = editPlanFromEdl(edl, [edl.segments[0]], { mediaRef: 'm1' })
  const timeline = { version: 3, tracks: [], markers: [] }
  const trace = applyEditPlan(timeline, plan, { mediaResolution: { m1: { src: 'C:\\v\\a.mp4' } } })
  assert.equal(trace.skipped.length, 0)
  assert.equal(timeline.tracks[0].items[0].locator.path, 'C:\\v\\a.mp4')
})

test('captions map onto kept spans and dropped spans drop their lines', () => {
  const captions = [
    { start: 1, end: 2, text: 'kept line' },        // inside seg1 -> offset 1s
    { start: 11, end: 11.8, text: 'kept short' },   // inside seg2, trim applies
    { start: 20.5, end: 21, text: 'cut content' }   // inside DROPPED seg3
  ]
  const { plan, warnings } = editPlanFromEdl(edl, [edl.segments[0], edl.segments[1]], {
    mediaRef: 'm1',
    captions
  })
  const textOps = plan.operations.filter(op => op.trackType === 'text')
  assert.equal(textOps.length, 2)
  assert.equal(textOps[0].text, 'kept line')
  assert.equal(textOps[0].offset, TICK) // 1s after timeline 0 (seg1 starts at 0)
  assert.ok(warnings.some(w => w.includes('dropped')))
  assert.ok(!JSON.stringify(plan).includes('cut content'))
})

test('caption overhang is trimmed to the kept span bounds', () => {
  const captions = [{ start: 2.5, end: 11.5, text: 'spans the cut' }] // crosses the seg1/seg2 cut
  const { plan } = editPlanFromEdl(edl, [edl.segments[0], edl.segments[1]], {
    mediaRef: 'm1',
    captions
  })
  const textOps = plan.operations.filter(op => op.trackType === 'text')
  assert.equal(textOps.length, 1)
  const op = textOps[0]
  // Mapped onto the FIRST overlapping span (seg1): start 2.5s -> offset
  // 2.5s; end trimmed to seg1's end (3s) -> out = offset + 0.5s.
  assert.equal(op.offset, Math.round(2.5 * TICK))
  assert.equal(op.out, op.offset + Math.round(0.5 * TICK))
})

test('empty EDL yields an empty-operations plan the caller must not apply', () => {
  const { plan } = editPlanFromEdl({ ...edl, segments: [] }, [], { mediaRef: 'm1' })
  assert.equal(plan.operations.length, 0)
  // validateEditPlan rejects empty operations: apply-gate stays closed.
  assert.equal(validateEditPlan(plan).valid, false)
})

test('long caption lines are clamped, plan stays valid', () => {
  const captions = [{ start: 0, end: 2, text: 'x'.repeat(500) }]
  const { plan } = editPlanFromEdl(edl, [edl.segments[0]], { mediaRef: 'm1', captions })
  const check = validateEditPlan(plan, { mediaRefs: ['m1'] })
  assert.deepEqual(check.errors, [])
})
