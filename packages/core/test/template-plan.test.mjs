// Roadmap v3 §6.5 — AI Template Plan contracts: the model may only add
// clips; the builder runs core addClip and the existing template pipeline,
// so AI output carries placeholders, requiredAssets, schemaVersion and a
// generatedBy label exactly like a manual template.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateTemplatePlan,
  buildTemplateFromPlan,
  parseTemplatePlanReply,
  summarizeTemplatePlan,
  validateTemplate,
  instantiateTemplate,
  TEMPLATE_PLAN_SCHEMA_VERSION
} from '../src/index.mjs'

const TICK = 120_000

const goodPlan = () => ({
  schemaVersion: TEMPLATE_PLAN_SCHEMA_VERSION,
  intentSummary: '3s hook template',
  template: {
    name: 'AI Hook',
    description: 'generated',
    category: 'intro',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    fps: 30
  },
  operations: [
    { type: 'add-clip', trackType: 'text', name: 'Headline', text: 'WOW', offset: 0, out: 3 * TICK, color: '#ffdd00', fontSize: 54 },
    { type: 'add-clip', trackType: 'video', name: 'B-roll', mediaRef: 'm1', offset: 0, out: 3 * TICK },
    { type: 'add-clip', trackType: 'audio', name: 'Music bed', offset: 0, out: 3 * TICK }
  ]
})

test('valid plan passes and never touches filesystem shapes', () => {
  const res = validateTemplatePlan(goodPlan(), { mediaRefs: ['m1'] })
  assert.deepEqual(res.errors, [])
})

test('anything but add-clip is rejected (no destructive verbs)', () => {
  for (const type of ['remove-clip', 'set-canvas', 'run-shell']) {
    const plan = goodPlan()
    plan.operations.push({ type })
    const res = validateTemplatePlan(plan)
    assert.equal(res.valid, false, `must reject ${type}`)
  }
})

test('name/canvas/aspect-ratio/refs validated strictly', () => {
  const bad = [
    { ...goodPlan(), template: { aspectRatio: '9:16', width: 1080, height: 1920, fps: 30 } }, // no name
    (() => { const p = goodPlan(); p.template.aspectRatio = '7:3'; return p })(),
    (() => { const p = goodPlan(); p.template.category = 'sci-fi'; return p })(),
    (() => { const p = goodPlan(); p.template.width = 1920; return p })(), // contradicts 9:16
    (() => { const p = goodPlan(); p.operations[1].mediaRef = 'C:\\x\\y.mp4'; return p })(),
    (() => { const p = goodPlan(); p.operations[1].mediaRef = 'ghost'; return p })(),
    (() => { const p = goodPlan(); p.operations[1].offset = -5; return p })(),
    { schemaVersion: 99, template: { name: 'x' }, operations: [{ type: 'add-clip', trackType: 'text', text: 'hi' }] }
  ]
  for (const plan of bad) {
    const res = validateTemplatePlan(plan, { mediaRefs: ['m1'] })
    assert.equal(res.valid, false, JSON.stringify(plan.template?.name ?? plan.schemaVersion))
    assert.ok(res.errors.length > 0)
  }
})

test('builder produces a valid pipeline template with placeholders + provenance', () => {
  const { valid } = validateTemplatePlan(goodPlan(), { mediaRefs: ['m1'] })
  assert.ok(valid)
  const { template, warnings } = buildTemplateFromPlan(goodPlan(), {
    mediaResolution: { m1: { src: 'C:\\media\\broll.mp4', name: 'broll.mp4' } },
    provider: 'openrouter',
    model: 'test-model'
  })
  // Existing contract: the template validates and instantiates unchanged.
  const check = validateTemplate(template)
  assert.deepEqual(check.errors, [])
  assert.equal(check.valid, true)
  assert.equal(template.name, 'AI Hook')
  assert.equal(template.category, 'intro')
  assert.equal(template.aspectRatio, '9:16')
  assert.equal(template.schemaVersion, 1)
  assert.equal(template.generatedBy.tool, 'ai')
  assert.equal(template.generatedBy.model, 'test-model')
  // Resolved media became a real src; the missing-ref audio is a placeholder.
  const videoTrack = template.tracks.find(t => t.type === 'video')
  assert.equal(videoTrack.items[0].src, 'C:\\media\\broll.mp4')
  const audioTrack = template.tracks.find(t => t.type === 'audio')
  assert.equal(audioTrack.items[0].src, undefined)
  assert.ok(template.placeholders.some(ph => ph.clipId === audioTrack.items[0].id))
  // requiredAssets got the resolved local file (§6.4 contract).
  assert.ok(template.requiredAssets.some(a => a.assetId.startsWith('local:')))
  // Instantiation works out of the box.
  const built = instantiateTemplate(template)
  assert.ok(built.timeline.tracks.length >= 3)
  assert.ok(warnings.length >= 1) // audio placeholder warning
})

test('unresolved mediaRef never fabricates a path', () => {
  const { template } = buildTemplateFromPlan(goodPlan(), { mediaResolution: {} })
  const videoTrack = template.tracks.find(t => t.type === 'video')
  assert.equal(videoTrack.items[0].src, undefined)
})

test('parseTemplatePlanReply handles fenced JSON and reports repair errors', () => {
  const reply = '```json\n' + JSON.stringify(goodPlan()) + '\n```'
  const ok = parseTemplatePlanReply(reply, { mediaRefs: ['m1'] })
  assert.equal(ok.ok, true)
  const bad = parseTemplatePlanReply('no json here')
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.length > 0)
})

test('summarize shows placeholders vs refs without paths', () => {
  const lines = summarizeTemplatePlan(goodPlan())
  assert.ok(lines.some(l => l.includes('ref m1')))
  assert.ok(lines.some(l => l.includes('(placeholder)')))
  assert.ok(!lines.some(l => l.includes(':\\')))
})
