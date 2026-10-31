// =============================================================================
//  TM TOOLS - Runway Video Generation Adapter (main process).
//
//  Implements the generationAdapter interface for Runway Gen-3 Alpha / Gen-3 Alpha Turbo.
//  Official API: https://dev.runwayml.com/docs/api-reference
//  - Text-to-video, image-to-video, video-to-video
//  - Task management (submit/poll/cancel)
//  - Cost metadata, progress callbacks
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeVideo } from './video-probe.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const RUNWAY_BASE_URL = 'https://api.dev.runwayml.com/v1'
const RUNWAY_API_VERSION = '2024-11-06'

// Current Runway model variants (Gen-3 Alpha sunset Jul 30 2026 — https://docs.dev.runwayml.com/api-details/api_changelog/)
const RUNWAY_MODELS = {
  'gen4': { id: 'gen4', label: 'Gen-4', maxDurationSec: 10, costPerSecond: 0.05 },
  'gen4_turbo': { id: 'gen4_turbo', label: 'Gen-4 Turbo', maxDurationSec: 10, costPerSecond: 0.03 },
  'gen4.5': { id: 'gen4.5', label: 'Gen-4.5', maxDurationSec: 10, costPerSecond: 0.08 }
}

class RunwayAdapterError extends Error {
  constructor(code, message, extra) {
    super(message)
    this.name = 'RunwayAdapterError'
    this.code = code
    Object.assign(this, extra || {})
  }
}

/**
 * Build config from env (per-task slots: AI_PROVIDER_RUNWAY, AI_BASE_URL_RUNWAY, etc.)
 * But for video generation, we use a dedicated prefix: RUNWAY_API_KEY, RUNWAY_BASE_URL
 */
function runwayConfig() {
  const apiKey = String(process.env.RUNWAY_API_KEY || '').trim()
  const baseUrl = String(process.env.RUNWAY_BASE_URL || RUNWAY_BASE_URL).replace(/\/+$/, '')
  return { apiKey, baseUrl }
}

/**
 * Runway API request helper with auth and error handling
 */
async function runwayRequest(cfg, endpoint, options = {}) {
  const { method = 'POST', body, timeoutMs = 300000 } = options // 5 min default for video gen
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  
  try {
    const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': RUNWAY_API_VERSION
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })
    
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    
    if (res.status === 429) {
      throw new RunwayAdapterError('rate-limited', 'Runway rate limit (429)')
    }
    if (res.status < 200 || res.status >= 300) {
      const message = (json && (json.error?.message || json.message)) || text || `HTTP ${res.status}`
      throw new RunwayAdapterError('http-error', String(message).slice(0, 500), { status: res.status })
    }
    return { status: res.status, json, text }
  } catch (err) {
    if (err instanceof RunwayAdapterError) throw err
    if (err.name === 'AbortError') throw new RunwayAdapterError('timeout', `Request timed out after ${timeoutMs}ms`)
    throw new RunwayAdapterError('network', String((err && err.message) || err))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Download file from URL to local path
 */
async function downloadFile(url, destPath, apiKey) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300000) // 5 min
  try {
    const headers = {}
    // Only send Authorization header when fetching from Runway API directly,
    // not for presigned cloud storage URLs (S3/GCS reject requests with 400 if Auth header + signature query exist).
    if (apiKey && (url.includes('api.runwayml.com') || url.includes('api.dev.runwayml.com'))) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    const res = await fetch(url, {
      headers,
      signal: controller.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = await res.arrayBuffer()
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, Buffer.from(buffer))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Manifest - capability metadata for the UI
 */
function manifest() {
  return {
    schemaVersion: 1,
    providerId: 'runway',
    displayName: 'Runway Gen-4 / Gen-4 Turbo / Gen-4.5',
    modalities: ['video'],
    outputFormats: { video: ['mp4'] },
    maxResolution: { video: { width: 1280, height: 720 } },
    maxDurationSec: 10,
    supportsAsync: true,
    supportsCancel: true,
    supportsProgress: true,
    costModel: 'per-second',
    estimatedCostPerUnit: 0.05, // $0.05/second for Gen-4
    costUnit: 'second',
    rights: {
      commercialUse: true,
      attributionRequired: false,
      license: 'Runway Terms of Service',
      redistributable: true
    },
    privacy: {
      trainsOnUserData: false,
      dataRetentionDays: 30,
      loggingLevel: 'metadata'
    },
    rateLimitRpm: 20,
    verified: false
  }
}

/**
 * Validate input for Runway job
 */
function validateJobInput(input) {
  if (!input.taskType || !['text-to-video', 'image-to-video'].includes(input.taskType)) {
    throw new RunwayAdapterError('invalid-input', 'taskType must be "text-to-video" or "image-to-video"')
  }
  if (!input.prompt || typeof input.prompt !== 'string') {
    throw new RunwayAdapterError('invalid-input', 'prompt is required')
  }
  if (input.taskType === 'image-to-video' && !input.inputMediaRef) {
    throw new RunwayAdapterError('invalid-input', 'image-to-video requires inputMediaRef')
  }
  const params = input.params || {}
  if (params.durationSec && (params.durationSec < 1 || params.durationSec > 10)) {
    throw new RunwayAdapterError('invalid-input', 'durationSec must be 1-10 seconds')
  }
  if (params.resolution) {
    const [w, h] = String(params.resolution).split('x').map(Number)
    if (!w || !h || w > 1280 || h > 720) {
      throw new RunwayAdapterError('invalid-input', 'resolution must be ≤ 1280x720 (e.g., 1280x720)')
    }
  }
}

/**
 * Submit a generation job to Runway
 */
async function submitJob(input) {
  validateJobInput(input)
  const cfg = runwayConfig()
  if (!cfg.apiKey) throw new RunwayAdapterError('no-key', 'RUNWAY_API_KEY not set')
  
  const idempotencyKey = input.idempotencyKey || `runway-${Date.now()}-${Math.random().toString(36).slice(2)}`
  
  const body = {
    model: input.params?.model || 'gen4_turbo',
    prompt: input.prompt,
    negative_prompt: input.negativePrompt || '',
    duration: input.params?.durationSec || 5,
    width: input.params?.width || 1280,
    height: input.params?.height || 720,
    seed: input.seed !== undefined ? Number(input.seed) : null,
    callback_url: null // We'll poll instead of webhook for simplicity
  }
  
  if (input.taskType === 'image-to-video') {
    body.image = input.inputMediaRef // Runway expects the image URL or base64
  }
  
  const { json } = await runwayRequest(cfg, '/tasks', { method: 'POST', body })
  
  if (!json?.id) throw new RunwayAdapterError('api-error', 'Runway did not return task ID')
  
  return {
    providerTaskId: json.id,
    status: 'queued',
    estimatedCompletionSec: json.estimated_duration || 60
  }
}

/**
 * Poll job status from Runway
 */
async function pollJob(providerTaskId) {
  const cfg = runwayConfig()
  if (!cfg.apiKey) throw new RunwayAdapterError('no-key', 'RUNWAY_API_KEY not set')
  
  const { json } = await runwayRequest(cfg, `/tasks/${providerTaskId}`, { method: 'GET' })
  
  if (!json) throw new RunwayAdapterError('api-error', 'Empty response from Runway')
  
  const statusMap = {
    'PENDING': 'pending',
    'RUNNING': 'processing',
    'SUCCEEDED': 'completed',
    'FAILED': 'failed',
    'CANCELLED': 'cancelled'
  }
  
  const status = statusMap[json.status] || 'failed'
  const progress = json.progress !== undefined ? Number(json.progress) : (status === 'processing' ? 50 : status === 'completed' ? 100 : 0)
  
  let results = []
  let error = null
  let costSoFar = 0
  
  if (status === 'completed' && json.output) {
    const outputUrl = Array.isArray(json.output) ? json.output[0] : json.output
    results = [{
      providerTaskId,
      type: 'video',
      downloadUrl: outputUrl,
      mimeType: 'video/mp4',
      width: 1280,
      height: 720,
      durationSec: 10,
      cost: 0.50 // estimated
    }]
    costSoFar = 0.50
  } else if (status === 'failed') {
    error = { category: 'provider-error', message: json.error?.message || 'Generation failed', retryable: false }
  }
  
  return {
    providerTaskId,
    status,
    progress,
    results,
    error,
    costSoFar,
    etaSec: status === 'processing' ? 60 : null
  }
}

/**
 * Cancel a Runway job
 */
async function cancelJob(providerTaskId) {
  const cfg = runwayConfig()
  if (!cfg.apiKey) throw new RunwayAdapterError('no-key', 'RUNWAY_API_KEY not set')
  
  await runwayRequest(cfg, `/tasks/${providerTaskId}/cancel`, { method: 'POST' })
}

/**
 * Download result to local path
 */
async function downloadResult(providerTaskId, destDir) {
  const cfg = runwayConfig()
  if (!cfg.apiKey) throw new RunwayAdapterError('no-key', 'RUNWAY_API_KEY not set')
  
  const status = await pollJob(providerTaskId)
  if (status.status !== 'completed' || !status.results.length) {
    throw new RunwayAdapterError('not-ready', 'Job not completed or no results')
  }
  
  const result = status.results[0]
  const fileName = `runway-${providerTaskId}.mp4`
  const destPath = path.join(destDir, fileName)
  
  await downloadFile(result.downloadUrl, destPath, cfg.apiKey)
  
  // Verify download
  const stats = fs.statSync(destPath)
  if (stats.size === 0) throw new RunwayAdapterError('download-failed', 'Downloaded file is empty')
  
  // Probe video metadata (shared ffprobe wrapper, resolves bundled binary)
  const probe = await probeVideo(destPath)
  
  return {
    localPath: destPath,
    originalUrl: status.results[0].downloadUrl,
    checksum: await computeSHA256(destPath),
    fileSizeBytes: stats.size,
    mimeType: 'video/mp4',
    width: probe.width,
    height: probe.height,
    durationSec: probe.durationSec
  }
}

/**
 * Estimate cost for a generation job
 */
function estimateCost(input) {
  const durationSec = input.params?.durationSec || 5
  const model = input.params?.model || 'gen3a-turbo'
  const costPerSecond = RUNWAY_MODELS[model]?.costPerSecond || 0.03
  const estimatedCostUsd = durationSec * costPerSecond
  
  return {
    estimatedCostUsd,
    costBreakdown: { durationSec, model, costPerSecond },
    budgetWarning: estimatedCostUsd > 1.0,
    validUntil: new Date(Date.now() + 3600000).toISOString() // 1 hour
  }
}

/**
 * Compute SHA256 of file
 */
async function computeSHA256(filePath) {
  const crypto = await import('node:crypto')
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

const runwayAdapter = {
  manifest,
  submitJob,
  pollJob,
  cancelJob,
  downloadResult,
  estimateCost,
  // Internal for testing
  _internal: { runwayRequest, validateJobInput, downloadFile, computeSHA256 }
}

export default runwayAdapter
export { runwayAdapter, RunwayAdapterError }