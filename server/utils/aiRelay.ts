/**
 * The hub relay answers provider failures with a stable code in `message` and
 * the real upstream reason in `data.detail` (e.g. "HTTP 404 — Function not
 * found for account"). ofetch puts the whole error body under `err.data`, so
 * the detail sits one level deeper than the code. Forwarding only the code left
 * every consumer guessing which provider call actually failed.
 */
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
