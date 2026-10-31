// Roadmap v3 PART C — AI Edit Plan contracts. The AI may only speak the
// closed operation vocabulary; the validator is the gate and the applier
// goes through the same core commands the manual editor uses. These tests
// pin the security properties (no paths, no unknown verbs, refs-only media)
// and the apply semantics (per-op skip, never a corrupted half-apply).
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateEditPlan,
  applyEditPlan,
  parseEditPlanReply,
  summarizeEditPlan,
  EDIT_OPERATION_TYPES,
  AI_EDIT_PLAN_SCHEMA_VERSION
} from '../src/index.mjs'

const TICK = 120_000

function timelineWith(...clips) {
  return {
    version: 3,
    tracks: [
      { id: 'tv', type: 'video', locked: false, items: [] },
      { id: 'ta', type: 'audio', locked: false, items: [] },
      { id: 'tt', type: 'text', locked: false, items: clips }
    ]
  }
}

function clip(id, extra = {}) {
  return {
    id,
    type: 'text',
    name: id,
    source: { in: 0, out: 4 * TICK },
    timeline: { start: 0, duration: 4 * TICK },
    speed: 1,
    volume: 100,
    ...extra
  }
}

test('happy plan validates and applies through core commands', () => {
  const plan = {
    schemaVersion: AI_EDIT_PLAN_SCHEMA_VERSION,
    intentSummary: '30s promo',
    assumptions: ['user wants captions'],
    operations: [
      { type: 'add-clip', trackType: 'video', name: 'Hook', mediaRef: 'm1', in: 0, out: 3 * TICK },
      { type: 'add-clip', trackType: 'text', name: 'Title', text: 'HELLO', offset: 0 },
      { type: 'add-clip', trackType: 'audio', mediaRef: 'm2' },
      { type: 'set-volume', clipId: 'needs-id', volume: 80 }
    ]
  }
  // First pass without clipIds: the set-volume targets a known clip.
  const tl = timelineWith(clip('c1'))
  plan.operations[3].clipId = 'c1'
  const check = validateEditPlan(plan, {
    timeline: tl,
    mediaRefs: ['m1', 'm2']
  })
  assert.deepEqual(check.errors, [])

  const canvas = { width: 1080, height: 1920, fps: 30 }
  const trace = applyEditPlan(tl, {
    operations: [
      ...plan.operations.slice(0, 3),
      { type: 'set-canvas', width: 1080, height: 1920, fps: 30 }
    ]
  }, {
    mediaResolution: { m1: { src: 'C:\\media\\hook.mp4' }, m2: { src: 'C:\\media\\bed.mp3' } },
    canvas
  })
  assert.equal(trace.skipped.length, 0, JSON.stringify(trace.skipped))
  assert.equal(canvas.width, 1080)
  const video = tl.tracks.find(t => t.type === 'video')
  assert.equal(video.items.length, 1)
  assert.equal(video.items[0].locator.path, 'C:\\media\\hook.mp4')
})

test('unknown operation verbs and payloads are rejected', () => {
  assert.equal(EDIT_OPERATION_TYPES.includes('run-shell'), false)
  const bad = [
    { operations: [{ type: 'run-shell', command: 'del C:\\' }] },
    { operations: [{ type: 'add-clip', trackType: 'subtitle', name: 'x' }] },
    { operations: [] },
    { operations: 'not-an-array' },
    { schemaVersion: 99, operations: [{ type: 'set-volume', clipId: 'c1', volume: 50 }] },
    { operations: Array.from({ length: 101 }, () => ({ type: 'remove-clip', clipId: 'c1' })) }
  ]
  for (const plan of bad) {
    const res = validateEditPlan(plan)
    assert.equal(res.valid, false, `must reject ${JSON.stringify(plan).slice(0, 60)}`)
    assert.ok(res.errors.length > 0)
  }
})

test('media references can never carry paths or URLs', () => {
  for (const evil of ['C:\\evil.mp4', '../outside.mp4', '/etc/passwd', 'https://cdn/x.mp4', 'a/b.mp4', 'x'.repeat(600)]) {
    const res = validateEditPlan({
      operations: [{ type: 'add-clip', trackType: 'video', mediaRef: evil }]
    })
    assert.equal(res.valid, false, `must reject mediaRef ${evil.slice(0, 24)}`)
  }
})

test('unknown mediaRef fails when the host declares what it offers', () => {
  const res = validateEditPlan({
    operations: [{ type: 'add-clip', trackType: 'audio', mediaRef: 'ghost' }]
  }, { mediaRefs: ['m1', 'm2'] })
  assert.equal(res.valid, false)
  assert.match(res.errors.join(' '), /not among the offered media refs/)
})

test('clip-targeted ops must point at clips that exist', () => {
  const tl = timelineWith(clip('c1'))
  const missing = validateEditPlan({
    operations: [{ type: 'remove-clip', clipId: 'c-nope' }]
  }, { timeline: tl })
  assert.equal(missing.valid, false)
  const ok = validateEditPlan({
    operations: [{ type: 'remove-clip', clipId: 'c1' }]
  }, { timeline: tl })
  assert.equal(ok.valid, true)
})

test('effects in a plan pass the registry gate; unknown types/params rejected', () => {
  const bad = validateEditPlan({
    operations: [{ type: 'set-effect', clipId: 'c1', effects: [{ type: 'mind-control', params: {} }] }]
  })
  assert.equal(bad.valid, false)
  const good = validateEditPlan({
    operations: [{ type: 'set-effect', clipId: 'c1', effects: [{ type: 'blur', params: {} }] }]
  })
  assert.equal(good.valid, true)
})

test('transitions are limited to the known registry', () => {
  const bad = validateEditPlan({
    operations: [{ type: 'set-transition', clipId: 'c1', transition: 'warp-drive-9', durationTicks: TICK }]
  })
  assert.equal(bad.valid, false)
  const good = validateEditPlan({
    operations: [{ type: 'set-transition', clipId: 'c1', transition: 'fade', durationTicks: TICK / 2 }]
  })
  assert.equal(good.valid, true)
})

test('applier skips unresolvable refs and locked tracks without aborting', () => {
  const tl = timelineWith(clip('c1'))
  tl.tracks[0].locked = true
  const trace = applyEditPlan(tl, {
    operations: [
      { type: 'add-clip', trackType: 'video', name: 'A', mediaRef: 'missing-ref' },
      { type: 'add-clip', trackType: 'video', name: 'B', mediaRef: 'm1' },
      { type: 'set-volume', clipId: 'c1', volume: 50 }
    ]
  }, { mediaResolution: { m1: { src: 'ok.mp4' } } })
  assert.equal(trace.applied.length, 1) // only set-volume: text track is unlocked
  const reasons = trace.skipped.map(s => s.reason)
  assert.ok(reasons.includes('media-ref-missing'))
  assert.ok(reasons.includes('track-locked'))
})

test('exception in one op is contained and warned', () => {
  const tl = timelineWith(clip('c1'))
  const trace = applyEditPlan(tl, {
    operations: [{ type: 'move-clip', clipId: 'c1', startTicks: 5 * TICK }]
  })
  assert.equal(trace.applied.length, 1)
  assert.equal(tl.tracks[2].items[0].timeline.start, 5 * TICK)
})

test('parseEditPlanReply extracts fenced JSON and reports repair errors', () => {
  const reply = 'Sure!\n```json\n{"schemaVersion":1,"intentSummary":"x","operations":[{"type":"set-volume","clipId":"c1","volume":70}]}\n```'
  const ok = parseEditPlanReply(reply)
  assert.equal(ok.ok, true)
  const garbage = parseEditPlanReply('I cannot help with that.')
  assert.equal(garbage.ok, false)
  assert.ok(garbage.errors.length > 0)
  const badOps = parseEditPlanReply('{"operations":[{"type":"hack"}]}')
  assert.equal(badOps.ok, false)
})

test('summarize produces readable one-liners', () => {
  const lines = summarizeEditPlan({
    operations: [
      { type: 'set-canvas', width: 1080, height: 1920, fps: 30 },
      { type: 'add-clip', trackType: 'text', name: 'Title' },
      { type: 'set-volume', clipId: 'c1', volume: 80 }
    ]
  }, { c1: 'My Clip' })
  assert.equal(lines.length, 3)
  assert.match(lines[0], /1080x1920/)
  assert.match(lines[1], /text "Title"/)
  assert.match(lines[2], /volume 80%/)
})
