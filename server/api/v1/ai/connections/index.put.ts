import { AIClientError, resolveProviderKey, type StoredAIConnection, type StoredAIModel } from '@tuanmjnh/tm-ai-client'
import { requireStudioAIConfigSecret, tmStudioAIConfigStore, tmStudioSafeConnection, tmStudioSeal } from '../../../../utils/aiConfigMongo'

interface Body {
  connectionId?: unknown
  providerKey?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  apiKeyEnv?: unknown
  enabled?: unknown
  models?: unknown
}

interface RawModel {
  modelId?: unknown
  displayName?: unknown
  enabled?: unknown
  isPrimary?: unknown
}

export default defineEventHandler(async (event) => {
  const ownerId = event.context.auth?.userId
  if (!ownerId) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const body = (await readBody<Body>(event)) ?? {}
  const connectionId = String(body.connectionId ?? '').trim()
  const providerKey = resolveProviderKey(String(body.providerKey ?? '').trim())
  if (!connectionId || !providerKey) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'connectionId and a known providerKey are required' })
  }

  const store = tmStudioAIConfigStore(ownerId)
  const existing = (await store.listConnections()).find(row => row.connectionId === connectionId)
  // apiKeyEnv names a server env var. Values outside the AI_API_KEY namespace let
  // a caller point a connection at their own baseUrl and read AI_CONFIG_SECRET
  // back as the Bearer token, so the shape is enforced here as parseAppConnections does.
  const apiKeyEnv = String(body.apiKeyEnv ?? existing?.apiKeyEnv ?? '').trim()
  if (apiKeyEnv && !/^AI_API_KEY(_[A-Z0-9_]+)?$/.test(apiKeyEnv)) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'apiKeyEnv must be AI_API_KEY or AI_API_KEY_<SUFFIX>' })
  }
  const typedKey = String(body.apiKey ?? '').trim()
  const apiKeyCipher = typedKey ? await tmStudioSeal(typedKey) : existing?.apiKeyCipher ?? ''
  if (apiKeyCipher) requireStudioAIConfigSecret()

  const rawModels: RawModel[] = Array.isArray(body.models) ? body.models : existing?.models ?? []
  const models: StoredAIModel[] = rawModels.map((model) => {
    const modelId = String(model?.modelId ?? '').trim()
    if (!modelId) return null
    return {
      modelId,
      ...(model.displayName ? { displayName: String(model.displayName) } : {}),
      enabled: model.enabled !== false,
      ...(model.isPrimary ? { isPrimary: true } : {})
    }
  }).filter((model): model is StoredAIModel => model !== null)

  const enabled = typeof body.enabled === 'boolean' ? body.enabled : existing?.enabled ?? true

  let saved: StoredAIConnection
  try {
    saved = await store.upsertConnection({
      connectionId,
      providerKey,
      baseUrl: String(body.baseUrl ?? existing?.baseUrl ?? ''),
      apiKeyCipher,
      ...(apiKeyEnv ? { apiKeyEnv } : {}),
      enabled,
      models
    })
  } catch (err) {
    if (err instanceof AIClientError && err.code === 'ai.bad-shape') {
      throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: err.message })
    }
    throw err
  }

  const persisted = (await store.listConnections()).find(row => row.connectionId === connectionId) ?? saved
  return { success: true, data: tmStudioSafeConnection(persisted) }
})
