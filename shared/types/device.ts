/**
 * Client-side mirror of the Hub device identity contract (v2).
 *
 * Metadata only — the device credential lives in Main's vault and never
 * appears in any of these fields.
 */
export type HubDeviceIdentityKind = 'electron-machine' | 'electron-installation' | 'browser-profile'

export type HubDeviceType = 'web' | 'mobile' | 'tablet' | 'desktop' | 'tv' | 'wearable' | 'cli' | 'other'

export type HubDevicePlatform = 'web' | 'desktop' | 'mobile'

export interface HubDeviceInfo {
  deviceId: string
  identityKind: HubDeviceIdentityKind
  deviceType: HubDeviceType
  platform: HubDevicePlatform
  deviceName?: string
  osPlatform?: string
  arch?: string
  appVersion?: string
}

export type HubDeviceStatus = 'active' | 'pending' | 'blocked' | 'revoked'

/** One row of the user's device registry (`/api/v1/auth/user-devices`). */
export interface HubDeviceView {
  id: string
  deviceId: string
  identityKind: HubDeviceIdentityKind
  deviceType: HubDeviceType
  platform: string
  deviceName: string | null
  osPlatform: string | null
  arch: string | null
  appVersion: string | null
  status: HubDeviceStatus
  firstSeenAt: string
  lastSeenAt: string
  lastIp: string | null
  isCurrent?: boolean
}
