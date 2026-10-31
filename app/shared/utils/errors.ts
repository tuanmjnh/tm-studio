/**
 * Error convention for this project:
 * - Backend `createError` sends `statusMessage` = i18n key (e.g. `error.invalidCredentials`)
 *   and `message` = human-readable error text (for logs / fallback).
 * - Frontend resolves the display string via `getErrorMessage(err, t)`:
 *   1. Connection errors to TM-Hub or Network failure mapped to i18n keys;
 *   2. `statusMessage` used as an i18n key (translated if it exists);
 *   3. Known backend messages mapped to i18n keys;
 *   4. otherwise a status-code-based default key.
 */
export type ApiErrorPayload = {
  name?: string
  statusCode?: number
  statusMessage?: string
  data?: { message?: string, statusMessage?: string, statusCode?: number }
  message?: string
}

export function getApiErrorStatus(err: unknown): number | undefined {
  const e = err as ApiErrorPayload
  return e?.statusCode ?? e?.data?.statusCode
}

export function isHubConnectionError(err: unknown): boolean {
  const e = err as ApiErrorPayload
  const status = getApiErrorStatus(err)
  const rawMsg = String(e?.message || e?.data?.message || '')
  if (!status) {
    const isNetwork = /fetch failed|failed to fetch|<no response>|network|econn|timeout|load failed|socket/i.test(rawMsg)
    if (isNetwork && /4000|\/api\/v1\/|hub/i.test(rawMsg)) {
      return true
    }
  }
  return false
}

export function getErrorKey(err: unknown): string {
  const e = err as ApiErrorPayload
  const status = getApiErrorStatus(err)

  if (!status) {
    const msg = String(e?.message || e?.data?.message || '').toLowerCase()
    const isNetwork = /fetch failed|failed to fetch|<no response>|network|econn|timeout|load failed|socket/i.test(msg)
    if (isNetwork) {
      if (/4000|\/api\/v1\/|hub/i.test(msg)) {
        return 'error.hubConnectionFailed'
      }
      return 'error.network'
    }
    return 'error.unexpected'
  }

  const raw = String(e?.statusMessage || e?.data?.statusMessage || e?.data?.message || e?.message || '')
  if (/invalid.*app/i.test(raw)) return 'error.invalidAppId'
  if (/not have access|no access/i.test(raw)) return 'error.noAppAccess'

  switch (status) {
    case 400: return 'error.invalidRequest'
    case 401: return 'error.invalidCredentials'
    case 403: return 'error.forbidden'
    case 404: return 'error.notFound'
    case 409: return 'error.conflict'
    case 422: return 'error.validation'
    case 429: return 'error.tooManyAttempts'
    default: return status >= 500 ? 'error.serverError' : 'error.unexpected'
  }
}

export function getErrorMessage(err: unknown, t: (key: string) => string): string {
  const e = err as ApiErrorPayload
  const status = getApiErrorStatus(err)
  const rawMsg = String(e?.message || e?.data?.message || '')

  // 1. Connection error to TM-Hub or network failure (Failed to fetch, <no response>...)
  if (!status) {
    const isNetwork = /fetch failed|failed to fetch|<no response>|network|econn|timeout|load failed|socket/i.test(rawMsg)
    if (isNetwork) {
      if (/4000|\/api\/v1\/|hub/i.test(rawMsg)) {
        return t('error.hubConnectionFailed')
      }
      return t('error.network')
    }
  }

  // 2. Check if statusMessage is an i18n key (e.g. error.invalidCredentials)
  const code = e?.statusMessage || e?.data?.statusMessage
  if (code && /^[a-zA-Z0-9_.-]+$/.test(code)) {
    const translated = t(code)
    if (translated && translated !== code) return translated
  }

  // 3. Map backend / TM-Hub returned messages to i18n key
  const text = e?.data?.message || e?.message
  if (text) {
    if (/^[a-zA-Z0-9_.-]+$/.test(text)) {
      const translated = t(text)
      if (translated && translated !== text) return translated
    }

    if (/invalid email or password/i.test(text)) return t('error.invalidCredentials')
    if (/invalid or inactive app/i.test(text)) return t('error.invalidAppId')
    if (/does not have access to this application/i.test(text)) return t('error.noAppAccess')

    // Skip displaying raw HTTP debug URL if it is a fetch error string
    if (!/\[(GET|POST|PUT|DELETE|PATCH)\]/i.test(text)) {
      return text
    }
  }

  // 4. Fallback status-code-based key
  return t(getErrorKey(err))
}
