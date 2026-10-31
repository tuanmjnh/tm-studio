// Roadmap v3 PART B (Template Studio) — schema versioning, migration, and
// required-asset resolution. Pure core contracts the apply pipeline depends
// on: validate BEFORE build, refuse newer schemas, never invent asset ids.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_TEMPLATES,
  TEMPLATE_SCHEMA_VERSION,
  validateTemplate,
  migrateTemplate,
  createTemplateFromTimeline,
  checkRequiredAssets,
  instantiateTemplate
} from '../src/index.mjs'

function minimalTemplate(extra = {}) {
  return {
    id: 'tpl-x',
    name: 'X',
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationTicks: 5 * 100000,
    tracks: [{ id: 't1', type: 'video', items: [] }],
    ...extra
  }
}

test('every shipped builtin passes the validator and survives a no-op migration', () => {
  for (const tpl of BUILTIN_TEMPLATES) {
    assert.equal(validateTemplate(tpl).valid, true, `${tpl.id} must be valid`)
    const res = migrateTemplate(tpl)
    assert.deepEqual(res.errors, [], `${tpl.id} must migrate cleanly`)
    assert.equal(res.migrated.schemaVersion, TEMPLATE_SCHEMA_VERSION)
    // Migration never mutates the input (deep clone).
    assert.equal(tpl.schemaVersion, undefined)
  }
})

test('missing schemaVersion is treated as v1 and stamped on migration', () => {
  const res = migrateTemplate(minimalTemplate())
  assert.equal(res.migrated.schemaVersion, TEMPLATE_SCHEMA_VERSION)
  assert.deepEqual(res.errors, [])
})

test('a future schemaVersion is refused, not silently downgraded', () => {
  const future = minimalTemplate({ schemaVersion: TEMPLATE_SCHEMA_VERSION + 5 })
  const res = migrateTemplate(future)
  assert.equal(res.migrated, null)
  assert.match(res.errors.join(' '), /newer/i)
  // validateTemplate is the second gate: a newer template also fails there.
  assert.equal(validateTemplate({ ...minimalTemplate(), schemaVersion: TEMPLATE_SCHEMA_VERSION + 5 }).valid, false)
})

test('validate rejects non-positive / fractional schemaVersion', () => {
  assert.equal(validateTemplate(minimalTemplate({ schemaVersion: 0 })).valid, false)
  assert.equal(validateTemplate(minimalTemplate({ schemaVersion: 'nope' })).valid, false)
})

test('createTemplateFromTimeline stamps version + requiredAssets', () => {
  const timeline = {
    tracks: [
      { id: 't1', type: 'video', items: [{ id: 'c1', src: 'C:\\media\\a.mp4', in: 0, out: 100000, offset: 0 }] },
      { id: 't2', type: 'audio', items: [{ id: 'c2', src: 'asset://starter-lut-teal-orange', in: 0, out: 100000, offset: 0 }] },
      { id: 't3', type: 'text', items: [{ id: 'c3', text: 'hi', in: 0, out: 100000, offset: 0 }] }
    ],
    markers: []
  }
  const tpl = createTemplateFromTimeline(timeline, { name: 'T' })
  assert.equal(tpl.schemaVersion, TEMPLATE_SCHEMA_VERSION)
  assert.equal(typeof tpl.version, 'number')
  const ids = tpl.requiredAssets.map(r => r.assetId)
  // text ignored, unique srcs collected, asset:// becomes a catalog ref.
  assert.equal(ids.includes('local:a.mp4'), true)
  assert.equal(ids.includes('asset:starter-lut-teal-orange'), true)
  assert.equal(ids.length, 2)
})

test('checkRequiredAssets classifies satisfied vs missing vs ask-user', () => {
  const tpl = {
    requiredAssets: [
      { assetId: 'asset:starter-lut-teal-orange', required: true, fallback: 'omit' },
      { assetId: 'asset:not-installed', required: true, fallback: 'ask-user' },
      { assetId: 'local:clip.mp4', required: true, fallback: 'ask-user', sourceHint: 'clip.mp4' }
    ]
  }
  const view = { installedIds: ['asset:starter-lut-teal-orange'] }
  const res = checkRequiredAssets(tpl, view)
  assert.equal(res.satisfied.length, 1)
  assert.equal(res.missingAssets.length, 1)
  assert.equal(res.localNeeds.length, 1)
  // local needs never become "missing catalog assets" — the importer must
  // ask the user, never substitute silently (roadmap §6.4).
  assert.equal(res.missingAssets[0].assetId, 'asset:not-installed')
})

test('instantiating a versioned template still produces a fresh editable timeline', () => {
  const src = minimalTemplate({
    tracks: [
      { id: 't1', type: 'video', items: [{ id: 'c1', src: 'in:a.mp4', in: 0, out: 100000, offset: 0 }] },
      { id: 't2', type: 'text', items: [{ id: 'c2', text: 'Original', in: 0, out: 100000, offset: 0 }] }
    ]
  })
  const { migrated } = migrateTemplate(src)
  const out = instantiateTemplate(migrated)
  assert.ok(out.timeline.tracks.length === 2)
  // Fresh ids on every instantiation (no collisions with the template).
  const freshClip = out.timeline.tracks[0].items[0]
  assert.notEqual(freshClip.id, 'c1')
  // Instantiation is a pure copy — the (migrated) template is untouched.
  assert.equal(src.tracks[0].items[0].id, 'c1')
  assert.equal(migrated.tracks[0].items[0].id, 'c1')
})
