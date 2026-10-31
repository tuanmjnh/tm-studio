import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../config/index'

/**
 * Web-runtime bridge to a local VieNeu-TTS server.
 *
 * The Electron build calls the service from the main process. The browser build
 * has no IPC and cannot fetch it directly (CORS, plus a page script would be
 * able to point the request anywhere), so Nitro proxies instead. The base URL
 * is pinned to loopback for exactly that reason: this endpoint must not become
 * an SSRF pivot for a logged-in browser tab.
 *
 * Limits mirror electron/tools/tmcut-voice.cjs — keep the two in step.
 */
export const DEFAULT_TTS_BASE_URL = 'http://127.0.0.1:8000'
export const MAX_TTS_TEXT_LENGTH = 20_000
export const MAX_TTS_AUDIO_BYTES = 64 * 1024 * 1024
const TTS_TIMEOUT_MS = 120_000

export function normalizeTtsBaseUrl(value: unknown): string {
  let url: URL
  try {
    url = new URL(String(value || DEFAULT_TTS_BASE_URL).trim())
  } catch {
    throw new Error('Invalid VieNeu-TTS URL')
  }
  // `URL` keeps the brackets around IPv6 hostnames, so the loopback form of
  // ::1 arrives as "[::1]".
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname.toLowerCase())) {
    throw new Error('VieNeu-TTS must use an HTTP loopback URL (localhost)')
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('Enter the VieNeu-TTS server origin only, for example http://127.0.0.1:8000')
  }
  return url.origin
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

export function ttsServiceError(status: number, body: string): string {
  let message = String(body || '').trim()
  try {
    const json = JSON.parse(message) as Record<string, unknown>
    message = String(json?.detail || (json?.error as Record<string, unknown> | undefined)?.message || json?.message || message)
  } catch {
    // Keep the service's plain-text error.
  }
  return message ? `VieNeu-TTS HTTP ${status}: ${message.slice(0, 500)}` : `VieNeu-TTS HTTP ${status}`
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

/** Persist a synthesized WAV next to the other uploads so /uploads/** serves
 *  it and the media library can treat it as an ordinary asset path. */
export async function saveGeneratedWav(bytes: Buffer): Promise<{ url: string, size: number }> {
  const dir = config.uploads.dir
  await mkdir(dir, { recursive: true })
  const name = `tts-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}.wav`
  await writeFile(join(dir, name), bytes, { flag: 'wx' })
  return { url: `/uploads/${name}`, size: bytes.length }
}
