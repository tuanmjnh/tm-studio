<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { TmcutAsset, TmcutMediaFolder } from '~/types/tmcut'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutRecorder } from '~/composables/useTmcutRecorder'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutUiPrefs } from '~/composables/useTmcutUiPrefs'
import { useAgentProposalCount } from '~/composables/useTmcutAgentTools'
import { useMcpRendererBridge } from '~/composables/useMcpRendererBridge'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutTemplates } from '~/composables/useTmcutTemplates'
import { formatDurationSec, formatFileSize, mediaFileKey } from '~/utils/tmcut/media'
import { TMCUT_ASSET_MIME } from '~/utils/tmcut/dnd'
import type { TmcutAssetDragPayload } from '~/utils/tmcut/dnd'
import { TMUTCANVAS_PRESETS, TMUTCUT_SOCIAL_PRESETS, findCanvasPreset, findCanvasPresetByDimensions, ratioLabel, canvasFpsValue, normalizeCanvas } from '~/utils/tmcut/canvas'
import { filterAssetsByFolder, secToTicks, TICKS_PER_SECOND, instantiateTemplate } from '@tmcut-core'
import { clipDurationSec } from '~/utils/tmcut/clipTime'
import { effectiveAssetKind } from '~/utils/tmcut/assetKind'
import { parseTemplateFile } from '~/utils/tmcut/templateIo'
import type { TmcutTrack } from '~/composables/useTmcutProject'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const {
  currentProject,
  contentDuration,
  loadProject,
  saveProject,
  saveStatus,
  lastSavedAt,
  pendingRecovery,
  snapshots,
  applyRecovery,
  dismissRecovery,
  refreshProjects,
  loadSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  switchCanvas,
  setCanvasBackground,
  duplicateAsProject,
  addClipToTrack,
  pushHistory,
  revisionAtLoad,
  currentRevision
} = useTmcutProject()

const {
  projectAssets,
  missingAssets,
  analyzingCount,
  importing,
  importError,
  webUpload,
  isDesktop,
  generateProxy,
  loadLibrary,
  persistLibrary,
  importFiles,
  importWebFiles,
  uploadWebFile,
  uploadVideoThumb,
  probeWebMedia,
  captureVideoThumb,
  checkMissing,
  relink,
  removeAsset,
  addAssetToTimeline,
  loadWaveform,
  getThumbUrl,
  timelineSrcSet,
  findAssetBySrc,
  projectFolders,
  selectedFolderId,
  folderCounts,
  folderTagColors,
  createFolder,
  renameFolder,
  updateFolderColor,
  removeFolder,
  moveAssetToFolder,
  getAssetFolderId
} = useTmcutMedia()

const { playhead, formatTimecode } = useTmcutPlayback()
const { shortcutsOpen } = useTmcutUiPrefs()

// Hardware status chip (design #2 "GPU" indicator — honest data only):
// WebGPU availability is really detectable; the engine side names the
// export backend (FFmpeg on desktop, preview-only on the web).
const hasWebGPU = ref(false)
const hardwareLabel = computed(() => {
  const gpu = hasWebGPU.value ? 'WebGPU' : 'WebGL'
  return `${gpu} · ${isDesktop.value ? 'FFmpeg' : t('tmcut.workspace.previewOnly')}`
})

// Status footer data: total timeline clip count
const clipCount = computed(() => (
  (currentProject.value?.timeline?.tracks || [])
    .reduce((n, track) => n + (track.items?.length || 0), 0)
))

const { pickFile, pickWebFiles } = useFileSystem()
const { activeJobsCount, queueModalOpen } = useTmcutExportQueue()
const toast = useToast()

// MCP renderer bridge (Phase 6: forwarded tool calls + job-status events).
// MUST be called during setup. The composable body calls useToast() (which
// inject()s) and registers onBeforeUnmount(teardown); invoking it from an
// async onMounted AFTER an await loses the instance context, so inject()
// warned and — worse — the teardown never registered, leaking one IPC
// listener per editor mount. Resolves during setup, like every composable
// above (R148).
useMcpRendererBridge()

const projectId = computed(() => (route.query.project as string) || 'default')
const showExportModal = ref(false)
const voiceStudioOpen = ref(false)
const showSnapshotModal = ref(false)
const showCustomCanvasModal = ref(false)
const compactPanel = ref<'media' | 'inspector' | null>(null)
const thumbErrors = ref<Record<string, boolean>>({})
const waveformMap = ref<Record<string, number[]>>({})

const mediaFilters = [
  { name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'wmv', 'flv'] },
  { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus'] },
  { name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'gif'] }
]

const saveLabel = computed(() => {
  if (saveStatus.value === 'saving') return t('tmcut.save.saving')
  if (saveStatus.value === 'saved') return t('tmcut.save.saved')
  if (saveStatus.value === 'error') return t('tmcut.save.error')
  return ''
})

// Direct file preview state
const previewModalOpen = ref(false)
const previewFilePath = ref('')
const previewFileTitle = ref('')

// ===== Media Library Tabs (CapCut-style top category bar) =====

type MediaTabId = 'media' | 'video' | 'audio' | 'image' | 'text' | 'stickers' | 'effects' | 'transitions' | 'filters' | 'assets' | 'stock'

const mediaTab = ref<MediaTabId>('media')

// R120 (mock #2 subtab bar): Effects / Transitions / Filters are full tabs
// now (the fx library renders the matching category directly), replacing
// the old single "More" aggregate.
const mediaTabs = computed(() => [
  { id: 'media', label: t('tmcut.tabs.media'), icon: 'i-lucide-layout-grid' },
  { id: 'video', label: t('tmcut.tabs.video'), icon: 'i-lucide-film' },
  { id: 'audio', label: t('tmcut.tabs.audio'), icon: 'i-lucide-music' },
  { id: 'image', label: t('tmcut.tabs.image'), icon: 'i-lucide-image' },
  { id: 'text', label: t('tmcut.tabs.text'), icon: 'i-lucide-type' },
  // R124 A6 (CapCut §3.4): emoji sticker layers.
  { id: 'stickers', label: t('tmcut.tabs.stickers'), icon: 'i-lucide-sticker' },
  { id: 'effects', label: t('tmcut.tabs.effects'), icon: 'i-lucide-sparkles' },
  { id: 'transitions', label: t('tmcut.tabs.transitions'), icon: 'i-lucide-shapes' },
  { id: 'filters', label: t('tmcut.tabs.filters'), icon: 'i-lucide-palette' },
  // Roadmap v3 PART A: on-demand Asset Center (download when needed).
  { id: 'assets', label: t('tmcut.tabs.assets'), icon: 'i-lucide-store' },
  // Free-for-commercial stock media: Openverse (keyless) + Pexels/Pixabay.
  { id: 'stock', label: t('tmcut.tabs.stock'), icon: 'i-lucide-globe' }
] as Array<{ id: MediaTabId, label: string, icon: string }>)

const isAssetTab = computed(() => ['media', 'video', 'audio', 'image'].includes(mediaTab.value))

// The fx library prop (the v-else-if only mounts it for the three fx
// tabs; the map keeps the template cast-free and exhaustive for vue-tsc).
const fxTabProp = computed<'effects' | 'transitions' | 'filters'>(() => (
  mediaTab.value === 'transitions' ? 'transitions' : mediaTab.value === 'filters' ? 'filters' : 'effects'
))

// Library search box (design #2): filter visible assets by name
const assetSearch = ref('')
const mediaScrollRef = ref<HTMLDivElement | null>(null)

const filteredAssets = computed(() => {
  // Kind tabs filter by the EFFECTIVE kind, so an audio-only container is
  // listed under Audio (where it can actually be used), not under Video.
  const base = mediaTab.value === 'media'
    ? projectAssets.value
    : projectAssets.value.filter(a => effectiveAssetKind(a) === mediaTab.value)
  const byFolder = filterAssetsByFolder(base, selectedFolderId.value, currentProject.value?.id)
  const q = assetSearch.value.trim().toLowerCase()
  if (!q) return byFolder
  return byFolder.filter(a => (a.name || '').toLowerCase().includes(q))
})

// R120: progressive rendering for the media bin. A project can import
// hundreds of assets; mounting every card (thumb <img> + hover actions)
// at once stalls the panel. Render the first slice and extend it while
// the shared scroll container nears the bottom — cheap, layout-stable.
const BIN_SLICE = 120
const binRenderCount = ref(BIN_SLICE)
const mediaView = ref<'grid' | 'list'>('grid')
const visibleAssets = computed(() => filteredAssets.value.slice(0, binRenderCount.value))
watch([filteredAssets, selectedFolderId, assetSearch], () => {
  binRenderCount.value = BIN_SLICE
})
function onMediaBinScroll() {
  const el = mediaScrollRef.value
  if (!el) return
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 400 && binRenderCount.value < filteredAssets.value.length) {
    binRenderCount.value += BIN_SLICE
  }
}

// ===== Folder / Album Management (Roadmap G-3) =====
const createFolderModalOpen = ref(false)
const newFolderName = ref('')
const newFolderColor = ref(folderTagColors[0])

const editFolderModalOpen = ref(false)
const editingFolderId = ref<string | null>(null)
const editingFolderName = ref('')
const editingFolderColor = ref(folderTagColors[0])

const moveAssetModalOpen = ref(false)
const targetMoveAsset = ref<TmcutAsset | null>(null)

function openCreateFolderModal() {
  newFolderName.value = ''
  newFolderColor.value = folderTagColors[0]
  createFolderModalOpen.value = true
}

function handleCreateFolder() {
  const name = newFolderName.value.trim()
  if (!name) return
  const created = createFolder(name, newFolderColor.value)
  selectedFolderId.value = created.id
  createFolderModalOpen.value = false
  toast.add({
    title: t('tmcut.folders.created', { name: created.name }),
    color: 'success'
  })
}

function openEditFolderModal(folder: TmcutMediaFolder) {
  editingFolderId.value = folder.id
  editingFolderName.value = folder.name
  editingFolderColor.value = folder.color || folderTagColors[0]
  editFolderModalOpen.value = true
}

function handleEditFolder() {
  if (!editingFolderId.value) return
  const name = editingFolderName.value.trim()
  if (!name) return
  renameFolder(editingFolderId.value, name)
  updateFolderColor(editingFolderId.value, editingFolderColor.value || folderTagColors[0] || '#3b82f6')
  editFolderModalOpen.value = false
  toast.add({
    title: t('tmcut.folders.renamed', { name }),
    color: 'success'
  })
}

function handleDeleteFolder(folder: TmcutMediaFolder) {
  const name = folder.name
  removeFolder(folder.id)
  toast.add({
    title: t('tmcut.folders.deleted', { name }),
    color: 'neutral'
  })
}

function openMoveAssetModal(asset: TmcutAsset) {
  targetMoveAsset.value = asset
  moveAssetModalOpen.value = true
}

function handleMoveAsset(assetId: string, folderId: string | null) {
  moveAssetToFolder(assetId, folderId)
  moveAssetModalOpen.value = false
  const targetFolder = projectFolders.value.find(f => f.id === folderId)
  toast.add({
    title: folderId && targetFolder
      ? t('tmcut.folders.moved', { folder: targetFolder.name })
      : t('tmcut.folders.removedFromFolder'),
    color: 'success'
  })
}

function folderActionItems(folder: TmcutMediaFolder) {
  return [
    [
      {
        label: t('tmcut.folders.rename'),
        icon: 'i-lucide-pencil',
        onSelect: () => openEditFolderModal(folder)
      },
      {
        label: t('tmcut.folders.delete'),
        icon: 'i-lucide-trash',
        color: 'error' as const,
        onSelect: () => handleDeleteFolder(folder)
      }
    ]
  ]
}

function onFolderDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'move'
  }
}

function onFolderDrop(e: DragEvent, folderId: string | null) {
  e.preventDefault()
  const raw = e.dataTransfer?.getData(TMCUT_ASSET_MIME)
  if (!raw) return
  try {
    const payload = JSON.parse(raw) as { id: string }
    if (payload?.id) {
      handleMoveAsset(payload.id, folderId)
    }
  } catch (error) {
    console.debug('Invalid asset drop data:', error)
  }
}

function getFolderBadge(asset: TmcutAsset): TmcutMediaFolder | undefined {
  const fid = getAssetFolderId(asset)
  if (!fid) return undefined
  return projectFolders.value.find(f => f.id === fid)
}

function isAssetOnTimeline(asset: TmcutAsset): boolean {
  return timelineSrcSet.value.has(mediaFileKey(asset.path))
}

function assetDurationLabel(asset: TmcutAsset): string {
  return asset.meta.durationSec > 0 ? formatDurationSec(asset.meta.durationSec) : ''
}

// Text style presets for the Text tab (CapCut-style text presets)
const textPresets = computed(() => [
  { id: 'title', name: t('tmcut.textPresets.titleName'), text: t('tmcut.textPresets.titleText'), fontSize: 56, color: '#ffffff' },
  { id: 'subtitle', name: t('tmcut.textPresets.subtitleName'), text: t('tmcut.textPresets.subtitleText'), fontSize: 36, color: '#ffffff' },
  { id: 'caption', name: t('tmcut.textPresets.captionName'), text: t('tmcut.textPresets.captionText'), fontSize: 26, color: '#fde047' }
])

function handleAddTextPreset(preset: { text: string, fontSize: number, color: string }) {
  const clip = addClipToTrack('text', {
    name: preset.text,
    text: preset.text,
    in: 0,
    out: 4 * TICKS_PER_SECOND,
    offset: Math.round(secToTicks(playhead.value)),
    fontSize: preset.fontSize,
    color: preset.color
  })
  if (clip) {
    toast.add({ title: t('tmcut.timelineActions.textAdded'), color: 'success' })
  }
}

// ===== Media Library =====

async function handleImportMedia() {
  if (!isDesktop.value) {
    try {
      const files = await pickWebFiles(mediaFilters.flatMap(group => group.extensions), true)
      if (files.length === 0) return
      const added = await importWebFiles(files)
      if (added.length > 0) {
        toast.add({ title: `${t('global.success')}: ${added.length}`, color: 'success' })
      }
      // A rejected upload (server down, size cap, unsupported type) is
      // surfaced even when sibling files succeeded.
      if (importError.value) {
        toast.add({ title: t('tmcut.media.uploadFailed'), color: 'error' })
      }
    } catch (error) {
      console.error('Media import failed:', error)
      toast.add({ title: t('tmcut.media.importFailed'), color: 'error' })
    }
    return
  }
  try {
    const picked = await pickFile({
      title: t('tmcut.media.import'),
      filters: mediaFilters,
      multiSelections: true
    })
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : []
    if (paths.length === 0) return
    const result = await importFiles(paths)
    if (result.added > 0) {
      // toast.add({ title: `${t('global.success')}: ${result.added}`, color: 'success' })
    }
    if (result.duplicates > 0) {
      toast.add({ title: t('tmcut.media.alreadyInLibrary'), color: 'info' })
    }
    if (result.failed > 0) {
      toast.add({ title: t('tmcut.media.analysisFailed'), color: 'error' })
    }
  } catch (error) {
    console.error('Media import failed:', error)
    toast.add({ title: t('tmcut.media.importFailed'), color: 'error' })
  }
}

// Canvas background image (roadmap Phase 4): the DSL + exporter already
// support `{ type: 'image' }` (R76); this picks the file. Desktop stores
// the absolute path (media:// resolves it at play/export time); web mode
// keeps an object URL for the session, same as web-imported assets.
async function handlePickBackgroundImage() {
  const imageFilters = [mediaFilters[2]!]
  try {
    if (!isDesktop.value) {
      const files = await pickWebFiles(imageFilters.flatMap(g => g.extensions), false)
      const file = files[0]
      if (!file) return
      // Upload it so the background is a durable /uploads/ URL: a blob: URL
      // dies on reload AND the server-side renderer cannot read it, so a web
      // export with an image background would fail.
      const uploaded = await uploadWebFile(file, file.name)
      setCanvasBackground('image', uploaded.url)
      return
    }
    const picked = await pickFile({ title: t('tmcut.canvas.bgImage'), filters: imageFilters })
    const path = Array.isArray(picked) ? picked[0] : picked
    if (!path) return
    setCanvasBackground('image', path)
  } catch (error) {
    console.error('Background image pick failed:', error)
    toast.add({ title: t('tmcut.canvas.bgImageFailed'), color: 'error' })
  }
}

// ===== Voiceover recording (roadmap D-4) =====
// Mic button in the media bin header: getUserMedia + MediaRecorder
// (web + desktop); the blob lands through the normal import pipeline
// (desktop writes a real file via IPC — FFmpeg export needs paths).
const {
  recording: recordingVoiceover,
  saving: savingVoiceover,
  elapsedSec: voiceoverElapsed,
  start: startVoiceover,
  stop: stopVoiceover
} = useTmcutRecorder()

async function handleVoiceoverToggle() {
  if (recordingVoiceover.value) {
    const result = await stopVoiceover()
    if (result.discarded) {
      toast.add({ title: t('tmcut.media.voiceoverDiscarded'), color: 'warning' })
    } else if (result.failed > 0 || result.added === 0) {
      toast.add({ title: t('tmcut.media.voiceoverFailed'), color: 'error' })
    } else {
      toast.add({ title: t('tmcut.media.voiceoverAdded', { n: result.added }), color: 'success' })
    }
    return
  }
  const started = await startVoiceover()
  if (!started) {
    toast.add({ title: t('tmcut.media.voiceoverDenied'), color: 'warning' })
  }
}

function formatVoiceoverTime(sec: number): string {
  const whole = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
}

// ===== External file drop (roadmap G-2) =====
// Explorer/Finder → media library panel. Internal asset drags carry no
// 'Files' type (the grid owns those), so they fall through untouched;
// non-media files filter out inside importFiles / importWebFiles via
// classifyAssetKind. dragenter/leave bubble per child element, so a
// depth counter keeps the highlight stable across the panel.
const dropActive = ref(false)
let dropDepth = 0

function isFileDrag(e: DragEvent) {
  return !!e.dataTransfer?.types.includes('Files')
}

function onMediaPanelDragEnter(e: DragEvent) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  dropDepth += 1
  dropActive.value = true
}

function onMediaPanelDragOver(e: DragEvent) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  e.dataTransfer!.dropEffect = 'copy'
}

function onMediaPanelDragLeave() {
  dropDepth = Math.max(0, dropDepth - 1)
  if (dropDepth === 0) dropActive.value = false
}

async function onMediaPanelDrop(e: DragEvent) {
  if (!isFileDrag(e)) return
  e.preventDefault()
  dropDepth = 0
  dropActive.value = false
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  try {
    if (!isDesktop.value) {
      const added = await importWebFiles(files)
      if (added.length > 0) {
        toast.add({ title: `${t('global.success')}: ${added.length}`, color: 'success' })
      } else {
        toast.add({ title: t('tmcut.media.dropNoMedia'), color: 'warning' })
      }
      return
    }
    const paths = files
      .map(file => window.electronAPI?.getPathForFile?.(file) ?? '')
      .filter(path => path.length > 0)
    if (paths.length === 0) return
    const result = await importFiles(paths)
    if (result.added > 0) {
      toast.add({ title: `${t('global.success')}: ${result.added}`, color: 'success' })
    } else if (result.duplicates === 0 && result.failed === 0) {
      // Everything was filtered out as non-media — say so instead of
      // importing nothing in silence.
      toast.add({ title: t('tmcut.media.dropNoMedia'), color: 'warning' })
    }
    if (result.duplicates > 0) {
      toast.add({ title: t('tmcut.media.alreadyInLibrary'), color: 'info' })
    }
    if (result.failed > 0) {
      toast.add({ title: t('tmcut.media.analysisFailed'), color: 'error' })
    }
  } catch (error) {
    console.error('Dropped media import failed:', error)
    toast.add({ title: t('tmcut.media.importFailed'), color: 'error' })
  }
}

async function handleRelink(asset: TmcutAsset) {
  if (!isDesktop.value) {
    const ext = asset.kind === 'video' ? mediaFilters[0]! : asset.kind === 'audio' ? mediaFilters[1]! : mediaFilters[2]!
    const files = await pickWebFiles(ext.extensions, false)
    const file = files[0]
    if (!file) return
    // R152: the replacement file is uploaded to the local server like a
    // fresh import — the blob: URL below only drives probing/thumbnails
    // and is revoked when done.
    let ok = false
    const blobUrl = URL.createObjectURL(file)
    try {
      const uploaded = await uploadWebFile(file, file.name)
      ok = await relink(asset.id, uploaded.url)
      if (ok) {
        const updated = findAssetBySrc(uploaded.url)
        if (updated) {
          updated.name = file.name
          updated.meta.fileSize = uploaded.size
          if (updated.kind !== 'image') {
            const duration = await probeWebMedia(blobUrl, updated.kind)
            if (duration > 0) updated.meta.durationSec = Math.round(duration * 100) / 100
          }
          if (updated.kind === 'video') {
            const thumb = await captureVideoThumb(blobUrl)
            if (thumb) updated.thumbPath = await uploadVideoThumb(file, thumb)
          }
        }
        // relink() persists its own snapshot BEFORE these mutations land,
        // so re-save here — otherwise the friendly name and the new
        // /uploads/ thumbnail are lost on the next reload.
        persistLibrary()
      }
    } catch (error) {
      console.error('Web relink upload failed:', error)
      importError.value = error instanceof Error ? error.message : 'upload failed'
    } finally {
      URL.revokeObjectURL(blobUrl)
    }
    toast.add({
      title: t(ok ? 'tmcut.media.relinked' : 'tmcut.media.relinkFailed'),
      color: ok ? 'success' : 'warning'
    })
    return
  }
  const ext = asset.kind === 'video' ? mediaFilters[0]! : asset.kind === 'audio' ? mediaFilters[1]! : mediaFilters[2]!
  const picked = await pickFile({ title: t('tmcut.media.relink'), filters: [ext] })
  if (!picked) return
  const filePath = Array.isArray(picked) ? picked[0] : picked
  if (!filePath) return
  const ok = await relink(asset.id, filePath)
  toast.add({
    title: t(ok ? 'tmcut.media.relinked' : 'tmcut.media.relinkFailed'),
    color: ok ? 'success' : 'warning'
  })
}

function handleRemoveAsset(asset: TmcutAsset) {
  removeAsset(asset.id)
  // toast.add({ title: t('tmcut.media.removed'), color: 'neutral' })
}

function handleAddToTimeline(asset: TmcutAsset) {
  if (addAssetToTimeline(asset.id)) {
    // toast.add({ title: t('tmcut.media.addedToTimeline'), color: 'success' })
  }
}

const unproxiedVideos = computed(() =>
  projectAssets.value.filter(a => effectiveAssetKind(a) === 'video' && a.status === 'ready' && a.proxyStatus !== 'ready')
)

const batchProxyBusy = ref(false)

async function handleGenerateAllProxies() {
  if (batchProxyBusy.value || unproxiedVideos.value.length === 0) return
  batchProxyBusy.value = true
  let successCount = 0
  const targets = [...unproxiedVideos.value]
  for (const asset of targets) {
    const ok = await generateProxy(asset)
    if (ok) successCount++
  }
  batchProxyBusy.value = false
  toast.add({
    title: t('tmcut.proxy.allGenerated', { count: successCount }),
    color: 'success'
  })
}

async function handleProxyAction(asset: TmcutAsset) {
  if (asset.proxyStatus === 'generating') return
  if (asset.proxyStatus === 'ready') {
    toast.add({
      title: t('tmcut.proxy.ready'),
      description: t('tmcut.proxy.readyDesc'),
      color: 'success'
    })
    return
  }
  toast.add({
    title: t('tmcut.proxy.generating'),
    description: asset.name,
    color: 'neutral'
  })
  const ok = await generateProxy(asset)
  if (ok) {
    toast.add({
      title: t('tmcut.proxy.ready'),
      description: t('tmcut.proxy.generated', { name: asset.name }),
      color: 'success'
    })
  } else {
    toast.add({
      title: t('tmcut.proxy.failed', { name: asset.name }),
      color: 'error'
    })
  }
}

// Media card → timeline drag payload (Roadmap A4): click keeps appending
// at the end, dragging lets the timeline place the clip at the drop
// point. The shared MIME type lives in ~/utils/tmcut/dnd.
function handleAssetDragStart(e: DragEvent, asset: TmcutAsset) {
  if (asset.status === 'missing' || !e.dataTransfer) return
  // Effective kind: an audio-only container must be dropped on an audio
  // row, not on the video row its extension suggested.
  const payload: TmcutAssetDragPayload = { id: asset.id, kind: effectiveAssetKind(asset) }
  e.dataTransfer.setData(TMCUT_ASSET_MIME, JSON.stringify(payload))
  e.dataTransfer.effectAllowed = 'copy'
}

function assetKindIcon(asset: TmcutAsset): string {
  const kind = effectiveAssetKind(asset)
  return kind === 'video' ? 'i-lucide-film' : kind === 'audio' ? 'i-lucide-music' : 'i-lucide-image'
}

// Template alias: every bin card check (thumb vs waveform, proxy button)
// must ask the SAME kind question the timeline routing asks.
function assetKind(asset: TmcutAsset) {
  return effectiveAssetKind(asset)
}

function assetMetaLabel(asset: TmcutAsset): string {
  const kind = effectiveAssetKind(asset)
  const parts: string[] = [t(`tmcut.media.${kind}`)]
  if (asset.meta.durationSec > 0) {
    parts.push(formatDurationSec(asset.meta.durationSec))
  }
  if (kind === 'video' && asset.meta.width > 0) {
    parts.push(`${asset.meta.width}x${asset.meta.height}`)
  }
  if (asset.meta.fileSize > 0) {
    parts.push(formatFileSize(asset.meta.fileSize))
  }
  return parts.join(' · ')
}

async function ensureWaveforms() {
  for (const asset of projectAssets.value) {
    if (effectiveAssetKind(asset) === 'audio' && asset.waveformPath && !waveformMap.value[asset.id]) {
      const points = await loadWaveform(asset)
      if (points.length > 0) {
        waveformMap.value[asset.id] = points
      }
    }
  }
}

watch(projectAssets, () => {
  void ensureWaveforms()
}, { immediate: true })

// ===== Recovery / Snapshots =====

async function handleRestoreRecovery() {
  await applyRecovery()
  if (!pendingRecovery.value) {
    toast.add({ title: t('tmcut.recovery.restored'), color: 'success' })
  }
}

async function handleDismissRecovery() {
  await dismissRecovery()
}

function handleSaveSnapshot() {
  void createSnapshot()
  toast.add({ title: t('tmcut.snapshot.saved'), color: 'success' })
}

async function handleRestoreSnapshot(ts: number) {
  await restoreSnapshot(ts)
  toast.add({ title: t('tmcut.snapshot.restored'), color: 'success' })
  showSnapshotModal.value = false
}

async function handleDeleteSnapshot(ts: number) {
  await deleteSnapshot(ts)
  toast.add({ title: t('tmcut.snapshot.deleted'), color: 'success' })
}

onMounted(async () => {
  hasWebGPU.value = typeof navigator !== 'undefined' && 'gpu' in navigator
  window.addEventListener('keydown', handleEditorKeydown)
  await loadProject(projectId.value)
  refreshProjects()
  loadLibrary()
  checkMissing()
  loadSnapshots()

  // Connect the export queue's event emitter to the MCP renderer bridge
  // (the bridge itself is initialized during setup — see the composable
  // block at the top of this file).
  const { setMcpEventEmitter } = await import('~/composables/useTmcutExportQueue')
  setMcpEventEmitter((event) => {
    if (window.electronAPI?.mcp?.respond) {
      window.electronAPI.mcp.respond(event.payload.requestId || '', event)
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleEditorKeydown)
})

const canvasPresets = computed(() => TMUTCANVAS_PRESETS.map(preset => ({
  label: t(`tmcut.ratios.${preset.id.replace(':', '_')}`),
  ratio: preset.id,
  width: preset.width,
  height: preset.height,
  icon: preset.icon
})))

const socialPresets = computed(() => TMUTCUT_SOCIAL_PRESETS.map(preset => ({
  label: t(`tmcut.social.${preset.id.replace(/-/g, '_')}`),
  presetId: preset.id,
  icon: preset.icon
})))

const fpsOptions = [
  { label: '24 FPS', value: 24 },
  { label: '30 FPS', value: 30 },
  { label: '60 FPS', value: 60 }
]

const customCanvas = ref({ width: 1080, height: 1080, fps: 30 })

const currentRatioLabel = computed(() => {
  if (!currentProject.value?.canvas) return ''
  const { width, height } = currentProject.value.canvas
  return ratioLabel(width, height)
})

function applyCanvasPreset(preset: { ratio: string, width: number, height: number }) {
  if (!currentProject.value) return
  switchCanvas(preset.width, preset.height)
  toast.add({
    title: t('tmcut.aspectRatioUpdated'),
    description: `${preset.ratio} (${preset.width}x${preset.height})`,
    color: 'success'
  })
}

function applySocialPreset(social: { presetId: string, label: string }) {
  const preset = findCanvasPreset(social.presetId)
  if (!preset || !currentProject.value) return
  switchCanvas(preset.width, preset.height)
  toast.add({
    title: t('tmcut.canvas.socialApplied'),
    description: `${social.label} · ${preset.id} (${preset.width}x${preset.height})`,
    color: 'success'
  })
}

function applyCustomCanvas() {
  const { width, height, fps } = customCanvas.value
  if (!width || !height || width < 64 || height < 64 || width > 7680 || height > 4320) {
    toast.add({ title: t('tmcut.canvas.customInvalid'), color: 'warning' })
    return
  }
  if (!currentProject.value) return
  switchCanvas(Math.round(width), Math.round(height))
  if (currentProject.value) {
    currentProject.value.canvas.fps = { numerator: fps, denominator: 1 }
    saveProject()
  }
  showCustomCanvasModal.value = false
  toast.add({
    title: t('tmcut.aspectRatioUpdated'),
    description: `${t('tmcut.canvas.custom')} (${width}x${height})`,
    color: 'success'
  })
}

function applyFps(fps: number) {
  if (!currentProject.value) return
  currentProject.value.canvas.fps = { numerator: fps, denominator: 1 }
  saveProject()
  toast.add({
    title: t('tmcut.fpsUpdated'),
    description: `${fps} FPS`,
    color: 'success'
  })
}

function handleDuplicateAs(presetId: string) {
  const cloned = duplicateAsProject(presetId)
  if (cloned) {
    toast.add({
      title: t('tmcut.reframe.duplicated', { ratio: findCanvasPreset(presetId)?.id || presetId }),
      color: 'success'
    })
  }
}

const canvasMenuItems = computed(() => {
  const currentWidth = currentProject.value?.canvas?.width
  const currentHeight = currentProject.value?.canvas?.height
  // canvas.fps is a rational (C16); the menu and the custom modal speak float.
  const currentFps = canvasFpsValue(currentProject.value?.canvas)

  const presetItems = canvasPresets.value.map(preset => ({
    label: `${preset.ratio} - ${preset.label}`,
    icon: preset.icon,
    checked: currentWidth === preset.width && currentHeight === preset.height,
    onSelect: () => applyCanvasPreset(preset)
  }))

  presetItems.push({
    label: t('tmcut.canvas.custom'),
    icon: 'i-lucide-settings-2',
    checked: !findCanvasPresetByDimensions(currentWidth || 0, currentHeight || 0),
    onSelect: () => {
      customCanvas.value = {
        width: currentWidth || 1080,
        height: currentHeight || 1080,
        fps: currentFps || 30
      }
      showCustomCanvasModal.value = true
    }
  })

  const socialItems = socialPresets.value.map(preset => ({
    label: preset.label,
    icon: preset.icon,
    onSelect: () => applySocialPreset(preset)
  }))

  const backgroundItems = [
    {
      label: t('tmcut.canvas.bgBlack'),
      icon: 'i-lucide-circle',
      onSelect: () => setCanvasBackground('color', '#000000')
    },
    {
      label: t('tmcut.canvas.bgWhite'),
      icon: 'i-lucide-circle',
      onSelect: () => setCanvasBackground('color', '#ffffff')
    },
    {
      label: t('tmcut.canvas.bgDark'),
      icon: 'i-lucide-circle',
      onSelect: () => setCanvasBackground('color', '#1a1a1a')
    },
    {
      label: t('tmcut.canvas.bgLight'),
      icon: 'i-lucide-circle',
      onSelect: () => setCanvasBackground('color', '#e5e5e5')
    },
    {
      label: t('tmcut.canvas.transparent'),
      icon: 'i-lucide-circle-dashed',
      onSelect: () => setCanvasBackground('transparent')
    },
    {
      label: t('tmcut.canvas.bgImage'),
      icon: 'i-lucide-image',
      onSelect: () => void handlePickBackgroundImage()
    }
  ]

  const fpsItems = fpsOptions.map(item => ({
    label: `${item.label}`,
    icon: 'i-lucide-gauge',
    checked: currentFps === item.value,
    onSelect: () => applyFps(item.value)
  }))

  return [presetItems, socialItems, backgroundItems, fpsItems]
})

function openFilePreview(filePath?: string, title?: string) {
  if (!filePath) return
  previewFilePath.value = filePath
  previewFileTitle.value = title || filePath.split(/[\\/]/).pop() || t('tmcut.previewFile')
  previewModalOpen.value = true
}

function showInFolder(filePath?: string) {
  if (filePath && window.electronAPI?.showItemInFolder) {
    window.electronAPI.showItemInFolder(filePath)
  }
}

const editorExtraActions = computed(() => [
  [
    {
      label: t('tmcut.addVideo'),
      icon: 'i-lucide-plus',
      onSelect: () => handleImportMedia()
    },
    {
      label: t('tmcut.snapshot.save'),
      icon: 'i-lucide-camera',
      onSelect: () => handleSaveSnapshot()
    },
    {
      label: t('tmcut.snapshot.title'),
      icon: 'i-lucide-history',
      onSelect: () => {
        void loadSnapshots()
        showSnapshotModal.value = true
      }
    }
  ],
  [
    {
      label: t('tmcut.reframe.label'),
      icon: 'i-lucide-proportions',
      type: 'label' as const
    },
    ...['16:9', '9:16', '1:1', '4:5'].map(ratioId => ({
      label: t('tmcut.reframe.duplicateAs', { ratio: ratioId }),
      icon: findCanvasPreset(ratioId)?.icon || 'i-lucide-proportions',
      onSelect: () => handleDuplicateAs(ratioId)
    }))
  ],
  [
    {
      label: t('nav.tmcut_templates'),
      icon: 'i-lucide-layout-template',
      onSelect: () => router.push('/tmcut/templates')
    },
    {
      label: t('tmcut.templateLibrary.saveAsTemplate'),
      icon: 'i-lucide-bookmark-plus',
      onSelect: () => handleSaveAsTemplate()
    },
    {
      label: t('tmcut.templateLibrary.importIntoProject'),
      icon: 'i-lucide-file-down',
      onSelect: () => handleImportTemplateIntoProject()
    },
    {
      label: t('nav.tmcut_autocut'),
      icon: 'i-lucide-scissors',
      onSelect: () => router.push('/tmcut/autocut')
    }
  ]
])

const { saveCurrentProjectAsTemplate } = useTmcutTemplates()

function handleSaveAsTemplate() {
  if (!currentProject.value) return
  const tpl = saveCurrentProjectAsTemplate({
    name: currentProject.value.name || 'Untitled Template',
    description: `Template created from ${currentProject.value.name}`,
    category: 'custom'
  })
  if (tpl) {
    toast.add({
      title: t('tmcut.templateLibrary.savedAsTemplate', { name: tpl.name }),
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
  }
}

/**
 * R132 — import a template file directly from the editor's Save-as menu.
 * The file is parsed through parseTemplateFile (untrusted input: garbage is
 * refused, ids regenerate, isBuiltin forced false), then instantiated into
 * the CURRENT project — unlike the library's importTemplates(), which
 * drops a template into the library, this one writes the timeline into
 * the project the user is editing, so it needs the same save gate as any
 * other mutation.
 */
async function handleImportTemplateIntoProject() {
  if (!currentProject.value) return
  const api = window.electronAPI
  if (!api?.dialog || !api?.fileManager) {
    toast.add({ title: t('tmcut.templateLibrary.importFailedToast', { count: 0 }), color: 'error', icon: 'i-lucide-file-x' })
    return
  }
  try {
    const paths = await api.dialog.openFile({
      title: 'Import template into project',
      filters: [{ name: 'TMCut template / JSON', extensions: ['json'] }]
    })
    if (!paths || paths.length === 0) return
    const firstPath = paths[0]
    if (!firstPath) return
    const text = await api.fileManager.read(firstPath)
    const res = parseTemplateFile(text)
    if (!res.ok || !res.template) {
      toast.add({ title: t('tmcut.templateLibrary.importFailedToast', { count: 1 }), color: 'error', icon: 'i-lucide-file-x' })
      return
    }
    const tpl = res.template
    const instantiated = instantiateTemplate(tpl)
    const live = currentProject.value
    // Roadmap v3 §6.4 step 9: a whole-timeline replacement must undo as one
    // step — capture the pre-import state (same contract as any mutation).
    pushHistory()
    live.canvas = normalizeCanvas({
      width: instantiated.canvas.width,
      height: instantiated.canvas.height,
      fps: instantiated.canvas.fps
    })
    live.timeline = {
      version: 1,
      tracks: instantiated.timeline.tracks as unknown as TmcutTrack[],
      durationMs: instantiated.durationMs,
      markers: instantiated.timeline.markers || []
    }
    saveProject()
    toast.add({
      title: t('tmcut.templateLibrary.importedIntoProject', { name: tpl.name }),
      color: 'success',
      icon: 'i-lucide-file-down'
    })
  } catch (err) {
    console.error('Failed to import template into project', err)
    toast.add({ title: t('tmcut.templateLibrary.importFailedToast', { count: 0 }), color: 'error', icon: 'i-lucide-alert-triangle' })
  }
}

const aiScriptModalOpen = ref(false)
// AI Editor (roadmap v3 PART C): prompt -> validated Edit Plan -> review -> apply.
const aiEditorModalOpen = ref(false)
const audioOrchestrationOpen = ref(false)
// Agent panel (roadmap v1 §4): text/voice command -> draft -> review -> apply as ONE undo group.
const agentPanelOpen = ref(false)
const pendingAgentOps = useAgentProposalCount()

function handleEditorKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  if (e.altKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault()
    aiScriptModalOpen.value = true
  }
  if (e.altKey && (e.key === 'e' || e.key === 'E')) {
    e.preventDefault()
    aiEditorModalOpen.value = true
  }
}
</script>

<template>
  <BasePage
    id="tmcut-editor"
    :title="currentProject?.name || t('tmcut.editor')"
    :description="currentProject?.canvas ? `${currentProject.canvas.width}x${currentProject.canvas.height} (${canvasFpsValue(currentProject.canvas)}fps)` : undefined"
    :navbar-ui="{ root: 'h-auto min-h-(--ui-header-height) flex-wrap py-2', left: 'min-w-0', right: 'min-w-0 max-w-full overflow-x-auto' }"
    flush
  >
    <template #left>
      <div class="flex min-w-0 items-center gap-2">
        <UDashboardSidebarCollapse />
        <UButton
          to="/tmcut"
          icon="i-lucide-arrow-left"
          size="sm"
          variant="ghost"
          color="neutral"
          :title="t('tmcut.back')"
        />
        <UIcon name="i-lucide-clapperboard" class="size-5 text-primary shrink-0" />
        <input
          v-if="currentProject"
          id="tmcut-project-name"
          v-model="currentProject.name"
          :aria-label="t('tmcut.templateLibrary.projectNameLabel')"
          class="bg-transparent border-none font-semibold text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-primary rounded px-1.5 py-0.5 min-w-0 w-36 2xl:w-50 truncate"
          @blur="saveProject()"
        >
      </div>
    </template>

    <template #right>
      <UButton
        class="xl:hidden"
        icon="i-lucide-library"
        size="sm"
        variant="ghost"
        color="neutral"
        :aria-label="t('tmcut.media.library')"
        aria-controls="tmcut-media-panel"
        :aria-expanded="compactPanel === 'media'"
        @click="compactPanel = compactPanel === 'media' ? null : 'media'"
      />
      <UButton
        class="xl:hidden"
        icon="i-lucide-sliders-horizontal"
        size="sm"
        variant="ghost"
        color="neutral"
        :aria-label="t('tmcut.inspector')"
        aria-controls="tmcut-inspector-panel"
        :aria-expanded="compactPanel === 'inspector'"
        @click="compactPanel = compactPanel === 'inspector' ? null : 'inspector'"
      />
      <!-- Shortcuts help (shared overlay with the timeline Ctrl+K / ?) -->
      <UButton
        icon="i-lucide-keyboard"
        size="sm"
        variant="soft"
        color="neutral"
        :title="t('tmcut.workspace.shortcutsBtn')"
        @click="shortcutsOpen = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.workspace.shortcutsBtn') }}</span>
      </UButton>

      <!-- Honest hardware status chip (WebGPU detection + export engine) -->
      <!-- <span
        class="hidden xl:inline-flex items-center gap-1 px-2 py-1 rounded-md bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 text-[11px] font-mono text-neutral-500 dark:text-neutral-400"
        :title="t('tmcut.workspace.hardwareStatus')">
        <UIcon name="i-lucide-cpu" class="size-3 text-primary" />
        {{ hardwareLabel }}
      </span> -->

      <!-- Aspect Ratio & Resolution Preset Dropdown -->
      <UDropdownMenu :items="canvasMenuItems" :content="{ side: 'bottom', align: 'end' }">
        <UButton
          v-if="currentProject?.canvas"
          icon="i-lucide-proportions"
          size="sm"
          variant="soft"
          color="neutral"
          :title="t('tmcut.canvasRatio')"
        >
          <span class="font-mono text-xs">
            {{ currentRatioLabel }} ({{ canvasFpsValue(currentProject.canvas) }}fps)
          </span>
          <UIcon name="i-lucide-chevron-down" class="size-3 text-neutral-500 dark:text-neutral-400" />
        </UButton>
      </UDropdownMenu>

      <span
        v-if="saveLabel"
        class="hidden lg:inline text-[11px] font-mono text-neutral-500 dark:text-neutral-400"
        :class="saveStatus === 'error' ? 'text-red-400' : ''"
        :title="lastSavedAt ? new Date(lastSavedAt).toLocaleString() : ''"
      >
        {{ saveLabel }}
      </span>
      <!-- R132: the project revision is the single honest answer to
           "was this file written outside this session while I held it
           open". It is advisory, not a lock — the app is still the
           single writer. -->
      <UButton
        v-if="revisionAtLoad !== null && currentRevision() > revisionAtLoad"
        icon="i-lucide-file-pen"
        size="xs"
        color="warning"
        variant="soft"
        :title="t('tmcut.save.staleRevision')"
      >
        <span class="hidden md:inline">{{ t('tmcut.save.staleRevision') }}</span>
      </UButton>
      <UButton
        icon="i-lucide-save"
        size="sm"
        color="primary"
        variant="soft"
        @click="saveProject()"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('global.save') }}</span>
      </UButton>
      <UButton
        icon="i-lucide-list-checks"
        size="sm"
        variant="soft"
        :color="activeJobsCount > 0 ? 'primary' : 'neutral'"
        :title="t('tmcut.queue.title')"
        @click="queueModalOpen = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.queue.title') }}</span>
        <UBadge
          v-if="activeJobsCount > 0"
          color="primary"
          variant="solid"
          size="xs"
          class="ml-0.5"
        >
          {{ activeJobsCount }}
        </UBadge>
      </UButton>
      <!-- AI Scriptwriter & Storyboard modal trigger (Alt+A) -->
      <UButton
        icon="i-lucide-sparkles"
        size="sm"
        variant="soft"
        color="primary"
        :title="t('tmcut.aiScript.buttonTooltip')"
        @click="aiScriptModalOpen = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.aiScript.buttonLabel') }}</span>
      </UButton>

      <!-- AI Edit Plan modal trigger (Alt+E) — proposes, core validates, user applies -->
      <UButton
        icon="i-lucide-wand-sparkles"
        size="sm"
        variant="soft"
        color="secondary"
        :title="t('tmcut.aiEditor.buttonTooltip')"
        @click="aiEditorModalOpen = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.aiEditor.buttonLabel') }}</span>
      </UButton>

      <!-- Agent & voice commands (roadmap v1 §4): draft → review → apply as one undo group -->
      <UButton
        icon="i-lucide-terminal"
        size="sm"
        variant="soft"
        color="secondary"
        :title="t('tmcut.agent.buttonTooltip')"
        @click="agentPanelOpen = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.agent.buttonLabel') }}</span>
        <UBadge
          v-if="pendingAgentOps > 0"
          color="primary"
          variant="solid"
          size="xs"
          class="ml-0.5"
        >
          {{ pendingAgentOps }}
        </UBadge>
      </UButton>

      <!-- Audio orchestration (Phase 8 §24): music bed and SFX cue planner -->
      <UButton
        icon="i-lucide-music-2"
        size="sm"
        variant="soft"
        color="secondary"
        :title="t('tmcut.audioOrchestration.buttonTooltip')"
        @click="audioOrchestrationOpen = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.audioOrchestration.buttonLabel') }}</span>
      </UButton>

      <UButton
        icon="i-lucide-download"
        size="sm"
        color="secondary"
        variant="soft"
        @click="showExportModal = true"
      >
        <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.exportVideo') }}</span>
      </UButton>
      <UDropdownMenu :items="editorExtraActions" :content="{ side: 'bottom', align: 'end' }">
        <UButton
          icon="i-lucide-ellipsis-vertical"
          color="neutral"
          variant="soft"
          size="sm"
          :aria-label="t('common.more')"
        />
      </UDropdownMenu>
    </template>

    <!-- Full viewport Workspace (flush p-0) -->
    <div
      class="flex-1 flex flex-col min-h-0 bg-neutral-100 dark:bg-neutral-950 text-neutral-900 dark:text-white overflow-hidden select-none"
    >
      <!-- Recovery banner -->
      <div
        v-if="pendingRecovery"
        class="flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-200 text-xs"
      >
        <span class="truncate">{{ t('tmcut.recovery.banner') }}</span>
        <div class="flex items-center gap-2 shrink-0">
          <UButton
            size="xs"
            variant="solid"
            color="warning"
            @click="handleRestoreRecovery"
          >
            {{ t('tmcut.recovery.restore') }}
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            @click="handleDismissRecovery"
          >
            {{ t('tmcut.recovery.discard') }}
          </UButton>
        </div>
      </div>

      <!-- Center Workspace -->
      <div class="relative flex-1 flex overflow-hidden min-h-0" @keydown.esc="compactPanel = null">
        <!-- Left Media Library Panel (CapCut-style: category tabs + thumbnail grid).
             Whole panel is the external-drop target (roadmap G-2). -->
        <aside
          id="tmcut-media-panel"
          class="@container absolute inset-y-0 left-0 z-20 w-[min(90%,22.5rem)] xl:static xl:w-[32%] xl:min-w-72 xl:max-w-140 border-r border-neutral-300 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 flex-col shrink-0"
          :class="[compactPanel === 'media' ? 'flex' : 'hidden xl:flex', dropActive ? 'ring-2 ring-primary/60' : '']"
          @dragenter="onMediaPanelDragEnter"
          @dragover="onMediaPanelDragOver"
          @dragleave="onMediaPanelDragLeave"
          @drop="onMediaPanelDrop"
        >
          <div class="p-3 border-b border-neutral-300 dark:border-neutral-800 flex items-center justify-between gap-1">
            <span
              class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider truncate"
            >
              {{ t('tmcut.media.library') }}
            </span>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                class="xl:hidden"
                icon="i-lucide-x"
                size="xs"
                variant="ghost"
                color="neutral"
                :aria-label="t('tmcut.hotkeys.close')"
                @click="compactPanel = null"
              />
              <!-- Batch proxy button when video assets need proxies (roadmap
                   F-4). Web-parity: the local server runs the ffmpeg pass
                   (POST /api/v1/media/proxy), so it is no longer
                   desktop-only. -->
              <UButton
                v-if="unproxiedVideos.length > 0"
                icon="i-lucide-zap"
                size="xs"
                variant="soft"
                color="warning"
                :loading="batchProxyBusy"
                :disabled="batchProxyBusy"
                :title="t('tmcut.proxy.generateAll')"
                @click="handleGenerateAllProxies"
              />
              <UButton
                icon="i-lucide-plus"
                size="xs"
                variant="soft"
                color="primary"
                :disabled="importing"
                @click="handleImportMedia"
              >
                {{ t('tmcut.media.import') }}
              </UButton>
              <!-- Voiceover (roadmap D-4): mic toggles record; while
                   recording the button becomes a red stop with the live
                   elapsed time. -->
              <UButton
                v-if="!recordingVoiceover"
                icon="i-lucide-mic"
                size="xs"
                variant="soft"
                color="neutral"
                :disabled="savingVoiceover"
                :title="t('tmcut.media.voiceoverStart')"
                @click="handleVoiceoverToggle"
              />
              <UButton
                v-else
                icon="i-lucide-square-stop"
                size="xs"
                variant="soft"
                color="error"
                :title="t('tmcut.media.voiceoverStop')"
                @click="handleVoiceoverToggle"
              >
                {{ formatVoiceoverTime(voiceoverElapsed) }}
              </UButton>
            </div>
          </div>

          <!-- R152 upload progress only: while web files stream to the
               local server the banner shows {done}/{total}; hidden when
               idle (user request — no always-visible persistence note).
               Hidden on desktop entirely (no uploads there). -->
          <div
            v-if="!isDesktop && webUpload"
            class="mx-3 mt-2 px-2.5 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-600"
          >
            <span class="inline-flex items-center gap-1.5">
              <i class="i-lucide-upload-cloud size-3.5 shrink-0" />
              {{ t('tmcut.media.uploadProgress', { done: webUpload.done, total: webUpload.total }) }}
            </span>
          </div>

          <!-- Category tab bar (R120: labeled chips like the mock, wrapping
               to a second row instead of scrolling — the 8 categories fit
               4+4 at the new panel width). -->
          <div class="flex flex-wrap items-center gap-1 px-2 py-2 border-b border-neutral-300 dark:border-neutral-800">
            <UButton
              v-for="tab in mediaTabs"
              :key="tab.id"
              :icon="tab.icon"
              size="xs"
              :label="tab.label"
              :variant="mediaTab === tab.id ? 'solid' : 'ghost'"
              :color="mediaTab === tab.id ? 'primary' : 'neutral'"
              :title="tab.label"
              @click="mediaTab = tab.id"
            />
          </div>

          <!-- Library search (design #2) -->
          <div v-if="isAssetTab" class="px-2 pt-2">
            <UInput
              id="tmcut-media-search"
              v-model="assetSearch"
              icon="i-lucide-search"
              size="xs"
              color="neutral"
              class="w-full"
              :placeholder="t('tmcut.media.search')"
              :aria-label="t('tmcut.media.search')"
            />
          </div>

          <!-- Folder / Album management bar (roadmap G-3) -->
          <div
            v-if="isAssetTab"
            class="px-2 pt-2 pb-1.5 space-y-1.5 border-b border-neutral-300/80 dark:border-neutral-800/80"
          >
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1 text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                <UIcon name="i-lucide-folder" class="size-3.5 text-primary" />
                <span>{{ t('tmcut.folders.title') }}</span>
              </div>
              <UButton
                icon="i-lucide-folder-plus"
                size="xs"
                variant="ghost"
                color="primary"
                :title="t('tmcut.folders.create')"
                @click="openCreateFolderModal"
              >
                {{ t('tmcut.folders.create') }}
              </UButton>
            </div>

            <!-- Folder pills (horizontal scrollable) -->
            <div class="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              <!-- All -->
              <button
                type="button"
                class="px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer border"
                :class="selectedFolderId === null ? 'bg-primary/20 border-primary text-primary font-semibold' : 'bg-neutral-200/60 dark:bg-neutral-800/60 border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 text-neutral-600 dark:text-neutral-300'"
                @click="selectedFolderId = null"
              >
                <UIcon name="i-lucide-layers" class="size-3" />
                <span>{{ t('tmcut.folders.all') }}</span>
                <span class="text-[10px] opacity-75 font-mono">({{ folderCounts.total }})</span>
              </button>

              <!-- Specific Folders -->
              <div
                v-for="folder in projectFolders"
                :key="folder.id"
                class="group/fchip relative rounded-md text-[11px] font-medium flex items-center gap-1.5 shrink-0 transition-colors pl-2 pr-1 py-1 cursor-pointer border"
                :class="selectedFolderId === folder.id ? 'bg-primary/20 border-primary text-primary font-semibold' : 'bg-neutral-200/60 dark:bg-neutral-800/60 border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 text-neutral-600 dark:text-neutral-300'"
                @click="selectedFolderId = folder.id"
                @dragover.prevent="onFolderDragOver($event)"
                @drop.prevent="onFolderDrop($event, folder.id)"
              >
                <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: folder.color || '#3b82f6' }" />
                <span class="truncate max-w-22.5" :title="folder.name">{{ folder.name }}</span>
                <span class="text-[10px] opacity-75 font-mono">({{ folderCounts[folder.id] || 0 }})</span>
                <UDropdownMenu :items="folderActionItems(folder)" :content="{ side: 'bottom', align: 'start' }">
                  <button
                    type="button"
                    class="p-0.5 rounded hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                    @click.stop
                  >
                    <UIcon name="i-lucide-more-vertical" class="size-3" />
                  </button>
                </UDropdownMenu>
              </div>

              <!-- Unassigned (if any exist) -->
              <button
                v-if="(folderCounts.unassigned ?? 0) > 0"
                type="button"
                class="px-2.5 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer border"
                :class="selectedFolderId === '__unassigned__' ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-semibold' : 'bg-neutral-200/60 dark:bg-neutral-800/60 border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 text-neutral-500 dark:text-neutral-400'"
                @click="selectedFolderId = '__unassigned__'"
                @dragover.prevent="onFolderDragOver($event)"
                @drop.prevent="onFolderDrop($event, null)"
              >
                <UIcon name="i-lucide-folder-archive" class="size-3 text-neutral-500 dark:text-neutral-400" />
                <span>{{ t('tmcut.folders.unassigned') }}</span>
                <span class="text-[10px] opacity-75 font-mono">({{ folderCounts.unassigned ?? 0 }})</span>
              </button>
            </div>
          </div>

          <div
            v-if="missingAssets.length > 0"
            class="mx-3 mt-2 px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200"
          >
            <div class="flex items-center gap-1.5">
              <UIcon name="i-lucide-alert-triangle" class="size-3.5 shrink-0" />
              <span class="truncate">{{ t('tmcut.media.missingBanner', { count: missingAssets.length }) }}</span>
            </div>
          </div>

          <!-- Bin toolbar: view toggle. OUTSIDE the scroll container so it
               stays reachable, and only for the kind tabs where it means
               something (Effects/Text/FX lists ignore it). -->
          <div v-if="isAssetTab" class="mx-3 mt-2 flex items-center justify-between gap-2">
            <div class="text-[10px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.media.assets') }} · {{ filteredAssets.length }}
            </div>
            <div class="flex items-center gap-0.5 rounded-md border border-neutral-300 dark:border-neutral-800 p-0.5">
              <UButton
                icon="i-lucide-list"
                size="xs"
                variant="ghost"
                :color="mediaView === 'list' ? 'primary' : 'neutral'"
                :title="t('tmcut.media.viewList')"
                @click="mediaView = 'list'"
              />
              <UButton
                icon="i-lucide-grid-2x2"
                size="xs"
                variant="ghost"
                :color="mediaView === 'grid' ? 'primary' : 'neutral'"
                :title="t('tmcut.media.viewGrid')"
                @click="mediaView = 'grid'"
              />
            </div>
          </div>

          <div ref="mediaScrollRef" class="flex-1 overflow-y-auto p-3 space-y-2" @scroll="onMediaBinScroll">
            <!-- Loading indicator -->
            <div
              v-if="importing || analyzingCount > 0"
              class="flex items-center gap-2 px-2 py-3 text-xs text-neutral-500 dark:text-neutral-400"
            >
              <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
              {{ t('tmcut.media.importing') }}
            </div>

            <!-- CapCut-style thumbnail grid (Media / Video / Audio / Image tabs) -->
            <div v-else-if="isAssetTab">
              <div
                v-if="filteredAssets.length === 0"
                class="border border-dashed border-neutral-300 dark:border-neutral-800 hover:border-primary/50 cursor-pointer rounded-lg p-4 text-center transition-colors group"
                @click="handleImportMedia"
              >
                <UIcon
                  name="i-lucide-upload-cloud"
                  class="size-7 mx-auto text-neutral-500 group-hover:text-primary mb-1.5 transition-colors"
                />
                <p
                  class="text-xs text-neutral-500 dark:text-neutral-400 group-hover:text-neutral-700 dark:group-hover:text-neutral-200 font-medium"
                >
                  {{ t('tmcut.media.empty') }}
                </p>
                <p class="text-[10px] text-neutral-500 dark:text-neutral-600 mt-1">
                  {{ t('tmcut.media.importHint') }}
                </p>
              </div>

              <!-- Horizontal asset cards (mock #2 media bin): fixed-size
                   thumbnail + name/meta rows + a reserved ACTION COLUMN on
                   the right. Hover only changes the border color and the
                   action column's opacity — the geometry is hover-invariant. -->
              <div v-if="mediaView === 'list'" class="flex flex-col gap-2">
                <div
                  v-for="asset in visibleAssets"
                  :key="asset.id"
                  class="group/thumb relative flex gap-2 p-1.5 min-w-0 rounded-md bg-neutral-200/60 dark:bg-neutral-800/60 cursor-pointer border transition-colors"
                  :class="asset.status === 'missing' ? 'border-amber-500/60' : 'border-transparent hover:border-primary/60'"
                  :title="asset.name"
                  :draggable="asset.status !== 'missing'"
                  @click="asset.status !== 'missing' && handleAddToTimeline(asset)"
                  @dragstart="handleAssetDragStart($event, asset)"
                >
                  <div class="relative w-24 h-14 rounded overflow-hidden shrink-0 bg-neutral-300 dark:bg-neutral-900">
                    <img
                      v-if="assetKind(asset) !== 'audio' && asset.thumbPath && !thumbErrors[asset.id]"
                      :src="getThumbUrl(asset)"
                      draggable="false"
                      class="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      @error="thumbErrors[asset.id] = true"
                    >
                    <div
                      v-else-if="assetKind(asset) === 'audio' && waveformMap[asset.id]"
                      class="absolute inset-0 flex items-center justify-center p-1"
                    >
                      <TmcutWaveform :points="waveformMap[asset.id] ?? []" :width="90" :height="44" />
                    </div>
                    <UIcon
                      v-else
                      :name="assetKindIcon(asset)"
                      class="absolute inset-0 m-auto size-6 text-neutral-500 dark:text-neutral-600"
                    />

                    <div
                      v-if="asset.status === 'analyzing'"
                      class="absolute inset-0 bg-black/50 flex items-center justify-center"
                    >
                      <UIcon
                        name="i-lucide-loader-circle"
                        class="size-4 animate-spin text-neutral-600 dark:text-neutral-300"
                      />
                    </div>
                    <div
                      v-if="asset.status === 'missing'"
                      class="absolute inset-0 bg-amber-950/60 flex items-center justify-center"
                    >
                      <UIcon name="i-lucide-alert-triangle" class="size-4 text-amber-400" />
                    </div>

                    <!-- Duration badge (bottom-right) -->
                    <span
                      v-if="assetDurationLabel(asset)"
                      class="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/70 text-[9px] font-mono text-white"
                    >
                      {{ assetDurationLabel(asset) }}
                    </span>
                    <!-- Added badge (top-left, CapCut-style) -->
                    <span
                      v-if="isAssetOnTimeline(asset)"
                      class="absolute top-0.5 left-0.5 px-1 rounded bg-primary text-[9px] font-medium text-white"
                    >
                      {{ t('tmcut.media.addedBadge') }}
                    </span>
                    <!-- Proxy badge (roadmap F-4) -->
                    <span
                      v-if="asset.proxyStatus === 'ready'"
                      class="absolute px-1 rounded bg-amber-500/90 text-[9px] font-bold text-black flex items-center gap-0.5"
                      :class="isAssetOnTimeline(asset) ? 'top-4 left-0.5' : 'top-0.5 left-0.5'"
                      :title="t('tmcut.proxy.readyDesc')"
                    >
                      <UIcon name="i-lucide-zap" class="size-2.5 text-black" />
                      <span>PXY</span>
                    </span>
                    <span
                      v-else-if="asset.proxyStatus === 'generating'"
                      class="absolute px-1 rounded bg-amber-500/30 border border-amber-500/50 text-[9px] font-medium text-amber-200 flex items-center gap-0.5"
                      :class="isAssetOnTimeline(asset) ? 'top-4 left-0.5' : 'top-0.5 left-0.5'"
                    >
                      <UIcon name="i-lucide-loader-circle" class="size-2.5 animate-spin" />
                      <span>PXY</span>
                    </span>
                  </div>

                  <!-- Middle column: name + metadata rows (the only
                       growing column). -->
                  <div class="flex flex-col justify-center gap-0.5 min-w-0 flex-1">
                    <p
                      class="text-[11px] font-medium text-neutral-700 dark:text-neutral-200 truncate"
                      :title="asset.name"
                    >
                      {{ asset.name }}
                    </p>
                    <p class="text-[9px] font-mono text-neutral-500 dark:text-neutral-500 truncate">
                      {{ assetMetaLabel(asset) }}
                      <template v-if="!selectedFolderId && getFolderBadge(asset)">
                        •
                        <span
                          class="inline-block size-1.5 rounded-full align-middle"
                          :style="{ backgroundColor: getFolderBadge(asset)?.color || '#3b82f6' }"
                        />
                        {{ getFolderBadge(asset)?.name }}
                      </template>
                    </p>
                    <p v-if="asset.status === 'missing'" class="text-[9px] font-medium text-amber-400 truncate">
                      {{ t('tmcut.media.missing') }}
                    </p>
                    <p v-else-if="asset.proxyStatus === 'ready'" class="text-[9px] font-mono text-emerald-400 truncate">
                      ✓ PXY
                    </p>
                  </div>

                  <!-- Action column (right side): FIXED width so every row
                       aligns regardless of which buttons apply; buttons
                       fade in on hover and only then take pointer events,
                       so an invisible button can never be clicked. -->
                  <div
                    class="flex items-center justify-end gap-0.5 shrink-0 w-24 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    @click.stop
                  >
                    <!-- Relink is an icon (not a button): the missing row
                         would otherwise show one fat ghost next to the
                         compact icon column. UIcon has no color prop —
                         text-warning + pointer affordance keep it honest. -->
                    <UIcon
                      v-if="asset.status === 'missing'"
                      name="i-lucide-folder-search"
                      :title="t('tmcut.media.relink')"
                      class="size-4 text-warning cursor-pointer hover:opacity-75 transition-opacity pointer-events-none group-hover/thumb:pointer-events-auto"
                      @click.stop="handleRelink(asset)"
                    />
                    <UButton
                      v-else-if="asset.status !== 'analyzing'"
                      icon="i-lucide-plus"
                      size="xs"
                      variant="ghost"
                      color="primary"
                      :title="t('tmcut.media.addToTimeline')"
                      class="pointer-events-none group-hover/thumb:pointer-events-auto"
                      @click.stop="handleAddToTimeline(asset)"
                    />
                    <UButton
                      v-if="isDesktop && assetKind(asset) === 'video' && asset.status !== 'missing'"
                      :icon="asset.proxyStatus === 'generating' ? 'i-lucide-loader-circle' : 'i-lucide-zap'"
                      size="xs"
                      variant="ghost"
                      :color="asset.proxyStatus === 'ready' ? 'warning' : 'neutral'"
                      :loading="asset.proxyStatus === 'generating'"
                      :title="asset.proxyStatus === 'ready' ? t('tmcut.proxy.ready') : t('tmcut.proxy.generate')"
                      class="pointer-events-none group-hover/thumb:pointer-events-auto"
                      @click.stop="handleProxyAction(asset)"
                    />
                    <UButton
                      icon="i-lucide-folder-input"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      :title="t('tmcut.folders.moveToFolder')"
                      class="pointer-events-none group-hover/thumb:pointer-events-auto"
                      @click.stop="openMoveAssetModal(asset)"
                    />
                    <UButton
                      icon="i-lucide-trash"
                      size="xs"
                      variant="ghost"
                      color="error"
                      :title="t('tmcut.media.remove')"
                      class="pointer-events-none group-hover/thumb:pointer-events-auto"
                      @click.stop="handleRemoveAsset(asset)"
                    />
                  </div>
                </div>
              </div>

              <!-- Grid view, compact (R123): container-query columns so
                   the cell count follows the panel width — 2 at the
                   360px minimum, up to 5 per row when fullscreen. Cells
                   shrink instead of cards growing; the meta line and the
                   wider actions disappear at the 5-column tier where
                   there is no room for them. Actions stay a hover strip
                   (opacity only) over the thumbnail. -->
              <div
                v-if="mediaView === 'grid'"
                class="grid grid-cols-2 gap-1.5 @[420px]:grid-cols-3 @[480px]:grid-cols-4 @[530px]:grid-cols-5"
              >
                <div
                  v-for="asset in visibleAssets"
                  :key="asset.id"
                  class="group/thumb relative rounded-md bg-neutral-200/60 dark:bg-neutral-800/60 cursor-pointer border transition-colors overflow-hidden"
                  :class="asset.status === 'missing' ? 'border-amber-500/60' : 'border-transparent hover:border-primary/60'"
                  :title="asset.name"
                  :draggable="asset.status !== 'missing'"
                  @click="asset.status !== 'missing' && handleAddToTimeline(asset)"
                  @dragstart="handleAssetDragStart($event, asset)"
                >
                  <div class="relative aspect-video bg-neutral-300 dark:bg-neutral-900">
                    <img
                      v-if="assetKind(asset) !== 'audio' && asset.thumbPath && !thumbErrors[asset.id]"
                      :src="getThumbUrl(asset)"
                      draggable="false"
                      class="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      @error="thumbErrors[asset.id] = true"
                    >
                    <div
                      v-else-if="assetKind(asset) === 'audio' && waveformMap[asset.id]"
                      class="absolute inset-0 flex items-center justify-center p-2"
                    >
                      <TmcutWaveform :points="waveformMap[asset.id] ?? []" :width="96" :height="40" />
                    </div>
                    <UIcon
                      v-else
                      :name="assetKindIcon(asset)"
                      class="absolute inset-0 m-auto size-7 @[530px]:size-5 text-neutral-500 dark:text-neutral-600"
                    />
                    <span
                      v-if="assetDurationLabel(asset)"
                      class="absolute bottom-1 right-1 px-1 rounded bg-black/70 text-[9px] font-mono text-white"
                    >{{
                      assetDurationLabel(asset) }}</span>
                    <span
                      v-if="isAssetOnTimeline(asset)"
                      class="absolute top-1 left-1 px-1 rounded bg-primary text-[9px] font-medium text-white"
                    >{{
                      t('tmcut.media.addedBadge') }}</span>
                    <span
                      v-if="asset.proxyStatus === 'ready'"
                      class="absolute top-1 right-1 px-1 rounded bg-amber-500/90 text-[9px] font-bold text-black"
                    >PXY</span>

                    <!-- Hover actions: bottom-anchored strip on the
                         thumbnail (opacity-only reveal). -->
                    <div
                      class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-0.5 px-1 py-0.5 bg-black/60 opacity-0 group-hover/thumb:opacity-100 transition-opacity pointer-events-none group-hover/thumb:pointer-events-auto"
                    >
                      <!-- Missing assets swap the timeline plus for the
                           relink affordance (list-view icon pattern). -->
                      <UIcon
                        v-if="asset.status === 'missing'"
                        name="i-lucide-folder-search"
                        :title="t('tmcut.media.relink')"
                        class="size-4 text-warning cursor-pointer hover:opacity-75 transition-opacity pointer-events-auto"
                        @click.stop="handleRelink(asset)"
                      />
                      <UButton
                        v-else
                        icon="i-lucide-plus"
                        size="xs"
                        variant="solid"
                        color="primary"
                        :title="t('tmcut.media.addToTimeline')"
                        class="pointer-events-auto"
                        @click.stop="handleAddToTimeline(asset)"
                      />
                      <UButton
                        icon="i-lucide-folder-input"
                        size="xs"
                        variant="solid"
                        color="neutral"
                        :title="t('tmcut.folders.moveToFolder')"
                        class="pointer-events-auto hidden @[530px]:flex"
                        @click.stop="openMoveAssetModal(asset)"
                      />
                      <UButton
                        v-if="assetKind(asset) === 'video' && asset.status !== 'missing'"
                        :icon="asset.proxyStatus === 'generating' ? 'i-lucide-loader-circle' : 'i-lucide-zap'"
                        size="xs"
                        variant="solid"
                        :color="asset.proxyStatus === 'ready' ? 'warning' : 'neutral'"
                        :loading="asset.proxyStatus === 'generating'"
                        :title="asset.proxyStatus === 'ready' ? t('tmcut.proxy.ready') : t('tmcut.proxy.generate')"
                        class="pointer-events-auto"
                        @click.stop="handleProxyAction(asset)"
                      />
                      <UButton
                        icon="i-lucide-trash"
                        size="xs"
                        variant="solid"
                        color="error"
                        :title="t('tmcut.media.remove')"
                        class="pointer-events-auto"
                        @click.stop="handleRemoveAsset(asset)"
                      />
                    </div>
                  </div>
                  <div class="p-1 @[530px]:px-0.5 @[530px]:py-0.5">
                    <p
                      class="text-[11px] font-medium text-neutral-700 dark:text-neutral-200 truncate"
                      :title="asset.name"
                    >
                      {{ asset.name }}
                    </p>
                    <p class="text-[9px] font-mono text-neutral-500 truncate hidden @[530px]:block">
                      {{ assetMetaLabel(asset) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <!-- Text style presets -->
            <div v-else-if="mediaTab === 'text'" class="space-y-2">
              <div
                v-for="preset in textPresets"
                :key="preset.id"
                class="border border-neutral-300 dark:border-neutral-800 hover:border-primary/60 cursor-pointer rounded-lg p-3 bg-neutral-100/60 dark:bg-neutral-950/60 transition-colors"
                @click="handleAddTextPreset(preset)"
              >
                <p
                  class="font-bold text-center leading-tight truncate"
                  :style="{ color: preset.color, fontSize: `${Math.min(preset.fontSize, 28)}px` }"
                >
                  {{ preset.text }}
                </p>
                <p class="text-[10px] text-neutral-500 text-center mt-1.5">
                  {{ preset.name }}
                </p>
              </div>
              <p class="text-[10px] text-neutral-500 dark:text-neutral-600 text-center px-2">
                {{ t('tmcut.tabs.textHint') }}
              </p>
            </div>

            <!-- Sticker library (R124 A6, CapCut §3.4) -->
            <LazyTmcutStickerLibrary v-else-if="mediaTab === 'stickers'" />

            <!-- Effects / Transitions / Filters library (roadmap R112,
                 split into the mock's three tabs in R120) -->
            <LazyTmcutFxLibrary
              v-else-if="mediaTab === 'effects' || mediaTab === 'transitions' || mediaTab === 'filters'"
              :tab="fxTabProp"
            />

            <!-- On-demand Asset Center (roadmap v3 PART A): catalog, license
                 gate, verified installs, apply into the project. -->
            <LazyTmcutAssetCenter v-else-if="mediaTab === 'assets'" />

            <!-- Stock media (kho tài nguyên): free-for-commercial video /
                 image / music search, works on web and desktop. -->
            <LazyTmcutStockLibrary v-else-if="mediaTab === 'stock'" />

            <!-- Video Clips in Project -->
            <div v-if="currentProject?.timeline?.tracks" class="space-y-1.5 pt-2">
              <span class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider">
                {{ t('tmcut.media.clips') }}
              </span>
              <div v-for="track in currentProject.timeline.tracks" :key="track.id">
                <div
                  v-for="item in track.items"
                  :key="item.id"
                  class="group/clip flex items-center justify-between gap-1.5 p-2 rounded bg-neutral-100/80 dark:bg-neutral-900/80 border border-neutral-300/80 dark:border-neutral-800/80 text-xs hover:border-neutral-400 dark:hover:border-neutral-700 transition-colors"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <UIcon
                      :name="track.type === 'video' ? 'i-lucide-film' : track.type === 'text' ? 'i-lucide-type' : 'i-lucide-music'"
                      class="size-3.5 shrink-0"
                      :class="track.type === 'video' ? 'text-blue-400' : track.type === 'text' ? 'text-amber-400' : 'text-emerald-400'"
                    />
                    <span
                      class="truncate font-medium text-neutral-600 dark:text-neutral-300 text-[11px]"
                      :title="item.name || item.text"
                    >
                      {{ item.name || item.text || t('tmcut.project') }}
                    </span>
                  </div>

                  <div class="flex items-center gap-1 shrink-0">
                    <!-- Duration pinned far right; on hover the action
                         buttons fade in OVER it (user ask: seconds always
                         visible, hover shows buttons that cover them).
                         Works for video, audio and text rows alike. -->
                    <div class="relative flex items-center">
                      <span class="text-[9px] font-mono text-neutral-500">
                        {{ clipDurationSec(item).toFixed(1) }}s
                      </span>
                      <div
                        class="absolute right-0 inset-y-0 flex items-center gap-1 opacity-0 group-hover/clip:opacity-100 transition-opacity bg-neutral-100/80 dark:bg-neutral-900/80"
                      >
                        <UButton
                          v-if="item.src"
                          icon="i-lucide-eye"
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          :title="t('tmcut.previewFile')"
                          @click.stop="openFilePreview(item.src, item.name)"
                        />
                        <UButton
                          v-if="item.src"
                          icon="i-lucide-folder"
                          size="xs"
                          variant="ghost"
                          color="neutral"
                          :title="t('tmcut.openInFolder')"
                          @click.stop="showInFolder(item.src)"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <!-- Center Player Preview (compact, CapCut-style). The column spans
             the whole center panel so the HUD and the transport deck stretch
             edge to edge; only the monitor inside the stage is fitted, so the
             preview-quality selector resizes the picture — never the trays. -->
        <main
          class="flex-1 flex flex-col items-center justify-center bg-neutral-100 dark:bg-neutral-950 relative overflow-hidden min-w-0 min-h-0"
        >
          <div class="w-full h-full min-h-0 flex flex-col">
            <TmcutPreviewPlayer />
          </div>
        </main>

        <!-- Right Inspector Panel -->
        <aside
          id="tmcut-inspector-panel"
          class="absolute inset-y-0 right-0 z-20 xl:static w-72 max-w-full border-l border-neutral-300 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 flex-col overflow-y-auto p-4 shrink-0"
          :class="compactPanel === 'inspector' ? 'flex' : 'hidden xl:flex'"
        >
          <div class="flex items-center justify-between gap-2 pb-2 border-b border-neutral-300 dark:border-neutral-800 mb-3">
            <span class="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
              {{ t('tmcut.inspector') }}
            </span>
            <UButton
              class="xl:hidden"
              icon="i-lucide-x"
              size="xs"
              variant="ghost"
              color="neutral"
              :aria-label="t('tmcut.hotkeys.close')"
              @click="compactPanel = null"
            />
          </div>

          <TmcutInspector />
        </aside>
      </div>

      <!-- Bottom Timeline (h-72) -->
      <div
        class="h-72 border-t border-neutral-300 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-900 flex flex-col shrink-0 z-10"
      >
        <TmcutTimeline
          @open-export="showExportModal = true"
          @open-voice-studio="voiceStudioOpen = true"
        />
      </div>

      <!-- Status footer (design #2): honest project/engine info -->
      <div
        class="h-7 shrink-0 border-t border-neutral-300 dark:border-neutral-800 bg-neutral-100/70 dark:bg-neutral-900/70 px-4 flex items-center justify-between text-[11px] text-neutral-500"
      >
        <div class="flex items-center gap-3 min-w-0">
          <span class="text-neutral-600 dark:text-neutral-300 font-medium truncate">{{ currentProject?.name }}</span>
          <span v-if="currentProject?.canvas" class="font-mono shrink-0">
            {{ currentProject.canvas.width }}x{{ currentProject.canvas.height }} · {{
              canvasFpsValue(currentProject.canvas)
            }}fps
          </span>
          <span class="font-mono shrink-0">{{ formatTimecode(contentDuration) }}</span>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span>{{ t('tmcut.workspace.clipCount', { count: clipCount }) }}</span>
          <span class="flex items-center gap-1">
            <UIcon name="i-lucide-cpu" class="size-3" />
            {{ hardwareLabel }}
          </span>
        </div>
      </div>

      <!-- Export Modal -->
      <LazyTmcutExportModal v-model:open="showExportModal" />
      <LazyTmcutVoiceStudio v-model:open="voiceStudioOpen" />

      <!-- Export Queue Modal -->
      <LazyTmcutExportQueueModal v-model:open="queueModalOpen" />

      <!-- Custom Canvas Modal -->
      <UModal v-model:open="showCustomCanvasModal" :title="t('tmcut.canvas.customTitle')">
        <template #body>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label for="tmcut-canvas-width" class="text-xs text-neutral-500">{{ t('tmcut.canvas.width') }}</label>
                <UInput
                  id="tmcut-canvas-width"
                  v-model="customCanvas.width"
                  type="number"
                  :min="64"
                  :max="7680"
                  class="w-full mt-1"
                />
              </div>
              <div>
                <label for="tmcut-canvas-height" class="text-xs text-neutral-500">{{ t('tmcut.canvas.height') }}</label>
                <UInput
                  id="tmcut-canvas-height"
                  v-model="customCanvas.height"
                  type="number"
                  :min="64"
                  :max="4320"
                  class="w-full mt-1"
                />
              </div>
            </div>
            <div>
              <span class="text-xs text-neutral-500">{{ t('tmcut.canvas.fps') }}</span>
              <USelect
                v-model="customCanvas.fps"
                :aria-label="t('tmcut.canvas.fps')"
                :items="fpsOptions"
                class="w-full mt-1"
              />
            </div>
            <p class="text-[11px] text-neutral-500">
              {{ t('tmcut.canvas.customDesc') }}
            </p>
          </div>
        </template>
        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton variant="soft" color="neutral" @click="showCustomCanvasModal = false">
              {{ t('global.cancel') }}
            </UButton>
            <UButton color="primary" variant="solid" @click="applyCustomCanvas">
              {{ t('tmcut.canvas.apply') }}
            </UButton>
          </div>
        </template>
      </UModal>

      <!-- Snapshot Modal -->
      <UModal v-model:open="showSnapshotModal" :title="t('tmcut.snapshot.title')">
        <template #body>
          <div class="space-y-3">
            <div class="flex justify-end">
              <UButton
                icon="i-lucide-camera"
                size="xs"
                variant="soft"
                color="primary"
                @click="handleSaveSnapshot"
              >
                {{ t('tmcut.snapshot.save') }}
              </UButton>
            </div>

            <div
              v-if="snapshots.length === 0"
              class="border border-dashed border-neutral-300 dark:border-neutral-700 rounded-lg p-6 text-center"
            >
              <UIcon name="i-lucide-history" class="w-8 h-8 text-neutral-500 dark:text-neutral-400 mx-auto mb-2" />
              <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                {{ t('tmcut.snapshot.empty') }}
              </p>
              <p class="text-xs text-neutral-500 mt-1">
                {{ t('tmcut.snapshot.emptyDesc') }}
              </p>
            </div>

            <div v-else class="space-y-2 max-h-80 overflow-y-auto">
              <div
                v-for="snapshot in snapshots"
                :key="snapshot.ts"
                class="flex items-center justify-between gap-2 border border-neutral-200 dark:border-neutral-800 rounded-lg p-3"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {{ snapshot.name }}
                  </p>
                  <p class="text-xs text-neutral-500">
                    {{ new Date(snapshot.ts).toLocaleString() }}
                  </p>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <UButton size="xs" variant="soft" @click="handleRestoreSnapshot(snapshot.ts)">
                    {{ t('tmcut.snapshot.restore') }}
                  </UButton>
                  <UButton
                    size="xs"
                    variant="soft"
                    color="error"
                    icon="i-lucide-trash"
                    @click="handleDeleteSnapshot(snapshot.ts)"
                  />
                </div>
              </div>
            </div>
          </div>
        </template>
      </UModal>

      <!-- Direct Media Preview Modal -->
      <ToolsVideoPreviewModal v-model:open="previewModalOpen" :file-path="previewFilePath" :title="previewFileTitle" />

      <!-- Create Folder Modal (Roadmap G-3) -->
      <UModal v-model:open="createFolderModalOpen" :title="t('tmcut.folders.createTitle')">
        <template #body>
          <div class="space-y-4">
            <div class="space-y-1.5">
              <label for="tmcut-folder-create-name" class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ t('tmcut.folders.nameLabel')
              }}</label>
              <UInput
                id="tmcut-folder-create-name"
                v-model="newFolderName"
                :placeholder="t('tmcut.folders.namePlaceholder')"
                class="w-full"
                autofocus
                @keydown.enter="handleCreateFolder"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ t('tmcut.folders.colorLabel')
              }}</label>
              <div class="flex items-center gap-2">
                <button
                  v-for="c in folderTagColors"
                  :key="c"
                  type="button"
                  class="size-6 rounded-full transition-transform cursor-pointer border-2"
                  :class="newFolderColor === c ? 'scale-115 border-white ring-2 ring-primary/50' : 'border-transparent hover:border-white/60'"
                  :style="{ backgroundColor: c }"
                  @click="newFolderColor = c"
                />
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex items-center justify-end gap-2 w-full">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              @click="createFolderModalOpen = false"
            >
              {{ t('global.cancel') }}
            </UButton>
            <UButton
              size="xs"
              variant="solid"
              color="primary"
              :disabled="!newFolderName.trim()"
              @click="handleCreateFolder"
            >
              {{ t('tmcut.folders.create') }}
            </UButton>
          </div>
        </template>
      </UModal>

      <!-- Edit Folder Modal (Roadmap G-3) -->
      <UModal v-model:open="editFolderModalOpen" :title="t('tmcut.folders.editTitle')">
        <template #body>
          <div class="space-y-4">
            <div class="space-y-1.5">
              <label for="tmcut-folder-edit-name" class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ t('tmcut.folders.nameLabel')
              }}</label>
              <UInput
                id="tmcut-folder-edit-name"
                v-model="editingFolderName"
                :placeholder="t('tmcut.folders.namePlaceholder')"
                class="w-full"
                autofocus
                @keydown.enter="handleEditFolder"
              />
            </div>
            <div class="space-y-1.5">
              <label class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ t('tmcut.folders.colorLabel')
              }}</label>
              <div class="flex items-center gap-2">
                <button
                  v-for="c in folderTagColors"
                  :key="c"
                  type="button"
                  class="size-6 rounded-full transition-transform cursor-pointer border-2"
                  :class="editingFolderColor === c ? 'scale-115 border-white ring-2 ring-primary/50' : 'border-transparent hover:border-white/60'"
                  :style="{ backgroundColor: c }"
                  @click="editingFolderColor = c"
                />
              </div>
            </div>
          </div>
        </template>
        <template #footer>
          <div class="flex items-center justify-end gap-2 w-full">
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              @click="editFolderModalOpen = false"
            >
              {{ t('global.cancel') }}
            </UButton>
            <UButton
              size="xs"
              variant="solid"
              color="primary"
              :disabled="!editingFolderName.trim()"
              @click="handleEditFolder"
            >
              {{ t('global.save') }}
            </UButton>
          </div>
        </template>
      </UModal>

      <!-- Move Asset to Folder Modal (Roadmap G-3) -->
      <UModal v-model:open="moveAssetModalOpen" :title="t('tmcut.folders.moveToTitle')">
        <template #body>
          <div class="space-y-2">
            <p v-if="targetMoveAsset" class="text-xs text-neutral-500 dark:text-neutral-400 truncate mb-3">
              {{ targetMoveAsset.name }}
            </p>
            <!-- Unassigned / Clear folder option -->
            <button
              type="button"
              class="w-full flex items-center justify-between p-2.5 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 bg-neutral-100/60 dark:bg-neutral-900/60 transition-colors cursor-pointer text-left"
              @click="targetMoveAsset && handleMoveAsset(targetMoveAsset.id, null)"
            >
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-folder-minus" class="size-4 text-neutral-500 dark:text-neutral-400" />
                <span class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{
                  t('tmcut.folders.clearFolder') }}</span>
              </div>
              <UIcon
                v-if="targetMoveAsset && !getAssetFolderId(targetMoveAsset)"
                name="i-lucide-check"
                class="size-4 text-primary"
              />
            </button>

            <!-- List of existing folders -->
            <div v-if="projectFolders.length === 0" class="py-4 text-center text-xs text-neutral-500">
              {{ t('tmcut.folders.noFolders') }}
            </div>
            <button
              v-for="folder in projectFolders"
              :key="folder.id"
              type="button"
              class="w-full flex items-center justify-between p-2.5 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 bg-neutral-100/60 dark:bg-neutral-900/60 transition-colors cursor-pointer text-left"
              @click="targetMoveAsset && handleMoveAsset(targetMoveAsset.id, folder.id)"
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: folder.color || '#3b82f6' }" />
                <span class="text-xs font-medium text-neutral-700 dark:text-neutral-200 truncate">{{ folder.name
                }}</span>
                <span class="text-[10px] text-neutral-500 font-mono">({{ folderCounts[folder.id] || 0 }})</span>
              </div>
              <UIcon
                v-if="targetMoveAsset && getAssetFolderId(targetMoveAsset) === folder.id"
                name="i-lucide-check"
                class="size-4 text-primary shrink-0"
              />
            </button>
          </div>
        </template>
      </UModal>

      <!-- AI Script & Storyboard Modal (Roadmap H-2) -->
      <LazyTmcutAiScriptModal v-model:open="aiScriptModalOpen" />
      <LazyTmcutAiEditor v-model:open="aiEditorModalOpen" />

      <!-- Agent & voice commands (Roadmap v1 §4) -->
      <LazyTmcutAgentPanel v-model:open="agentPanelOpen" />

      <!-- Audio orchestration (Phase 8 §24) -->
      <LazyTmcutAudioOrchestrationModal v-model:open="audioOrchestrationOpen" />
    </div>
  </BasePage>
</template>
