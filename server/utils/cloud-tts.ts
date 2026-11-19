import { setTimeout as delay } from 'node:timers/promises'
import {
  isMp3,
  MAX_TTS_AUDIO_BYTES,
  readBounded,
  saveGeneratedAudio
} from './tts'

/**
 * Web-runtime Google Translate TTS.
 *
 * The desktop build reaches every cloud provider through Main; the browser
 * build can only offer the keyless one, and it must not become an open proxy
 * for arbitrary destinations. The endpoint is fixed here, the language is an
 * allowlist, and the text is chunked to the service's ~200-char URL limit.
 *
 * Limits mirror electron/tools/tmcut-cloud-voice.cjs — the node spec pins the
 * two in step.
 */
export const GTTS_VOICES = [
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
] as const
export type GttsLanguage = typeof GTTS_VOICES[number]['id']
export const GTTS_LANGUAGES: readonly GttsLanguage[] = GTTS_VOICES.map(voice => voice.id)
export const GTTS_MAX_CHARS = 190
export const MAX_CLOUD_TEXT_LENGTH = 5000

const GTTS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export function validateGttsInput(text: unknown, voice: unknown): { text: string, voice: GttsLanguage } {
  const cleanText = typeof text === 'string' ? text.trim() : ''
  if (!cleanText) throw new Error('Enter narration text first')
  if (cleanText.length > MAX_CLOUD_TEXT_LENGTH) throw new Error(`Narration must be ${MAX_CLOUD_TEXT_LENGTH} characters or fewer`)
  const language = (typeof voice === 'string' ? voice.trim() : '') || 'vi'
  if (!GTTS_LANGUAGES.includes(language as GttsLanguage)) throw new Error('Choose a supported Google Translate voice')
  return { text: cleanText, voice: language as GttsLanguage }
}

/** Provider catalogue for the browser build. The desktop app gets the same
 *  shape from Main with its key flags filled in; here only gtts is reachable. */
export function webCloudProviders() {
  return [{
    id: 'gtts',
    label: 'Google Translate',
    keySlot: null,
    needsRegion: false,
    voiceInput: 'select' as const,
    defaultVoice: 'vi',
    voices: GTTS_VOICES.map(voice => ({ id: voice.id, label: voice.label })),
    hasKey: true,
    hasRegion: true
  }]
}

/** Split text so every request stays under the service's ~200-char limit:
 *  sentence boundaries first, word boundaries only for long sentences. */
export function chunkGttsText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?…]+[.!?…]*\s*/gu) || [clean]
  const chunks: string[] = []
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

export function gttsUrl(language: string, chunk: string): string {
  return `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(language)}&q=${encodeURIComponent(chunk)}`
}

const GTTS_TIMEOUT_MS = 60_000

/** 429/503 get up to two retries: honour Retry-After, else 500 ms doubling. */
async function fetchGtts(url: string, signal: AbortSignal, attempts = 3): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      headers: { 'user-agent': GTTS_USER_AGENT, 'accept': 'audio/mpeg' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(GTTS_TIMEOUT_MS)])
    })
    if ((response.status !== 429 && response.status !== 503) || attempt >= attempts - 1) return response
    await response.body?.cancel().catch(() => {})
    const retryAfter = Number(response.headers.get('retry-after'))
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 5000)
      : Math.min(500 * 2 ** attempt, 4000)
    await delay(wait, undefined, { signal })
  }
}

/** `signal` aborts the whole take between (or during) chunk requests — the
 *  route wires it to the client connection so a closed tab stops the work. */
export async function synthesizeGtts(
  text: string,
  voice: GttsLanguage,
  options: { signal?: AbortSignal } = {}
): Promise<{ url: string, size: number }> {
  const signal = options.signal || new AbortController().signal
  const parts: Buffer[] = []
  for (const chunk of chunkGttsText(text)) {
    signal.throwIfAborted()
    const response = await fetchGtts(gttsUrl(voice, chunk), signal)
    if (!response.ok) throw new Error(`Google Translate HTTP ${response.status}`)
    parts.push(await readBounded(response, MAX_TTS_AUDIO_BYTES))
  }
  const bytes = Buffer.concat(parts)
  if (!bytes.length) throw new Error('Google Translate returned empty audio')
  if (!isMp3(bytes)) throw new Error('Google Translate did not return MP3 audio')
  return saveGeneratedAudio(bytes, 'mp3')
}
