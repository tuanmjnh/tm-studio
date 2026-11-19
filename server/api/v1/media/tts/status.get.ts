import {
  fetchTts,
  normalizeTtsBaseUrl,
  normalizeTtsProvider,
  parseTtsVoices,
  ttsServiceError,
  TTS_PROVIDERS
} from '../../../../utils/tts'

/**
 * Reaches a local TTS engine on behalf of the browser build and reports what
 * the voice dropdown needs: health plus the installed voices.
 *
 * Contract: GET /api/v1/media/tts/status?provider=vieneu|cit&baseUrl=<loopback origin>
 *   ←    = { ok, data: { provider, baseUrl, health, voices: [{ name, description }] } }
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const query = getQuery(event)
  let provider: ReturnType<typeof normalizeTtsProvider>
  let baseUrl: string
  try {
    provider = normalizeTtsProvider(query.provider)
    baseUrl = normalizeTtsBaseUrl(query.baseUrl, provider)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: (error as Error).message })
  }
  const spec = TTS_PROVIDERS[provider]

  try {
    const health = await fetchTts(baseUrl, spec.routes.health)
    if (!health.ok) {
      throw createError({ statusCode: 502, statusMessage: 'error.ttsUpstream', message: ttsServiceError(health.status, await health.text(), provider) })
    }
    let healthBody: unknown = null
    try {
      healthBody = await health.json()
    } catch {
      healthBody = null
    }
    const voices = await fetchTts(baseUrl, spec.routes.voices)
    if (!voices.ok) {
      throw createError({ statusCode: 502, statusMessage: 'error.ttsUpstream', message: ttsServiceError(voices.status, await voices.text(), provider) })
    }
    return { ok: true, data: { provider, baseUrl, health: healthBody, voices: parseTtsVoices(await voices.json()) } }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const message = (error as Error).name === 'TimeoutError'
      ? `${spec.label} did not answer within 120 seconds`
      : `Could not reach ${spec.label} at ${baseUrl}`
    throw createError({ statusCode: 502, statusMessage: 'error.ttsUnreachable', message })
  }
})
