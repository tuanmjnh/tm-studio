'use strict'

// =============================================================================
//  Stock media proxy (main process) — the desktop half of the stock library.
//
//  The renderer builds the provider request (app/utils/tmcut/stockProviders.ts)
//  and hands over `{ url, headers }`. This module is the trust boundary:
//    - only https, only the three stock hosts;
//    - only an `Authorization` header survives (Pexels/Pixabay keys), never
//      cookies, referers or arbitrary headers;
//    - bounded body size + 15 s timeout;
//    - JSON only, so the renderer receives data rather than a file body.
//
//  Pure (fetch injected) so a plain Node spec can exercise every branch.
// =============================================================================

const STOCK_HOSTS = new Set([
  'api.openverse.org',
  'api.pexels.com',
  'pixabay.com'
])

const MAX_STOCK_BYTES = 2 * 1024 * 1024
const TIMEOUT_MS = 15_000

function assertStockUrl(value) {
  let url
  try {
    url = new URL(String(value || ''))
  } catch {
    return { ok: false, reason: 'Invalid stock URL' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Stock requests must use https' }
  if (url.username || url.password) return { ok: false, reason: 'Stock URLs must not carry credentials' }
  if (!STOCK_HOSTS.has(url.hostname.toLowerCase())) {
    return { ok: false, reason: `Stock host not allowed: ${url.hostname}` }
  }
  return { ok: true, url: url.toString() }
}

function sanitizeStockHeaders(headers) {
  const out = {}
  if (!headers || typeof headers !== 'object') return out
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() !== 'authorization') continue
    const clean = String(value || '').trim()
    if (!clean || clean.length > 512 || /[\r\n]/.test(clean)) continue
    out.Authorization = clean
  }
  return out
}

async function fetchStockJson({ url, headers, fetchImpl = fetch, maxBytes = MAX_STOCK_BYTES } = {}) {
  const checked = assertStockUrl(url)
  if (!checked.ok) return { ok: false, error: checked.reason }

  let response
  try {
    response = await fetchImpl(checked.url, {
      method: 'GET',
      headers: sanitizeStockHeaders(headers),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const message = String((error && error.message) || error)
    return { ok: false, error: message === 'This operation was aborted' ? 'Stock request timed out' : message }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    return {
      ok: false,
      status: response.status,
      error: `HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`
    }
  }

  const declared = Number(response.headers.get('content-length')) || 0
  if (declared > maxBytes) return { ok: false, error: 'Stock response too large' }

  const text = await response.text()
  if (text.length > maxBytes) return { ok: false, error: 'Stock response too large' }
  try {
    return { ok: true, status: response.status, data: JSON.parse(text) }
  } catch {
    return { ok: false, error: 'Stock provider returned invalid JSON' }
  }
}

module.exports = {
  STOCK_HOSTS,
  MAX_STOCK_BYTES,
  TIMEOUT_MS,
  assertStockUrl,
  sanitizeStockHeaders,
  fetchStockJson
}
