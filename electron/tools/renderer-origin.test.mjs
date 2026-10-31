// Renderer origin rules — plain Node, no Electron.
// Run: node --test electron/tools/renderer-origin.test.mjs
//
// Passkeys depend on this: WebAuthn rejects an IP address as a relying party
// ID, so a renderer served from 127.0.0.1 can never complete a ceremony. The
// pinned contract is that the loaded origin is the localhost one.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolveOrigins } = require('./renderer-origin.cjs')

const isIpLiteralOrigin = origin => /^https?:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(origin)

describe('packaged renderer origin', () => {
  const origins = resolveOrigins({ isDev: false, port: 3456, devPort: 4003 })

  it('loads from localhost, never an IP literal', () => {
    assert.equal(origins.primary, 'http://localhost:3456')
    assert.equal(isIpLiteralOrigin(origins.primary), false)
  })

  it('keeps the legacy IP origin for the one-time migration only', () => {
    assert.equal(origins.legacy, 'http://127.0.0.1:3456')
    assert.notEqual(origins.legacy, origins.primary)
  })

  it('allows media:// CORS for both loopback names', () => {
    assert.deepEqual(origins.allowed, ['http://localhost:3456', 'http://127.0.0.1:3456'])
  })
})

describe('dev renderer origin', () => {
  const origins = resolveOrigins({ isDev: true, port: 3456, devPort: 4003 })

  it('loads from localhost on the dev port', () => {
    assert.equal(origins.primary, 'http://localhost:4003')
    assert.equal(isIpLiteralOrigin(origins.primary), false)
  })

  it('has no migration source in dev', () => {
    assert.equal(origins.legacy, null)
  })
})
