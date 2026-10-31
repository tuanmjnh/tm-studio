import { relayUpstreamError } from '../../../../utils/aiRelay'

/**
 * AI relay proxy — catalogue (R151). Forwards the hub's relay catalogue
 * (usable AI-LLM connections + enabled models for this app) to a logged-in
 * renderer. The hub proves the request with X-App-Id + X-App-Secret here,
 * so the browser never needs (or sees) either secret.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const hubUrl = String(config.public.hubUrl || '').replace(/\/+$/, '')
  const hubAppId = String(config.public.hubAppId || '')
  const hubAppSecret = String(config.hubAppSecret || '')
  if (!hubUrl || !hubAppId || !hubAppSecret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.aiRelayNotConfigured',
      message: 'AI relay is not configured on this server (NUXT_HUB_APP_SECRET missing)'
    })
  }

  try {
    return await $fetch(`${hubUrl}/api/v1/apps/${hubAppId}/ai/relay/catalog`, {
      headers: { 'X-App-Id': hubAppId, 'X-App-Secret': hubAppSecret }
    })
  } catch (err: unknown) {
    throw createError(relayUpstreamError(err, 'AI relay catalogue upstream failed'))
  }
})
