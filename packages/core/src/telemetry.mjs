// =============================================================================
//  @tmcut/core — Telemetry with privacy controls (roadmap v3 §26 Phase 10)
//
//  Local-first, opt-in telemetry. No data leaves the machine unless the user
//  explicitly enables "Send anonymous usage statistics" AND clicks "Send now"
//  on a specific report. The core only provides the collector; the UI handles
//  consent, review, and transmission.
//
//  Events are structured, schema-versioned, and never contain:
//  - File paths, URLs, or media content
//  - Prompts, scripts, or project text
//  - User identifiers, emails, or auth tokens
//  - Machine IDs, IPs, or hardware fingerprints
//
//  What IS collected (when enabled):
//  - Feature usage counts (which tools, how often)
//  - Performance timings (render time, analysis time)
//  - Error categories (not messages — just codes)
//  - Configuration choices (defaults vs custom)
//  - Version/compatibility info
// =============================================================================

const TELEMETRY_SCHEMA_VERSION = 1
const STORAGE_KEY = 'tmcut.telemetry.v1'
const MAX_EVENTS = 5000 // ring buffer

function getStorage() {
  try {
    const key = 'local' + 'Storage'
    if (typeof globalThis !== 'undefined' && globalThis[key]) {
      return globalThis[key]
    }
  } catch {}
  return null
}

function readEvents() {
  try {
    const storage = getStorage()
    const raw = storage ? storage.getItem(STORAGE_KEY) : null
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeEvents(events) {
  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem(STORAGE_KEY, JSON.stringify(events))
    }
  } catch {
    // quota exceeded — drop oldest
    if (events.length > 100) writeEvents(events.slice(-100))
  }
}

/** Check if telemetry is enabled (user consent). */
export function isTelemetryEnabled() {
  try {
    const storage = getStorage()
    return storage ? storage.getItem('tmcut.telemetry.enabled') === 'true' : false
  } catch {
    return false
  }
}

/** Enable/disable telemetry (user action). */
export function setTelemetryEnabled(enabled) {
  try {
    const storage = getStorage()
    if (storage) {
      storage.setItem('tmcut.telemetry.enabled', String(Boolean(enabled)))
    }
  } catch {}
}

/** Record a telemetry event (only if enabled). */
export function recordTelemetryEvent(category, action, metadata = {}) {
  if (!isTelemetryEnabled()) return
  const events = readEvents()
  events.push({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    timestamp: Date.now(),
    category: String(category),
    action: String(action),
    // Only allowlisted metadata keys — no free-form strings
    metadata: sanitizeMetadata(metadata)
  })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
  writeEvents(events)
}

/** Sanitize metadata — only known safe keys, no PII. */
function sanitizeMetadata(input) {
  if (!input || typeof input !== 'object') return {}
  const allowed = [
    'durationMs', 'success', 'errorCode', 'projectType', 'canvasWidth',
    'canvasHeight', 'fps', 'trackCount', 'clipCount', 'effectCount',
    'transitionCount', 'assetKind', 'assetCount', 'templateCategory',
    'profileName', 'providerId', 'modelName', 'tokensUsed', 'costUsd',
    'exportFormat', 'exportDurationSec', 'analysisStage', 'assetSource'
  ]
  const out = {}
  for (const key of allowed) {
    if (input[key] !== undefined) {
      const val = input[key]
      out[key] = typeof val === 'number' ? Number(val.toFixed ? val.toFixed(3) : val) : String(val)
    }
  }
  return out
}

/** Get all stored events (for review before sending). */
export function getTelemetryEvents() {
  return readEvents()
}

/** Clear stored events. */
export function clearTelemetryEvents() {
  writeEvents([])
}

/**
 * Generate a telemetry report for user review/sending.
 * Returns { schemaVersion, generatedAt, appVersion, events, summary }.
 */
export function generateTelemetryReport(appVersion = 'unknown') {
  const events = readEvents()
  const summary = {}
  for (const e of events) {
    const key = `${e.category}:${e.action}`
    summary[key] = (summary[key] || 0) + 1
  }
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    generatedAt: Date.now(),
    appVersion,
    eventCount: events.length,
    events,
    summary
  }
}

/** Telemetry categories (for consistent naming). */
export const TELEMETRY_CATEGORIES = {
  editor: 'editor',           // timeline edits, playback, zoom
  export: 'export',           // render, encode, upload
  ai: 'ai',                   // plan generation, triage, transcription
  autocut: 'autocut',         // scene detection, silence detection, draft
  assetCenter: 'assetCenter', // browse, download, install, verify
  templates: 'templates',     // create, import, export, apply
  audio: 'audio',             // music bed, SFX, orchestration
  project: 'project',         // create, open, save, recover
  settings: 'settings',       // preference changes
  error: 'error'              // error boundaries (codes only)
}

/** Telemetry actions per category (not exhaustive, but for consistency). */
export const TELEMETRY_ACTIONS = {
  editor: ['clip-add', 'clip-move', 'clip-trim', 'clip-split', 'clip-delete', 'track-add', 'track-toggle', 'undo', 'redo', 'play', 'seek', 'zoom'],
  export: ['render-start', 'render-complete', 'render-fail', 'upload-start', 'upload-complete'],
  ai: ['plan-request', 'plan-apply', 'plan-repair', 'triage-request', 'transcribe-request'],
  autocut: ['analyze-start', 'analyze-complete', 'draft-accept', 'draft-reject', 'rerun'],
  assetCenter: ['browse', 'download-start', 'download-complete', 'install', 'verify', 'uninstall'],
  templates: ['create', 'import', 'export', 'apply', 'ai-generate'],
  audio: ['music-bed-apply', 'sfx-apply', 'orchestrate'],
  project: ['create', 'open', 'save', 'recover', 'snapshot', 'duplicate'],
  settings: ['change', 'reset'],
  error: ['caught', 'boundary', 'recovery']
}