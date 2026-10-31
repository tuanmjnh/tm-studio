/**
 * Video Factory batch orchestration (Roadmap v1 §6 + §8, P5).
 *
 * This module is the deterministic heart of a batch run: it turns
 * `template version + N input records` into a job graph, prices it, guards the
 * budget, schedules jobs under a concurrency cap, and validates every status
 * transition. It performs NO network calls and owns NO reactive state — the
 * store (`useVideoFactory`) and the executor (`videoFactoryRunner`) sit on top,
 * which is what makes the retry rules and the batch math testable offline.
 *
 * Invariants encoded here:
 *  - a batch never references "latest" — it pins templateId + templateVersion;
 *  - one job per (item, scene): retrying a scene never re-runs the others;
 *  - an invalid input row fails alone; the rest of the batch still runs;
 *  - retries are only for transient errors (never billing / auth / bad prompt);
 *  - the budget guard refuses to queue work that exceeds a hard cap.
 */
import type {
  BatchStatus,
  BudgetGuardConfig,
  GenerationJob,
  JobStatus,
  VideoBatch,
  VideoBatchItem
} from '~/types/videoFactory'
import type { VideoTemplate } from '~/types/videoTemplate'
import { routeStoryboard } from '@tmcut-core'
import {
  buildStoryboard,
  buildTemplateInputs,
  sampleRecordFor,
  validateVideoTemplate,
  type StoryboardScene
} from '~/utils/tmcut/videoTemplates'

// -----------------------------------------------------------------------------
// Input records (form / CSV / JSON)
// -----------------------------------------------------------------------------

export interface BatchInputRecord {
  rowIndex: number
  /** Human label shown in the queue (product name, campaign row, …). */
  label: string
  record: Record<string, unknown>
}

/** Default label: the first text-ish input field, else "Row N". */
export function labelFor(template: VideoTemplate, record: Record<string, unknown>, rowIndex: number): string {
  for (const field of template.inputSchema || []) {
    if (field.type !== 'text' && field.type !== 'textarea') continue
    const value = record[field.id]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return `Row ${rowIndex + 1}`
}

/**
 * Minimal RFC4180-ish CSV reader: quoted fields, escaped quotes, CRLF.
 * Deliberately not a general CSV library — batch inputs are flat tables.
 */
export function parseCsvRecords(text: string, options: { delimiter?: string } = {}): {
  headers: string[]
  rows: Array<Record<string, string>>
} {
  const delimiter = options.delimiter || detectDelimiter(text)
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  const source = String(text || '').replace(/\r\n?/g, '\n')

  for (let i = 0; i < source.length; i++) {
    const char = source[i]!
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
      continue
    }
    if (char === delimiter) {
      row.push(field)
      field = ''
      continue
    }
    if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }
    field += char
  }
  // Trailing field / row without a final newline.
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const cleaned = rows.filter(cells => cells.some(cell => String(cell).trim() !== ''))
  if (cleaned.length === 0) return { headers: [], rows: [] }
  const headers = cleaned[0]!.map(header => header.trim())
  return {
    headers,
    rows: cleaned.slice(1).map((cells) => {
      const record: Record<string, string> = {}
      headers.forEach((header, index) => {
        record[header] = String(cells[index] ?? '').trim()
      })
      return record
    })
  }
}

function detectDelimiter(text: string): string {
  const firstLine = String(text || '').split('\n')[0] || ''
  const commas = (firstLine.match(/,/g) || []).length
  const semicolons = (firstLine.match(/;/g) || []).length
  const tabs = (firstLine.match(/\t/g) || []).length
  if (tabs > commas && tabs >= semicolons) return '\t'
  if (semicolons > commas) return ';'
  return ','
}

/** Turn parsed rows into batch records, numbering them in source order. */
export function recordsFromTableRows(
  rows: Array<Record<string, unknown>>
): BatchInputRecord[] {
  return rows.map((record, index) => ({
    rowIndex: index,
    label: String(record.name ?? record.title ?? record.product ?? `Row ${index + 1}`),
    record
  }))
}

/** Parse a JSON array of records ({"name": …}, …). Throws on a bad document. */
export function parseJsonRecords(text: string): BatchInputRecord[] {
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('Input JSON must be an array of records')
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Record at index ${index} is not an object`)
    }
    return {
      rowIndex: index,
      label: String((entry as Record<string, unknown>).name ?? `Row ${index + 1}`),
      record: entry as Record<string, unknown>
    }
  })
}

// -----------------------------------------------------------------------------
// Planning: records → validated storyboards → job graph
// -----------------------------------------------------------------------------

export interface PlannedItem {
  rowIndex: number
  label: string
  inputRecord: Record<string, unknown>
  ok: boolean
  errors: Array<{ fieldId: string, code: string, message: string }>
  sceneCount: number
  durationSec: number
  storyboard: StoryboardScene[]
}

export interface BatchPlan {
  templateId: string
  templateVersion: string
  items: PlannedItem[]
  validCount: number
  invalidCount: number
  sceneCount: number
  durationSec: number
}

export interface BatchPlanResult {
  ok: boolean
  error?: { code: string, message: string, validation?: unknown }
  plan?: BatchPlan
}

/** Optional cap: refuse to plan absurd batches instead of queueing forever. */
export const MAX_BATCH_ITEMS = 500

/**
 * Validate every record against the pinned template version. A published
 * template must be internally valid before any row is planned — otherwise the
 * batch would fail at generation time with a confusing per-job error.
 */
export function planBatch(
  template: VideoTemplate,
  records: BatchInputRecord[],
  options: { maxItems?: number } = {}
): BatchPlanResult {
  const validation = validateVideoTemplate(template)
  if (!validation.valid) {
    return {
      ok: false,
      error: {
        code: 'template-invalid',
        message: `Template ${template.templateId}@${template.version} has ${validation.errors.length} blocking error(s)`,
        validation
      }
    }
  }
  const maxItems = options.maxItems ?? MAX_BATCH_ITEMS
  if (records.length === 0) {
    return { ok: false, error: { code: 'no-records', message: 'A batch needs at least one input record' } }
  }
  if (records.length > maxItems) {
    return {
      ok: false,
      error: { code: 'too-many-records', message: `A batch accepts at most ${maxItems} records (got ${records.length})` }
    }
  }

  const items: PlannedItem[] = records.map((entry) => {
    const inputs = buildTemplateInputs(template, entry.record)
    if (!inputs.ok) {
      return {
        rowIndex: entry.rowIndex,
        label: entry.label || labelFor(template, entry.record, entry.rowIndex),
        inputRecord: entry.record,
        ok: false,
        errors: inputs.errors,
        sceneCount: 0,
        durationSec: 0,
        storyboard: []
      }
    }
    const storyboard = buildStoryboard(template, inputs.values)
    return {
      rowIndex: entry.rowIndex,
      label: entry.label || labelFor(template, inputs.values, entry.rowIndex),
      inputRecord: entry.record,
      ok: true,
      errors: [],
      sceneCount: storyboard.length,
      durationSec: storyboard.reduce((sum, scene) => sum + scene.durationSec, 0),
      storyboard
    }
  })

  const validItems = items.filter(item => item.ok)
  return {
    ok: true,
    plan: {
      templateId: template.templateId,
      templateVersion: template.version,
      items,
      validCount: validItems.length,
      invalidCount: items.length - validItems.length,
      sceneCount: validItems.reduce((sum, item) => sum + item.sceneCount, 0),
      durationSec: validItems.reduce((sum, item) => sum + item.durationSec, 0)
    }
  }
}

// -----------------------------------------------------------------------------
// Cost estimation
// -----------------------------------------------------------------------------

/**
 * Rates are per scene, not per template: a scene is one provider task. These
 * defaults are PLACEHOLDERS until a provider connection reports real pricing —
 * the UI must always present the number as an estimate.
 */
export interface CostRates {
  perItemUsd: number
  perSceneUsd: number
  perSecondUsd: number
  currency: string
}

export const DEFAULT_COST_RATES: CostRates = {
  perItemUsd: 0,
  perSceneUsd: 0.1,
  perSecondUsd: 0.02,
  currency: 'USD'
}

/** Estimates are a range: providers bill by rounded units and retries. */
const COST_SPREAD = 0.2

export interface CostBreakdownItem {
  component: string
  quantity: number
  unit: string
  unitCostUsd: number
  totalUsd: number
}

export interface BatchEstimate {
  jobCount: number
  sceneCount: number
  durationSec: number
  estimatedCostUsd: number
  lowEstimateUsd: number
  highEstimateUsd: number
  breakdown: CostBreakdownItem[]
  currency: string
  /** True when the estimate alone blows the batch cap. */
  exceedsBatchCap: boolean
  /** True when the user must confirm before queueing. */
  requiresConfirmation: boolean
  reasons: string[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function estimateBatch(
  plan: BatchPlan,
  options: {
    rates?: CostRates
    budget?: BudgetGuardConfig
    /** Jobs in flight from other batches, for the concurrency warning. */
    runningNow?: number
  } = {}
): BatchEstimate {
  const rates = options.rates || DEFAULT_COST_RATES
  const budget = options.budget || DEFAULT_BUDGET_GUARD
  const validItems = plan.items.filter(item => item.ok)

  const sceneBreakdown: CostBreakdownItem = {
    component: 'scene-generation',
    quantity: plan.sceneCount,
    unit: 'job',
    unitCostUsd: rates.perSceneUsd,
    totalUsd: round2(plan.sceneCount * rates.perSceneUsd)
  }
  const secondsBreakdown: CostBreakdownItem = {
    component: 'video-seconds',
    quantity: plan.durationSec,
    unit: 'second',
    unitCostUsd: rates.perSecondUsd,
    totalUsd: round2(plan.durationSec * rates.perSecondUsd)
  }
  const itemBreakdown: CostBreakdownItem = {
    component: 'script-per-item',
    quantity: validItems.length,
    unit: 'item',
    unitCostUsd: rates.perItemUsd,
    totalUsd: round2(validItems.length * rates.perItemUsd)
  }
  const breakdown = [sceneBreakdown, secondsBreakdown, itemBreakdown]
    .filter(item => item.quantity > 0)

  const total = round2(breakdown.reduce((sum, item) => sum + item.totalUsd, 0))
  const reasons: string[] = []

  const exceedsBatchCap = total > budget.maxBatchBudgetUsd
  if (exceedsBatchCap) {
    reasons.push(`estimate-exceeds-batch-cap:${budget.maxBatchBudgetUsd}`)
  }
  const requiresConfirmation
    = total >= budget.requireConfirmationThresholdUsd
      || plan.sceneCount > budget.maxConcurrency * 10
  if (requiresConfirmation) reasons.push('confirmation-required')
  if (plan.invalidCount > 0) reasons.push(`invalid-rows:${plan.invalidCount}`)
  if ((options.runningNow ?? 0) >= budget.maxConcurrency) reasons.push('concurrency-saturated')

  return {
    jobCount: plan.sceneCount,
    sceneCount: plan.sceneCount,
    durationSec: plan.durationSec,
    estimatedCostUsd: total,
    lowEstimateUsd: round2(total * (1 - COST_SPREAD)),
    highEstimateUsd: round2(total * (1 + COST_SPREAD)),
    breakdown,
    currency: rates.currency,
    exceedsBatchCap,
    requiresConfirmation,
    reasons
  }
}

// -----------------------------------------------------------------------------
// Budget guard
// -----------------------------------------------------------------------------

export const DEFAULT_BUDGET_GUARD: BudgetGuardConfig = {
  maxBatchBudgetUsd: 5,
  maxTotalSpendDailyUsd: 20,
  maxConcurrency: 2,
  requireConfirmationThresholdUsd: 1,
  autoStopOnBudgetExceeded: true
}

export interface BudgetCheck {
  allowed: boolean
  blockedBy?: 'batch-cap' | 'daily-cap'
  requiresConfirmation: boolean
  reasons: string[]
  remainingBatchUsd: number
  remainingDailyUsd: number
}

export function checkBudget(
  estimate: BatchEstimate,
  options: {
    budget?: BudgetGuardConfig
    /** Actual spend recorded today across every batch, in USD. */
    spentTodayUsd?: number
    /** Cost already reserved by this batch (re-check on resume). */
    alreadyCommittedUsd?: number
  } = {}
): BudgetCheck {
  const budget = options.budget || DEFAULT_BUDGET_GUARD
  const spentToday = Number(options.spentTodayUsd) || 0
  const committed = Number(options.alreadyCommittedUsd) || 0
  const remainingBatchUsd = round2(Math.max(0, budget.maxBatchBudgetUsd - committed))
  const remainingDailyUsd = round2(Math.max(0, budget.maxTotalSpendDailyUsd - spentToday))
  const needed = Math.max(0, round2(estimate.estimatedCostUsd - committed))

  const reasons: string[] = []
  if (estimate.estimatedCostUsd > budget.maxBatchBudgetUsd) reasons.push('batch-cap-exceeded')
  if (spentToday + needed > budget.maxTotalSpendDailyUsd) reasons.push('daily-cap-exceeded')

  const blockedBy = reasons.includes('batch-cap-exceeded')
    ? 'batch-cap' as const
    : reasons.includes('daily-cap-exceeded')
      ? 'daily-cap' as const
      : undefined

  return {
    allowed: !blockedBy,
    blockedBy,
    requiresConfirmation: estimate.estimatedCostUsd >= budget.requireConfirmationThresholdUsd,
    reasons,
    remainingBatchUsd,
    remainingDailyUsd
  }
}

// -----------------------------------------------------------------------------
// Job graph
// -----------------------------------------------------------------------------

export interface CreateBatchOptions {
  batchId?: string
  userId?: string
  now?: string
  inputSource?: VideoBatch['inputSource']
  budget?: BudgetGuardConfig
  connectionId?: string
  model?: string
  /** Optional provider capability manifests for per-scene routing (P7). */
  providers?: Array<Record<string, unknown>>
  /** Batch-level estimate, kept for the budget ledger. */
  estimatedCostUsd?: number
  /** Per-scene estimate, snapshotted on each job. */
  perJobCostUsd?: number
}

export interface CreatedBatch {
  batch: VideoBatch
  items: VideoBatchItem[]
  jobs: GenerationJob[]
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Build the durable records for a batch. Invalid rows still get an item (so the
 * review board can show WHY they failed) but no jobs.
 */
export function createBatchFromPlan(
  template: VideoTemplate,
  plan: BatchPlan,
  options: CreateBatchOptions = {}
): CreatedBatch {
  const now = options.now || new Date().toISOString()
  const budget = options.budget || DEFAULT_BUDGET_GUARD
  const batchId = options.batchId || randomId('batch')
  const userId = options.userId || 'local'

  const items: VideoBatchItem[] = []
  const jobs: GenerationJob[] = []

  plan.items.forEach((planned) => {
    const itemId = `${batchId}:r${planned.rowIndex}`
    if (!planned.ok) {
      items.push({
        itemId,
        batchId,
        rowIndex: planned.rowIndex,
        inputRecord: planned.inputRecord,
        status: 'failed',
        validationErrors: planned.errors.map(issue => issue.message),
        generationJobIds: [],
        selectedOutputIds: [],
        error: planned.errors.map(issue => issue.message).join('; '),
        attempts: 0,
        updatedAt: now
      })
      return
    }
    const jobIds: string[] = []

    // Per-scene provider routing (P7): use template's providerPolicy + capability
    // manifests to pick the right provider for each scene's capability/duration.
    let routedMap: Map<string, string> | null = null
    if (options.providers?.length && template.providerPolicy) {
      const { routed } = routeStoryboard({
        scenes: planned.storyboard.map(s => ({
          sceneId: s.sceneId,
          capabilities: s.capabilities,
          durationSec: s.durationSec
        })),
        manifests: options.providers,
        policy: template.providerPolicy,
        requireVerified: true // verified-only by default for production
      })
      routedMap = new Map(routed.filter(r => r.providerId && r.sceneId).map(r => [r.sceneId!, r.providerId!]))
    }

    planned.storyboard.forEach((scene, sceneIndex) => {
      const jobId = `${itemId}:s${sceneIndex}`
      jobIds.push(jobId)
      const providerId = routedMap?.get(scene.sceneId) || options.connectionId || 'dry-run'
      jobs.push({
        jobId,
        batchId,
        itemId,
        sceneId: scene.sceneId,
        type: scene.capabilities.includes('image-gen') && !scene.capabilities.includes('video-gen')
          ? 'image'
          : 'video',
        connectionId: providerId,
        model: providerId === 'dry-run' ? 'dry-run' : providerId,
        // Snapshot of the resolved prompt: a template edit after queueing must
        // not change what an already-queued job will generate.
        normalizedRequest: {
          prompt: scene.prompt,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          durationSec: scene.durationSec,
          aspectRatio: template.assemblyProfile?.outputProfile?.aspectRatio,
          capabilities: [...scene.capabilities],
          sceneOrder: scene.order,
          sceneRole: scene.role,
          shotType: scene.shotType
        },
        status: 'queued',
        attempts: 0,
        maxAttempts: 3,
        // Earlier scenes first so a partial batch is at least watchable.
        priority: 1000 - sceneIndex,
        createdAt: now,
        estimatedCostUsd: options.perJobCostUsd ?? 0
      })
    })
    items.push({
      itemId,
      batchId,
      rowIndex: planned.rowIndex,
      inputRecord: planned.inputRecord,
      status: 'generating',
      generationJobIds: jobIds,
      selectedOutputIds: [],
      attempts: 0,
      updatedAt: now
    })
  })

  const batch: VideoBatch = {
    batchId,
    userId,
    templateId: plan.templateId,
    templateVersion: plan.templateVersion,
    inputSource: options.inputSource || 'form',
    status: 'queued',
    totalItems: items.length,
    queuedItems: items.filter(item => item.status === 'generating').length,
    runningItems: 0,
    completedItems: 0,
    failedItems: items.filter(item => item.status === 'failed').length,
    canceledItems: 0,
    budgetCapUsd: budget.maxBatchBudgetUsd,
    estimatedCostUsd: options.estimatedCostUsd ?? 0,
    actualCostUsd: 0,
    concurrencyCap: budget.maxConcurrency,
    maxRetryCount: 3,
    createdAt: now
  }

  return { batch, items, jobs }
}

// -----------------------------------------------------------------------------
// Status machine
// -----------------------------------------------------------------------------

const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ['queued', 'canceled'],
  queued: ['submitting', 'canceled', 'failed'],
  submitting: ['processing', 'failed', 'canceled'],
  processing: ['completed', 'failed', 'canceled', 'needs_review'],
  completed: ['needs_review', 'approved', 'canceled'],
  failed: ['queued', 'canceled'],
  canceled: [],
  needs_review: ['approved', 'canceled', 'failed'],
  approved: ['assembled'],
  assembled: []
}

export function canTransitionJob(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true
  return (JOB_TRANSITIONS[from] || []).includes(to)
}

export interface TransitionResult {
  ok: boolean
  job?: GenerationJob
  error?: { code: string, message: string }
}

/** Move one job to a new status, refusing illegal transitions. */
export function transitionJob(
  job: GenerationJob,
  next: JobStatus,
  patch: Partial<GenerationJob> = {},
  now = new Date().toISOString()
): TransitionResult {
  if (!canTransitionJob(job.status, next)) {
    return {
      ok: false,
      error: { code: 'illegal-transition', message: `Cannot move job ${job.jobId} from ${job.status} to ${next}` }
    }
  }
  const updated: GenerationJob = {
    ...job,
    ...patch,
    // Identity and accounting fields are owned by the engine.
    jobId: job.jobId,
    batchId: job.batchId,
    status: next
  }
  if (next === 'submitting' && !updated.startedAt) updated.startedAt = now
  if (['completed', 'failed', 'canceled'].includes(next)) updated.completedAt = now
  return { ok: true, job: updated }
}

/** Job terminal states that no longer occupy a concurrency slot. */
export function isJobSettled(job: GenerationJob): boolean {
  return ['completed', 'failed', 'canceled', 'needs_review', 'approved', 'assembled'].includes(job.status)
}

export function countRunningJobs(jobs: GenerationJob[]): number {
  return jobs.filter(job => job.status === 'submitting' || job.status === 'processing').length
}

// -----------------------------------------------------------------------------
// Scheduler
// -----------------------------------------------------------------------------

/**
 * Pick the next jobs to submit. Never returns more than the free concurrency
 * slots, and never returns a job whose retry backoff has not elapsed yet.
 */
export function selectRunnableJobs(
  jobs: GenerationJob[],
  options: {
    runningCount?: number
    concurrencyCap: number
    now?: number
    /** Per-provider concurrency caps from capability manifests (rateLimitRpm). */
    providerConcurrency?: Record<string, number>
  }
): GenerationJob[] {
  const now = options.now ?? Date.now()
  const running = options.runningCount ?? countRunningJobs(jobs)
  const globalSlots = Math.max(0, options.concurrencyCap - running)
  if (globalSlots === 0) return []

  // Count running per provider
  const runningPerProvider: Record<string, number> = {}
  if (options.providerConcurrency) {
    for (const job of jobs) {
      if (job.status === 'submitting' || job.status === 'processing') {
        const pid = job.connectionId
        if (pid) runningPerProvider[pid] = (runningPerProvider[pid] || 0) + 1
      }
    }
  }

  return jobs
    .filter(job => job.status === 'queued')
    .filter((job) => {
      if (!job.scheduledFor) return true
      const at = Date.parse(job.scheduledFor)
      return Number.isNaN(at) ? true : at <= now
    })
    .filter((job) => {
      if (!options.providerConcurrency) return true
      const cap = options.providerConcurrency[job.connectionId]
      if (!cap) return true // no cap = unlimited
      const used = runningPerProvider[job.connectionId] || 0
      return used < cap
    })
    .sort((a, b) => (b.priority - a.priority) || (a.createdAt.localeCompare(b.createdAt)))
    .slice(0, globalSlots)
}

// -----------------------------------------------------------------------------
// Retry policy
// -----------------------------------------------------------------------------

export type ErrorCategory = NonNullable<GenerationJob['errorCategory']>

/** Errors that must never be retried: they would fail identically again. */
const NON_RETRYABLE: ErrorCategory[] = ['billing', 'invalid-prompt', 'auth', 'permission']

const RETRY_BASE_MS = 2000
const RETRY_MAX_MS = 5 * 60 * 1000

export interface RetryDecision {
  retry: boolean
  delayMs: number
  scheduledFor?: string
  reason: string
}

/**
 * Exponential backoff with jitter; honours provider `Retry-After`. `attempts`
 * is the count AFTER this failure (so the first failure is attempts = 1).
 */
export function planRetry(input: {
  attempts: number
  maxAttempts: number
  category?: ErrorCategory
  retryable?: boolean
  retryAfterSec?: number
  now?: number
  random?: () => number
}): RetryDecision {
  const now = input.now ?? Date.now()
  const category = input.category
  if (category && (NON_RETRYABLE.includes(category) || input.retryable === false)) {
    return { retry: false, delayMs: 0, reason: `non-retryable:${category}` }
  }
  if (input.attempts >= input.maxAttempts) {
    return { retry: false, delayMs: 0, reason: 'max-attempts' }
  }
  let delay: number
  if (typeof input.retryAfterSec === 'number' && input.retryAfterSec > 0) {
    // Provider said when; do not second-guess it, but keep the ceiling.
    delay = Math.min(input.retryAfterSec * 1000, RETRY_MAX_MS)
  } else {
    const exponential = RETRY_BASE_MS * Math.pow(2, Math.max(0, input.attempts - 1))
    // ±25% jitter so a whole batch does not retry in lockstep.
    const jitter = (input.random ? input.random() : Math.random()) * 0.5 - 0.25
    delay = Math.min(RETRY_MAX_MS, Math.round(exponential * (1 + jitter)))
  }
  return {
    retry: true,
    delayMs: delay,
    scheduledFor: new Date(now + delay).toISOString(),
    reason: 'transient'
  }
}

// -----------------------------------------------------------------------------
// Batch status + counts
// -----------------------------------------------------------------------------

export function recountBatch(
  batch: VideoBatch,
  items: VideoBatchItem[],
  jobs: GenerationJob[],
  now = new Date().toISOString()
): VideoBatch {
  const batchItems = items.filter(item => item.batchId === batch.batchId)
  const batchJobs = jobs.filter(job => job.batchId === batch.batchId)
  const actualCost = round2(batchJobs.reduce((sum, job) => sum + (job.actualCostUsd ?? 0), 0))
  const next: VideoBatch = {
    ...batch,
    totalItems: batchItems.length,
    queuedItems: batchItems.filter(item => item.status === 'pending' || item.status === 'generating').length,
    runningItems: batchJobs.filter(job => job.status === 'submitting' || job.status === 'processing').length,
    completedItems: batchItems.filter(item => item.status === 'completed' || item.status === 'approved').length,
    failedItems: batchItems.filter(item => item.status === 'failed').length,
    canceledItems: batchItems.filter(item => item.status === 'rejected').length,
    actualCostUsd: actualCost
  }
  next.status = deriveBatchStatus(next, batchItems, batchJobs)
  if (next.status === 'completed' || next.status === 'failed' || next.status === 'assembled') {
    if (!next.completedAt) next.completedAt = now
  }
  return next
}

/**
 * Derived batch status. An explicit pause wins over "processing" only when
 * nothing is actually in flight — a pause stops NEW submissions.
 */
export function deriveBatchStatus(
  batch: VideoBatch,
  items: VideoBatchItem[],
  jobs: GenerationJob[]
): BatchStatus {
  const batchJobs = jobs.filter(job => job.batchId === batch.batchId)
  const batchItems = items.filter(item => item.batchId === batch.batchId)
  const running = batchJobs.filter(job => job.status === 'submitting' || job.status === 'processing').length
  const queued = batchJobs.filter(job => job.status === 'queued').length
  const failed = batchItems.filter(item => item.status === 'failed').length
  const settled = batchJobs.filter(isJobSettled).length
  const allJobsDone = batchJobs.length === settled
  const allCanceled = batchJobs.length > 0
    && batchJobs.every(job => job.status === 'canceled')

  if (batch.status === 'canceled' || allCanceled) return 'canceled'
  // Every scene written to a project: the batch is no longer "completed", it
  // has moved on to assembly (P6). Driven by the JOB status alone — an item id
  // without assembled jobs is a half-finished state, not an assembled batch.
  if (allJobsDone && batchJobs.length > 0 && batchJobs.every(job => job.status === 'assembled')) {
    return 'assembled'
  }
  if (allJobsDone && batchItems.length > 0) {
    const doneItems = batchItems.filter(item => item.status === 'completed' || item.status === 'approved').length
    if (doneItems > 0) return 'completed'
    return failed > 0 ? 'failed' : 'completed'
  }
  if (batch.status === 'paused' && running === 0) return 'paused'
  if (running > 0) return 'processing'
  if (queued > 0) return 'queued'
  if (failed > 0) return 'failed'
  return batch.status
}

/** Item status is a projection of its jobs — never edited by hand. */
export function deriveItemStatus(jobStatuses: JobStatus[]): VideoBatchItem['status'] {
  if (jobStatuses.length === 0) return 'pending'
  if (jobStatuses.every(status => status === 'assembled')) return 'completed'
  if (jobStatuses.every(status => status === 'approved' || status === 'assembled')) return 'approved'
  if (jobStatuses.every(status => status === 'canceled')) return 'rejected'
  if (jobStatuses.some(status => status === 'failed') && jobStatuses.every(isSettledStatus)) return 'failed'
  if (jobStatuses.some(status => status === 'completed' || status === 'needs_review' || status === 'approved')) {
    return jobStatuses.every(isSettledStatus) ? 'completed' : 'generating'
  }
  if (jobStatuses.some(status => status === 'submitting' || status === 'processing')) return 'generating'
  if (jobStatuses.some(status => status === 'queued')) return 'pending'
  return 'pending'
}

function isSettledStatus(status: JobStatus): boolean {
  return ['completed', 'failed', 'canceled', 'needs_review', 'approved', 'assembled'].includes(status)
}

/** Recompute every item's status from its jobs and return a NEW item list. */
export function syncItemsWithJobs(
  items: VideoBatchItem[],
  jobs: GenerationJob[],
  now = new Date().toISOString()
): VideoBatchItem[] {
  return items.map((item) => {
    if (item.validationErrors?.length && item.status === 'failed' && item.generationJobIds.length === 0) {
      return item
    }
    const itemJobs = jobs.filter(job => job.itemId === item.itemId)
    if (itemJobs.length === 0) return item
    const outputs = itemJobs.map(job => job.outputAssetId).filter((id): id is string => !!id)
    const next: VideoBatchItem = {
      ...item,
      status: deriveItemStatus(itemJobs.map(job => job.status)),
      selectedOutputIds: outputs,
      attempts: Math.max(...itemJobs.map(job => job.attempts)),
      error: itemJobs.find(job => job.status === 'failed')?.errorMessage,
      updatedAt: now
    }
    return next
  })
}

// -----------------------------------------------------------------------------
// Batch-level controls
// -----------------------------------------------------------------------------

export interface BatchControlResult {
  ok: boolean
  error?: { code: string, message: string }
  batch: VideoBatch
  jobs: GenerationJob[]
  /** Providers that do not support cancellation keep working server-side. */
  providerCancelPending?: boolean
}

export function pauseBatch(
  batch: VideoBatch,
  jobs: GenerationJob[],
  now = new Date().toISOString()
): BatchControlResult {
  if (!['queued', 'processing', 'paused'].includes(batch.status)) {
    return {
      ok: false,
      error: { code: 'not-pausable', message: `A ${batch.status} batch cannot be paused` },
      batch,
      jobs
    }
  }
  return { ok: true, batch: { ...batch, status: 'paused', pausedAt: now }, jobs }
}

export function resumeBatch(
  batch: VideoBatch,
  jobs: GenerationJob[]
): BatchControlResult {
  if (batch.status !== 'paused') {
    return {
      ok: false,
      error: { code: 'not-paused', message: 'Only a paused batch can be resumed' },
      batch,
      jobs
    }
  }
  return { ok: true, batch: { ...batch, status: 'queued', pausedAt: undefined }, jobs }
}

/**
 * Cancel queued work. Jobs already submitted to a provider are marked canceled
 * locally but the payload still carries `providerCancelPending` — the roadmap
 * requires the UI to state that provider-side billing may continue.
 */
export function cancelBatch(
  batch: VideoBatch,
  jobs: GenerationJob[],
  now = new Date().toISOString()
): BatchControlResult {
  let providerCancelPending = false
  const nextJobs = jobs.map((job) => {
    if (job.batchId !== batch.batchId) return job
    if (!['queued', 'submitting', 'processing'].includes(job.status)) return job
    if (job.status === 'submitting' || job.status === 'processing') providerCancelPending = true
    return {
      ...job,
      status: 'canceled' as JobStatus,
      completedAt: now
    }
  })
  return {
    ok: true,
    batch: { ...batch, status: 'canceled', completedAt: now },
    jobs: nextJobs,
    providerCancelPending
  }
}

// -----------------------------------------------------------------------------
// Input helpers for the UI
// -----------------------------------------------------------------------------

/**
 * Expand one template into N input records by varying a single field — the
 * "one prompt × N variants" batch type from roadmap §6.
 */
export function expandVariants(
  template: VideoTemplate,
  values: string[],
  fieldId: string
): BatchInputRecord[] {
  const base = sampleRecordFor(template)
  return values.map((value, index) => ({
    rowIndex: index,
    label: value || `Variant ${index + 1}`,
    record: { ...base, [fieldId]: value }
  }))
}

/** Percentage 0..1 across a batch, by settled jobs. */
export function batchProgress(jobs: GenerationJob[], batchId: string): number {
  const batchJobs = jobs.filter(job => job.batchId === batchId)
  if (batchJobs.length === 0) return 0
  const done = batchJobs.filter(isJobSettled).length
  return Math.round((done / batchJobs.length) * 100) / 100
}

// =============================================================================
// Scheduled batch execution (Roadmap v1 §8, P8)
// =============================================================================

/** Schedule a batch to auto-start at a future time. */
export function scheduleBatch(
  batch: VideoBatch,
  scheduledFor: string,
  now = new Date().toISOString()
): { ok: boolean; batch?: VideoBatch; error?: { code: string; message: string } } {
  const when = Date.parse(scheduledFor)
  if (Number.isNaN(when)) {
    return { ok: false, error: { code: 'invalid-scheduled-for', message: 'scheduledFor must be a valid ISO 8601 timestamp' } }
  }
  if (when <= Date.now()) {
    return { ok: false, error: { code: 'scheduled-in-past', message: 'scheduledFor must be in the future' } }
  }
  if (batch.status !== 'draft' && batch.status !== 'queued') {
    return { ok: false, error: { code: 'not-schedulable', message: `Cannot schedule a ${batch.status} batch` } }
  }
  return { ok: true, batch: { ...batch, scheduledFor, status: 'queued', updatedAt: now } }
}

/** Remove a future start time from a batch. */
export function unscheduleBatch(
  batch: VideoBatch,
  now = new Date().toISOString()
): { ok: boolean; batch: VideoBatch } {
  return { ok: true, batch: { ...batch, scheduledFor: undefined, updatedAt: now } }
}

/**
 * Check which scheduled batches are due to start. Pure; the caller (a cron
 * tick in the main process) decides what to do with the result.
 */
export function getDueBatches(batches: VideoBatch[], now = Date.now()): VideoBatch[] {
  return batches.filter(b => b.scheduledFor && Date.parse(b.scheduledFor) <= now && b.status === 'queued')
}

// =============================================================================
// Aspect-ratio variants (Roadmap v1 §8, P8)
// =============================================================================
// Given a base batch plan, produce variant plans for additional aspect ratios
// (e.g. 9:16 → 1:1, 16:9). The template must have an assemblyProfile with
// outputProfile resolutions for each aspect ratio. Caption bands and canvas
// dimensions are recomputed per variant; the template schema stays unchanged.

export type AspectRatioVariant = '9:16' | '16:9' | '1:1' | '4:5'

export interface VariantPlanOptions {
  /** The aspect ratios to generate (subset of supported ratios). */
  variants: AspectRatioVariant[]
  /** Source aspect ratio from the base plan (defaults to template's outputProfile). */
  sourceAspectRatio?: AspectRatioVariant
}

export function createAspectRatioVariants(
  basePlan: BatchPlan,
  options: VariantPlanOptions
): BatchPlan[] {
  const variants = options.variants || ['1:1', '16:9']
  const sourceAr = options.sourceAspectRatio || '9:16'
  if (variants.includes(sourceAr)) {
    // Source is already one of the requested variants; include it once.
  }
  const plans: BatchPlan[] = []

  for (const variantAr of variants) {
    if (variantAr === sourceAr) {
      plans.push(basePlan)
      continue
    }
    // Clone and adjust the plan for the new aspect ratio.
    const plan: BatchPlan = JSON.parse(JSON.stringify(basePlan))
    plan.items = plan.items.map((item: PlannedItem) => {
      if (!item.ok) return item
      const storyboard = item.storyboard.map((scene: StoryboardScene) => ({
        ...scene,
        aspectRatio: variantAr
      }))
      return { ...item, storyboard }
    })
    plans.push(plan)
  }

  return plans
}

// =============================================================================
// Campaign management (Roadmap v1 §8, P8)
// =============================================================================

/** In-memory campaign store (persisted by the store/composable). */
export interface CampaignStore {
  campaigns: Map<string, VideoCampaign>
  batchIndex: Map<string, string[]> // campaignId -> batchIds
}

/** Create a new campaign with defaults. */
export function createCampaign(input: {
  userId: string
  title: string
  intent: string
  targetChannels: string[]
  targetAspectRatios: Array<'9:16' | '16:9' | '1:1' | '4:5'>
  targetLanguages: string[]
  templateId: string
  templateVersion: string
}): VideoCampaign {
  const now = new Date().toISOString()
  return {
    campaignId: `cmp_${Date.now().toString(36)}`,
    userId: input.userId,
    title: input.title,
    intent: input.intent,
    targetChannels: input.targetChannels,
    targetAspectRatios: input.targetAspectRatios,
    targetLanguages: input.targetLanguages,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    createdAt: now,
    updatedAt: now
  }
}

/** Link a batch to a campaign. */
export function linkBatchToCampaign(
  campaign: VideoCampaign,
  batchId: string,
  store: CampaignStore
): VideoCampaign {
  const updated = { ...campaign, updatedAt: new Date().toISOString() }
  store.campaigns.set(updated.campaignId, updated)
  const batches = store.batchIndex.get(updated.campaignId) || []
  if (!batches.includes(batchId)) {
    batches.push(batchId)
    store.batchIndex.set(updated.campaignId, batches)
  }
  return updated
}

/** Get all batches for a campaign. */
export function getCampaignBatches(campaignId: string, store: CampaignStore): string[] {
  return store.batchIndex.get(campaignId) || []
}

/** Aggregate cost/statistics across a campaign's batches. */
export function summarizeCampaign(
  campaign: VideoCampaign,
  batches: Array<{ batchId: string; status: BatchStatus; actualCostUsd: number; completedItems: number; totalItems: number }>
): {
  totalBatches: number
  totalCostUsd: number
  totalItems: number
  completedItems: number
  byStatus: Record<BatchStatus, number>
} {
  const byStatus: Record<BatchStatus, number> = {
    draft: 0, queued: 0, submitting: 0, processing: 0, paused: 0,
    completed: 0, failed: 0, canceled: 0, assembled: 0
  }
  let totalCostUsd = 0
  let totalItems = 0
  let completedItems = 0
  for (const b of batches) {
    byStatus[b.status] = (byStatus[b.status] || 0) + 1
    totalCostUsd += b.actualCostUsd || 0
    totalItems += b.totalItems
    completedItems += b.completedItems
  }
  return {
    totalBatches: batches.length,
    totalCostUsd,
    totalItems,
    completedItems,
    byStatus
  }
}
