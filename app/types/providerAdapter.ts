// =============================================================================
// Provider Adapter Contract — Roadmap v1 §7
// Standardized interface for all video/audio/image generation providers.
// =============================================================================

// -----------------------------------------------------------------------------
// Capabilities & Metadata
// -----------------------------------------------------------------------------

export interface ProviderCapabilities {
  providerKey: string
  displayName: string
  supportedTasks: ProviderTaskType[]
  supportedModels: ProviderModelInfo[]
  maxConcurrency: number
  rateLimitPerMinute: number
  supportsWebhook: boolean
  supportsCancel: boolean
  supportsSeed: boolean
  supportsNegativePrompt: boolean
  supportedResolutions: ResolutionInfo[]
  supportedAspectRatios: AspectRatio[]
  supportedDurations: DurationRange
  pricingModel: PricingModel
  regionAvailability: string[]
  termsOfServiceUrl?: string
  privacyPolicyUrl?: string
}

export type ProviderTaskType = 'video-gen' | 'image-gen' | 'text-to-speech' | 'speech-to-text' | 'music-gen' | 'script-gen'

export interface ProviderModelInfo {
  modelId: string
  displayName: string
  capabilities: ProviderTaskType[]
  maxResolution: { width: number; height: number }
  maxDurationSec: number
  costPerUnit: CostPerUnit
  isDefault: boolean
  isDeprecated: boolean
}

export type CostPerUnit = 
  | { type: 'per-second'; amountUsd: number; currency: string }
  | { type: 'per-frame'; amountUsd: number; currency: string }
  | { type: 'per-request'; amountUsd: number; currency: string }
  | { type: 'per-token'; amountUsd: number; currency: string; tokenType: 'prompt' | 'completion' }

export interface ResolutionInfo {
  width: number
  height: number
  label: string
}

export type AspectRatio = '9:16' | '16:9' | '1:1' | '4:5' | '21:9' | '4:3'

export interface DurationRange {
  minSec: number
  maxSec: number
  stepSec?: number
}

export interface PricingModel {
  type: 'pay-per-use' | 'subscription' | 'credits' | 'custom'
  currency: string
  estimatedCostPerSecondUsd?: number
  estimatedCostPerImageUsd?: number
  estimatedCostPer1kTokensUsd?: number
}

// -----------------------------------------------------------------------------
// Normalized Request/Response (Provider-agnostic)
// -----------------------------------------------------------------------------

export interface NormalizedVideoRequest {
  // Core
  prompt: string
  negativePrompt?: string
  seed?: number
  
  // Visual
  aspectRatio: AspectRatio
  resolution: { width: number; height: number }
  durationSec: number
  fps?: number
  
  // Input references
  inputImages?: MediaReference[]
  inputVideos?: MediaReference[]
  inputAudio?: MediaReference[]
  
  // Camera/Motion
  cameraMovement?: CameraMovement
  motionStrength?: number // 0-1
  
  // Audio generation
  audioMode?: 'none' | 'generate' | 'reference'
  voiceId?: string
  voiceSettings?: VoiceSettings
  musicSettings?: MusicSettings
  
  // Provider-specific extensions (schema validated)
  providerOptions?: Record<string, unknown>
  
  // Metadata
  idempotencyKey: string
  callbackUrl?: string
  metadata?: Record<string, unknown>
}

export interface MediaReference {
  url: string // R2/S3/https
  type: 'image' | 'video' | 'audio'
  purpose: 'reference' | 'style' | 'mask' | 'controlnet' | 'init'
  startTimeSec?: number
  endTimeSec?: number
}

export type CameraMovement = 
  | 'static' | 'pan-left' | 'pan-right' | 'tilt-up' | 'tilt-down' 
  | 'zoom-in' | 'zoom-out' | 'dolly-in' | 'dolly-out' 
  | 'tracking-left' | 'tracking-right' | 'orbit-left' | 'orbit-right'

export interface VoiceSettings {
  voiceId: string
  speed?: number // 0.5-2.0
  pitch?: number // -12 to +12 semitones
  volume?: number // 0-1
  stability?: number // 0-1
  similarityBoost?: number // 0-1
}

export interface MusicSettings {
  genre?: string[]
  mood?: string[]
  tempo?: number // BPM
  durationSec?: number
  loopable?: boolean
}

export interface NormalizedGenerationResult {
  providerTaskId: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  outputUrls: string[] // R2/S3 URLs (may be temporary)
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  fileSizeBytes?: number
  costUsd?: number
  tokensUsed?: { prompt: number; completion: number }
  providerMetadata: Record<string, unknown>
  completedAt?: string
  error?: {
    category: 'network' | 'rate-limit' | 'billing' | 'invalid-prompt' | 'provider-error' | 'unknown'
    message: string
    retryable: boolean
    retryAfterSec?: number
  }
}

export interface ProviderTaskStatus {
  providerTaskId: string
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'canceled'
  progress?: number // 0-1
  estimatedCompletionSec?: number
  outputUrls?: string[]
  error?: {
    category: 'network' | 'rate-limit' | 'billing' | 'invalid-prompt' | 'provider-error' | 'unknown'
    message: string
    retryable: boolean
    retryAfterSec?: number
  }
}

// -----------------------------------------------------------------------------
// Adapter Interface
// -----------------------------------------------------------------------------

export interface VideoProviderAdapter {
  // Metadata
  readonly providerKey: string
  readonly capabilities: ProviderCapabilities
  
  // Lifecycle
  initialize(config: ProviderConfig): Promise<void>
  shutdown(): Promise<void>
  healthCheck(): Promise<HealthCheckResult>
  
  // Cost estimation
  estimateCost(request: NormalizedVideoRequest): Promise<CostEstimate | null>
  
  // Job submission
  submitJob(request: NormalizedVideoRequest): Promise<SubmitResult>
  
  // Job management
  getJobStatus(providerTaskId: string): Promise<ProviderTaskStatus>
  cancelJob?(providerTaskId: string): Promise<void>
  
  // Result handling
  downloadResults(providerTaskId: string, outputDir: string): Promise<DownloadedAsset[]>
  normalizeResult(rawResponse: unknown): NormalizedGenerationResult
  
  // Webhook (optional)
  handleWebhook?(payload: unknown, headers: Record<string, string>): Promise<WebhookResult>
}

export interface ProviderConfig {
  providerKey: string
  baseUrl: string
  apiKey: string
  defaultModel: string
  options?: Record<string, unknown>
}

export interface HealthCheckResult {
  healthy: boolean
  latencyMs: number
  version?: string
  details?: Record<string, unknown>
}

export interface CostEstimate {
  estimatedCostUsd: number
  estimatedDurationSec: number
  breakdown: CostBreakdownItem[]
  confidence: 'high' | 'medium' | 'low'
  validUntil: string // ISO 8601
}

export interface CostBreakdownItem {
  component: string
  quantity: number
  unit: string
  unitCostUsd: number
  totalCostUsd: number
}

export interface SubmitResult {
  providerTaskId: string
  status: 'queued' | 'processing'
  estimatedCompletionSec?: number
}

export interface DownloadedAsset {
  localPath: string
  originalUrl: string
  checksum: string
  fileSizeBytes: number
  mimeType: string
}

export interface WebhookResult {
  providerTaskId: string
  status: 'completed' | 'failed'
  outputUrls?: string[]
  error?: { category: string; message: string }
}

// -----------------------------------------------------------------------------
// Provider Registry
// -----------------------------------------------------------------------------

export interface ProviderRegistry {
  register(adapter: VideoProviderAdapter): void
  unregister(providerKey: string): void
  get(providerKey: string): VideoProviderAdapter | undefined
  getAll(): VideoProviderAdapter[]
  getByCapability(taskType: ProviderTaskType): VideoProviderAdapter[]
}

// -----------------------------------------------------------------------------
// Connection Config (stored in TM Hub / local keystore)
// -----------------------------------------------------------------------------

export interface ProviderConnection {
  connectionId: string
  userId: string
  providerKey: string
  displayName: string
  baseUrl: string
  encryptedApiKey: string // encrypted at rest
  defaultModel: string
  customModels?: string[]
  enabled: boolean
  capabilities: ProviderCapabilities
  rateLimitRemaining?: number
  rateLimitResetAt?: string
  billingStatus?: 'active' | 'past_due' | 'canceled' | 'trial'
  usageThisMonth?: { costUsd: number; requests: number }
  lastHealthCheck?: string
  createdAt: string
  updatedAt: string
}

// -----------------------------------------------------------------------------
// Factory for creating adapters
// -----------------------------------------------------------------------------

export interface ProviderAdapterFactory {
  create(providerKey: string, config: ProviderConfig): VideoProviderAdapter
  getSupportedProviders(): string[]
}