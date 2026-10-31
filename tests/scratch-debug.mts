import { getBuiltinVideoTemplates } from '../app/utils/tmcut/videoTemplatePresets'
import { sampleRecordFor } from '../app/utils/tmcut/videoTemplates'
import { planBatch, createBatchFromPlan } from '../app/utils/tmcut/videoFactory'
import { buildAssemblyPlan } from '../app/utils/tmcut/videoAssembly'

const template = getBuiltinVideoTemplates()[0]!
const cleanTemplate: any = {
  ...template,
  providerPolicy: undefined,
  assemblyProfile: { ...template.assemblyProfile, musicPolicy: { source: 'asset-center', volumeLevel: 30 } }
}
const plan = planBatch(cleanTemplate, [{ rowIndex: 0, label: 'T', record: sampleRecordFor(template) }])
if (!plan.ok) throw new Error('plan fail ' + JSON.stringify(plan.error))
const created = createBatchFromPlan(cleanTemplate, plan.plan!, { connectionId: 'dry-run' })
const musicEntry: any = {
  id: 'm1', entryId: 'm1', title: 'M', category: 'music', assetKind: 'media',
  source: { type: 'local', url: '/mock/music.mp3' }, sourceUrl: '/mock/music.mp3',
  license: { commercialUse: true, attributionRequired: false, status: 'approved', reviewer: 't', reviewedAt: new Date().toISOString() },
  tags: [], sizeBytes: 100, generationMeta: { durationSec: 30 }
}
const assembly = buildAssemblyPlan({
  batch: created.batch, items: created.items, jobs: created.jobs, template: cleanTemplate,
  assetCatalog: [musicEntry], resolveSource: (job: any) => ({ src: 'dryrun:' + job.jobId, simulated: true })
} as any)
console.log('ok:', assembly.ok, 'error:', assembly.error)
const item = assembly.plan?.items[0]
console.log('item ok:', item?.ok, 'issues:', JSON.stringify(item?.issues))
console.log('tracks:', JSON.stringify(item?.timeline?.tracks?.map(t => ({ type: t.type, name: t.name, items: t.items.length }))))
