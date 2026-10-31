import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createCatalogEntry,
  createInstalledAsset,
  canInstall,
  transitionInstall,
  recoverInstallStates,
  createDownloadQueue,
  storageReport,
  parseEntitlements,
  hasLiveEntitlement,
  INSTALL_STATES,
  DOWNLOAD_STATES,
  LICENSE_STATUS,
  ASSET_CENTER_SCHEMA_VERSION,
  ENTITLEMENT_SCHEMA_VERSION
} from '../src/assetCenter.mjs'

function entry(overrides = {}) {
  return createCatalogEntry({
    id: 'asset_music_001',
    title: 'Lo-fi Loop',
    category: 'music',
    sizeBytes: 2048,
    sha256: 'abc123',
    sourceUrl: 'https://cdn.example.com/music/lofi.zip',
    version: '1.2.0',
    license: {
      status: LICENSE_STATUS.approved,
      name: 'CC-BY-4.0',
      url: 'https://creativecommons.org/licenses/by/4.0/',
      attribution: 'Artist X',
      commercialUse: true,
      reviewer: 'reviewer-1',
      reviewedAt: '2026-10-01T00:00:00.000Z'
    },
    ...overrides
  })
}

describe('asset center catalog + license gate (Roadmap v3 PART A)', () => {
  it('creates catalog entries with normalized license', () => {
    const e = entry()
    assert.equal(e.schemaVersion, ASSET_CENTER_SCHEMA_VERSION)
    assert.equal(e.license.status, 'approved')
    assert.equal(e.license.commercialUse, true)
    assert.equal(e.license.reviewer, 'reviewer-1')
  })

  it('normalizes assetKind and source discriminants', () => {
    const remote = entry({ source: { type: 'remote', url: 'https://cdn/x.zip' } })
    assert.equal(remote.source.type, 'remote')
    assert.equal(remote.sourceUrl, 'https://cdn/x.zip')

    const sample = entry({ id: 's', source: { type: 'sample', sampleId: 'sample-lut-teal' } })
    assert.equal(sample.source.type, 'sample')
    assert.equal(sample.sourceUrl, '')

    const embedded = entry({
      id: 'e',
      assetKind: 'effect-preset',
      source: { type: 'embedded', payload: { effectType: 'lut3d', params: { lut: 'teal-orange' } } }
    })
    assert.equal(embedded.assetKind, 'effect-preset')
    assert.equal(embedded.source.payload.effectType, 'lut3d')

    // Unknown kind falls back to media. A bogus source with no usable
    // legacy URL falls back to embedded/null; with a legacy URL the entry
    // stays remote (a v1 cache line never silently loses its source).
    assert.equal(entry({ id: 'z', assetKind: 'bogus' }).assetKind, 'media')
    assert.deepEqual(
      createCatalogEntry({ id: 'z2', source: { type: 'nope' } }).source,
      { type: 'embedded', payload: null }
    )
    assert.equal(entry({ id: 'z2b', source: { type: 'nope' } }).source.type, 'remote')
    // Legacy sourceUrl still maps to remote (backward compat with v1 caches).
    assert.equal(entry({ id: 'z3', sourceUrl: 'https://legacy/f.zip' }).source.type, 'remote')
  })

  it('missing license normalizes to unknown (never approved)', () => {
    const e = entry({ license: undefined })
    assert.equal(e.license.status, 'unknown')
    const gate = canInstall(e)
    assert.equal(gate.allowed, false)
    assert.equal(gate.reason, 'license-unknown')
  })

  it('review-pending and unknown rights block install', () => {
    assert.equal(canInstall(entry({ license: { status: 'review', name: 'X' } })).reason, 'license-review')
    assert.equal(canInstall(entry({ license: { status: 'weird' } })).reason, 'license-unknown')
  })

  it('expired license blocks install only when now is past expiry', () => {
    const e = entry({ license: entry().license })
    e.license.expiresAt = '2026-01-01T00:00:00.000Z'
    assert.equal(canInstall(e, { now: Date.parse('2026-06-01T00:00:00Z') }).reason, 'license-expired')
    assert.equal(canInstall(e, { now: Date.parse('2025-06-01T00:00:00Z') }).allowed, true)
  })

  it('install state machine enforces verify-before-install', () => {
    const r = createInstalledAsset({ entryId: 'a', version: '1.0.0' })
    r.state = INSTALL_STATES.downloading
    // downloading -> installed must be rejected
    transitionInstall(r, 'installed')
    assert.equal(r.state, INSTALL_STATES.downloading)
    // legal path
    transitionInstall(r, 'verifying')
    transitionInstall(r, 'installed', { verified: true, dir: '/x', sizeBytes: 10 })
    assert.equal(r.state, INSTALL_STATES.installed)
    assert.equal(r.verified, true)
  })

  it('recoverInstallStates rolls mid-flight states back to catalog', () => {
    const a = createInstalledAsset({ entryId: 'a' })
    const b = createInstalledAsset({ entryId: 'b' })
    a.state = 'downloading'
    b.state = 'verifying'
    const out = recoverInstallStates([a, b, 'not-an-object'])
    assert.equal(out[0].state, 'catalog')
    assert.equal(out[1].state, 'catalog')
    assert.equal(out.length, 2)
  })
})

describe('download queue (queue / progress / bounded backoff / cancel)', () => {
  it('enforces concurrency and reports progress', () => {
    const q = createDownloadQueue({ concurrency: 1 })
    const j1 = q.enqueue(entry())
    const j2 = q.enqueue(entry({ id: 'b', sourceUrl: 'https://x/2.zip' }))
    const a = q.startNext()
    assert.equal(a.id, j1.id)
    assert.equal(q.startNext(), null, 'concurrency 1 blocks the second job')
    q.reportProgress(a.id, 512, 2048)
    const snap = q.snapshot()
    assert.equal(snap.find(j => j.id === a.id).progress.percent, 25)
  })

  it('retries with bounded exponential backoff, then fails', () => {
    const q = createDownloadQueue({ maxRetries: 2, baseDelayMs: 100, maxDelayMs: 400 })
    const job = q.enqueue(entry())
    const a = q.startNext()
    q.reportResult(a.id, { ok: false, error: 'net-timeout' })
    assert.equal(a.state, DOWNLOAD_STATES.retrying)
    assert.equal(a.delayMs, 100)
    assert.equal(a.attempts, 1)

    const b = q.armRetry(a.id)
    assert.equal(b.state, DOWNLOAD_STATES.active)
    q.reportResult(b.id, { ok: false, error: 'net-timeout' })
    assert.equal(b.delayMs, 200)

    const c = q.armRetry(b.id)
    q.reportResult(c.id, { ok: false, error: 'net-timeout' })
    assert.equal(c.state, DOWNLOAD_STATES.failed, 'attempts exhausted')
    assert.equal(c.reason, 'net-timeout')
  })

  it('delay is capped at maxDelayMs', () => {
    const q = createDownloadQueue({ maxRetries: 5, baseDelayMs: 1000, maxDelayMs: 2000 })
    const job = q.enqueue(entry())
    q.startNext()
    q.reportResult(job.id, { ok: false })
    q.armRetry(job.id)
    q.reportResult(job.id, { ok: false })
    q.armRetry(job.id)
    q.reportResult(job.id, { ok: false })
    assert.equal(job.delayMs, 2000)
  })

  it('success requires verified checksum', () => {
    const q = createDownloadQueue()
    const job = q.enqueue(entry())
    const a = q.startNext()
    q.reportResult(a.id, { ok: true, verified: false })
    assert.equal(a.state, DOWNLOAD_STATES.retrying, 'unverified download is not a success')
    const b = q.armRetry(a.id)
    q.reportResult(b.id, { ok: true, verified: true })
    assert.equal(b.state, DOWNLOAD_STATES.done)
  })

  it('license-blocked entries are never queued', () => {
    const q = createDownloadQueue()
    const job = q.enqueue(entry({ license: { status: 'unknown' } }))
    assert.equal(job.state, DOWNLOAD_STATES.cancelled)
    assert.equal(q.startNext(), null)
  })

  it('cancel frees the concurrency slot', () => {
    const q = createDownloadQueue({ concurrency: 1 })
    const j1 = q.enqueue(entry())
    const j2 = q.enqueue(entry({ id: 'b', sourceUrl: 'https://x/2.zip' }))
    q.startNext()
    q.cancel(j1.id)
    const next = q.startNext()
    assert.equal(next.id, j2.id)
    assert.equal(q.pendingCount(), 1)
  })
})

describe('storage accounting (protect pinned projects on cleanup)', () => {
  it('only installed+verified assets are reclaimable, pinned are protected', () => {
    const a = createInstalledAsset({ entryId: 'a', sizeBytes: 100, verified: true })
    const b = createInstalledAsset({ entryId: 'b', sizeBytes: 200, verified: true })
    const c = createInstalledAsset({ entryId: 'c', sizeBytes: 300, verified: false })
    const report = storageReport([a, b, c], { usedProjectIds: ['b'], quotaBytes: 1000 })
    assert.equal(report.totalBytes, 600)
    assert.equal(report.usableBytes, 300)
    assert.deepEqual(report.reclaimableIds, ['a'])
    assert.equal(report.reclaimableBytes, 100)
    assert.equal(report.quotaPct, 60)
  })
})

describe('entitlements for paid assets (Roadmap v3 §26)', () => {
  const NOW = Date.parse('2026-10-21T00:00:00Z')
  const liveGrant = {
    entryId: 'asset_premium_001',
    version: '1.0.0',
    grantedAt: '2026-10-01T00:00:00.000Z',
    expiresAt: '2027-01-01T00:00:00.000Z',
    signature: 'sig-1'
  }

  it('parseEntitlements drops malformed grants, keeps clean ones', () => {
    const parsed = parseEntitlements({ grants: [liveGrant, null, { version: 'x' }, 'junk'] })
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].entryId, 'asset_premium_001')
    assert.equal(parsed[0].signature, 'sig-1')
    // A bare array is also accepted (catalog payload variant).
    assert.equal(parseEntitlements([liveGrant]).length, 1)
    assert.deepEqual(parseEntitlements(null), [])
    assert.equal(ENTITLEMENT_SCHEMA_VERSION, 1)
  })

  it('hasLiveEntitlement: entry match, version match, expiry', () => {
    assert.equal(hasLiveEntitlement('asset_premium_001', '1.0.0', [liveGrant], NOW), true)
    // Empty grant version = wildcard version.
    assert.equal(hasLiveEntitlement('asset_premium_001', '2.0.0', [{ ...liveGrant, version: '' }], NOW), true)
    assert.equal(hasLiveEntitlement('other', '1.0.0', [liveGrant], NOW), false)
    const expired = { ...liveGrant, expiresAt: '2026-01-01T00:00:00.000Z' }
    assert.equal(hasLiveEntitlement('asset_premium_001', '1.0.0', [expired], NOW), false)
    assert.equal(hasLiveEntitlement('asset_premium_001', '1.0.0', [], NOW), false)
  })

  it('paid entry without a grant is blocked; with a live grant it passes', () => {
    const paid = entry({ id: 'asset_premium_001', priceUsd: 4.5, version: '1.0.0' })
    assert.equal(paid.priceUsd, 4.5)
    const blocked = canInstall(paid, { now: NOW })
    assert.equal(blocked.allowed, false)
    assert.equal(blocked.reason, 'entitlement-missing')
    const allowed = canInstall(paid, { now: NOW, entitlements: [liveGrant] })
    assert.equal(allowed.allowed, true)
    assert.equal(allowed.reason, null)
  })

  it('free entries ignore entitlements entirely', () => {
    const free = entry()
    assert.equal(free.priceUsd, 0)
    assert.equal(canInstall(free, { now: NOW }).allowed, true)
  })

  it('the download queue blocks paid enqueues without a grant (static + getter)', () => {
    const paid = entry({ id: 'asset_premium_001', priceUsd: 9, version: '1.0.0' })
    const q1 = createDownloadQueue({ entitlements: null })
    assert.equal(q1.enqueue(paid).state, DOWNLOAD_STATES.cancelled)
    const q2 = createDownloadQueue({ entitlements: () => [liveGrant] })
    const job = q2.enqueue(paid)
    assert.equal(job.state, DOWNLOAD_STATES.queued)
    assert.equal(job.reason, null)
  })
})
