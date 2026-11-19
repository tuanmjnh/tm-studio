import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config/index'

/**
 * Web-runtime bridge to a local TTS engine.
 *
 * The Electron build calls the service from the main process. The browser build
 * has no IPC and cannot fetch it directly (CORS, plus a page script would be
 * able to point the request anywhere), so Nitro proxies instead. The base URL
 * is pinned to loopback for exactly that reason: this endpoint must not become
 * an SSRF pivot for a logged-in browser tab.
 *
 * Two engines are supported, each in its own shape:
 *   vieneu — the OpenAI-compatible server shipped with VieNeu-TTS (port 8000);
 *   cit    — CIT Voice Studio, which embeds VieNeu and serves its own API on
 *            port 8001 (`POST /api/tts/generate`, JSON in, WAV/MP3 out).
 * The engine selects a route table here; the client never supplies a path.
 *
 * Limits mirror electron/tools/tmcut-voice.cjs — keep the two in step.
 */
export type TtsProvider = 'vieneu' | 'cit'

export interface TtsProviderSpec {
  id: TtsProvider
  label: string
  defaultBaseUrl: string
  routes: { health: string, voices: string, synthesize: string, enroll: string, consent: string | null }
}

export const TTS_PROVIDERS: Record<TtsProvider, TtsProviderSpec> = {
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

export const DEFAULT_TTS_BASE_URL = TTS_PROVIDERS.vieneu.defaultBaseUrl
export const MAX_TTS_TEXT_LENGTH = 20_000
export const MAX_TTS_AUDIO_BYTES = 64 * 1024 * 1024
const TTS_TIMEOUT_MS = 120_000

export function normalizeTtsProvider(value: unknown): TtsProvider {
  const id = String(value ?? '').trim().toLowerCase()
  if (!id) return 'vieneu'
  if (id === 'vieneu' || id === 'cit') return id
  throw new Error('Unknown TTS engine')
}

export function normalizeTtsBaseUrl(value: unknown, provider: TtsProvider = 'vieneu'): string {
  const spec = TTS_PROVIDERS[provider]
  const raw = String(value ?? '').trim() || spec.defaultBaseUrl
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Invalid ${spec.label} URL`)
  }
  // `URL` keeps the brackets around IPv6 hostnames, so the loopback form of
  // ::1 arrives as "[::1]".
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error(`${spec.label} must use an HTTP loopback URL (localhost)`)
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`Enter the ${spec.label} server origin only, for example ${spec.defaultBaseUrl}`)
  }
  return url.origin
}

/** The JSON body each engine expects. CIT reads `text`/`voice_id`; VieNeu
 *  reads `input`/`voice` and silently ignores unknown keys, so one body cannot
 *  serve both. */
export function speechRequest(provider: TtsProvider, text: string, voice: string): Record<string, unknown> {
  if (provider === 'cit') return { text, voice_id: voice, format: 'wav' }
  return { model: 'vieneu-v3-turbo', input: text, voice, response_format: 'wav', stream_format: 'audio' }
}

/** CIT falls back to WAV when it cannot encode MP3, so the file name must
 *  follow the content type that actually arrived. */
export function audioExtension(contentType: string | null): 'wav' | 'mp3' {
  const type = String(contentType || '').split(';')[0]?.trim().toLowerCase() || ''
  if (type === 'audio/mpeg' || type === 'audio/mp3') return 'mp3'
  if (type === 'audio/wav' || type === 'audio/x-wav' || type === 'audio/wave') return 'wav'
  throw new Error(`TTS engine returned ${type || 'no content type'} instead of audio`)
}

export function isMp3(bytes: Buffer): boolean {
  if (bytes.length < 4) return false
  if (bytes.toString('latin1', 0, 3) === 'ID3') return true
  return bytes[0] === 0xFF && (bytes[1]! & 0xE0) === 0xE0
}

export function validateTtsInput(text: unknown, voice: unknown): { text: string, voice: string } {
  const cleanText = typeof text === 'string' ? text.trim() : ''
  const cleanVoice = typeof voice === 'string' ? voice.trim() : ''
  if (!cleanText) throw new Error('Enter narration text first')
  if (cleanText.length > MAX_TTS_TEXT_LENGTH) throw new Error(`Narration must be ${MAX_TTS_TEXT_LENGTH} characters or fewer`)
  if (!cleanVoice || cleanVoice.length > 128) throw new Error('Choose a valid voice')
  return { text: cleanText, voice: cleanVoice }
}

export function parseTtsVoices(payload: unknown): Array<{ name: string, description: string }> {
  const record = payload as Record<string, unknown> | null
  const items: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray(record?.voices)
      ? record!.voices as unknown[]
      : Array.isArray(record?.data)
        ? record!.data as unknown[]
        : []
  const voices: Array<{ name: string, description: string }> = []
  for (const item of items) {
    if (typeof item === 'string') {
      if (item.trim()) voices.push({ name: item.trim(), description: '' })
      continue
    }
    const entry = item as Record<string, unknown> | null
    const name = String(entry?.name || entry?.id || '').trim()
    if (name) voices.push({ name, description: String(entry?.description || '') })
  }
  return voices
}

export function ttsServiceError(status: number, body: string, provider: TtsProvider = 'vieneu'): string {
  const label = TTS_PROVIDERS[provider].label
  let message = String(body || '').trim()
  try {
    const json = JSON.parse(message) as Record<string, unknown>
    message = String(json?.detail || (json?.error as Record<string, unknown> | undefined)?.message || json?.message || message)
  } catch {
    // Keep the service's plain-text error.
  }
  return message ? `${label} HTTP ${status}: ${message.slice(0, 500)}` : `${label} HTTP ${status}`
}

export function fetchTts(baseUrl: string, route: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${route}`, { ...init, signal: AbortSignal.timeout(TTS_TIMEOUT_MS) })
}

/** Read a response body with a hard byte ceiling — a broken service must not
 *  stream unbounded audio into server memory. */
export async function readBounded(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length')) || 0
  if (declared > maxBytes) throw new Error('Generated audio exceeds the 64 MiB limit')
  if (!response.body) throw new Error('VieNeu-TTS returned an empty response')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('Generated audio exceeds the 64 MiB limit')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export function isWav(bytes: Buffer): boolean {
  return bytes.length >= 44
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WAVE'
    && bytes.readUInt32LE(4) + 8 <= bytes.length
}

/** The header said what the bytes are; this checks they are that. */
export function isAudioBytes(bytes: Buffer, ext: 'wav' | 'mp3'): boolean {
  return ext === 'wav' ? isWav(bytes) : isMp3(bytes)
}

/** Persist a synthesized take next to the other uploads so /uploads/** serves
 *  it and the media library can treat it as an ordinary asset path. */
export async function saveGeneratedAudio(bytes: Buffer, ext: 'wav' | 'mp3'): Promise<{ url: string, size: number }> {
  const dir = config.uploads.dir
  await mkdir(dir, { recursive: true })
  const name = `tts-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.${ext}`
  await writeFile(join(dir, name), bytes, { flag: 'wx' })
  return { url: `/uploads/${name}`, size: bytes.length }
}
