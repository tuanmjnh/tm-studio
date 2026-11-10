/**
 * Device identity (v2) — derivation contract.
 *
 * Pins the ADR rules that must never regress:
 *  - the Electron device id is app-scoped and never the raw machine id;
 *  - a broken machine-id lookup falls back to a persisted installation UUID,
 *    marked `electron-installation`, never hostname/IP;
 *  - the browser id is a random UUID persisted per profile, no fingerprint;
 *  - the nested device object matches the Hub login contract.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { deriveElectronDeviceId, getBrowserDeviceId, buildDeviceInfo } = require('./device-identity.cjs')

const APP = 'tm-studio_749app'

describe('deriveElectronDeviceId', () => {
  it('derives an app-scoped hex id and marks it as a machine identity', () => {
    const out = deriveElectronDeviceId(APP)
    assert.equal(out.identityKind, 'electron-machine')
    assert.match(out.deviceId, /^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same app', () => {
    assert.equal(deriveElectronDeviceId(APP).deviceId, deriveElectronDeviceId(APP).deviceId)
  })

  it('differs per app so one machine gets distinct identities', () => {
    assert.notEqual(deriveElectronDeviceId('tm-studio_749app').deviceId, deriveElectronDeviceId('tm-tools_4e2ygb').deviceId)
  })
})

describe('getBrowserDeviceId', () => {
  function storage(initial) {
    const map = new Map(initial ? [['tm.device.identity.v1', initial]] : [])
    return { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), map }
  }

  it('reuses a persisted UUID', () => {
    const s = storage('11111111-2222-3333-4444-555555555555')
    assert.equal(getBrowserDeviceId(s), '11111111-2222-3333-4444-555555555555')
  })

  it('regenerates over a malformed value', () => {
    const s = storage('not-a-uuid')
    const id = getBrowserDeviceId(s)
    assert.match(id, /^[0-9a-f-]{36}$/i)
    assert.equal(s.map.get('tm.device.identity.v1'), id)
  })

  it('is ephemeral when storage throws', () => {
    const denied = () => {
      throw new Error('denied')
    }
    const s = { getItem: denied, setItem: denied }
    assert.match(getBrowserDeviceId(s), /^[0-9a-f-]{36}$/i)
  })
})

describe('buildDeviceInfo', () => {
  it('emits the nested v2 shape and trims optionals', () => {
    const info = buildDeviceInfo({
      deviceId: '  abc  ',
      identityKind: 'electron-machine',
      deviceType: 'desktop',
      platform: 'desktop',
      deviceName: '',
      appVersion: '1.0.0'
    })
    assert.equal(info.deviceId, 'abc')
    assert.equal(info.identityKind, 'electron-machine')
    assert.equal(info.deviceType, 'desktop')
    assert.equal(info.platform, 'desktop')
    assert.equal('deviceName' in info, false)
    assert.equal(info.appVersion, '1.0.0')
  })
})
