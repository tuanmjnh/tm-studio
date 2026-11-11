/**
 * Device credentials belong to one Hub, not to the app in general.
 *
 * A credential is a row in the issuing Hub's database. Pointing the app at a
 * different Hub (a local Supabase project, then Production) leaves a credential
 * behind that the new Hub has never seen, and sending it produces 401 on every
 * call — which the UI then reports as an expired session. The credential is not
 * corrupt; it is simply not this Hub's.
 *
 * Contract:
 *   - a stored credential is only offered to the origin and app id it was
 *     issued for (`credentialBelongsTo`),
 *   - a mismatched credential is reported as such instead of sent,
 *   - clearing is allowed ONLY on a definitive rejection by the matching Hub
 *     (`error.deviceUnauthorized` / `error.deviceExpired`), never on a network
 *     error, a 5xx, or a scope/permission refusal.
 */

export interface DeviceCredentialRef {
  deviceId?: string
  secret?: string
  /** Hub base URL the credential was issued by. Absent on pre-scoping rows. */
  hubOrigin?: string
  /** App id the credential was issued for. */
  appId?: string
}

export interface HubCredentialTarget {
  hubUrl?: string
  appId?: string
}

/** Hub origins compare without a trailing slash, case-insensitively. */
export function normalizeOrigin(value: string | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Does the stored credential belong to the Hub this build points at? Both
 * halves must match: right origin but another app id is a different satellite
 * and would be rejected the same way.
 */
export function credentialBelongsTo(credential: DeviceCredentialRef | null | undefined, target: HubCredentialTarget | null | undefined): boolean {
  const id = String(credential?.deviceId || '').trim()
  const secret = String(credential?.secret || '').trim()
  if (!id || !secret) return false

  const origin = normalizeOrigin(target?.hubUrl)
  const appId = String(target?.appId || '').trim()
  if (!origin || !appId) return false

  const storedOrigin = normalizeOrigin(credential?.hubOrigin)
  const storedAppId = String(credential?.appId || '').trim()

  // A legacy credential carries no origin, so it cannot be proven to belong to
  // the current Hub. It is not sent: the row may live in a database this build
  // no longer talks to.
  if (!storedOrigin) return false
  return storedOrigin === origin && storedAppId === appId
}

/**
 * Which Hub rejection proves a credential is unusable there. Anything else —
 * timeouts, 5xx, 403 scope refusals — leaves the credential alone: those are
 * conditions of the request, not of the credential.
 */
const TERMINAL_DEVICE_ERRORS = new Set([
  'error.deviceUnauthorized',
  'error.deviceExpired',
  'deviceUnauthorized',
  'deviceExpired'
])

export function isTerminalDeviceRejection(statusCode: unknown, statusMessage: unknown): boolean {
  if (Number(statusCode) !== 401) return false
  return TERMINAL_DEVICE_ERRORS.has(String(statusMessage || '').trim())
}

export { TERMINAL_DEVICE_ERRORS }
