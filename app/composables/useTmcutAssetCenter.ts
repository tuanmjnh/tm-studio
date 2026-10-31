// =============================================================================
//  TMCut — Asset Center orchestration (roadmap v3 PART A, Phase 2)
//
//  Renderer-side driver for the on-demand asset catalog. The pure state
//  machine (license gate, install transitions, bounded-retry queue, restart
//  recovery, storage report) lives in @tmcut/core (src/assetCenter.mjs);
//  this composable only adapts it to Vue reactivity + the Electron I/O
//  primitives (window.electronAPI.tmcut.assetCenter — see electron/tools/
//  asset-center.controller.cjs).
//
//  Lifecycle per entry (§5): catalog -> [license gate] -> download/sample
//  install (checksum verified main-side) -> installed (registry persisted)
//  -> apply into the editor -> usable offline. Unverified installs NEVER
//  reach 'installed'; a crash mid-flight recovers to 'catalog' on reload.
// =============================================================================
import { computed, ref } from 'vue'
import {
  canInstall,
  canServeAfterTakedown,
  createCatalogEntry,
  createDownloadQueue,
  createInstalledAsset,
  mergeTakedownRegistry,
  parseEntitlements,
  parseTakedownRegistry,
  recoverInstallStates,
  storageReport,
  takedownAudit,
  transitionInstall
} from '@tmcut-core'
import type { AssetCenterCatalogEntry, AssetCenterInstallState, TakedownNotice, TakedownRegistry } from '@tmcut-core'

type IpcAssetCenter = NonNullable<NonNullable<typeof window.electronAPI>['tmcut']>['assetCenter']

// Registry record shape (persisted through the controller's writeRegistry).
// Mirrors @tmcut-core createInstalledAsset; kept structural so the registry
// file stays runtime-agnostic JSON.
interface InstalledRecord {
  entryId: string
  version: string
  state: AssetCenterInstallState
  installedAt: string | null
  dir: string
  files: string[]
  sizeBytes: number
  verified: boolean
  /** Verified content hash (re-checked on reopen for missing-asset health). */
  sha256?: string
  reason?: string | null
}

export interface AssetJobView {
  entryId: string
  state: string
  percent: number
  loaded: number
  total: number
  reason: string | null
}

let ipcRef: IpcAssetCenter | null | undefined

function assetCenterIpc(): IpcAssetCenter | null {
  if (ipcRef === undefined) {
    ipcRef = window.electronAPI?.tmcut?.assetCenter ?? null
  }
  return ipcRef
}

// ----- Module-level singleton state (one catalog session per app run) ------

const catalogEntries = ref<AssetCenterCatalogEntry[]>([])
const installed = ref<InstalledRecord[]>([])
const catalogLoaded = ref(false)
const storageQuotaBytes = ref(0)
const progressTick = ref(0)

// Takedown & license audit (roadmap §26, local scope): notices arrive with
// the catalog payload and persist locally so offline runs keep enforcing
// them. A notice beats an approved license — installs are blocked and
// already-installed copies are surfaced for warn + optional uninstall.
// The user's own files are NEVER deleted silently.
const TAKEDOWN_LOCAL_KEY = 'tmcut.asset.takedown.v1'
const takedownRegistry = ref<TakedownRegistry>({ schemaVersion: 1, notices: [] })

function readTakedownLocal(): unknown {
  try {
    const raw = localStorage.getItem(TAKEDOWN_LOCAL_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function persistTakedownLocal() {
  try {
    localStorage.setItem(TAKEDOWN_LOCAL_KEY, JSON.stringify(takedownRegistry.value))
  } catch {
    // registry mirror is best-effort; core parse tolerates an empty store
  }
}

/** Active takedown notice for an entry right now, or null. */
function takedownFor(entryId: string): TakedownNotice | null {
  return canServeAfterTakedown(takedownRegistry.value, entryId).notice
}

/** Installed copies hit by an active notice — drives the warn banner. */
const takedownAffected = computed(() =>
  takedownAudit(installed.value as Array<{ entryId?: string, state?: string }>, takedownRegistry.value))

// Entitlements for paid assets (roadmap §26): grants ship with the catalog
// payload and persist locally so offline installs of already-purchased
// assets keep working. Users only store/check grants — never mint them.
const ENTITLEMENT_LOCAL_KEY = 'tmcut.asset.entitlements.v1'
const entitlements = ref(parseEntitlements(null))

function readEntitlementsLocal() {
  try {
    const raw = localStorage.getItem(ENTITLEMENT_LOCAL_KEY)
    return raw ? parseEntitlements(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function persistEntitlementsLocal() {
  try {
    localStorage.setItem(ENTITLEMENT_LOCAL_KEY, JSON.stringify(entitlements.value))
  } catch {
    // best-effort mirror
  }
}

/** Does this catalog entry currently have a live entitlement grant? */
function hasEntitlement(entryId: string, version = ''): boolean {
  const now = Date.now()
  const grants = entitlements.value
  return grants.some((g) => {
    if (g.entryId !== entryId) return false
    if (g.version && version && g.version !== version) return false
    if (g.expiresAt) {
      const exp = Date.parse(g.expiresAt)
      if (Number.isFinite(exp) && exp <= now) return false
    }
    return true
  })
}

// One queue for the whole session (bounded retries, concurrency 2). Paid
// entries re-check entitlements at enqueue time via the getter.
const queue = createDownloadQueue({
  concurrency: 2,
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  entitlements: () => entitlements.value
})
// jobId -> timestamp when the backoff was armed (retry re-claim timing).
const retryArmedAt = new Map<string, number>()
let pumpTimer: ReturnType<typeof setInterval> | null = null
let progressUnsub: (() => void) | null = null

function findRecord(entryId: string): InstalledRecord | undefined {
  return installed.value.find(r => r.entryId === entryId)
}

function findEntry(entryId: string): AssetCenterCatalogEntry | null {
  return catalogEntries.value.find(e => e.id === entryId) ?? null
}

function persistRegistry() {
  const ipc = assetCenterIpc()
  if (!ipc) return
  const plain = JSON.parse(JSON.stringify(installed.value))
  ipc.writeRegistry(plain).catch(() => {})
}

/** Reactive view of queue jobs (snapshot() re-read on every progress tick). */
const jobs = computed<AssetJobView[]>(() => {
  void progressTick.value
  return queue.snapshot().map(j => ({
    entryId: j.entryId,
    state: j.state,
    percent: j.progress.percent,
    loaded: j.progress.loaded,
    total: j.progress.total,
    reason: j.reason
  }))
})

const busy = computed(() => queue.pendingCount() > 0)

const storage = computed(() => storageReport(installed.value as never, {
  usedProjectIds: [],
  quotaBytes: storageQuotaBytes.value
}))

function fileNameFor(entry: AssetCenterCatalogEntry): string {
  if (entry.source.type === 'remote') {
    try {
      const pathname = new URL(entry.source.url).pathname
      return pathname.split('/').pop() || `${entry.id}.bin`
    } catch {
      return `${entry.id}.bin`
    }
  }
  return `${entry.id}-${entry.version}.bin`
}

/** Drive the queue: claim queued jobs and re-arm elapsed backoffs. */
function pump() {
  // Re-arm retries whose delay has elapsed.
  const now = Date.now()
  for (const job of queue.snapshot()) {
    if (job.state !== 'retrying') continue
    const armed = retryArmedAt.get(job.id)
    if (armed !== undefined && now - armed >= job.delayMs) {
      retryArmedAt.delete(job.id)
      const claimed = queue.armRetry(job.id)
      if (claimed) void runJob(claimed)
    }
  }
  // Claim fresh queued jobs while slots are free.
  for (;;) {
    const job = queue.startNext()
    if (!job) break
    void runJob(job)
  }
  progressTick.value += 1
  // Keep pumping while anything is pending (retry timers fire here too).
  if (queue.pendingCount() > 0 && !pumpTimer) {
    pumpTimer = setInterval(() => {
      if (queue.pendingCount() === 0 && pumpTimer) {
        clearInterval(pumpTimer)
        pumpTimer = null
        return
      }
      pump()
    }, 500)
  }
}

async function runJob(job: ReturnType<typeof queue.enqueue>) {
  const ipc = assetCenterIpc()
  const entry = findEntry(job.entryId)
  const record = findRecord(job.entryId)
  if (!ipc || !entry || !record) {
    queue.reportResult(job.id, { ok: false, error: 'internal', verified: false })
    return
  }
  transitionInstall(record as never, 'downloading')
  const filename = fileNameFor(entry)
  let result: Awaited<ReturnType<IpcAssetCenter['downloadPackage']>>
  if (entry.source.type === 'sample') {
    const src = await ipc.getSamplePath(entry.source.sampleId)
    if (!src) {
      result = { ok: false, reason: 'sample-missing' }
    } else {
      result = await ipc.installLocal({
        jobId: job.id,
        sourcePath: src,
        entryId: entry.id,
        version: entry.version,
        filename,
        expectSha256: entry.sha256
      })
    }
  } else if (entry.source.type === 'remote') {
    result = await ipc.downloadPackage({
      jobId: job.id,
      url: entry.source.url,
      entryId: entry.id,
      version: entry.version,
      filename,
      expectSha256: entry.sha256,
      expectBytes: entry.sizeBytes
    })
  } else {
    // Embedded sources never enter the queue (install() resolves them
    // inline) — reaching here means catalog/registry drift; fail cleanly.
    queue.reportResult(job.id, { ok: false, error: 'internal', verified: false })
    return
  }

  // The controller already enforced the checksum before committing, so an
  // ok result IS verified bytes (roadmap: validation before 'installed').
  const settled = queue.reportResult(job.id, {
    ok: result.ok,
    verified: result.ok,
    error: result.ok ? null : (result.reason || 'download-failed')
  })
  if (!settled) return

  if (settled.state === 'done') {
    transitionInstall(record as never, 'verifying')
    transitionInstall(record as never, 'installed', {
      installedAt: new Date().toISOString(),
      dir: result.path || '',
      files: [filename],
      sizeBytes: result.size ?? entry.sizeBytes,
      verified: true,
      sha256: result.sha256 || entry.sha256 || '',
      reason: null
    })
    persistRegistry()
  } else if (settled.state === 'retrying') {
    retryArmedAt.set(job.id, Date.now())
  } else if (settled.state === 'failed') {
    transitionInstall(record as never, 'error', { reason: settled.reason || 'failed' })
    persistRegistry()
  }
  progressTick.value += 1
}

async function load() {
  if (catalogLoaded.value) return
  const ipc = assetCenterIpc()
  if (!ipc) {
    // Web runtime has no asset store (no verified installs possible); the
    // panel renders a "desktop only" note instead of dead controls.
    catalogLoaded.value = true
    return
  }
  catalogLoaded.value = true

  const starter = await ipc.readStarterCatalog().catch(() => null)
  const cached = await ipc.readCatalogCache().catch(() => null)
  // Takedown notices ride the catalog payload (starter + cache) and the
  // local mirror; merge keeps the latest notice per entryId. Malformed
  // payloads parse to an empty registry (core guarantee) — never throws.
  let takedownState = parseTakedownRegistry(readTakedownLocal())
  for (const raw of [starter, cached]) {
    const notices = (raw as { takedowns?: unknown })?.takedowns
    if (Array.isArray(notices) && notices.length > 0) {
      takedownState = mergeTakedownRegistry(takedownState, { schemaVersion: 1, notices })
    }
  }
  takedownRegistry.value = takedownState
  persistTakedownLocal()
  const entriesOf = (raw: unknown): unknown[] => {
    const entries = (raw as { entries?: unknown })?.entries
    return Array.isArray(entries) ? entries : []
  }
  const seen = new Set<string>()
  const merged: AssetCenterCatalogEntry[] = []
  for (const raw of [...entriesOf(starter), ...entriesOf(cached)]) {
    const entry = createCatalogEntry(raw as Partial<AssetCenterCatalogEntry>)
    if (!entry.id || seen.has(entry.id)) continue
    seen.add(entry.id)
    merged.push(entry)
  }
  catalogEntries.value = merged

  // Entitlement grants ride the catalog payload too (paid assets). Merge
  // the local mirror + both catalog sources, keeping the latest grant per
  // (entryId, version). Users never mint grants; only the publisher does.
  const localGrants = readEntitlementsLocal()
  const grants = [...localGrants]
  for (const raw of [starter, cached]) {
    const fromCatalog = parseEntitlements((raw as { entitlements?: unknown })?.entitlements)
    for (const g of fromCatalog) {
      if (grants.some(x => x.entryId === g.entryId && x.version === g.version)) continue
      grants.push(g)
    }
  }
  entitlements.value = grants
  persistEntitlementsLocal()

  const registry = await ipc.readRegistry().catch(() => [])
  // On-disk JSON is untrusted input: coerce every record's fields, and any
  // state outside the lifecycle set back to 'catalog' before recovery.
  const VALID_STATES: AssetCenterInstallState[] = ['catalog', 'downloading', 'verifying', 'installed', 'error']
  const records = (Array.isArray(registry) ? registry : []) as Array<Partial<InstalledRecord>>
  installed.value = recoverInstallStates(
    records.filter(r => r && typeof r.entryId === 'string' && r.entryId)
      .map(r => ({ ...r, state: VALID_STATES.includes((r.state || 'catalog') as AssetCenterInstallState) ? r.state as AssetCenterInstallState : 'catalog' })) as InstalledRecord[]
  ) as InstalledRecord[]
  persistRegistry()

  progressUnsub = ipc.onProgress((payload) => {
    queue.reportProgress(payload.jobId, payload.loaded, payload.total)
    progressTick.value += 1
  })
  pump()
}

function dispose() {
  progressUnsub?.()
  progressUnsub = null
  if (pumpTimer) {
    clearInterval(pumpTimer)
    pumpTimer = null
  }
}

/**
 * Request an install (roadmap lifecycle: rights + entitlement checked
 * BEFORE anything is queued). Embedded payloads install instantly (no
 * bytes); sample/remote entries go through the verified queue.
 */
async function install(entryId: string): Promise<{ ok: boolean, reason?: string }> {
  const entry = findEntry(entryId)
  if (!entry) return { ok: false, reason: 'unknown-entry' }
  // Notice beats license: a live takedown blocks install even when the
  // license still reads 'approved' (roadmap §26 takedown gate).
  const takedown = canServeAfterTakedown(takedownRegistry.value, entryId)
  if (!takedown.allowed) return { ok: false, reason: 'takedown' }
  const gate = canInstall(entry, { now: Date.now(), entitlements: entitlements.value })
  if (!gate.allowed) return { ok: false, reason: gate.reason || 'blocked' }
  if (findRecord(entryId)?.state === 'installed') return { ok: true }

  if (entry.source.type === 'embedded') {
    installed.value.unshift(createInstalledAsset({
      entryId: entry.id,
      version: entry.version,
      installedAt: new Date().toISOString(),
      dir: '',
      files: [],
      sizeBytes: 0,
      verified: true
    }) as never)
    persistRegistry()
    return { ok: true }
  }

  let record = findRecord(entryId)
  if (!record) {
    record = createInstalledAsset({ entryId: entry.id, version: entry.version, state: 'catalog' } as never) as never
    installed.value.unshift(record)
  }
  queue.enqueue(entry as never)
  persistRegistry()
  pump()
  return { ok: true }
}

/** Re-queue a failed/rolled-back install (missing-asset recovery path). */
async function retry(entryId: string) {
  const record = findRecord(entryId)
  if (record && record.state !== 'installed') {
    transitionInstall(record as never, 'catalog')
    record.reason = null
    persistRegistry()
  }
  return install(entryId)
}

/** Cancel an in-flight job for an entry (queued or downloading). */
function cancel(entryId: string) {
  const job = queue.snapshot().find(j => j.entryId === entryId && ['queued', 'active', 'retrying'].includes(j.state))
  if (!job) return
  const ipc = assetCenterIpc()
  if (ipc && job.state === 'active') ipc.cancelDownload(job.id).catch(() => {})
  queue.cancel(job.id)
  retryArmedAt.delete(job.id)
  const record = findRecord(entryId)
  if (record && record.state !== 'installed') {
    record.state = 'catalog'
    persistRegistry()
  }
  progressTick.value += 1
}

async function uninstall(entryId: string) {
  const record = findRecord(entryId)
  if (!record) return
  const ipc = assetCenterIpc()
  if (ipc && record.dir) {
    await ipc.removePackageDir({ entryId: record.entryId, version: record.version }).catch(() => null)
  }
  const idx = installed.value.findIndex(r => r.entryId === entryId)
  if (idx !== -1) installed.value.splice(idx, 1)
  persistRegistry()
}

/**
 * Re-hash an installed package file and report health (missing-asset
 * detection on reopen). Returns true when the file is present + matches.
 */
async function verify(entryId: string): Promise<boolean> {
  const ipc = assetCenterIpc()
  const record = findRecord(entryId)
  if (!ipc || !record || !record.dir) return record?.state === 'installed'
  const filename = record.files[0]
  if (!filename) return true
  const res = await ipc.verifyFile({
    entryId: record.entryId,
    version: record.version,
    filename,
    expectSha256: record.sha256 || undefined
  }).catch(() => null)
  const ok = !!res?.ok
  if (!ok) {
    record.state = 'error'
    record.reason = 'missing'
    persistRegistry()
  }
  return ok
}

/** Verify every installed package once (called on editor mount). */
async function verifyAll() {
  for (const record of [...installed.value]) {
    if (record.state === 'installed' && record.dir) await verify(record.entryId)
  }
}

/** The installed local file path of a media asset (for library import). */
function installedFilePath(entryId: string): string | null {
  const record = findRecord(entryId)
  return record?.state === 'installed' && record.dir ? record.dir : null
}

/** The embedded payload of an installed preset, or null. */
function installedPayload(entryId: string): Record<string, unknown> | null {
  const entry = findEntry(entryId)
  if (!entry || entry.source.type !== 'embedded') return null
  return (entry.source.payload as Record<string, unknown>) ?? null
}

export function useTmcutAssetCenter() {
  return {
    catalogEntries,
    installed,
    catalogLoaded,
    jobs,
    busy,
    storage,
    load,
    dispose,
    install,
    retry,
    cancel,
    uninstall,
    verify,
    verifyAll,
    installedFilePath,
    installedPayload,
    findEntry,
    findRecord: (entryId: string) => findRecord(entryId),
    takedownRegistry,
    takedownAffected,
    takedownFor,
    entitlements,
    hasEntitlement,
    canInstallEntry: (entryId: string) => {
      const entry = findEntry(entryId)
      if (!entry) return { allowed: false, reason: 'unknown-entry' }
      const takedownNotice = canServeAfterTakedown(takedownRegistry.value, entryId)
      if (!takedownNotice.allowed) return { allowed: false, reason: 'takedown' }
      return canInstall(entry, { now: Date.now(), entitlements: entitlements.value })
    }
  }
}
