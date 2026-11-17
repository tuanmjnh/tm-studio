import { getRouterParam } from 'h3'
import { createAIClient } from '@tuanmjnh/tm-ai-client'
import { tmStudioAIConfigStore, tmStudioOpen } from '../../../../../utils/aiConfigMongo'

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

  const model = record.models.find(entry => entry.isPrimary)?.modelId
    || record.models.find(entry => entry.enabled)?.modelId
  if (!model) throw createError({ statusCode: 400, statusMessage: 'error.aiNoModel', message: 'No enabled model to test' })

  const started = Date.now()
  try {
    const client = createAIClient({
      endpoint: {
        provider: record.providerKey,
        baseUrl: record.baseUrl,
        apiKey: await tmStudioOpen(record),
        mode: 'local'
      },
      timeoutMs: 20_000,
      assertModeAllowed: () => {}
    })
    const result = await client.chat({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      maxTokens: 256
    })
    return {
      success: true,
      data: { ok: true, message: String(result.content || 'OK').slice(0, 120), latencyMs: Date.now() - started }
    }
  } catch (err) {
    return {
      success: true,
      data: { ok: false, message: String((err as Error).message || err).slice(0, 300), latencyMs: Date.now() - started }
    }
  }
})
