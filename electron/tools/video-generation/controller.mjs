// =============================================================================
//  TM TOOLS - Video Generation Controller (main process).
//
//  Registers generation adapters, exposes IPC for the Video Factory workflow.
//  Keys/credentials never leave this process; renderer only sees job IDs.
// =============================================================================

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import runwayAdapter from './runway-adapter.mjs'
import klingAdapter from './kling-adapter.mjs'

const require = createRequire(import.meta.url)
const { app, ipcMain } = require('electron')

import {
  registerGenerationAdapter,
  getGenerationAdapter,
  listGenerationAdapters,
  validateCapabilityManifest,
  createGenerationJobInput,
  createJobStatusResponse,
  createGenerationResult
} from '@tmcut/core/generationAdapter'

import {
  registerProviderAdapter,
  listProviderAdapters
} from '@tmcut/core/providerAdapter'

// Adapter registry lives in @tmcut-core/generationAdapter — adapters registered
// with registerGenerationAdapter() are retrievable with getGenerationAdapter().
// (The previous local Map was never populated, so getMainAdapter always returned
// null and every handler answered provider-gone.)
function registerAllAdapters() {
  // Register Runway adapter
  try {
    registerGenerationAdapter('runway', runwayAdapter)
    registerProviderAdapter('runway', runwayAdapter)
    console.log('[video-generation] Runway adapter registered')
  } catch (err) {
    console.warn('[video-generation] Failed to register Runway adapter:', err.message)
  }

  // Register Kling adapter
  try {
    registerGenerationAdapter('kling', klingAdapter)
    registerProviderAdapter('kling', klingAdapter)
    console.log('[video-generation] Kling adapter registered')
  } catch (err) {
    console.warn('[video-generation] Failed to register Kling adapter:', err.message)
  }

  // Future: registerLumaAdapter, registerVeoAdapter, etc.
}

function getMainAdapter(providerId) {
  return getGenerationAdapter(String(providerId).toLowerCase()) || null
}

// Job persistence (localStorage mirror in main process)
const JOB_STORE_KEY = 'tmcut_video_jobs_v1'
let jobStore = new Map()

function loadJobStore() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), JOB_STORE_KEY), 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      jobStore = new Map(parsed.map(j => [j.jobId, j]))
    }
  } catch { /* ignore */ }
}

function saveJobStore() {
  try {
    const data = [...jobStore.entries()]
    fs.writeFileSync(path.join(app.getPath('userData'), JOB_STORE_KEY), JSON.stringify(data))
  } catch { /* ignore */ }
}

function createJobRecord(input, providerId, providerTaskId) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const record = {
    jobId,
    providerId,
    providerTaskId,
    input,
    status: 'queued',
    progress: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: [],
    error: null,
    costSoFar: 0
  }
  jobStore.set(jobId, record)
  saveJobStore()
  return record
}

function updateJobRecord(jobId, patch) {
  const record = jobStore.get(jobId)
  if (!record) return null
  const updated = { ...record, ...patch, updatedAt: new Date().toISOString() }
  jobStore.set(jobId, updated)
  saveJobStore()
  return updated
}

function getJobRecord(jobId) {
  return jobStore.get(jobId) || null
}

function listJobRecords() {
  return [...jobStore.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

// Cost ledger persistence
const LEDGER_KEY = 'tmcut_usage_ledger_v1'
let usageLedger = []

function loadUsageLedger() {
  try {
    const raw = fs.readFileSync(path.join(app.getPath('userData'), LEDGER_KEY), 'utf8')
    usageLedger = JSON.parse(raw)
  } catch { /* ignore */ }
}

function saveUsageLedger() {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), LEDGER_KEY), JSON.stringify(usageLedger))
  } catch { /* ignore */ }
}

function recordUsage(entry) {
  usageLedger.push({ ...entry, at: new Date().toISOString() })
  saveUsageLedger()
}

/**
 * Register all IPC handlers for video generation
 */
function registerVideoGeneration() {
  loadJobStore()
  loadUsageLedger()
  registerAllAdapters()

  // List available providers (manifests), normalized for the renderer picker.
  ipcMain.handle('tools:video-generation:providers', async () => {
    const adapters = listGenerationAdapters()
    const data = adapters.map(({ providerId, manifest }) => ({
      id: providerId,
      label: manifest?.displayName || providerId,
      manifest
    }))
    return { ok: true, data }
  })

  // Get provider capabilities
  ipcMain.handle('tools:video-generation:provider:capabilities', async (_event, args) => {
    const { providerId } = args || {}
    const adapter = getMainAdapter(providerId)
    if (!adapter) return { ok: false, error: { code: 'not-found', message: `Provider ${providerId} not registered` } }
    return { ok: true, data: adapter.manifest() }
  })

  // Estimate cost for a generation job
  ipcMain.handle('tools:video-generation:estimate', async (_event, args) => {
    const { providerId, input } = args || {}
    const adapter = getMainAdapter(providerId)
    if (!adapter) return { ok: false, error: { code: 'not-found', message: `Provider ${providerId} not registered` } }
    try {
      const estimate = await adapter.estimateCost(input)
      return { ok: true, data: estimate }
    } catch (err) {
      return { ok: false, error: { code: err.code || 'estimate-failed', message: err.message } }
    }
  })

  // Submit a generation job
  ipcMain.handle('tools:video-generation:submit', async (_event, args) => {
    const { providerId, input, idempotencyKey } = args || {}
    const adapter = getMainAdapter(providerId)
    if (!adapter) return { ok: false, error: { code: 'not-found', message: `Provider ${providerId} not registered` } }
    try {
      const { providerTaskId, status, estimatedCompletionSec } = await adapter.submitJob(input)
      const job = createJobRecord(input, providerId, providerTaskId)
      return { ok: true, data: { jobId: job.jobId, providerTaskId, status, estimatedCompletionSec } }
    } catch (err) {
      return { ok: false, error: { code: err.code || 'submit-failed', message: err.message } }
    }
  })

  // Poll job status
  ipcMain.handle('tools:video-generation:poll', async (_event, args) => {
    const { jobId } = args || {}
    const job = jobStore.get(jobId)
    if (!job) return { ok: false, error: { code: 'not-found', message: `Job ${jobId} not found` } }
    const adapter = getMainAdapter(job.providerId)
    if (!adapter) return { ok: false, error: { code: 'provider-gone', message: `Provider ${job.providerId} no longer registered` } }
    try {
      const status = await adapter.pollJob(job.providerTaskId)
      const updated = updateJobRecord(jobId, {
        status: status.status,
        progress: status.progress,
        costSoFar: status.costSoFar,
        results: status.results,
        error: status.error,
        updatedAt: new Date().toISOString()
      })
      // Record usage if completed
      if (status.status === 'completed' && status.costSoFar > 0) {
        recordUsage({
          jobId: job.jobId,
          providerId: job.providerId,
          providerTaskId: job.providerTaskId,
          costUsd: status.costSoFar,
          action: 'generation-completed'
        })
      }
      return { ok: true, data: { ...updated, etaSec: status.etaSec } }
    } catch (err) {
      return { ok: false, error: { code: err.code || 'poll-failed', message: err.message } }
    }
  })

  // Cancel a job
  ipcMain.handle('tools:video-generation:cancel', async (_event, args) => {
    const { jobId } = args || {}
    const job = jobStore.get(jobId)
    if (!job) return { ok: false, error: { code: 'not-found', message: `Job ${jobId} not found` } }
    const adapter = getMainAdapter(job.providerId)
    if (!adapter || !adapter.cancelJob) return { ok: false, error: { code: 'not-supported', message: 'Provider does not support cancellation' } }
    try {
      await adapter.cancelJob(job.providerTaskId)
      updateJobRecord(jobId, { status: 'cancelled', updatedAt: new Date().toISOString() })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: { code: err.code || 'cancel-failed', message: err.message } }
    }
  })

  // Download result to Asset Center
  ipcMain.handle('tools:video-generation:download', async (_event, args) => {
    const { jobId, destDir } = args || {}
    const job = jobStore.get(jobId)
    if (!job) return { ok: false, error: { code: 'not-found', message: `Job ${jobId} not found` } }
    if (job.status !== 'completed') return { ok: false, error: { code: 'not-completed', message: 'Job not completed' } }
    const adapter = getMainAdapter(job.providerId)
    if (!adapter) return { ok: false, error: { code: 'provider-gone', message: `Provider ${job.providerId} no longer registered` } }
    try {
      // Default to <userData>/generated so renderer callers can leave it empty.
      const targetDir = destDir || path.join(app.getPath('userData'), 'generated')
      fs.mkdirSync(targetDir, { recursive: true })
      const asset = await adapter.downloadResult(job.providerTaskId, targetDir)
      // Record in Asset Center (placeholder - actual integration with asset-center.controller)
      return { ok: true, data: asset }
    } catch (err) {
      return { ok: false, error: { code: err.code || 'download-failed', message: err.message } }
    }
  })

  // List all jobs (for Video Factory queue UI)
  ipcMain.handle('tools:video-generation:jobs:list', async () => {
    return { ok: true, data: listJobRecords() }
  })

  // Get single job
  ipcMain.handle('tools:video-generation:jobs:get', async (_event, args) => {
    const { jobId } = args || {}
    const job = jobStore.get(jobId)
    if (!job) return { ok: false, error: { code: 'not-found', message: `Job ${jobId} not found` } }
    return { ok: true, data: job }
  })

  // Retry a failed job
  ipcMain.handle('tools:video-generation:jobs:retry', async (_event, args) => {
    const { jobId } = args || {}
    const job = jobStore.get(jobId)
    if (!job) return { ok: false, error: { code: 'not-found', message: `Job ${jobId} not found` } }
    if (job.status !== 'failed') return { ok: false, error: { code: 'invalid-state', message: 'Only failed jobs can be retried' } }
    const adapter = getMainAdapter(job.providerId)
    if (!adapter) return { ok: false, error: { code: 'provider-gone', message: `Provider ${job.providerId} no longer registered` } }
    try {
      const { providerTaskId, status, estimatedCompletionSec } = await adapter.submitJob(job.input)
      const newJob = createJobRecord(job.input, job.providerId, providerTaskId)
      // Archive old job
      updateJobRecord(jobId, { status: 'archived', updatedAt: new Date().toISOString() })
      return { ok: true, data: { jobId: newJob.jobId, providerTaskId, status, estimatedCompletionSec } }
    } catch (err) {
      return { ok: false, error: { code: err.code || 'retry-failed', message: err.message } }
    }
  })

  // Delete job
  ipcMain.handle('tools:video-generation:jobs:delete', async (_event, args) => {
    const { jobId } = args || {}
    if (!jobStore.has(jobId)) return { ok: false, error: { code: 'not-found', message: `Job ${jobId} not found` } }
    jobStore.delete(jobId)
    saveJobStore()
    return { ok: true }
  })

  // =========================================================================
  // Video Factory (Phase 7) — batch queue, items, assembly
  // =========================================================================

  // Estimate batch cost from template + records
  ipcMain.handle('tools:video-generation:factory:estimate', async (_event, args) => {
    const { templateId, templateVersion, records } = args || {}
    if (!templateId || !templateVersion || !Array.isArray(records)) {
      return { ok: false, error: { code: 'invalid-params', message: 'templateId, templateVersion, records[] required' } }
    }
    // Delegate to renderer via mcp:forward for preview (which uses useVideoFactory)
    // This handler returns a request to the renderer bridge
    return { ok: true, data: { mustForward: true, tool: 'factory.estimate_batch', params: args } }
  })

  // Create batch (after confirmed estimate)
  ipcMain.handle('tools:video-generation:factory:create', async (_event, args) => {
    const { templateId, templateVersion, records, confirmed, inputSource, runMode, providerId } = args || {}
    if (!templateId || !templateVersion || !Array.isArray(records)) {
      return { ok: false, error: { code: 'invalid-params', message: 'templateId, templateVersion, records[] required' } }
    }
    return { ok: true, data: { mustForward: true, tool: 'factory.create_batch', params: args } }
  })

  // Get batch with items + jobs
  ipcMain.handle('tools:video-generation:factory:get', async (_event, args) => {
    const { batchId } = args || {}
    if (!batchId) return { ok: false, error: { code: 'invalid-params', message: 'batchId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.get_batch', params: args } }
  })

  // Pause batch
  ipcMain.handle('tools:video-generation:factory:pause', async (_event, args) => {
    const { batchId } = args || {}
    if (!batchId) return { ok: false, error: { code: 'invalid-params', message: 'batchId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.pause_batch', params: args } }
  })

  // Resume batch
  ipcMain.handle('tools:video-generation:factory:resume', async (_event, args) => {
    const { batchId } = args || {}
    if (!batchId) return { ok: false, error: { code: 'invalid-params', message: 'batchId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.resume_batch', params: args } }
  })

  // Cancel batch
  ipcMain.handle('tools:video-generation:factory:cancel', async (_event, args) => {
    const { batchId } = args || {}
    if (!batchId) return { ok: false, error: { code: 'invalid-params', message: 'batchId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.cancel_batch', params: args } }
  })

  // Get generation job
  ipcMain.handle('tools:video-generation:factory:job:get', async (_event, args) => {
    const { jobId } = args || {}
    if (!jobId) return { ok: false, error: { code: 'invalid-params', message: 'jobId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.get_job', params: args } }
  })

  // Retry job
  ipcMain.handle('tools:video-generation:factory:job:retry', async (_event, args) => {
    const { jobId } = args || {}
    if (!jobId) return { ok: false, error: { code: 'invalid-params', message: 'jobId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.retry_job', params: args } }
  })

  // Assemble batch outputs
  ipcMain.handle('tools:video-generation:factory:assemble', async (_event, args) => {
    const { batchId } = args || {}
    if (!batchId) return { ok: false, error: { code: 'invalid-params', message: 'batchId required' } }
    return { ok: true, data: { mustForward: true, tool: 'factory.assemble_batch', params: args } }
  })

  // Get usage ledger
  ipcMain.handle('tools:video-generation:usage-ledger', async (_event, args) => {
    const { from, to, providerId } = args || {}
    let entries = usageLedger
    if (from) entries = entries.filter(e => new Date(e.at) >= new Date(from))
    if (to) entries = entries.filter(e => new Date(e.at) <= new Date(to))
    if (providerId) entries = entries.filter(e => e.providerId === providerId)
    const total = entries.reduce((sum, e) => sum + (e.costUsd || 0), 0)
    return { ok: true, data: { entries, totalCostUsd: total } }
  })

  // Cost report: aggregated summaries by provider / day / batch
  ipcMain.handle('tools:video-generation:cost-report', async (_event, args) => {
    const { from, to } = args || {}
    let entries = usageLedger
    if (from) entries = entries.filter(e => new Date(e.at) >= new Date(from))
    if (to) entries = entries.filter(e => new Date(e.at) <= new Date(to))

    // By provider
    const byProvider = {}
    for (const e of entries) {
      const pid = e.providerId || 'unknown'
      if (!byProvider[pid]) byProvider[pid] = { costUsd: 0, jobs: 0, actions: {} }
      byProvider[pid].costUsd += e.costUsd || 0
      byProvider[pid].jobs += e.action === 'generation-completed' ? 1 : 0
      const action = e.action || 'other'
      byProvider[pid].actions[action] = (byProvider[pid].actions[action] || 0) + 1
    }

    // By day (UTC)
    const byDay = {}
    for (const e of entries) {
      const day = (e.at || '').slice(0, 10)
      if (!byDay[day]) byDay[day] = { costUsd: 0, jobs: 0 }
      byDay[day].costUsd += e.costUsd || 0
      byDay[day].jobs += e.action === 'generation-completed' ? 1 : 0
    }

    const totalCostUsd = entries.reduce((sum, e) => sum + (e.costUsd || 0), 0)
    const totalJobs = entries.filter(e => e.action === 'generation-completed').length

    return { ok: true, data: { byProvider, byDay, totalCostUsd, totalJobs, entriesCount: entries.length } }
  })

  // Provider health check
  ipcMain.handle('tools:video-generation:provider:health', async (_event, args) => {
    const { providerId } = args || {}
    const adapter = getMainAdapter(providerId)
    if (!adapter) return { ok: false, error: { code: 'not-found', message: `Provider ${providerId} not registered` } }
    try {
      // Try a simple health check - list models or ping
      const health = await adapter._internal?.healthCheck?.() || { healthy: true }
      return { ok: true, data: { healthy: true, providerId, ...health } }
    } catch (err) {
      return { ok: true, data: { healthy: false, providerId, error: err.message } }
    }
  })

  console.log('[video-generation] IPC handlers registered')
}

export { registerVideoGeneration, getMainAdapter, registerAllAdapters }