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
import { credentialBelongsTo, normalizeOrigin } from '#shared/utils/deviceCredentialScope'

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
  deviceHubOrigin: string
}

/**
 * Why the stored credential is not being used. `null` when it is.
 * A caller needs this to tell "re-enroll this device on this Hub" apart from
 * "this Hub refused a credential it issued", which is a different fix.
 */
export type HubCredentialIssue
  = | 'hub-mismatch'
    | 'app-mismatch'
    | 'legacy-no-origin'
    | 'incomplete-pair'
    | null

export interface HubServiceResolution {
  identity: HubServiceIdentity | null
  issue: HubCredentialIssue
  /** Origin the credential was issued by, for the re-enroll copy. */
  storedOrigin: string
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
    deviceAppId: String(process.env.HUB_DEVICE_APP_ID || '').trim(),
    // ...and to the Hub that issued it. A credential never crosses Hubs.
    deviceHubOrigin: String(process.env.HUB_DEVICE_HUB_ORIGIN || '').trim()
  }
}

/**
 * The full resolution, including why a stored credential was refused. Sending a
 * credential issued by another Hub (a local database, then Production) can only
 * produce 401, and that answer would be misreported as an expired session.
 */
export function resolveHubServiceIdentityDetailed(): HubServiceResolution {
  const settings = readHubServiceSettings()
  const empty: HubServiceResolution = { identity: null, issue: null, storedOrigin: '' }
  if (!settings.hubUrl) return empty

  const deviceConfigured = Boolean(settings.deviceId || settings.deviceSecret)
  if (deviceConfigured) {
    // Half a credential is a broken state, not "no device": falling through to
    // the App Secret would silently downgrade a desktop out of its device
    // identity. Fail closed and say which half is missing.
    if (!settings.deviceId || !settings.deviceSecret) {
      return { identity: null, issue: 'incomplete-pair', storedOrigin: '' }
    }

    const storedAppId = settings.deviceAppId || settings.appId
    const targetAppId = settings.appId || settings.deviceAppId

    if (!credentialBelongsTo(
      { deviceId: settings.deviceId, secret: settings.deviceSecret, hubOrigin: settings.deviceHubOrigin, appId: settings.deviceAppId },
      { hubUrl: settings.hubUrl, appId: targetAppId }
    )) {
      const issue: HubCredentialIssue = !settings.deviceHubOrigin
        ? 'legacy-no-origin'
        : normalizeOrigin(settings.deviceHubOrigin) !== normalizeOrigin(settings.hubUrl)
          ? 'hub-mismatch'
          : 'app-mismatch'
      return { identity: null, issue, storedOrigin: settings.deviceHubOrigin }
    }

    if (!storedAppId) return { identity: null, issue: 'app-mismatch', storedOrigin: settings.deviceHubOrigin }
    return {
      identity: {
        kind: 'device',
        appId: storedAppId,
        headers: { 'X-Device-Id': settings.deviceId, 'X-Device-Secret': settings.deviceSecret }
      },
      issue: null,
      storedOrigin: settings.deviceHubOrigin
    }
  }

  if (!settings.appId || !settings.appSecret) return empty
  return {
    identity: {
      kind: 'app',
      appId: settings.appId,
      headers: { 'X-App-Id': settings.appId, 'X-App-Secret': settings.appSecret }
    },
    issue: null,
    storedOrigin: ''
  }
}

/** The identity to call Hub with, or `null` when this deployment has none. */
export function resolveHubServiceIdentity(): HubServiceIdentity | null {
  return resolveHubServiceIdentityDetailed().identity
}
