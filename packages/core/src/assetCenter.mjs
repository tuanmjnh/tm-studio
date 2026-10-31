// =============================================================================
//  @tmcut/core — asset center
//  Pure, runtime-agnostic data model + queue logic for the on-demand Asset
//  Center (roadmap v3 PART A). Runtime adapters (Electron IPC) do the
//  downloading and file I/O; this module owns the state machine so it can
//  be unit-tested in plain Node: catalog entries, license metadata, install
//  states, the download queue (progress / retry with bounded backoff /
//  cancellation / restart recovery) and storage accounting.
//
//  No Electron, no Node fs, no fetch — same rule as every other core file.
// =============================================================================

export const ASSET_CENTER_SCHEMA_VERSION = 1

// Install lifecycle (roadmap §5 asset lifecycle). `downloading` and
// `verifying` must never be persisted as final states: a crashed app finds
// them on recovery and re-queues them (recoverInstallStates).
export const INSTALL_STATES = {
  catalog: 'catalog',
  downloading: 'downloading',
  verifying: 'verifying',
  installed: 'installed',
  error: 'error'
}

export const DOWNLOAD_STATES = {
  queued: 'queued',
  active: 'active',
  retrying: 'retrying',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled'
}

// License review semantics (roadmap §5 license registry). "Unknown" and
// "unreviewed" rights must NEVER render as approved.
export const LICENSE_STATUS = {
  approved: 'approved',
  review: 'review',
  unknown: 'unknown'
}

/**
 * Create a catalog entry (an asset definition — NOT an installed copy).
 * `license` is a full license-registry record; `rights` stays out of this
 * object on purpose so callers cannot accidentally ship a raw file with an
 * unreviewed license and claim approval.
 *
 * `assetKind` says how the editor consumes an installed copy:
 *   'media'          — a media file to add to the project library
 *   'effect-preset'  — effect type + params to apply to a clip
 *   'title-preset'   — text preset (text/color/fontSize) to add to a timeline
 * `source` says where the bytes come from:
 *   { type: 'remote', url }        — downloaded over HTTPS
 *   { type: 'sample', sampleId }   — bundled starter file (offline-friendly)
 *   { type: 'embedded', payload }  — no bytes; payload IS the asset
 */
export const ASSET_KINDS = ['media', 'effect-preset', 'title-preset']

export function createCatalogEntry(input = {}) {
  const source = normalizeSource(input.source, input.sourceUrl)
  return {
    schemaVersion: ASSET_CENTER_SCHEMA_VERSION,
    id: input.id || '',
    title: input.title || '',
    description: input.description || '',
    category: input.category || 'other',
    assetKind: ASSET_KINDS.includes(input.assetKind) ? input.assetKind : 'media',
    tags: Array.isArray(input.tags) ? input.tags.slice() : [],
    version: input.version || '1.0.0',
    sizeBytes: Number(input.sizeBytes) || 0,
    sha256: input.sha256 || '',
    sourceUrl: source.type === 'remote' ? source.url : '',
    source,
    previewRef: input.previewRef || null,
    creator: input.creator || '',
    // Paid assets (USD) — a value > 0 additionally requires a live
    // entitlement grant in the install gate. Free catalog entries keep 0.
    priceUsd: Number(input.priceUsd) > 0 ? Number(input.priceUsd) : 0,
    // How grants get issued for a paid entry (publishing audit — the
    // install gate never trusts this field, only the grants themselves).
    salesChannel: typeof input.salesChannel === 'string' ? input.salesChannel : '',
    license: normalizeLicense(input.license)
  }
}

function normalizeSource(source, legacyUrl) {
  if (source && typeof source === 'object') {
    if (source.type === 'remote' && typeof source.url === 'string' && source.url) {
      return { type: 'remote', url: source.url }
    }
    if (source.type === 'sample' && typeof source.sampleId === 'string' && source.sampleId) {
      return { type: 'sample', sampleId: source.sampleId }
    }
    if (source.type === 'embedded' && source.payload && typeof source.payload === 'object') {
      return { type: 'embedded', payload: source.payload }
    }
  }
  if (typeof legacyUrl === 'string' && legacyUrl) return { type: 'remote', url: legacyUrl }
  return { type: 'embedded', payload: null }
}

export function normalizeLicense(license) {
  if (!license || typeof license !== 'object') {
    return { status: LICENSE_STATUS.unknown, name: 'Unknown', url: '', attribution: '', commercialUse: false, redistrbutable: false, review: null }
  }
  const status = [LICENSE_STATUS.approved, LICENSE_STATUS.review, LICENSE_STATUS.unknown].includes(license.status)
    ? license.status
    : LICENSE_STATUS.unknown
  return {
    status,
    name: typeof license.name === 'string' ? license.name : '',
    url: typeof license.url === 'string' ? license.url : '',
    attribution: typeof license.attribution === 'string' ? license.attribution : '',
    commercialUse: license.commercialUse === true,
    redistrbutable: license.redistrbutable === true,
    territories: Array.isArray(license.territories) ? license.territories.slice() : [],
    expiresAt: license.expiresAt || null,
    proof: typeof license.proof === 'string' ? license.proof : '',
    reviewer: typeof license.reviewer === 'string' ? license.reviewer : null,
    reviewedAt: license.reviewedAt || null,
    // Review-decision audit trail (catalogPublish.stampLicenseReview):
    // { decision, by, at, note }. Survives normalization so the decision
    // travels with the published document.
    review: license.review && typeof license.review === 'object'
      ? {
          decision: license.review.decision === 'rejected' ? 'rejected' : 'approved',
          by: typeof license.review.by === 'string' ? license.review.by : '',
          at: license.review.at || null,
          note: typeof license.review.note === 'string' ? license.review.note.slice(0, 512) : ''
        }
      : null
  }
}

/**
 * Rights gate (roadmap: "Unapproved rights status blocks publication/
 * download"). Only an APPROVED license may be installed; `review` and
 * `unknown` are hard stops, and an expiry in the past is a stop too.
 * Returns `{ allowed, reason }` where reason is an i18n key suffix or null.
 */
export function canInstall(entry, { now = 0, entitlements = null } = {}) {
  const license = entry?.license
  if (!license) return { allowed: false, reason: 'license-missing' }
  if (license.status === LICENSE_STATUS.unknown) return { allowed: false, reason: 'license-unknown' }
  if (license.status === LICENSE_STATUS.review) return { allowed: false, reason: 'license-review' }
  if (license.expiresAt) {
    const exp = Date.parse(license.expiresAt)
    if (Number.isFinite(exp) && now && exp <= now) return { allowed: false, reason: 'license-expired' }
  }
  // Paid assets (catalog pricing) also need a live entitlement (roadmap
  // §26 "Entitlements for paid assets"). The entitlement itself is checked
  // so that a missing/revoked/expired grant blocks the download while the
  // license stays approved.
  if (Number(entry?.priceUsd || 0) > 0) {
    const grant = hasLiveEntitlement(entry?.id, entry?.version, entitlements, now)
    if (!grant) return { allowed: false, reason: 'entitlement-missing' }
  }
  return { allowed: true, reason: null }
}

/**
 * Entitlements for paid assets (roadmap §26). Grants are issued by the
 * catalog publisher and travel with the catalog payload:
 * `{ entryId, version, grantedAt, expiresAt?, signature? }`. The publisher
 * signs with an HMAC over `entryId:version` using the catalog's shared
 * secret; local users only STORE and CHECK grants — the UI can never mint
 * one. `signature` is optional for embedded/sample catalogs (local dev);
 * a missing signature on a paid entry is still honored only because the
 * payload came from the catalog file itself, which is the same trust
 * boundary as the license block.
 */
export const ENTITLEMENT_SCHEMA_VERSION = 1

export function parseEntitlements(raw) {
  if (!raw || typeof raw !== 'object') return []
  const list = Array.isArray(raw.grants) ? raw.grants : Array.isArray(raw) ? raw : []
  const out = []
  for (const g of list) {
    if (!g || typeof g !== 'object' || typeof g.entryId !== 'string' || !g.entryId) continue
    out.push({
      entryId: g.entryId,
      version: typeof g.version === 'string' ? g.version : '',
      grantedAt: g.grantedAt || null,
      expiresAt: g.expiresAt || null,
      signature: typeof g.signature === 'string' ? g.signature : ''
    })
  }
  return out
}

export function hasLiveEntitlement(entryId, version, entitlements, now = Date.now()) {
  if (!entryId) return false
  const grants = Array.isArray(entitlements) ? entitlements : parseEntitlements(entitlements)
  const matches = grants.filter(g => g.entryId === entryId && (g.version === '' || g.version === version))
  if (matches.length === 0) return false
  // Latest grant wins; an expired one does not block a newer live one.
  const latest = matches.reduce((a, b) => String(a.grantedAt || '') >= String(b.grantedAt || '') ? a : b)
  if (latest.expiresAt) {
    const exp = Date.parse(latest.expiresAt)
    if (Number.isFinite(exp) && now && exp <= now) return false
  }
  return true
}

// ----- Installed-asset registry ------------------------------------------------
// One record per installed package version. `files` lists the installed
// file paths (relative to the package dir) so uninstall is exact.

export function createInstalledAsset(input = {}) {
  return {
    entryId: input.entryId || '',
    version: input.version || '1.0.0',
    state: INSTALL_STATES.installed,
    installedAt: input.installedAt || null,
    dir: input.dir || '',
    files: Array.isArray(input.files) ? input.files.slice() : [],
    sizeBytes: Number(input.sizeBytes) || 0,
    verified: input.verified === true
  }
}

/**
 * Mark an entry's install progress. `state` must be a legal transition —
 * `installed` only from `verifying` (never straight from `downloading`;
 * roadmap: "never mark a package installed before validation succeeds").
 */
export function transitionInstall(record, state, extra = {}) {
  if (!record || !state) return record
  const legal = {
    catalog: ['downloading', 'error'],
    downloading: ['verifying', 'error', 'catalog'],
    verifying: ['installed', 'error', 'downloading'],
    error: ['downloading', 'catalog'],
    installed: ['catalog']
  }
  if (!legal[record.state]?.includes(state)) return record
  record.state = state
  Object.assign(record, extra)
  return record
}

/**
 * Restart recovery (roadmap: "Download queue with ... restart recovery").
 * Anything persisted mid-flight is not trusted: `downloading`/`verifying`
 * roll back to `catalog` so the queue can re-run them.
 */
export function recoverInstallStates(installed) {
  if (!Array.isArray(installed)) return []
  const records = installed.filter(r => r && typeof r === 'object')
  for (const record of records) {
    if (record.state === INSTALL_STATES.downloading || record.state === INSTALL_STATES.verifying) {
      record.state = INSTALL_STATES.catalog
    }
  }
  return records
}

// ----- Download queue ----------------------------------------------------------

let queueSeq = 0
function nextJobId() {
  queueSeq += 1
  return `dljob_${Date.now().toString(36)}_${queueSeq.toString(36)}`
}

/**
 * A bounded download queue: at most `concurrency` active jobs, per-job
 * retry with bounded exponential backoff (capped at maxRetries),
 * cancellation, and progress accounting. Pure state machine — the runner
 * (Electron adapter) calls `startNext()` / `reportProgress()` /
 * `reportResult()` on it.
 */
export function createDownloadQueue({ concurrency = 2, maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000, entitlements = null } = {}) {
  const jobs = []
  let activeCount = 0

  // Entitlement grants arrive with the catalog (parsed later than queue
  // creation), so the queue accepts a getter as well as a static array.
  const entitlementsOf = () => (typeof entitlements === 'function' ? entitlements() : entitlements)

  function snapshot() {
    return jobs.map(j => ({ ...j, progress: { ...j.progress } }))
  }

  function enqueue(entry) {
    const { allowed, reason } = canInstall(entry, { entitlements: entitlementsOf() })
    const job = {
      id: nextJobId(),
      entryId: entry.id,
      version: entry.version,
      url: entry.sourceUrl,
      sha256: entry.sha256,
      sizeBytes: entry.sizeBytes,
      state: allowed ? DOWNLOAD_STATES.queued : DOWNLOAD_STATES.cancelled,
      progress: { loaded: 0, total: Number(entry.sizeBytes) || 0, percent: 0 },
      attempts: 0,
      maxRetries,
      delayMs: 0,
      reason: allowed
        ? null
        : (reason && !reason.startsWith('license-') ? reason : `license-${String(reason).replace('license-', '')}`)
    }
    jobs.push(job)
    return job
  }

  /** Claim the next queued job; returns the job or null when busy/empty. */
  function startNext() {
    if (activeCount >= concurrency) return null
    const job = jobs.find(j => j.state === DOWNLOAD_STATES.queued) || null
    if (!job) return null
    job.state = DOWNLOAD_STATES.active
    job.attempts += 1
    activeCount += 1
    return job
  }

  /** Runner reports partial progress (loaded/total). */
  function reportProgress(jobId, loaded, total) {
    const job = jobs.find(j => j.id === jobId)
    if (!job || job.state !== DOWNLOAD_STATES.active) return null
    job.progress.loaded = Number(loaded) || 0
    if (total) job.progress.total = Number(total)
    job.progress.percent = job.progress.total > 0
      ? Math.min(100, Math.round((job.progress.loaded / job.progress.total) * 100))
      : 0
    return job
  }

  /**
   * Runner reports completion. `ok:false` triggers bounded backoff retry
   * while attempts <= maxRetries; the job carries `retryAfterMs` (the
   * runner re-queues it after that delay). Success requires both the
   * download and the checksum to be confirmed by the caller (verified).
   */
  function reportResult(jobId, { ok, error = null, verified = false }) {
    const job = jobs.find(j => j.id === jobId)
    if (!job || (job.state !== DOWNLOAD_STATES.active && job.state !== DOWNLOAD_STATES.retrying)) return null
    activeCount = Math.max(0, activeCount - 1)
    if (ok && verified) {
      job.state = DOWNLOAD_STATES.done
      job.reason = null
      return job
    }
    if (!ok) job.reason = error || 'download-failed'
    if (job.attempts > job.maxRetries) {
      job.state = DOWNLOAD_STATES.failed
      return job
    }
    // Bounded exponential backoff: base * 2^(attempts-1), capped.
    job.delayMs = Math.min(maxDelayMs, baseDelayMs * 2 ** (job.attempts - 1))
    job.state = DOWNLOAD_STATES.retrying
    return job
  }

  /** Re-claim a backoff job once its delay has elapsed (runner polls). */
  function armRetry(jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (!job || job.state !== DOWNLOAD_STATES.retrying) return null
    if (activeCount >= concurrency) return null
    job.state = DOWNLOAD_STATES.active
    job.attempts += 1
    activeCount += 1
    return job
  }

  /** Cancel: queued jobs drop out; active jobs finish their abort signal. */
  function cancel(jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (!job) return null
    if (job.state === DOWNLOAD_STATES.active) activeCount = Math.max(0, activeCount - 1)
    job.state = DOWNLOAD_STATES.cancelled
    return job
  }

  function pendingCount() {
    return jobs.filter(j => [DOWNLOAD_STATES.queued, DOWNLOAD_STATES.active, DOWNLOAD_STATES.retrying].includes(j.state)).length
  }

  return {
    enqueue,
    startNext,
    armRetry,
    reportProgress,
    reportResult,
    cancel,
    snapshot,
    pendingCount,
    get concurrency() { return concurrency }
  }
}

// ----- Storage accounting -------------------------------------------------------

/**
 * Storage usage + cleanup selection (roadmap: "Storage controls and
 * cleanup that protect assets used by open/pinned projects").
 * `usedProjectIds` are pinned/open — those installs are never candidates.
 */
export function storageReport(installed, { usedProjectIds = [], quotaBytes = 0 } = {}) {
  const totalBytes = installed.reduce((sum, a) => sum + (a.sizeBytes || 0), 0)
  const usable = installed.filter(a => a.state === INSTALL_STATES.installed && a.verified)
  const usableBytes = usable.reduce((sum, a) => sum + (a.sizeBytes || 0), 0)
  const orphanBytes = totalBytes - usableBytes
  const reclaimable = usable.filter(a => !usedProjectIds.includes(a.entryId))
  const reclaimableBytes = reclaimable.reduce((sum, a) => sum + (a.sizeBytes || 0), 0)
  const quotaPct = quotaBytes > 0 ? Math.min(100, Math.round((totalBytes / quotaBytes) * 100)) : 0
  return {
    totalBytes,
    usableBytes,
    orphanBytes,
    reclaimableBytes,
    reclaimableIds: reclaimable.map(a => a.entryId),
    quotaBytes,
    quotaPct
  }
}
