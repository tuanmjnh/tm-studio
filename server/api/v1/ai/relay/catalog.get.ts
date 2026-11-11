import { ofetch } from 'ofetch'
import { relayUpstreamError, requireHubServiceIdentity } from '../../../../utils/aiRelay'

/**
 * AI relay proxy — catalogue (R151). Forwards the hub's relay catalogue
 * (usable AI-LLM connections + enabled models for this app) to a logged-in
 * renderer. This server proves the request to Hub with its own service
 * identity — a per-device credential when the desktop app has one, otherwise
 * X-App-Id + X-App-Secret for a hosted deployment — so the browser never needs
 * (or sees) either.
 *
 * Identity is read from the live process environment per request: it must
 * never be evaluated at build time, or it lands in the shipped server bundle.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const config = useRuntimeConfig(event)
  const hubUrl = String(config.public.hubUrl || '').replace(/\/+$/, '')
  const identity = requireHubServiceIdentity(hubUrl)

  try {
    return await ofetch(`${hubUrl}/api/v1/apps/${identity.appId}/ai/relay/catalog`, {
      headers: identity.headers
    })
  } catch (err: unknown) {
    throw createError(relayUpstreamError(err, 'AI relay catalogue upstream failed'))
  }
})
