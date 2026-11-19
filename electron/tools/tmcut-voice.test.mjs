// TTS engine contract — plain Node, no network, no Electron.
// Run: node --test electron/tools/tmcut-voice.test.mjs
//
// The desktop IPC handlers and the Nitro proxy talk to the same two loopback
// engines. tests/unit/tmcut_tts_providers.spec.ts pins their equality; this
// file pins the behaviour of the Electron copy on its own.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const voice = require('./tmcut-voice.cjs')

describe('engine selection', () => {
  it('defaults to VieNeu and accepts CIT', () => {
    assert.equal(voice.normalizeTtsProvider(undefined), 'vieneu')
    assert.equal(voice.normalizeTtsProvider(' cit '), 'cit')
  })

  it('rejects anything that is not an engine id', () => {
    for (const value of ['nope', '../x', 'http://127.0.0.1']) {
      assert.throws(() => voice.normalizeTtsProvider(value), /engine/i)
    }
  })
})

describe('loopback boundary', () => {
  it('gives each engine its own default origin', () => {
    assert.equal(voice.normalizeTtsBaseUrl(undefined, 'vieneu'), 'http://127.0.0.1:8000')
    assert.equal(voice.normalizeTtsBaseUrl(undefined, 'cit'), 'http://127.0.0.1:8001')
  })

  it('refuses LAN, https and paths for both engines', () => {
    for (const provider of ['vieneu', 'cit']) {
      assert.throws(() => voice.normalizeTtsBaseUrl('http://192.168.1.9:8001', provider), /loopback/i)
      assert.throws(() => voice.normalizeTtsBaseUrl('https://127.0.0.1:8001', provider), /loopback/i)
      assert.throws(() => voice.normalizeTtsBaseUrl('http://127.0.0.1:8001/api', provider), /origin/i)
    }
  })
})

describe('request bodies', () => {
  it('speaks each engine\u2019s field names', () => {
    assert.deepEqual(voice.speechRequest('cit', 'a', 'b'), { text: 'a', voice_id: 'b', format: 'wav' })
    assert.deepEqual(voice.speechRequest('vieneu', 'a', 'b'), {
      model: 'vieneu-v3-turbo',
      input: 'a',
      voice: 'b',
      response_format: 'wav',
      stream_format: 'audio'
    })
  })
})

describe('audio answer', () => {
  it('names the file after the content type', () => {
    assert.equal(voice.audioExtension('audio/wav'), 'wav')
    assert.equal(voice.audioExtension('audio/mpeg'), 'mp3')
    assert.throws(() => voice.audioExtension('text/html'), /audio/i)
  })

  it('checks the bytes are the claimed container', () => {
    const wav = Buffer.alloc(44)
    wav.write('RIFF', 0, 'ascii')
    wav.writeUInt32LE(36, 4)
    wav.write('WAVE', 8, 'ascii')
    const mp3 = Buffer.concat([Buffer.from('ID3\u0004', 'latin1'), Buffer.alloc(32)])
    assert.equal(voice.isAudioBytes(wav, 'wav'), true)
    assert.equal(voice.isAudioBytes(mp3, 'mp3'), true)
    assert.equal(voice.isAudioBytes(wav, 'mp3'), false)
    assert.equal(voice.isAudioBytes(Buffer.from('<html>'), 'mp3'), false)
  })
})
