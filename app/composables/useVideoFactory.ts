/**
 * Video Factory store (Roadmap v1 §6 / §8 / §9, P5).
 *
 * Owns the durable batch records — batches, items and generation jobs — and
 * exposes the controls the roadmap requires: plan/estimate, explicit
 * confirmation, pause, resume, cancel, per-job retry and a dry run.
 *
 * Persistence is localStorage for now (`tmcut_video_factory_v1`), matching the
 * template store; the pure engine in `~/utils/tmcut/videoFactory` is what makes
 * swapping in a TM Hub / Supabase table a single-file change.
 *
 * There is deliberately NO real provider wiring yet: `runDryRun` uses the
 * deterministic offline runner and every output it produces is prefixed
 * `dryrun:` with `metadata.simulated = true`. P4 (one live provider adapter)
 * plugs into the same `FactoryRunner` interface.
 */
import { computed, ref } from 'vue'
import type {
  GenerationJob,
  JobStatus,
  VideoBatch,
  VideoBatchItem
} from '~/types/videoFactory'
import type { VideoTemplate } from '~/types/videoTemplate'
import {
  DEFAULT_BUDGET_GUARD,
  cancelBatch as cancelBatchIn,
  checkBudget,
  createBatchFromPlan,
  estimateBatch,
  pauseBatch as pauseBatchIn,
  planBatch,
  recountBatch,
  resumeBatch as resumeBatchIn,
  syncItemsWithJobs,
  transitionJob,
  type BatchEstimate,
  type BatchInputRecord,
  type BatchPlan,
  type BudgetCheck,
  type CostRates
} from '~/utils/tmcut/videoFactory'
import {
  createDryRunRunner,
  runBatchToCompletion,
  type FactoryRunner,
  type FactoryState
} from '~/utils/tmcut/videoFactoryRunner'
import {
  buildAssemblyPlan,
  type AssemblyPlan,
  type AssemblySource
} from '~/utils/tmcut/videoAssembly'
import type { TmcutTrack } from '~/composables/useTmcutProject'
import { useVideoTemplates } from '~/composables/useVideoTemplates'

const STORAGE_KEY = 'tmcut_video_factory_v1'
/** Keep history bounded: localStorage is not a database. */
const MAX_STORED_BATCHES = 25

interface FactoryStorage {
  batches: VideoBatch[]
  items: VideoBatchItem[]
  jobs: GenerationJob[]
}

const batches = ref<VideoBatch[]>([])
const items = ref<VideoBatchItem[]>([])
const jobs = ref<GenerationJob[]>([])
const loaded = ref(false)
const lastError = ref<string | null>(null)
/** Batches currently being driven by a runner in this session. */
const running = ref<string[]>([])

function ensureLoaded() {
  if (loaded.value || typeof window === 'undefined') return
  loaded.value = true
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as Partial<FactoryStorage>
    if (Array.isArray(parsed.batches)) batches.value = parsed.batches.filter(isBatch)
    if (Array.isArray(parsed.items)) items.value = parsed.items.filter(isBatchItem)
    if (Array.isArray(parsed.jobs)) jobs.value = parsed.jobs.filter(isJob)
  } catch (error) {
    console.warn('[useVideoFactory] Failed to read stored batches', error)
  }
}

function isBatch(value: unknown): value is VideoBatch {
  const candidate = value as Partial<VideoBatch> | null
  return !!candidate && typeof candidate.batchId === 'string' && typeof candidate.status === 'string'
}

function isBatchItem(value: unknown): value is VideoBatchItem {
  const candidate = value as Partial<VideoBatchItem> | null
  return !!candidate && typeof candidate.itemId === 'string' && typeof candidate.batchId === 'string'
}

function isJob(value: unknown): value is GenerationJob {
  const candidate = value as Partial<GenerationJob> | null
  return !!candidate && typeof candidate.jobId === 'string' && typeof candidate.batchId === 'string'
}

function persist() {
  if (typeof window === 'undefined') return
  try {
    // Drop the oldest batches (and their rows) instead of growing forever.
    const sorted = [...batches.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const keep = new Set(sorted.slice(0, MAX_STORED_BATCHES).map(batch => batch.batchId))
    const dropped = sorted.slice(MAX_STORED_BATCHES).map(batch => batch.batchId)
    if (dropped.length > 0) {
      const droppedSet = new Set(dropped)
      batches.value = batches.value.filter(batch => keep.has(batch.batchId))
      items.value = items.value.filter(item => keep.has(item.batchId))
      jobs.value = jobs.value.filter(job => keep.has(job.batchId))
      void droppedSet
    }
    const snapshot: FactoryStorage = {
      batches: batches.value,
      items: items.value,
      jobs: jobs.value
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch (error) {
    console.warn('[useVideoFactory] Failed to persist batches', error)
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Replace one batch + its rows from a state snapshot. */
function writeState(state: FactoryState) {
  const batchIndex = batches.value.findIndex(batch => batch.batchId === state.batch.batchId)
  if (batchIndex === -1) batches.value = [state.batch, ...batches.value]
  else {
    const next = [...batches.value]
    next[batchIndex] = state.batch
    batches.value = next
  }
  const otherItems = items.value.filter(item => item.batchId !== state.batch.batchId)
  items.value = [...state.items, ...otherItems]
  const otherJobs = jobs.value.filter(job => job.batchId !== state.batch.batchId)
  jobs.value = [...state.jobs, ...otherJobs]
}

export interface BatchPreview {
  ok: boolean
  error?: { code: string, message: string }
  template?: VideoTemplate
  plan?: BatchPlan
  estimate?: BatchEstimate
  budget?: BudgetCheck
}

export interface CommitBatchOptions {
  inputSource?: VideoBatch['inputSource']
  budget?: typeof DEFAULT_BUDGET_GUARD
  /** The user pressed the confirm button on the review step. */
  confirmed?: boolean
}

/** What the assembly step hands to the project store. */
export interface AssemblyProjectTarget {
  projectId: string
  name: string
  canvas: { width: number, height: number, fps: { numerator: number, denominator: number } }
  timeline: { tracks: TmcutTrack[], durationMs: number }
}

/**
 * Creates the editor project from a plan. Injected rather than imported so the
 * assembly logic stays testable without the DOM-bound project store, and so the
 * caller owns "what a project even is" (the editor page does).
 */
export type AssemblyProjectWriter = (target: AssemblyProjectTarget) => string | Promise<string>

/** Overrides where a clip's media comes from (imported library asset, …). */
export type AssemblySourceResolver = (job: GenerationJob) => AssemblySource | undefined

/** Read-only assembly preview options. */
export interface AssemblyPlanOptions {
  resolveSource?: AssemblySourceResolver
}

export interface AssembleResult {
  ok: boolean
  error?: { code: string, message: string }
  plan?: AssemblyPlan
  assembled: Array<{ itemId: string, projectId: string, name: string, clipCount: number, simulated: boolean }>
  failed: Array<{ itemId: string, message: string }>
}

export function useVideoFactory() {
  ensureLoaded()
  const templates = useVideoTemplates()

  function templateFor(templateId: string, version: string): VideoTemplate | undefined {
    return templates.getVersion(templateId, version)
  }

  function spentTodayUsd(): number {
    const today = nowIso().slice(0, 10)
    return Math.round(
      jobs.value
        .filter(job => (job.completedAt || job.createdAt).slice(0, 10) === today)
        .reduce((sum, job) => sum + (job.actualCostUsd ?? 0), 0) * 100
    ) / 100
  }

  function batch(batchId: string): VideoBatch | undefined {
    return batches.value.find(entry => entry.batchId === batchId)
  }

  function itemsOf(batchId: string): VideoBatchItem[] {
    return items.value
      .filter(item => item.batchId === batchId)
      .sort((a, b) => a.rowIndex - b.rowIndex)
  }

  function jobsOf(batchId: string): GenerationJob[] {
    return jobs.value
      .filter(job => job.batchId === batchId)
      .sort((a, b) => a.jobId.localeCompare(b.jobId))
  }

  function stateOf(batchId: string): FactoryState | undefined {
    const target = batch(batchId)
    if (!target) return undefined
    return { batch: target, items: itemsOf(batchId), jobs: jobsOf(batchId) }
  }

  /**
   * Step 5 of the flow: validate rows, build the storyboard, price the batch and
   * run it past the budget guard. Nothing is written to storage here.
   */
  function preview(
    templateId: string,
    version: string,
    records: BatchInputRecord[],
    options: { budget?: typeof DEFAULT_BUDGET_GUARD, rates?: CostRates } = {}
  ): BatchPreview {
    const template = templateFor(templateId, version)
    if (!template) {
      return { ok: false, error: { code: 'template-not-found', message: `No template ${templateId}@${version}` } }
    }
    const planned = planBatch(template, records)
    if (!planned.ok || !planned.plan) {
      return { ok: false, error: planned.error || { code: 'plan-failed', message: 'Batch planning failed' } }
    }
    const budget = options.budget || DEFAULT_BUDGET_GUARD
    const estimate = estimateBatch(planned.plan, {
      budget,
      rates: options.rates,
      runningNow: running.value.length
    })
    const guard = checkBudget(estimate, { budget, spentTodayUsd: spentTodayUsd() })
    return { ok: true, template, plan: planned.plan, estimate, budget: guard }
  }

  /**
   * Steps 6–7: create the durable records. Refused when the budget guard blocks
   * the batch, or when the user has not confirmed a run over the threshold.
   */
  function commit(
    templateId: string,
    version: string,
    records: BatchInputRecord[],
    options: CommitBatchOptions = {}
  ): { ok: boolean, batchId?: string, error?: { code: string, message: string }, preview?: BatchPreview } {
    const previewed = preview(templateId, version, records, { budget: options.budget })
    if (!previewed.ok || !previewed.template || !previewed.plan || !previewed.estimate || !previewed.budget) {
      lastError.value = previewed.error?.message || 'Batch could not be planned'
      return { ok: false, error: previewed.error, preview: previewed }
    }
    if (previewed.plan.validCount === 0) {
      // Every row failed validation: queueing would produce an empty batch that
      // reports "failed" without ever explaining why.
      const message = 'No row passed validation — fix the input data first'
      lastError.value = message
      return { ok: false, error: { code: 'no-valid-rows', message }, preview: previewed }
    }
    if (!previewed.budget.allowed) {
      const message = `Batch estimate ${previewed.estimate.estimatedCostUsd} ${previewed.estimate.currency} exceeds the ${previewed.budget.blockedBy} limit`
      lastError.value = message
      return { ok: false, error: { code: previewed.budget.blockedBy || 'budget', message }, preview: previewed }
    }
    if (previewed.budget.requiresConfirmation && !options.confirmed) {
      const message = 'This batch needs explicit confirmation before it runs'
      lastError.value = message
      return { ok: false, error: { code: 'confirmation-required', message }, preview: previewed }
    }

    const budget = options.budget || DEFAULT_BUDGET_GUARD
    const created = createBatchFromPlan(previewed.template, previewed.plan, {
      inputSource: options.inputSource || 'form',
      budget,
      estimatedCostUsd: previewed.estimate.estimatedCostUsd,
      perJobCostUsd: previewed.plan.sceneCount > 0
        ? Math.round((previewed.estimate.estimatedCostUsd / previewed.plan.sceneCount) * 10000) / 10000
        : 0
    })
    writeState({
      batch: recountBatch(created.batch, created.items, created.jobs),
      items: syncItemsWithJobs(created.items, created.jobs),
      jobs: created.jobs
    })
    persist()
    lastError.value = null
    return { ok: true, batchId: created.batch.batchId, preview: previewed }
  }

  /**
   * Run a batch with a runner. Defaults to the offline dry run, which is the
   * only runner available until a provider connection exists (P4).
   */
  async function run(
    batchId: string,
    options: { runner?: FactoryRunner, concurrencyCap?: number, providerConcurrency?: Record<string, number> } = {}
  ): Promise<{ ok: boolean, error?: string, steps?: number, truncated?: boolean }> {
    const initial = stateOf(batchId)
    if (!initial) return { ok: false, error: `No batch ${batchId}` }
    if (initial.batch.status === 'paused' || initial.batch.status === 'canceled') {
      return { ok: false, error: `Batch is ${initial.batch.status}` }
    }
    if (running.value.includes(batchId)) return { ok: false, error: 'Batch is already running' }

    running.value = [...running.value, batchId]
    try {
      const report = await runBatchToCompletion(initial, {
        runner: options.runner || createDryRunRunner(),
        concurrencyCap: options.concurrencyCap ?? initial.batch.concurrencyCap,
        providerConcurrency: options.providerConcurrency,
        onStep: (step) => {
          // Write each wave so a crash mid-batch keeps completed work.
          writeState({
            ...step.state,
            batch: recountBatch(step.state.batch, step.state.items, step.state.jobs)
          })
          persist()
        }
      })
      writeState({
        ...report.state,
        batch: recountBatch(report.state.batch, report.state.items, report.state.jobs)
      })
      persist()
      lastError.value = null
      return { ok: true, steps: report.steps, truncated: report.truncated }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError.value = message
      return { ok: false, error: message }
    } finally {
      running.value = running.value.filter(id => id !== batchId)
    }
  }

  function pause(batchId: string) {
    const state = stateOf(batchId)
    if (!state) return { ok: false, error: { code: 'not-found', message: 'No such batch' } }
    const result = pauseBatchIn(state.batch, state.jobs, nowIso())
    if (result.ok) {
      writeState({ ...state, batch: result.batch, jobs: result.jobs })
      persist()
    }
    return result
  }

  function resume(batchId: string) {
    const state = stateOf(batchId)
    if (!state) return { ok: false, error: { code: 'not-found', message: 'No such batch' } }
    const result = resumeBatchIn(state.batch, state.jobs)
    if (result.ok) {
      writeState({ ...state, batch: result.batch, jobs: result.jobs })
      persist()
    }
    return result
  }

  function cancel(batchId: string): {
    ok: boolean
    error?: { code: string, message: string }
    providerCancelPending?: boolean
  } {
    const state = stateOf(batchId)
    if (!state) return { ok: false, error: { code: 'not-found', message: 'No such batch' } }
    const result = cancelBatchIn(state.batch, state.jobs, nowIso())
    if (result.ok) {
      const nextJobs = result.jobs
      writeState({
        ...state,
        batch: recountBatch(result.batch, syncItemsWithJobs(state.items, nextJobs), nextJobs),
        items: syncItemsWithJobs(state.items, nextJobs),
        jobs: nextJobs
      })
      persist()
    }
    return {
      ok: result.ok,
      error: result.error,
      providerCancelPending: result.providerCancelPending
    }
  }

  /** Manual retry of one failed job (respects the state machine). */
  function retryJob(jobId: string): { ok: boolean, error?: string } {
    const current = jobs.value.find(job => job.jobId === jobId)
    if (!current) return { ok: false, error: `No job ${jobId}` }
    if (current.status !== 'failed') return { ok: false, error: `Job is ${current.status}, not failed` }
    const hop = transitionJob(current, 'queued', { scheduledFor: undefined, errorMessage: undefined }, nowIso())
    if (!hop.ok) return { ok: false, error: hop.error?.message }
    const nextJobs = jobs.value.map(job => (job.jobId === jobId ? hop.job! : job))
    const batch = batches.value.find(entry => entry.batchId === current.batchId)
    const nextItems = syncItemsWithJobs(items.value, nextJobs)
    if (batch) {
      const resumed: VideoBatch = { ...batch, status: 'queued', completedAt: undefined }
      writeState({ batch: recountBatch(resumed, nextItems, nextJobs), items: nextItems, jobs: nextJobs })
    } else {
      jobs.value = nextJobs
      items.value = nextItems
    }
    persist()
    return { ok: true }
  }

  /** Approve a finished job's output (review board). */
  function approveOutput(jobId: string): { ok: boolean, error?: string } {
    const current = jobs.value.find(job => job.jobId === jobId)
    if (!current) return { ok: false, error: `No job ${jobId}` }
    if (!['completed', 'needs_review'].includes(current.status)) {
      return { ok: false, error: `Job is ${current.status}; only completed or needs_review outputs can be approved` }
    }
    const hop = transitionJob(current, 'approved', {}, nowIso())
    if (!hop.ok) return { ok: false, error: hop.error?.message }
    const nextJobs = jobs.value.map(job => (job.jobId === jobId ? hop.job! : job))
    const nextItems = syncItemsWithJobs(items.value, nextJobs)
    const batchEntry = batches.value.find(entry => entry.batchId === current.batchId)
    if (batchEntry) {
      writeState({ batch: recountBatch(batchEntry, nextItems, nextJobs), items: nextItems, jobs: nextJobs })
    } else {
      jobs.value = nextJobs
      items.value = nextItems
    }
    persist()
    return { ok: true }
  }

  /**
   * Read-only assembly preview: which rows are ready, which are blocked, and
   * what timeline each row would produce. Nothing is written.
   */
  function assemblyPlan(
    batchId: string,
    options: AssemblyPlanOptions = {}
  ): { ok: boolean, error?: { code: string, message: string }, plan?: AssemblyPlan } {
    const state = stateOf(batchId)
    if (!state) return { ok: false, error: { code: 'not-found', message: `No batch ${batchId}` } }
    const template = templateFor(state.batch.templateId, state.batch.templateVersion)
    if (!template) {
      return {
        ok: false,
        error: { code: 'template-not-found', message: `Template ${state.batch.templateId}@${state.batch.templateVersion} is missing` }
      }
    }
    const built = buildAssemblyPlan({
      batch: state.batch,
      items: state.items,
      jobs: state.jobs,
      template,
      resolveSource: options.resolveSource
    })
    if (!built.ok || !built.plan) return { ok: false, error: built.error }
    return { ok: true, plan: built.plan }
  }

  /**
   * P6: write every ready row into an editor project and mark its scenes
   * assembled. A row is written only when all of its scenes are approved; the
   * marking runs AFTER the writer succeeds, so a failed write leaves the row
   * approvable instead of losing it to a project that does not exist.
   */
  async function assemble(
    batchId: string,
    options: { writeProject: AssemblyProjectWriter, resolveSource?: AssemblySourceResolver }
  ): Promise<AssembleResult> {
    const prepared = assemblyPlan(batchId, { resolveSource: options.resolveSource })
    if (!prepared.ok || !prepared.plan) {
      return { ok: false, error: prepared.error, assembled: [], failed: [] }
    }
    const ready = prepared.plan.items.filter(item => item.ok && item.timeline)
    if (ready.length === 0) {
      return {
        ok: false,
        error: { code: 'nothing-ready', message: 'No row is ready — every scene of a row must be approved first' },
        plan: prepared.plan,
        assembled: [],
        failed: []
      }
    }

    const assembled: AssembleResult['assembled'] = []
    const failed: AssembleResult['failed'] = []
    let nextJobs = stateOf(batchId)!.jobs
    let nextItems = stateOf(batchId)!.items

    for (const item of ready) {
      let writtenProjectId = item.projectId
      try {
        // The writer returns the id it actually created: the project store owns
        // id generation, so the plan's id is only a deterministic fallback.
        const written = await options.writeProject({
          projectId: item.projectId,
          name: item.projectName,
          canvas: { ...item.canvas, fps: item.fps },
          timeline: { tracks: item.timeline!.tracks, durationMs: item.timeline!.durationMs }
        })
        if (written) writtenProjectId = written
      } catch (error) {
        failed.push({ itemId: item.itemId, message: error instanceof Error ? error.message : String(error) })
        continue
      }

      const stamp = nowIso()
      nextJobs = nextJobs.map((job) => {
        if (job.itemId !== item.itemId || job.status !== 'approved') return job
        const hop = transitionJob(job, 'assembled', {}, stamp)
        return hop.ok ? hop.job! : job
      })
      nextItems = nextItems.map(entry => (entry.itemId === item.itemId
        ? { ...entry, assembledProjectId: writtenProjectId, updatedAt: stamp }
        : entry))

      assembled.push({
        itemId: item.itemId,
        projectId: writtenProjectId,
        name: item.projectName,
        clipCount: item.timeline!.clipCount,
        simulated: item.simulated
      })
    }

    if (assembled.length > 0) {
      nextItems = syncItemsWithJobs(nextItems, nextJobs)
      const current = batches.value.find(entry => entry.batchId === batchId)
      if (current) {
        writeState({ batch: recountBatch(current, nextItems, nextJobs), items: nextItems, jobs: nextJobs })
        persist()
      }
    }

    return {
      ok: failed.length === 0 && assembled.length > 0,
      error: failed.length > 0
        ? { code: 'write-failed', message: `${failed.length} row(s) could not be written` }
        : undefined,
      plan: assemblyPlan(batchId, { resolveSource: options.resolveSource }).plan || prepared.plan,
      assembled,
      failed
    }
  }

  function removeBatch(batchId: string) {
    batches.value = batches.value.filter(entry => entry.batchId !== batchId)
    items.value = items.value.filter(item => item.batchId !== batchId)
    jobs.value = jobs.value.filter(job => job.batchId !== batchId)
    persist()
  }

  const activeBatches = computed(() =>
    batches.value.filter(entry => ['queued', 'submitting', 'processing', 'paused'].includes(entry.status))
  )

  const history = computed(() =>
    [...batches.value]
      .filter(entry => !activeBatches.value.includes(entry))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  )

  function isRunning(batchId: string): boolean {
    return running.value.includes(batchId)
  }

  function jobStatusCounts(batchId: string): Record<JobStatus, number> {
    const counts = {} as Record<JobStatus, number>
    for (const job of jobsOf(batchId)) {
      counts[job.status] = (counts[job.status] || 0) + 1
    }
    return counts
  }

  function batchProgress(batchId: string): number {
    const batchEntry = batch(batchId)
    if (!batchEntry) return 0
    const jobList = jobsOf(batchId)
    if (jobList.length === 0) return 0
    const settled = jobList.filter(job =>
      ['completed', 'failed', 'canceled', 'needs_review', 'approved', 'assembled'].includes(job.status)
    ).length
    return Math.round((settled / jobList.length) * 100)
  }

  return {
    batches,
    activeBatches,
    history,
    items,
    jobs,
    lastError,
    spentTodayUsd,
    batch,
    itemsOf,
    jobsOf,
    stateOf,
    preview,
    commit,
    assemblyPlan,
    assemble,
    run,
    pause,
    resume,
    cancel,
    retryJob,
    approveOutput,
    removeBatch,
    isRunning,
    jobStatusCounts,
    batchProgress
  }
}
