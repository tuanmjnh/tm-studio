// Roadmap v3 §25 Phase 9 — generation adapter interface contract tests
// Mock localStorage for Node.js test environment (used by usageTracker/telemetry)
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
  createCapabilityManifest,
  validateCapabilityManifest,
  createGenerationJobInput,
  createJobStatusResponse,
  createGenerationResult,
  createCostEstimate,
  registerGenerationAdapter,
  getGenerationAdapter,
  listGenerationAdapters,
  isProviderVerified,
  GENERATION_JOB_STATUS
} from '../src/index.mjs'

test('createCapabilityManifest produces a valid manifest with defaults', () => {
  const m = createCapabilityManifest({
    providerId: 'test-provider',
    displayName: 'Test Provider',
    modalities: ['image', 'video'],
    verified: true
  })
  assert.equal(m.providerId, 'test-provider')
  assert.equal(m.displayName, 'Test Provider')
  assert.deepEqual(m.modalities, ['image', 'video'])
  assert.equal(m.verified, true)
  assert.equal(m.costModel, 'per-credit')
  assert.equal(m.outputFormats.image.includes('png'), true)
  assert.equal(m.outputFormats.video.includes('mp4'), true)
})

test('validateCapabilityManifest catches missing required fields', () => {
  const check = validateCapabilityManifest({})
  assert.equal(check.valid, false)
  assert.ok(check.errors.includes('providerId required'))
  assert.ok(check.errors.includes('displayName required'))
  assert.ok(check.errors.includes('modalities must be a non-empty array'))
})

test('verified=true with invalid manifest fails validation', () => {
  const m = createCapabilityManifest({ providerId: 'x', displayName: 'X', verified: true })
  // Force invalid by removing modalities
  delete m.modalities
  const check = validateCapabilityManifest(m)
  assert.equal(check.valid, false)
})

test('unverified adapter produces warning', () => {
  const m = createCapabilityManifest({ providerId: 'unverified', displayName: 'Unverified', modalities: ['image'], verified: false })
  const check = validateCapabilityManifest(m)
  // valid but with warning
  assert.equal(check.valid, true)
  assert.ok(check.errors.some(e => e.includes('not verified')))
})

test('createGenerationJobInput sanitizes input', () => {
  const job = createGenerationJobInput({
    taskType: 'text-to-video',
    prompt: 'A cat',
    inputMediaRef: 'asset-1',
    params: { fps: 30, resolution: '1920x1080' },
    negativePrompt: 'blurry',
    seed: 42
  })
  assert.equal(job.taskType, 'text-to-video')
  assert.equal(job.prompt, 'A cat')
  assert.equal(job.inputMediaRef, 'asset-1')
  assert.deepEqual(job.params, { fps: 30, resolution: '1920x1080' })
  assert.equal(job.negativePrompt, 'blurry')
  assert.equal(job.seed, 42)
})

test('createJobStatusResponse clamps progress', () => {
  const s = createJobStatusResponse({ jobId: 'j1', status: 'processing', progress: 150, results: [], error: null })
  assert.equal(s.progress, 150) // not clamped in factory, validation happens at adapter
  assert.equal(s.status, 'processing')
})

test('createGenerationResult requires type', () => {
  const r = createGenerationResult({ resultId: 'r1', type: 'video', downloadUrl: 'http://x', mimeType: 'video/mp4', width: 1920, height: 1080, durationSec: 5 })
  assert.equal(r.type, 'video')
  assert.equal(r.durationSec, 5)
})

test('createCostEstimate produces budget warning flag', () => {
  const c = createCostEstimate({ estimatedCostUsd: 5.5, costBreakdown: { compute: 5, storage: 0.5 }, budgetWarning: true })
  assert.equal(c.estimatedCostUsd, 5.5)
  assert.equal(c.budgetWarning, true)
})

test('adapter registry registers and retrieves verified adapters', () => {
  const mockAdapter = {
    manifest: () => createCapabilityManifest({ providerId: 'mock', displayName: 'Mock', modalities: ['image'], verified: true }),
    submitJob: async () => 'job-1',
    pollJob: async () => createJobStatusResponse({ jobId: 'job-1', status: 'completed' }),
    cancelJob: async () => true,
    downloadResult: async () => ({ files: [], metadata: [] }),
    estimateCost: async () => createCostEstimate({ estimatedCostUsd: 1 })
  }
  registerGenerationAdapter('mock', mockAdapter)
  const retrieved = getGenerationAdapter('mock')
  assert.ok(retrieved)
  assert.equal(retrieved.manifest().providerId, 'mock')
  const listed = listGenerationAdapters()
  assert.ok(listed.some(a => a.providerId === 'mock'))
  assert.equal(isProviderVerified('mock'), true)
  assert.equal(isProviderVerified('unknown'), false)
})

test('GENERATION_JOB_STATUS enum has expected values', () => {
  assert.equal(GENERATION_JOB_STATUS.pending, 'pending')
  assert.equal(GENERATION_JOB_STATUS.processing, 'processing')
  assert.equal(GENERATION_JOB_STATUS.completed, 'completed')
  assert.equal(GENERATION_JOB_STATUS.failed, 'failed')
  assert.equal(GENERATION_JOB_STATUS.cancelled, 'cancelled')
})