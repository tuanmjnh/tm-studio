'use strict'
// Cloud TTS providers for Voice Studio (R146).
//
// One registry, pure builders: a provider maps (text, voice, key, region) to
// the HTTP calls that produce audio, and maps the responses back to bytes.
// No electron import at module top, so the node test suite can exercise every
// request shape without network or credentials.
//
// Providers:
//   gtts       Google Translate read-aloud — no key, ~190 chars per call, the
//              text is split on sentence boundaries and the MP3s concatenated;
//   openai     /v1/audio/speech (gpt-4o-mini-tts);
//   elevenlabs /v1/text-to-speech/{voiceId} (eleven_multilingual_v2);
//   azure      Azure Speech SSML endpoint (key + region);
//   google     Google Cloud Text-to-Speech v1 (API key, LINEAR16 -> WAV).
//
// The Microsoft Edge read-aloud endpoint this file originally targeted now
// rejects the classic Sec-MS-GEC token (403 Invalid Request, measured
// 2026-11-19), so gtts is the no-key provider instead.

const MAX_CLOUD_TEXT_LENGTH = 5000
const MAX_CLOUD_AUDIO_BYTES = 64 * 1024 * 1024
const GTTS_MAX_CHARS = 190
const GTTS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

const CLOUD_PROVIDERS = {
  gtts: {
    id: 'gtts',
    label: 'Google Translate',
    keySlot: null,
    needsRegion: false,
    voiceInput: 'select',
    defaultVoice: 'vi',
    voices: [
      { id: 'vi', label: 'Tiếng Việt' },
      { id: 'en', label: 'English' },
      { id: 'ja', label: '日本語' },
      { id: 'ko', label: '한국어' },
      { id: 'zh-CN', label: '中文' },
      { id: 'fr', label: 'Français' },
      { id: 'de', label: 'Deutsch' },
      { id: 'es', label: 'Español' },
      { id: 'th', label: 'ไทย' },
      { id: 'id', label: 'Bahasa Indonesia' }
    ]
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    keySlot: 'TMCUT_OPENAI_API_KEY',
    needsRegion: false,
    voiceInput: 'select',
    defaultVoice: 'nova',
    voices: OPENAI_VOICES.map(id => ({ id, label: id[0].toUpperCase() + id.slice(1) }))
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    keySlot: 'TMCUT_ELEVENLABS_API_KEY',
    needsRegion: false,
    voiceInput: 'id',
    defaultVoice: '21m00Tcm4TlvDq8ikWAM',
    voices: []
  },
  azure: {
    id: 'azure',
    label: 'Azure Speech',
    keySlot: 'TMCUT_AZURE_SPEECH_KEY',
    needsRegion: true,
    voiceInput: 'select',
    defaultVoice: 'vi-VN-HoaiMyNeural',
    voices: [
      { id: 'vi-VN-HoaiMyNeural', label: 'Hoài My (vi-VN)' },
      { id: 'vi-VN-NamMinhNeural', label: 'Nam Minh (vi-VN)' },
      { id: 'en-US-AriaNeural', label: 'Aria (en-US)' },
      { id: 'en-US-GuyNeural', label: 'Guy (en-US)' },
      { id: 'ja-JP-NanamiNeural', label: 'Nanami (ja-JP)' }
    ]
  },
  google: {
    id: 'google',
    label: 'Google Cloud TTS',
    keySlot: 'TMCUT_GOOGLE_TTS_API_KEY',
    needsRegion: false,
    voiceInput: 'select',
    defaultVoice: 'vi-VN-Neural2-A',
    voices: [
      { id: 'vi-VN-Neural2-A', label: 'Neural2 A (vi-VN, nữ)' },
      { id: 'vi-VN-Neural2-D', label: 'Neural2 D (vi-VN, nam)' },
      { id: 'vi-VN-Wavenet-A', label: 'WaveNet A (vi-VN, nữ)' },
      { id: 'vi-VN-Wavenet-D', label: 'WaveNet D (vi-VN, nam)' },
      { id: 'en-US-Neural2-F', label: 'Neural2 F (en-US)' },
      { id: 'ja-JP-Neural2-B', label: 'Neural2 B (ja-JP)' }
    ]
  }
}

function normalizeCloudProvider(value) {
  const id = String(value || '').trim().toLowerCase()
  if (!id) return 'gtts'
  if (Object.prototype.hasOwnProperty.call(CLOUD_PROVIDERS, id)) return id
  throw new Error('Unknown cloud voice provider')
}

/** Slot name the renderer stores the key under; null for keyless providers. */
function cloudKeySlot(provider) {
  return CLOUD_PROVIDERS[normalizeCloudProvider(provider)].keySlot
}

function cloudProviderList() {
  return Object.values(CLOUD_PROVIDERS).map(spec => ({
    id: spec.id,
    label: spec.label,
    keySlot: spec.keySlot,
    needsRegion: spec.needsRegion,
    voiceInput: spec.voiceInput,
    defaultVoice: spec.defaultVoice,
    voices: spec.voices
  }))
}

function validateCloudKey(raw) {
  const key = String(raw || '').trim()
  if (!key) throw new Error('Set the API key in Voice Studio first')
  // Header-injection guard: these values travel in Authorization / xi-api-key /
  // Ocp-Apim-Subscription-Key headers.
  if (key.length > 512 || /[\r\n]/.test(key)) throw new Error('The API key is not valid')
  return key
}

function validateCloudRegion(raw) {
  const region = String(raw || '').trim()
  if (!/^[a-z0-9-]{2,30}$/.test(region)) throw new Error('Set the Azure region first (for example southeastasia)')
  return region
}

function validateCloudVoice(provider, raw) {
  const spec = CLOUD_PROVIDERS[normalizeCloudProvider(provider)]
  const voice = String(raw || '').trim() || spec.defaultVoice
  if (spec.voiceInput === 'id') {
    if (!/^[A-Za-z0-9]{10,40}$/.test(voice)) throw new Error('Enter a valid ElevenLabs voice ID')
    return voice
  }
  if (!spec.voices.some(item => item.id === voice)) throw new Error(`Choose a supported ${spec.label} voice`)
  return voice
}

function validateCloudText(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('Enter narration text first')
  if (text.length > MAX_CLOUD_TEXT_LENGTH) throw new Error(`Narration must be ${MAX_CLOUD_TEXT_LENGTH} characters or fewer`)
  return text
}

/** Provider-specific input ceilings under the shared 5000-char limit:
 *  gpt-4o-mini-tts takes 4096 characters, Google Cloud takes 5000 BYTES. */
function validateProviderText(provider, text) {
  if (provider === 'openai' && text.length > 4096) throw new Error('OpenAI TTS accepts 4096 characters or fewer')
  if (provider === 'google' && Buffer.byteLength(text, 'utf8') > 5000) throw new Error('Google Cloud TTS accepts 5000 bytes or fewer')
}

/** Split text so every gtts call stays under its ~200-char URL limit:
 *  sentence boundaries first, word boundaries only for long sentences. */
function chunkGttsText(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/gu) || [clean]
  const chunks = []
  let current = ''
  for (const sentence of sentences) {
    if ((current + sentence).length <= GTTS_MAX_CHARS) {
      current += sentence
      continue
    }
    if (current.trim()) chunks.push(current.trim())
    let rest = sentence.trim()
    while (rest.length > GTTS_MAX_CHARS) {
      let cut = rest.lastIndexOf(' ', GTTS_MAX_CHARS)
      if (cut < GTTS_MAX_CHARS / 2) cut = GTTS_MAX_CHARS
      chunks.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    current = rest ? `${rest} ` : ''
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Build the HTTP calls for one synthesis. `key`/`region` are read by Main from
 * its own environment, never from the renderer. Returns an ordered array; only
 * gtts returns more than one.
 */
function cloudRequests(provider, { text, voice, key, region }) {
  const id = normalizeCloudProvider(provider)
  const cleanText = validateCloudText(text)
  const cleanVoice = validateCloudVoice(id, voice)
  validateProviderText(id, cleanText)

  if (id === 'gtts') {
    return chunkGttsText(cleanText).map(chunk => ({
      url: `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(cleanVoice)}&q=${encodeURIComponent(chunk)}`,
      init: { method: 'GET', headers: { 'user-agent': GTTS_USER_AGENT, 'accept': 'audio/mpeg' } }
    }))
  }

  if (id === 'openai') {
    return [{
      url: 'https://api.openai.com/v1/audio/speech',
      init: {
        method: 'POST',
        headers: { 'authorization': `Bearer ${validateCloudKey(key)}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: cleanVoice, input: cleanText, response_format: 'mp3' })
      }
    }]
  }

  if (id === 'elevenlabs') {
    return [{
      url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(cleanVoice)}?output_format=mp3_44100_128`,
      init: {
        method: 'POST',
        headers: { 'xi-api-key': validateCloudKey(key), 'content-type': 'application/json', 'accept': 'audio/mpeg' },
        body: JSON.stringify({ text: cleanText, model_id: 'eleven_multilingual_v2' })
      }
    }]
  }

  if (id === 'azure') {
    const cleanRegion = validateCloudRegion(region)
    return [{
      url: `https://${cleanRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
      init: {
        method: 'POST',
        headers: {
          'ocp-apim-subscription-key': validateCloudKey(key),
          'content-type': 'application/ssml+xml',
          'x-microsoft-outputformat': 'audio-24khz-48kbitrate-mono-mp3',
          'user-agent': 'tm-studio'
        },
        body: `<speak version='1.0' xml:lang='${cleanVoice.slice(0, 5)}'><voice name='${cleanVoice}'>${escapeXml(cleanText)}</voice></speak>`
      }
    }]
  }

  return [{
    url: `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(validateCloudKey(key))}`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text: cleanText },
        voice: { languageCode: cleanVoice.slice(0, 5), name: cleanVoice },
        audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000 }
      })
    }
  }]
}

/**
 * Turn the collected response bodies into one audio buffer. `bodies` is the
 * ordered array of raw bytes (gtts: one MP3 per chunk, already concatenatable
 * at frame level; google: a JSON envelope with base64 LINEAR16).
 */
function cloudAudio(provider, bodies) {
  const id = normalizeCloudProvider(provider)
  if (id === 'google') {
    let payload
    try {
      payload = JSON.parse(Buffer.concat(bodies).toString('utf8'))
    } catch {
      throw new Error('Google Cloud TTS did not return JSON')
    }
    const encoded = String(payload?.audioContent || '')
    if (!encoded) throw new Error('Google Cloud TTS returned no audio')
    const bytes = Buffer.from(encoded, 'base64')
    return { bytes, ext: 'wav' }
  }
  const bytes = Buffer.concat(bodies)
  return { bytes, ext: sniffAudioExt(bytes) || 'mp3' }
}

function sniffAudioExt(bytes) {
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'wav'
  if (bytes.length >= 3 && bytes.toString('latin1', 0, 3) === 'ID3') return 'mp3'
  if (bytes.length >= 2 && bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0) return 'mp3'
  return null
}

/** Voice-list calls for providers that expose one (R147). Same shape as
 *  cloudRequests: pure builder, the key comes from Main's environment. */
function cloudVoiceListRequest(provider, { key } = {}) {
  const id = normalizeCloudProvider(provider)
  if (id === 'elevenlabs') {
    return {
      url: 'https://api.elevenlabs.io/v1/voices',
      init: { method: 'GET', headers: { 'xi-api-key': validateCloudKey(key), 'accept': 'application/json' } }
    }
  }
  if (id === 'google') {
    return {
      url: `https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(validateCloudKey(key))}`,
      init: { method: 'GET', headers: { accept: 'application/json' } }
    }
  }
  throw new Error('The voice list is available for ElevenLabs and Google Cloud TTS only')
}

/** Map a voice-list response to the catalogue shape. Caps the list so one
 *  payload cannot flood the renderer (Google returns every voice it has). */
function parseCloudVoiceList(provider, body) {
  const id = normalizeCloudProvider(provider)
  let payload
  try {
    payload = JSON.parse(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''))
  } catch {
    throw new Error('The voice list response was not JSON')
  }
  const list = Array.isArray(payload?.voices) ? payload.voices : []
  if (id === 'elevenlabs') {
    return list
      .map(voice => ({ id: String(voice?.voice_id || ''), label: String(voice?.name || voice?.voice_id || '') }))
      .filter(voice => voice.id)
      .slice(0, 100)
  }
  if (id === 'google') {
    return list
      .map(voice => ({ id: String(voice?.name || ''), label: `${voice?.name || ''} · ${(voice?.languageCodes || [])[0] || ''}` }))
      .filter(voice => voice.id)
      .slice(0, 200)
  }
  throw new Error('The voice list is available for ElevenLabs and Google Cloud TTS only')
}

function cloudServiceError(provider, status, body) {
  const spec = CLOUD_PROVIDERS[normalizeCloudProvider(provider)]
  let message = String(body || '').trim()
  try {
    const json = JSON.parse(message)
    message = String(json?.error?.message || json?.detail?.message || json?.detail || json?.message || message)
  } catch {
    // Keep the service's plain-text error.
  }
  return message ? `${spec.label} HTTP ${status}: ${message.slice(0, 500)}` : `${spec.label} HTTP ${status}`
}

module.exports = {
  MAX_CLOUD_TEXT_LENGTH,
  MAX_CLOUD_AUDIO_BYTES,
  GTTS_MAX_CHARS,
  CLOUD_PROVIDERS,
  normalizeCloudProvider,
  cloudKeySlot,
  cloudProviderList,
  chunkGttsText,
  validateCloudText,
  validateCloudVoice,
  validateCloudKey,
  validateCloudRegion,
  cloudRequests,
  cloudAudio,
  cloudVoiceListRequest,
  parseCloudVoiceList,
  sniffAudioExt,
  cloudServiceError
}
