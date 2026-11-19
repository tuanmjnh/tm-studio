import {
  audioExtension,
  fetchTts,
  isAudioBytes,
  MAX_TTS_AUDIO_BYTES,
  normalizeTtsBaseUrl,
  normalizeTtsProvider,
  readBounded,
  saveGeneratedAudio,
  speechRequest,
  ttsServiceError,
  TTS_PROVIDERS,
  validateTtsInput
} from '../../../utils/tts'

/**
 * Local TTS for the browser build. The Electron app synthesizes through IPC in
 * the main process; a web page cannot, so this endpoint proxies to the same
 * loopback engine and stores the result under /uploads/**.
 *
 * Contract: POST /api/v1/media/tts
 *   body = { text, voice, provider?: 'vieneu' | 'cit', baseUrl? }
 *   ←    = { ok, url: '/uploads/<name>.wav' | '.mp3', size }
 *
 * provider and baseUrl are re-validated here (known engine, loopback HTTP
 * only) rather than trusted from the client: the browser is the untrusted
 * side of this boundary.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<Record<string, unknown>>(event) || {}

  let provider: ReturnType<typeof normalizeTtsProvider>
  let baseUrl: string
  let input: { text: string, voice: string }
  try {
    provider = normalizeTtsProvider(body.provider)
    baseUrl = normalizeTtsBaseUrl(body.baseUrl, provider)
    input = validateTtsInput(body.text, body.voice)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: (error as Error).message })
  }
  const spec = TTS_PROVIDERS[provider]

  let response: Response
  try {
    response = await fetchTts(baseUrl, spec.routes.synthesize, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(speechRequest(provider, input.text, input.voice))
    })
  } catch (error) {
    const message = (error as Error).name === 'TimeoutError'
      ? `${spec.label} did not answer within 120 seconds`
      : `Could not reach ${spec.label} at ${baseUrl}`
    throw createError({ statusCode: 502, statusMessage: 'error.ttsUnreachable', message })
  }

  if (!response.ok) {
    throw createError({ statusCode: 502, statusMessage: 'error.ttsUpstream', message: ttsServiceError(response.status, await response.text(), provider) })
  }

  let ext: 'wav' | 'mp3'
  let bytes: Buffer
  try {
    ext = audioExtension(response.headers.get('content-type'))
    bytes = await readBounded(response, MAX_TTS_AUDIO_BYTES)
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: 'error.ttsUpstream', message: (error as Error).message })
  }
  if (!isAudioBytes(bytes, ext)) {
    throw createError({ statusCode: 502, statusMessage: 'error.ttsUpstream', message: `${spec.label} did not return a valid ${ext.toUpperCase()} audio stream` })
  }

  const stored = await saveGeneratedAudio(bytes, ext)
  return { ok: true, ...stored }
})
