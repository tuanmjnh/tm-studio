// =============================================================================
//  @tmcut/core — Video Provider Adapter Interface (Roadmap v1 §7, P7)
//  Pure ESM JavaScript with JSDoc type annotations
// =============================================================================

/**
 * @typedef {'video'|'image'|'audio'} VideoModality
 * @typedef {'pending'|'queued'|'processing'|'completed'|'failed'|'cancelled'} JobStatus
 * @typedef {'network'|'rate-limit'|'billing'|'invalid-prompt'|'auth'|'permission'|'provider-error'|'unknown'} ErrorCategory
 */

/**
 * @typedef {Object} ProviderManifest
 * @property {number} schemaVersion
 * @property {string} providerId
 * @property {string} displayName
 * @property {VideoModality[]} modalities
 * @property {Object.<VideoModality, string[]>} outputFormats
 * @property {Object.<VideoModality, {width: number, height: number}>} maxResolution
 * @property {number} maxDurationSec
 * @property {boolean} supportsAsync
 * @property {boolean} supportsCancel
 * @property {boolean} supportsProgress
 * @property {'per-second'|'per-credit'|'per-job'} costModel
 * @property {number} estimatedCostPerUnit
 * @property {string} costUnit
 * @property {Object} rights
 * @property {boolean} rights.commercialUse
 * @property {boolean} rights.attributionRequired
 * @property {string} rights.license
 * @property {boolean} rights.redistributable
 * @property {Object} privacy
 * @property {boolean} privacy.trainsOnUserData
 * @property {number} privacy.dataRetentionDays
 * @property {'none'|'metadata'|'full'} privacy.loggingLevel
 * @property {number} rateLimitRpm
 * @property {boolean} verified
 */

/**
 * @typedef {Object} GenerationJobInput
 * @property {string} [idempotencyKey]
 * @property {'text-to-video'|'image-to-video'|'video-to-video'} taskType
 * @property {string} prompt
 * @property {string} [negativePrompt]
 * @property {string} [inputMediaRef]
 * @property {Object} [params]
 * @property {number} [params.durationSec]
 * @property {number} [params.width]
 * @property {number} [params.height]
 * @property {string} [params.resolution]
 * @property {string} [params.model]
 * @property {number} [params.seed]
 * @property {string} [params.aspectRatio]
 * @property {number} [params.fps]
 * @property {number} [seed]
 * @property {string} [callbackUrl]
 * @property {Object} [providerOptions]
 */

/**
 * @typedef {Object} SubmitJobResult
 * @property {string} providerTaskId
 * @property {JobStatus} status
 * @property {number} estimatedCompletionSec
 */

/**
 * @typedef {Object} PollJobResult
 * @property {string} providerTaskId
 * @property {JobStatus} status
 * @property {number} progress
 * @property {GenerationResult[]} results
 * @property {Object|null} error
 * @property {ErrorCategory} error.category
 * @property {string} error.message
 * @property {boolean} error.retryable
 * @property {number} costSoFar
 * @property {number} [etaSec]
 */

/**
 * @typedef {Object} GenerationResult
 * @property {string} providerTaskId
 * @property {VideoModality} type
 * @property {string} downloadUrl
 * @property {string} mimeType
 * @property {number} width
 * @property {number} height
 * @property {number} durationSec
 * @property {number} cost
 */

/**
 * @typedef {Object} CostEstimate
 * @property {number} estimatedCostUsd
 * @property {Object} costBreakdown
 * @property {boolean} budgetWarning
 * @property {string} validUntil
 */

/**
 * @typedef {Object} DownloadResult
 * @property {string} localPath
 * @property {string} originalUrl
 * @property {string} checksum
 * @property {number} fileSizeBytes
 * @property {string} mimeType
 * @property {number} width
 * @property {number} height
 * @property {number} durationSec
 */

/**
 * @interface ProviderAdapter
 * @property {function(): ProviderManifest} manifest
 * @property {function(GenerationJobInput): Promise<SubmitJobResult>} submitJob
 * @property {function(string): Promise<PollJobResult>} pollJob
 * @property {function(string): Promise<void>} [cancelJob]
 * @property {function(string, string): Promise<DownloadResult>} downloadResult
 * @property {function(GenerationJobInput): CostEstimate} estimateCost
 * @property {Object} [_internal]
 */

const PROVIDER_ADAPTER_SCHEMA_VERSION = 1

/** @type {Map<string, ProviderAdapter>} */
const providerRegistry = new Map()

/**
 * @param {string} providerId
 * @param {ProviderAdapter} adapter
 */
function registerProviderAdapter(providerId, adapter) {
  const manifest = adapter.manifest()
  if (manifest.providerId !== providerId) {
    throw new Error(`Provider ID mismatch: registry key "${providerId}" vs manifest "${manifest.providerId}"`)
  }
  if (manifest.schemaVersion !== PROVIDER_ADAPTER_SCHEMA_VERSION) {
    throw new Error(`Provider ${providerId} schema version ${manifest.schemaVersion} != ${PROVIDER_ADAPTER_SCHEMA_VERSION}`)
  }
  providerRegistry.set(providerId, adapter)
}

/**
 * @param {string} providerId
 * @returns {ProviderAdapter|undefined}
 */
function getProviderAdapter(providerId) {
  return providerRegistry.get(providerId)
}

/**
 * @returns {ProviderManifest[]}
 */
function listProviderAdapters() {
  return Array.from(providerRegistry.values()).map(a => a.manifest())
}

/**
 * @param {string} providerId
 * @returns {boolean}
 */
function isProviderRegistered(providerId) {
  return providerRegistry.has(providerId)
}

/**
 * @param {string} providerId
 * @returns {ProviderManifest|undefined}
 */
function getProviderCapabilities(providerId) {
  const adapter = providerRegistry.get(providerId)
  return adapter?.manifest()
}

export {
  PROVIDER_ADAPTER_SCHEMA_VERSION,
  registerProviderAdapter,
  getProviderAdapter,
  listProviderAdapters,
  isProviderRegistered,
  getProviderCapabilities
}