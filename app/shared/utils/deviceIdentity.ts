import type { HubDeviceInfo } from '#shared/types/device'

/**
 * Device identity for the browser (Web) runtime.
 *
 * A random UUID persisted per browser profile under a versioned key. No
 * fingerprinting: a cleared profile is simply a new device, which is the honest
 * answer. When storage is unavailable the id is ephemeral.
 *
 * Electron never calls this — Main derives a machine id there and the renderer
 * only receives metadata.
 */
const STORAGE_KEY = 'tm.device.identity.v1'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getBrowserDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing && UUID_RE.test(existing)) return existing
    const next = crypto.randomUUID()
    localStorage.setItem(STORAGE_KEY, next)
    return next
  } catch {
    return crypto.randomUUID()
  }
}

/** The nested `device` payload the Hub login expects from a Web client. */
export function browserDeviceInfo(): HubDeviceInfo {
  return {
    deviceId: getBrowserDeviceId(),
    identityKind: 'browser-profile',
    deviceType: 'web',
    platform: 'web',
    deviceName: typeof navigator !== 'undefined' ? navigator.platform.slice(0, 120) : undefined
  }
}
