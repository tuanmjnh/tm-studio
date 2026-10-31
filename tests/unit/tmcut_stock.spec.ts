// =============================================================================
//  Stock library spec (kho tài nguyên).
//
//  Pins the two halves that must never drift:
//   1. app/utils/tmcut/stockProviders.ts — request building (Openverse is
//      pinned to commercial+modification licences), response normalisation
//      per provider, and the commercial-safety gate;
//   2. electron/tools/stock-proxy.cjs — the main-process trust boundary
//      (https + host allowlist, Authorization-only headers, body cap).
//
//  Run: pnpm test:stock (or through run-all).
// =============================================================================
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  STOCK_PROVIDERS,
  buildStockRequest,
  isCommercialSafeLicense,
  parseStockResponse,
  providerKinds,
  requiresAttribution,
  stockFileName,
  supportsKind
} from '../../app/utils/tmcut/stockProviders'
import {
  STOCK_SEARCH_HOSTS,
  checkStockDownloadUrl,
  checkStockSearchUrl,
  isStockMediaContentType,
  sanitizeStockHeaders
} from '../../shared/utils/stockGuards'

let passed = 0
let failed = 0
const pending: Array<Promise<void>> = []
// Async-aware: the proxy check awaits a stubbed fetch.
function check(name: string, fn: () => void | Promise<void>) {
  pending.push((async () => {
    try {
      await fn()
      passed++
      console.log(`ok   ${name}`)
    } catch (error) {
      failed++
      console.log(`FAIL ${name}\n     ${String((error as Error)?.message || error)}`)
    }
  })())
}

// --- Provider registry -------------------------------------------------------

check('registry exposes three commercial-safe providers', () => {
  assert.deepEqual(STOCK_PROVIDERS.map(p => p.id), ['openverse', 'pexels', 'pixabay'])
  assert.equal(providerKinds('openverse').includes('video'), false)
  assert.equal(supportsKind('pexels', 'audio'), false)
  assert.equal(supportsKind('pixabay', 'video'), true)
})

// --- Request building --------------------------------------------------------

check('openverse request pins commercial + modification licences', () => {
  const request = buildStockRequest({ provider: 'openverse', kind: 'image', query: 'sunset', perPage: 12 })
  const url = new URL(request.url)
  assert.equal(url.hostname, 'api.openverse.org')
  assert.equal(url.pathname, '/v1/images/')
  assert.equal(url.searchParams.get('license_type'), 'commercial,modification')
  assert.equal(url.searchParams.get('page_size'), '12')
  assert.deepEqual(request.headers, {})
})

check('openverse audio query uses the audio endpoint', () => {
  const url = new URL(buildStockRequest({ provider: 'openverse', kind: 'audio', query: 'jazz' }).url)
  assert.equal(url.pathname, '/v1/audio/')
})

check('pexels needs a key and sends it as Authorization', () => {
  assert.throws(() => buildStockRequest({ provider: 'pexels', kind: 'image', query: 'dog' }), /API key/)
  const request = buildStockRequest({ provider: 'pexels', kind: 'video', query: 'dog', apiKey: ' abc ' })
  assert.equal(new URL(request.url).pathname, '/videos/search')
  assert.deepEqual(request.headers, { Authorization: 'abc' })
})

check('pixabay puts the key in the query, not a header', () => {
  const request = buildStockRequest({ provider: 'pixabay', kind: 'image', query: 'city', apiKey: 'k1' })
  const url = new URL(request.url)
  assert.equal(url.searchParams.get('key'), 'k1')
  assert.equal(url.searchParams.get('image_type'), 'photo')
  assert.deepEqual(request.headers, {})
})

check('unsupported kind and empty query are refused before any request', () => {
  assert.throws(() => buildStockRequest({ provider: 'openverse', kind: 'video', query: 'x' }), /does not provide/)
  assert.throws(() => buildStockRequest({ provider: 'openverse', kind: 'image', query: '   ' }), /search term/)
})

// --- Licence gate ------------------------------------------------------------

check('only CC0 / PDM / BY / BY-SA pass the commercial gate', () => {
  for (const licence of ['cc0', 'pdm', 'by', 'by-sa']) {
    assert.equal(isCommercialSafeLicense('openverse', licence), true, licence)
  }
  for (const licence of ['by-nc', 'by-nd', 'by-nc-sa', 'by-nc-nd', 'sampling+']) {
    assert.equal(isCommercialSafeLicense('openverse', licence), false, licence)
  }
  // Pexels / Pixabay ship their own commercial licence.
  assert.equal(isCommercialSafeLicense('pexels', 'anything'), true)
})

// --- Response normalisation --------------------------------------------------

check('openverse payload normalises and drops non-commercial entries', () => {
  const items = parseStockResponse({ provider: 'openverse', kind: 'image' }, {
    results: [
      {
        id: 'a1',
        title: 'Sunset ridge',
        creator: 'Ana',
        license: 'by',
        license_version: '4.0',
        url: 'https://cdn.example.org/sunset.jpg',
        thumbnail: 'https://cdn.example.org/sunset-thumb.jpg',
        foreign_landing_url: 'https://example.org/photos/a1',
        width: 1920,
        height: 1080
      },
      { id: 'a2', license: 'by-nc', url: 'https://cdn.example.org/nc.jpg' }
    ]
  })
  assert.equal(items.length, 1)
  const item = items[0]!
  assert.equal(item.id, 'openverse:a1')
  assert.equal(item.license, 'CC BY 4.0')
  assert.equal(item.ext, 'jpg')
  assert.equal(item.previewUrl, 'https://cdn.example.org/sunset-thumb.jpg')
  assert.equal(requiresAttribution(item), true)
})

check('openverse audio duration is converted from milliseconds', () => {
  const items = parseStockResponse({ provider: 'openverse', kind: 'audio' }, {
    results: [{ id: 's1', license: 'cc0', url: 'https://cdn.example.org/a.mp3', duration: 93_000 }]
  })
  assert.equal(items[0]!.kind, 'audio')
  assert.equal(items[0]!.durationSec, 93)
  assert.equal(requiresAttribution(items[0]!), false)
})

check('pexels video picks an mp4 at or below 1080p', () => {
  const items = parseStockResponse({ provider: 'pexels', kind: 'video' }, {
    videos: [{
      id: 7,
      url: 'https://www.pexels.com/video/7/',
      image: 'https://images.pexels.com/videos/7.jpg',
      duration: 12,
      width: 3840,
      height: 2160,
      user: { name: 'Bo' },
      video_files: [
        { link: 'https://player.vimeo.com/external/4k.mp4', file_type: 'video/mp4', width: 3840, height: 2160 },
        { link: 'https://player.vimeo.com/external/1080.mp4', file_type: 'video/mp4', width: 1920, height: 1080 },
        { link: 'https://player.vimeo.com/external/hls.m3u8', file_type: 'application/x-mpegURL', width: 1920 }
      ]
    }]
  })
  assert.equal(items.length, 1)
  assert.equal(items[0]!.downloadUrl, 'https://player.vimeo.com/external/1080.mp4')
  assert.equal(items[0]!.durationSec, 12)
  assert.equal(items[0]!.license, 'Pexels license')
})

check('pixabay image + video normalise from hits', () => {
  const images = parseStockResponse({ provider: 'pixabay', kind: 'image' }, {
    hits: [{ id: 1, tags: 'city, night', user: 'Kim', pageURL: 'https://pixabay.com/i/1', webformatURL: 'https://cdn.pixabay.com/w.jpg', largeImageURL: 'https://cdn.pixabay.com/l.jpg', imageWidth: 3000, imageHeight: 2000 }]
  })
  assert.equal(images[0]!.downloadUrl, 'https://cdn.pixabay.com/l.jpg')
  assert.equal(images[0]!.width, 3000)

  const videos = parseStockResponse({ provider: 'pixabay', kind: 'video' }, {
    hits: [{ id: 2, tags: 'sea', user: 'Lee', pageURL: 'https://pixabay.com/v/2', duration: 8, videos: { large: { url: 'https://cdn.pixabay.com/v.mp4', width: 1920, height: 1080 } } }]
  })
  assert.equal(videos[0]!.kind, 'video')
  assert.equal(videos[0]!.downloadUrl, 'https://cdn.pixabay.com/v.mp4')
})

check('garbage payloads return an empty list instead of throwing', () => {
  assert.deepEqual(parseStockResponse({ provider: 'pexels', kind: 'image' }, null), [])
  assert.deepEqual(parseStockResponse({ provider: 'pexels', kind: 'image' }, { photos: 'nope' }), [])
})

check('download filenames are provider-prefixed and slugged', () => {
  const name = stockFileName({
    id: 'pexels:9',
    provider: 'pexels',
    kind: 'video',
    title: 'Aerial  Beach!!!',
    author: 'x',
    license: 'Pexels license',
    licenseUrl: '',
    pageUrl: '',
    previewUrl: '',
    downloadUrl: 'https://x/y.mp4',
    ext: 'mp4',
    width: 0,
    height: 0,
    durationSec: 0,
    attribution: ''
  })
  assert.equal(name, 'pexels-aerial-beach.mp4')
})

// --- Main-process proxy ------------------------------------------------------

const requireCjs = createRequire(import.meta.url)
const proxy = requireCjs('../../electron/tools/stock-proxy.cjs')

check('proxy allows only https stock hosts', () => {
  assert.equal(proxy.assertStockUrl('https://api.openverse.org/v1/images/').ok, true)
  assert.equal(proxy.assertStockUrl('http://api.pexels.com/v1/search').ok, false)
  assert.equal(proxy.assertStockUrl('https://example.com/x').ok, false)
  assert.equal(proxy.assertStockUrl('not a url').ok, false)
})

check('proxy keeps only an Authorization header', () => {
  assert.deepEqual(
    proxy.sanitizeStockHeaders({ 'authorization': 'KEY', 'Cookie': 'a', 'Referer': 'b', 'X-Test': 'c' }),
    { Authorization: 'KEY' }
  )
  assert.deepEqual(proxy.sanitizeStockHeaders({ authorization: 'bad\r\nInjected: 1' }), {})
  assert.deepEqual(proxy.sanitizeStockHeaders(undefined), {})
})

check('proxy reports provider HTTP errors and rejects invalid JSON', async () => {
  const notFound = await proxy.fetchStockJson({
    url: 'https://api.openverse.org/v1/images/?q=x',
    fetchImpl: async () => new Response('nope', { status: 401 })
  })
  assert.equal(notFound.ok, false)
  assert.equal(notFound.status, 401)

  const invalid = await proxy.fetchStockJson({
    url: 'https://api.openverse.org/v1/images/?q=x',
    fetchImpl: async () => new Response('<html>', { status: 200 })
  })
  assert.equal(invalid.ok, false)

  const good = await proxy.fetchStockJson({
    url: 'https://api.openverse.org/v1/images/?q=x',
    fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: 200 })
  })
  assert.equal(good.ok, true)
  assert.deepEqual(good.data, { results: [] })
})

// --- Web proxy guards (shared/utils/stockGuards.ts) ---------------------------
// The browser build has no IPC: search and download go through Nitro, which
// validates with this module. It must enforce exactly what the desktop proxy
// does, or the two runtimes would let different URLs through.

check('web guards allow exactly the desktop proxy search hosts', () => {
  assert.deepEqual([...STOCK_SEARCH_HOSTS].sort(), [...proxy.STOCK_HOSTS].sort())
  assert.equal(checkStockSearchUrl('https://api.openverse.org/v1/images/?q=x').ok, true)
  assert.equal(checkStockSearchUrl('https://api.pexels.com/v1/search?query=x').ok, true)
  assert.equal(checkStockSearchUrl('https://pixabay.com/api/?key=k&q=x').ok, true)
  assert.equal(checkStockSearchUrl('https://api.pexels.com.evil.example/v1/search').ok, false)
  assert.equal(checkStockSearchUrl('http://api.pexels.com/v1/search').ok, false)
  assert.equal(checkStockSearchUrl('https://user:pass@api.pexels.com/x').ok, false)
  assert.equal(checkStockSearchUrl('not a url').ok, false)
})

check('web download guard only accepts provider CDNs', () => {
  assert.equal(checkStockDownloadUrl('https://images.pexels.com/photos/1/x.jpg').ok, true)
  assert.equal(checkStockDownloadUrl('https://player.vimeo.com/external/1.mp4').ok, true)
  assert.equal(checkStockDownloadUrl('https://cdn.pixabay.com/video/1.mp4').ok, true)
  assert.equal(checkStockDownloadUrl('https://live.staticflickr.com/1/x.jpg').ok, true)
  assert.equal(checkStockDownloadUrl('https://ia800.us.archive.org/1/x.mp3').ok, true)
  // Boundary matters: a lookalike domain must not slip through.
  assert.equal(checkStockDownloadUrl('https://evilpexels.com/x.jpg').ok, false)
  assert.equal(checkStockDownloadUrl('https://pexels.com.evil.example/x.jpg').ok, false)
  // SSRF: IP literals and single-label hosts never match a CDN.
  assert.equal(checkStockDownloadUrl('https://127.0.0.1/x.jpg').ok, false)
  assert.equal(checkStockDownloadUrl('https://localhost/x.jpg').ok, false)
  assert.equal(checkStockDownloadUrl('http://images.pexels.com/x.jpg').ok, false)
})

check('web guards keep only Authorization and demand a media type', () => {
  assert.deepEqual(
    sanitizeStockHeaders({ Authorization: 'KEY', cookie: 'a', referer: 'b' }),
    { Authorization: 'KEY' }
  )
  assert.deepEqual(sanitizeStockHeaders({ authorization: 'bad\r\nX: 1' }), {})
  assert.deepEqual(sanitizeStockHeaders(null), {})
  assert.equal(isStockMediaContentType('image/jpeg'), true)
  assert.equal(isStockMediaContentType('video/mp4; charset=x'), true)
  assert.equal(isStockMediaContentType('text/html'), false)
  assert.equal(isStockMediaContentType(''), false)
})

// Settle every check (some await a stubbed fetch) before reporting.
void Promise.all(pending).then(() => {
  console.log(`\n=== stock: ${passed}/${passed + failed} checks PASSED ===`)
  process.exit(failed === 0 ? 0 : 1)
})
