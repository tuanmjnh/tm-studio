// =============================================================================
//  @tmcut/core — Catalog admin publishing workflow (roadmap v3 §26)
//
//  The publishing workflow that lives INSIDE this repo: before a catalog
//  document (starter catalog or cached remote snapshot) is shipped, the
//  publisher runs `validateCatalogDocument` and every entry must pass the
//  same contracts the app enforces at install time — no unreviewed license
//  published as approved, no remote entry without HTTPS + hash, unique ids.
//  `stampLicenseReview` records the human decision (approve/reject) on the
//  entry itself so the audit trail (who/when/decision) travels with the file.
//
//  Zero-dependency, pure. Accounts/payments/remote publishing stay on the
//  control plane (deferred until rights+payment workflows are defined).
// =============================================================================

import { createCatalogEntry, normalizeLicense } from './assetCenter.mjs'

export const CATALOG_PUBLISH_SCHEMA_VERSION = 1

const CATEGORIES = ['filters', 'music', 'sound-effects', 'titles', 'fonts', 'effects', 'transitions', 'other']

function isHttpUrl(url) {
  return typeof url === 'string' && url.startsWith('https://')
}

/**
 * Validate one entry against the publishing contract. Returns an array of
 * human-readable blocking errors (empty = publishable). Deliberately
 * stricter than the install gate: the app blocks an unsafe entry at the
 * edge; publishing must never ship one in the first place.
 */
export function validateCatalogEntry(entry) {
  const errors = []
  const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
  if (!id) errors.push('id is required')
  else if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) errors.push(`id "${id}" must be alphanumeric with . _ -`)
  if (!entry?.title) errors.push(`${id || 'entry'}: title is required`)
  if (entry?.category && !CATEGORIES.includes(entry.category)) {
    errors.push(`${id}: unknown category "${entry.category}"`)
  }
  // License: an APPROVED status without a reviewer stamp is a fake audit —
  // block publication until a human signs the review.
  const license = entry?.license
  if (!license || license.status === 'unknown') {
    errors.push(`${id}: license status must be set (approved or review)`)
  } else if (license.status === 'approved' && !license.reviewer) {
    errors.push(`${id}: approved license needs a reviewer stamp`)
  }
  // Source contract. A remote entry is only DANGEROUS when the install
  // gate lets it through (approved license) — then it MUST be verifiable
  // (https + hash + size). Entries still in 'review' cannot be downloaded
  // in the first place, so they only need a well-formed https URL.
  const source = entry?.source
  const isRemote = source?.type === 'remote'
  const installableRemote = isRemote && license?.status !== 'review' && license?.status !== 'unknown'
  if (isRemote) {
    if (!isHttpUrl(source.url)) errors.push(`${id}: remote source must be an https:// URL`)
    if (installableRemote) {
      if (!entry?.sha256) errors.push(`${id}: approved remote entries require a sha256 for verification`)
      if (!(Number(entry?.sizeBytes) > 0)) errors.push(`${id}: approved remote entries require sizeBytes > 0`)
    }
  } else if (source?.type === 'sample' && !source.sampleId) {
    errors.push(`${id}: sample source needs a sampleId`)
  } else if (source?.type === 'embedded' && !source.payload) {
    errors.push(`${id}: embedded source needs a payload`)
  }
  // Paid entries: a price without any source of entitlement issuance is a
  // support dead-end — require the publisher to declare the sales channel.
  if (Number(entry?.priceUsd) > 0 && !entry?.salesChannel) {
    errors.push(`${id}: paid entries must declare salesChannel (how grants are issued)`)
  }
  return errors
}

/**
 * Validate a whole catalog document. `{ ok, errors, stats }`.
 * Duplicate ids and license/takedown cross-references are document-level
 * checks the per-entry validator cannot see.
 */
export function validateCatalogDocument(doc) {
  const errors = []
  const entries = Array.isArray(doc?.entries) ? doc.entries : null
  if (!entries) {
    return { ok: false, errors: ['document must have an entries array'], stats: { entries: 0, publishable: 0 } }
  }
  const seen = new Set()
  let publishable = 0
  for (const raw of entries) {
    const entryErrors = validateCatalogEntry(raw)
    const id = typeof raw?.id === 'string' ? raw.id : ''
    if (id) {
      if (seen.has(id)) entryErrors.push(`duplicate id "${id}"`)
      seen.add(id)
    }
    if (entryErrors.length === 0) publishable += 1
    errors.push(...entryErrors)
  }
  // Takedown notices must point at entries this document actually carries
  // (a stale notice for an unknown id hides authoring mistakes).
  const takedowns = Array.isArray(doc?.takedowns) ? doc.takedowns : []
  for (const t of takedowns) {
    const entryId = typeof t?.entryId === 'string' ? t.entryId : ''
    if (!entryId) errors.push('takedown notice without entryId')
    else if (!seen.has(entryId)) errors.push(`takedown references unknown entry "${entryId}"`)
  }
  return { ok: errors.length === 0, errors, stats: { entries: entries.length, publishable } }
}

/**
 * Record a human license-review decision on an entry (the audit trail the
 * roadmap asks for: who/what/when). Returns a NEW entry object; never
 * mutates. Rejecting downgrades the status to 'review' and keeps the trail
 * so the next publisher sees the previous decision.
 */
export function stampLicenseReview(entry, { reviewer, reviewedAt, approve, note = '', proof = '' } = {}) {
  const reviewerId = typeof reviewer === 'string' ? reviewer.trim() : ''
  if (!reviewerId) throw new Error('stampLicenseReview requires a reviewer id')
  const at = reviewedAt || new Date().toISOString()
  const license = normalizeLicense(entry?.license)
  return createCatalogEntry({
    ...entry,
    license: {
      ...license,
      status: approve ? 'approved' : 'review',
      reviewer: reviewerId,
      reviewedAt: at,
      proof: proof || license.proof,
      review: {
        decision: approve ? 'approved' : 'rejected',
        by: reviewerId,
        at,
        note: typeof note === 'string' ? note.slice(0, 512) : ''
      }
    }
  })
}
