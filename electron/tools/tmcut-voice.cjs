'use strict'

const DEFAULT_VIENEU_BASE_URL = 'http://127.0.0.1:8000'
const MAX_VOICE_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_TTS_TEXT_LENGTH = 20_000
const MAX_TTS_AUDIO_BYTES = 64 * 1024 * 1024

function normalizeVieNeuBaseUrl(value) {
  let url
  try {
    url = new URL(String(value || DEFAULT_VIENEU_BASE_URL).trim())
  } catch {
    throw new Error('Invalid VieNeu-TTS URL')
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error('VieNeu-TTS must use an HTTP loopback URL (localhost)')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Enter the VieNeu-TTS server origin only, for example http://127.0.0.1:8000')
  }
  return url.origin
}

function parseVieNeuVoices(payload) {
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.voices)
      ? payload.voices
      : Array.isArray(payload?.data)
        ? payload.data
        : []
  return items
    .map((item) => {
      if (typeof item === 'string') return { name: item, description: '' }
      const name = String(item?.name || item?.id || '').trim()
      return name ? { name, description: String(item?.description || '') } : null
    })
    .filter(Boolean)
}

function validateSynthesisInput({ text, voice }) {
  const cleanText = typeof text === 'string' ? text.trim() : ''
  const cleanVoice = typeof voice === 'string' ? voice.trim() : ''
  if (!cleanText) throw new Error('Enter narration text first')
  if (cleanText.length > MAX_TTS_TEXT_LENGTH) throw new Error(`Narration must be ${MAX_TTS_TEXT_LENGTH} characters or fewer`)
  if (!cleanVoice || cleanVoice.length > 128) throw new Error('Choose a valid voice')
  return { text: cleanText, voice: cleanVoice }
}

function getServiceError(status, body) {
  let message = String(body || '').trim()
  try {
    const json = JSON.parse(message)
    message = String(json?.detail || json?.error?.message || json?.message || message)
  } catch {
    // Keep the service's plain-text error.
  }
  return message ? `VieNeu-TTS HTTP ${status}: ${message.slice(0, 500)}` : `VieNeu-TTS HTTP ${status}`
}

module.exports = {
  DEFAULT_VIENEU_BASE_URL,
  MAX_VOICE_REFERENCE_BYTES,
  MAX_TTS_TEXT_LENGTH,
  MAX_TTS_AUDIO_BYTES,
  normalizeVieNeuBaseUrl,
  parseVieNeuVoices,
  validateSynthesisInput,
  getServiceError
}
