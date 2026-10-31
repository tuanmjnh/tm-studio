/**
 * R131 — File exchange for templates (docs §195).
 * Pure-module tests for app/utils/tmcut/templateIo.ts: the format is
 * versioned, imports are untrusted input (garbage refused, never thrown),
 * ids regenerate and isBuiltin is always forced false on import.
 * Run: pnpm test:tmcut (or tsx --tsconfig tsconfig.test.json directly).
 */
import assert from 'node:assert/strict'
import {
  buildTemplateFile,
  safeTemplateFileName,
  sanitizeImportedTemplate,
  parseTemplateFile,
  TEMPLATE_FILE_KIND,
  TEMPLATE_FILE_VERSION,
  newTemplateId
} from '../../app/utils/tmcut/templateIo'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  console.log(`   ${name} PASSED`)
  passed += 1
}

const sampleTemplate = {
  id: 'usr_tpl_original',
  name: 'Vertical Hook',
  description: 'test template',
  category: 'custom',
  aspectRatio: '9:16',
  canvas: { width: 1080, height: 1920, fps: 30 },
  durationTicks: 360000,
  tracks: [{ id: 'tr-1', type: 'text', name: 'Text', items: [] }],
  placeholders: [],
  isBuiltin: true,
  createdAt: 1776000000000
}

check('round-trip through the versioned envelope', () => {
  const text = buildTemplateFile(sampleTemplate as never)
  const parsed = JSON.parse(text)
  assert.equal(parsed.kind, TEMPLATE_FILE_KIND)
  assert.equal(parsed.version, TEMPLATE_FILE_VERSION)
  assert.ok(typeof parsed.exportedAt === 'string')
  const res = parseTemplateFile(text)
  assert.ok(res.ok, JSON.stringify(res))
  const tpl = res.template!
  // Import NEVER keeps the file's identity (docs §195 honesty rule):
  assert.notEqual(tpl.id, 'usr_tpl_original')
  assert.ok(tpl.id.startsWith('usr_tpl_'))
  assert.equal(tpl.isBuiltin, false, 'imports can never masquerade as builtins')
  // Payload survives verbatim.
  assert.equal(tpl.name, 'Vertical Hook')
  assert.equal(tpl.durationTicks, 360000)
  assert.deepEqual(tpl.tracks, sampleTemplate.tracks)
})

check('bare template objects (no envelope) are also accepted', () => {
  const res = parseTemplateFile(JSON.stringify(sampleTemplate))
  assert.ok(res.ok)
  assert.equal(res.template!.name, 'Vertical Hook')
  assert.equal(res.template!.isBuiltin, false)
})

check('unusable input returns a typed error instead of throwing', () => {
  assert.deepEqual(parseTemplateFile(''), { ok: false, error: 'empty' })
  assert.equal(parseTemplateFile('{broken').error, 'invalid-json')
  assert.equal(parseTemplateFile('42').error, 'invalid-format')
  assert.equal(parseTemplateFile('[]').error, 'validation-failed')
  // Structurally present but wrong content → validator details, no throw.
  const bad = parseTemplateFile(JSON.stringify({ name: 'No canvas', tracks: [] }))
  assert.equal(bad.error, 'validation-failed')
  assert.ok(Array.isArray(bad.details) && bad.details.length > 0)
})

check('sanitizeImportedTemplate repairs only createdAt, never identity', () => {
  const raw = JSON.parse(JSON.stringify(sampleTemplate))
  delete raw.createdAt
  const tpl = sanitizeImportedTemplate(raw)
  assert.ok(tpl)
  assert.ok(typeof tpl.createdAt === 'number' && tpl.createdAt > 0)
  const nan = JSON.parse(JSON.stringify(sampleTemplate))
  nan.createdAt = Number.NaN
  const tpl2 = sanitizeImportedTemplate(nan)
  assert.ok(tpl2 && Number.isFinite(tpl2.createdAt))
  // Valid createdAt kept untouched.
  assert.equal(sanitizeImportedTemplate(sampleTemplate)?.createdAt, 1776000000000)
})

check('oversized payloads are refused before JSON.parse', () => {
  const huge = `{"pad":"${'x'.repeat(9 * 1024 * 1024)}"}`
  assert.equal(parseTemplateFile(huge).error, 'too-large')
})

check('filename slug is filesystem-safe', () => {
  assert.equal(
    safeTemplateFileName({ name: 'Hook/Intro: “TikTok” 2026!' }),
    'Hook-Intro-TikTok-2026.tmcut-template.json'
  )
  assert.equal(safeTemplateFileName({ name: '   ' }), 'template.tmcut-template.json')
  assert.ok(!/[\\/:*?"<>|]/.test(safeTemplateFileName({ name: 'a/b\\c*d?e' })))
})

check('ids are unique across rapid successive imports', () => {
  const ids = new Set<string>()
  for (let i = 0; i < 200; i++) ids.add(newTemplateId())
  assert.equal(ids.size, 200)
})

console.log(`\n=== All ${passed} template-io checks passed ===`)
