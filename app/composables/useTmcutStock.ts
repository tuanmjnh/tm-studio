// =============================================================================
//  Stock media search composable (kho tài nguyên).
//
//  Sources are gated by the app's hub connections: Openverse is keyless and
//  always available; Pexels and Pixabay appear only when their connection is
//  `connected` in Connections. Their API keys live in the hub and never reach
//  the renderer — searches go through
//  `POST /v1/apps/:id/connections/:provider/stock-search`, which adds the
//  credential server-side and forwards the provider JSON back.
//
//  Openverse still uses the local trust boundary on both runtimes: the
//  main-process `tmcut:stockSearch` on desktop, `/api/v1/stock/proxy` on web.
//
//  Imports: desktop downloads into <base>/downloads and runs the normal import
//  pipeline; web fetches the bytes, uploads to /api/v1/media/upload and imports
//  the served copy, falling back to `/api/v1/stock/download` when the CDN sends
//  no CORS headers for the file itself.
// =============================================================================
import { computed, ref } from 'vue'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import {
  STOCK_PROVIDERS,
  buildStockFeedRequest,
  buildStockRequest,
  parseStockResponse,
  providerKinds,
  stockFileName,
  stockHasMore,
  stockPageSize,
  stockProvider,
  supportsKind
} from '~/utils/tmcut/stockProviders'
import type { StockItem, StockKind, StockProviderId, StockRequest } from '~/utils/tmcut/stockProviders'

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
async function searchThroughServer(request: StockRequest): Promise<unknown> {
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

type HubProviderRow = {
  key?: string
  connection?: { status?: string } | null
}

export function useTmcutStock() {
  const { isDesktop, downloadRemoteMedia, importWebFiles, assets, addAssetToTimeline, findAssetBySrc } = useTmcutMedia()

  const provider = ref<StockProviderId>('openverse')
  const kind = ref<StockKind>('image')
  const query = ref('')
  const items = ref<StockItem[]>([])
  const mode = ref<'feed' | 'search'>('feed')
  const loading = ref(false)
  const error = ref<string | null>(null)
  const page = ref(0)
  const hasMore = ref(false)
  const importingId = ref<string | null>(null)
  const availability = ref<Record<StockProviderId, boolean>>({
    openverse: true,
    pexels: false,
    pixabay: false
  })

  const providers = computed(() => STOCK_PROVIDERS.filter(entry => availability.value[entry.id]))
  const hiddenProviders = computed(() => STOCK_PROVIDERS.filter(entry => !availability.value[entry.id]))
  const currentProvider = computed(() => stockProvider(provider.value))
  const kinds = computed(() => providerKinds(provider.value))
  const canSearch = computed(() => !!query.value.trim() && !loading.value)

  let requestToken = 0

  /**
   * Keyed sources are shown only when their hub connection is connected, so
   * the panel never offers a provider that would answer 401.
   */
  async function refreshProviders() {
    const next: Record<StockProviderId, boolean> = { openverse: true, pexels: false, pixabay: false }
    try {
      const hub = useHub()
      const res = await hub.connections.list(hub.appId)
      for (const row of ((res.data || []) as HubProviderRow[])) {
        if (row.key === 'pexels' || row.key === 'pixabay') {
          next[row.key] = row.connection?.status === 'connected'
        }
      }
    } catch {
      // Hub offline or signed out: the keyless source still works.
    }
    availability.value = next
    if (!next[provider.value]) {
      provider.value = 'openverse'
      if (!supportsKind(provider.value, kind.value)) kind.value = 'image'
    }
  }

  /** Hub-side search: the credential is added by the hub, never sent here. */
  async function searchThroughHub(request: StockRequest): Promise<unknown> {
    const hub = useHub()
    try {
      const response = await hub.hubFetch<{ success?: boolean, data?: unknown }>(
        `/v1/apps/${hub.appId}/connections/${provider.value}/stock-search`,
        { method: 'POST', body: { url: request.url } }
      )
      if (!response?.success) throw new Error('Stock request failed')
      return response.data
    } catch (err) {
      throw new Error(proxyError(err, 'Stock request failed'), { cause: err })
    }
  }

  async function requestPage(targetPage: number, source: 'feed' | 'search'): Promise<StockItem[]> {
    const perPage = stockPageSize(provider.value)
    const request = source === 'feed'
      ? buildStockFeedRequest({ provider: provider.value, kind: kind.value, page: targetPage, perPage })
      : buildStockRequest(
          { provider: provider.value, kind: kind.value, query: query.value, page: targetPage, perPage },
          { deferAuth: provider.value !== 'openverse' }
        )

    let payload: unknown
    if (provider.value === 'openverse') {
      const ipc = typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
      if (ipc?.stockSearch) {
        const response = await ipc.stockSearch({ url: request.url, headers: request.headers })
        if (!response?.ok) {
          throw new Error(response?.error || `Stock request failed${response?.status ? ` (HTTP ${response.status})` : ''}`)
        }
        payload = response.data
      } else {
        payload = await searchThroughServer(request)
      }
    } else {
      payload = await searchThroughHub(request)
    }

    // Page size comes from the raw payload, not the normalised list: the
    // licence gate can drop entries and would otherwise end pagination early.
    hasMore.value = stockHasMore(provider.value, payload, targetPage, perPage)
    return parseStockResponse({ provider: provider.value, kind: kind.value }, payload)
  }

  async function firstPage() {
    const token = ++requestToken
    loading.value = true
    error.value = null
    try {
      const parsed = await requestPage(1, mode.value)
      if (token !== requestToken) return
      items.value = parsed
      page.value = 1
    } catch (err) {
      if (token !== requestToken) return
      items.value = []
      hasMore.value = false
      error.value = String((err as Error)?.message || err)
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  /** "Hot right now" grid loaded when the panel opens. */
  async function loadFeed() {
    mode.value = 'feed'
    await firstPage()
  }

  async function search() {
    if (!query.value.trim()) {
      await loadFeed()
      return
    }
    mode.value = 'search'
    await firstPage()
  }

  function retry() {
    return firstPage()
  }

  async function loadMore() {
    if (loading.value || !hasMore.value) return
    const token = requestToken
    loading.value = true
    try {
      const next = page.value + 1
      const more = await requestPage(next, mode.value)
      if (token !== requestToken) return
      page.value = next
      items.value = [...items.value, ...more]
    } catch (err) {
      if (token === requestToken) error.value = String((err as Error)?.message || err)
    } finally {
      if (token === requestToken) loading.value = false
    }
  }

  /** Resolve which sources are connected, then preload suggestions. */
  async function initialize() {
    await refreshProviders()
    await loadFeed()
  }

  function selectProvider(next: StockProviderId) {
    if (next === provider.value) return
    provider.value = next
    if (!supportsKind(next, kind.value)) kind.value = providerKinds(next)[0] || 'image'
    void loadFeed()
  }

  function selectKind(next: StockKind) {
    if (!supportsKind(provider.value, next) || next === kind.value) return
    kind.value = next
    void loadFeed()
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
    hiddenProviders,
    provider,
    kind,
    kinds,
    query,
    items,
    mode,
    loading,
    error,
    hasMore,
    page,
    importingId,
    currentProvider,
    canSearch,
    initialize,
    refreshProviders,
    selectProvider,
    selectKind,
    search,
    retry,
    loadMore,
    importItem,
    importToTimeline,
    reset
  }
}
