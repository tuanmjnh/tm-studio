import { synthesizeGtts, validateGttsInput } from '../../../utils/cloud-tts'

/**
 * Keyless cloud TTS for the browser build (R146). The desktop app synthesizes
 * every cloud provider in Main; a web page cannot hold API keys, so only the
 * free Google Translate engine is exposed here — fixed endpoint, allowlisted
 * language, no key, no user-supplied URL.
 *
 * Contract: POST /api/v1/media/tts-cloud
 *   body = { text, voice?: 'vi' | 'en' | ... }
 *   ←    = { ok, url: '/uploads/<name>.mp3', size }
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<Record<string, unknown>>(event) || {}

  let input: ReturnType<typeof validateGttsInput>
  try {
    input = validateGttsInput(body.text, body.voice)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: (error as Error).message })
  }

  // The browser cannot signal cancellation mid-request, so cancellation is
  // the client going away: abort between chunks when the response closes
  // before it was written.
  const abort = new AbortController()
  const onClose = () => {
    if (!event.node.res.writableEnded) abort.abort()
  }
  event.node.res.on('close', onClose)

  try {
    const stored = await synthesizeGtts(input.text, input.voice, { signal: abort.signal })
    return { ok: true, ...stored }
  } catch (error) {
    if (abort.signal.aborted) {
      throw createError({ statusCode: 499, statusMessage: 'error.canceled', message: 'Canceled' })
    }
    throw createError({ statusCode: 502, statusMessage: 'error.ttsUpstream', message: String((error as Error).message || error) })
  } finally {
    event.node.res.off('close', onClose)
  }
})
