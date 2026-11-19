import { webCloudProviders } from '../../../utils/cloud-tts'

/**
 * Cloud TTS catalogue for the browser build (R146). Same shape the desktop
 * app receives from Main, restricted to the providers a web page may call:
 * the keyless Google Translate engine only.
 *
 * Contract: GET /api/v1/media/tts-cloud
 *   ← { ok, data: CloudVoiceProviderInfo[] }
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  return { ok: true, data: webCloudProviders() }
})
