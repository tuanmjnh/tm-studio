import { ref, computed } from 'vue'
import type { TmcutAsset, TmcutAssetKind, TmcutMediaFolder } from '~/types/tmcut'
import type { DownloadProgressPayload } from '#shared/types/electron'
import { createEmptyTmcutAssetMeta } from '~/types/tmcut'
import { effectiveAssetKind } from '~/utils/tmcut/assetKind'
import {
  classifyAssetKind,
  mediaFileName,
  mediaFileKey,
  normalizeMediaPath
} from '~/utils/tmcut/media'
import { clampWaveformPoints } from '~/utils/tmcut/waveform'
import { readStoredFlag, writeStored } from '~/utils/tmcut/localStore'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { toURL } from '~/utils/ffmpegHelper'
import {
  fnv1aHex,
  normalizeProbe,
  createFolder as coreCreateFolder,
  renameFolder as coreRenameFolder,
  updateFolderColor as coreUpdateFolderColor,
  removeFolder as coreRemoveFolder,
  setAssetFolder as coreSetAssetFolder,
  getAssetFolder as coreGetAssetFolder,
  getFolderCounts as coreGetFolderCounts,
  secToTicks,
  FOLDER_TAG_COLORS

} from '@tmcut-core'

const ASSET_STORAGE_KEY = 'tmcut_assets_v1'
const FOLDER_STORAGE_KEY = 'tmcut_folders_v1'
const PROXY_PREVIEW_KEY = 'tmcut.proxyPreview'

const assets = ref<TmcutAsset[]>([])
const folders = ref<TmcutMediaFolder[]>([])
const selectedFolderId = ref<string | null>(null)
const libraryLoaded = ref(false)
const importing = ref(false)
const importError = ref<string | null>(null)
// Web upload throughput readout ({done}/{total}), shown by the media panel
// banner while importWebFiles streams files to the local server.
const webUpload = ref<{ done: number, total: number } | null>(null)
const proxyPreview = ref(true)

if (import.meta.client && typeof window !== 'undefined') {
  proxyPreview.value = readStoredFlag(PROXY_PREVIEW_KEY, true)
  watch(proxyPreview, (v) => {
    writeStored(PROXY_PREVIEW_KEY, v ? '1' : '0')
  })
}

const waveformCache = new Map<string, number[]>()

// Keyed index of the asset list. findAssetBySrc used to scan every asset with
// mediaFileKey() on each call, and the preview player plus timeline clips call
// it several times per animation frame.
const assetKeyIndex = computed(() => {
  const index = new Map<string, TmcutAsset>()
  for (const asset of assets.value) {
    const key = mediaFileKey(asset.path)
    // First match wins, matching the Array#find scan it replaces.
    if (!index.has(key)) index.set(key, asset)
  }
  return index
})

function tmcutIpc() {
  return typeof window !== 'undefined' ? window.electronAPI?.tmcut : undefined
}

// ===== Web uploads (R152) =====
// The web runtime ships picked files to the local Nitro server
// (POST /api/v1/media/upload) and stores the returned /uploads/ URL as the
// asset path. That copy survives reloads — blob: URLs never did.
function isWebUploadPath(path: string | null | undefined): boolean {
  return !!path && path.startsWith('/uploads/')
}

// localStorage persistence on web keeps only assets whose bytes still exist
// somewhere: uploaded server copies. Blob:/data: URLs are session-bound.
function isDurableAssetPath(path: string): boolean {
  return isWebUploadPath(path) || /^(https?:)/.test(path)
}

function thumbNameFor(name: string): string {
  // Strip the source extension and stamp thumbnails as jpg (they are
  // captured as image/jpeg data URLs).
  return `${name.replace(/\.[^.]+$/, '')}.jpg`
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob | null> {
  try {
    return await (await fetch(dataUrl)).blob()
  } catch {
    return null
  }
}

function mediaUrl(filePath: string): string {
  // Same URL builder as ToolsVideoFramePreview (tools/video.vue):
  // local files are served through the privileged media://local protocol
  return toURL(filePath)
}

export function useTmcutMedia() {
  const { currentProject, addClipToTrack, updateClipsSrc } = useTmcutProject()

  const isDesktop = computed(() => !!tmcutIpc())

  const projectAssets = computed(() => {
    const pid = currentProject.value?.id
    if (!pid) return []
    return assets.value.filter(a => a.usedBy.includes(pid))
  })

  const projectFolders = computed(() => {
    const pid = currentProject.value?.id
    if (!pid) return folders.value
    return folders.value.filter(f => !f.projectId || f.projectId === pid)
  })

  const folderCounts = computed(() => {
    const pid = currentProject.value?.id
    return coreGetFolderCounts(projectFolders.value, projectAssets.value, pid)
  })

  const missingAssets = computed(() => projectAssets.value.filter(a => a.status === 'missing'))

  const analyzingCount = computed(() => projectAssets.value.filter(a => a.status === 'analyzing').length)

  // All media paths currently referenced by timeline clips (normalized).
  // Used for the CapCut-style "Added" badge in the media library.
  const timelineSrcSet = computed(() => {
    const set = new Set<string>()
    for (const track of currentProject.value?.timeline?.tracks || []) {
      for (const item of track.items || []) {
        if (item.src) set.add(mediaFileKey(item.src))
      }
    }
    return set
  })

  function findAssetBySrc(src?: string | null): TmcutAsset | undefined {
    if (!src) return undefined
    return assetKeyIndex.value.get(mediaFileKey(src))
  }

  function loadFolders() {
    try {
      const raw = localStorage.getItem(FOLDER_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as TmcutMediaFolder[]
        if (Array.isArray(parsed)) {
          folders.value = parsed
        }
      }
    } catch (error) {
      console.error('Failed to parse folders from localStorage:', error)
    }
  }

  function persistFolders() {
    try {
      localStorage.setItem(FOLDER_STORAGE_KEY, JSON.stringify(folders.value))
    } catch (error) {
      console.error('Failed to persist folders to localStorage:', error)
    }
  }

  function addFolder(name: string, color?: string): TmcutMediaFolder {
    const pid = currentProject.value?.id
    const folder = coreCreateFolder(folders.value, { name, color, projectId: pid })
    persistFolders()
    return folder
  }

  function editFolder(folderId: string, newName: string): boolean {
    const ok = coreRenameFolder(folders.value, folderId, newName)
    if (ok) persistFolders()
    return ok
  }

  function changeFolderColor(folderId: string, color: string): boolean {
    const ok = coreUpdateFolderColor(folders.value, folderId, color)
    if (ok) persistFolders()
    return ok
  }

  function deleteFolder(folderId: string): boolean {
    const ok = coreRemoveFolder(folders.value, folderId)
    if (ok) {
      const pid = currentProject.value?.id
      for (const a of assets.value) {
        if (coreGetAssetFolder(a, pid) === folderId) {
          coreSetAssetFolder(a, null, pid)
        }
      }
      if (selectedFolderId.value === folderId) {
        selectedFolderId.value = null
      }
      persistFolders()
      persistLibrary()
    }
    return ok
  }

  function moveAssetToFolder(assetId: string, folderId: string | null): boolean {
    const asset = assets.value.find(a => a.id === assetId)
    if (!asset) return false
    const pid = currentProject.value?.id
    coreSetAssetFolder(asset, folderId, pid)
    persistLibrary()
    return true
  }

  function getAssetFolderId(asset: TmcutAsset): string | null {
    const pid = currentProject.value?.id
    return coreGetAssetFolder(asset, pid)
  }

  async function loadLibrary() {
    if (libraryLoaded.value) return
    libraryLoaded.value = true
    loadFolders()
    const ipc = tmcutIpc()
    // Web runtime: keep assets whose bytes live on the local server
    // (/uploads/…); blob: URLs from a previous page load can never resolve
    // again, so they are dropped here (R152 — uploads made the library
    // durable, see persistLibrary).
    if (!ipc) {
      if (import.meta.server) {
        assets.value = []
        return
      }
      try {
        const raw = localStorage.getItem(ASSET_STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) as TmcutAsset[] : []
        assets.value = Array.isArray(parsed) ? parsed.filter(a => isDurableAssetPath(a.path)) : []
      } catch (error) {
        console.error('Failed to parse media registry from localStorage:', error)
        assets.value = []
      }
      return
    }
    if (!import.meta.server) {
      try {
        const data = (await ipc.readAssetsFile()) as TmcutAsset[] | null
        if (Array.isArray(data) && data.length > 0) {
          assets.value = data
          await checkMissing()
          return
        }
      } catch (error) {
        console.error('Failed to load media registry from disk:', error)
      }
    }
    try {
      const raw = localStorage.getItem(ASSET_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as TmcutAsset[]
        if (Array.isArray(parsed)) assets.value = parsed
      }
    } catch (error) {
      console.error('Failed to parse media registry from localStorage:', error)
    }
    await checkMissing()
  }

  function persistLibrary() {
    const ipc = tmcutIpc()
    if (!ipc) {
      // Web runtime: uploaded assets (/uploads/… URLs) persist through
      // reloads. Session-bound blob: URLs are filtered out — persisting them
      // would resurrect dead references on the next load.
      if (import.meta.server) return
      try {
        const durable = assets.value.filter(a => isDurableAssetPath(a.path))
        localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(durable))
      } catch (error) {
        console.error('Failed to persist media registry to localStorage:', error)
      }
      return
    }
    try {
      localStorage.setItem(ASSET_STORAGE_KEY, JSON.stringify(assets.value))
    } catch (error) {
      console.error('Failed to persist media registry to localStorage:', error)
    }
    if (ipc) {
      // Convert Vue reactive proxies to plain objects — Electron's
      // structured clone algorithm cannot serialize reactive proxies
      // ("An object could not be cloned"). Same pattern as
      // useTmcutProject.persistProjectToDisk.
      const plain = JSON.parse(JSON.stringify(assets.value)) as TmcutAsset[]
      ipc.writeAssetsFile(plain).catch(() => {})
    }
  }

  function buildAsset(inputPath: string, kind: TmcutAssetKind): TmcutAsset {
    const path = normalizeMediaPath(inputPath)
    const pid = currentProject.value?.id
    const activeFolder = selectedFolderId.value && selectedFolderId.value !== '__unassigned__'
      ? selectedFolderId.value
      : null
    const asset: TmcutAsset = {
      id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind,
      name: mediaFileName(path),
      path,
      usedBy: currentProject.value ? [currentProject.value.id] : [],
      status: 'analyzing',
      meta: createEmptyTmcutAssetMeta(),
      thumbPath: null,
      filmstripPath: null,
      waveformPath: null,
      proxyPath: null,
      proxyStatus: 'none',
      folderId: activeFolder,
      addedAt: new Date().toISOString()
    }
    if (activeFolder && pid) {
      asset.folderByProject = { [pid]: activeFolder }
    }
    return asset
  }

  async function analyzeAsset(asset: TmcutAsset) {
    const ipc = tmcutIpc()
    try {
      if (!ipc || typeof ipc.analyzeAsset !== 'function') {
        // No ffprobe in the browser: everything that reaches this path is a
        // /uploads/ URL the page can load itself, so probe it with a media
        // element. Without this a web-imported clip lands on the timeline at
        // the 5s/10s default length instead of its real duration.
        if (asset.kind !== 'image') {
          const duration = await probeWebMedia(mediaUrl(asset.path), asset.kind)
          if (duration > 0) asset.meta.durationSec = Math.round(duration * 100) / 100
        }
        asset.status = 'ready'
        asset.meta.probedAt = new Date().toISOString()
        return
      }

      // Single IPC round-trip (Phase 3 ElectronMediaRuntime pipeline);
      // probe normalization stays renderer-side via @tmcut/core.
      const result = await ipc.analyzeAsset({ filePath: asset.path, kind: asset.kind })
      if (!result?.ok) {
        asset.status = 'missing'
        return
      }
      asset.meta.fileSize = result.stat?.size ?? 0
      asset.meta.mtimeMs = result.stat?.mtimeMs ?? 0

      if (asset.kind === 'image') {
        asset.thumbPath = asset.path
      } else {
        const meta = normalizeProbe(result.probe)
        if (meta && (meta.durationSec > 0 || meta.width > 0)) {
          asset.meta.durationSec = meta.durationSec
          asset.meta.width = meta.width
          asset.meta.height = meta.height
          asset.meta.fps = meta.fps
          // WebM audio-only (audio stream, no video stream) is the
          // container that trips up the `kind === 'video'` guess. Record
          // whether a video stream was actually found so routing to the
          // audio track is unambiguous.
          asset.meta.hasVideo = meta.width > 0
        }

        if (asset.kind === 'video' && result.thumbCachePath) {
          asset.thumbPath = result.thumbCachePath
          asset.filmstripPath = result.filmstripCachePath || null
        }
        // Waveform is kept for anything that carries audio: an
        // audio-only container arriving as `kind: 'video'` still gets its
        // strip (the controller extracts it from the probe, see R122).
        if (result.waveCachePath) {
          asset.waveformPath = result.waveCachePath
        }
      }

      asset.status = 'ready'
      asset.meta.probedAt = new Date().toISOString()
    } catch (error) {
      console.error('Media analysis failed:', asset.path, error)
      asset.status = 'error'
    }
  }

  async function importFiles(paths: string[]): Promise<{ added: number, duplicates: number, failed: number }> {
    importError.value = null
    // Global registry keyed by path. The library grid
    // only shows assets linked to the current project
    // (usedBy), so a file imported under another
    // project is invisible here but still matches the
    // dedup key — relink it (CapCut-style: one asset,
    // many projects) instead of rejecting it.
    const registry = new Map<string, TmcutAsset>()
    for (const a of assets.value) {
      const key = mediaFileKey(a.path)
      if (key && !registry.has(key)) registry.set(key, a)
    }
    const projectId = currentProject.value?.id
    const fresh: string[] = []
    const processed = new Set<string>()
    let duplicates = 0
    let relinked = 0
    for (const p of paths) {
      if (typeof p !== 'string') continue
      const key = mediaFileKey(p)
      if (!key || processed.has(key)) continue
      processed.add(key)
      const existing = registry.get(key)
      if (existing) {
        if (projectId && !existing.usedBy.includes(projectId)) {
          existing.usedBy.push(projectId)
          relinked++
        } else {
          duplicates++
        }
        continue
      }
      const kind = classifyAssetKind(p)
      if (!kind) continue
      fresh.push(p)
    }
    let added = relinked
    let failed = 0
    if (fresh.length > 0) {
      importing.value = true
      for (const p of fresh) {
        const kind = classifyAssetKind(p)
        if (!kind) continue
        const asset = buildAsset(p, kind)
        assets.value.unshift(asset)
        await analyzeAsset(asset)
        // 'error' (analysis threw) must not count as
        // success — surface it as a failed import.
        if (asset.status === 'missing' || asset.status === 'error') failed++
        else added++
      }
      importing.value = false
    }
    persistLibrary()
    return { added, duplicates, failed }
  }

  // Probe duration of a blob: URL via a temporary media element (web only).
  function probeWebMedia(url: string, kind: TmcutAssetKind): Promise<number> {
    return new Promise((resolve) => {
      try {
        const el = kind === 'audio' ? new Audio() : document.createElement('video')
        el.preload = 'metadata'
        el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0)
        el.onerror = () => resolve(0)
        el.src = url
        setTimeout(() => resolve(0), 15000)
      } catch {
        resolve(0)
      }
    })
  }

  // Capture a video frame as a dataURL thumbnail (web only, best-effort).
  // Blob: URLs are same-origin so the canvas stays untainted.
  function captureVideoThumb(url: string): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false
      const finish = (result: string | null) => {
        if (settled) return
        settled = true
        resolve(result)
      }
      try {
        const video = document.createElement('video')
        video.muted = true
        video.preload = 'auto'
        video.onloadeddata = () => {
          try {
            video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
          } catch {
            finish(null)
          }
        }
        video.onseeked = () => {
          try {
            const canvas = document.createElement('canvas')
            const scale = 320 / (video.videoWidth || 320)
            canvas.width = 320
            canvas.height = Math.max(2, Math.round((video.videoHeight || 180) * scale))
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              finish(null)
              return
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            finish(canvas.toDataURL('image/jpeg', 0.7))
          } catch {
            finish(null)
          }
        }
        video.onerror = () => finish(null)
        setTimeout(() => finish(null), 15000)
        video.src = url
      } catch {
        finish(null)
      }
    })
  }

  // Stream one file to the local Nitro server. Returns the /uploads/ URL the
  // server assigned.
  //
  // Uses the app's patched $fetch instead of raw fetch: that adds X-App-Id and
  // the bearer token, and its 401 handler refreshes the session. A token that
  // expires mid-session used to make an import fail outright with
  // `error.invalidToken` (raw fetch has no refresh/retry); now one retry after
  // the refresh recovers it. The Blob is re-readable, so the retry is safe.
  async function uploadWebFile(file: Blob, name: string): Promise<{ url: string, size: number }> {
    const post = () => $fetch<{ url?: string, size?: number }>(`/api/v1/media/upload?name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: file
    })
    let data: { url?: string, size?: number }
    try {
      data = await post()
    } catch (error) {
      const status = (error as { statusCode?: number, response?: { status?: number } }).statusCode
        ?? (error as { response?: { status?: number } }).response?.status
      if (status !== 401) throw error
      data = await post()
    }
    if (!data?.url) {
      throw new Error('upload response missing url')
    }
    return { url: data.url, size: data.size ?? file.size }
  }

  // Shared upload-then-thumbnail step (importWebFiles + web relink): a
  // captured data URL thumb becomes a durable /uploads/ copy too, falling
  // back to the inline data URL when the extra upload fails.
  async function uploadVideoThumb(file: File | Blob, dataUrl: string): Promise<string> {
    const blob = await dataUrlToBlob(dataUrl)
    if (blob) {
      try {
        const sourceName = 'name' in file && file.name ? file.name : 'thumb.jpg'
        const up = await uploadWebFile(blob, thumbNameFor(sourceName))
        return up.url
      } catch {
        // fall through to the inline thumbnail
      }
    }
    return dataUrl
  }

  // Web-runtime import: File objects are streamed to the local server and
  // referenced as /uploads/ URLs (durable across reloads — R152). Duration
  // probing and thumbnails still ride a temporary blob: URL, which is
  // revoked as soon as the upload in flight finishes.
  async function importWebFiles(files: File[]): Promise<TmcutAsset[]> {
    importError.value = null
    const created: TmcutAsset[] = []
    if (files.length === 0) return created
    importing.value = true
    webUpload.value = { done: 0, total: 0 }
    try {
      const seen = new Set(assets.value.map(a => `web:${a.name.toLowerCase()}:${a.meta.fileSize}`))
      const work: Array<{ file: File, kind: TmcutAssetKind }> = []
      for (const file of files) {
        const kind = classifyAssetKind(file.name)
        if (!kind) continue
        const fingerprint = `web:${file.name.toLowerCase()}:${file.size}`
        if (seen.has(fingerprint)) continue
        seen.add(fingerprint)
        work.push({ file, kind })
      }
      webUpload.value = { done: 0, total: work.length }
      for (const { file, kind } of work) {
        const blobUrl = URL.createObjectURL(file)
        try {
          // Upload and duration probe run in parallel so a large video does
          // not pay for the transfer and the probe one after the other.
          const [uploaded, duration] = await Promise.all([
            uploadWebFile(file, file.name),
            kind === 'image' ? Promise.resolve(0) : probeWebMedia(blobUrl, kind)
          ])
          const asset = buildAsset(uploaded.url, kind)
          asset.name = file.name
          asset.meta.fileSize = uploaded.size
          if (duration > 0) {
            asset.meta.durationSec = Math.round(duration * 100) / 100
          }
          if (kind === 'video') {
            // Push the captured cover frame to the server too so the
            // thumbnail survives reloads (the desktop pipeline keeps its
            // cover on disk; the web equivalent is another /uploads/ URL).
            const thumb = await captureVideoThumb(blobUrl)
            if (thumb) {
              asset.thumbPath = await uploadVideoThumb(file, thumb)
            }
          } else if (kind === 'image') {
            // Image assets point thumbPath at the source — mirrors the
            // desktop pipeline so the grid shows pixels, not the placeholder.
            asset.thumbPath = uploaded.url
          }
          asset.status = 'ready'
          asset.meta.probedAt = new Date().toISOString()
          assets.value.unshift(asset)
          created.push(asset)
        } catch (error) {
          console.error('Web media upload failed:', file.name, error)
          importError.value = error instanceof Error ? error.message : 'upload failed'
        } finally {
          URL.revokeObjectURL(blobUrl)
          if (webUpload.value) webUpload.value.done += 1
        }
      }
    } finally {
      importing.value = false
      webUpload.value = null
    }
    // Keep the registry (and any linked project) durable.
    persistLibrary()
    return created
  }

  /**
   * Import a remote output through the desktop download channel: main writes
   * the bytes to <base>/downloads/, then the normal import pipeline probes it
   * and builds the thumbnails. Returns the created/linked asset path.
   *
   * On the web runtime `importWebFiles` uploads the source itself, so
   * this remains a desktop-only download channel and refuses elsewhere.
   */
  async function downloadRemoteMedia(
    url: string,
    options: { filename?: string, id?: string } = {}
  ): Promise<{ ok: boolean, path?: string, error?: string }> {
    const ipc = tmcutIpc()
    if (!ipc?.downloadMedia) return { ok: false, error: 'desktop-only' }
    const downloaded = await ipc.downloadMedia({ url, filename: options.filename, id: options.id })
    if (!downloaded.ok || !downloaded.path) {
      return { ok: false, error: downloaded.error || 'download failed' }
    }
    // The registry is persisted as a whole — importing before it is loaded
    // would drop every existing asset from assets.json.
    await loadLibrary()
    await importFiles([downloaded.path])
    return { ok: true, path: normalizeMediaPath(downloaded.path) }
  }

  /** Cancel one in-flight download (no-op when the channel is unavailable). */
  async function cancelMediaDownload(id: string): Promise<boolean> {
    const ipc = tmcutIpc()
    if (!ipc?.cancelDownload) return false
    return ipc.cancelDownload(id)
  }

  /** Byte progress for downloads that were started with an id. */
  function onMediaDownloadProgress(
    callback: (payload: DownloadProgressPayload) => void
  ): () => void {
    const ipc = tmcutIpc()
    if (!ipc?.onDownloadProgress) return () => {}
    return ipc.onDownloadProgress(callback)
  }

  async function checkMissing() {
    const ipc = tmcutIpc()
    if (assets.value.length === 0 || import.meta.server) return
    // Web: no stat-files IPC — the /uploads/** stream route answers every
    // request the server stores, so a ranged GET is authoritative proof of
    // life. A plain HEAD is unreliable against the Nuxt dev server (it
    // short-circuits with cached 200s), while a ranged GET always runs the
    // real handler; Range keeps the transfer to a few bytes and no-store
    // skips the HTTP cache. Legacy desktop-path assets cannot be proven on
    // the web and stay in whatever status they already have.
    if (!ipc) {
      let changed = false
      const paths = new Set<string>()
      for (const asset of assets.value) {
        if (asset.status === 'analyzing') continue
        if (asset.path.startsWith('/uploads/')) paths.add(asset.path)
        if (asset.proxyPath && asset.proxyPath.startsWith('/uploads/')) paths.add(asset.proxyPath)
      }
      const existsByPath: Record<string, boolean> = {}
      await Promise.all([...paths].map(async (p) => {
        try {
          const res = await fetch(p, {
            headers: { Range: 'bytes=0-1' },
            cache: 'no-store'
          })
          existsByPath[p] = res.status >= 200 && res.status < 300
        } catch {
          existsByPath[p] = false
        }
      }))
      for (const asset of assets.value) {
        if (asset.status === 'analyzing') continue
        if (asset.path in existsByPath) {
          const exists = existsByPath[asset.path]
          if (exists && asset.status === 'missing') {
            asset.status = 'ready'
            changed = true
          } else if (!exists && asset.status !== 'missing') {
            asset.status = 'missing'
            changed = true
          }
        }
        if (asset.proxyPath && existsByPath[asset.proxyPath] === false) {
          asset.proxyPath = null
          asset.proxyStatus = 'none'
          changed = true
        }
      }
      if (changed) persistLibrary()
      return
    }
    try {
      const stats = await ipc.statFiles(assets.value.map(a => a.path))
      let changed = false
      for (const asset of assets.value) {
        if (asset.status === 'analyzing') continue
        const stat = stats[asset.path]
        const exists = !!stat?.exists
        if (exists && asset.status === 'missing') {
          asset.status = 'ready'
          changed = true
        } else if (!exists && asset.status !== 'missing') {
          asset.status = 'missing'
          changed = true
        }
      }

      // Verify proxy files still exist on disk
      const proxyPaths = assets.value.filter(a => !!a.proxyPath).map(a => a.proxyPath!)
      if (proxyPaths.length > 0) {
        const proxyStats = await ipc.statFiles(proxyPaths)
        for (const asset of assets.value) {
          if (asset.proxyPath && !proxyStats[asset.proxyPath]?.exists) {
            asset.proxyPath = null
            asset.proxyStatus = 'none'
            changed = true
          }
        }
      }
      // Cache-key migration (cover + filmstrip layout):
      // records analyzed under the retired schemes still
      // point at the old single-file thumbnail. Re-analyze
      // them so cover / filmstrip / waveform regenerate
      // under the current layout (one ffmpeg pass per
      // asset, then the names match and this becomes a
      // no-op).
      for (const asset of assets.value) {
        if (asset.status !== 'ready') continue
        const stat = stats[asset.path]
        if (!stat || !stat.exists) continue
        const key = fnv1aHex(`v2:${mediaFileKey(asset.path)}:${stat.mtimeMs}:${stat.size}`)
        if (asset.kind === 'video') {
          const coverName = asset.thumbPath?.split(/[\\/]/).pop()
          const stripName = asset.filmstripPath?.split(/[\\/]/).pop()
          const coverStale = !asset.thumbPath || coverName !== `${key}-cover.png`
          const stripStale = !asset.filmstripPath || stripName !== `${key}-strip.png`
          if (coverStale || stripStale) {
            asset.thumbPath = null
            asset.filmstripPath = null
            changed = true
            void analyzeAsset(asset).then(() => persistLibrary())
          }
        } else if (asset.kind === 'audio') {
          const waveName = asset.waveformPath?.split(/[\\/]/).pop()
          if (asset.waveformPath && waveName !== `${key}.json`) {
            asset.waveformPath = null
            changed = true
            void analyzeAsset(asset).then(() => persistLibrary())
          }
        }
      }
      if (changed) persistLibrary()
    } catch (error) {
      console.error('Failed to verify media files:', error)
    }
  }

  async function relink(assetId: string, newPath: string): Promise<boolean> {
    const asset = assets.value.find(a => a.id === assetId)
    if (!asset || typeof newPath !== 'string' || !newPath.trim()) return false
    const oldPath = asset.path
    const oldWaveformPath = asset.waveformPath
    const kind = classifyAssetKind(newPath)
    if (kind && kind !== asset.kind) {
      asset.kind = kind
      asset.thumbPath = null
      asset.filmstripPath = null
      asset.waveformPath = null
    }
    asset.path = normalizeMediaPath(newPath)
    asset.name = mediaFileName(asset.path)
    if (oldWaveformPath) {
      waveformCache.delete(oldWaveformPath)
    }
    if (currentProject.value) {
      updateClipsSrc(oldPath, asset.path)
    }
    await analyzeAsset(asset)
    persistLibrary()
    return asset.status === 'ready'
  }

  function removeAsset(assetId: string) {
    assets.value = assets.value.filter(a => a.id !== assetId)
    persistLibrary()
  }

  /** Link an asset to a project (marks "Added", persists registry). */
  function linkAssetToProject(assetId: string, projectId: string): boolean {
    const asset = assets.value.find(a => a.id === assetId)
    if (!asset) return false
    if (!asset.usedBy.includes(projectId)) {
      asset.usedBy.push(projectId)
      persistLibrary()
    }
    return true
  }

  /** `offset` places the clip at that time in SECONDS (drop on timeline);
   *  omitted = append at the end. `trackId` targets a specific compatible
   *  track. C16-R3: seconds are converted to store ticks at this boundary. */
  function addAssetToTimeline(assetId: string, options?: { offset?: number, trackId?: string }): boolean {
    const asset = assets.value.find(a => a.id === assetId)
    const project = currentProject.value
    if (!asset || !project) return false
    if (!asset.usedBy.includes(project.id)) {
      asset.usedBy.push(project.id)
    }
    // Audio-only containers (WebM without a video stream) must not land
    // on a video track — see effectiveAssetKind for the rule.
    const kind = effectiveAssetKind(asset)
    let duration: number
    if (kind === 'image') {
      duration = 5
    } else if (asset.meta.durationSec > 0) {
      duration = asset.meta.durationSec
    } else {
      duration = kind === 'audio' ? 5 : 10
    }
    const trackType = kind === 'audio' ? 'audio' : 'video'
    const clip = addClipToTrack(trackType, {
      name: asset.name,
      src: asset.path,
      in: 0,
      out: Math.round(secToTicks(duration)),
      speed: 1,
      offset: options?.offset === undefined ? undefined : Math.round(secToTicks(options.offset))
    }, options?.trackId)
    if (clip) persistLibrary()
    return !!clip
  }

  async function loadWaveform(asset: TmcutAsset): Promise<number[]> {
    if (!asset.waveformPath) return []
    const cached = waveformCache.get(asset.waveformPath)
    if (cached) return cached
    try {
      const res = await fetch(mediaUrl(asset.waveformPath))
      if (!res.ok) return []
      const data = (await res.json()) as { buckets?: unknown }
      const points = clampWaveformPoints(Array.isArray(data.buckets) ? (data.buckets as number[]) : [])
      waveformCache.set(asset.waveformPath, points)
      return points
    } catch {
      return []
    }
  }

  function getThumbUrl(asset: TmcutAsset): string {
    return asset.thumbPath ? mediaUrl(asset.thumbPath) : ''
  }

  function resolveMediaSrc(src?: string | null): string {
    if (!src) return ''
    if (proxyPreview.value) {
      const asset = findAssetBySrc(src)
      if (asset?.proxyPath && asset.proxyStatus === 'ready') {
        return mediaUrl(asset.proxyPath)
      }
    }
    return mediaUrl(src)
  }

  async function generateProxy(asset: TmcutAsset, width = 960): Promise<boolean> {
    if (asset.kind !== 'video' || asset.status === 'missing') return false
    const ipc = tmcutIpc()
    asset.proxyStatus = 'generating'
    asset.proxyPath = null
    // Web: the local Nitro server runs ffmpeg itself and stores the proxy
    // next to the uploads it streams — the same /uploads/ URL the media
    // library uses, so `mediaUrl` streams it with zero extra plumbing.
    if (!ipc || typeof ipc.generateProxy !== 'function') {
      try {
        const res = await $fetch<{ ok: boolean, path?: string, cached?: boolean }>('/api/v1/media/proxy', {
          method: 'POST',
          body: { path: asset.path, width }
        })
        if (res?.ok && res.path) {
          asset.proxyPath = res.path
          asset.proxyStatus = 'ready'
          persistLibrary()
          return true
        }
        asset.proxyStatus = 'error'
        persistLibrary()
        return false
      } catch (err) {
        console.error('generateProxy error:', err)
        asset.proxyStatus = 'error'
        persistLibrary()
        return false
      }
    }
    try {
      const res = await ipc.generateProxy({ filePath: asset.path, width })
      if (res?.ok && res.path) {
        asset.proxyPath = res.path
        asset.proxyStatus = 'ready'
        persistLibrary()
        return true
      }
      asset.proxyStatus = 'error'
      persistLibrary()
      return false
    } catch (err) {
      console.error('generateProxy error:', err)
      asset.proxyStatus = 'error'
      persistLibrary()
      return false
    }
  }

  function removeProxy(asset: TmcutAsset) {
    asset.proxyPath = null
    asset.proxyStatus = 'none'
    persistLibrary()
  }

  return {
    assets,
    projectAssets,
    missingAssets,
    analyzingCount,
    libraryLoaded,
    importing,
    importError,
    webUpload,
    isDesktop,
    proxyPreview,
    resolveMediaSrc,
    generateProxy,
    removeProxy,
    loadLibrary,
    persistLibrary,
    importFiles,
    importWebFiles,
    uploadWebFile,
    uploadVideoThumb,
    downloadRemoteMedia,
    cancelMediaDownload,
    onMediaDownloadProgress,
    probeWebMedia,
    captureVideoThumb,
    checkMissing,
    relink,
    removeAsset,
    linkAssetToProject,
    addAssetToTimeline,
    loadWaveform,
    getThumbUrl,
    mediaUrl,
    timelineSrcSet,
    findAssetBySrc,
    folders,
    projectFolders,
    selectedFolderId,
    folderCounts,
    folderTagColors: FOLDER_TAG_COLORS,
    createFolder: addFolder,
    renameFolder: editFolder,
    updateFolderColor: changeFolderColor,
    removeFolder: deleteFolder,
    moveAssetToFolder,
    getAssetFolderId
  }
}

// Dev/QA hook (R124): same pattern as useTmcutProject — lets the e2e
// harness seed the media library and assert drop behaviour. The web
// runtime self-heals on load (durable /uploads assets stay, stale blob:
// entries are dropped), so a browser-driven harness must push fixtures
// through this ref instead of localStorage.
if (import.meta.client && import.meta.dev && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>
  const qaStore = (w.tmcutQaStore || (w.tmcutQaStore = {})) as Record<string, unknown>
  qaStore.assets = assets
}
