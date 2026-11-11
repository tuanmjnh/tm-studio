'use strict'
// Hub auth broker (v2) — the Electron Main trust boundary for device login.
//
// The renderer never holds the machine id or the device service credential.
// Main derives an app-scoped deviceId, sends it with every full-session auth
// call and `requestDeviceCredential`, persists the returned credential in the
// OS vault, and returns ONLY sanitized session data to the renderer (the
// credential is stripped before the IPC result is built).
//
// A TOTP password step is not a session: no credential exists yet, so the
// challenge passes through untouched and a credential can only arrive after
// `/auth/totp/login` succeeds.
//
// Pure module: fetch and storage are injected, so every branch is unit-testable
// without Electron.

const { deriveElectronDeviceId, buildDeviceInfo } = require('./device-identity.cjs')

const LOGIN_PATH = '/api/v1/auth/login'
const TOTP_LOGIN_PATH = '/api/v1/auth/totp/login'
const PASSKEY_START_PATH = '/api/v1/auth/passkey/login/start'
const PASSKEY_FINISH_PATH = '/api/v1/auth/passkey/login/finish'
const REGISTER_PATH = '/api/v1/auth/register'
const REQUEST_TIMEOUT_MS = 20_000

/**
 * Config slots written when the broker receives a device credential.
 * `HUB_DEVICE_USER_ID` / `HUB_DEVICE_APP_ID` come from the session, not the
 * credential: storage namespacing and the app binding both read them.
 * `HUB_DEVICE_HUB_ORIGIN` records which Hub issued the secret, so a credential
 * can never be replayed against a different Hub.
 */
const DEVICE_CREDENTIAL_KEYS = [
  'HUB_DEVICE_ID',
  'HUB_DEVICE_SECRET',
  'HUB_DEVICE_USER_ID',
  'HUB_DEVICE_APP_ID',
  'HUB_DEVICE_HUB_ORIGIN',
  'HUB_DEVICE_EXPIRES_AT',
  'HUB_DEVICE_SCOPES'
]

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '')
}

function defaultAppVersion() {
  try {
    // package.json is bundled next to Main in the packaged app.
    return String(require('../../package.json').version || '').slice(0, 40)
  } catch {
    return ''
  }
}

// The device type the Hub sees: a desktop build is a desktop device.
const DEVICE_TYPE = 'desktop'
const DEVICE_PLATFORM = 'desktop'

function createHubLoginBroker(options) {
  const {
    configFile,
    readConfigFile,
    writeConfigValues,
    fetchImpl = (...args) => globalThis.fetch(...args),
    platform = process.platform,
    arch = process.arch,
    version = defaultAppVersion,
    // The OS keychain must be usable before a device secret is written: a
    // plaintext credential on disk is worse than having none (the session still
    // works; the caller re-enrolls later).
    canPersistSecret = () => true
  } = options

  function readValues() {
    return readConfigFile(configFile()).values
  }

  function resolve(appIdOverride) {
    const values = readValues()
    const hubUrl = normalizeBaseUrl(values.NUXT_PUBLIC_HUB_URL || process.env.NUXT_PUBLIC_HUB_URL || 'http://localhost:4000')
    const appId = String(appIdOverride || values.NUXT_PUBLIC_HUB_APP_ID || process.env.NUXT_PUBLIC_HUB_APP_ID || '').trim()
    return { values, hubUrl, appId }
  }

  /**
   * Device identity for the renderer UI: metadata only (no machine id, no
   * secret). Derived fresh from Main each call.
   */
  function deviceInfo(appIdOverride) {
    const { values, appId } = resolve(appIdOverride)
    if (!appId) return null
    const { deviceId, identityKind } = deriveElectronDeviceId(appId, () => values.HUB_DEVICE_FALLBACK_ID || null, (id) => {
      try {
        writeConfigValues(configFile(), { ...readValues(), HUB_DEVICE_FALLBACK_ID: id })
      } catch {
        // Non-fatal: the derived id is still usable for this run.
      }
    })
    return buildDeviceInfo({
      deviceId,
      identityKind,
      deviceType: DEVICE_TYPE,
      platform: DEVICE_PLATFORM,
      deviceName: `TMCut Studio · ${platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux'}`,
      osPlatform: platform,
      arch,
      appVersion: typeof version === 'function' ? version() : String(version || '')
    })
  }

  function persistCredential(credential, session, hubUrl) {
    if (!canPersistSecret()) throw new Error('secure storage unavailable')
    const values = readValues()
    const next = {
      ...values,
      HUB_DEVICE_ID: String(credential.deviceId || ''),
      HUB_DEVICE_SECRET: String(credential.secret || ''),
      HUB_DEVICE_USER_ID: String(session?.user?.id || values.HUB_DEVICE_USER_ID || ''),
      HUB_DEVICE_APP_ID: String(session?.user?.appId || values.HUB_DEVICE_APP_ID || ''),
      HUB_DEVICE_HUB_ORIGIN: normalizeBaseUrl(hubUrl),
      HUB_DEVICE_EXPIRES_AT: String(credential.expiresAt || ''),
      HUB_DEVICE_SCOPES: Array.isArray(credential.scopes) ? credential.scopes.join(',') : ''
    }
    writeConfigValues(configFile(), next)
    // `config.hub` reads process.env per call, so the running Nitro server picks
    // the new credential up without a restart.
    for (const key of DEVICE_CREDENTIAL_KEYS) process.env[key] = String(next[key] || '')
  }

  async function postJson(url, body) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      const payload = await response.json().catch(() => null)
      return { response, payload }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Move an issued credential into the vault and strip it from the payload the
   * renderer will see. A credential that cannot be persisted is dropped rather
   * than leaked: the session still works, the caller re-enrolls later.
   */
  function consume(payload, hubUrl) {
    const data = { ...payload.data }
    if (!data.deviceCredential) return { data }

    const credential = data.deviceCredential
    delete data.deviceCredential
    try {
      persistCredential(credential, data, hubUrl)
      return { data, credentialPersisted: true }
    } catch {
      return { data, credentialPersisted: false }
    }
  }

  function failure(response, payload) {
    if (response.status >= 500 && !payload) return { success: false, code: 'unreachable' }
    return {
      success: false,
      code: 'rejected',
      status: response.status,
      statusMessage: payload?.statusMessage || '',
      message: payload?.message || ''
    }
  }

  const isOk = (response, payload) => response.ok && payload?.success && payload?.data

  /**
   * Password login. Sends the nested device object and asks for a service
   * credential. Returns the session (credential stripped) or a TOTP challenge,
   * which never carries a credential.
   */
  async function login(credentials, appIdOverride) {
    const { hubUrl, appId } = resolve(appIdOverride)
    if (!hubUrl || !appId) return { success: false, code: 'notConfigured' }

    const device = deviceInfo(appId)
    let transport
    try {
      transport = await postJson(`${hubUrl}${LOGIN_PATH}`, {
        ...credentials,
        appId,
        device,
        // Legacy copies drive same-device session dedupe and the session row;
        // the nested object stays the registry source of truth.
        deviceId: device?.deviceId,
        platform: DEVICE_PLATFORM,
        requestDeviceCredential: true
      })
    } catch {
      return { success: false, code: 'unreachable' }
    }

    const { response, payload } = transport
    if (!isOk(response, payload)) return failure(response, payload)
    return { success: true, ...consume(payload, hubUrl) }
  }

  /** Second factor. Re-sends the device identity so the credential is issued post-MFA. */
  async function verifyTotp(input, appIdOverride) {
    const { hubUrl, appId } = resolve(appIdOverride)
    if (!hubUrl || !appId) return { success: false, code: 'notConfigured' }
    if (!input?.code || !input?.pendingTotpToken) return { success: false, code: 'invalidRequest' }

    const device = deviceInfo(appId)
    let transport
    try {
      transport = await postJson(`${hubUrl}${TOTP_LOGIN_PATH}`, {
        code: String(input.code),
        pendingTotpToken: String(input.pendingTotpToken),
        appId,
        device,
        deviceId: device?.deviceId,
        requestDeviceCredential: true
      })
    } catch {
      return { success: false, code: 'unreachable' }
    }

    const { response, payload } = transport
    if (!isOk(response, payload)) return failure(response, payload)
    return { success: true, ...consume(payload, hubUrl) }
  }

  /** WebAuthn login start: no session, so no credential and no device metadata. */
  async function passkeyStart(appIdOverride) {
    const { hubUrl, appId } = resolve(appIdOverride)
    if (!hubUrl || !appId) return { success: false, code: 'notConfigured' }

    let transport
    try {
      transport = await postJson(`${hubUrl}${PASSKEY_START_PATH}`, { appId })
    } catch {
      return { success: false, code: 'unreachable' }
    }
    const { response, payload } = transport
    if (!isOk(response, payload)) return failure(response, payload)
    return { success: true, data: payload.data }
  }

  /** WebAuthn login finish: a real session, so the same credential hook applies. */
  async function passkeyFinish(credential, appIdOverride) {
    const { hubUrl, appId } = resolve(appIdOverride)
    if (!hubUrl || !appId) return { success: false, code: 'notConfigured' }
    if (!credential) return { success: false, code: 'invalidRequest' }

    let transport
    try {
      transport = await postJson(`${hubUrl}${PASSKEY_FINISH_PATH}`, {
        credential,
        appId,
        device: deviceInfo(appId),
        requestDeviceCredential: true
      })
    } catch {
      return { success: false, code: 'unreachable' }
    }
    const { response, payload } = transport
    if (!isOk(response, payload)) return failure(response, payload)
    return { success: true, ...consume(payload, hubUrl) }
  }

  /** Account creation. Same session shape as login, so same vault handling. */
  async function register(input, appIdOverride) {
    const { hubUrl, appId } = resolve(appIdOverride)
    if (!hubUrl || !appId) return { success: false, code: 'notConfigured' }

    let transport
    try {
      transport = await postJson(`${hubUrl}${REGISTER_PATH}`, {
        ...input,
        appId,
        device: deviceInfo(appId),
        requestDeviceCredential: true
      })
    } catch {
      return { success: false, code: 'unreachable' }
    }
    const { response, payload } = transport
    if (!isOk(response, payload)) return failure(response, payload)
    return { success: true, ...consume(payload, hubUrl) }
  }

  /**
   * Which Hub this device is enrolled on, from the local vault. No network: the
   * (hubOrigin, appId) pair is what decides whether the credential may be sent.
   */
  function credentialStatus(appIdOverride) {
    const { hubUrl, appId, values } = resolve(appIdOverride)
    const deviceId = String(values.HUB_DEVICE_ID || '').trim()
    const secret = String(values.HUB_DEVICE_SECRET || '').trim()
    if (!deviceId || !secret) {
      return { enrolled: false, deviceId: '', userId: '', hubUrl, appId, hubOrigin: '', expiresAt: '', scopes: [] }
    }
    return {
      enrolled: true,
      deviceId,
      userId: String(values.HUB_DEVICE_USER_ID || ''),
      hubUrl,
      appId: String(values.HUB_DEVICE_APP_ID || appId || ''),
      hubOrigin: normalizeBaseUrl(values.HUB_DEVICE_HUB_ORIGIN || ''),
      expiresAt: String(values.HUB_DEVICE_EXPIRES_AT || ''),
      scopes: String(values.HUB_DEVICE_SCOPES || '').split(',').map(s => s.trim()).filter(Boolean)
    }
  }

  /**
   * Forget the credential on THIS machine only. Anyone signed in on this device
   * may do it: it removes a local copy and stops the app presenting it. The Hub
   * record is untouched — revoking it is a root action on the Hub, which this
   * process cannot and must not perform on the caller's behalf.
   */
  function forgetCredential() {
    const values = readValues()
    const next = { ...values }
    for (const key of DEVICE_CREDENTIAL_KEYS) next[key] = ''
    writeConfigValues(configFile(), next)
    for (const key of DEVICE_CREDENTIAL_KEYS) process.env[key] = ''
    return { success: true, enrolled: false }
  }

  return {
    login,
    verifyTotp,
    passkeyStart,
    passkeyFinish,
    register,
    deviceInfo,
    credentialStatus,
    forgetCredential
  }
}

module.exports = { createHubLoginBroker, DEVICE_CREDENTIAL_KEYS }
