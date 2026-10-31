// =============================================================================
//  @tmcut/core — Asset takedown & license audit (roadmap v3 §26, local scope)
//
//  The marketplace-side workflow (admin publishing, takedown authoring,
//  entitlements) lives on the control plane; what THIS app must do is obey
//  it honestly: a takedown notice arriving in the catalog update must
//  1. block any new install of the entry,
//  2. keep a license-audit trail (who/what/when/reason) in local storage,
//  3. warn the user about installed copies instead of silently deleting
//     them — a user's EXPORTED project may already contain the media, and
//     silently removing source files would break their work. The notice
//     says what to do; deletion stays a user decision (uninstall path).
//
//  Zero-dependency, pure. The registry is plain JSON:
//  { schemaVersion, notices: [{ entryId, reason, ref, issuedAt, effectiveFrom }] }
// =============================================================================

export const TAKEDOWN_SCHEMA_VERSION = 1

const REASONS = ['license-revoked', 'rights-claim', 'policy-violation', 'recall']

function cleanString(value, max = 256) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

/** Normalize one takedown notice; null when the notice is not usable. */
export function normalizeTakedownNotice(input) {
  if (!input || typeof input !== 'object') return null
  const entryId = cleanString(input.entryId, 128)
  if (!entryId) return null
  const rawIssued = input.issuedAt
  const rawEffective = input.effectiveFrom
  const issuedAt = (typeof rawIssued === 'number' ? rawIssued : Date.parse(rawIssued || '')) || Date.now()
  const effectiveFrom = (typeof rawEffective === 'number' ? rawEffective : Date.parse(rawEffective || '')) || issuedAt
  return {
    entryId,
    // Unknown reasons are kept (a notice the app does not recognize must
    // still block; inventing 'policy-violation' would misreport the cause).
    reason: REASONS.includes(input.reason) ? input.reason : 'policy-violation',
    ref: cleanString(input.ref, 512),
    issuedAt,
    effectiveFrom
  }
}

/** Parse a registry payload; anything malformed yields an empty registry. */
export function parseTakedownRegistry(raw) {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.notices)) {
    return { schemaVersion: TAKEDOWN_SCHEMA_VERSION, notices: [] }
  }
  const seen = new Set()
  const notices = []
  for (const item of parsed.notices) {
    const notice = normalizeTakedownNotice(item)
    if (!notice || seen.has(notice.entryId)) continue
    seen.add(notice.entryId)
    notices.push(notice)
  }
  return { schemaVersion: TAKEDOWN_SCHEMA_VERSION, notices }
}

/** Merge incoming notices (latest catalog update wins per entryId). */
export function mergeTakedownRegistry(registry, incoming) {
  const base = parseTakedownRegistry(registry)
  const extras = parseTakedownRegistry(incoming)
  const byEntry = new Map(base.notices.map(n => [n.entryId, n]))
  for (const notice of extras.notices) byEntry.set(notice.entryId, notice)
  return { schemaVersion: TAKEDOWN_SCHEMA_VERSION, notices: [...byEntry.values()] }
}

/** The live notice for an entry at `now`, or null (not taken down). */
export function findActiveTakedown(registry, entryId, now = Date.now()) {
  const parsed = parseTakedownRegistry(registry)
  const notice = parsed.notices.find(n => n.entryId === entryId)
  if (!notice) return null
  return notice.effectiveFrom <= now ? notice : null
}

/**
 * Rights gate v2: a takedown beats everything — even an approved license —
 * because the registry update is newer information about that license.
 * Compose with canInstall at the call site: takedown first, license second.
 */
export function canServeAfterTakedown(registry, entryId, { now = Date.now() } = {}) {
  const notice = findActiveTakedown(registry, entryId, now)
  if (notice) return { allowed: false, reason: `takedown-${notice.reason}`, notice }
  return { allowed: true, reason: null, notice: null }
}

/**
 * Audit view for installed records: which installs an active takedown
 * affects, so the UI can warn and offer uninstall. Nothing here deletes —
 * the caller decides (deletion stays a user action, see header).
 */
export function takedownAudit(installed, registry, { now = Date.now() } = {}) {
  const affected = []
  const records = Array.isArray(installed) ? installed : []
  for (const record of records) {
    const entryId = record?.entryId
    if (!entryId) continue
    const notice = findActiveTakedown(registry, entryId, now)
    if (notice) affected.push({ entryId, state: record.state || 'unknown', notice })
  }
  return affected
}
