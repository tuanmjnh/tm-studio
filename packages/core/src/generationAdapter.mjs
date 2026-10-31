// =============================================================================
//  @tmcut/core — Generation adapter interface & capability manifest
//  (roadmap v3 §25 Phase 9)
//
//  This module defines the CONTRACT that any image/video generation provider
//  must fulfill to integrate with TMCut. It does NOT implement any provider.
//  Each provider gets its own adapter file (e.g. generationSeedance.mjs)
//  ONLY after its official API is verified per roadmap rule 12.
//
//  Current status (roadmap §25):
//  - Seedance 2.5: PLANNED — no verified supported API yet
//  - Google Flow: PLANNED — no verified supported API yet
//
//  Adapter shape (must be implemented by each provider):
//  - manifest(): capability metadata (cost, limits, formats, rights)
//  - submitJob(input): start async generation, return jobId
//  - pollJob(jobId): check status/progress
//  - cancelJob(jobId): cancel if supported
//  - downloadResult(jobId, destDir): fetch & probe result media
//  - estimateCost(input): cost preview before submit
//
//  All adapters are pure and dependency-free; the main process wraps them
//  with IPC, credentials, and the download queue (Asset Center).
// =============================================================================

const SUPPORTED_IMAGE_FORMATS = ['png', 'webp', 'jpg', 'jpeg']
const SUPPORTED_VIDEO_FORMATS = ['mp4', 'webm', 'mov']

/**
 * Capability manifest — returned by adapter.manifest().
 * The UI uses this to show what the provider can do, estimated cost,
 * and whether it respects the user's privacy/cost settings.
 */
export function createCapabilityManifest(input = {}) {
  return {
    schemaVersion: 1,
    providerId: String(input.providerId || '').toLowerCase(),
    displayName: String(input.displayName || ''),
    // 'image' | 'video' | 'both'
    modalities: Array.isArray(input.modalities) ? input.modalities.filter(m => ['image', 'video'].includes(m)) : [],
    // Extra non-modality capabilities (e.g. 'image-to-video', 'upscale').
    extraCapabilities: Array.isArray(input.extraCapabilities) ? input.extraCapabilities.map(String) : [],
    // MIME types the adapter can produce
    outputFormats: {
      image: Array.isArray(input.outputFormats?.image) ? input.outputFormats.image.filter(f => SUPPORTED_IMAGE_FORMATS.includes(f)) : ['png'],
      video: Array.isArray(input.outputFormats?.video) ? input.outputFormats.video.filter(f => SUPPORTED_VIDEO_FORMATS.includes(f)) : ['mp4']
    },
    // Max resolution per modality (pixels, e.g. 1920x1080)
    maxResolution: {
      image: input.maxResolution?.image || { width: 2048, height: 2048 },
      video: input.maxResolution?.video || { width: 1920, height: 1080 }
    },
    // Max duration for video (seconds)
    maxDurationSec: Number(input.maxDurationSec) || 10,
    // Whether the provider supports async job polling
    supportsAsync: Boolean(input.supportsAsync),
    // Whether the provider supports cancellation
    supportsCancel: Boolean(input.supportsCancel),
    // Whether the provider supports progress callbacks
    supportsProgress: Boolean(input.supportsProgress),
    // Cost model: 'per-second' | 'per-image' | 'per-credit' | 'subscription'
    costModel: ['per-second', 'per-image', 'per-credit', 'subscription'].includes(input.costModel)
      ? input.costModel
      : 'per-credit',
    // Estimated cost per unit (USD) — used for budget preview
    estimatedCostPerUnit: Number(input.estimatedCostPerUnit) || 0,
    // Cost unit: 'second' | 'image' | 'credit'
    costUnit: ['second', 'image', 'credit'].includes(input.costUnit) ? input.costUnit : 'credit',
    // Rights info for generated output
    rights: {
      // 'commercial' | 'personal' | 'restricted'
      commercialUse: Boolean(input.rights?.commercialUse),
      // Attribution required?
      attributionRequired: Boolean(input.rights?.attributionRequired),
      // License URL or name
      license: String(input.rights?.license || ''),
      // Whether output can be redistributed
      redistributable: Boolean(input.rights?.redistributable)
    },
    // Privacy: does the provider train on user data?
    privacy: {
      trainsOnUserData: Boolean(input.privacy?.trainsOnUserData),
      dataRetentionDays: Number(input.privacy?.dataRetentionDays) || 0,
      // 'none' | 'metadata' | 'full'
      loggingLevel: ['none', 'metadata', 'full'].includes(input.privacy?.loggingLevel)
        ? input.privacy.loggingLevel
        : 'metadata'
    },
    // Rate limits (requests per minute)
    rateLimitRpm: Number(input.rateLimitRpm) || 60,
    // Whether this adapter is verified against an official supported API
    verified: Boolean(input.verified)
  }
}

/**
 * Validate a capability manifest — used at adapter registration time.
 * Returns { valid: boolean, errors: string[] }.
 */
export function validateCapabilityManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object') return { valid: false, errors: ['manifest must be an object'] }
  if (!manifest.providerId) errors.push('providerId required')
  if (!manifest.displayName) errors.push('displayName required')
  if (!Array.isArray(manifest.modalities) || manifest.modalities.length === 0) {
    errors.push('modalities must be a non-empty array')
  }
  if (typeof manifest.verified !== 'boolean') errors.push('verified must be boolean')
  // "not verified" is a warning, not a validation error — it doesn't make the manifest invalid
  if (manifest.verified === false && manifest.providerId) {
    errors.push(`provider "${manifest.providerId}" is not verified against an official API`)
  }
  const blockingErrors = errors.filter(e => !e.includes('not verified'))
  return { valid: blockingErrors.length === 0, errors }
}

/**
 * Generation job status enum.
 */
export const GENERATION_JOB_STATUS = {
  pending: 'pending',       // submitted, not yet processing
  processing: 'processing', // actively generating
  completed: 'completed',   // result ready for download
  failed: 'failed',         // generation failed
  cancelled: 'cancelled'    // user cancelled
}

/**
 * Job input shape — provider-specific params go in `params`.
 * The adapter validates what it needs.
 */
export function createGenerationJobInput(input = {}) {
  return {
    // 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video'
    taskType: String(input.taskType || 'text-to-image'),
    // Prompt text (required for text-to-*)
    prompt: String(input.prompt || ''),
    // Optional input image/video reference (mediaRef from Asset Center)
    inputMediaRef: input.inputMediaRef || null,
    // Provider-specific parameters (resolution, fps, seed, model variant, etc.)
    params: input.params && typeof input.params === 'object' ? input.params : {},
    // Optional: negative prompt, style, etc.
    negativePrompt: String(input.negativePrompt || ''),
    // Optional: seed for reproducibility
    seed: input.seed !== undefined ? Number(input.seed) : null
  }
}

/**
 * Job status response — returned by pollJob().
 */
export function createJobStatusResponse(input = {}) {
  return {
    jobId: String(input.jobId || ''),
    status: GENERATION_JOB_STATUS[input.status] ? input.status : 'failed',
    progress: Number(input.progress) || 0, // 0..100
    // When completed: array of result objects
    results: Array.isArray(input.results) ? input.results : [],
    // When failed: error message
    error: input.error ? String(input.error) : null,
    // Estimated time remaining (seconds)
    etaSec: Number(input.etaSec) || null,
    // Cost incurred so far (USD)
    costSoFar: Number(input.costSoFar) || 0
  }
}

/**
 * Result item — returned in jobStatus.results when completed.
 * Each item must be downloadable via downloadResult().
 */
export function createGenerationResult(input = {}) {
  return {
    // Provider-specific result identifier
    resultId: String(input.resultId || ''),
    // 'image' | 'video'
    type: ['image', 'video'].includes(input.type) ? input.type : 'image',
    // Download URL (signed, time-limited)
    downloadUrl: String(input.downloadUrl || ''),
    // MIME type
    mimeType: String(input.mimeType || ''),
    // Dimensions
    width: Number(input.width) || 0,
    height: Number(input.height) || 0,
    // Duration for video (seconds)
    durationSec: Number(input.durationSec) || 0,
    // Estimated cost for this specific result
    cost: Number(input.cost) || 0,
    // Provider metadata (model version, seed used, etc.)
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {}
  }
}

/**
 * Cost estimate — returned by estimateCost().
 */
export function createCostEstimate(input = {}) {
  return {
    estimatedCostUsd: Number(input.estimatedCostUsd) || 0,
    costBreakdown: input.costBreakdown || {},
    // Whether this would exceed a typical budget threshold
    budgetWarning: Boolean(input.budgetWarning)
  }
}

/**
 * Adapter registry — maps providerId -> adapter module.
 * The main process populates this at startup (only verified adapters).
 */
const adapterRegistry = new Map()

export function registerGenerationAdapter(providerId, adapter) {
  if (!providerId || typeof providerId !== 'string') throw new Error('providerId required')
  if (!adapter || typeof adapter !== 'object') throw new Error('adapter must be an object')
  const required = ['manifest', 'submitJob', 'pollJob', 'downloadResult', 'estimateCost']
  for (const method of required) {
    if (typeof adapter[method] !== 'function') {
      throw new Error(`adapter missing required method: ${method}`)
    }
  }
  // Verify manifest at registration
  const manifest = adapter.manifest()
  const check = validateCapabilityManifest(manifest)
  if (!check.valid && manifest.verified) {
    throw new Error(`verified adapter has invalid manifest: ${check.errors.join('; ')}`)
  }
  adapterRegistry.set(providerId.toLowerCase(), adapter)
}

export function getGenerationAdapter(providerId) {
  return adapterRegistry.get(String(providerId).toLowerCase()) || null
}

export function listGenerationAdapters() {
  return [...adapterRegistry.entries()].map(([id, adapter]) => ({
    providerId: id,
    manifest: adapter.manifest()
  }))
}

/**
 * Check if a provider is verified and can be offered to the user.
 */
export function isProviderVerified(providerId) {
  const adapter = getGenerationAdapter(providerId)
  return adapter ? adapter.manifest().verified === true : false
}