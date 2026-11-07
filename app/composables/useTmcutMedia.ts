import { tmcutHostIpc } from '~/utils/tmcut/hostBridge'
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
import { assetFingerprint, assetStatusForImport, buildAssetRecord } from '~/utils/tmcut/assetImport'
import { decodePcm } from '~/utils/tmcut/audioDecode'
import { createWaveformService } from '~/utils/tmcut/waveformService'
import {
  byteCacheInfo,
  clearCachedBytes,
  pruneByteCache,
  putCachedBytes,
  readCachedBytes,
  type TmcutByteCacheInfo
} from '~/utils/tmcut/byteStore'
import { readStoredFlag, writeStored } from '~/utils/tmcut/localStore'
import { withThrowawayMedia } from '~/utils/tmcut/mediaElement'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { toURL } from '~/utils/ffmpegHelper'
import {
  cacheKeyForPath,
  mediaInfoToMetadata,
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

} from 'tmcut-core'
import type { TmcutImportStatus, TmcutMediaInfo } from 'tmcut-core'

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
// What the browser byte store currently holds, for the library panel.
const byteCache = ref<TmcutByteCacheInfo>({ backend: 'none', available: false, entries: 0, usedBytes: 0, budgetBytes: 0 })

if (import.meta.client && typeof window !== 'undefined') {
  proxyPreview.value = readStoredFlag(PROXY_PREVIEW_KEY, true)
  watch(proxyPreview, (v) => {
    writeStored(PROXY_PREVIEW_KEY, v ? '1' : '0')
  })
}

// The bars this page already drew, keyed by the revision they describe. A relink
// changes the revision, so the row for the old one is not the answer anymore.
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

// ===== Client byte cache (slice C2b, ADR-033) =====
// On the web runtime the server copy was the only place the editor had read
// bytes from so far, and a dev-server restart or a cleared uploads folder takes
// it away. So an import also keeps a copy in the browser, under the revision the
// asset record already carries. It is read back now: thumbnails (slice D2),
// silence (E4) and the waveform bars below (G2) each ask the cache before they
// ask a decoder or a URL, which is the evidence ADR-033 waits for. The byte
// axis stays owned by checkMissing until a reader makes the copy authoritative.
function liveByteKeys(): Set<string> {
  // A fingerprint names one revision of one file, so the library's own records
  // are the only proof the cache has that a copy is still wanted.
  return new Set(assets.value.map(a => a.fingerprint).filter((key): key is string => !!key))
}

// The one waveform service the app shares, handed the library it must keep alive:
// writing bars runs the eviction law, and a narrower set would delete the cache
// it is writing into (slice G2).
const waveformService = createWaveformService(decodePcm, liveByteKeys)

async function refreshByteCache() {
  byteCache.value = await byteCacheInfo()
}

/** Copy one asset's bytes under the revision its record carries. */
async function cacheAssetBytes(asset: TmcutAsset, bytes: Blob): Promise<void> {
  if (!asset.fingerprint) return
  await putCachedBytes(asset.fingerprint, bytes, liveByteKeys())
  await refreshByteCache()
}

/**
 * The cache's answer for one authored path, as the export's two legs want it
 * (slice H3d-6, §53.12). A path the library does not name, a record with no
 * revision, or a revision the browser reclaimed all answer `null` — the legs then
 * read the location, because a thin cache is not a missing file.
 */
async function bytesForAsset(src: string): Promise<Blob | null> {
  const fingerprint = assetKeyIndex.value.get(mediaFileKey(src))?.fingerprint
  if (!fingerprint) return null
  return readCachedBytes(fingerprint)
}

async function clearMediaByteCache() {
  await clearCachedBytes()
  // The in-memory rows are a convenience over the store, so they die with it —
  // otherwise a cleared cache would still draw the bars it just forgot.
  waveformCache.clear()
  await refreshByteCache()
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

  const isDesktop = computed(() => !!tmcutHostIpc())

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
    const ipc = tmcutHostIpc()
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
      // Opening the library is the reconcile point: a delete or a relink that
      // happened in another session left bytes behind that nothing names now.
      await pruneByteCache(liveByteKeys())
      await refreshByteCache()
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
    const ipc = tmcutHostIpc()
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
    const pid = currentProject.value?.id
    const activeFolder = selectedFolderId.value && selectedFolderId.value !== '__unassigned__'
      ? selectedFolderId.value
      : null
    return buildAssetRecord({ path: inputPath, kind, projectId: pid, folderId: activeFolder })
  }

  /**
   * The web answer: one demuxer probe over the stored file, core's verdict on
   * top of it. A still has no container to take apart, so it is not probed
   * here — the durable upload is the whole answer, and whether this runtime can
   * paint it is a slice-D question.
   */
  async function probeAssetInfo(asset: TmcutAsset): Promise<TmcutMediaInfo | null> {
    if (asset.kind === 'image') return null
    const { probeMedia } = await import('~/utils/tmcut/mediaProbe')
    return probeMedia({
      name: asset.name,
      url: mediaUrl(asset.path),
      size: asset.meta.fileSize || undefined,
      kind: asset.kind
    })
  }

  /** The same collector over bytes a picker just handed over, before any URL exists. */
  async function probePickedFile(file: Blob, name: string, kind: TmcutAssetKind): Promise<TmcutMediaInfo> {
    const { probeMedia } = await import('~/utils/tmcut/mediaProbe')
    return probeMedia({ blob: file, name, size: file.size, kind })
  }

  /** MediaInfo is what both hosts will answer with after slice I. */
  function applyMediaInfo(asset: TmcutAsset, info: TmcutMediaInfo | null) {
    if (info) {
      const meta = mediaInfoToMetadata(info)
      if (meta) {
        if (meta.durationSec > 0) asset.meta.durationSec = Math.round(meta.durationSec * 100) / 100
        if (meta.width > 0) {
          asset.meta.width = meta.width
          asset.meta.height = meta.height
        }
        if (meta.fps > 0) asset.meta.fps = meta.fps
        if (info.compatibility.canDemux) asset.meta.hasVideo = meta.width > 0
      }
    }
    asset.fingerprint = assetFingerprint(asset.path, asset.meta)
  }

  function applyVerdict(asset: TmcutAsset, importStatus: TmcutImportStatus) {
    asset.importStatus = importStatus
    asset.status = assetStatusForImport(importStatus)
    asset.meta.probedAt = new Date().toISOString()
  }

  async function analyzeAsset(asset: TmcutAsset) {
    const ipc = tmcutHostIpc()
    asset.importStatus = 'probing'
    try {
      if (!ipc || typeof ipc.analyzeAsset !== 'function') {
        const info = await probeAssetInfo(asset)
        applyMediaInfo(asset, info)
        // A still's cover is the source itself, the same answer the desktop
        // branch gives; the library streams it from the durable upload.
        if (asset.kind === 'image') asset.thumbPath = asset.path
        applyVerdict(asset, info ? info.importStatus : 'ready')
        return
      }

      // Single IPC round-trip (Phase 3 ElectronMediaRuntime pipeline);
      // probe normalization stays renderer-side via tmcut-core.
      const result = await ipc.analyzeAsset({ filePath: asset.path, kind: asset.kind })
      if (!result?.ok) {
        // Nothing to read: the byte axis owns "missing", the probe axis only
        // records that this attempt learned nothing.
        asset.importStatus = 'error'
        asset.status = 'missing'
        asset.fingerprint = null
        return
      }
      asset.meta.fileSize = result.stat?.size ?? 0
      asset.meta.mtimeMs = result.stat?.mtimeMs ?? 0

      let learned = asset.kind === 'image'
      if (asset.kind === 'image') {
        asset.thumbPath = asset.path
      } else {
        const meta = normalizeProbe(result.probe)
        learned = !!meta && (meta.durationSec > 0 || meta.width > 0)
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

      asset.fingerprint = assetFingerprint(asset.path, asset.meta)
      applyVerdict(asset, learned ? 'ready' : 'error')
    } catch (error) {
      console.error('Media analysis failed:', asset.path, error)
      asset.importStatus = 'error'
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
      // The whole queue lands before the first probe starts, so a 40-file
      // batch reads as 40 queued cards instead of appearing one at a time.
      const queue: TmcutAsset[] = []
      for (const p of fresh) {
        const kind = classifyAssetKind(p)
        if (!kind) continue
        const asset = buildAsset(p, kind)
        assets.value.unshift(asset)
        queue.push(asset)
      }
      for (const asset of queue) {
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

  // Capture a video frame as a dataURL thumbnail (web only, best-effort).
  // Blob: URLs are same-origin so the canvas stays untainted.
  function captureVideoThumb(url: string): Promise<string | null> {
    return withThrowawayMedia<string>('video', (video, settle) => {
      video.muted = true
      video.preload = 'auto'
      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.5, (video.duration || 1) / 2)
        } catch {
          settle(null)
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
            settle(null)
            return
          }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          settle(canvas.toDataURL('image/jpeg', 0.7))
        } catch {
          settle(null)
        }
      }
      video.onerror = () => settle(null)
      video.src = url
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
        // Dedup key, not the cache fingerprint: a re-upload lands on a fresh
        // /uploads/ name, so only the picked file's own identity repeats.
        const dedupeKey = `web:${file.name.toLowerCase()}:${file.size}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        work.push({ file, kind })
      }
      webUpload.value = { done: 0, total: work.length }
      for (const { file, kind } of work) {
        const blobUrl = URL.createObjectURL(file)
        try {
          // Upload and probe run in parallel so a large video does not pay for
          // the transfer and the demux one after the other. The probe reads the
          // picked bytes: a File has no playable location until the upload
          // lands, and the demuxer does not need one.
          const [uploaded, info] = await Promise.all([
            uploadWebFile(file, file.name),
            kind === 'image' ? Promise.resolve(null) : probePickedFile(file, file.name, kind)
          ])
          const asset = buildAsset(uploaded.url, kind)
          asset.name = file.name
          asset.meta.fileSize = uploaded.size
          applyMediaInfo(asset, info)
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
          applyVerdict(asset, info ? info.importStatus : 'ready')
          assets.value.unshift(asset)
          created.push(asset)
          // The library keeps its own copy of what the user just handed over,
          // so the next session can still read this revision off the machine.
          await cacheAssetBytes(asset, file)
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
    const ipc = tmcutHostIpc()
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
    const ipc = tmcutHostIpc()
    if (!ipc?.cancelDownload) return false
    return ipc.cancelDownload(id)
  }

  /** Byte progress for downloads that were started with an id. */
  function onMediaDownloadProgress(
    callback: (payload: DownloadProgressPayload) => void
  ): () => void {
    const ipc = tmcutHostIpc()
    if (!ipc?.onDownloadProgress) return () => {}
    return ipc.onDownloadProgress(callback)
  }

  async function checkMissing() {
    const ipc = tmcutHostIpc()
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
        const key = cacheKeyForPath(asset.path, { mtimeMs: stat.mtimeMs, size: stat.size })
        if (asset.fingerprint !== key) {
          // New bytes: every answer measured on the old revision is a
          // description of a file that is no longer here — the in-memory bars
          // included, since they are keyed by that revision (slice G2).
          waveformCache.delete(String(asset.fingerprint ?? ''))
          asset.fingerprint = key
          changed = true
        }
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
        } else if (asset.kind === 'audio' && asset.waveformPath) {
          // The strip is the browser's answer now, read from the client cache
          // under the revision's own artifact key, so this pointer to a file the
          // FFmpeg controller wrote is only a stale path. Dropping it loses
          // nothing: no re-analysis is queued for audio.
          const waveName = asset.waveformPath.split(/[\\/]/).pop()
          if (waveName !== `${key}.json`) {
            asset.waveformPath = null
            changed = true
          }
        }
      }
      if (changed) persistLibrary()
    } catch (error) {
      console.error('Failed to verify media files:', error)
    }
  }

  /**
   * Point a dead asset at new bytes and re-learn everything. `source` carries
   * what only the picker knows on the web runtime — the friendly file name and
   * the byte size the probe and the cache key are built from.
   */
  async function relink(
    assetId: string,
    newPath: string,
    source: { name?: string, size?: number } = {}
  ): Promise<boolean> {
    const asset = assets.value.find(a => a.id === assetId)
    if (!asset || typeof newPath !== 'string' || !newPath.trim()) return false
    const oldPath = asset.path
    const oldFingerprint = asset.fingerprint
    const kind = classifyAssetKind(newPath)
    if (kind) asset.kind = kind
    // New bytes: everything the last probe learned about the old file goes with
    // it — derived pointers included, or a relinked clip would keep playing
    // (and measuring) the file it no longer points at.
    asset.meta = createEmptyTmcutAssetMeta()
    asset.thumbPath = null
    asset.filmstripPath = null
    asset.waveformPath = null
    asset.proxyPath = null
    asset.proxyStatus = 'none'
    asset.fingerprint = null
    asset.path = normalizeMediaPath(newPath)
    asset.name = typeof source.name === 'string' && source.name ? source.name : mediaFileName(asset.path)
    if (typeof source.size === 'number' && source.size > 0) asset.meta.fileSize = source.size
    if (oldFingerprint) {
      // The revision changed, so the bars measured on the old bytes describe a
      // file this asset no longer points at. The cached artifact under the old
      // fingerprint is freed by the next prune: the library stopped naming it.
      waveformCache.delete(oldFingerprint)
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

  /**
   * The bars of one asset, from the browser: the client cache is asked first and
   * the PCM decoder only answers when it has nothing (slice G2). `[]` means there
   * is nothing to draw — a file with no audio track, a host with no decoder, a
   * revision with no fingerprint — and the caller keeps its placeholder.
   */
  async function loadWaveform(asset: TmcutAsset): Promise<number[]> {
    const remembered = waveformCache.get(asset.fingerprint ?? '')
    if (remembered) return remembered
    const peaks = await waveformService.load({
      fingerprint: asset.fingerprint,
      src: asset.fingerprint ? mediaUrl(asset.path) : null,
      durationSec: asset.meta.durationSec
    })
    if (peaks === null) return []
    waveformCache.set(String(asset.fingerprint), peaks)
    // A first-time load writes an artifact into the store, and this service is
    // the only writer that does — so the panel's "what the browser holds" row
    // is told about it here rather than waiting for the next library open.
    await refreshByteCache()
    return peaks
  }

  function getThumbUrl(asset: TmcutAsset): string {
    return asset.thumbPath ? mediaUrl(asset.thumbPath) : ''
  }

  /**
   * Which FILE a surface plays: the ready proxy when the toggle is on, the stored
   * src otherwise. `resolveMediaSrc` builds its URL from this answer, and slice
   * G4b asks the byte cache with it — so a proxy swap can never be keyed as the
   * original revision it stands in for.
   */
  function resolvePlayPath(src?: string | null): string {
    if (!src) return ''
    if (proxyPreview.value) {
      const asset = findAssetBySrc(src)
      if (asset?.proxyPath && asset.proxyStatus === 'ready') return asset.proxyPath
    }
    return src
  }

  function resolveMediaSrc(src?: string | null): string {
    const path = resolvePlayPath(src)
    return path ? mediaUrl(path) : ''
  }

  async function generateProxy(asset: TmcutAsset, width = 960): Promise<boolean> {
    if (asset.kind !== 'video' || asset.status === 'missing') return false
    const ipc = tmcutHostIpc()
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
    resolvePlayPath,
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
    captureVideoThumb,
    checkMissing,
    byteCache,
    clearMediaByteCache,
    cacheAssetBytes,
    bytesForAsset,
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
