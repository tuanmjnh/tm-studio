'use strict'

// Two local engines, one contract. `vieneu` is the OpenAI-compatible server
// that ships with VieNeu-TTS (port 8000); `cit` is CIT Voice Studio, which
// embeds VieNeu and serves its own API on port 8001. This table must stay
// byte-for-byte equivalent to server/utils/tts.ts — the browser proxy and the
// desktop IPC handler are two doors into the same two services.
const TTS_PROVIDERS = {
  vieneu: {
    id: 'vieneu',
    label: 'VieNeu-TTS',
    defaultBaseUrl: 'http://127.0.0.1:8000',
    routes: {
      health: '/health',
      voices: '/v1/voices',
      synthesize: '/v1/audio/speech',
      enroll: '/v1/voices',
      consent: null
    }
  },
  cit: {
    id: 'cit',
    label: 'CIT Voice Studio',
    defaultBaseUrl: 'http://127.0.0.1:8001',
    routes: {
      health: '/health',
      voices: '/voices',
      synthesize: '/api/tts/generate',
      enroll: '/api/voices/custom',
      consent: '/api/voices/consent'
    }
  }
}

// CIT stores a cloned voice on disk under the name it was enrolled with, so the
// delete route carries that name. Encode it; never interpolate raw input.
function citCustomVoicePath(name) {
  const clean = String(name == null ? '' : name).trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u.test(clean)) throw new Error('Invalid custom voice name')
  return `/api/voices/custom/${encodeURIComponent(clean)}`
}

const DEFAULT_VIENEU_BASE_URL = TTS_PROVIDERS.vieneu.defaultBaseUrl
const MAX_VOICE_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_TTS_TEXT_LENGTH = 20_000
const MAX_TTS_AUDIO_BYTES = 64 * 1024 * 1024

function normalizeTtsProvider(value) {
  const id = String(value == null ? '' : value).trim().toLowerCase()
  if (!id) return 'vieneu'
  if (id === 'vieneu' || id === 'cit') return id
  throw new Error('Unknown TTS engine')
}

function normalizeTtsBaseUrl(value, provider = 'vieneu') {
  const spec = TTS_PROVIDERS[provider]
  const raw = String(value == null ? '' : value).trim() || spec.defaultBaseUrl
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid ${spec.label} URL`)
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(hostname)) {
    throw new Error(`${spec.label} must use an HTTP loopback URL (localhost)`)
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`Enter the ${spec.label} server origin only, for example ${spec.defaultBaseUrl}`)
  }
  return url.origin
}

function speechRequest(provider, text, voice) {
  if (provider === 'cit') return { text, voice_id: voice, format: 'wav' }
  return { model: 'vieneu-v3-turbo', input: text, voice, response_format: 'wav', stream_format: 'audio' }
}

// CIT falls back to WAV when it cannot encode MP3, so the extension follows
// the content type that actually arrived.
function audioExtension(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3'
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'wav'
  throw new Error(`TTS engine returned ${type || 'no content type'} instead of audio`)
}

function isWav(bytes) {
  return bytes.length >= 44
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WAVE'
    && bytes.readUInt32LE(4) + 8 <= bytes.length
}

function isMp3(bytes) {
  if (bytes.length < 4) return false
  if (bytes.toString('latin1', 0, 3) === 'ID3') return true
  return bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0
}

function isAudioBytes(bytes, ext) {
  return ext === 'wav' ? isWav(bytes) : isMp3(bytes)
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

function getServiceError(status, body, provider = 'vieneu') {
  const label = TTS_PROVIDERS[provider].label
  let message = String(body || '').trim()
  try {
    const json = JSON.parse(message)
    message = String(json?.detail || json?.error?.message || json?.message || message)
  } catch {
    // Keep the service's plain-text error.
  }
  return message ? `${label} HTTP ${status}: ${message.slice(0, 500)}` : `${label} HTTP ${status}`
}

module.exports = {
  DEFAULT_VIENEU_BASE_URL,
  MAX_VOICE_REFERENCE_BYTES,
  MAX_TTS_TEXT_LENGTH,
  MAX_TTS_AUDIO_BYTES,
  TTS_PROVIDERS,
  normalizeTtsProvider,
  normalizeTtsBaseUrl,
  citCustomVoicePath,
  speechRequest,
  audioExtension,
  isAudioBytes,
  parseVieNeuVoices,
  validateSynthesisInput,
  getServiceError
}
