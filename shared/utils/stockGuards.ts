/**
 * Stock library guards — the rules the WEB proxy (Nitro) enforces.
 *
 * `electron/tools/stock-proxy.cjs` is the desktop twin (main process). Both
 * sides validate independently because the renderer/browser is the untrusted
 * side of each boundary; `tests/unit/tmcut_stock.spec.ts` asserts the two
 * search allowlists stay identical.
 *
 * Plain functions with no framework imports, so the node spec runner can
 * exercise every branch without a Nitro context.
 */

/** Search APIs the stock panel is allowed to call. */
export const STOCK_SEARCH_HOSTS: readonly string[] = [
  'api.openverse.org',
  'api.pexels.com',
  'pixabay.com'
]

/**
 * Provider CDNs a downloaded asset may come from. Matched on a domain
 * boundary (`host === suffix || host.endsWith('.' + suffix)`), so
 * `evilpexels.com` can never pass as `pexels.com`.
 */
export const STOCK_DOWNLOAD_SUFFIXES: readonly string[] = [
  'openverse.org',
  'pexels.com',
  'pixabay.com',
  // Pexels hands out Vimeo-hosted renditions.
  'vimeo.com',
  // Openverse images/audio live on these repositories.
  'staticflickr.com',
  'wikimedia.org',
  'wikipedia.org',
  'archive.org',
  'freesound.org',
  'jamendo.com'
]

export interface UrlCheck {
  ok: boolean
  url?: string
  reason?: string
}

function parseHttpsUrl(value: unknown): { url?: URL, reason?: string } {
  let url: URL
  try {
    url = new URL(String(value ?? ''))
  } catch {
    return { reason: 'Invalid stock URL' }
  }
  if (url.protocol !== 'https:') return { reason: 'Stock requests must use https' }
  if (url.username || url.password) return { reason: 'Stock URLs must not carry credentials' }
  return { url }
}

/** Is this one of the provider search APIs? */
export function checkStockSearchUrl(value: unknown): UrlCheck {
  const parsed = parseHttpsUrl(value)
  if (!parsed.url) return { ok: false, reason: parsed.reason }
  if (!STOCK_SEARCH_HOSTS.includes(parsed.url.hostname.toLowerCase())) {
    return { ok: false, reason: `Stock host not allowed: ${parsed.url.hostname}` }
  }
  return { ok: true, url: parsed.url.toString() }
}

/** Is this hostname a provider CDN (or a subdomain of one)? */
export function isStockDownloadHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase()
  // An IP literal (v4 or bracketed v6) can never match a provider CDN and is
  // exactly what an SSRF attempt would use: refuse it outright.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return false
  if (!host.includes('.')) return false
  return STOCK_DOWNLOAD_SUFFIXES.some(suffix => host === suffix || host.endsWith(`.${suffix}`))
}

/** Is this a media URL the download proxy may fetch? */
export function checkStockDownloadUrl(value: unknown): UrlCheck {
  const parsed = parseHttpsUrl(value)
  if (!parsed.url) return { ok: false, reason: parsed.reason }
  if (!isStockDownloadHost(parsed.url.hostname)) {
    return { ok: false, reason: `Stock host not allowed: ${parsed.url.hostname}` }
  }
  return { ok: true, url: parsed.url.toString() }
}

/**
 * Only an `Authorization` header survives (Pexels/Pixabay keys). Cookies,
 * Referer, X-Forwarded-* and anything else the browser might add are dropped.
 */
export function sanitizeStockHeaders(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!headers || typeof headers !== 'object') return out
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== 'authorization') continue
    const clean = String(value ?? '').trim()
    if (!clean || clean.length > 512 || /[\r\n]/.test(clean)) continue
    out.Authorization = clean
  }
  return out
}

/** A media response, not an HTML error page behind a 200. */
export function isStockMediaContentType(contentType: string): boolean {
  const type = String(contentType || '').split(';')[0]!.trim().toLowerCase()
  return /^(image|video|audio)\//.test(type)
}
