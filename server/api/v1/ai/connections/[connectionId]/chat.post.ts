import { getRouterParam } from 'h3'
import { createAIClient, type AIMessage } from '@tuanmjnh/tm-ai-client'
import { tmStudioAIConfigStore, tmStudioOpen } from '../../../../../utils/aiConfigMongo'

interface Body {
  messages?: unknown
  maxTokens?: unknown
  temperature?: unknown
}

export default defineEventHandler(async (event) => {
  const ownerId = event.context.auth?.userId
  if (!ownerId) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const connectionId = getRouterParam(event, 'connectionId') || ''
  if (!connectionId) throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'connectionId is required' })
  const body = (await readBody<Body>(event)) ?? {}

  const rawMessages = Array.isArray(body.messages) ? body.messages : []
  const messages: AIMessage[] = rawMessages
    .map((m: Record<string, unknown>) => ({
      role: String(m?.role ?? ''),
      content: String(m?.content ?? '')
    }))
    .map(m => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role as AIMessage['role'] : 'user', content: m.content }))
    .filter(m => m.content.trim())
  if (!messages.length) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'messages array with content is required' })
  }
  const maxTokens = typeof body.maxTokens === 'number' && body.maxTokens > 0 && body.maxTokens <= 32_767
    ? Math.floor(body.maxTokens)
    : undefined
  const temperature = typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2
    ? body.temperature
    : undefined

  const store = tmStudioAIConfigStore(ownerId)
  const record = (await store.listConnections()).find(row => row.connectionId === connectionId)
  if (!record) throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Unknown connection' })
  const model = record.models.find(entry => entry.isPrimary)?.modelId
    || record.models.find(entry => entry.enabled)?.modelId
  if (!model) throw createError({ statusCode: 400, statusMessage: 'error.aiNoModel', message: 'Connection has no enabled model' })

  // Key resolution stays outside the try: a missing master key is a 503 config
  // error, not a provider failure worth retrying.
  const apiKey = await tmStudioOpen(record)
  const started = Date.now()
  try {
    const client = createAIClient({
      endpoint: {
        provider: record.providerKey,
        baseUrl: record.baseUrl,
        apiKey,
        mode: 'local'
      },
      assertModeAllowed: () => {}
    })
    const result = await client.chat({ model, messages, maxTokens, temperature })
    return {
      success: true,
      data: { ok: true, content: result.content, model: result.model || model, usage: result.usage, latencyMs: Date.now() - started }
    }
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: 'error.aiLocalUpstreamFailed',
      message: String((err as Error).message || err).slice(0, 300)
    })
  }
})
