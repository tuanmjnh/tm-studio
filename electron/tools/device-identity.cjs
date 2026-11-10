'use strict'
// Device identity (v2) — derive the Hub `deviceId` the way the ADR requires.
//
// Electron: only ever run this in the Main process. `node-machine-id` returns a
// hashed machine identifier; we hash it again with the appId so one computer
// gets a distinct identity per TM app. The raw machine id is never logged,
// persisted or sent anywhere.
//
// Web: a random UUID per browser profile (origin). No fingerprinting.
//
// Pure module: no electron import at module scope, so it is unit-testable.

const crypto = require('node:crypto')

/** Machine-id lookup never throws fatally: a broken lookup falls back to a UUID. */
function safeMachineId() {
  try {
    // Default (no `true`): the library returns an already-hashed value. Passing
    // `true` would return the RAW machine identifier — never do that.

    const mod = require('node-machine-id')
    const fn = mod.machineIdSync || mod.default?.machineIdSync
    if (typeof fn === 'function') {
      const value = fn()
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  } catch {
    // Unsupported platform / no access / missing native module.
  }
  return ''
}

/**
 * Derive a stable, app-scoped device id for an Electron install.
 * Returns `{ deviceId, identityKind }`. When the machine id cannot be read we
 * fall back to a persisted installation UUID and mark it as such, so support
 * can tell the two apart — we never fall back to hostname/IP/username.
 *
 * @param {string} appId
 * @param {(key: string) => string | null} [readFallback]
 *   Reads a persisted fallback UUID (OS user-data dir); the caller owns storage.
 * @param {(uuid: string) => void} [writeFallback]
 *   Persists a new fallback UUID. Must never write plaintext secrets — this is
 *   only a random public identifier, not a credential.
 */
function deriveElectronDeviceId(appId, readFallback, writeFallback) {
  const machine = safeMachineId()
  if (machine) {
    const deviceId = crypto
      .createHash('sha256')
      .update(`tm-device:v1:${appId}:${machine}`)
      .digest('hex')
    return { deviceId, identityKind: 'electron-machine' }
  }

  if (typeof readFallback === 'function') {
    const existing = readFallback()
    if (typeof existing === 'string' && existing.trim()) {
      return { deviceId: existing.trim(), identityKind: 'electron-installation' }
    }
  }
  const generated = crypto.randomUUID()
  if (typeof writeFallback === 'function') {
    try {
      writeFallback(generated)
    } catch {
      // Persisting the fallback failed; the id is still usable for this run.
    }
  }
  return { deviceId: generated, identityKind: 'electron-installation' }
}

/**
 * Browser device id: a random UUID persisted under a versioned key. No hardware
 * fingerprint. When storage is unavailable the id is ephemeral for this session.
 */
function getBrowserDeviceId(storage, storageKey) {
  const key = storageKey || 'tm.device.identity.v1'
  try {
    const current = storage?.getItem?.(key)
    if (current && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(current)) {
      return current
    }
    const next = crypto.randomUUID()
    storage?.setItem?.(key, next)
    return next
  } catch {
    return crypto.randomUUID()
  }
}

/** Build the nested `device` object the Hub login accepts (v2 contract). */
function buildDeviceInfo(input) {
  const identityKind = input.identityKind || 'browser-profile'
  return {
    deviceId: String(input.deviceId || '').trim().slice(0, 200),
    identityKind,
    deviceType: input.deviceType || 'other',
    platform: input.platform || 'web',
    ...(input.deviceName ? { deviceName: String(input.deviceName).slice(0, 120) } : {}),
    ...(input.osPlatform ? { osPlatform: String(input.osPlatform).slice(0, 64) } : {}),
    ...(input.arch ? { arch: String(input.arch).slice(0, 64) } : {}),
    ...(input.appVersion ? { appVersion: String(input.appVersion).slice(0, 40) } : {})
  }
}

module.exports = {
  deriveElectronDeviceId,
  getBrowserDeviceId,
  buildDeviceInfo,
  safeMachineId
}
