// Roadmap v3 §26 Phase 10 — usage tracker, telemetry, crash recovery tests
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
  describeDiskAccess,
  generateSupportBundle,
  getRecoveryManifest
} from '../src/index.mjs'

// Mock localStorage for the Node test environment. The core reads storage
// lazily on each call, so installing it after the imports is enough.
globalThis.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null },
  setItem(key, value) { this.store[key] = String(value) },
  removeItem(key) { delete this.store[key] },
  clear() { this.store = {} }
}

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

test('usage tracker: records exports once per call', () => {
  resetUsageStore()
  recordExport({ durationSec: 12 })
  recordExport({ durationSec: 8 })
  assert.equal(getUsageSummary().exports, 2)
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
  assert.equal(isTelemetryEnabled(), false, 'consent must default to off')
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

test('runHealthChecks names the engine that exists, not the one slice I cut', async () => {
  const { checks } = await runHealthChecks()
  const names = checks.map(check => check.name)
  assert.ok(!names.includes('ffmpeg'), `diagnostics still probe a removed engine: ${names.join(', ')}`)
  assert.ok(names.includes('webcodecs'), `diagnostics do not report the encoder the app uses: ${names.join(', ')}`)
})

// A renderer has no `fs`, so the module handed to the probe has no `stat`.
// Calling it threw, the catch reported `fail`, and the Support panel in Settings
// showed a red `disk-access: fail` badge on every healthy browser and Electron
// renderer — a missing capability reported as a broken one, which is the
// opposite of what a diagnostic is for.
test('a missing filesystem is reported as not-applicable, never as fail', async () => {
  const browser = await describeDiskAccess({})
  assert.equal(browser.status, 'warn', 'a browser has no fs: warn, not fail')
  assert.doesNotMatch(browser.detail, /fail/i)
  assert.match(browser.detail, /not available|renderer|browser|no filesystem/i, 'the detail must say why, not just be quiet')

  const node = await describeDiskAccess({ stat: async () => ({}) })
  assert.equal(node.status, 'ok')

  const broken = await describeDiskAccess({
    stat: async () => {
      throw new Error('EACCES')
    }
  })
  assert.equal(broken.status, 'fail', 'a real filesystem error is still a failure')
  assert.match(broken.detail, /EACCES/)
})

test('generateSupportBundle produces anonymized bundle', () => {
  clearRecoveryCheckpoint()
  clearCrashLog()
  setTelemetryEnabled(false)
  clearTelemetryEvents()
  resetUsageStore()
  const bundle = generateSupportBundle('1.0.0')
  assert.equal(bundle.appVersion, '1.0.0')
  assert.ok(bundle.generatedAt)
  assert.ok(bundle.checkpoint === null)
  assert.ok(Array.isArray(bundle.recentCrashes))
  assert.equal(bundle.telemetryEventCount, 0)
})

// The bundle promised telemetry and usage but never imported the modules that
// hold them, so `typeof getTelemetryEvents === 'function'` was always false.
// Every bundle reported "0 events, no usage" no matter what the session had
// recorded — a support bundle that quietly lies is worse than one that is empty.
test('the support bundle reports the telemetry and usage that actually exist', () => {
  clearRecoveryCheckpoint()
  clearCrashLog()
  resetUsageStore()

  setTelemetryEnabled(true)
  recordTelemetryEvent('export', 'started', { durationMs: 1200 })
  recordTelemetryEvent('export', 'completed', { durationMs: 3400 })
  recordAiUsage(2500, { provider: 'openai', model: 'gpt-4' })

  const bundle = generateSupportBundle('1.0.0')

  assert.equal(bundle.telemetryEventCount, 2, 'the bundle must count the events the session recorded')
  assert.equal(bundle.config.telemetryEnabled, true, 'the bundle must report real consent, not a false default')
  assert.equal(bundle.usageSummary.aiTokens, 2500, 'the bundle must carry the usage summary, not an empty object')
  assert.equal(bundle.usageSummary.byProvider.openai.tokens, 2500)

  setTelemetryEnabled(false)
  clearTelemetryEvents()
  resetUsageStore()
})
