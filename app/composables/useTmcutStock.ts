// =============================================================================
//  Stock media search composable (kho tài nguyên).
//
//  Same code path on desktop and web:
//    - request  : main-process `tmcut:stockSearch` on desktop (the host
//                 allowlist lives there); on web `/api/v1/stock/proxy`, the
//                 Nitro twin of that proxy — a plain browser fetch is NOT
//                 enough because Pexels answers a preflight without CORS
//                 headers, so the search used to fail outright on the web;
//    - import   : desktop downloads into <base>/downloads then runs the normal
//                 import pipeline; web fetches the bytes, uploads them to
//                 /api/v1/media/upload and imports the served copy, falling
//                 back to `/api/v1/stock/download` when the provider CDN sends
//                 no CORS headers for the media file itself.
//
//  API keys for Pexels/Pixabay (free, read-only search keys) live in
//  localStorage per provider. Openverse needs no key.
// =============================================================================
import { computed, ref } from 'vue'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import {
  STOCK_PROVIDERS,
  buildStockRequest,
  parseStockResponse,
  providerKinds,
  stockFileName,
  stockProvider,
  supportsKind
} from '~/utils/tmcut/stockProviders'
import type { StockItem, StockKind, StockProviderId } from '~/utils/tmcut/stockProviders'

const KEY_PREFIX = 'tmcut_stock_key_'
const PROXY_ENDPOINT = '/api/v1/stock/proxy'
const DOWNLOAD_ENDPOINT = '/api/v1/stock/download'

/** Server error body -> a message worth showing in the panel. */
function proxyError(err: unknown, fallback: string): string {
  const data = (err as { data?: { message?: string } })?.data
  if (data?.message) return String(data.message).slice(0, 300)
  const message = (err as Error)?.message
  return message ? message.slice(0, 300) : fallback
}

/**
 * Web search: the browser cannot call the provider APIs itself (Pexels sends
 * no CORS headers), so the request is forwarded to the Nitro proxy, which
 * re-validates host + headers exactly like the Electron main process does.
 */
async function searchThroughServer(request: { url: string, headers: Record<string, string> }): Promise<unknown> {
  try {
    const response = await $fetch<{ ok: boolean, data: unknown }>(PROXY_ENDPOINT, {
      method: 'POST',
      body: { url: request.url, headers: request.headers }
    })
    if (!response?.ok) throw new Error('Stock request failed')
    return response.data
  } catch (err) {
    throw new Error(proxyError(err, 'Stock request failed'), { cause: err })
  }
}

/**
 * Web download: direct fetch first, server proxy on a CORS/network failure.
 * The proxy only serves the provider CDNs, so this is not an open relay.
 */
async function fetchStockBytes(url: string): Promise<Blob> {
  try {
    const response = await fetch(url, { credentials: 'omit' })
    if (response.ok) return await response.blob()
  } catch {
    // CORS / DNS / offline: retry through the server, which enforces the
    // provider-CDN allowlist on its side.
  }
  try {
    return await $fetch<Blob>(DOWNLOAD_ENDPOINT, { method: 'POST', body: { url }, responseType: 'blob' })
  } catch (err) {
    throw new Error(proxyError(err, 'Download failed'), { cause: err })
  }
}

function readKey(provider: StockProviderId): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(KEY_PREFIX + provider) || ''
  } catch {
    return ''
  }
}

export function useTmcutStock() {
  const { isDesktop, downloadRemoteMedia, importWebFiles, assets, addAssetToTimeline, findAssetBySrc } = useTmcutMedia()

  const provider = ref<StockProviderId>('openverse')
  const kind = ref<StockKind>('image')
  const query = ref('')
  const items = ref<StockItem[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(0)
  const hasMore = ref(false)
  const importingId = ref<string | null>(null)
  const keys = ref<Record<StockProviderId, string>>({
    openverse: '',
    pexels: readKey('pexels'),
    pixabay: readKey('pixabay')
  })

  const providers = STOCK_PROVIDERS
  const currentProvider = computed(() => stockProvider(provider.value))
  const kinds = computed(() => providerKinds(provider.value))
  const apiKey = computed(() => keys.value[provider.value] || '')
  const needsKey = computed(() => !!currentProvider.value?.requiresKey && !apiKey.value)
  const canSearch = computed(() => !!query.value.trim() && !loading.value && !needsKey.value)

  function setKey(value: string) {
    const next = value.trim()
    keys.value[provider.value] = next
    if (typeof window === 'undefined') return
    try {
      if (next) window.localStorage.setItem(KEY_PREFIX + provider.value, next)
      else window.localStorage.removeItem(KEY_PREFIX + provider.value)
    } catch {
      // Private mode / quota: the key still works for this session.
    }
  }

  function selectProvider(next: StockProviderId) {
    provider.value = next
    error.value = null
    items.value = []
    page.value = 0
    hasMore.value = false
    if (!supportsKind(next, kind.value)) kind.value = providerKinds(next)[0] || 'image'
  }

  function selectKind(next: StockKind) {
    if (!supportsKind(provider.value, next)) return
    kind.value = next
    items.value = []
    page.value = 0
    hasMore.value = false
    error.value = null
  }

  async function requestPage(targetPage: number): Promise<StockItem[]> {
    const args = {
      provider: provider.value,
      kind: kind.value,
      query: query.value,
      page: targetPage,
      perPage: 24,
      apiKey: apiKey.value
    }
    const request = buildStockRequest(args)
    const ipc = typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined

    let payload: unknown
    if (ipc?.stockSearch) {
      const response = await ipc.stockSearch({ url: request.url, headers: request.headers })
      if (!response?.ok) {
        throw new Error(response?.error || `Stock request failed${response?.status ? ` (HTTP ${response.status})` : ''}`)
      }
      payload = response.data
    } else {
      payload = await searchThroughServer(request)
    }

    const parsed = parseStockResponse({ provider: args.provider, kind: args.kind }, payload)
    hasMore.value = parsed.length >= 24
    return parsed
  }

  async function search() {
    if (!query.value.trim()) {
      error.value = 'Enter a search term'
      return
    }
    if (needsKey.value) {
      error.value = `Add a ${currentProvider.value?.label} API key first`
      return
    }
    loading.value = true
    error.value = null
    page.value = 1
    try {
      items.value = await requestPage(1)
    } catch (err) {
      items.value = []
      error.value = String((err as Error)?.message || err)
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    loading.value = true
    try {
      const next = page.value + 1
      const more = await requestPage(next)
      page.value = next
      items.value = [...items.value, ...more]
    } catch (err) {
      error.value = String((err as Error)?.message || err)
    } finally {
      loading.value = false
    }
  }

  /**
   * Import one result into the media library. Returns the asset id so the
   * caller can drop it on the timeline (or offer it as "Added").
   */
  async function importItem(item: StockItem): Promise<{ ok: boolean, assetId?: string, error?: string }> {
    if (importingId.value) return { ok: false, error: 'Another import is running' }
    importingId.value = item.id
    try {
      if (isDesktop.value) {
        const downloaded = await downloadRemoteMedia(item.downloadUrl, { filename: stockFileName(item) })
        if (!downloaded.ok || !downloaded.path) {
          return { ok: false, error: downloaded.error || 'Download failed' }
        }
        const asset = findAssetBySrc(downloaded.path)
        return asset ? { ok: true, assetId: asset.id } : { ok: false, error: 'Downloaded file was not imported' }
      }

      // Web: pull the bytes and run the normal upload/thumbnail pipeline.
      // A direct cross-origin GET first (cheapest, no server hop); when the
      // provider CDN sends no CORS headers the same request goes through the
      // allowlisted server proxy instead.
      const blob = await fetchStockBytes(item.downloadUrl)
      const file = new File([blob], stockFileName(item), { type: blob.type || 'application/octet-stream' })
      const created = await importWebFiles([file])
      const asset = created[0] || assets.value.find(a => a.name === file.name)
      return asset ? { ok: true, assetId: asset.id } : { ok: false, error: 'Downloaded file was not imported' }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message || err) }
    } finally {
      importingId.value = null
    }
  }

  /** Import and append to the timeline in one step. */
  async function importToTimeline(item: StockItem): Promise<{ ok: boolean, error?: string }> {
    const imported = await importItem(item)
    if (!imported.ok || !imported.assetId) return { ok: false, error: imported.error }
    return addAssetToTimeline(imported.assetId) ? { ok: true } : { ok: false, error: 'Could not add to the timeline' }
  }

  function reset() {
    items.value = []
    error.value = null
    page.value = 0
    hasMore.value = false
  }

  return {
    providers,
    provider,
    kind,
    kinds,
    query,
    items,
    loading,
    error,
    hasMore,
    page,
    importingId,
    currentProvider,
    apiKey,
    needsKey,
    canSearch,
    setKey,
    selectProvider,
    selectKind,
    search,
    loadMore,
    importItem,
    importToTimeline,
    reset
  }
}
