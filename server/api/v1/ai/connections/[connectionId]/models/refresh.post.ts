import { getRouterParam } from 'h3'
import { createAIClient, type StoredAIModel } from '@tuanmjnh/tm-ai-client'
import { tmStudioAIConfigStore, tmStudioOpen } from '../../../../../../utils/aiConfigMongo'

export default defineEventHandler(async (event) => {
  const ownerId = event.context.auth?.userId
  if (!ownerId) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const connectionId = getRouterParam(event, 'connectionId')
  if (!connectionId) throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'connectionId is required' })

  const store = tmStudioAIConfigStore(ownerId)
  const record = (await store.listConnections()).find(row => row.connectionId === connectionId)
  if (!record) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Unknown connection' })

  const client = createAIClient({
    endpoint: {
      provider: record.providerKey,
      baseUrl: record.baseUrl,
      apiKey: await tmStudioOpen(record),
      mode: 'local'
    },
    timeoutMs: 15_000,
    assertModeAllowed: () => {}
  })

  let listed
  try {
    listed = await client.listModels()
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: 'error.aiLocalUpstreamFailed',
      message: `Model discovery failed: ${String((err as Error).message || err)}`.slice(0, 300)
    })
  }

  const previous = new Map(record.models.map(model => [model.modelId, model]))
  const models: StoredAIModel[] = listed.models.map((model) => {
    const before = previous.get(model.id)
    return {
      modelId: model.id,
      ...(before?.displayName ? { displayName: before.displayName } : {}),
      enabled: before?.enabled ?? true,
      ...(before?.isPrimary ? { isPrimary: true } : {})
    }
  })
  if (models.length && !models.some(model => model.isPrimary)) models[0]!.isPrimary = true

  await store.replaceModels(connectionId, models)
  return { success: true, data: { total: models.length, enabled: models.filter(model => model.enabled).length } }
})
