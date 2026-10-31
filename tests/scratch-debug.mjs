import('./app/utils/tmcut/videoAssembly').then(async (m) => {
  const template = require('./app/utils/tmcut/videoTemplatePresets').getBuiltinVideoTemplates()[0]
  const { sampleRecordFor } = require('./app/utils/tmcut/videoTemplates')
  const { planBatch, createBatchFromPlan } = require('./app/utils/tmcut/videoFactory')
  
  const cleanTemplate = { ...template, providerPolicy: undefined }
  const plan = planBatch(cleanTemplate, [{ rowIndex: 0, label: 'T', record: sampleRecordFor(template) }])
  console.log('plan ok:', plan.ok)
  const created = createBatchFromPlan(cleanTemplate, plan.plan, { connectionId: 'dry-run' })
  console.log('items:', created.items.map(i => ({ status: i.status, error: i.error })))
  
  const input = { batch: created.batch, items: created.items, jobs: created.jobs, template: cleanTemplate, assetCatalog: [], resolveSource: (job) => ({ src: 'dryrun:' + job.jobId, simulated: true }) }
  const assembly = m.buildAssemblyPlan(input)
  console.log('assembly ok:', assembly.ok, 'error:', JSON.stringify(assembly.error))
})
