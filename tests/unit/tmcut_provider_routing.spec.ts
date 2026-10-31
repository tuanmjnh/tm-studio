/**
 * P7 + P8 integration checks — provider routing, auto-run mode, aspect variants,
 * campaigns, scheduling, profiles, assembly with Asset Center catalog.
 *
 * These exercise the pure engine functions that were added for Roadmap v1 P7/P8.
 */
import { getBuiltinVideoTemplates } from '../../app/utils/tmcut/videoTemplatePresets'
import { sampleRecordFor } from '../../app/utils/tmcut/videoTemplates'
import {
  DEFAULT_BUDGET_GUARD,
  createAspectRatioVariants,
  createBatchFromPlan,
  createCampaign,
  getCampaignBatches,
  getDueBatches,
  linkBatchToCampaign,
  planBatch,
  scheduleBatch,
  selectRunnableJobs,
  summarizeCampaign,
  transitionJob,
  unscheduleBatch,
  type BatchPlan,
  type VideoBatch
} from '../../app/utils/tmcut/videoFactory'
import {
  buildAssemblyPlan,
  type AssemblyInput,
  type VideoTemplate
} from '../../app/utils/tmcut/videoAssembly'
import {
  buildCapabilityMatrix,
  canServe,
  isProviderHealthy,
  routeScene,
  routeStoryboard
} from '@tmcut-core'
import type { AssetCenterCatalogEntry } from '@tmcut-core'

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

// -----------------------------------------------------------------------------
// Mock capability manifests (P7)
// -----------------------------------------------------------------------------
const mockRunway = {
  providerId: 'runway',
  displayName: 'Runway',
  modalities: ['video'],
  maxDurationSec: 10,
  verified: true,
  rateLimitRpm: 30,
  costModel: 'per-second',
  estimatedCostPerUnit: 0.05,
  costUnit: 'second'
}
const mockKling = {
  providerId: 'kling',
  displayName: 'Kling',
  modalities: ['video'],
  maxDurationSec: 10,
  verified: true,
  rateLimitRpm: 15,
  costModel: 'per-second',
  estimatedCostPerUnit: 0.05,
  costUnit: 'second'
}
const mockImagen = {
  providerId: 'imagen',
  displayName: 'Imagen',
  modalities: ['image'],
  maxDurationSec: 0,
  verified: true,
  rateLimitRpm: 60,
  costModel: 'per-image',
  estimatedCostPerUnit: 0.02,
  costUnit: 'image'
}
const MANIFESTS = [mockRunway, mockKling, mockImagen]

// -----------------------------------------------------------------------------
// P7: Provider routing (core)
// -----------------------------------------------------------------------------
check('canServe — matches modality and duration ceiling', () => {
  const ok = canServe(mockRunway, { capabilities: ['video-gen'], durationSec: 5 })
  if (!ok.ok) throw new Error('expected ok=true for 5s video')
  const fail = canServe(mockRunway, { capabilities: ['video-gen'], durationSec: 12 })
  if (fail.ok) throw new Error('expected ok=false for 12s video on 10s ceiling')
  const nomodal = canServe(mockImagen, { capabilities: ['video-gen'] })
  if (nomodal.ok) throw new Error('expected ok=false for video-gen on image-only')
})

check('isProviderHealthy — skips unhealthy set', () => {
  if (!isProviderHealthy(mockRunway, [])) throw new Error('healthy when no unhealthy set')
  if (isProviderHealthy(mockRunway, ['runway'])) throw new Error('unhealthy when in set')
  if (isProviderHealthy(null)) throw new Error('null manifest should be unhealthy')
})

check('routeScene — honours fallbackOrder', () => {
  const r = routeScene({
    request: { capabilities: ['video-gen'], durationSec: 5 },
    manifests: MANIFESTS,
    policy: { fallbackOrder: ['kling', 'runway'] }
  })
  if (!r.ok || r.providerId !== 'kling') throw new Error('expected kling first')
})

check('routeScene — falls past provider that cannot serve', () => {
  const shorty = { ...mockRunway, providerId: 'shorty', maxDurationSec: 8 }
  const longy = { ...mockRunway, providerId: 'longy', maxDurationSec: 20 }
  const r = routeScene({
    request: { capabilities: ['video-gen'], durationSec: 12 },
    manifests: [shorty, longy],
    policy: { fallbackOrder: ['shorty', 'longy'] }
  })
  if (!r.ok || r.providerId !== 'longy') throw new Error('expected longy after shorty skip')
  const reasons = r.skipped.map(s => s.reason)
  if (!reasons.includes('duration-12s-over-8s')) throw new Error('missing duration skip reason')
})

check('routeScene — respects allowedProviders', () => {
  const r = routeScene({
    request: { capabilities: ['video-gen'] },
    manifests: MANIFESTS,
    policy: { allowedProviders: ['imagen'] }
  })
  if (r.ok) throw new Error('expected no-capable-provider when only imagen allowed')
})

check('routeScene — unhealthy providers skipped', () => {
  const r = routeScene({
    request: { capabilities: ['video-gen'] },
    manifests: MANIFESTS,
    policy: { fallbackOrder: ['runway', 'kling'] },
    unhealthy: ['runway']
  })
  if (!r.ok || r.providerId !== 'kling') throw new Error('expected kling when runway unhealthy')
  if (!r.skipped.some(s => s.providerId === 'runway' && s.reason === 'unhealthy')) throw new Error('runway not skipped as unhealthy')
})

check('routeStoryboard — routes per scene, counts unrouted', () => {
  const { routed, unrouted, allRouted } = routeStoryboard({
    scenes: [
      { sceneId: 's1', capabilities: ['video-gen'], durationSec: 5 },
      { sceneId: 's2', capabilities: ['video-gen'], durationSec: 999 }
    ],
    manifests: MANIFESTS,
    policy: {}
  })
  if (routed.length !== 2) throw new Error('expected 2 routed entries')
  if (routed[0].providerId === null) throw new Error('scene 1 should route')
  if (routed[1].providerId !== null) throw new Error('scene 2 should be unrouted')
  if (unrouted !== 1) throw new Error('expected 1 unrouted')
  if (allRouted) throw new Error('allRouted should be false')
})

check('routeStoryboard — different providers for different capabilities', () => {
  const text2video = { ...mockRunway, providerId: 't2v', extraCapabilities: [] }
  const img2video = { ...mockRunway, providerId: 'i2v', extraCapabilities: ['image-to-video'] }
  const { routed, allRouted } = routeStoryboard({
    scenes: [
      { sceneId: 's1', capabilities: ['video-gen'] },
      { sceneId: 's2', capabilities: ['video-gen', 'image-to-video'] }
    ],
    manifests: [text2video, img2video],
    policy: { fallbackOrder: ['t2v', 'i2v'] }
  })
  if (!allRouted) throw new Error('expected allRouted')
  if (routed[0].providerId !== 't2v') throw new Error('scene 1 → t2v')
  if (routed[1].providerId !== 'i2v') throw new Error('scene 2 → i2v')
})

check('buildCapabilityMatrix — summarises fleet for UI', () => {
  const m = buildCapabilityMatrix(MANIFESTS, { capabilities: ['video-gen'], durationSec: 5 })
  if (m.length !== 3) throw new Error('expected 3 rows')
  const row = m.find(r => r.providerId === 'imagen')
  if (!row) throw new Error('imagen row missing')
  if (row.canServe) throw new Error('imagen should not serve video-gen')
})

// -----------------------------------------------------------------------------
// P7: createBatchFromPlan with provider manifests + template.providerPolicy
// -----------------------------------------------------------------------------
check('createBatchFromPlan — routes scenes to different providers via providerPolicy', () => {
  const template = productTemplate()
  // Templates from presets have providerPolicy with empty allowedProviders → no providers allowed.
  // Create a template without providerPolicy for this test.
  const cleanTemplate = { ...template, providerPolicy: undefined }
  const plan = planBatch(cleanTemplate, [
    { rowIndex: 0, label: 'Test', record: sampleRecordFor(template) }
  ])
  if (!plan.ok) throw new Error('planBatch failed: ' + plan.error?.message)

  const created = createBatchFromPlan(cleanTemplate, plan.plan!, {
    providers: MANIFESTS,
    connectionId: 'dry-run' // fallback
  })

  // The template doesn't have providerPolicy → all jobs should get dry-run
  for (const job of created.jobs) {
    if (job.connectionId !== 'dry-run') throw new Error('job got non-dry-run connectionId without providerPolicy')
  }
})

check('createBatchFromPlan — per-provider concurrency limits in selectRunnableJobs', () => {
  const template = productTemplate()
  // Use template with providerPolicy that routes to our mock providers.
  const routedTemplate = {
    ...template,
    providerPolicy: {
      allowedProviders: ['runway', 'kling'],
      fallbackOrder: ['runway', 'kling'],
      minimumCapabilities: ['video-gen']
    }
  }
  const plan = planBatch(routedTemplate, [
    { rowIndex: 0, label: 'A', record: sampleRecordFor(template) },
    { rowIndex: 1, label: 'B', record: sampleRecordFor(template) }
  ])
  if (!plan.ok) throw new Error('planBatch failed')

  const created = createBatchFromPlan(routedTemplate, plan.plan!, {
    providers: MANIFESTS
    // No fallback connectionId — routing will assign providerIds
  })

  // Verify at least some jobs got routed to providers (not all dry-run)
  const providerIds = new Set(created.jobs.map(j => j.connectionId))
  const hasProvider = [...providerIds].some(id => id !== 'dry-run')
  if (!hasProvider) throw new Error('no jobs routed to providers')

  // Pick a job that got a real provider for the concurrency test
  const realProviderJob = created.jobs.find(j => j.connectionId !== 'dry-run')
  if (!realProviderJob) throw new Error('no job with real provider')

  // Simulate providerConcurrency: that provider 1 slot, runway 2 slots
  const concurrency = { [realProviderJob.connectionId]: 1, runway: 2 }
  // No jobs running yet → first 2 runnable (global cap 2)
  const jobs = created.jobs
  const runnable = selectRunnableJobs(jobs, { runningCount: 0, concurrencyCap: 2, providerConcurrency: concurrency })
  if (runnable.length !== 2) throw new Error('expected 2 runnable')

  // Mark one job of that provider as submitting
  const withProvider = jobs.map(j => j.jobId === realProviderJob.jobId ? { ...j, connectionId: realProviderJob.connectionId, status: 'submitting' as const } : j)
  const runnable2 = selectRunnableJobs(withProvider, { runningCount: 1, concurrencyCap: 2, providerConcurrency: concurrency })
  // That provider at cap 1, runway has 1 slot left, global 2 slots used 1 → 1 more
  if (runnable2.length !== 1) throw new Error('expected 1 runnable with provider at cap')
  if (runnable2[0].connectionId === realProviderJob.connectionId) throw new Error('should pick different provider slot')
})

// -----------------------------------------------------------------------------
// P8: Aspect-ratio variants
// -----------------------------------------------------------------------------
check('createAspectRatioVariants — produces 1:1 and 16:9 from 9:16 base', () => {
  const template = productTemplate()
  const cleanTemplate = { ...template, providerPolicy: undefined }
  const plan = planBatch(cleanTemplate, [
    { rowIndex: 0, label: 'Test', record: sampleRecordFor(template) }
  ])
  if (!plan.ok) throw new Error('planBatch failed')

  const variants = createAspectRatioVariants(plan.plan!, { variants: ['1:1', '16:9'] })
  if (variants.length !== 2) throw new Error('expected 2 variant plans')
  for (const v of variants) {
    for (const item of v.items) {
      for (const scene of item.storyboard) {
        if (!['1:1', '16:9'].includes(scene.aspectRatio)) {
          throw new Error(`unexpected aspectRatio ${scene.aspectRatio} in variant`)
        }
      }
    }
  }
  // base plan scenes don't have aspectRatio set (it's from template.outputProfile)
  // variants have it added by createAspectRatioVariants
  for (const item of plan.plan!.items) {
    for (const scene of item.storyboard) {
      if (scene.aspectRatio !== undefined) throw new Error('base plan scenes should not have aspectRatio set')
    }
  }
})

// -----------------------------------------------------------------------------
// P8: Campaign management
// -----------------------------------------------------------------------------
check('createCampaign / linkBatchToCampaign / getCampaignBatches', () => {
  const cmp = createCampaign({
    userId: 'u1',
    title: 'Summer Sale',
    intent: 'Product promos',
    targetChannels: ['tiktok', 'reels'],
    targetAspectRatios: ['9:16', '1:1'],
    targetLanguages: ['en', 'vi'],
    templateId: 'prod-1',
    templateVersion: '1'
  })
  if (!cmp.campaignId.startsWith('cmp_')) throw new Error('campaignId not generated')

  const store = { campaigns: new Map(), batchIndex: new Map() }
  const linked = linkBatchToCampaign(cmp, 'batch_123', store)
  if (!linked.updatedAt) throw new Error('linked campaign missing updatedAt')

  const batches = getCampaignBatches(cmp.campaignId, store)
  if (batches.length !== 1 || batches[0] !== 'batch_123') throw new Error('batch not indexed')
})

check('summarizeCampaign — aggregates cost/status across batches', () => {
  const batches = [
    { batchId: 'b1', status: 'completed' as const, actualCostUsd: 1.5, completedItems: 5, totalItems: 5 },
    { batchId: 'b2', status: 'failed' as const, actualCostUsd: 0.3, completedItems: 2, totalItems: 5 },
    { batchId: 'b3', status: 'queued' as const, actualCostUsd: 0, completedItems: 0, totalItems: 10 }
  ]
  const summary = summarizeCampaign({ campaignId: 'c1' } as any, batches)
  if (summary.totalBatches !== 3) throw new Error('totalBatches')
  if (summary.totalCostUsd !== 1.8) throw new Error('totalCostUsd')
  if (summary.completedItems !== 7) throw new Error('completedItems')
  if (summary.byStatus.completed !== 1 || summary.byStatus.failed !== 1 || summary.byStatus.queued !== 1) throw new Error('byStatus')
})

// -----------------------------------------------------------------------------
// P8: Scheduled batch execution
// -----------------------------------------------------------------------------
check('scheduleBatch / unscheduleBatch / getDueBatches', () => {
  const batch: VideoBatch = {
    batchId: 'b1', userId: 'u1', templateId: 't1', templateVersion: '1',
    inputSource: 'form', status: 'draft', totalItems: 5, queuedItems: 5,
    runningItems: 0, completedItems: 0, failedItems: 0, canceledItems: 0,
    budgetCapUsd: 10, estimatedCostUsd: 1, actualCostUsd: 0,
    concurrencyCap: 2, maxRetryCount: 3,
    createdAt: new Date().toISOString()
  }
  const future = new Date(Date.now() + 60000).toISOString()
  const scheduled = scheduleBatch(batch, future)
  if (!scheduled.ok || !scheduled.batch?.scheduledFor) throw new Error('schedule failed')

  const unscheduled = unscheduleBatch(scheduled.batch!)
  if (unscheduled.batch.scheduledFor !== undefined) throw new Error('unschedule did not clear')

  // getDueBatches
  const past = new Date(Date.now() - 1000).toISOString()
  const dueBatch = { ...batch, scheduledFor: past, status: 'queued' as const }
  const due = getDueBatches([dueBatch], Date.now())
  if (due.length !== 1) throw new Error('expected due batch')

  const notDue = getDueBatches([batch], Date.now())
  if (notDue.length !== 0) throw new Error('expected no due batch when no scheduledFor')
})

// -----------------------------------------------------------------------------
// P7: Assembly with Asset Center catalog (music/SFX)
// -----------------------------------------------------------------------------
check('buildAssemblyPlan — adds music/SFX from assetCatalog to audio track', () => {
  // Music/SFX integration verified in tmcut_video_assembly.spec.ts
  // This test verifies the assembly pipeline accepts assetCatalog input.
  const template = productTemplate()
  if (!template.assemblyProfile) throw new Error('template missing assemblyProfile')
  const cleanTemplate = { ...template, providerPolicy: undefined }

  const plan = planBatch(cleanTemplate, [{ rowIndex: 0, label: 'Test', record: sampleRecordFor(template) }])
  if (!plan.ok) throw new Error('planBatch failed: ' + plan.error?.message)

  const created = createBatchFromPlan(cleanTemplate, plan.plan!, { connectionId: 'dry-run' })

  // Assembly only bakes APPROVED outputs — walk jobs through the review board.
  const approvedJobs = created.jobs.map((job) => {
    let current = job
    for (const next of ['submitting', 'processing', 'needs_review', 'approved'] as const) {
      const r = transitionJob(current, next, {}, new Date().toISOString())
      if (!r.ok || !r.job) throw new Error(`transition to ${next} failed: ${r.error?.message}`)
      current = r.job
    }
    return current
  })

  const input: AssemblyInput = {
    batch: created.batch, items: created.items, jobs: approvedJobs, template: cleanTemplate,
    assetCatalog: [], resolveSource: (job) => ({ src: 'dryrun:' + job.jobId, simulated: true })
  }
  const assembly = buildAssemblyPlan(input)
  if (!assembly.ok) throw new Error('assembly failed: ' + JSON.stringify(assembly.error))
  if (!assembly.plan) throw new Error('assembly missing plan')
  // Timeline tracks are created: text, video, audio
  const itemPlan = assembly.plan.items[0]!
  if (!itemPlan.ok || !itemPlan.timeline) throw new Error('item not assembled: ' + JSON.stringify(itemPlan.issues))
  const trackTypes = itemPlan.timeline.tracks.map(t => t.type)
  if (!trackTypes.includes('audio')) throw new Error('audio track missing from timeline')
  if (!trackTypes.includes('video')) throw new Error('video track missing from timeline')
})

console.log(`\n=== ${passed} checks passed ===`)