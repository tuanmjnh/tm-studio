import {
  fetchTts,
  isWav,
  MAX_TTS_AUDIO_BYTES,
  normalizeTtsBaseUrl,
  readBounded,
  saveGeneratedWav,
  ttsServiceError,
  validateTtsInput
} from '../../../utils/tts'

/**
 * Local TTS for the browser build. The Electron app synthesizes through IPC in
 * the main process; a web page cannot, so this endpoint proxies to the same
 * loopback service and stores the result under /uploads/**.
 *
 * Contract: POST /api/v1/media/tts
 *   body = { text, voice, baseUrl? }
 *   ←    = { ok, url: '/uploads/<name>.wav', size }
 *
 * baseUrl is re-validated here (loopback HTTP only) rather than trusted from
 * the client: the browser is the untrusted side of this boundary.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<Record<string, unknown>>(event) || {}

  let baseUrl: string
  let input: { text: string, voice: string }
  try {
    baseUrl = normalizeTtsBaseUrl(body.baseUrl)
    input = validateTtsInput(body.text, body.voice)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: (error as Error).message })
  }

  let response: Response
  try {
    response = await fetchTts(baseUrl, '/v1/audio/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'vieneu-v3-turbo', input: input.text, voice: input.voice, response_format: 'wav', stream_format: 'audio' })
    })
  } catch (error) {
    const message = (error as Error).name === 'TimeoutError'
      ? 'VieNeu-TTS did not answer within 120 seconds'
      : `Could not reach VieNeu-TTS at ${baseUrl}`
    throw createError({ statusCode: 502, statusMessage: 'error.tts.unreachable', message })
  }

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: 'error.tts.upstream', message: ttsServiceError(response.status, await response.text()) })
  }

  let bytes: Buffer
  try {
    bytes = await readBounded(response, MAX_TTS_AUDIO_BYTES)
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: 'error.tts.upstream', message: (error as Error).message })
  }
  if (!isWav(bytes)) {
    throw createError({ statusCode: 502, statusMessage: 'error.tts.upstream', message: 'VieNeu-TTS did not return a valid WAV audio stream' })
  }

  const stored = await saveGeneratedWav(bytes)
  return { ok: true, ...stored }
})
