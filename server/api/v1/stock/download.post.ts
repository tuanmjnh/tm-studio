import { checkStockDownloadUrl, isStockMediaContentType } from '../../../../shared/utils/stockGuards'

/**
 * Stock media download proxy for the WEB runtime (kho tài nguyên).
 *
 * The stock panel imports a result by fetching its bytes and POSTing them to
 * `/api/v1/media/upload`. In the browser that fetch is a cross-origin GET to
 * the provider's CDN, and several of those hosts (Flickr/Openverse audio,
 * some Pexels video renditions) send no CORS headers — the import then dies
 * with an opaque "Failed to fetch" even though the search worked.
 *
 * Desktop never needs this: the main process downloads into
 * `<base>/downloads` and runs the normal import pipeline
 * (`electron/tools/tmcut.controller.cjs` downloadMedia, same host rules).
 *
 * Trust boundary (the browser is the untrusted side):
 *   - https only, no credentials, no redirects;
 *   - hostname must be (or be a subdomain of) one of the provider CDNs in
 *     `shared/utils/stockGuards.ts` — an arbitrary URL can never be turned
 *     into a server-side request;
 *   - the response must declare an image/video/audio content type;
 *   - 60 s timeout, 128 MiB cap.
 *
 * Contract: POST /api/v1/stock/download
 *   body = { url }
 *   ←    = the media bytes with the provider's content type
 */
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024
const TIMEOUT_MS = 60_000

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<Record<string, unknown>>(event) || {}
  const checked = checkStockDownloadUrl(body.url)
  if (!checked.ok || !checked.url) {
    throw createError({ statusCode: 400, statusMessage: 'error.stockUrl', message: checked.reason || 'Invalid stock URL' })
  }

  let response: Response
  try {
    response = await fetch(checked.url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const message = (error as Error)?.name === 'TimeoutError'
      ? 'Stock download timed out'
      : `Stock download failed: ${(error as Error)?.message || error}`
    throw createError({ statusCode: 502, statusMessage: 'error.stockUnreachable', message })
  }

  if (!response.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: 'error.stockUpstream',
      message: `Download failed (HTTP ${response.status})`
    })
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
  if (!isStockMediaContentType(contentType)) {
    throw createError({
      statusCode: 502,
      statusMessage: 'error.stockUpstream',
      message: 'Stock host did not return media'
    })
  }

  const declared = Number(response.headers.get('content-length')) || 0
  if (declared > MAX_DOWNLOAD_BYTES) {
    throw createError({ statusCode: 502, statusMessage: 'error.stockUpstream', message: 'Stock file is larger than 128 MiB' })
  }

  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length === 0) {
    throw createError({ statusCode: 502, statusMessage: 'error.stockUpstream', message: 'Stock host returned an empty file' })
  }
  if (bytes.length > MAX_DOWNLOAD_BYTES) {
    throw createError({ statusCode: 502, statusMessage: 'error.stockUpstream', message: 'Stock file is larger than 128 MiB' })
  }

  setHeader(event, 'content-type', contentType)
  setHeader(event, 'content-length', bytes.length)
  setHeader(event, 'cache-control', 'private, max-age=0, no-store')
  return bytes
})
