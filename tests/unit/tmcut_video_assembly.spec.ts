/**
 * Project assembly (roadmap v1 §7, P6).
 *
 * The acceptance criterion is "an assembled project opens in Editor Studio and
 * each generated clip stays individually editable". That is a property of the
 * timeline the assembly emits — real tracks, real clip items, integer ticks — so
 * it is checked here on the pure planner plus the store's write/marking rules
 * with an injected project writer (no DOM, no Electron).
 */
import { TICKS_PER_SECOND } from '@tmcut-core'
import { getBuiltinVideoTemplates } from '../../app/utils/tmcut/videoTemplatePresets'
import { sampleRecordFor } from '../../app/utils/tmcut/videoTemplates'
import {
  DEFAULT_BUDGET_GUARD,
  createBatchFromPlan,
  deriveBatchStatus,
  labelFor,
  planBatch,
  type BatchInputRecord
} from '../../app/utils/tmcut/videoFactory'
import { buildAssemblyPlan } from '../../app/utils/tmcut/videoAssembly'
import type { GenerationJob, JobStatus, VideoBatch, VideoBatchItem } from '../../app/types/videoFactory'
import type { VideoTemplate } from '../../app/types/videoTemplate'

const FIXED_NOW = '2026-10-24T10:00:00.000Z'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
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

function requiredTextField(template: VideoTemplate): string {
  const field = template.inputSchema.find(entry => entry.required && (entry.type === 'text' || entry.type === 'textarea'))
  return field?.id || template.inputSchema[0]!.id
}

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

/** A batch plus its rows/jobs with every job forced into one status. */
function batchWith(
  template: VideoTemplate,
  rows: number,
  status: JobStatus = 'approved'
): { batch: VideoBatch, items: VideoBatchItem[], jobs: GenerationJob[] } {
  const planned = planBatch(template, recordsFor(template, rows))
  if (!planned.ok || !planned.plan) throw new Error(`plan failed: ${planned.error?.message}`)
  const created = createBatchFromPlan(template, planned.plan, { now: FIXED_NOW })
  const jobs = created.jobs.map(job => ({
    ...job,
    status,
    outputAssetId: status === 'approved' ? `asset:${job.jobId}` : undefined
  }))
  return { batch: created.batch, items: created.items, jobs }
}

function sceneCountOf(jobs: GenerationJob[]): number {
  return jobs.filter(job => job.type !== 'text').length
}

async function main() {
  // ----- planner --------------------------------------------------------------

  check('unapproved scenes block the whole row', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1, 'completed')
    const built = buildAssemblyPlan({ batch, items, jobs, template })
    if (!built.ok || !built.plan) throw new Error('plan failed')
    const item = built.plan.items[0]!
    if (item.ok) throw new Error('a row with unreviewed outputs must not be assemblable')
    if (!item.issues.some(issue => issue.code === 'not-approved')) {
      throw new Error(`expected not-approved, got ${item.issues.map(issue => issue.code).join(',')}`)
    }
    if (item.timeline) throw new Error('a blocked row must not carry a timeline')
    if (built.plan.readyCount !== 0) throw new Error('readyCount should be 0')
  })

  check('clips land end to end in scene order with the scene duration', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const built = buildAssemblyPlan({ batch, items, jobs, template })
    if (!built.ok || !built.plan) throw new Error('plan failed')
    const item = built.plan.items[0]!
    if (!item.ok || !item.timeline) throw new Error('row should be ready')

    const tracks = item.timeline.tracks
    if (tracks.length !== 3) throw new Error(`expected 3 tracks, got ${tracks.length}`)
    // The renderer exports from the FIRST video track, so assembly must use it.
    const video = tracks.find(track => track.type === 'video')!
    if (video.id !== 't-video-1') throw new Error(`video track id: ${video.id}`)
    const text = tracks.find(track => track.type === 'text')!
    if (text.id !== 't-text-1') throw new Error(`text track id: ${text.id}`)

    if (video.items.length !== sceneCountOf(jobs)) {
      throw new Error(`clips: ${video.items.length} vs scenes ${sceneCountOf(jobs)}`)
    }
    let cursor = 0
    video.items.forEach((clip, index) => {
      const job = jobs[index]!
      const durationSec = Number(job.normalizedRequest.durationSec)
      const expectedTicks = Math.round(durationSec * TICKS_PER_SECOND)
      if (clip.offset !== cursor) throw new Error(`clip ${index} offset ${clip.offset} != ${cursor}`)
      if (clip.out - clip.in !== expectedTicks) {
        throw new Error(`clip ${index} length ${clip.out - clip.in} != ${expectedTicks}`)
      }
      if (clip.in !== 0) throw new Error('generated clips start at source 0')
      if (clip.src !== `asset:${job.jobId}`) throw new Error(`clip ${index} src: ${clip.src}`)
      if (clip.id !== `clip_${job.jobId}`) throw new Error('clip id must be traceable to its job')
      cursor += expectedTicks
    })
    if (item.timeline.durationMs !== Math.round((cursor / TICKS_PER_SECOND) * 1000)) {
      throw new Error(`durationMs ${item.timeline.durationMs} vs ${cursor}`)
    }
    if (item.canvas.width !== 1080 || item.canvas.height !== 1920) {
      throw new Error(`canvas: ${item.canvas.width}x${item.canvas.height}`)
    }
  })

  check('captions use the template caption style and follow their scene', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const built = buildAssemblyPlan({ batch, items, jobs, template })
    const item = built.plan!.items[0]!
    const textTrack = item.timeline!.tracks.find(track => track.type === 'text')!
    const videoTrack = item.timeline!.tracks.find(track => track.type === 'video')!
    const withText = jobs.filter(job => String(job.normalizedRequest.onScreenText || '').trim())
    if (textTrack.items.length !== withText.length) {
      throw new Error(`captions: ${textTrack.items.length} vs ${withText.length}`)
    }
    const style = template.assemblyProfile.captionStyle
    textTrack.items.forEach((caption) => {
      if (caption.fontSize !== style.fontSize) throw new Error(`font size ${caption.fontSize}`)
      if (caption.color !== style.color) throw new Error(`caption colour ${caption.color}`)
      if (caption.text !== String(withText.find(job => caption.id === `clip_${job.jobId}:t`)!.normalizedRequest.onScreenText)) {
        throw new Error('caption text does not match the scene')
      }
      if (style.position === 'bottom' && !(caption.y! > 0)) throw new Error('bottom captions must sit below centre')
      // Aligned with the clip it belongs to.
      const clip = videoTrack.items.find(entry => entry.id === caption.id.replace(/:t$/, ''))
      if (!clip) throw new Error('caption without a matching clip')
      if (clip.offset !== caption.offset) throw new Error('caption is not aligned with its clip')
      if (clip.out !== caption.out) throw new Error('caption outlives its clip')
    })
  })

  check('the first clip has no intro transition, the rest do', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const built = buildAssemblyPlan({ batch, items, jobs, template })
    const video = built.plan!.items[0]!.timeline!.tracks.find(track => track.type === 'video')!
    const profile = template.assemblyProfile.transitionProfile
    if (video.items[0]!.transitionIn) throw new Error('the first clip must not fade in from nothing')
    video.items.slice(1).forEach((clip) => {
      if (!clip.transitionIn) throw new Error('expected an intro transition')
      if (clip.transitionIn.type !== profile.defaultType) throw new Error(`type ${clip.transitionIn.type}`)
      if (clip.transitionIn.duration !== Math.round(profile.defaultDurationSec * TICKS_PER_SECOND)) {
        throw new Error('transition duration is not in ticks')
      }
    })
  })

  check('dry-run outputs are marked simulated instead of faking a file', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const dryJobs = jobs.map(job => ({ ...job, outputAssetId: `dryrun:${job.jobId}` }))
    const built = buildAssemblyPlan({ batch, items, jobs: dryJobs, template })
    const item = built.plan!.items[0]!
    if (!item.ok) throw new Error(`dry run row should still assemble: ${item.issues[0]?.message}`)
    if (!item.simulated) throw new Error('row should be flagged simulated')
    const clip = item.timeline!.tracks.find(track => track.type === 'video')!.items[0]!
    if (clip.src) throw new Error('a dry-run clip must not claim a media source')
    if (built.plan!.simulatedCount !== 1) throw new Error('simulatedCount')
  })

  check('an approved scene without an asset blocks its row', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const broken = jobs.map((job, index) => (index === 1 ? { ...job, outputAssetId: undefined } : job))
    const built = buildAssemblyPlan({ batch, items, jobs: broken, template })
    const item = built.plan!.items[0]!
    if (item.ok) throw new Error('row with a missing asset must be blocked')
    if (!item.issues.some(issue => issue.code === 'missing-output')) throw new Error('expected missing-output')
  })

  check('an already assembled row cannot be assembled again', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const assembled = jobs.map((job, index) => (index === 0 ? { ...job, status: 'assembled' as JobStatus } : job))
    const built = buildAssemblyPlan({ batch, items, jobs: assembled, template })
    const item = built.plan!.items[0]!
    if (item.ok) throw new Error('a row already written to a project must be refused')
    if (!item.issues.some(issue => issue.code === 'already-assembled')) throw new Error('expected already-assembled')
  })

  check('source resolution and project ids are injectable', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 1)
    const built = buildAssemblyPlan({
      batch,
      items,
      jobs,
      template,
      resolveSource: job => ({ src: `file:///out/${job.jobId}.mp4` }),
      projectIdFor: item => `proj_${item.rowIndex}`
    })
    const item = built.plan!.items[0]!
    if (item.projectId !== 'proj_0') throw new Error(`projectId ${item.projectId}`)
    const clip = item.timeline!.tracks.find(track => track.type === 'video')!.items[0]!
    if (clip.src !== `file:///out/${jobs[0]!.jobId}.mp4`) throw new Error(`src ${clip.src}`)
  })

  check('row labels come from the template text field, not the row index', () => {
    const template = productTemplate()
    const { batch, items } = batchWith(template, 1)
    const key = requiredTextField(template)
    const label = labelFor(template, items[0]!.inputRecord, 0)
    if (label !== items[0]!.inputRecord[key]) throw new Error(`label ${label}`)
    const built = buildAssemblyPlan({ batch, items, jobs: [], template })
    if (built.plan!.items[0]!.projectName !== label) throw new Error('project name should carry the row label')
  })

  check('the batch reads as assembled only when every scene was assembled', () => {
    const template = productTemplate()
    const { batch, items, jobs } = batchWith(template, 2)
    const assembledJobs = jobs.map(job => ({ ...job, status: 'assembled' as JobStatus }))
    const allWritten = items.map(item => ({ ...item, assembledProjectId: `asm_${item.rowIndex}` }))
    if (deriveBatchStatus(batch, allWritten, assembledJobs) !== 'assembled') {
      throw new Error('all rows written should read as assembled')
    }
    // A half-written batch keeps its failed row's scenes approved, so the job
    // list is what decides — not the presence of some project ids.
    const halfJobs = assembledJobs.map((job, index) => (index >= assembledJobs.length / 2
      ? { ...job, status: 'approved' as JobStatus }
      : job))
    if (deriveBatchStatus(batch, items, halfJobs) === 'assembled') {
      throw new Error('a half-written batch must not read as assembled')
    }
    const stale = items.map(item => ({ ...item, assembledProjectId: `asm_${item.rowIndex}` }))
    if (deriveBatchStatus(batch, stale, jobs) === 'assembled') {
      throw new Error('unassembled jobs must not read as assembled even with project ids')
    }
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

  /** Queue a batch, run it (dry run) and approve every scene. */
  const readyBatch = async (rows: number): Promise<string> => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const committed = factory.commit(family.templateId, family.publishedVersion!, recordsFor(template, rows), {
      confirmed: true,
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 100 }
    })
    if (!committed.ok || !committed.batchId) throw new Error(`commit failed: ${committed.error?.message}`)
    const run = await factory.run(committed.batchId)
    if (!run.ok) throw new Error(`run failed: ${run.error}`)
    for (const job of factory.jobsOf(committed.batchId)) {
      const approved = factory.approveOutput(job.jobId)
      if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
    }
    return committed.batchId
  }

  await checkAsync('assembling writes one project per ready row and marks its scenes', async () => {
    const factory = useVideoFactory()
    const batchId = await readyBatch(2)
    const preview = factory.assemblyPlan(batchId)
    if (!preview.ok || !preview.plan) throw new Error(`plan failed: ${preview.error?.message}`)
    if (preview.plan.readyCount !== 2) throw new Error(`readyCount ${preview.plan.readyCount}`)

    const written: Array<{ id: string, name: string, clips: number, durationMs: number }> = []
    const result = await factory.assemble(batchId, {
      writeProject: (target) => {
        written.push({
          id: `proj_${written.length}`,
          name: target.name,
          clips: target.timeline.tracks.find(track => track.type === 'video')!.items.length,
          durationMs: target.timeline.durationMs
        })
        return `proj_${written.length - 1}`
      }
    })
    if (!result.ok) throw new Error(`assemble failed: ${result.error?.message}`)
    if (written.length !== 2) throw new Error(`projects written: ${written.length}`)
    if (result.assembled.length !== 2) throw new Error('assembled rows not reported')
    if (written[0]!.clips !== sceneCountOf(factory.jobsOf(batchId)) / 2) {
      throw new Error(`clips per project: ${written[0]!.clips}`)
    }
    if (!(written[0]!.durationMs > 0)) throw new Error('timeline has no duration')

    const jobs = factory.jobsOf(batchId)
    if (jobs.some(job => job.status !== 'assembled')) throw new Error('every approved scene must be marked assembled')
    const items = factory.itemsOf(batchId)
    if (items.some(item => !item.assembledProjectId)) throw new Error('items must point at their project')
    // The writer's id wins over the plan's deterministic one.
    if (items[0]!.assembledProjectId !== 'proj_0') throw new Error(`stored id ${items[0]!.assembledProjectId}`)
    if (factory.batch(batchId)!.status !== 'assembled') throw new Error(`status ${factory.batch(batchId)!.status}`)

    const again = await factory.assemble(batchId, { writeProject: () => 'unused' })
    if (again.ok) throw new Error('assembling twice must be refused')
    if (again.error?.code !== 'nothing-ready') throw new Error(`second call code: ${again.error?.code}`)
    if (again.assembled.length !== 0) throw new Error('second call must not write a project')
    factory.removeBatch(batchId)
  })

  await checkAsync('a resolver carried by the store reaches the written timeline', async () => {
    const factory = useVideoFactory()
    const batchId = await readyBatch(1)
    const plan = factory.assemblyPlan(batchId, {
      resolveSource: job => ({ src: `C:\\imported\\${job.jobId}.mp4` })
    }).plan!
    const previewClip = plan.items[0]!.timeline!.tracks.find(track => track.type === 'video')!.items[0]!
    if (previewClip.src !== `C:\\imported\\${previewClip.id.replace(/^clip_/, '')}.mp4`) {
      throw new Error(`preview src: ${previewClip.src}`)
    }

    let written: string | undefined
    const result = await factory.assemble(batchId, {
      resolveSource: job => ({ src: `C:\\imported\\${job.jobId}.mp4` }),
      writeProject: (target) => {
        written = target.timeline.tracks.find(track => track.type === 'video')!.items[0]!.src
        return 'proj_resolved'
      }
    })
    if (!result.ok) throw new Error(`assemble failed: ${result.error?.message}`)
    if (!written?.startsWith('C:\\imported\\')) throw new Error(`written src: ${written}`)
    factory.removeBatch(batchId)
  })

  await checkAsync('a refused write leaves that row approved instead of losing it', async () => {
    const factory = useVideoFactory()
    const batchId = await readyBatch(2)
    const result = await factory.assemble(batchId, {
      writeProject: (target) => {
        if (target.name.includes('Row 2')) throw new Error('disk full')
        return `ok_${target.projectId}`
      }
    })
    if (result.ok) throw new Error('a partial failure must not report success')
    if (result.assembled.length !== 1) throw new Error(`assembled ${result.assembled.length}`)
    if (result.failed.length !== 1) throw new Error(`failed ${result.failed.length}`)
    if (!result.failed[0]!.message.includes('disk full')) throw new Error('the writer error must be surfaced')

    const items = factory.itemsOf(batchId)
    const lost = items.find(item => !item.assembledProjectId)!
    if (!lost) throw new Error('the failed row must not be marked assembled')
    const lostJobs = factory.jobsOf(batchId).filter(job => job.itemId === lost.itemId)
    if (lostJobs.some(job => job.status !== 'approved')) throw new Error('the failed row must stay approved')
    if (factory.batch(batchId)!.status === 'assembled') throw new Error('the batch is not fully assembled')
    factory.removeBatch(batchId)
  })

  await checkAsync('an unapproved batch has nothing to assemble', async () => {
    const factory = useVideoFactory()
    const catalog = useVideoTemplates()
    const family = catalog.families.value.find(entry => entry.publishedVersion)!
    const template = catalog.getVersion(family.templateId, family.publishedVersion!)!
    const committed = factory.commit(family.templateId, family.publishedVersion!, recordsFor(template, 1), {
      confirmed: true,
      budget: { ...DEFAULT_BUDGET_GUARD, maxBatchBudgetUsd: 100, maxTotalSpendDailyUsd: 100 }
    })
    if (!committed.ok || !committed.batchId) throw new Error('commit failed')
    await factory.run(committed.batchId)
    // Completed but not approved: the review board is the gate.
    const refused = await factory.assemble(committed.batchId, { writeProject: () => 'x' })
    if (refused.ok) throw new Error('unreviewed outputs must not be assembled')
    if (refused.error?.code !== 'nothing-ready') throw new Error(`code: ${refused.error?.code}`)
    const plan = factory.assemblyPlan(committed.batchId).plan!
    if (plan.blockedCount !== 1) throw new Error('the row should be blocked')
    factory.removeBatch(committed.batchId)
  })

  console.log(`\n=== All ${passed} assembly checks passed ===`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
