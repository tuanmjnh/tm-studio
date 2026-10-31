// =============================================================================
// Video Factory & Batch Orchestration Schema — Roadmap v1 §6 & §9
// Durable batch processing, generation jobs, outputs, and budget guards.
// =============================================================================

// -----------------------------------------------------------------------------
// Campaign & Batch Definitions
// -----------------------------------------------------------------------------

export type CampaignStatus = 'draft' | 'active' | 'completed' | 'archived'
export type BatchStatus = 'draft' | 'queued' | 'submitting' | 'processing' | 'paused' | 'completed' | 'failed' | 'canceled' | 'assembled'

export interface VideoCampaign {
  campaignId: string
  userId: string
  title: string
  intent: string
  targetChannels: string[] // e.g., ['tiktok', 'youtube-shorts', 'instagram-reels']
  targetAspectRatios: Array<'9:16' | '16:9' | '1:1' | '4:5'>
  targetLanguages: string[] // e.g., ['vi', 'en']
  templateId: string
  templateVersion: string
  createdAt: string
  updatedAt: string
}

export interface VideoBatch {
  batchId: string
  campaignId?: string
  userId: string
  templateId: string
  templateVersion: string
  inputSource: 'form' | 'csv' | 'json' | 'api'
  status: BatchStatus

  // Counts
  totalItems: number
  queuedItems: number
  runningItems: number
  completedItems: number
  failedItems: number
  canceledItems: number

  // Budget & Limits
  budgetCapUsd: number
  estimatedCostUsd: number
  actualCostUsd: number
  concurrencyCap: number
  maxRetryCount: number

  // Timestamps
  createdAt: string
  startedAt?: string
  completedAt?: string
  pausedAt?: string
  /** Optional future timestamp when the batch should automatically start. */
  scheduledFor?: string
  /** Last time the batch record was modified. */
  updatedAt?: string
}

export interface VideoBatchItem {
  itemId: string
  batchId: string
  rowIndex: number
  inputRecord: Record<string, unknown>
  status: 'pending' | 'validating' | 'validated' | 'generating' | 'completed' | 'failed' | 'approved' | 'rejected'
  validationErrors?: string[]
  scriptOutput?: Record<string, unknown>
  storyboardOutput?: Array<Record<string, unknown>>
  generationJobIds: string[]
  selectedOutputIds: string[]
  assembledProjectId?: string
  error?: string
  attempts: number
  updatedAt: string
}

// -----------------------------------------------------------------------------
// Generation Jobs & Outputs (Durable Queue)
// -----------------------------------------------------------------------------

export type JobType = 'script' | 'image' | 'video' | 'voice' | 'music'
export type JobStatus
  = | 'draft' | 'queued' | 'submitting' | 'processing'
    | 'completed' | 'failed' | 'canceled' | 'needs_review' | 'approved' | 'assembled'

export interface GenerationJob {
  jobId: string
  batchId: string
  itemId?: string
  sceneId?: string
  type: JobType
  connectionId: string // TM Hub connection ID
  model: string
  normalizedRequest: Record<string, unknown>
  providerTaskId?: string
  status: JobStatus
  attempts: number
  maxAttempts: number
  priority: number // higher = run first

  // Timestamps
  createdAt: string
  scheduledFor?: string
  startedAt?: string
  completedAt?: string

  // Cost & Error
  errorCategory?: 'network' | 'rate-limit' | 'billing' | 'invalid-prompt' | 'auth' | 'permission' | 'provider-error' | 'unknown'
  errorMessage?: string
  estimatedCostUsd: number
  actualCostUsd?: number

  // Output reference
  outputAssetId?: string
}

export interface GenerationOutput {
  outputId: string
  jobId: string
  batchId?: string
  assetId: string // TMCut Asset Service ID
  storageUrl: string // Cloudflare R2 / S3 path
  providerMetadata: Record<string, unknown>
  checksum: string // SHA-256
  durationSec?: number
  width?: number
  height?: number
  fps?: number
  fileSizeBytes: number
  moderationStatus: 'pending' | 'approved' | 'flagged' | 'rejected'
  reviewState: 'unreviewed' | 'approved' | 'rejected' | 'regenerate'
  createdAt: string
}

// -----------------------------------------------------------------------------
// Usage Ledger & Budget Guard
// -----------------------------------------------------------------------------

export interface UsageLedgerEntry {
  ledgerId: string
  userId: string
  batchId?: string
  jobId?: string
  providerKey: string
  model: string
  action: 'reserve' | 'actual' | 'refund'
  amountUsd: number
  tokensUsed?: { prompt: number, completion: number }
  durationSeconds?: number
  recordedAt: string
  notes?: string
}

export interface BudgetGuardConfig {
  maxBatchBudgetUsd: number
  maxTotalSpendDailyUsd: number
  maxConcurrency: number
  requireConfirmationThresholdUsd: number
  autoStopOnBudgetExceeded: boolean
}

// -----------------------------------------------------------------------------
// Assembly & Review Board
// -----------------------------------------------------------------------------

export interface AssemblyJob {
  assemblyId: string
  batchId: string
  itemId: string
  outputIds: string[]
  projectId: string // TMCut project ID created
  timelineVersion: number
  status: 'pending' | 'assembling' | 'success' | 'failed'
  error?: string
  createdAt: string
  completedAt?: string
}

export interface ReviewBoardFilter {
  batchId?: string
  status?: string
  reviewState?: 'unreviewed' | 'approved' | 'rejected' | 'regenerate'
  search?: string
}

export interface AuditEvent {
  eventId: string
  userId: string
  action: string // e.g., 'batch.create', 'batch.pause', 'output.approve'
  targetType: 'campaign' | 'batch' | 'job' | 'template' | 'connection'
  targetId: string
  payloadSummary: Record<string, unknown>
  ipAddress?: string
  timestamp: string
}
