import {
  fetchTts,
  normalizeTtsBaseUrl,
  parseTtsVoices,
  ttsServiceError
} from '../../../../utils/tts'

/**
 * Reaches the local VieNeu-TTS service on behalf of the browser build and
 * reports what the voice dropdown needs: health plus the installed voices.
 *
 * Contract: GET /api/v1/media/tts/status?baseUrl=<loopback origin>
 *   ←    = { ok, data: { baseUrl, voices: [{ name, description }] } }
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const query = getQuery(event)
  let baseUrl: string
  try {
    baseUrl = normalizeTtsBaseUrl(query.baseUrl)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: (error as Error).message })
  }

  try {
    const health = await fetchTts(baseUrl, '/health')
    if (!health.ok) {
      throw createError({ statusCode: 502, statusMessage: 'error.tts.upstream', message: ttsServiceError(health.status, await health.text()) })
    }
    const voices = await fetchTts(baseUrl, '/v1/voices')
    if (!voices.ok) {
      throw createError({ statusCode: 502, statusMessage: 'error.tts.upstream', message: ttsServiceError(voices.status, await voices.text()) })
    }
    return { ok: true, data: { baseUrl, voices: parseTtsVoices(await voices.json()) } }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    const message = (error as Error).name === 'TimeoutError'
      ? 'VieNeu-TTS did not answer within 120 seconds'
      : `Could not reach VieNeu-TTS at ${baseUrl}`
    throw createError({ statusCode: 502, statusMessage: 'error.tts.unreachable', message })
  }
})
