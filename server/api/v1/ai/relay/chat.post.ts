import { readBody } from 'h3'
import { ofetch } from 'ofetch'
import { relayUpstreamError } from '../../../../utils/aiRelay'
import { resolveHubServiceIdentity } from '../../../../utils/hubIdentity'

/**
 * AI relay proxy — chat (R151). The renderer cannot hold a hub credential, so
 * it calls this endpoint and Nitro forwards to the hub relay with this server's
 * service identity — a per-device credential in the desktop app, App Secret in
 * a hosted deployment. Decrypted provider credentials live and die inside the
 * hub process.
 *
 * Auth: server/middleware/auth.ts already requires a valid tm-studio user JWT
 * for every /api/** route, so nobody anonymous reaches the credential-backed
 * call.
 *
 * Body: { connectionId, messages: [{role, content}], model?, maxTokens?, temperature? }
 * Response: the hub relay envelope { success, data: { ok, content, provider, model, usage } }.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const hubUrl = String(config.public.hubUrl || '').replace(/\/+$/, '')
  // Device credential first (desktop), App Secret second (hosted server).
  const identity = resolveHubServiceIdentity()
  if (!hubUrl || !identity) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.aiRelayNotConfigured',
      message: 'AI relay is not configured on this server (no device credential or App Secret)'
    })
  }

  const body = await readBody<{
    connectionId?: unknown
    model?: unknown
    messages?: unknown
    maxTokens?: unknown
    temperature?: unknown
  }>(event) || {}

  // Mirror the hub's own validation so bad payloads fail here, not there.
  const connectionId = typeof body.connectionId === 'string' ? body.connectionId.trim() : ''
  if (!connectionId) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'connectionId is required' })
  }
  const rawMessages = Array.isArray(body.messages) ? body.messages : []
  const messages = rawMessages
    .map((m: Record<string, unknown>) => ({
      role: String(m?.role ?? ''),
      content: String(m?.content ?? '')
    }))
    .map(m => ({ role: ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user', content: m.content }))
    .filter(m => m.content.trim())
  if (!messages.length) {
    throw createError({ statusCode: 400, statusMessage: 'error.bad_request', message: 'messages array with content is required' })
  }
  const payload: Record<string, unknown> = { connectionId, messages }
  if (typeof body.model === 'string' && body.model.trim()) payload.model = body.model.trim()
  if (typeof body.maxTokens === 'number' && body.maxTokens > 0 && body.maxTokens <= 32_767) payload.maxTokens = Math.floor(body.maxTokens)
  if (typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2) payload.temperature = body.temperature

  try {
    return await ofetch(`${hubUrl}/api/v1/apps/${identity.appId}/ai/relay/chat`, {
      method: 'POST',
      headers: identity.headers,
      body: payload
    })
  } catch (err: unknown) {
    throw createError(relayUpstreamError(err, 'AI relay upstream failed'))
  }
})
