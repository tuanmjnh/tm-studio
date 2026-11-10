/**
 * Hub auth broker (v2) — the Electron Main trust boundary.
 *
 * Pins the rules that must never regress:
 *  - the renderer-visible payload NEVER contains `deviceCredential`;
 *  - the secret is written through the vault writer and mirrored to process.env;
 *  - a TOTP password step carries no credential, the second factor does;
 *  - every full-session call sends the nested device identity;
 *  - a vault write failure drops the credential instead of leaking it;
 *  - Hub rejections surface the statusMessage.
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createHubLoginBroker } = require('./hub-login-broker.cjs')

const HUB = 'http://hub.test'
const APP = 'tm-studio_749app'
const SECRET = 'device-secret-never-returned'

let calls = []
let respond = () => ({ status: 500, body: null })
let vaultWrites = []
let vaultShouldThrow = false
const values = { NUXT_PUBLIC_HUB_URL: HUB, NUXT_PUBLIC_HUB_APP_ID: APP }

const broker = createHubLoginBroker({
  configFile: () => 'config.env',
  readConfigFile: () => ({ exists: true, values: { ...values } }),
  writeConfigValues: (_file, next) => {
    if (vaultShouldThrow) throw new Error('vault unavailable')
    vaultWrites.push({ ...next })
    Object.assign(values, next)
  },
  fetchImpl: async (url, init) => {
    const body = JSON.parse(init.body)
    calls.push({ url, body })
    const reply = respond(url, body)
    return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, json: async () => reply.body }
  },
  platform: 'win32',
  arch: 'x64',
  version: '1.0.0'
})

const SESSION = {
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresIn: 900,
  user: { id: 'u1', email: 'a@b.c', name: 'A', appId: APP }
}

beforeEach(() => {
  calls = []
  vaultWrites = []
  vaultShouldThrow = false
  delete process.env.HUB_DEVICE_SECRET
})

afterEach(() => {
  delete process.env.HUB_DEVICE_SECRET
  delete process.env.HUB_DEVICE_ID
})

describe('deviceInfo', () => {
  it('returns metadata only', () => {
    const info = broker.deviceInfo()
    assert.equal(info.identityKind, 'electron-machine')
    assert.equal(info.deviceType, 'desktop')
    assert.equal(info.osPlatform, 'win32')
    assert.equal(JSON.stringify(info).includes(SECRET), false)
  })
})

describe('login', () => {
  it('sends the nested device identity and asks for a credential', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { ...SESSION } } })
    assert.equal((await broker.login({ email: 'a@b.c', password: 'pw' })).success, true)
    const sent = calls[0].body
    assert.equal(sent.appId, APP)
    assert.equal(sent.requestDeviceCredential, true)
    assert.equal(sent.device.identityKind, 'electron-machine')
    assert.equal(sent.platform, 'desktop')
  })

  it('persists the credential, mirrors env, and strips it from the result', async () => {
    respond = () => ({
      status: 200,
      body: { success: true, data: { ...SESSION, deviceCredential: { deviceId: 'dc-1', secret: SECRET, expiresAt: '2027-01-01T00:00:00.000Z', scopes: ['ai.relay'] } } }
    })
    const result = await broker.login({ email: 'a@b.c', password: 'pw' })
    assert.equal(result.credentialPersisted, true)
    assert.equal('deviceCredential' in result.data, false)
    assert.equal(JSON.stringify(result).includes(SECRET), false)
    assert.equal(values.HUB_DEVICE_ID, 'dc-1')
    assert.equal(values.HUB_DEVICE_SECRET, SECRET)
    assert.equal(values.HUB_DEVICE_USER_ID, 'u1')
    assert.equal(values.HUB_DEVICE_APP_ID, APP)
    assert.equal(process.env.HUB_DEVICE_SECRET, SECRET)
  })

  it('drops the credential instead of leaking it when the vault write fails', async () => {
    vaultShouldThrow = true
    respond = () => ({
      status: 200,
      body: { success: true, data: { ...SESSION, deviceCredential: { deviceId: 'dc-1', secret: SECRET, expiresAt: '', scopes: [] } } }
    })
    const result = await broker.login({ email: 'a@b.c', password: 'pw' })
    assert.equal(result.credentialPersisted, false)
    assert.equal(JSON.stringify(result).includes(SECRET), false)
    assert.equal(process.env.HUB_DEVICE_SECRET, undefined)
  })

  it('returns a TOTP challenge untouched and persists nothing', async () => {
    respond = () => ({ status: 200, body: { success: true, data: { totpRequired: true, pendingTotpToken: 'pending', user: { id: 'u1', email: 'a@b.c', name: 'A' } } } })
    const result = await broker.login({ email: 'a@b.c', password: 'pw' })
    assert.equal(result.data.totpRequired, true)
    assert.equal(vaultWrites.length, 0)
  })

  it('surfaces the Hub statusMessage on rejection', async () => {
    respond = () => ({ status: 403, body: { success: false, statusMessage: 'error.deviceApprovalRequired', message: 'pending' } })
    const result = await broker.login({ email: 'a@b.c', password: 'pw' })
    assert.equal(result.success, false)
    assert.equal(result.code, 'rejected')
    assert.equal(result.status, 403)
    assert.equal(result.statusMessage, 'error.deviceApprovalRequired')
  })
})

describe('verifyTotp', () => {
  it('re-sends the device identity and persists the post-MFA credential', async () => {
    respond = () => ({
      status: 200,
      body: { success: true, data: { ...SESSION, deviceCredential: { deviceId: 'dc-2', secret: SECRET, expiresAt: '', scopes: ['ai.relay'] } } }
    })
    const result = await broker.verifyTotp({ code: '123456', pendingTotpToken: 'pending' })
    assert.equal(result.success, true)
    assert.equal(calls[0].url, `${HUB}/api/v1/auth/totp/login`)
    assert.equal(calls[0].body.device.identityKind, 'electron-machine')
    assert.equal(JSON.stringify(result).includes(SECRET), false)
    assert.equal(values.HUB_DEVICE_ID, 'dc-2')
  })

  it('rejects a call without both fields before touching the network', async () => {
    const result = await broker.verifyTotp({ code: '', pendingTotpToken: 'pending' })
    assert.equal(result.code, 'invalidRequest')
    assert.equal(calls.length, 0)
  })
})

describe('secure storage unavailable', () => {
  it('never writes a plaintext device secret when the keychain is unusable', async () => {
    const writes = []
    const noKeychain = createHubLoginBroker({
      configFile: () => 'config.env',
      readConfigFile: () => ({ exists: true, values: { ...values } }),
      writeConfigValues: (_file, next) => { writes.push(next) },
      canPersistSecret: () => false,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { ...SESSION, deviceCredential: { deviceId: 'dc-x', secret: SECRET, expiresAt: '', scopes: [] } } })
      })
    })

    const result = await noKeychain.login({ email: 'a@b.c', password: 'pw' })
    assert.equal(result.success, true)
    assert.equal(result.credentialPersisted, false)
    assert.equal(JSON.stringify(result).includes(SECRET), false)
    assert.equal(writes.length, 0, 'nothing may reach the vault writer')
    assert.equal(process.env.HUB_DEVICE_SECRET, undefined)
  })
})

describe('notConfigured', () => {
  it('refuses to call Hub when the app id is missing', async () => {
    const unconfigured = createHubLoginBroker({
      configFile: () => 'config.env',
      readConfigFile: () => ({ exists: false, values: { NUXT_PUBLIC_HUB_URL: HUB } }),
      writeConfigValues: () => {},
      fetchImpl: async () => { throw new Error('should not be called') }
    })
    assert.equal((await unconfigured.login({ email: 'a@b.c', password: 'pw' })).code, 'notConfigured')
  })
})
