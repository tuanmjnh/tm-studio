// =============================================================================
// TMCut MCP Tool Schemas — single source of truth for all tool contracts
// Zod schemas ensure: validation at boundaries, self-describing JSON Schema for
// MCP clients, and closed-set registry (no dynamic tool addition).
// =============================================================================

import { z } from 'zod'

// -----------------------------------------------------------------------------
// Base types (shared across tools)
// -----------------------------------------------------------------------------

export const ToolRisk = z.enum(['read', 'reversible', 'destructive', 'cost'])
export type ToolRisk = z.infer<typeof ToolRisk>

export const ToolErrorCode = z.enum([
  'METHOD_NOT_FOUND',
  'INVALID_PARAMS',
  'INTERNAL_ERROR',
  'RATE_LIMITED',
  'DUPLICATE_REQUEST',
  'REVISION_CONFLICT',
  'NO_PROJECT',
  'NO_PROPOSAL',
  'PROPOSAL_STALE',
  'VALIDATION_FAILED',
  'APPROVAL_REQUIRED',
  'BUDGET_EXCEEDED',
  'PROVIDER_UNAVAILABLE',
  'UNAUTHORIZED',
  'FORBIDDEN'
])
export type ToolErrorCode = z.infer<typeof ToolErrorCode>

export const ToolResult = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.object({
    code: ToolErrorCode,
    message: z.string(),
    retryable: z.boolean()
  }).optional(),
  warning: z.string().optional()
})
export type ToolResult = z.infer<typeof ToolResult>

// JSON-RPC 2.0 framing (MCP transport)
export const JsonRpcRequest = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  method: z.string(),
  params: z.unknown().optional()
})
export type JsonRpcRequest = z.infer<typeof JsonRpcRequest>

export const JsonRpcResponse = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.unknown().optional()
  }).optional()
})
export type JsonRpcResponse = z.infer<typeof JsonRpcResponse>

// -----------------------------------------------------------------------------
// Project context (read-only)
// -----------------------------------------------------------------------------

export const ProjectSummary = z.object({
  id: z.string(),
  name: z.string(),
  canvas: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive()
  }),
  durationSec: z.number().nonnegative(),
  trackCounts: z.object({
    video: z.number().int().nonnegative(),
    audio: z.number().int().nonnegative(),
    text: z.number().int().nonnegative()
  }),
  clipCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  lastSavedAt: z.string().datetime().optional()
})
export type ProjectSummary = z.infer<typeof ProjectSummary>

export const TimelineSnapshot = z.object({
  projectId: z.string(),
  tracks: z.array(z.object({
    id: z.string(),
    type: z.enum(['video', 'audio', 'text']),
    name: z.string(),
    locked: z.boolean(),
    hidden: z.boolean(),
    muted: z.boolean(),
    clips: z.array(z.object({
      id: z.string(),
      name: z.string(),
      trackId: z.string(),
      startSec: z.number(),
      durationSec: z.number(),
      mediaKind: z.enum(['video', 'audio', 'text']).optional(),
      volume: z.number().min(0).max(100).optional(),
      effects: z.array(z.string()).optional()
    }))
  })),
  markers: z.array(z.object({
    id: z.string(),
    timeSec: z.number(),
    label: z.string(),
    color: z.string()
  })).optional()
})
export type TimelineSnapshot = z.infer<typeof TimelineSnapshot>

export const AssetSummary = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['video', 'audio', 'image', 'font', 'lut']),
  durationSec: z.number().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
})
export type AssetSummary = z.infer<typeof AssetSummary>

// -----------------------------------------------------------------------------
// Proposal system (declarative edits, validated twice, one undo group)
// -----------------------------------------------------------------------------

export const ProposalOperation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('add_clip'), trackType: z.enum(['video', 'audio', 'text']), mediaRef: z.string().optional(), text: z.string().optional(), startSec: z.number(), durationSec: z.number().positive() }),
  z.object({ type: z.literal('move_clip'), clipId: z.string(), startSec: z.number().nonnegative() }),
  z.object({ type: z.literal('trim_clip'), clipId: z.string(), edge: z.enum(['in', 'out']), atSec: z.number() }),
  z.object({ type: z.literal('remove_clip'), clipId: z.string() }),
  z.object({ type: z.literal('split_clip'), clipId: z.string(), atSec: z.number() }),
  z.object({ type: z.literal('set_volume'), trackId: z.string(), volume: z.number().min(0).max(100) }),
  z.object({ type: z.literal('add_caption'), text: z.string(), atSec: z.number(), durationSec: z.number().positive() }),
  z.object({ type: z.literal('set_transition'), clipId: z.string(), transitionType: z.string(), durationSec: z.number().positive() }),
  z.object({ type: z.literal('set_effect'), clipId: z.string(), effects: z.array(z.object({ type: z.string(), params: z.record(z.unknown()) })) })
])
export type ProposalOperation = z.infer<typeof ProposalOperation>

export const ProposalSnapshot = z.object({
  id: z.string(),
  intent: z.string(),
  operations: z.array(ProposalOperation),
  createdAt: z.string().datetime(),
  validatedAt: z.string().datetime().optional(),
  validationErrors: z.array(z.string()).optional(),
  appliedAt: z.string().datetime().optional()
})
export type ProposalSnapshot = z.infer<typeof ProposalSnapshot>

// -----------------------------------------------------------------------------
// Tool parameter schemas (closed set — registry in tool-registry.ts)
// -----------------------------------------------------------------------------

// Context tools (read)
export const GetContextParams = z.object({})
export const GetTimelineParams = z.object({})
export const ListAssetsParams = z.object({
  query: z.string().optional(),
  kind: z.enum(['video', 'audio', 'image', 'font', 'lut']).optional(),
  limit: z.number().int().positive().max(100).default(50)
})

// Proposal tools
export const CreateProposalParams = z.object({
  intent: z.string().min(1).max(500)
})
export const GetProposalParams = z.object({})
export const ValidateProposalParams = z.object({})
export const DiscardProposalParams = z.object({})
export const ApplyProposalParams = z.object({}) // requiresApproval = true in registry

// Edit tools (all queue into proposal)
export const AddClipParams = z.object({
  trackType: z.enum(['video', 'audio', 'text']),
  name: z.string().min(1).max(200),
  mediaRef: z.string().optional(),
  text: z.string().optional(),
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive()
})
export const MoveClipParams = z.object({
  clipId: z.string(),
  startSec: z.number().nonnegative()
})
export const TrimClipParams = z.object({
  clipId: z.string(),
  edge: z.enum(['in', 'out']),
  atSec: z.number().nonnegative()
})
export const RemoveClipParams = z.object({
  clipId: z.string()
})
export const SplitClipParams = z.object({
  clipId: z.string(),
  atSec: z.number().nonnegative()
})
export const SetVolumeParams = z.object({
  trackId: z.string(),
  volume: z.number().min(0).max(100)
})
export const AddCaptionParams = z.object({
  text: z.string().min(1).max(2000),
  atSec: z.number().nonnegative(),
  durationSec: z.number().positive()
})
export const SetTransitionParams = z.object({
  clipId: z.string(),
  transitionType: z.string(),
  durationSec: z.number().positive()
})
export const SetEffectParams = z.object({
  clipId: z.string(),
  effects: z.array(z.object({
    type: z.string(),
    params: z.record(z.unknown())
  }))
})

// Playback tools
export const SeekParams = z.object({
  timeSec: z.number().nonnegative()
})
export const PlayParams = z.object({})
export const PauseParams = z.object({})

// -----------------------------------------------------------------------------
// Capability manifest (what the server advertises)
// -----------------------------------------------------------------------------

export const ServerCapabilities = z.object({
  schemaVersion: z.literal(1),
  tools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    parameters: z.record(z.unknown()), // JSON Schema subset
    risk: ToolRisk,
    requiresApproval: z.boolean()
  })),
  project: z.object({
    currentProjectId: z.string().optional(),
    canSwitchProject: z.boolean()
  }).optional()
})
export type ServerCapabilities = z.infer<typeof ServerCapabilities>

// -----------------------------------------------------------------------------
// Session & config
// -----------------------------------------------------------------------------

export const SessionConfig = z.object({
  projectId: z.string().optional(),
  idleTimeoutMs: z.number().int().positive().default(300000)
})
export type SessionConfig = z.infer<typeof SessionConfig>

export const SessionInfo = z.object({
  sessionId: z.string(),
  projectId: z.string().optional(),
  capabilities: ServerCapabilities,
  startedAt: z.string().datetime()
})
export type SessionInfo = z.infer<typeof SessionInfo>

// -----------------------------------------------------------------------------
// Event types (server → host pushes)
// -----------------------------------------------------------------------------

export const ProposalChangedEvent = z.object({
  type: z.literal('proposal_changed'),
  proposal: ProposalSnapshot
})
export const ProjectChangedEvent = z.object({
  type: z.literal('project_changed'),
  summary: ProjectSummary
})
export const JobStatusEvent = z.object({
  type: z.literal('job_status'),
  jobId: z.string(),
  status: z.enum(['queued', 'processing', 'completed', 'failed', 'cancelled']),
  progress: z.number().min(0).max(100).optional(),
  result: z.unknown().optional(),
  error: z.string().optional()
})
export type McpEvent = z.infer<typeof ProposalChangedEvent> | z.infer<typeof ProjectChangedEvent> | z.infer<typeof JobStatusEvent>

// -----------------------------------------------------------------------------
// Helper: validate and coerce
// -----------------------------------------------------------------------------

export function validateToolParams<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input)
}

// -----------------------------------------------------------------------------
// Asset Center (Phase 4)
// -----------------------------------------------------------------------------

export const AssetCatalogEntry = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.enum(['music', 'sound-effects', 'fonts', 'lut', 'transition', 'effect']),
  assetKind: z.enum(['video', 'audio', 'image', 'font', 'lut']),
  version: z.string(),
  sizeBytes: z.number().nonnegative(),
  sha256: z.string(),
  sourceUrl: z.string().optional(),
  previewRef: z.string().nullable().optional(),
  creator: z.string(),
  priceUsd: z.number().nonnegative(),
  license: z.object({
    status: z.enum(['unknown', 'review', 'approved']),
    name: z.string(),
    url: z.string().optional(),
    attribution: z.string().optional(),
    commercialUse: z.boolean(),
    redistributable: z.boolean(),
    territories: z.array(z.string()).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
    proof: z.string().optional(),
    reviewer: z.string().optional(),
    reviewedAt: z.string().datetime().optional(),
    review: z.object({
      decision: z.enum(['approved', 'rejected']),
      by: z.string(),
      at: z.string().datetime(),
      note: z.string().optional()
    }).nullable().optional()
  })
})
export type AssetCatalogEntry = z.infer<typeof AssetCatalogEntry>

export const AssetInstallState = z.enum(['catalog', 'downloading', 'verifying', 'installed', 'failed', 'takedown'])
export type AssetInstallState = z.infer<typeof AssetInstallState>

export const AssetListParams = z.object({
  query: z.string().optional(),
  category: z.enum(['music', 'sound-effects', 'fonts', 'lut', 'transition', 'effect']).optional(),
  kind: z.enum(['video', 'audio', 'image', 'font', 'lut']).optional(),
  limit: z.number().int().positive().max(100).default(50),
  showInstalled: z.boolean().default(false),
  showAvailable: z.boolean().default(true)
})

export const InstallAssetParams = z.object({
  entryId: z.string(),
  version: z.string().optional()
})

export const UninstallAssetParams = z.object({
  entryId: z.string()
})

export const AssetInstallStatusParams = z.object({
  entryId: z.string()
})

// -----------------------------------------------------------------------------
// Templates (Phase 4)
// -----------------------------------------------------------------------------

export const TemplateSummary = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['intro', 'outro', 'split-screen', 'promo', 'minimal', 'custom']),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '21:9']),
  durationSec: z.number().positive(),
  trackCounts: z.object({
    video: z.number().int().nonnegative(),
    audio: z.number().int().nonnegative(),
    text: z.number().int().nonnegative()
  }),
  thumbnailUrl: z.string().optional(),
  isBuiltin: z.boolean(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional()
})
export type TemplateSummary = z.infer<typeof TemplateSummary>

export const ListTemplatesParams = z.object({
  category: z.enum(['intro', 'outro', 'split-screen', 'promo', 'minimal', 'custom', 'all']).default('all'),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '21:9', 'all']).default('all'),
  query: z.string().optional(),
  limit: z.number().int().positive().max(100).default(50)
})

export const ApplyTemplateParams = z.object({
  templateId: z.string(),
  replacements: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  projectName: z.string().min(1).max(200).optional()
})

export const SaveAsTemplateParams = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.enum(['intro', 'outro', 'split-screen', 'promo', 'minimal', 'custom']),
  aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3', '21:9']),
  placeholderRules: z.array(z.object({
      trackId: z.string(),
      placeholderType: z.enum(['media', 'text']),
      replaceWith: z.union([z.string(), z.number(), z.boolean()]).optional()
    })).optional()
  })

export const DeleteTemplateParams = z.object({
  templateId: z.string()
})

export const ImportTemplateParams = z.object({
  filePath: z.string(),
  name: z.string().optional()
})

export const ExportTemplateParams = z.object({
  templateId: z.string(),
  filePath: z.string().optional()
})

// -----------------------------------------------------------------------------
// Export Queue (Phase 4)
// -----------------------------------------------------------------------------

export const ExportJobSummary = z.object({
  id: z.string(),
  projectId: z.string().optional(),
  projectName: z.string(),
  outputPath: z.string(),
  mode: z.enum(['video', 'audio', 'gif']),
  specs: z.string(),
  duration: z.number().nonnegative(),
  status: z.enum(['waiting', 'running', 'done', 'failed', 'cancelled']),
  progress: z.number().min(0).max(100),
  speed: z.string().optional(),
  downloaded: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional()
})
export type ExportJobSummary = z.infer<typeof ExportJobSummary>

export const ListExportJobsParams = z.object({
  status: z.enum(['waiting', 'running', 'done', 'failed', 'cancelled', 'all']).default('all'),
  limit: z.number().int().positive().max(100).default(50)
})

export const AddExportJobParams = z.object({
  projectId: z.string(),
  outputPath: z.string(),
  mode: z.enum(['video', 'audio', 'gif']),
  specs: z.string(),
  duration: z.number().positive()
})

export const PauseExportJobParams = z.object({
  jobId: z.string()
})

export const ResumeExportJobParams = z.object({
  jobId: z.string()
})

export const CancelExportJobParams = z.object({
  jobId: z.string()
})

export const RetryExportJobParams = z.object({
  jobId: z.string()
})

export const ClearExportHistoryParams = z.object({
  status: z.enum(['done', 'failed', 'cancelled', 'all']).default('done')
})

// -----------------------------------------------------------------------------
// Video Factory (Phase 7 — MCP Factory tools, roadmap v1 §4)
// -----------------------------------------------------------------------------

export const BatchEstimateParams = z.object({
  templateId: z.string(),
  templateVersion: z.string(),
  records: z.array(z.record(z.string(), z.unknown()))
})

export const BatchEstimateResult = z.object({
  ok: z.boolean(),
  plan: z.object({
    templateName: z.string(),
    sceneCount: z.number().int().nonnegative(),
    validCount: z.number().int().nonnegative(),
    totalCount: z.number().int().nonnegative(),
    validationErrors: z.array(z.record(z.string(), z.unknown())).optional()
  }).optional(),
  estimate: z.object({
    estimatedCostUsd: z.number().nonnegative(),
    currency: z.string(),
    batchSize: z.number().int().positive(),
    perJobCostUsd: z.number().nonnegative()
  }).optional(),
  budget: z.object({
    allowed: z.boolean(),
    blockedBy: z.string().optional(),
    requiresConfirmation: z.boolean(),
    spentTodayUsd: z.number().nonnegative()
  }).optional(),
  error: z.string().optional()
})
export type BatchEstimateResult = z.infer<typeof BatchEstimateResult>

export const CreateBatchParams = z.object({
  templateId: z.string(),
  templateVersion: z.string(),
  records: z.array(z.record(z.string(), z.unknown())),
  confirmed: z.boolean().default(false),
  inputSource: z.enum(['form', 'csv', 'json', 'api']).default('csv'),
  runMode: z.enum(['dry-run', 'live']).default('dry-run'),
  providerId: z.string().optional()
})

export const BatchSummary = z.object({
  batchId: z.string(),
  templateId: z.string(),
  templateVersion: z.string(),
  inputSource: z.string(),
  status: z.enum(['draft', 'queued', 'submitting', 'processing', 'completed', 'failed', 'canceled', 'paused', 'assembled']),
  totalItems: z.number().int().nonnegative(),
  completedItems: z.number().int().nonnegative(),
  failedItems: z.number().int().nonnegative(),
  budgetCapUsd: z.number().nonnegative(),
  estimatedCostUsd: z.number().nonnegative(),
  actualCostUsd: z.number().nonnegative(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional()
})
export type BatchSummary = z.infer<typeof BatchSummary>

export const GetBatchParams = z.object({
  batchId: z.string()
})

export const BatchDetail = z.object({
  batch: BatchSummary,
  items: z.array(z.record(z.string(), z.unknown())),
  jobs: z.array(z.record(z.string(), z.unknown())),
  progress: z.number().int().min(0).max(100)
}).strict()
export type BatchDetail = z.infer<typeof BatchDetail>

export const BatchControlParams = z.object({
  batchId: z.string()
})

export const GetJobParams = z.object({
  jobId: z.string()
})

export const JobSummary = z.object({
  jobId: z.string(),
  batchId: z.string(),
  type: z.enum(['script', 'image', 'video', 'voice', 'music']),
  model: z.string(),
  status: z.enum(['draft', 'queued', 'submitting', 'processing', 'completed', 'failed', 'canceled', 'needs_review', 'approved', 'assembled']),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  estimatedCostUsd: z.number().nonnegative(),
  actualCostUsd: z.number().optional(),
  errorCategory: z.string().optional(),
  errorMessage: z.string().optional(),
  providerTaskId: z.string().optional(),
  outputAssetId: z.string().optional(),
  createdAt: z.string(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional()
})
export type JobSummary = z.infer<typeof JobSummary>

export const RetryJobParams = z.object({
  jobId: z.string()
})

export const AssembleProjectParams = z.object({
  batchId: z.string()
})