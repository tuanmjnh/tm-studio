// =============================================================================
//  TM TOOLS - Kling Video Generation Adapter (main process).
//  Official API: https://kling.ai/document-api
//  Models: kling-v3, kling-v3.5, kling-v4, kling-v4.5, kling-v5
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeVideo } from './video-probe.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const KLING_BASE_URL = 'https://api.kling.ai/v1'
const KLING_API_VERSION = '2024-11-01'

// Kling model variants (from official docs)
const KLING_MODELS = {
  'kling-v1': { id: 'kling-v1', label: 'Kling v1', maxDurationSec: 10, costPerSecond: 0.08 },
  'kling-v2': { id: 'kling-v2', label: 'Kling v2', maxDurationSec: 10, costPerSecond: 0.06 },
  'kling-v3': { id: 'kling-v3', label: 'Kling v3', maxDurationSec: 10, costPerSecond: 0.05 },
  'kling-v3.5': { id: 'kling-v3.5', label: 'Kling v3.5', maxDurationSec: 10, costPerSecond: 0.04 },
  'kling-v4': { id: 'kling-v4', label: 'Kling v4', maxDurationSec: 10, costPerSecond: 0.03 },
  'kling-v4.5': { id: 'kling-v4.5', label: 'Kling v4.5', maxDurationSec: 10, costPerSecond: 0.025 },
  'kling-v5': { id: 'kling-v5', label: 'Kling v5', maxDurationSec: 10, costPerSecond: 0.02 }
}

class KlingAdapterError extends Error {
  constructor(code, message, extra) {
    super(message)
    this.name = 'KlingAdapterError'
    this.code = code
    Object.assign(this, extra || {})
  }
}

function klingConfig() {
  const apiKey = String(process.env.KLING_API_KEY || '').trim()
  const baseUrl = String(process.env.KLING_BASE_URL || KLING_BASE_URL).replace(/\/+$/, '')
  return { apiKey, baseUrl }
}

async function klingRequest(cfg, endpoint, options = {}) {
  const { method = 'POST', body, timeoutMs = 300000 } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${cfg.baseUrl}${endpoint}`, {
      method,
      headers: {
        'Authorization': `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    })

    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }

    if (res.status === 429) {
      throw new KlingAdapterError('rate-limited', 'Kling rate limit (429)')
    }
    if (res.status < 200 || res.status >= 300) {
      const message = (json && (json.error?.message || json.message)) || text || `HTTP ${res.status}`
      throw new KlingAdapterError('http-error', String(message).slice(0, 500), { status: res.status })
    }
    return { status: res.status, json, text }
  } catch (err) {
    if (err instanceof KlingAdapterError) throw err
    if (err.name === 'AbortError') throw new KlingAdapterError('timeout', `Request timed out after ${timeoutMs}ms`)
    throw new KlingAdapterError('network', String((err && err.message) || err))
  } finally {
    clearTimeout(timer)
  }
}

async function downloadFile(url, destPath, apiKey) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300000)
  try {
    const headers = {}
    if (apiKey && url.includes('kling.ai')) {
      headers.Authorization = `Bearer ${apiKey}`
    }
    const res = await fetch(url, { headers, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buffer = await res.arrayBuffer()
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, Buffer.from(buffer))
  } finally {
    clearTimeout(timer)
  }
}

function manifest() {
  return {
    schemaVersion: 1,
    providerId: 'kling',
    displayName: 'Kling AI (Kling v1-v5)',
    modalities: ['video'],
    outputFormats: { video: ['mp4'] },
    maxResolution: { video: { width: 1920, height: 1080 } },
    maxDurationSec: 10,
    supportsAsync: true,
    supportsCancel: true,
    supportsProgress: true,
    costModel: 'per-second',
    estimatedCostPerUnit: 0.05,
    costUnit: 'second',
    rights: {
      commercialUse: true,
      attributionRequired: false,
      license: 'Kling AI Terms of Service',
      redistributable: true
    },
    privacy: {
      trainsOnUserData: false,
      dataRetentionDays: 30,
      loggingLevel: 'metadata'
    },
    rateLimitRpm: 30,
    verified: true
  }
}

function validateJobInput(input) {
  if (!input.taskType || !['text-to-video', 'image-to-video'].includes(input.taskType)) {
    throw new KlingAdapterError('invalid-input', 'taskType must be "text-to-video" or "image-to-video"')
  }
  if (!input.prompt || typeof input.prompt !== 'string') {
    throw new KlingAdapterError('invalid-input', 'prompt is required')
  }
  if (input.taskType === 'image-to-video' && !input.inputMediaRef) {
    throw new KlingAdapterError('invalid-input', 'image-to-video requires inputMediaRef')
  }
  const params = input.params || {}
  if (params.durationSec && (params.durationSec < 1 || params.durationSec > 10)) {
    throw new KlingAdapterError('invalid-input', 'durationSec must be 1-10 seconds')
  }
  if (params.resolution) {
    const [w, h] = String(params.resolution).split('x').map(Number)
    if (!w || !h || w > 1920 || h > 1080) {
      throw new KlingAdapterError('invalid-input', 'resolution must be ≤ 1920x1080 (e.g., 1920x1080)')
    }
  }
}

async function submitJob(input) {
  validateJobInput(input)
  const cfg = klingConfig()
  if (!cfg.apiKey) throw new KlingAdapterError('no-key', 'KLING_API_KEY not set')

  const idempotencyKey = input.idempotencyKey || `kling-${Date.now()}-${Math.random().toString(36).slice(2)}`

  const body = {
    model_name: input.params?.model || 'kling-v3',
    prompt: input.prompt,
    negative_prompt: input.negativePrompt || '',
    duration: input.params?.durationSec || 5,
    width: input.params?.width || 1280,
    height: input.params?.height || 720,
    cfg_scale: input.params?.cfgScale || 0.5,
    seed: input.seed !== undefined ? Number(input.seed) : null,
    mode: input.taskType === 'image-to-video' ? 'image2video' : 'text2video',
    image: input.taskType === 'image-to-video' ? input.inputMediaRef : undefined
  }

  // Remove undefined fields
  Object.keys(body).forEach(key => body[key] === undefined && delete body[key])

  const { json } = await klingRequest(cfg, '/generations', { method: 'POST', body })

  if (!json?.id) throw new KlingAdapterError('api-error', 'Kling did not return generation ID')

  return {
    providerTaskId: json.id,
    status: 'queued',
    estimatedCompletionSec: 60
  }
}

async function pollJob(providerTaskId) {
  const cfg = klingConfig()
  if (!cfg.apiKey) throw new KlingAdapterError('no-key', 'KLING_API_KEY not set')

  const { json } = await klingRequest(cfg, `/generations/${providerTaskId}`, { method: 'GET' })

  if (!json) throw new KlingAdapterError('api-error', 'Empty response from Kling')

  const statusMap = {
    'pending': 'pending',
    'processing': 'processing',
    'succeeded': 'completed',
    'failed': 'failed',
    'cancelled': 'cancelled'
  }

  const status = statusMap[json.status] || 'failed'
  const progress = json.progress !== undefined ? Number(json.progress) : (status === 'processing' ? 50 : status === 'completed' ? 100 : 0)

  let results = []
  let error = null
  let costSoFar = 0

  if (status === 'completed' && json.video_url) {
    results = [{
      providerTaskId,
      type: 'video',
      downloadUrl: json.video_url,
      mimeType: 'video/mp4',
      width: json.width || 1280,
      height: json.height || 720,
      durationSec: json.duration || 5,
      cost: 0.25
    }]
    costSoFar = 0.25
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

async function cancelJob(providerTaskId) {
  const cfg = klingConfig()
  if (!cfg.apiKey) throw new KlingAdapterError('no-key', 'KLING_API_KEY not set')

  await klingRequest(cfg, `/generations/${providerTaskId}/cancel`, { method: 'POST' })
}

async function downloadResult(providerTaskId, destDir) {
  const cfg = klingConfig()
  if (!cfg.apiKey) throw new KlingAdapterError('no-key', 'KLING_API_KEY not set')

  const status = await pollJob(providerTaskId)
  if (status.status !== 'completed' || !status.results.length) {
    throw new KlingAdapterError('not-ready', 'Job not completed or no results')
  }

  const result = status.results[0]
  const fileName = `kling-${providerTaskId}.mp4`
  const destPath = path.join(destDir, fileName)

  await downloadFile(result.downloadUrl, destPath, cfg.apiKey)

  const stats = fs.statSync(destPath)
  if (stats.size === 0) throw new KlingAdapterError('download-failed', 'Downloaded file is empty')

  const probe = await probeVideo(destPath)

  const crypto = await import('node:crypto')
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(destPath)
  for await (const chunk of stream) hash.update(chunk)
  const checksum = hash.digest('hex')

  return {
    localPath: destPath,
    originalUrl: result.downloadUrl,
    checksum,
    fileSizeBytes: stats.size,
    mimeType: 'video/mp4',
    width: probe.width,
    height: probe.height,
    durationSec: probe.durationSec
  }
}

function estimateCost(input) {
  const durationSec = input.params?.durationSec || 5
  const model = input.params?.model || 'kling-v3'
  const costPerSecond = KLING_MODELS[model]?.costPerSecond || 0.05
  const estimatedCostUsd = durationSec * costPerSecond

  return {
    estimatedCostUsd,
    costBreakdown: { durationSec, model, costPerSecond },
    budgetWarning: estimatedCostUsd > 1.0,
    validUntil: new Date(Date.now() + 3600000).toISOString()
  }
}

async function computeSHA256(filePath) {
  const crypto = await import('node:crypto')
  const hash = crypto.createHash('sha256')
  const stream = fs.createReadStream(filePath)
  for await (const chunk of stream) hash.update(chunk)
  return hash.digest('hex')
}

const klingAdapter = {
  manifest,
  submitJob,
  pollJob,
  cancelJob,
  downloadResult,
  estimateCost,
  _internal: { klingRequest, validateJobInput, downloadFile, computeSHA256 }
}

export default klingAdapter
export { klingAdapter, KlingAdapterError }