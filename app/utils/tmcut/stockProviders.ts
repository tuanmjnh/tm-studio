// =============================================================================
//  Stock media providers (roadmap "kho tài nguyên") — PURE.
//
//  One search surface for free-for-commercial stock media:
//    - Openverse  : keyless, CC-licensed images + audio. Queries are pinned to
//                   `license_type=commercial,modification`, i.e. CC0 / CC BY /
//                   CC BY-SA — never NC or ND.
//    - Pexels     : optional API key, photos + videos under the Pexels license
//                   (free for commercial use, no attribution required).
//    - Pixabay    : optional API key, photos + videos under the Pixabay
//                   Content License (free for commercial use).
//
//  This module only builds requests and normalises responses, so the node
//  spec runner can exercise every provider without a network. The renderer
//  sends `buildStockRequest()` to the main process (desktop) or fetches it
//  directly (web, CORS-enabled APIs); nothing here is Electron-specific.
// =============================================================================

export type StockKind = 'image' | 'video' | 'audio'
export type StockProviderId = 'openverse' | 'pexels' | 'pixabay'

export interface StockItem {
  /** `${provider}:${native id}` — stable across re-searches. */
  id: string
  provider: StockProviderId
  kind: StockKind
  title: string
  author: string
  /** Human licence label ("CC BY 4.0", "Pexels license", …). */
  license: string
  licenseUrl: string
  /** The provider page (attribution / source of truth). */
  pageUrl: string
  /** Small image safe for a grid tile. */
  previewUrl: string
  /** Full-resolution asset the editor downloads/imports. */
  downloadUrl: string
  ext: string
  width: number
  height: number
  /** 0 when the provider does not report it. */
  durationSec: number
  /** Ready-to-paste credit line for CC BY / BY-SA material. */
  attribution: string
}

export interface StockSearchArgs {
  provider: StockProviderId
  kind: StockKind
  query: string
  page?: number
  perPage?: number
  apiKey?: string
}

export interface StockRequest {
  url: string
  headers: Record<string, string>
}

export interface StockProviderInfo {
  id: StockProviderId
  label: string
  kinds: StockKind[]
  requiresKey: boolean
  /** Where the user creates a free API key. */
  keyUrl: string
  /** One honest line about what the licence allows. */
  licenseNote: string
}

export const STOCK_PROVIDERS: StockProviderInfo[] = [
  {
    id: 'openverse',
    label: 'Openverse',
    kinds: ['image', 'audio'],
    requiresKey: false,
    keyUrl: 'https://api.openverse.org/v1/#/',
    licenseNote: 'CC0 / CC BY / CC BY-SA only — commercial use and remixing allowed, credit required for BY.'
  },
  {
    id: 'pexels',
    label: 'Pexels',
    kinds: ['image', 'video'],
    requiresKey: true,
    keyUrl: 'https://www.pexels.com/api/new/',
    licenseNote: 'Pexels license — free for commercial use, attribution not required, no reselling unaltered copies.'
  },
  {
    id: 'pixabay',
    label: 'Pixabay',
    kinds: ['image', 'video'],
    requiresKey: true,
    keyUrl: 'https://pixabay.com/api/docs/',
    licenseNote: 'Pixabay Content License — free for commercial use, no reselling unaltered copies.'
  }
]

const OPENVERSE_API = 'https://api.openverse.org/v1'
const PEXELS_API = 'https://api.pexels.com'
const PIXABAY_API = 'https://pixabay.com/api'

/** Licences that allow commercial use AND modification. */
const COMMERCIAL_SAFE_CC = new Set(['cc0', 'pdm', 'by', 'by-sa'])

export function stockProvider(id: string): StockProviderInfo | null {
  return STOCK_PROVIDERS.find(provider => provider.id === id) || null
}

export function providerKinds(provider: StockProviderId): StockKind[] {
  return stockProvider(provider)?.kinds.slice() || []
}

export function supportsKind(provider: StockProviderId, kind: StockKind): boolean {
  return providerKinds(provider).includes(kind)
}

function clampPage(value: number | undefined): number {
  return Math.max(1, Math.min(50, Math.round(Number(value) || 1)))
}

function clampPerPage(value: number | undefined, max: number): number {
  return Math.max(1, Math.min(max, Math.round(Number(value) || 20)))
}

/**
 * Build the GET a provider expects. Throws a user-facing message for the two
 * recoverable cases (missing key / unsupported media kind) instead of sending
 * a request that would 401.
 */
export function buildStockRequest(args: StockSearchArgs): StockRequest {
  const provider = stockProvider(args.provider)
  if (!provider) throw new Error(`Unknown stock provider: ${args.provider}`)
  if (!supportsKind(args.provider, args.kind)) {
    throw new Error(`${provider.label} does not provide ${args.kind} results`)
  }
  const query = String(args.query || '').trim().slice(0, 200)
  if (!query) throw new Error('Enter a search term')

  if (args.provider === 'openverse') {
    const base = args.kind === 'audio' ? `${OPENVERSE_API}/audio/` : `${OPENVERSE_API}/images/`
    const params = new URLSearchParams({
      q: query,
      license_type: 'commercial,modification',
      page_size: String(clampPerPage(args.perPage, 20)),
      page: String(clampPage(args.page))
    })
    return { url: `${base}?${params.toString()}`, headers: {} }
  }

  const apiKey = String(args.apiKey || '').trim()
  if (!apiKey) throw new Error(`Add a ${provider.label} API key to search this source`)

  if (args.provider === 'pexels') {
    const base = args.kind === 'video' ? `${PEXELS_API}/videos/search` : `${PEXELS_API}/v1/search`
    const params = new URLSearchParams({
      query,
      per_page: String(clampPerPage(args.perPage, 80)),
      page: String(clampPage(args.page))
    })
    return { url: `${base}?${params.toString()}`, headers: { Authorization: apiKey } }
  }

  const params = new URLSearchParams({
    key: apiKey,
    q: query,
    per_page: String(clampPerPage(args.perPage, 50)),
    page: String(clampPage(args.page)),
    safesearch: 'true'
  })
  if (args.kind === 'video') return { url: `${PIXABAY_API}/videos/?${params.toString()}`, headers: {} }
  params.set('image_type', 'photo')
  return { url: `${PIXABAY_API}/?${params.toString()}`, headers: {} }
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function extFromUrl(url: string, fallback: string): string {
  const match = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url)
  return match ? match[1]!.toLowerCase() : fallback
}

function baseName(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname
    const name = decodeURIComponent(path.split('/').filter(Boolean).pop() || '')
    return name || fallback
  } catch {
    return fallback
  }
}

function ccLabel(license: string, version: string): string {
  const key = license.toLowerCase()
  if (key === 'cc0') return 'CC0 1.0 (public domain)'
  if (key === 'pdm') return 'Public Domain Mark'
  const name = key === 'by' ? 'CC BY' : key === 'by-sa' ? 'CC BY-SA' : `CC ${key.toUpperCase()}`
  return version ? `${name} ${version}` : name
}

function ccUrl(license: string, version: string): string {
  const key = license.toLowerCase()
  if (key === 'cc0') return 'https://creativecommons.org/publicdomain/zero/1.0/'
  if (key === 'pdm') return 'https://creativecommons.org/publicdomain/mark/1.0/'
  return `https://creativecommons.org/licenses/${key}/${version || '4.0'}/`
}

/** Only commercial-use + modification-safe licences survive normalisation. */
export function isCommercialSafeLicense(provider: StockProviderId, license: string): boolean {
  if (provider !== 'openverse') return true // Pexels / Pixabay licences are commercial by design.
  return COMMERCIAL_SAFE_CC.has(String(license || '').toLowerCase())
}

function parseOpenverse(kind: StockKind, payload: unknown): StockItem[] {
  const results = (payload as { results?: unknown })?.results
  if (!Array.isArray(results)) return []
  const items: StockItem[] = []
  for (const raw of results) {
    const entry = raw as Record<string, unknown>
    const license = str(entry.license).toLowerCase()
    if (!isCommercialSafeLicense('openverse', license)) continue
    const download = str(entry.url)
    if (!download) continue
    const id = str(entry.id) || baseName(download, `${kind}`)
    const title = str(entry.title) || baseName(download, `${kind} result`)
    const author = str(entry.creator) || 'Unknown creator'
    const version = str(entry.license_version)
    const pageUrl = str(entry.foreign_landing_url)
    const itemKind: StockKind = kind === 'audio' ? 'audio' : 'image'
    items.push({
      id: `openverse:${id}`,
      provider: 'openverse',
      kind: itemKind,
      title,
      author,
      license: ccLabel(license, version),
      licenseUrl: str(entry.license_url) || ccUrl(license, version),
      pageUrl,
      previewUrl: str(entry.thumbnail) || download,
      downloadUrl: download,
      ext: extFromUrl(download, itemKind === 'audio' ? 'mp3' : 'jpg'),
      width: num(entry.width),
      height: num(entry.height),
      // Openverse reports audio duration in milliseconds.
      durationSec: itemKind === 'audio' ? Math.round(num(entry.duration) / 1000) : 0,
      attribution: str(entry.attribution)
        || `"${title}" by ${author} — ${ccLabel(license, version)}`
    })
  }
  return items
}

function parsePexels(kind: StockKind, payload: unknown): StockItem[] {
  const body = payload as Record<string, unknown>
  const items: StockItem[] = []
  if (kind === 'video') {
    const videos = Array.isArray(body.videos) ? body.videos : []
    for (const raw of videos) {
      const entry = raw as Record<string, unknown>
      const files = Array.isArray(entry.video_files) ? entry.video_files as Array<Record<string, unknown>> : []
      const mp4 = files
        .filter(file => str(file.file_type) === 'video/mp4' && str(file.link))
        .sort((a, b) => num(b.width) - num(a.width))
        .find(file => num(file.width) <= 1920) || files.find(file => str(file.file_type) === 'video/mp4')
      const link = str(mp4?.link)
      if (!link) continue
      const user = (entry.user || {}) as Record<string, unknown>
      const id = String(entry.id ?? baseName(link, 'pexels-video'))
      const title = str(entry.alt) || `Pexels video ${id}`
      items.push({
        id: `pexels:${id}`,
        provider: 'pexels',
        kind: 'video',
        title,
        author: str(user.name) || 'Pexels contributor',
        license: 'Pexels license',
        licenseUrl: 'https://www.pexels.com/license/',
        pageUrl: str(entry.url),
        previewUrl: str(entry.image),
        downloadUrl: link,
        ext: extFromUrl(link, 'mp4'),
        width: num(mp4?.width) || num(entry.width),
        height: num(mp4?.height) || num(entry.height),
        durationSec: num(entry.duration),
        attribution: `Video by ${str(user.name) || 'a Pexels contributor'} on Pexels`
      })
    }
    return items
  }
  const photos = Array.isArray(body.photos) ? body.photos : []
  for (const raw of photos) {
    const entry = raw as Record<string, unknown>
    const sources = (entry.src || {}) as Record<string, unknown>
    const download = str(sources.original) || str(sources.large2x)
    if (!download) continue
    const id = String(entry.id ?? baseName(download, 'pexels-photo'))
    items.push({
      id: `pexels:${id}`,
      provider: 'pexels',
      kind: 'image',
      title: str(entry.alt) || `Pexels photo ${id}`,
      author: str(entry.photographer) || 'Pexels contributor',
      license: 'Pexels license',
      licenseUrl: 'https://www.pexels.com/license/',
      pageUrl: str(entry.url),
      previewUrl: str(sources.medium) || str(sources.small) || download,
      downloadUrl: download,
      ext: extFromUrl(download, 'jpg'),
      width: num(entry.width),
      height: num(entry.height),
      durationSec: 0,
      attribution: `Photo by ${str(entry.photographer) || 'a Pexels contributor'} on Pexels`
    })
  }
  return items
}

function parsePixabay(kind: StockKind, payload: unknown): StockItem[] {
  const hits = (payload as { hits?: unknown })?.hits
  if (!Array.isArray(hits)) return []
  const items: StockItem[] = []
  for (const raw of hits) {
    const entry = raw as Record<string, unknown>
    if (kind === 'video') {
      const videos = (entry.videos || {}) as Record<string, unknown>
      const large = (videos.large || {}) as Record<string, unknown>
      const medium = (videos.medium || {}) as Record<string, unknown>
      const pick = str(large.url) ? large : medium
      const link = str(pick.url)
      if (!link) continue
      const id = String(entry.id ?? baseName(link, 'pixabay-video'))
      items.push({
        id: `pixabay:${id}`,
        provider: 'pixabay',
        kind: 'video',
        title: str(entry.tags) || `Pixabay video ${id}`,
        author: str(entry.user) || 'Pixabay contributor',
        license: 'Pixabay Content License',
        licenseUrl: 'https://pixabay.com/service/license-summary/',
        pageUrl: str(entry.pageURL),
        previewUrl: str(pick.thumbnail) || str(medium.thumbnail) || str(link),
        downloadUrl: link,
        ext: extFromUrl(link, 'mp4'),
        width: num(pick.width),
        height: num(pick.height),
        durationSec: num(entry.duration),
        attribution: `Video by ${str(entry.user) || 'a Pixabay contributor'} on Pixabay`
      })
      continue
    }
    const link = str(entry.largeImageURL) || str(entry.webformatURL)
    if (!link) continue
    const id = String(entry.id ?? baseName(link, 'pixabay-image'))
    items.push({
      id: `pixabay:${id}`,
      provider: 'pixabay',
      kind: 'image',
      title: str(entry.tags) || `Pixabay image ${id}`,
      author: str(entry.user) || 'Pixabay contributor',
      license: 'Pixabay Content License',
      licenseUrl: 'https://pixabay.com/service/license-summary/',
      pageUrl: str(entry.pageURL),
      previewUrl: str(entry.webformatURL) || link,
      downloadUrl: link,
      ext: extFromUrl(link, 'jpg'),
      width: num(entry.imageWidth),
      height: num(entry.imageHeight),
      durationSec: 0,
      attribution: `Image by ${str(entry.user) || 'a Pixabay contributor'} on Pixabay`
    })
  }
  return items
}

/** Normalise one provider payload into commercial-safe `StockItem`s. */
export function parseStockResponse(args: Pick<StockSearchArgs, 'provider' | 'kind'>, payload: unknown): StockItem[] {
  if (!payload || typeof payload !== 'object') return []
  if (args.provider === 'openverse') return parseOpenverse(args.kind, payload)
  if (args.provider === 'pexels') return parsePexels(args.kind, payload)
  if (args.provider === 'pixabay') return parsePixabay(args.kind, payload)
  return []
}

/** A safe, media-typed filename for the download/upload step. */
export function stockFileName(item: StockItem): string {
  const slug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'stock'
  return `${item.provider}-${slug}.${item.ext}`
}

/** True when the credit line must be shown/kept (CC BY / BY-SA). */
export function requiresAttribution(item: StockItem): boolean {
  return item.provider === 'openverse' && /^CC BY/.test(item.license)
}
