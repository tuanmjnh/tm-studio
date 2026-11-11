/**
 * The hub relay answers provider failures with a stable code in `message` and
 * the real upstream reason in `data.detail` (e.g. "HTTP 404 — Function not
 * found for account"). ofetch puts the whole error body under `err.data`, so
 * the detail sits one level deeper than the code. Forwarding only the code left
 * every consumer guessing which provider call actually failed.
 */
import type { HubServiceIdentity } from './hubIdentity'
import { resolveHubServiceIdentityDetailed } from './hubIdentity'

interface RelayErrorBody {
  message?: string
  statusMessage?: string
  data?: { detail?: string } | null
}

export function relayUpstreamError(
  err: unknown,
  fallback: string,
  defaultStatusMessage = 'error.ai_relay'
): { statusCode: number, statusMessage: string, message: string, data: { detail: string } } {
  const body = (err as { data?: RelayErrorBody })?.data ?? {}
  const upstream = (err as { statusCode?: number })?.statusCode
  const detail = String(body.data?.detail ?? '').trim()
  const code = String(body.message ?? '').trim()

  return {
    statusCode: typeof upstream === 'number' && upstream >= 400 ? upstream : 502,
    statusMessage: body.statusMessage || code || defaultStatusMessage,
    message: code || fallback,
    data: { detail: detail || code || fallback }
  }
}

/**
 * Resolve the identity a relay call needs, or throw the reason it cannot.
 *
 * A credential issued by a different Hub is a different fix from "nothing is
 * enrolled": the user has to re-enroll against this Hub, and clearing the old
 * row by hand is never the answer. Reporting both as `aiRelayNotConfigured`
 * sends people looking for a setting that already exists.
 */
export function requireHubServiceIdentity(hubUrl: string): HubServiceIdentity {
  const { identity, issue } = resolveHubServiceIdentityDetailed()
  if (identity && hubUrl) return identity

  if (identity) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.aiRelayNotConfigured',
      message: 'TM Hub URL is not configured on this server'
    })
  }
  if (issue) {
    throw createError({
      statusCode: 409,
      statusMessage: 'error.deviceCredentialWrongHub',
      message: issue
    })
  }
  throw createError({
    statusCode: 503,
    statusMessage: 'error.aiRelayNotConfigured',
    message: 'AI relay is not configured on this server (no device credential or App Secret)'
  })
}
