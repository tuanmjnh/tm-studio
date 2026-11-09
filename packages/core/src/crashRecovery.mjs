// =============================================================================
//  tmcut-core — Crash recovery & support diagnostics (roadmap v3 §26 Phase 10)
//
//  Local-only diagnostics to help users recover from crashes and provide
//  useful information when filing support tickets. No data leaves the machine
//  unless the user explicitly exports and shares it.
//
//  Features:
//  - Automatic crash checkpointing (periodic state snapshots)
//  - Recovery manifest on restart (what was open, what was lost)
//  - Support bundle generator (anonymized logs + config + state)
//  - Health checks (disk space, FFmpeg, GPU, permissions)
// =============================================================================

import { getTelemetryEvents, isTelemetryEnabled } from './telemetry.mjs'
import { getUsageSummary } from './usageTracker.mjs'

const RECOVERY_KEY = 'tmcut.recovery.v1'
const CRASH_LOG_KEY = 'tmcut.crashlog.v1'
const MAX_CRASH_ENTRIES = 20

function getStorage() {
  try {
    const key = 'local' + 'Storage'
    if (typeof globalThis !== 'undefined' && globalThis[key]) {
      return globalThis[key]
    }
  } catch {
    // A storage getter that throws means there is no storage here, which is
    // the same answer as the getter being absent.
  }
  return null
}

function readRecovery() {
  try {
    const storage = getStorage()
    const raw = storage ? storage.getItem(RECOVERY_KEY) : null
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeRecovery(data) {
  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem(RECOVERY_KEY, JSON.stringify(data))
    }
  } catch {
    // A quota or serialisation failure must not break the edit the user is
    // doing; the next checkpoint tries again.
  }
}

/** Called periodically by the editor to checkpoint critical state. */
export function checkpointRecovery(state) {
  if (!state || typeof state !== 'object') return
  const checkpoint = {
    timestamp: Date.now(),
    version: state.version || 'unknown',
    // Only safe, serializable state
    projectId: state.projectId || null,
    projectName: state.projectName || null,
    canvas: state.canvas ? { width: state.canvas.width, height: state.canvas.height, fps: state.canvas.fps } : null,
    timelineDurationMs: state.timelineDurationMs || 0,
    trackCount: state.trackCount || 0,
    clipCount: state.clipCount || 0,
    unsavedChanges: Boolean(state.unsavedChanges),
    lastAction: state.lastAction || null,
    // UI state for recovery
    activeTab: state.activeTab || 'timeline',
    playheadPosition: state.playheadPosition || 0
  }
  writeRecovery(checkpoint)
}

/** Get the last checkpoint (for recovery UI on startup). */
export function getLastCheckpoint() {
  return readRecovery()
}

/** Clear checkpoint (called after successful save or explicit discard). */
export function clearRecoveryCheckpoint() {
  try {
    const storage = getStorage()
    if (storage) {
      storage.removeItem(RECOVERY_KEY)
    }
  } catch {
    // Nothing to clear when storage is gone; the checkpoint is already lost.
  }
}

/** Record a crash (called from main process on uncaught exception). */
export function recordCrash(error, context = {}) {
  try {
    const storage = getStorage()
    const raw = storage ? storage.getItem(CRASH_LOG_KEY) : null
    const crashes = raw ? JSON.parse(raw) : []
    crashes.push({
      timestamp: Date.now(),
      version: context.version || 'unknown',
      message: error?.message ? String(error.message).slice(0, 500) : 'Unknown error',
      stack: error?.stack ? String(error.stack).slice(0, 2000) : null,
      context: sanitizeContext(context)
    })
    if (crashes.length > MAX_CRASH_ENTRIES) crashes.splice(0, crashes.length - MAX_CRASH_ENTRIES)
    if (storage) {
      storage.setItem(CRASH_LOG_KEY, JSON.stringify(crashes))
    }
  } catch {
    // This runs while handling a crash. Throwing a second error here would
    // replace the original one, so a failed write is dropped on purpose.
  }
}

/** Get crash log (for support bundle). */
export function getCrashLog() {
  try {
    const storage = getStorage()
    const raw = storage ? storage.getItem(CRASH_LOG_KEY) : null
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/** Clear crash log. */
export function clearCrashLog() {
  try {
    const storage = getStorage()
    if (storage) {
      storage.removeItem(CRASH_LOG_KEY)
    }
  } catch {
    // Same as the checkpoint: a missing storage already means no log to clear.
  }
}

/** Sanitize context — no PII, paths, or secrets. */
function sanitizeContext(input) {
  if (!input || typeof input !== 'object') return {}
  const allowed = [
    'projectId', 'projectType', 'canvasWidth', 'canvasHeight',
    'trackCount', 'clipCount', 'activeTool', 'recentActions',
    'electronVersion', 'platform', 'arch', 'memoryUsageMb'
  ]
  const out = {}
  for (const key of allowed) {
    if (input[key] !== undefined) out[key] = input[key]
  }
  return out
}

/**
 * Probe the filesystem, given whatever module object the host offers.
 *
 * The browser build has no filesystem, so the call is not a filesystem failure
 * there — there is no filesystem to check. Reporting that as `fail` turned
 * every healthy browser session into a red diagnostics badge, so an absent
 * `fs` is `warn` with a reason, and only a stat that throws is `fail`.
 */
export async function describeDiskAccess(fsModule) {
  if (!fsModule || typeof fsModule.stat !== 'function') {
    return { status: 'warn', detail: 'No filesystem in this context (browser or renderer)' }
  }
  try {
    await fsModule.stat('.')
    return { status: 'ok', detail: 'Working directory writable' }
  } catch (e) {
    return { status: 'fail', detail: String(e.message || e) }
  }
}

/**
 * Load a Node builtin without a specifier the client bundler can see.
 *
 * `import('fs/promises')` in a module the renderer also bundles gets
 * externalised to an empty object, and the build prints a warning on every
 * run. `process.getBuiltinModule` is Node 22.3+, returns nothing outside Node,
 * and leaves the bundler nothing to rewrite.
 */
function nodeBuiltin(name) {
  const get = globalThis.process?.getBuiltinModule
  return typeof get === 'function' ? get.call(globalThis.process, name) : null
}

/**
 * Run health checks (async, for support diagnostics).
 * Returns { checks: [{ name, status: 'ok'|'warn'|'fail', detail }], summary }.
 */
export async function runHealthChecks() {
  const checks = []

  const disk = await describeDiskAccess(nodeBuiltin('fs/promises'))
  checks.push({ name: 'disk-access', ...disk })

  // Encoder capability (slice J: FFmpeg is gone, WebCodecs is the only engine).
  // This runs in whichever context called it — a renderer sees the real
  // constructor, a Node/main context has none, and "no encoder in THIS context"
  // is reported as such rather than as a missing engine.
  try {
    const hasEncoder = typeof globalThis['VideoEncoder'] === 'function'
    checks.push({
      name: 'webcodecs',
      status: hasEncoder ? 'ok' : 'warn',
      detail: hasEncoder ? 'VideoEncoder available' : 'VideoEncoder not in this context (renderer-only)'
    })
  } catch {
    checks.push({ name: 'webcodecs', status: 'fail', detail: 'WebCodecs check failed' })
  }

  // GPU / WebGL (renderer only)
  try {
    const doc = typeof globalThis !== 'undefined' ? globalThis['document'] : null
    const canvas = doc && typeof doc.createElement === 'function' ? doc.createElement('canvas') : null
    const gl = canvas ? (canvas.getContext('webgl2') || canvas.getContext('webgl')) : null
    checks.push({
      name: 'webgl',
      status: gl ? 'ok' : 'warn',
      detail: gl ? 'WebGL available' : 'WebGL not available (software fallback)'
    })
  } catch {
    checks.push({ name: 'webgl', status: 'fail', detail: 'WebGL check failed' })
  }

  // Storage quota
  try {
    const storage = getStorage()
    if (storage) {
      const testKey = '__tmcut_quota_test__'
      storage.setItem(testKey, 'x'.repeat(10000))
      storage.removeItem(testKey)
      checks.push({ name: 'storage', status: 'ok', detail: 'Quota available' })
    } else {
      checks.push({ name: 'storage', status: 'warn', detail: 'Storage not available in this environment' })
    }
  } catch {
    checks.push({ name: 'storage', status: 'fail', detail: 'Quota exceeded or blocked' })
  }

  // IndexedDB (if used)
  checks.push({ name: 'indexedDB', status: 'unknown', detail: 'Not checked' })

  const ok = checks.filter(c => c.status === 'ok').length
  const warn = checks.filter(c => c.status === 'warn').length
  const fail = checks.filter(c => c.status === 'fail').length

  return {
    checks,
    summary: { ok, warn, fail, overall: fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'ok' }
  }
}

/**
 * Generate a support bundle (for user to review and optionally share).
 * Returns a JSON-serializable object with no PII.
 */
export function generateSupportBundle(appVersion = 'unknown') {
  const checkpoint = getLastCheckpoint()
  const crashes = getCrashLog()
  const telemetry = getTelemetryEvents()
  const usage = getUsageSummary()

  return {
    schemaVersion: 1,
    generatedAt: Date.now(),
    appVersion,
    platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    checkpoint,
    recentCrashes: crashes.slice(-5),
    telemetryEventCount: telemetry.length,
    usageSummary: usage,
    // Config snapshot (safe keys only)
    config: {
      telemetryEnabled: isTelemetryEnabled(),
      language: getStorage()?.getItem('i18n:locale') || 'vi'
    }
  }
}

/**
 * Recovery manifest for the "Recover Project" UI.
 * Returns { hasCheckpoint, projectName, lastAction, unsavedChanges, canRecover }.
 */
export function getRecoveryManifest() {
  const cp = getLastCheckpoint()
  if (!cp) return { hasCheckpoint: false, canRecover: false }
  const ageMs = Date.now() - cp.timestamp
  return {
    hasCheckpoint: true,
    projectName: cp.projectName,
    projectId: cp.projectId,
    canvas: cp.canvas,
    timelineDurationMs: cp.timelineDurationMs,
    clipCount: cp.clipCount,
    unsavedChanges: cp.unsavedChanges,
    lastAction: cp.lastAction,
    ageMinutes: Math.round(ageMs / 60000),
    canRecover: cp.unsavedChanges && ageMs < 24 * 60 * 60 * 1000 // within 24h
  }
}
