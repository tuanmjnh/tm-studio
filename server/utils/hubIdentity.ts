/**
 * Which identity this server presents to TM Hub for service calls (AI Relay).
 *
 * A per-device credential wins over the App Secret: it is scoped to one app and
 * one user, expiring and revocable, and it is the only identity a packaged
 * desktop build can hold. App Secret stays supported for hosted deployments
 * that enroll nothing.
 *
 * Values are read from the live process environment per call — the desktop app
 * decrypts `config.env` into `process.env` before Nitro starts — so a credential
 * written by a later sign-in applies without a restart, and nothing is baked
 * into the shipped server bundle.
 *
 * Present + invalid never falls back: `null` means "no identity", which callers
 * must surface as not-configured rather than silently downgrading to App Secret.
 */
export interface HubServiceIdentity {
  kind: 'device' | 'app'
  appId: string
  headers: Record<string, string>
}

export interface HubServiceSettings {
  hubUrl: string
  appId: string
  appSecret: string
  deviceId: string
  deviceSecret: string
  deviceAppId: string
}

export function readHubServiceSettings(): HubServiceSettings {
  return {
    hubUrl: String(process.env.NUXT_PUBLIC_HUB_URL || '').trim().replace(/\/+$/, ''),
    appId: String(process.env.NUXT_PUBLIC_HUB_APP_ID || '').trim(),
    appSecret: String(process.env.NUXT_HUB_APP_SECRET || '').trim(),
    deviceId: String(process.env.HUB_DEVICE_ID || '').trim(),
    deviceSecret: String(process.env.HUB_DEVICE_SECRET || '').trim(),
    // The credential is bound to the app that issued it; a later App ID edit
    // must not silently point it at a different satellite.
    deviceAppId: String(process.env.HUB_DEVICE_APP_ID || '').trim()
  }
}

/**
 * The service identity to call Hub with, or `null` when this deployment has
 * none configured. A device credential is all-or-nothing: if one half is
 * present the pair is treated as configured-but-broken, never as "use App
 * Secret instead".
 */
export function resolveHubServiceIdentity(): HubServiceIdentity | null {
  const settings = readHubServiceSettings()
  if (!settings.hubUrl) return null

  const deviceConfigured = Boolean(settings.deviceId || settings.deviceSecret)
  if (deviceConfigured) {
    if (!settings.deviceId || !settings.deviceSecret) return null
    const appId = settings.deviceAppId || settings.appId
    if (!appId) return null
    return {
      kind: 'device',
      appId,
      headers: { 'X-Device-Id': settings.deviceId, 'X-Device-Secret': settings.deviceSecret }
    }
  }

  if (!settings.appId || !settings.appSecret) return null
  return {
    kind: 'app',
    appId: settings.appId,
    headers: { 'X-App-Id': settings.appId, 'X-App-Secret': settings.appSecret }
  }
}
