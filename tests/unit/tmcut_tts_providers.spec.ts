/**
 * Two local TTS engines behind one loopback proxy.
 *
 * VieNeu-TTS listens on 127.0.0.1:8000 with the OpenAI-compatible shape
 * (`/health`, `/v1/voices`, `/v1/audio/speech`). CIT Voice Studio listens on
 * 127.0.0.1:8001 with its own documented shape (`/health`, `/voices`,
 * `POST /api/tts/generate`, JSON body, binary WAV/MP3 answer). The Nitro route
 * and the Electron IPC handler are both the only server-side fetch an
 * untrusted tab (or renderer) can aim, so the provider must be an enum that
 * picks a route table — never a client-supplied path.
 *
 * Pinned here:
 *  * the provider id is validated, not interpolated;
 *  * both engines stay inside the same loopback-only boundary;
 *  * each engine gets its own request body (CIT speaks `voice_id`, VieNeu
 *    speaks `voice`) and its own default port;
 *  * the stored file's extension follows the content type the engine actually
 *    returned, because CIT falls back to WAV when it cannot encode MP3;
 *  * the two implementations (Nitro + Electron) share the same table, so they
 *    cannot drift apart the way the limits once did;
 *  * the app sends a provider and remembers the choice.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  audioExtension,
  isAudioBytes,
  normalizeTtsBaseUrl,
  normalizeTtsProvider,
  speechRequest,
  TTS_PROVIDERS
} from '../../server/utils/tts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const require = createRequire(import.meta.url)
const electronVoice = require('../../electron/tools/tmcut-voice.cjs')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

check('the default engine stays VieNeu so existing links keep working', () => {
  assert.equal(normalizeTtsProvider(undefined), 'vieneu')
  assert.equal(normalizeTtsProvider(''), 'vieneu')
  assert.equal(normalizeTtsProvider(' CIT '), 'cit')
})

check('an unknown engine is rejected, never treated as a route', () => {
  for (const value of ['../admin', 'http://evil', 'vieneu2', 7]) {
    assert.throws(() => normalizeTtsProvider(value), /engine/i, `accepted ${String(value)}`)
  }
})

check('each engine keeps its documented default port', () => {
  assert.equal(TTS_PROVIDERS.vieneu.defaultBaseUrl, 'http://127.0.0.1:8000')
  assert.equal(TTS_PROVIDERS.cit.defaultBaseUrl, 'http://127.0.0.1:8001')
  assert.equal(normalizeTtsBaseUrl(undefined, 'cit'), 'http://127.0.0.1:8001')
})

check('the loopback boundary covers the new engine too', () => {
  assert.throws(() => normalizeTtsBaseUrl('http://192.168.1.5:8001', 'cit'), /loopback/i)
  assert.throws(() => normalizeTtsBaseUrl('https://127.0.0.1:8001', 'cit'), /loopback/i)
  assert.throws(() => normalizeTtsBaseUrl('http://127.0.0.1:8001/api', 'cit'), /origin/i)
})

check('route tables are the documented ones', () => {
  assert.deepEqual(TTS_PROVIDERS.vieneu.routes, {
    health: '/health',
    voices: '/v1/voices',
    synthesize: '/v1/audio/speech',
    enroll: '/v1/voices',
    consent: null
  })
  assert.deepEqual(TTS_PROVIDERS.cit.routes, {
    health: '/health',
    voices: '/voices',
    synthesize: '/api/tts/generate',
    enroll: '/api/voices/custom',
    consent: '/api/voices/consent'
  })
})

check('each engine gets its own request body', () => {
  assert.deepEqual(speechRequest('vieneu', 'xin chào', 'Minh Đức'), {
    model: 'vieneu-v3-turbo',
    input: 'xin chào',
    voice: 'Minh Đức',
    response_format: 'wav',
    stream_format: 'audio'
  })
  const cit = speechRequest('cit', 'xin chào', 'Minh Đức')
  assert.deepEqual(cit, { text: 'xin chào', voice_id: 'Minh Đức', format: 'wav' },
    'CIT speaks voice_id/format, and silently ignores VieNeu fields')
})

check('the stored extension is the content type that arrived', () => {
  assert.equal(audioExtension('audio/wav'), 'wav')
  assert.equal(audioExtension('audio/x-wav; charset=binary'), 'wav')
  assert.equal(audioExtension('audio/mpeg'), 'mp3')
  assert.equal(audioExtension('audio/mp3'), 'mp3')
  assert.throws(() => audioExtension('text/html'), /audio/i,
    'a proxy error page must not be stored as narration')
  assert.throws(() => audioExtension(null), /audio/i)
})

check('the bytes must be the container the header claims', () => {
  const wav = Buffer.alloc(44)
  wav.write('RIFF', 0, 'ascii')
  wav.writeUInt32LE(36, 4)
  wav.write('WAVE', 8, 'ascii')
  assert.equal(isAudioBytes(wav, 'wav'), true)
  assert.equal(isAudioBytes(wav, 'mp3'), false)
  const mp3 = Buffer.concat([Buffer.from('ID3\u0004', 'latin1'), Buffer.alloc(60)])
  assert.equal(isAudioBytes(mp3, 'mp3'), true)
  assert.equal(isAudioBytes(mp3, 'wav'), false)
  assert.equal(isAudioBytes(Buffer.from('<html>nope</html>'), 'mp3'), false)
})

check('Electron and Nitro cannot drift: same table, same validation', () => {
  assert.equal(electronVoice.normalizeTtsProvider('cit'), 'cit')
  assert.equal(electronVoice.normalizeTtsProvider(undefined), 'vieneu')
  assert.throws(() => electronVoice.normalizeTtsProvider('nope'), /engine/i)
  assert.deepEqual(electronVoice.TTS_PROVIDERS, TTS_PROVIDERS)
  assert.deepEqual(electronVoice.speechRequest('cit', 'a', 'b'), speechRequest('cit', 'a', 'b'))
  assert.equal(electronVoice.audioExtension('audio/mpeg'), 'mp3')
})

check('both proxy routes take the engine from the request', () => {
  const status = read('server/api/v1/media/tts/status.get.ts')
  const synth = read('server/api/v1/media/tts.post.ts')
  for (const source of [status, synth]) {
    assert.match(source, /normalizeTtsProvider\(/, 'a route skips engine validation')
    assert.match(source, /provider/, 'a route never forwards the engine')
  }
  assert.match(synth, /audioExtension\(/, 'the synthesised file is named by guesswork')
})

check('the desktop handler takes the engine from IPC args', () => {
  const controller = read('electron/tools/tmcut.controller.cjs')
  const synth = controller.slice(controller.indexOf(':synthesizeVoice'))
  assert.match(synth.slice(0, 1500), /normalizeTtsProvider\(/, 'synthesizeVoice ignores the provider')
  assert.match(synth.slice(0, 1500), /speechRequest\(/, 'synthesizeVoice still hard-codes the VieNeu body')
})

check('Voice Studio sends and remembers the engine', () => {
  const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
  assert.match(body, /tmcut_tts_provider/, 'the chosen engine is forgotten on reload')
  assert.match(body, /provider:\s*provider\.value/, 'the UI never tells the proxy which engine')
  assert.match(body, /TTS_PROVIDERS|providers/, 'the engine list is not rendered from one source')
})

check('both locales name the second engine', () => {
  for (const locale of ['en', 'vi']) {
    const copy = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.voice
    assert.equal(typeof copy?.provider, 'string', `${locale} has no engine label`)
    assert.equal(typeof copy?.providers?.cit, 'string', `${locale} cannot name CIT Voice Studio`)
  }
})

console.log(`tmcut_tts_providers: ${passed} passed`)
