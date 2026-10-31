import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  STARTER_MUSIC_CATALOG,
  STARTER_SFX_CATALOG,
  STARTER_FONT_CATALOG,
  STARTER_MARKETPLACE_CATALOG,
  getMarketplaceByCategory,
  getMarketplaceMusic,
  getMarketplaceSfx,
  getMarketplaceFonts,
  getMarketplaceEntryById
} from '../src/marketplaceCatalog.mjs'
import { validateCatalogEntry } from '../src/catalogPublish.mjs'

// The starter catalog ships INSIDE the installer and is presented to the user
// as cleared-for-commercial-use content, so every entry must hold that promise
// structurally — a catalog row with a missing/unreviewed license is a rights
// claim the app cannot honour. These tests are the gate for that claim.

const ALL = [
  ['music', STARTER_MUSIC_CATALOG],
  ['sound-effects', STARTER_SFX_CATALOG],
  ['fonts', STARTER_FONT_CATALOG]
]

describe('starter marketplace catalog (Roadmap v1 P7)', () => {
  it('combines to exactly the three category catalogs', () => {
    assert.ok(STARTER_MUSIC_CATALOG.length > 0)
    assert.ok(STARTER_SFX_CATALOG.length > 0)
    assert.ok(STARTER_FONT_CATALOG.length > 0)
    assert.equal(
      STARTER_MARKETPLACE_CATALOG.length,
      STARTER_MUSIC_CATALOG.length + STARTER_SFX_CATALOG.length + STARTER_FONT_CATALOG.length
    )
  })

  it('keeps entry ids unique across the whole catalog', () => {
    const ids = STARTER_MARKETPLACE_CATALOG.map(entry => entry.id)
    assert.equal(new Set(ids).size, ids.length, 'duplicate entry id')
    assert.ok(ids.every(id => typeof id === 'string' && id.length > 0))
  })

  it('ships only reviewed, commercially usable, non-expired licenses', () => {
    for (const [category, entries] of ALL) {
      for (const entry of entries) {
        const license = entry.license
        assert.equal(entry.category, category, `${entry.id}: wrong category bucket`)
        assert.equal(license.status, 'approved', `${entry.id}: license not approved`)
        assert.equal(license.review?.decision, 'approved', `${entry.id}: no approval record`)
        assert.ok(license.review?.by, `${entry.id}: approval has no reviewer`)
        assert.equal(license.commercialUse, true, `${entry.id}: not cleared for commercial use`)
        assert.ok(license.reviewer, `${entry.id}: license has no reviewer`)
        assert.ok(license.reviewedAt, `${entry.id}: license has no review date`)
        // A starter row must never expire silently under a long-lived project.
        assert.equal(license.expiresAt, null, `${entry.id}: starter license expires`)
      }
    }
  })

  it('stays free of charge — a starter row is never silently paid', () => {
    for (const entry of STARTER_MARKETPLACE_CATALOG) {
      assert.equal(entry.priceUsd, 0, `${entry.id}: starter entry carries a price`)
    }
  })

  it('is bundled-sample sourced: nothing downloads from a starter row', () => {
    for (const entry of STARTER_MARKETPLACE_CATALOG) {
      assert.equal(entry.source.type, 'sample', `${entry.id}: starter row is not a sample`)
      assert.ok(entry.source.sampleId, `${entry.id}: sample row without sampleId`)
      // The controller gates every remote fetch on a sha256 comparison; a
      // placeholder hash would fail it. Empty sourceUrl + sample source is
      // what keeps the placeholder sha256 harmless — pin that pairing.
      assert.equal(entry.sourceUrl, '', `${entry.id}: sample row has a download URL`)
    }
  })

  it('carries the display fields the marketplace cards render', () => {
    for (const entry of STARTER_MARKETPLACE_CATALOG) {
      assert.ok(entry.title, `${entry.id}: no title`)
      assert.ok(entry.description, `${entry.id}: no description`)
      assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, `${entry.id}: no tags`)
      assert.ok(entry.creator, `${entry.id}: no creator (attribution source)`)
      assert.ok(entry.sizeBytes > 0, `${entry.id}: no size`)
      assert.ok(entry.version, `${entry.id}: no version`)
    }
  })

  it('satisfies the publish validator used for real catalog documents', () => {
    for (const entry of STARTER_MARKETPLACE_CATALOG) {
      const issues = validateCatalogEntry(entry)
      assert.deepEqual(issues, [], `${entry.id}: ${JSON.stringify(issues)}`)
    }
  })

  it('serves category buckets and id lookups, and refuses unknown input', () => {
    assert.deepEqual(getMarketplaceMusic(), STARTER_MUSIC_CATALOG)
    assert.deepEqual(getMarketplaceSfx(), STARTER_SFX_CATALOG)
    assert.deepEqual(getMarketplaceFonts(), STARTER_FONT_CATALOG)
    assert.deepEqual(getMarketplaceByCategory('nope'), [])
    assert.deepEqual(getMarketplaceByCategory(undefined), [])

    const probe = STARTER_MARKETPLACE_CATALOG[0]
    assert.equal(getMarketplaceEntryById(probe.id), probe)
    assert.equal(getMarketplaceEntryById('does-not-exist'), undefined)
    assert.equal(getMarketplaceEntryById(undefined), undefined)
  })
})
