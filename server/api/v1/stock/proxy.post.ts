import { checkStockSearchUrl, sanitizeStockHeaders } from '../../../../shared/utils/stockGuards'

/**
 * Stock search proxy for the WEB runtime (kho tài nguyên).
 *
 * Desktop answers `tmcut:stockSearch` in the main process (the trust boundary
 * lives in `electron/tools/stock-proxy.cjs`). A browser has no IPC, and the
 * providers' search APIs do not all send CORS headers (Pexels answers a
 * preflight with no `Access-Control-Allow-Origin`), so the browser build was
 * left with "Failed to fetch" and no results at all.
 *
 * This endpoint is the web twin of that main-process proxy and enforces the
 * SAME rules, from the shared guard module — the browser is the untrusted
 * side of this boundary:
 *   - https only, no credentials in the URL;
 *   - hostname must be one of the stock search APIs;
 *   - only an `Authorization` header is forwarded (Pexels/Pixabay keys);
 *   - `redirect: 'error'` so a redirect cannot walk off the allowlist;
 *   - 15 s timeout, 2 MiB cap, JSON responses only.
 *
 * Contract: POST /api/v1/stock/proxy
 *   body = { url, headers?: { Authorization?: string } }
 *   ←    = { ok: true, status, data } | throws (400/502)
 */
const MAX_STOCK_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<Record<string, unknown>>(event) || {}
  const checked = checkStockSearchUrl(body.url)
  if (!checked.ok || !checked.url) {
    throw createError({ statusCode: 400, statusMessage: 'error.stockUrl', message: checked.reason || 'Invalid stock URL' })
  }

  let response: Response
  try {
    response = await fetch(checked.url, {
      method: 'GET',
      headers: sanitizeStockHeaders(body.headers),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const message = (error as Error)?.name === 'TimeoutError'
      ? 'Stock request timed out'
      : `Stock provider unreachable: ${(error as Error)?.message || error}`
    throw createError({ statusCode: 502, statusMessage: 'error.stockUnreachable', message })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw createError({
      statusCode: 502,
      statusMessage: 'error.stockUpstream',
      message: `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`
    })
  }

  const declared = Number(response.headers.get('content-length')) || 0
  if (declared > MAX_STOCK_BYTES) {
    throw createError({ statusCode: 502, statusMessage: 'error.stockUpstream', message: 'Stock response too large' })
  }
  const text = await response.text()
  if (text.length > MAX_STOCK_BYTES) {
    throw createError({ statusCode: 502, statusMessage: 'error.stockUpstream', message: 'Stock response too large' })
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'error.stockUpstream', message: 'Stock provider returned invalid JSON' })
  }

  return { ok: true, status: response.status, data }
})
