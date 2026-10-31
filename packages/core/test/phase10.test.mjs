// Roadmap v3 §26 Phase 10 — usage tracker, telemetry, crash recovery tests
// Mock localStorage for Node.js test environment
globalThis.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null },
  setItem(key, value) { this.store[key] = String(value) },
  removeItem(key) { delete this.store[key] },
  clear() { this.store = {} }
}

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  recordAiUsage,
  recordGenerationCost,
  recordAssetDownload,
  recordExport,
  getUsageSummary,
  checkLimit,
  resetUsageStore,
  exportUsageData,
  isTelemetryEnabled,
  setTelemetryEnabled,
  recordTelemetryEvent,
  getTelemetryEvents,
  clearTelemetryEvents,
  generateTelemetryReport,
  TELEMETRY_CATEGORIES,
  TELEMETRY_ACTIONS,
  checkpointRecovery,
  getLastCheckpoint,
  clearRecoveryCheckpoint,
  recordCrash,
  getCrashLog,
  clearCrashLog,
  runHealthChecks,
  generateSupportBundle,
  getRecoveryManifest
} from '../src/index.mjs'

// ---- Usage Tracker ----

test('usage tracker: records AI tokens and summarizes by month', () => {
  resetUsageStore()
  recordAiUsage(1000, { provider: 'openai', model: 'gpt-4' })
  recordAiUsage(500, { provider: 'anthropic', model: 'claude-3' })
  const summary = getUsageSummary()
  assert.equal(summary.aiTokens, 1500)
  assert.equal(summary.byProvider.openai.tokens, 1000)
  assert.equal(summary.byProvider.anthropic.tokens, 500)
})

test('usage tracker: records generation cost', () => {
  resetUsageStore()
  recordGenerationCost(0.5, { provider: 'seedance' })
  recordGenerationCost(1.25, { provider: 'seedance' })
  const summary = getUsageSummary()
  assert.equal(summary.generationCostUsd, 1.75)
  assert.equal(summary.byProvider.seedance.costUsd, 1.75)
})

test('usage tracker: records asset downloads in GB', () => {
  resetUsageStore()
  recordAssetDownload(2_000_000_000) // 2 GB
  recordAssetDownload(3_000_000_000) // 3 GB
  const summary = getUsageSummary()
  assert.equal(summary.assetDownloadGb, 5) // 5 GB
})

test('usage tracker: checkLimit enforces generation cost limit', () => {
  resetUsageStore()
  recordGenerationCost(12, { provider: 'test' }) // exceeds default 10
  const check = checkLimit('generation-cost')
  assert.equal(check.allowed, false)
  assert.equal(check.reason, 'generation-cost-limit')
})

test('usage tracker: checkLimit warns at 90% for AI tokens', () => {
  resetUsageStore()
  recordAiUsage(950_000) // 95% of 1M default
  const check = checkLimit('ai-tokens')
  assert.equal(check.allowed, false)
  assert.equal(check.reason, 'ai-tokens-near-limit')
})

test('usage tracker: exportUsageData returns raw store', () => {
  resetUsageStore()
  recordAiUsage(100)
  const data = exportUsageData()
  const key = Object.keys(data)[0]
  assert.ok(key)
  assert.equal(data[key].aiTokens, 100)
})

// ---- Telemetry ----

test('telemetry: disabled by default, events not recorded', () => {
  setTelemetryEnabled(false)
  clearTelemetryEvents()
  recordTelemetryEvent('editor', 'clip-add', { clipCount: 1 })
  const events = getTelemetryEvents()
  assert.equal(events.length, 0)
})

test('telemetry: enabled records sanitized events', () => {
  setTelemetryEnabled(true)
  clearTelemetryEvents()
  recordTelemetryEvent('editor', 'clip-add', { clipCount: 5, durationMs: 123.456, secret: 'should-not-appear' })
  const events = getTelemetryEvents()
  assert.equal(events.length, 1)
  assert.equal(events[0].category, 'editor')
  assert.equal(events[0].action, 'clip-add')
  assert.equal(events[0].metadata.clipCount, 5)
  assert.equal(events[0].metadata.durationMs, 123.456)
  assert.equal(events[0].metadata.secret, undefined)
})

test('telemetry: generateTelemetryReport includes summary', () => {
  setTelemetryEnabled(true)
  clearTelemetryEvents()
  recordTelemetryEvent('editor', 'clip-add', {})
  recordTelemetryEvent('editor', 'clip-add', {})
  recordTelemetryEvent('export', 'render-complete', {})
  const report = generateTelemetryReport('1.0.0')
  assert.equal(report.appVersion, '1.0.0')
  assert.equal(report.eventCount, 3)
  assert.equal(report.summary['editor:clip-add'], 2)
  assert.equal(report.summary['export:render-complete'], 1)
})

test('telemetry: TELEMETRY_CATEGORIES and ACTIONS are defined', () => {
  assert.ok(TELEMETRY_CATEGORIES.editor)
  assert.ok(TELEMETRY_ACTIONS.editor.includes('clip-add'))
})

// ---- Crash Recovery ----

test('crash recovery: checkpoint stores safe state', () => {
  clearRecoveryCheckpoint()
  checkpointRecovery({
    version: '1.0.0',
    projectId: 'proj-1',
    projectName: 'My Project',
    canvas: { width: 1920, height: 1080, fps: 30 },
    timelineDurationMs: 60000,
    trackCount: 3,
    clipCount: 12,
    unsavedChanges: true,
    lastAction: 'clip-add',
    activeTab: 'timeline',
    playheadPosition: 30000
  })
  const cp = getLastCheckpoint()
  assert.ok(cp)
  assert.equal(cp.projectId, 'proj-1')
  assert.equal(cp.unsavedChanges, true)
  assert.equal(cp.canvas.width, 1920)
})

test('crash recovery: clear removes checkpoint', () => {
  clearRecoveryCheckpoint()
  assert.equal(getLastCheckpoint(), null)
})

test('crash recovery: recordCrash sanitizes context', () => {
  clearCrashLog()
  const err = new Error('Test crash')
  err.stack = 'Error: Test crash\n    at test.js:1:1'
  recordCrash(err, {
    projectId: 'proj-1',
    canvasWidth: 1920,
    secretKey: 'should-not-appear',
    recentActions: ['clip-add', 'clip-move']
  })
  const crashes = getCrashLog()
  assert.equal(crashes.length, 1)
  assert.equal(crashes[0].message, 'Test crash')
  assert.ok(crashes[0].context.projectId)
  assert.ok(crashes[0].context.canvasWidth)
  assert.equal(crashes[0].context.secretKey, undefined)
})

test('crash recovery: getRecoveryManifest indicates recoverable', () => {
  clearRecoveryCheckpoint()
  checkpointRecovery({
    projectId: 'proj-1',
    projectName: 'Test',
    canvas: { width: 1920, height: 1080, fps: 30 },
    timelineDurationMs: 30000,
    trackCount: 2,
    clipCount: 5,
    unsavedChanges: true,
    lastAction: 'clip-add'
  })
  const manifest = getRecoveryManifest()
  assert.equal(manifest.hasCheckpoint, true)
  assert.equal(manifest.canRecover, true)
  assert.equal(manifest.projectName, 'Test')
  assert.equal(manifest.unsavedChanges, true)
})

test('crash recovery: old checkpoint not recoverable', () => {
  clearRecoveryCheckpoint()
  // Manually write an old checkpoint
  const old = {
    timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    projectName: 'Old',
    unsavedChanges: true
  }
  localStorage.setItem('tmcut.recovery.v1', JSON.stringify(old))
  const manifest = getRecoveryManifest()
  assert.equal(manifest.canRecover, false)
})

test('runHealthChecks returns check array with overall status', async () => {
  const result = await runHealthChecks()
  assert.ok(Array.isArray(result.checks))
  assert.ok(result.checks.length > 0)
  assert.ok(['ok', 'warn', 'fail'].includes(result.summary.overall))
})

test('generateSupportBundle produces anonymized bundle', () => {
  clearRecoveryCheckpoint()
  clearCrashLog()
  setTelemetryEnabled(false)
  const bundle = generateSupportBundle('1.0.0')
  assert.equal(bundle.appVersion, '1.0.0')
  assert.ok(bundle.generatedAt)
  assert.ok(bundle.checkpoint === null)
  assert.ok(Array.isArray(bundle.recentCrashes))
  assert.equal(bundle.telemetryEventCount, 0)
})