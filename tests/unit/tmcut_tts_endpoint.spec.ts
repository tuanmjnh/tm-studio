/**
 * Web TTS proxy guards (server/utils/tts.ts).
 *
 * The browser build reaches the local VieNeu-TTS service through Nitro, which
 * makes that route the only place an untrusted tab can point a server-side
 * fetch. These checks pin the SSRF boundary: http + loopback only, origin only
 * (no path/query/credentials), and the same limits the Electron bridge uses.
 * The WAV checks pin the "do not store what we did not validate" rule.
 */
import {
  isWav,
  MAX_TTS_TEXT_LENGTH,
  normalizeTtsBaseUrl,
  parseTtsVoices,
  validateTtsInput
} from '../../server/utils/tts'

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

function rejects(value: unknown, label: string) {
  let threw = false
  try {
    normalizeTtsBaseUrl(value)
  } catch {
    threw = true
  }
  if (!threw) throw new Error(`expected ${label} to be rejected`)
  console.log(`[ok] rejects ${label}`)
  passed++
}

check('accepts 127.0.0.1 with a port', () => {
  if (normalizeTtsBaseUrl('http://127.0.0.1:8000') !== 'http://127.0.0.1:8000') throw new Error('origin changed')
})
check('accepts localhost and normalises a trailing slash', () => {
  if (normalizeTtsBaseUrl('http://localhost:8000/') !== 'http://localhost:8000') throw new Error('origin changed')
})
check('accepts IPv6 loopback', () => {
  if (normalizeTtsBaseUrl('http://[::1]:8000') !== 'http://[::1]:8000') throw new Error('origin changed')
})
check('defaults to the documented loopback origin', () => {
  if (normalizeTtsBaseUrl(undefined) !== 'http://127.0.0.1:8000') throw new Error('unexpected default')
})

rejects('https://127.0.0.1:8000', 'https loopback')
rejects('http://192.168.1.10:8000', 'a LAN address')
rejects('http://10.0.0.5:8000', 'a private-range address')
rejects('http://169.254.169.254', 'the metadata endpoint')
rejects('http://localhost.evil.test:8000', 'a look-alike host')
rejects('http://user:pass@127.0.0.1:8000', 'embedded credentials')
rejects('http://127.0.0.1:8000/api', 'a path')
rejects('http://127.0.0.1:8000?x=1', 'a query string')
rejects('http://127.0.0.1:8000#frag', 'a fragment')
rejects('not a url', 'a malformed value')

check('trims text and keeps the voice', () => {
  const input = validateTtsInput('  xin chào  ', '  vào  ')
  if (input.text !== 'xin chào' || input.voice !== 'vào') throw new Error('input not normalised')
})
check('rejects empty text, oversized text and oversized voice', () => {
  for (const [text, voice] of [['   ', 'a'], ['a'.repeat(MAX_TTS_TEXT_LENGTH + 1), 'a'], ['hi', 'v'.repeat(129)], ['hi', '']]) {
    let threw = false
    try {
      validateTtsInput(text, voice)
    } catch {
      threw = true
    }
    if (!threw) throw new Error(`accepted text=${text.length} voice=${voice.length}`)
  }
})

check('parses the three voice list shapes and skips nameless entries', () => {
  const fromArray = parseTtsVoices([{ name: 'A' }, 'B', { id: 'C' }, { description: 'no name' }, null])
  if (fromArray.length !== 3 || fromArray[0].name !== 'A' || fromArray[1].name !== 'B' || fromArray[2].name !== 'C') {
    throw new Error(JSON.stringify(fromArray))
  }
  if (parseTtsVoices({ voices: [{ name: 'V' }] }).length !== 1) throw new Error('voices[] not parsed')
  if (parseTtsVoices({ data: [{ name: 'D' }] }).length !== 1) throw new Error('data[] not parsed')
  if (parseTtsVoices(null).length !== 0) throw new Error('null payload not empty')
})

function wav(payloadBytes: number, declaredOverride?: number): Buffer {
  const bytes = Buffer.alloc(44 + payloadBytes)
  bytes.write('RIFF', 0, 'ascii')
  bytes.writeUInt32LE(declaredOverride ?? 36 + payloadBytes, 4)
  bytes.write('WAVE', 8, 'ascii')
  return bytes
}

check('accepts a well-formed RIFF/WAVE container', () => {
  if (!isWav(wav(16))) throw new Error('valid wav rejected')
})
check('rejects truncated, non-RIFF and over-declared payloads', () => {
  if (isWav(Buffer.alloc(20))) throw new Error('short buffer accepted')
  const mp3 = Buffer.alloc(64)
  mp3.write('ID3\u0004', 0, 'latin1')
  if (isWav(mp3)) throw new Error('non-RIFF accepted')
  // RIFF length claims more payload than the buffer actually holds.
  if (isWav(wav(16, 36 + 16 + 8))) throw new Error('over-declared length accepted')
})

console.log(`tmcut_tts_endpoint: ${passed} passed`)
