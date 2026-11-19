/**
 * Cloud TTS providers for Voice Studio (R146).
 *
 * Five engines behind one registry: the keyless Google Translate read-aloud and
 * four key-bearing APIs (OpenAI, ElevenLabs, Azure Speech, Google Cloud TTS).
 * The desktop app synthesizes all of them in Main; the browser build can only
 * reach the keyless one through the Nitro route.
 *
 * Pinned here:
 *  * every provider builds the request the documented API expects;
 *  * gtts text is chunked under the service limit and concatenated;
 *  * credentials are read from config slots in Main, never from IPC arguments,
 *    and an upstream error body cannot carry the key back to the renderer;
 *  * the web route exposes gtts only and the gtts language list matches the
 *    desktop registry;
 *  * renderer, preload and shared types expose exactly those calls.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const require = createRequire(import.meta.url)
const cloud = require('../../electron/tools/tmcut-cloud-voice.cjs')
const { isSecretSlot } = require('../../electron/tools/secret-slots.cjs')

const web = await import('../../server/utils/cloud-tts')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

check('the registry offers one keyless engine and four key-bearing ones', () => {
  const list = cloud.cloudProviderList()
  assert.deepEqual(list.map((item: { id: string }) => item.id), ['gtts', 'openai', 'elevenlabs', 'azure', 'google'])
  assert.equal(cloud.CLOUD_PROVIDERS.gtts.keySlot, null)
  for (const id of ['openai', 'elevenlabs', 'azure', 'google']) {
    assert.ok(cloud.CLOUD_PROVIDERS[id].keySlot, `${id} has no key slot`)
    assert.ok(isSecretSlot(cloud.CLOUD_PROVIDERS[id].keySlot), `${id} slot is not encrypted at rest`)
  }
  assert.equal(isSecretSlot('TMCUT_AZURE_SPEECH_REGION'), false, 'the region is not a credential')
  assert.equal(cloud.normalizeCloudProvider(''), 'gtts')
  assert.throws(() => cloud.normalizeCloudProvider('edge'), /Unknown cloud voice provider/)
})

check('voice, key, region and text validation reject what the APIs would', () => {
  assert.equal(cloud.validateCloudVoice('openai', ''), 'nova')
  assert.equal(cloud.validateCloudVoice('elevenlabs', ' 21m00Tcm4TlvDq8ikWAM '), '21m00Tcm4TlvDq8ikWAM')
  assert.throws(() => cloud.validateCloudVoice('elevenlabs', 'short'), /valid ElevenLabs voice ID/)
  assert.throws(() => cloud.validateCloudVoice('azure', 'xx-XX-NopeNeural'), /supported Azure Speech voice/)
  assert.equal(cloud.validateCloudRegion(' southeastasia '), 'southeastasia')
  assert.throws(() => cloud.validateCloudRegion('southeast asia'), /Azure region/)
  assert.throws(() => cloud.validateCloudKey(''), /API key/)
  assert.throws(() => cloud.validateCloudKey('abc\r\nx-injected: 1'), /not valid/)
  assert.throws(() => cloud.validateCloudKey('x'.repeat(513)), /not valid/)
  assert.throws(() => cloud.validateCloudText('   '), /Enter narration text/)
  assert.throws(() => cloud.validateCloudText('x'.repeat(cloud.MAX_CLOUD_TEXT_LENGTH + 1)), /characters or fewer/)
  assert.throws(() => cloud.cloudRequests('openai', { text: 'x'.repeat(4097), voice: 'nova', key: 'sk-test' }), /4096 characters/)
  assert.throws(() => cloud.cloudRequests('google', { text: 'ế'.repeat(2600), voice: 'vi-VN-Neural2-A', key: 'g-test' }), /5000 bytes/)
})

check('gtts text is chunked under 190 characters and joins back losslessly', () => {
  const text = 'Xin chào. ' + 'Đây là một câu rất dài không có dấu chấm nào cả và nó cứ kéo dài mãi '.repeat(6) + 'Cuối cùng.'
  const chunks = cloud.chunkGttsText(text)
  assert.ok(chunks.length > 1, 'a long text was not split')
  for (const chunk of chunks) assert.ok(chunk.length <= cloud.GTTS_MAX_CHARS, `chunk of ${chunk.length} chars`)
  assert.equal(chunks.join(' '), text.replace(/\s+/g, ' ').trim())
  const word = 'a'.repeat(400)
  assert.deepEqual(cloud.chunkGttsText(word), ['a'.repeat(190), 'a'.repeat(190), 'a'.repeat(20)])
})

check('each provider builds its documented request', () => {
  const gtts = cloud.cloudRequests('gtts', { text: 'Xin chào.', voice: 'vi' })
  assert.equal(gtts.length, 1)
  assert.equal(gtts[0].init.method, 'GET')
  const gttsUrl = new URL(gtts[0].url)
  assert.equal(gttsUrl.hostname, 'translate.google.com')
  assert.equal(gttsUrl.searchParams.get('tl'), 'vi')
  assert.equal(gttsUrl.searchParams.get('q'), 'Xin chào.')
  assert.equal(gttsUrl.searchParams.has('key'), false, 'the keyless engine carries a key')

  const openai = cloud.cloudRequests('openai', { text: 'Hello', voice: 'nova', key: 'sk-test' })[0]
  assert.equal(openai.url, 'https://api.openai.com/v1/audio/speech')
  assert.equal(openai.init.headers['authorization'], 'Bearer sk-test')
  const openaiBody = JSON.parse(openai.init.body)
  assert.equal(openaiBody.model, 'gpt-4o-mini-tts')
  assert.equal(openaiBody.voice, 'nova')
  assert.equal(openaiBody.response_format, 'mp3')

  const eleven = cloud.cloudRequests('elevenlabs', { text: 'Hello', voice: '21m00Tcm4TlvDq8ikWAM', key: 'xi-test' })[0]
  assert.equal(eleven.url, 'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128')
  assert.equal(eleven.init.headers['xi-api-key'], 'xi-test')
  assert.equal(JSON.parse(eleven.init.body).model_id, 'eleven_multilingual_v2')

  const azure = cloud.cloudRequests('azure', { text: 'A & B < C', voice: 'vi-VN-HoaiMyNeural', key: 'az-test', region: 'southeastasia' })[0]
  assert.equal(azure.url, 'https://southeastasia.tts.speech.microsoft.com/cognitiveservices/v1')
  assert.equal(azure.init.headers['ocp-apim-subscription-key'], 'az-test')
  assert.equal(azure.init.headers['x-microsoft-outputformat'], 'audio-24khz-48kbitrate-mono-mp3')
  assert.match(azure.init.body, /<voice name='vi-VN-HoaiMyNeural'>A &amp; B &lt; C<\/voice>/)

  const google = cloud.cloudRequests('google', { text: 'Hello', voice: 'vi-VN-Neural2-A', key: 'g-test' })[0]
  assert.match(google.url, /^https:\/\/texttospeech\.googleapis\.com\/v1\/text:synthesize\?key=g-test$/)
  const googleBody = JSON.parse(google.init.body)
  assert.equal(googleBody.voice.languageCode, 'vi-VN')
  assert.equal(googleBody.audioConfig.audioEncoding, 'LINEAR16')
})

check('gtts sends one request per chunk, never with credentials', () => {
  const requests = cloud.cloudRequests('gtts', { text: 'Câu một. '.repeat(60), voice: 'vi' })
  assert.ok(requests.length > 1, 'long text was not split')
  for (const request of requests) {
    assert.equal(/key|authorization|xi-api-key/i.test(request.url), false)
    assert.equal(Object.keys(request.init.headers).sort().join(','), 'accept,user-agent')
  }
})

check('response bodies become one audio file, including the Google JSON envelope', () => {
  const riff = Buffer.alloc(44)
  riff.write('RIFF', 0, 'ascii')
  riff.write('WAVE', 8, 'ascii')
  const google = cloud.cloudAudio('google', [Buffer.from(JSON.stringify({ audioContent: riff.toString('base64') }))])
  assert.equal(google.ext, 'wav')
  assert.deepEqual(google.bytes, riff)
  assert.throws(() => cloud.cloudAudio('google', [Buffer.from('not json')]), /did not return JSON/)

  const frame = Buffer.from([0xFF, 0xFB, 0x90, 0x00])
  const mp3 = cloud.cloudAudio('gtts', [frame, frame])
  assert.equal(mp3.ext, 'mp3')
  assert.equal(mp3.bytes.length, 8)
  assert.equal(cloud.sniffAudioExt(Buffer.from([0x49, 0x44, 0x33])), 'mp3')
  assert.equal(cloud.sniffAudioExt(Buffer.from('nope')), null)
})

check('voice lists are fetched from the provider with its own credential', () => {
  const eleven = cloud.cloudVoiceListRequest('elevenlabs', { key: 'xi-test' })
  assert.equal(eleven.url, 'https://api.elevenlabs.io/v1/voices')
  assert.equal(eleven.init.headers['xi-api-key'], 'xi-test')
  const google = cloud.cloudVoiceListRequest('google', { key: 'g-test' })
  assert.equal(google.url, 'https://texttospeech.googleapis.com/v1/voices?key=g-test')
  assert.throws(() => cloud.cloudVoiceListRequest('azure', { key: 'x' }), /ElevenLabs and Google Cloud TTS only/)
  assert.throws(() => cloud.cloudVoiceListRequest('elevenlabs', {}), /API key/)

  assert.deepEqual(
    cloud.parseCloudVoiceList('elevenlabs', JSON.stringify({ voices: [{ voice_id: 'abc123def4', name: 'My Voice' }, { voice_id: '', name: 'skip' }] })),
    [{ id: 'abc123def4', label: 'My Voice' }]
  )
  assert.deepEqual(
    cloud.parseCloudVoiceList('google', JSON.stringify({ voices: [{ name: 'vi-VN-Neural2-A', languageCodes: ['vi-VN'] }] })),
    [{ id: 'vi-VN-Neural2-A', label: 'vi-VN-Neural2-A · vi-VN' }]
  )
  assert.throws(() => cloud.parseCloudVoiceList('google', 'nope'), /was not JSON/)
})

check('service errors keep the provider label and the upstream message', () => {
  assert.equal(
    cloud.cloudServiceError('openai', 401, JSON.stringify({ error: { message: 'Incorrect API key provided' } })),
    'OpenAI HTTP 401: Incorrect API key provided'
  )
  assert.equal(cloud.cloudServiceError('azure', 400, 'bad region'), 'Azure Speech HTTP 400: bad region')
  assert.equal(cloud.cloudServiceError('gtts', 429, ''), 'Google Translate HTTP 429')
})

const controller = read('electron/tools/tmcut.controller.cjs')
const preload = read('electron/preload.cjs')
const types = read('shared/types/electron.ts')
const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
const getRoute = read('server/api/v1/media/tts-cloud.get.ts')

check('Main reads cloud keys from its own environment and redacts them from errors', () => {
  const start = controller.indexOf(':cloudSynthesize')
  assert.ok(start > 0, 'the cloudSynthesize handler is missing')
  const block = controller.slice(start, controller.indexOf(':saveRecording', start))
  assert.match(block, /process\.env\[spec\.keySlot\]/, 'the key is not read from the config slot')
  assert.match(block, /process\.env\.TMCUT_AZURE_SPEECH_REGION/, 'the Azure region is not read from config')
  assert.equal(/args\.(key|region|apiKey)/.test(block), false, 'a credential is accepted from the renderer')
  assert.match(block, /text\.split\(key\)\.join\('\*\*\*\*\*\*\*\*'\)/, 'an upstream error can echo the key')
  assert.match(block, /cloud-\$\{provider\}-tts-/, 'the take is not written under recordings with its provider')
})

check('a cloud take is a cancellable job with one progress event per chunk', () => {
  const cancelStart = controller.indexOf(':cloudCancel')
  assert.ok(cancelStart > 0, 'the cloudCancel handler is missing')
  const synth = controller.slice(controller.indexOf(':cloudSynthesize'), cancelStart)
  assert.match(synth, /const job = new AbortController\(\)/, 'the take is not abortable')
  assert.match(synth, /cloudJobs\.set\(requestId, job\)/, 'the job is not registered for cancel')
  assert.match(synth, /cloudJobs\.delete\(requestId\)/, 'a finished job is leaked')
  assert.match(synth, /sendCloudProgress\(event, requestId, index \+ 1, requests\.length\)/, 'chunks do not report progress')
  assert.match(synth, /AbortSignal\.any\(\[job\.signal/, 'the job signal is not combined with the timeout')
  assert.match(synth, /canceled: true/, 'an aborted take is not reported as canceled')
  const cancel = controller.slice(cancelStart, controller.indexOf(':saveRecording', cancelStart))
  assert.match(cancel, /cloudJobs\.get\(requestId\)/, 'cancel does not resolve the running job')
  assert.match(cancel, /job\.abort\(\)/, 'cancel does not abort the fetch')

  const retry = controller.slice(controller.indexOf('function fetchCloudWithRetry'), controller.indexOf(':cloudVoices'))
  assert.match(retry, /status !== 429 && response\.status !== 503/, 'throttling is not detected')
  assert.match(retry, /retry-after/, 'Retry-After is ignored')
  assert.match(retry, /500 \* 2 \*\* attempt/, 'the fallback backoff is not exponential')

  const list = controller.slice(controller.indexOf(':cloudListVoices'), controller.indexOf(':cloudSynthesize'))
  assert.match(list, /cloudVoiceListRequest\(provider, \{ key \}\)/, 'the list is not built from the saved key')
  assert.match(list, /parseCloudVoiceList\(provider, text\)/, 'the list response is not parsed')
})

check('the renderer never sends a cloud credential over IPC', () => {
  const start = body.indexOf('async function makeCloudVoiceover')
  const block = body.slice(start, body.indexOf('async function addAutomaticCaptions', start))
  assert.match(block, /ipc\.cloudSynthesize\(\{\s*provider: [^,]+,\s*text: [^,]+,\s*voice: [^,]+,\s*requestId: [^}]+ \}\)/s, 'the synthesize call changed shape')
  assert.equal(/\bkey\s*:/.test(block), false, 'the renderer sends a key with the request')
  assert.match(block, /cloudProvider\.value === 'gtts'/, 'the web path is not limited to the keyless engine')
  assert.match(block, /'\/api\/v1\/media\/tts-cloud'/, 'the web path does not use the cloud route')
  assert.match(block, /signal: webCloudAbort\.signal/, 'the web take cannot be canceled')
  assert.match(block, /result\?\.canceled/, 'a canceled desktop take is not handled')
  assert.match(block, /isAbortError\(error\)/, 'an aborted web take is reported as a failure')
})

check('the cancel button and progress listener are wired into the panel', () => {
  assert.match(body, /onCloudProgress\?\.\(\(payload\) =>/, 'the panel does not listen for chunk progress')
  assert.match(body, /payload\.requestId !== cloudRequestId\.value/, 'progress from another take is accepted')
  assert.match(body, /ipc\.cloudCancel\(\{ requestId: cloudRequestId\.value \}\)/, 'the cancel button cannot reach Main')
  assert.match(body, /cloudProgressLabel/, 'the chunk counter is not rendered')
  assert.match(body, /effectiveCloudVoices/, 'the loaded voices do not replace the static list')
  assert.match(body, /ipc\.cloudListVoices\(\{ provider: cloudProvider\.value \}\)/, 'voices cannot be loaded on demand')
})

check('the key form writes config slots through the bridge, not IPC', () => {
  const start = body.indexOf('async function saveCloudKey')
  const block = body.slice(start, body.indexOf('async function makeCloudVoiceover', start))
  assert.match(block, /\[info\.keySlot\]: cloudKeyInput\.value\.trim\(\)/)
  assert.match(block, /values\.TMCUT_AZURE_SPEECH_REGION = region/)
  assert.match(block, /bridge\.setConfig\(values\)/)
})

check('preload and shared types expose the cloud calls', () => {
  assert.match(preload, /'cloudVoices', 'cloudSynthesize', 'cloudCancel', 'cloudListVoices'/)
  assert.match(preload, /'downloadProgress', 'engineProgress', 'cloudProgress'/)
  assert.match(types, /interface CloudVoiceProviderInfo/)
  assert.match(types, /cloudVoices\(\): Promise</)
  assert.match(types, /cloudSynthesize\(args: \{ provider: string, text: string, voice\?: string, requestId\?: string \}\)/)
  assert.match(types, /cloudCancel\(args: \{ requestId: string \}\)/)
  assert.match(types, /cloudListVoices\(args: \{ provider: string \}\)/)
  assert.match(types, /onCloudProgress\(callback: \(payload: \{ requestId: string, done: number, total: number \}\) => void\)/)
  const signature = types.split('\n').find(line => line.includes('cloudSynthesize(')) || ''
  assert.equal(/\bkey\b/i.test(signature), false, 'the IPC contract carries a key')
})

check('the web catalogue serves the keyless engine only and demands auth', () => {
  assert.match(getRoute, /if \(!event\.context\.auth\)/, 'the route has no auth guard')
  assert.match(getRoute, /webCloudProviders\(\)/)
  const providers = web.webCloudProviders()
  assert.deepEqual(providers.map((item: { id: string }) => item.id), ['gtts'])
  assert.equal(providers[0].hasKey, true)
  assert.deepEqual(web.GTTS_VOICES.map(voice => voice.id), cloud.CLOUD_PROVIDERS.gtts.voices.map((voice: { id: string }) => voice.id))
  assert.equal(web.GTTS_MAX_CHARS, cloud.GTTS_MAX_CHARS)
  assert.deepEqual(web.chunkGttsText('Một hai. Ba bốn.'), cloud.chunkGttsText('Một hai. Ba bốn.'))
  assert.throws(() => web.validateGttsInput('', 'vi'), /Enter narration text/)
  assert.throws(() => web.validateGttsInput('hello', 'xx'), /supported Google Translate voice/)

  const util = read('server/utils/cloud-tts.ts')
  const post = read('server/api/v1/media/tts-cloud.post.ts')
  assert.match(util, /AbortSignal\.any\(\[signal, AbortSignal\.timeout\(GTTS_TIMEOUT_MS\)\]\)/, 'the web fetch has no combined signal')
  assert.match(util, /signal\.throwIfAborted\(\)/, 'cancellation is not checked between chunks')
  assert.match(util, /response\.status !== 429 && response\.status !== 503/, 'the web fetch has no throttle retry')
  assert.match(post, /event\.node\.res\.on\('close'/, 'a closed tab does not cancel the take')
  assert.match(post, /abort\.abort\(\)/)
})

check('both locales carry the cloud keys without intlify syntax', () => {
  const keys = ['cloudTab', 'cloudProvider', 'cloudVoice', 'cloudVoiceId', 'cloudSettingsTitle', 'cloudKey', 'cloudKeySaved', 'cloudKeySaveFailed', 'cloudRegion', 'cloudRegionInvalid', 'cloudLoadFailed', 'cloudPrivacy', 'cloudWebNote', 'cloudDesktopOnly', 'cloudCanceled', 'cloudProgress', 'cloudVoicesLoad', 'cloudVoicesLoaded', 'cloudVoicesFailed', 'cancel']
  const engines = ['gtts', 'openai', 'elevenlabs', 'azure', 'google']
  for (const locale of ['en', 'vi']) {
    const tmcut = JSON.parse(read(`i18n/locales/${locale}.json`)).tmcut.voice
    for (const key of keys) {
      assert.equal(typeof tmcut[key], 'string', `${locale} is missing tmcut.voice.${key}`)
      assert.equal(tmcut[key].includes('@'), false, `${locale}.${key} contains intlify linked-message syntax`)
    }
    for (const engine of engines) {
      assert.equal(typeof tmcut.engines[engine], 'string', `${locale} is missing tmcut.voice.engines.${engine}`)
    }
  }
})

console.log(`\n${passed}/${passed} cloud voice checks passed`)
