import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateCatalogEntry,
  validateCatalogDocument,
  stampLicenseReview,
  CATALOG_PUBLISH_SCHEMA_VERSION
} from '../src/catalogPublish.mjs'
import { createCatalogEntry } from '../src/assetCenter.mjs'

function baseEntry(overrides = {}) {
  return createCatalogEntry({
    id: 'music_summer_loop',
    title: 'Summer Loop',
    category: 'music',
    version: '1.0.0',
    sizeBytes: 4096,
    sha256: 'deadbeef',
    source: { type: 'remote', url: 'https://cdn.example.com/summer.zip' },
    license: {
      status: 'approved',
      name: 'CC-BY-4.0',
      reviewer: 'reviewer-1',
      reviewedAt: '2026-10-01T00:00:00.000Z'
    },
    ...overrides
  })
}

describe('catalog publishing validation (Roadmap v3 §26)', () => {
  it('exports a schema version', () => {
    assert.equal(CATALOG_PUBLISH_SCHEMA_VERSION, 1)
  })

  it('accepts a fully compliant entry', () => {
    assert.deepEqual(validateCatalogEntry(baseEntry()), [])
  })

  it('requires id / title and a well-formed id', () => {
    assert.ok(validateCatalogEntry(baseEntry({ id: '' })).some(e => e.includes('id is required')))
    assert.ok(validateCatalogEntry(baseEntry({ id: 'bad id!!' })).some(e => e.includes('alphanumeric')))
    assert.ok(validateCatalogEntry(baseEntry({ title: '' })).some(e => e.includes('title is required')))
  })

  it('blocks unknown categories', () => {
    const errors = validateCatalogEntry(baseEntry({ category: 'stickers' }))
    assert.ok(errors.some(e => e.includes('unknown category')))
  })

  it('blocks an approved license without a reviewer stamp', () => {
    const raw = { ...baseEntry(), license: { status: 'approved', name: 'MIT', reviewer: null } }
    const errors = validateCatalogEntry(raw)
    assert.ok(errors.some(e => e.includes('reviewer stamp')))
  })

  it('remote entries need https + sha256 + size', () => {
    const errors = validateCatalogEntry(baseEntry({
      sha256: '',
      sizeBytes: 0,
      source: { type: 'remote', url: 'http://insecure.example/x.zip' }
    }))
    assert.ok(errors.some(e => e.includes('https:// URL')))
    assert.ok(errors.some(e => e.includes('sha256')))
    assert.ok(errors.some(e => e.includes('sizeBytes')))
  })

  it('paid entries must declare a sales channel', () => {
    const errors = validateCatalogEntry(baseEntry({ priceUsd: 3.99 }))
    assert.ok(errors.some(e => e.includes('salesChannel')))
    const ok = baseEntry({ priceUsd: 3.99, salesChannel: 'tm-hub checkout' })
    assert.deepEqual(validateCatalogEntry(ok), [])
  })

  it('a review-status remote entry only needs https (no hash/size)', () => {
    const underReview = baseEntry({
      license: { status: 'review', name: 'Proprietary' },
      sha256: '',
      sizeBytes: 0
    })
    assert.deepEqual(validateCatalogEntry(underReview), [])
  })
})

describe('catalog document validation + license review stamp', () => {
  it('rejects duplicate ids and dangling takedown refs', () => {
    const doc = {
      entries: [baseEntry(), baseEntry()],
      takedowns: [{ entryId: 'ghost_entry', reason: 'rights-claim' }]
    }
    const res = validateCatalogDocument(doc)
    assert.equal(res.ok, false)
    assert.ok(res.errors.some(e => e.includes('duplicate id')))
    assert.ok(res.errors.some(e => e.includes('unknown entry')))
    assert.equal(res.stats.entries, 2)
  })

  it('counts publishable entries and accepts a clean document', () => {
    const doc = {
      entries: [baseEntry(), baseEntry({ id: 'other', license: { status: 'review' } })],
      takedowns: []
    }
    const res = validateCatalogDocument(doc)
    // The review-status entry is publishable (download stays gated by the
    // install license check); errors stay empty.
    assert.equal(res.ok, true)
    assert.equal(res.stats.publishable, 2)
  })

  it('rejects a document without an entries array', () => {
    const res = validateCatalogDocument({})
    assert.equal(res.ok, false)
    assert.equal(res.stats.entries, 0)
  })

  it('stampLicenseReview records approve/reject audit without mutating', () => {
    const underReview = baseEntry({ license: { status: 'review', name: 'CC-BY-4.0' } })
    const approved = stampLicenseReview(underReview, {
      reviewer: 'alice', approve: true, reviewedAt: '2026-10-20T00:00:00.000Z', note: 'verified invoice'
    })
    assert.equal(approved.license.status, 'approved')
    assert.equal(approved.license.reviewer, 'alice')
    assert.equal(approved.license.review.decision, 'approved')
    assert.equal(approved.license.review.note, 'verified invoice')
    // Original untouched.
    assert.equal(underReview.license.status, 'review')

    const rejected = stampLicenseReview(baseEntry(), { reviewer: 'bob', approve: false })
    assert.equal(rejected.license.status, 'review')
    assert.equal(rejected.license.review.decision, 'rejected')
  })

  it('stampLicenseReview requires a reviewer id', () => {
    assert.throws(() => stampLicenseReview(baseEntry(), { reviewer: '', approve: true }), /reviewer id/)
  })

  it('normalizeLicense keeps the review trail', () => {
    const stamped = stampLicenseReview(baseEntry({ license: { status: 'review', name: 'X' } }), { reviewer: 'a', approve: true })
    const roundTrip = createCatalogEntry(stamped)
    assert.equal(roundTrip.license.review.by, 'a')
    assert.equal(roundTrip.license.review.decision, 'approved')
  })
})
