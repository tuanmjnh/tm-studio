// ai-secure unit tests — plain Node, no Electron, no network.
// Run: node --test electron/tools/ai-secure.test.mjs
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const sec = require('./ai-secure.cjs')

// A fake safeStorage mimicking the REAL contract (§203 probe lesson):
// encryptString returns a BUFFER, decryptString receives a Buffer back.
// The round-trip is stored in a Map so the contract is checkable without
// the OS keychain.
function makeFakeBackend() {
  const store = new Map()
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      const buf = Buffer.from('enc:' + plain, 'utf8')
      store.set(buf.toString('latin1'), plain)
      return buf
    },
    decryptString: (buf) => {
      const plain = store.get(buf.toString('latin1'))
      if (plain === undefined) {
        const err = new Error('decryption failed')
        err.name = 'Error'
        throw err
      }
      return plain
    }
  }
}

describe('ai-secure — safeStorage wrapper (R139)', () => {
  beforeEach(() => sec.__setSafeStorage(makeFakeBackend()))
  afterEach(() => sec.__setSafeStorage(null))

  it('encrypt wraps with the magic prefix and is never plaintext', () => {
    const out = sec.encrypt('sk-abc123')
    assert.ok(out.startsWith(sec.magicPrefix()))
    assert.ok(!out.includes('sk-abc123'))
  })

  it('encrypt is IDEMPOTENT: double-encrypt never double-wraps', () => {
    const once = sec.encrypt('k')
    assert.equal(sec.encrypt(once), once, 'encrypting an already-encrypted token is a no-op')
  })

  it('decrypt recovers the original plaintext through the round-trip', () => {
    assert.equal(sec.decrypt(sec.encrypt('sk-live-42')), 'sk-live-42')
  })

  it('decrypt is TOLERANT: plaintext tokens pass through unchanged', () => {
    assert.equal(sec.decrypt('plain-text-key'), 'plain-text-key')
    assert.equal(sec.decrypt(''), '')
    assert.equal(sec.decrypt(undefined), undefined)
    assert.equal(sec.decrypt(null), null)
  })

  it('decrypt returns null ONLY for a corrupt token claiming the prefix', () => {
    const corrupt = sec.magicPrefix() + 'not-a-real-blob'
    assert.equal(sec.decrypt(corrupt), null)
  })

  it('encrypt returns the plaintext when no backend is available', () => {
    sec.__setSafeStorage(null)
    assert.equal(sec.encrypt('sk-fallback'), 'sk-fallback')
    assert.equal(sec.isEncryptionAvailable(), false)
  })

  it('decrypt returns the plaintext when no backend is available', () => {
    sec.__setSafeStorage(null)
    assert.equal(sec.decrypt(sec.magicPrefix() + 'x'), sec.magicPrefix() + 'x')
  })
})
