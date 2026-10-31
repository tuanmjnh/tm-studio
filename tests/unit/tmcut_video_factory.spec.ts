/**
 * Video Factory batch orchestration (roadmap v1 §6 + §8, P5).
 *
 * The P5 acceptance criterion is that a batch runs with bounded concurrency,
 * that a failed row/job retries on its own, and that the budget cap blocks
 * further work. Those are properties of the queue math, not of a provider
 * response, so they are checked here against the pure engine and the executor
 * with a deterministic dry-run runner.
 */
import { getBuiltinVideoTemplates } from '../../app/utils/tmcut/videoTemplatePresets'
import { sampleRecordFor } from '../../app/utils/tmcut/videoTemplates'
import {
  DEFAULT_BUDGET_GUARD,
  batchProgress,
  canTransitionJob,
  cancelBatch,
  checkBudget,
  countRunningJobs,
  createBatchFromPlan,
  deriveItemStatus,
  estimateBatch,
  expandVariants,
  parseCsvRecords,
  parseJsonRecords,
  pauseBatch,
  planBatch,
  planRetry,
  recountBatch,
  resumeBatch,
  selectRunnableJobs,
  transitionJob,
  type BatchInputRecord
} from '../../app/utils/tmcut/videoFactory'
import {
  createDryRunRunner,
  runBatchStep,
  runBatchToCompletion,
  type FactoryRunner
} from '../../app/utils/tmcut/videoFactoryRunner'
import type { GenerationJob, VideoBatch, VideoBatchItem } from '../../app/types/videoFactory'
import type { VideoTemplate } from '../../app/types/videoTemplate'

let passed = 0
function check(name: string, fn: () => void | Promise<void>) {
  const result = fn()
  if (result instanceof Promise) throw new Error('use the async runner for async checks')
  passed++
  console.log(`[ok] ${name}`)
}

async function checkAsync(name: string, fn: () => Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

function productTemplate(): VideoTemplate {
  return getBuiltinVideoTemplates()[0]!
}

/** The first required text field is the row's identity (product name, topic, …). */
function requiredTextField(template: VideoTemplate): string {
  const field = template.inputSchema.find(entry => entry.required && (entry.type === 'text' || entry.type === 'textarea'))
  return field?.id || template.inputSchema[0]!.id
}

/** A copy of the record without one field (no dynamic delete). */
function withoutField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key))
}

/**
 * Rows built from the template's own defaults, so the same helper works for
 * every shipped template regardless of its input schema.
 */
function recordsFor(template: VideoTemplate, count: number): BatchInputRecord[] {
  const key = requiredTextField(template)
  const rows: BatchInputRecord[] = []
  for (let index = 0; index < count; index++) {
    rows.push({
      rowIndex: index,
      label: `Row ${index + 1}`,
      record: { ...sampleRecordFor(template), [key]: `Row ${index + 1}` }
    })
  }
  return rows
}

async function main() {
  check('CSV parsing keeps quoted commas and escapes', () => {
    const parsed = parseCsvRecords('name,description\r\n"Widget, small","He said ""hi"""\r\n')
    if (parsed.headers.join('|') !== 'name|description') throw new Error(`headers: ${parsed.headers}`)
    if (parsed.rows.length !== 1) throw new Error(`rows: ${parsed.rows.length}`)
    if (parsed.rows[0]!.name !== 'Widget, small') throw new Error(`name: ${parsed.rows[0]!.name}`)
    if (parsed.rows[0]!.description !== 'He said "hi"') throw new Error(`desc: ${parsed.rows[0]!.description}`)
  })

  check('CSV detects semicolons and JSON records refuse a non-array', () => {
    const parsed = parseCsvRecords('name;productName\nA;B\n')
    if (parsed.headers[1] !== 'productName') throw new Error('semicolon not detected')
    let threw = false
    try {
      parseJsonRecords('{"name":"x"}')
    } catch {
      threw = true
    }
    if (!threw) throw new Error('a JSON object must be rejected')
    if (parseJsonRecords('[{"name":"A"}]').length !== 1) throw new Error('valid JSON array rejected')
  })

  check('an invalid input row fails alone and the rest of the batch still plans', () => {
    const template = productTemplate()
    const records = recordsFor(template, 3)
    // Break the middle row: the template requires its identity field.
    records[1]!.record = withoutField(records[1]!.record, requiredTextField(template))
    const result = planBatch(template, records)
    if (!result.ok || !result.plan) throw new Error('plan failed')
    if (result.plan.validCount !== 2) throw new Error(`validCount: ${result.plan.validCount}`)
    if (result.plan.invalidCount !== 1) throw new Error(`invalidCount: ${result.plan.invalidCount}`)
    if (result.plan.items[1]!.ok) throw new Error('the broken row was accepted')
    if (result.plan.items[1]!.errors[0]?.code !== 'required') throw new Error('wrong error code')
  })

  check('planning refuses an empty batch, an oversized batch and an invalid template', () => {
    const template = productTemplate()
    if (planBatch(template, []).error?.code !== 'no-records') throw new Error('empty batch accepted')
    const tooMany = planBatch(template, recordsFor(template, 501))
    if (tooMany.error?.code !== 'too-many-records') throw new Error('oversized batch accepted')
    const broken = { ...template, name: '' }
    if (planBatch(broken, recordsFor(template, 1)).error?.code !== 'template-invalid') {
      throw new Error('invalid template accepted')
    }
  })

  check('estimation prices scenes, not templates, and flags the caps', () => {
    const template = productTemplate()
    const planned = planBatch(template, recordsFor(template, 2)).plan!
    const estimate = estimateBatch(planned, {
      rates: { perItemUsd: 0, perSceneUsd: 0.5, perSecondUsd: 0, currency: 'USD' },
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100 }
    })
    if (estimate.jobCount !== planned.sceneCount) throw new Error('job count must equal scene count')
    if (estimate.estimatedCostUsd !== Math.round(planned.sceneCount * 0.5 * 100) / 100) {
      throw new Error(`cost ${estimate.estimatedCostUsd} for ${planned.sceneCount} scenes`)
    }
    if (estimate.lowEstimateUsd >= estimate.estimatedCostUsd) throw new Error('low bound must be lower')

    const tiny = estimateBatch(planned, {
      rates: { perItemUsd: 0, perSceneUsd: 5, perSecondUsd: 0, currency: 'USD' },
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 1 }
    })
    if (!tiny.exceedsBatchCap) throw new Error('batch cap not detected')
    if (!tiny.reasons.includes('confirmation-required')) throw new Error('confirmation flag missing')
  })

  check('the budget guard blocks on the daily cap, not only the batch cap', () => {
    const template = productTemplate()
    const planned = planBatch(template, recordsFor(template, 1)).plan!
    const estimate = estimateBatch(planned, {
      rates: { perItemUsd: 0, perSceneUsd: 1, perSecondUsd: 0, currency: 'USD' },
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 2 }
    })
    const blocked = checkBudget(estimate, {
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 2 },
      spentTodayUsd: 1.9
    })
    if (blocked.allowed) throw new Error('daily cap not enforced')
    if (blocked.blockedBy !== 'daily-cap') throw new Error(`blockedBy: ${blocked.blockedBy}`)
    const ok = checkBudget(estimate, { budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100 } })
    if (!ok.allowed) throw new Error('a small batch must pass')
  })

  check('a queued batch creates one pinned job per scene and no job for a broken row', () => {
    const template = productTemplate()
    const records = recordsFor(template, 2)
    records[1]!.record = withoutField(records[1]!.record, requiredTextField(template))
    const plan = planBatch(template, records).plan!
    const created = createBatchFromPlan(template, plan, { now: '2026-10-24T00:00:00.000Z' })
    const sceneTotal = plan.items[0]!.sceneCount
    if (created.jobs.length !== sceneTotal) throw new Error(`jobs: ${created.jobs.length}, scenes: ${sceneTotal}`)
    if (created.batch.templateVersion !== template.version) throw new Error('version not pinned')
    if (created.jobs.some(job => job.model !== 'dry-run')) throw new Error('provider defaults missing')
    const failedItem = created.items.find(item => item.status === 'failed')!
    if (failedItem.generationJobIds.length !== 0) throw new Error('a broken row must not queue jobs')
    if (!failedItem.validationErrors?.length) throw new Error('broken row lost its validation errors')
    const first = created.jobs[0]!
    const snapshot = first.normalizedRequest as Record<string, unknown>
    if (!String(snapshot.prompt || '').length) throw new Error('prompt not snapshotted')
    if (!snapshot.aspectRatio) throw new Error('aspect ratio not snapshotted')
    if (first.attempts !== 0 || first.status !== 'queued') throw new Error('job did not start queued')
  })

  check('illegal status transitions are refused', () => {
    if (canTransitionJob('queued', 'completed')) throw new Error('queued → completed must be refused')
    if (!canTransitionJob('processing', 'completed')) throw new Error('processing → completed must be allowed')
    const job = {
      jobId: 'j1', batchId: 'b1', type: 'video', connectionId: 'c', model: 'm',
      normalizedRequest: {}, status: 'queued', attempts: 0, maxAttempts: 3,
      priority: 1, createdAt: '2026-10-24T00:00:00.000Z', estimatedCostUsd: 0
    } satisfies GenerationJob
    const bad = transitionJob(job, 'completed')
    if (bad.ok || bad.error?.code !== 'illegal-transition') throw new Error('bad transition accepted')
    const good = transitionJob(job, 'submitting')
    if (!good.ok || !good.job?.startedAt) throw new Error('submitting must stamp startedAt')
  })

  check('the scheduler respects the concurrency cap, priority and backoff', () => {
    const make = (id: string, priority: number, scheduledFor?: string): GenerationJob => ({
      jobId: id, batchId: 'b1', type: 'video', connectionId: 'c', model: 'm',
      normalizedRequest: {}, status: 'queued', attempts: 0, maxAttempts: 3,
      priority, createdAt: '2026-10-24T00:00:00.000Z', estimatedCostUsd: 0, scheduledFor
    })
    const future = new Date(Date.now() + 60_000).toISOString()
    const jobs = [make('a', 5), make('b', 9), make('c', 7, future)]
    const picked = selectRunnableJobs(jobs, { concurrencyCap: 2 })
    if (picked.map(job => job.jobId).join(',') !== 'b,a') throw new Error(`picked: ${picked.map(j => j.jobId)}`)
    const none = selectRunnableJobs(jobs, { concurrencyCap: 2, runningCount: 2 })
    if (none.length !== 0) throw new Error('cap ignored')
    const later = selectRunnableJobs(jobs, { concurrencyCap: 3, now: Date.now() + 120_000 })
    if (!later.some(job => job.jobId === 'c')) throw new Error('backoff never elapses')
  })

  check('retry policy stops on billing errors, respects Retry-After and maxAttempts', () => {
    const billing = planRetry({ attempts: 1, maxAttempts: 3, category: 'billing' })
    if (billing.retry) throw new Error('billing must not retry')
    const attempts = planRetry({ attempts: 3, maxAttempts: 3, category: 'network' })
    if (attempts.retry) throw new Error('maxAttempts ignored')
    const retryAfter = planRetry({
      attempts: 1, maxAttempts: 3, category: 'rate-limit', retryAfterSec: 30, now: 0, random: () => 0.5
    })
    if (retryAfter.delayMs !== 30_000) throw new Error(`delay: ${retryAfter.delayMs}`)
    const first = planRetry({ attempts: 1, maxAttempts: 5, category: 'network', now: 0, random: () => 0.5 })
    const second = planRetry({ attempts: 2, maxAttempts: 5, category: 'network', now: 0, random: () => 0.5 })
    if (second.delayMs <= first.delayMs) throw new Error('backoff must grow')
  })

  await checkAsync('a batch runs under a bounded concurrency cap and finishes', async () => {
    const template = productTemplate()
    const plan = planBatch(template, recordsFor(template, 2)).plan!
    const created = createBatchFromPlan(template, plan, { now: new Date().toISOString() })
    let inFlight = 0
    let peak = 0
    const runner: FactoryRunner = {
      key: 'probe',
      async run(job) {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise<void>(resolve => setTimeout(resolve, 1))
        inFlight--
        return { status: 'completed', outputAssetId: `asset:${job.jobId}`, actualCostUsd: 0.1 }
      }
    }
    const report = await runBatchToCompletion(
      { batch: created.batch, items: created.items, jobs: created.jobs },
      { runner, concurrencyCap: 2, sleep: async () => {} }
    )
    if (peak > 2) throw new Error(`peak concurrency ${peak} exceeded the cap`)
    if (peak < 2) throw new Error('the cap must actually be used')
    if (report.state.jobs.some(job => job.status !== 'completed')) {
      throw new Error(`unfinished jobs: ${report.state.jobs.map(j => j.status).join(',')}`)
    }
    const batch = recountBatch(report.state.batch, report.state.items, report.state.jobs)
    if (batch.status !== 'completed') throw new Error(`batch status: ${batch.status}`)
    if (batch.completedItems !== created.items.length) throw new Error(`completedItems: ${batch.completedItems}`)
    if (Math.abs(batch.actualCostUsd - 0.1 * created.jobs.length) > 0.001) {
      throw new Error(`actualCostUsd: ${batch.actualCostUsd}`)
    }
    if (batchProgress(report.state.jobs, batch.batchId) !== 1) throw new Error('progress must reach 1')
  })

  await checkAsync('a transient failure retries with backoff instead of failing the batch', async () => {
    const template = productTemplate()
    const plan = planBatch(template, recordsFor(template, 1)).plan!
    const created = createBatchFromPlan(template, plan, { now: new Date().toISOString() })
    let clock = Date.parse('2026-10-24T00:00:00.000Z')
    const failingJobId = created.jobs[0]!.jobId
    let failedOnce = false
    const runner: FactoryRunner = {
      key: 'flaky',
      async run(job) {
        if (job.jobId === failingJobId && !failedOnce) {
          failedOnce = true
          return { status: 'failed', error: { category: 'network', message: 'timeout', retryable: true } }
        }
        return { status: 'completed', outputAssetId: `asset:${job.jobId}` }
      }
    }
    const first = await runBatchStep(
      { batch: created.batch, items: created.items, jobs: created.jobs },
      { runner, concurrencyCap: 4, now: () => clock, random: () => 0.5 }
    )
    const retriedJob = first.state.jobs.find(job => job.jobId === failingJobId)!
    if (retriedJob.status !== 'queued') throw new Error(`expected requeue, got ${retriedJob.status}`)
    if (retriedJob.attempts !== 1) throw new Error(`attempts: ${retriedJob.attempts}`)
    if (!retriedJob.scheduledFor) throw new Error('no backoff scheduled')
    if (first.retried[0] !== failingJobId) throw new Error('retry not reported')

    // Still backing off: the step is idle and dispatches nothing.
    const idle = await runBatchStep(first.state, { runner, concurrencyCap: 4, now: () => clock })
    if (!idle.idle || idle.dispatched.length !== 0) throw new Error('backoff ignored')

    clock += 5000
    const second = await runBatchStep(idle.state, { runner, concurrencyCap: 4, now: () => clock, random: () => 0.5 })
    const finished = second.state.jobs.find(job => job.jobId === failingJobId)!
    if (finished.status !== 'completed') throw new Error(`retry did not complete: ${finished.status}`)
  })

  await checkAsync('a permanent failure settles as failed without retrying', async () => {
    const template = productTemplate()
    const plan = planBatch(template, recordsFor(template, 1)).plan!
    const created = createBatchFromPlan(template, plan, { now: new Date().toISOString() })
    const runner: FactoryRunner = {
      key: 'billing',
      async run() {
        return { status: 'failed', error: { category: 'billing', message: 'insufficient credit' } }
      }
    }
    const report = await runBatchToCompletion(
      { batch: created.batch, items: created.items, jobs: created.jobs },
      { runner, concurrencyCap: 2, sleep: async () => {} }
    )
    if (report.state.jobs.some(job => job.status !== 'failed')) throw new Error('jobs must fail')
    for (const job of report.state.jobs) {
      if (job.attempts !== 1) throw new Error(`attempts: ${job.attempts} (should not retry)`)
      if (job.errorCategory !== 'billing') throw new Error('error category lost')
    }
    const batch = recountBatch(report.state.batch, report.state.items, report.state.jobs)
    if (batch.failedItems !== created.items.length) throw new Error(`failedItems: ${batch.failedItems}`)
    if (batch.status !== 'failed') throw new Error(`batch status: ${batch.status}`)
  })

  await checkAsync('pausing stops new submissions while in-flight work still lands', async () => {
    const template = productTemplate()
    const plan = planBatch(template, recordsFor(template, 3)).plan!
    const created = createBatchFromPlan(template, plan, { now: new Date().toISOString() })
    const paused = pauseBatch(created.batch, created.jobs, '2026-10-24T00:00:00.000Z')
    if (!paused.ok || paused.batch.status !== 'paused') throw new Error('pause refused')
    const runner = createDryRunRunner()
    const report = await runBatchStep(
      { batch: paused.batch, items: created.items, jobs: paused.jobs },
      { runner, concurrencyCap: 2 }
    )
    if (!report.idle || report.dispatched.length !== 0) throw new Error('a paused batch dispatched work')
    const resumed = resumeBatch(paused.batch, paused.jobs)
    if (!resumed.ok || resumed.batch.status !== 'queued') throw new Error('resume refused')
    const after = await runBatchStep(
      { batch: resumed.batch, items: created.items, jobs: resumed.jobs },
      { runner, concurrencyCap: 2 }
    )
    if (after.dispatched.length === 0) throw new Error('resume did not dispatch')
  })

  check('cancelling a batch cancels queued jobs and flags provider-side cancellation', () => {
    const template = productTemplate()
    const plan = planBatch(template, recordsFor(template, 1)).plan!
    const created = createBatchFromPlan(template, plan, { now: new Date().toISOString() })
    const jobs = created.jobs.map((job, index) => (
      index === 0 ? { ...job, status: 'processing' as const } : job
    ))
    const canceled = cancelBatch(created.batch, jobs, '2026-10-24T00:00:00.000Z')
    if (!canceled.ok) throw new Error('cancel refused')
    if (canceled.batch.status !== 'canceled') throw new Error('batch not canceled')
    if (canceled.jobs.some(job => ['queued', 'processing', 'submitting'].includes(job.status))) {
      throw new Error('jobs left runnable after cancel')
    }
    if (!canceled.providerCancelPending) throw new Error('a processing job must flag provider cancellation')
    if (countRunningJobs(canceled.jobs) !== 0) throw new Error('running count not cleared')
  })

  check('item status is a projection of its jobs', () => {
    if (deriveItemStatus([]) !== 'pending') throw new Error('empty must be pending')
    if (deriveItemStatus(['queued', 'queued']) !== 'pending') throw new Error('queued must be pending')
    if (deriveItemStatus(['submitting', 'processing']) !== 'generating') throw new Error('running must be generating')
    if (deriveItemStatus(['completed', 'completed']) !== 'completed') throw new Error('all completed must be completed')
    if (deriveItemStatus(['failed', 'failed']) !== 'failed') throw new Error('all failed must be failed')
    if (deriveItemStatus(['canceled', 'canceled']) !== 'rejected') throw new Error('canceled must be rejected')
  })

  check('variant expansion reuses the template defaults', () => {
    const template = productTemplate()
    const variants = expandVariants(template, ['One', 'Two'], 'productName')
    if (variants.length !== 2) throw new Error('variants lost')
    if (variants[1]!.record.productName !== 'Two') throw new Error('field not overridden')
    if (variants[0]!.record.keyBenefit === undefined) throw new Error('defaults not carried over')
  })

  // ----- store ----------------------------------------------------------------

  const backing = new Map<string, string>()
  const storage = {
    get length() { return backing.size },
    clear: () => backing.clear(),
    key: (index: number) => [...backing.keys()][index] ?? null,
    getItem: (key: string) => (backing.has(key) ? backing.get(key)! : null),
    setItem: (key: string, value: string) => { backing.set(key, String(value)) },
    removeItem: (key: string) => { backing.delete(key) }
  }
  const globalScope = globalThis as Record<string, unknown>
  globalScope.localStorage = storage
  globalScope.window = { localStorage: storage }

  const { useVideoFactory } = await import('../../app/composables/useVideoFactory')
  const { useVideoTemplates } = await import('../../app/composables/useVideoTemplates')

  check('the store refuses to queue a batch that needs confirmation', () => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const records = recordsFor(template, 2)
    const previewed = factory.preview(family.templateId, family.publishedVersion!, records)
    if (!previewed.ok || !previewed.estimate) throw new Error('preview failed')
    if (!previewed.budget?.requiresConfirmation) throw new Error('this batch should need confirmation')
    const refused = factory.commit(family.templateId, family.publishedVersion!, records)
    if (refused.ok || refused.error?.code !== 'confirmation-required') {
      throw new Error(`expected confirmation-required, got ${refused.error?.code}`)
    }
    if (factory.batches.value.length !== 0) throw new Error('a refused batch must not be stored')
  })

  check('the store refuses a batch over the budget cap even when confirmed', () => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const records = recordsFor(template, 3)
    const capped = factory.commit(family.templateId, family.publishedVersion!, records, {
      confirmed: true,
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 0.01 }
    })
    if (capped.ok) throw new Error('over-cap batch was queued')
    if (capped.error?.code !== 'batch-cap') throw new Error(`code: ${capped.error?.code}`)
    if (factory.batches.value.length !== 0) throw new Error('blocked batch must not be stored')
  })

  await checkAsync('a confirmed batch runs a dry run to completion and persists', async () => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const records = recordsFor(template, 2)
    const committed = factory.commit(family.templateId, family.publishedVersion!, records, {
      confirmed: true,
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 100 }
    })
    if (!committed.ok || !committed.batchId) throw new Error(`commit failed: ${committed.error?.message}`)
    const batchId = committed.batchId
    const started = factory.batch(batchId)!
    if (started.status !== 'queued') throw new Error(`initial status: ${started.status}`)
    if (started.templateVersion !== family.publishedVersion) throw new Error('version not pinned on the batch')

    const run = await factory.run(batchId)
    if (!run.ok) throw new Error(`run failed: ${run.error}`)
    const finished = factory.batch(batchId)!
    if (finished.status !== 'completed') throw new Error(`status: ${finished.status}`)
    if (finished.completedItems !== 2) throw new Error(`completedItems: ${finished.completedItems}`)
    const jobs = factory.jobsOf(batchId)
    if (jobs.some(job => !String(job.outputAssetId || '').startsWith('dryrun:'))) {
      throw new Error('dry run outputs must be labelled')
    }
    if (!storage.getItem('tmcut_video_factory_v1')?.includes(batchId)) throw new Error('batch not persisted')

    // Review board: approve one output.
    const approved = factory.approveOutput(jobs[0]!.jobId)
    if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
    if (factory.jobsOf(batchId)[0]!.status !== 'approved') throw new Error('job not approved')

    // History/counts stay consistent after approval.
    if (factory.history.value.length === 0) throw new Error('finished batch missing from history')
    factory.removeBatch(batchId)
    if (factory.batch(batchId)) throw new Error('removeBatch left the batch behind')
    if (factory.itemsOf(batchId).length !== 0) throw new Error('removeBatch left orphan rows')
  })

  await checkAsync('a batch with broken rows still queues the good ones and reports the rest', async () => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const records = recordsFor(template, 3)
    records[2]!.record = withoutField(records[2]!.record, requiredTextField(template))
    const committed = factory.commit(family.templateId, family.publishedVersion!, records, {
      confirmed: true,
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 100 }
    })
    if (!committed.ok || !committed.batchId) throw new Error('commit failed')
    const batchId = committed.batchId
    const broken = factory.itemsOf(batchId).filter(item => item.status === 'failed')
    if (broken.length !== 1) throw new Error(`expected one failed row, got ${broken.length}`)
    if (factory.jobsOf(batchId).some(job => job.itemId === broken[0]!.itemId)) {
      throw new Error('a broken row must not queue jobs')
    }
    const run = await factory.run(batchId)
    if (!run.ok) throw new Error(`run failed: ${run.error}`)
    const finished = factory.batch(batchId)!
    if (finished.completedItems !== 2) throw new Error(`completedItems: ${finished.completedItems}`)
    if (finished.failedItems !== 1) throw new Error(`failedItems: ${finished.failedItems}`)
    factory.removeBatch(batchId)
  })

  await checkAsync('a failed job can be retried by hand, and only a failed one', async () => {
    const template = productTemplate()
    const plan = planBatch(template, recordsFor(template, 1)).plan!
    const created = createBatchFromPlan(template, plan, { now: new Date().toISOString() })
    const factory = useVideoFactory()
    // Seed the store directly through the public run path with a failing runner.
    const committed = factory.commit(
      created.batch.templateId,
      created.batch.templateVersion,
      recordsFor(template, 1),
      { confirmed: true, budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 100 } }
    )
    if (!committed.ok || !committed.batchId) throw new Error('commit failed')
    const batchId = committed.batchId
    const failing: FactoryRunner = {
      key: 'fail',
      async run() {
        return { status: 'failed', error: { category: 'invalid-prompt', message: 'rejected by moderation' } }
      }
    }
    await factory.run(batchId, { runner: failing })
    const failedJob = factory.jobsOf(batchId).find(job => job.status === 'failed')
    if (!failedJob) throw new Error('no failed job to retry')
    const retried = factory.retryJob(failedJob.jobId)
    if (!retried.ok) throw new Error(`retry refused: ${retried.error}`)
    const requeued = factory.jobsOf(batchId).find(job => job.jobId === failedJob.jobId)!
    if (requeued.status !== 'queued') throw new Error(`status after retry: ${requeued.status}`)
    if (factory.batch(batchId)!.status !== 'queued') throw new Error('batch did not reopen')
    const approved = factory.approveOutput(failedJob.jobId)
    if (approved.ok) throw new Error('a queued job must not be approvable')
    factory.removeBatch(batchId)
  })

  await checkAsync('batch records survive a reload from storage', async () => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const committed = factory.commit(family.templateId, family.publishedVersion!, recordsFor(template, 1), {
      confirmed: true,
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 100 }
    })
    if (!committed.ok || !committed.batchId) throw new Error('commit failed')
    const raw = storage.getItem('tmcut_video_factory_v1')!
    const parsed = JSON.parse(raw) as { batches: VideoBatch[], items: VideoBatchItem[] }
    if (!parsed.batches.some(batch => batch.batchId === committed.batchId)) throw new Error('batch not written')
    if (!parsed.items.some(item => item.batchId === committed.batchId)) throw new Error('items not written')
    // Items and jobs are stored with the same batchId so a reload can rebuild state.
    const state = factory.stateOf(committed.batchId)!
    if (state.items.length === 0 || state.jobs.length === 0) throw new Error('state could not be rebuilt')
    factory.removeBatch(committed.batchId)
  })

  console.log(`\n=== All ${passed} video-factory checks passed ===`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
