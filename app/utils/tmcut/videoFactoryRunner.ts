/**
 * Video Factory executor (Roadmap v1 §8, P5).
 *
 * The engine in `videoFactory.ts` decides WHAT runs; this module decides WHEN
 * and drives one scheduler step: take up to `concurrencyCap` runnable jobs,
 * hand them to a runner, then fold each result back through the retry policy.
 *
 * Runners implement a narrow interface instead of the full provider adapter
 * contract so the queue can be tested with a deterministic dry-run runner and
 * later pointed at a real adapter (`VideoProviderAdapter.submitJob` +
 * `getJobStatus`) without touching this loop.
 */
import type { GenerationJob, JobStatus, VideoBatch, VideoBatchItem } from '~/types/videoFactory'
import {
  countRunningJobs,
  planRetry,
  selectRunnableJobs,
  syncItemsWithJobs,
  transitionJob,
  type ErrorCategory
} from '~/utils/tmcut/videoFactory'

// Type for the IPC-invoked runner — avoids circular with useVideoFactory
export interface VideoGenerationIpc {
  submit(args: { providerId: string; input: Record<string, unknown>; idempotencyKey?: string }): Promise<{ ok: boolean; data?: { jobId: string; providerTaskId: string; status: string; estimatedCompletionSec: number } }>
  poll(args: { jobId: string }): Promise<{ ok: boolean; data?: { jobId: string; status: string; progress: number; costSoFar: number; results: Array<Record<string, unknown>>; error: string | null; etaSec?: number } }>
  cancel(args: { jobId: string }): Promise<{ ok: boolean }>
  download(args: { jobId: string; destDir?: string }): Promise<{ ok: boolean; data?: { localPath: string; checksum: string; fileSizeBytes: number; mimeType: string; width: number; height: number; durationSec: number } }>
}

export interface JobRunFailure {
  category: ErrorCategory
  message: string
  retryable?: boolean
  retryAfterSec?: number
}

export interface JobRunResult {
  status: 'completed' | 'failed' | 'canceled'
  /** TMCut asset id of the produced clip/image. */
  outputAssetId?: string
  providerTaskId?: string
  actualCostUsd?: number
  error?: JobRunFailure
  metadata?: Record<string, unknown>
}

export interface FactoryRunner {
  readonly key: string
  run(job: GenerationJob): Promise<JobRunResult>
  cancel?(job: GenerationJob): Promise<void>
}

export interface FactoryState {
  batch: VideoBatch
  items: VideoBatchItem[]
  jobs: GenerationJob[]
}

export interface StepOptions {
  runner: FactoryRunner
  concurrencyCap?: number
  now?: () => number
  random?: () => number
  /** Abort in-flight submissions (batch cancel while a step is awaiting). */
  shouldStop?: () => boolean
  /** Per-provider concurrency caps from capability manifests (rateLimitRpm). */
  providerConcurrency?: Record<string, number>
}

export interface StepReport {
  state: FactoryState
  /** Jobs that were submitted in this step (in dispatch order). */
  dispatched: string[]
  /** Jobs that failed and were re-queued with a backoff. */
  retried: string[]
  /** Jobs that reached a terminal `failed` status in this step. */
  failed: string[]
  /** True when no runnable job was available (queue empty or backing off). */
  idle: boolean
}

function nowIso(clock: () => number): string {
  return new Date(clock()).toISOString()
}

/**
 * One scheduling wave. Jobs are dispatched in parallel up to the concurrency
 * cap; the wave completes when every dispatched job has reported back.
 */
export async function runBatchStep(state: FactoryState, options: StepOptions): Promise<StepReport> {
  const clock = options.now || Date.now
  const cap = options.concurrencyCap ?? state.batch.concurrencyCap
  const paused = state.batch.status === 'paused' || state.batch.status === 'canceled'
  let jobs = [...state.jobs]
  let items = [...state.items]

  if (paused || options.shouldStop?.()) {
    return { state: { ...state, jobs, items }, dispatched: [], retried: [], failed: [], idle: true }
  }

  const runnable = selectRunnableJobs(jobs, {
    runningCount: countRunningJobs(jobs),
    concurrencyCap: cap,
    now: clock(),
    providerConcurrency: options.providerConcurrency
  })
  if (runnable.length === 0) {
    return { state: { ...state, jobs, items }, dispatched: [], retried: [], failed: [], idle: true }
  }

  // Mark every dispatched job as submitting BEFORE awaiting, so a concurrent
  // scheduler step cannot pick the same job twice.
  const ids = new Set(runnable.map(job => job.jobId))
  jobs = jobs.map((job) => {
    if (!ids.has(job.jobId)) return job
    const moved = transitionJob(job, 'submitting', {}, nowIso(clock))
    return moved.ok ? moved.job! : { ...job, status: 'submitting' as JobStatus, startedAt: nowIso(clock) }
  })

  const outcomes = await Promise.all(runnable.map(async (job) => {
    try {
      return { job, result: await options.runner.run(job) }
    } catch (error) {
      return {
        job,
        result: {
          status: 'failed' as const,
          error: {
            category: 'network' as ErrorCategory,
            message: error instanceof Error ? error.message : String(error),
            retryable: true
          }
        }
      }
    }
  }))

  const retried: string[] = []
  const failed: string[] = []

  for (const { job, result } of outcomes) {
    const index = jobs.findIndex(entry => entry.jobId === job.jobId)
    if (index === -1) continue
    const current = jobs[index]!
    // A cancel can land while the runner was awaiting: do not resurrect it.
    if (current.status === 'canceled') continue

    if (result.status === 'completed') {
      // A submitted task is always "processing" before it can complete; an
      // inline runner skips that hop, so make it explicit here.
      const accepted = current.status === 'submitting'
        ? transitionJob(current, 'processing', {}, nowIso(clock))
        : { ok: true, job: current }
      const processing = accepted.ok ? accepted.job! : current
      const moved = transitionJob(processing, 'completed', {
        outputAssetId: result.outputAssetId,
        providerTaskId: result.providerTaskId,
        actualCostUsd: result.actualCostUsd ?? processing.estimatedCostUsd,
        errorCategory: undefined,
        errorMessage: undefined,
        scheduledFor: undefined
      }, nowIso(clock))
      jobs[index] = moved.ok ? moved.job! : { ...processing, status: 'completed' as JobStatus }
      continue
    }

    if (result.status === 'canceled') {
      jobs[index] = { ...current, status: 'canceled', completedAt: nowIso(clock) }
      continue
    }

    const attempts = current.attempts + 1
    const decision = planRetry({
      attempts,
      maxAttempts: current.maxAttempts,
      category: result.error?.category,
      retryable: result.error?.retryable,
      retryAfterSec: result.error?.retryAfterSec,
      now: clock(),
      random: options.random
    })
    if (decision.retry) {
      // failed → queued is the only legal retry hop in the state machine.
      const hop = transitionJob(current, 'failed', {
        attempts,
        errorCategory: result.error?.category,
        errorMessage: result.error?.message
      }, nowIso(clock))
      const failedJob = hop.ok ? hop.job! : { ...current, status: 'failed' as JobStatus }
      const requeue = transitionJob(failedJob, 'queued', { scheduledFor: decision.scheduledFor }, nowIso(clock))
      jobs[index] = requeue.ok ? requeue.job! : { ...failedJob, status: 'queued', scheduledFor: decision.scheduledFor }
      retried.push(current.jobId)
      continue
    }

    const moved = transitionJob(current, 'failed', {
      attempts,
      errorCategory: result.error?.category ?? 'unknown',
      errorMessage: result.error?.message,
      scheduledFor: undefined
    }, nowIso(clock))
    jobs[index] = moved.ok ? moved.job! : { ...current, status: 'failed', attempts }
    failed.push(current.jobId)
  }

  items = syncItemsWithJobs(items, jobs, nowIso(clock))
  return {
    state: { ...state, jobs, items },
    dispatched: [...ids],
    retried,
    failed,
    idle: false
  }
}

export interface RunToCompletionOptions extends StepOptions {
  /** Safety valve so a pathological retry loop cannot spin forever. */
  maxSteps?: number
  onStep?: (report: StepReport) => void
  /** Injected for tests so backoff waits do not take real time. */
  sleep?: (ms: number) => Promise<void>
}

export interface RunReport {
  state: FactoryState
  steps: number
  /** True when the loop stopped because of the step cap, not because it settled. */
  truncated: boolean
}

/**
 * Drive a batch until nothing is runnable: every job settled, every remaining
 * job backing off, or the batch paused/canceled. Waits out retry backoffs.
 */
export async function runBatchToCompletion(
  state: FactoryState,
  options: RunToCompletionOptions
): Promise<RunReport> {
  const clock = options.now || Date.now
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const maxSteps = options.maxSteps ?? 1000
  let current = state
  let steps = 0

  while (steps < maxSteps) {
    const report = await runBatchStep(current, options)
    current = report.state
    options.onStep?.(report)
    steps++

    if (report.idle) {
      const queued = current.jobs.filter(job => job.status === 'queued')
      if (queued.length === 0) return { state: current, steps, truncated: false }
      // Everything left is waiting out a backoff: sleep to the earliest one.
      const soonest = Math.min(...queued.map(job => (job.scheduledFor ? Date.parse(job.scheduledFor) : clock())))
      const wait = Math.max(0, soonest - clock())
      if (wait > 0) await sleep(wait)
      else return { state: current, steps, truncated: false }
      continue
    }
    if (current.batch.status === 'paused' || current.batch.status === 'canceled') {
      return { state: current, steps, truncated: false }
    }
  }

  return { state: current, steps, truncated: true }
}

export interface DryRunRunnerOptions {
  /** Cost per generated second, used to fill `actualCostUsd`. */
  costPerSecondUsd?: number
  /** Make the run deterministic in tests. */
  failJobIds?: string[]
  delayMs?: number
}

/**
 * Deterministic offline runner: fabricates a completed job with a `dryrun:`
 * asset id. Every result carries `metadata.simulated = true` so a UI can label
 * it and nothing can mistake it for a real provider output.
 */
export function createDryRunRunner(options: DryRunRunnerOptions = {}): FactoryRunner {
  const failing = new Set(options.failJobIds || [])
  const costPerSecond = options.costPerSecondUsd ?? 0.02
  return {
    key: 'dry-run',
    async run(job) {
      if (options.delayMs) {
        await new Promise<void>(resolve => setTimeout(resolve, options.delayMs))
      }
      if (failing.has(job.jobId)) {
        return {
          status: 'failed',
          error: { category: 'provider-error', message: 'Dry run: simulated provider failure', retryable: false }
        }
      }
      const seconds = Number((job.normalizedRequest as { durationSec?: number }).durationSec) || 0
      return {
        status: 'completed',
        outputAssetId: `dryrun:${job.jobId}`,
        providerTaskId: `dryrun-${job.jobId}`,
        actualCostUsd: Math.round(seconds * costPerSecond * 100) / 100,
        metadata: { simulated: true }
      }
    }
  }
}

// =============================================================================
// Live Provider Runner (Roadmap v1 P4) — real IPC submission
// =============================================================================

export interface ProviderRunnerOptions {
  /** The IPC bridge to the IPC-invoked generation handlers. */
  ipc: VideoGenerationIpc
  /** The provider id selected in the factory UI. */
  providerId: string
  /** Poll interval for long jobs (default 2000 ms). */
  pollIntervalMs?: number
  /** Abort signal to stop polling. */
  abortSignal?: AbortSignal
  /** Download destination directory. */
  downloadDir?: string
}

/**
 * Create a factory runner that submits real jobs through the IPC handlers.
 * The renderer never sees API keys — submission, polling, cancellation and
 * download all go through the main process (controller.mjs)
 */
export function createProviderRunner(options: ProviderRunnerOptions): FactoryRunner {
  const { ipc, providerId, pollIntervalMs = 2000, abortSignal, downloadDir } = options

  async function pollUntilSettled(localJobId: string): Promise<{ status: string; costSoFar: number; results: Array<Record<string, unknown>>; error: string | null }> {
    while (!abortSignal?.aborted) {
      const result = await ipc.poll({ jobId: localJobId })
      if (!result.ok || !result.data) {
        throw { category: 'network' as ErrorCategory, message: 'Poll failed', retryable: true }
      }
      const poll = result.data
      const terminal = ['completed', 'failed', 'canceled', 'cancelled'].includes(poll.status)
      if (terminal) {
        return {
          status: poll.status,
          costSoFar: poll.costSoFar,
          results: poll.results,
          error: poll.error
        }
      }
      // Wait before next poll unless aborted. The abort listener must be
      // detached on the timeout path too, otherwise a long job stacks one
      // closure per poll tick on the same signal.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject({ category: 'network' as ErrorCategory, message: 'Aborted', retryable: false })
        }
        const timer = setTimeout(() => {
          abortSignal?.removeEventListener('abort', onAbort)
          resolve()
        }, pollIntervalMs)
        abortSignal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    throw { category: 'network' as ErrorCategory, message: 'Aborted', retryable: false }
  }

  return {
    key: `provider:${providerId}`,

    async run(job: GenerationJob): Promise<JobRunResult> {
      // 1. Submit through IPC.
      const normalizedReq = job.normalizedRequest as Record<string, unknown>
      const submitResult = await ipc.submit({
        providerId,
        input: normalizedReq,
        idempotencyKey: job.jobId
      })
      if (!submitResult.ok || !submitResult.data) {
        const msg = submitResult.ok ? 'No data in submit response' : 'Submit failed'
        throw { category: 'provider-error' as ErrorCategory, message: msg, retryable: false }
      }
      const { jobId: providerJobId, providerTaskId, estimatedCompletionSec } = submitResult.data

      // 2. Poll using the local jobId returned by submit (main keeps the mapping).
      let finalStatus: string
      let totalCostUsd = 0
      let outputAssetId: string | undefined
      try {
        const settled = await pollUntilSettled(providerJobId)
        finalStatus = settled.status
        totalCostUsd = settled.costSoFar

        // 3. On success, download into the dest dir so the renderer can import it.
        if (finalStatus === 'completed') {
          try {
            const dl = await ipc.download({ jobId: providerJobId, destDir: downloadDir || '' })
            if (dl.ok && dl.data) {
              outputAssetId = dl.data.localPath
            }
          } catch {
            // Download is best-effort here; the review board will offer "Download"
            // manually and the assembly step will report the output as offline.
          }
        }
      } catch (pollError: unknown) {
        const err = pollError as { category?: ErrorCategory; message?: string; retryable?: boolean }
        return {
          status: 'failed',
          error: {
            category: (err.category || 'network') as ErrorCategory,
            message: err.message || 'Poll/Download failed',
            retryable: err.retryable ?? true
          }
        }
      }

      if (finalStatus !== 'completed') {
        return {
          status: finalStatus === 'canceled' || finalStatus === 'cancelled' ? 'canceled' : 'failed',
          error: { category: 'provider-error', message: `Provider status: ${finalStatus}`, retryable: false },
          actualCostUsd: totalCostUsd,
          providerTaskId,
          metadata: { estimatedCompletionSec }
        }
      }

      return {
        status: 'completed',
        outputAssetId: outputAssetId || providerJobId,
        providerTaskId,
        actualCostUsd: totalCostUsd,
        metadata: { estimatedCompletionSec }
      }
    },

    async cancel(job: GenerationJob): Promise<void> {
      // Cancel via IPC using providerTaskId if available.
      const task = job.providerTaskId || job.jobId
      await ipc.cancel({ jobId: task })
    }
  }
}

// =============================================================================
// Auto runner (Roadmap v1 P7) — routes each job to its connectionId provider
// =============================================================================

export type AutoRunnerOptions = Omit<ProviderRunnerOptions, 'providerId'> & {
  providerId?: string
}

export function createAutoRunner(options: AutoRunnerOptions): FactoryRunner {
  const { ipc, pollIntervalMs = 2000, abortSignal, downloadDir } = options

  async function pollUntilSettled(localJobId: string): Promise<{ status: string; costSoFar: number; results: Array<Record<string, unknown>>; error: string | null }> {
    while (!abortSignal?.aborted) {
      const result = await ipc.poll({ jobId: localJobId })
      if (!result.ok || !result.data) {
        throw { category: 'network' as ErrorCategory, message: 'Poll failed', retryable: true }
      }
      const poll = result.data
      const terminal = ['completed', 'failed', 'canceled', 'cancelled'].includes(poll.status)
      if (terminal) {
        return { status: poll.status, costSoFar: poll.costSoFar, results: poll.results, error: poll.error }
      }
      // Same listener-detach rule as the provider runner's poll loop: one
      // closure per tick on a long-lived signal adds up over a job.
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer)
          reject({ category: 'network' as ErrorCategory, message: 'Aborted', retryable: false })
        }
        const timer = setTimeout(() => {
          abortSignal?.removeEventListener('abort', onAbort)
          resolve()
        }, pollIntervalMs)
        abortSignal?.addEventListener('abort', onAbort, { once: true })
      })
    }
    throw { category: 'network' as ErrorCategory, message: 'Aborted', retryable: false }
  }

  return {
    key: 'provider:auto',

    async run(job: GenerationJob): Promise<JobRunResult> {
      const providerId = job.connectionId
      if (!providerId || providerId === 'dry-run') {
        return { status: 'failed', error: { category: 'provider-error', message: 'Auto runner requires a valid providerId on the job', retryable: false } }
      }
      const normalizedReq = job.normalizedRequest as Record<string, unknown>
      const submitResult = await ipc.submit({ providerId, input: normalizedReq, idempotencyKey: job.jobId })
      if (!submitResult.ok || !submitResult.data) {
        const msg = submitResult.ok ? 'No data in submit response' : 'Submit failed'
        throw { category: 'provider-error' as ErrorCategory, message: msg, retryable: false }
      }
      const { jobId: providerJobId, providerTaskId, estimatedCompletionSec } = submitResult.data

      let finalStatus: string
      let totalCostUsd = 0
      let outputAssetId: string | undefined
      try {
        const settled = await pollUntilSettled(providerJobId)
        finalStatus = settled.status
        totalCostUsd = settled.costSoFar

        if (finalStatus === 'completed') {
          try {
            const dl = await ipc.download({ jobId: providerJobId, destDir: downloadDir || '' })
            if (dl.ok && dl.data) outputAssetId = dl.data.localPath
          } catch {
            // Download is best-effort; review board offers manual download.
          }
        }
      } catch (pollError: unknown) {
        const err = pollError as { category?: ErrorCategory; message?: string; retryable?: boolean }
        return { status: 'failed', error: { category: (err.category || 'network') as ErrorCategory, message: err.message || 'Poll/Download failed', retryable: err.retryable ?? true } }
      }

      if (finalStatus !== 'completed') {
        return { status: finalStatus === 'canceled' || finalStatus === 'cancelled' ? 'canceled' : 'failed', error: { category: 'provider-error', message: `Provider status: ${finalStatus}`, retryable: false }, actualCostUsd: totalCostUsd, providerTaskId, metadata: { estimatedCompletionSec } }
      }

      return { status: 'completed', outputAssetId: outputAssetId || providerJobId, providerTaskId, actualCostUsd: totalCostUsd, metadata: { estimatedCompletionSec } }
    },

    async cancel(job: GenerationJob): Promise<void> {
      const task = job.providerTaskId || job.jobId
      await ipc.cancel({ jobId: task })
    }
  }
}
