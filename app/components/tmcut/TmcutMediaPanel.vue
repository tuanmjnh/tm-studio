<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { TmcutAsset, TmcutMediaFolder } from '~/types/tmcut'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutMediaImport } from '~/composables/useTmcutMediaImport'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutRecorder } from '~/composables/useTmcutRecorder'
import { useFileSystem } from '~/composables/useFileSystem'
import { formatDurationSec, formatFileSize, mediaFileKey } from '~/utils/tmcut/media'
import { TMCUT_ASSET_MIME } from '~/utils/tmcut/dnd'
import type { TmcutAssetDragPayload } from '~/utils/tmcut/dnd'
import { filterAssetsByFolder, secToTicks, TICKS_PER_SECOND } from '@tmcut-core'
import { clipDurationSec } from '~/utils/tmcut/clipTime'
import { effectiveAssetKind } from '~/utils/tmcut/assetKind'

/**
 * Left media dock: category tabs, asset bin (list/grid), folders, voiceover,
 * proxies and the external-file drop target. Mobile shows it as an overlay;
 * `mobileOpen` mirrors the page's compact panel state.
 */
defineProps<{ mobileOpen: boolean }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const toast = useToast()

const { currentProject, addClipToTrack } = useTmcutProject()
const {
  projectAssets,
  missingAssets,
  analyzingCount,
  importing,
  importError,
  webUpload,
  isDesktop,
  generateProxy,
  persistLibrary,
  importFiles,
  importWebFiles,
  uploadWebFile,
  uploadVideoThumb,
  probeWebMedia,
  captureVideoThumb,
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

const { playhead } = useTmcutPlayback()
const { pickFile, pickWebFiles } = useFileSystem()
const { mediaFilters, handleImportMedia } = useTmcutMediaImport()

const {
  recording: recordingVoiceover,
  saving: savingVoiceover,
  elapsedSec: voiceoverElapsed,
  start: startVoiceover,
  stop: stopVoiceover
} = useTmcutRecorder()

const thumbErrors = ref<Record<string, boolean>>({})
const waveformMap = ref<Record<string, number[]>>({})

// Direct file preview state (clip list at the bottom of the bin)
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
// ===== Voiceover recording (roadmap D-4) =====
// Mic button in the media bin header: getUserMedia + MediaRecorder
// (web + desktop); the blob lands through the normal import pipeline
// (desktop writes a real file via IPC — FFmpeg export needs paths).
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
</script>

<template>
  <aside
    id="tmcut-media-panel"
    class="@container absolute inset-y-0 left-0 z-20 w-[min(90%,22.5rem)] xl:static xl:w-[var(--tmcut-media-w)] xl:min-w-66 xl:max-w-140 border-r border-default bg-default flex-col shrink-0"
    :class="[mobileOpen ? 'flex' : 'hidden xl:flex', dropActive ? 'ring-2 ring-primary/60' : '']"
    @dragenter="onMediaPanelDragEnter"
    @dragover="onMediaPanelDragOver"
    @dragleave="onMediaPanelDragLeave"
    @drop="onMediaPanelDrop"
  >
    <div class="p-3 border-b border-default flex items-center justify-between gap-1">
      <span
        class="text-xs font-semibold text-muted uppercase tracking-wider truncate"
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
          @click="emit('close')"
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
          :aria-label="t('tmcut.proxy.generateAll')"
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
          :aria-label="t('tmcut.media.voiceoverStart')"
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
    <div class="flex flex-wrap items-center gap-1 px-2 py-2 border-b border-default">
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
      class="px-2 pt-2 pb-1.5 space-y-1.5 border-b border-default/80"
    >
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1 text-[11px] font-medium text-muted">
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
          :class="selectedFolderId === null ? 'bg-primary/20 border-primary text-primary font-semibold' : 'bg-accented/60 border-default hover:border-accented text-toned'"
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
          :class="selectedFolderId === folder.id ? 'bg-primary/20 border-primary text-primary font-semibold' : 'bg-accented/60 border-default hover:border-accented text-toned'"
          tabindex="0"
          @click="selectedFolderId = folder.id"
          @keydown.enter.self.prevent="selectedFolderId = folder.id"
          @keydown.space.self.prevent="selectedFolderId = folder.id"
          @dragover.prevent="onFolderDragOver($event)"
          @drop.prevent="onFolderDrop($event, folder.id)"
        >
          <span class="size-2 rounded-full shrink-0" :style="{ backgroundColor: folder.color || '#3b82f6' }" />
          <span class="truncate max-w-22.5" :title="folder.name">{{ folder.name }}</span>
          <span class="text-[10px] opacity-75 font-mono">({{ folderCounts[folder.id] || 0 }})</span>
          <UDropdownMenu :items="folderActionItems(folder)" :content="{ side: 'bottom', align: 'start' }">
            <button
              type="button"
              class="p-0.5 rounded hover:bg-accented text-muted hover:text-highlighted"
              :aria-label="t('tmcut.folders.actions')"
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
          :class="selectedFolderId === '__unassigned__' ? 'bg-warning-500/20 border-warning-500 text-warning-300 font-semibold' : 'bg-accented/60 border-default hover:border-accented text-muted'"
          @click="selectedFolderId = '__unassigned__'"
          @dragover.prevent="onFolderDragOver($event)"
          @drop.prevent="onFolderDrop($event, null)"
        >
          <UIcon name="i-lucide-folder-archive" class="size-3 text-muted" />
          <span>{{ t('tmcut.folders.unassigned') }}</span>
          <span class="text-[10px] opacity-75 font-mono">({{ folderCounts.unassigned ?? 0 }})</span>
        </button>
      </div>
    </div>

    <div
      v-if="missingAssets.length > 0"
      class="mx-3 mt-2 px-2.5 py-2 rounded-lg bg-warning-500/10 border border-warning-500/30 text-[11px] text-warning-200"
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
      <div class="text-[10px] uppercase tracking-wide text-muted">
        {{ t('tmcut.media.assets') }} · {{ filteredAssets.length }}
      </div>
      <div class="flex items-center gap-0.5 rounded-md border border-default p-0.5">
        <UButton
          icon="i-lucide-list"
          size="xs"
          variant="ghost"
          :color="mediaView === 'list' ? 'primary' : 'neutral'"
          :aria-label="t('tmcut.media.viewList')"
          :title="t('tmcut.media.viewList')"
          @click="mediaView = 'list'"
        />
        <UButton
          icon="i-lucide-grid-2x2"
          size="xs"
          variant="ghost"
          :color="mediaView === 'grid' ? 'primary' : 'neutral'"
          :aria-label="t('tmcut.media.viewGrid')"
          :title="t('tmcut.media.viewGrid')"
          @click="mediaView = 'grid'"
        />
      </div>
    </div>

    <div ref="mediaScrollRef" class="flex-1 overflow-y-auto p-3 space-y-2" @scroll="onMediaBinScroll">
      <!-- Loading indicator -->
      <div
        v-if="importing || analyzingCount > 0"
        class="flex items-center gap-2 px-2 py-3 text-xs text-muted"
      >
        <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
        {{ t('tmcut.media.importing') }}
      </div>

      <!-- CapCut-style thumbnail grid (Media / Video / Audio / Image tabs) -->
      <div v-else-if="isAssetTab">
        <div
          v-if="filteredAssets.length === 0"
          class="border border-dashed border-default hover:border-primary/50 cursor-pointer rounded-lg p-4 text-center transition-colors group"
          role="button"
          tabindex="0"
          @click="handleImportMedia"
          @keydown.enter.self.prevent="handleImportMedia"
          @keydown.space.self.prevent="handleImportMedia"
        >
          <UIcon
            name="i-lucide-upload-cloud"
            class="size-7 mx-auto text-muted group-hover:text-primary mb-1.5 transition-colors"
          />
          <p
            class="text-xs text-muted group-hover:text-toned font-medium"
          >
            {{ t('tmcut.media.empty') }}
          </p>
          <p class="text-[10px] text-muted mt-1">
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
            class="group/thumb relative flex gap-2 p-1.5 min-w-0 rounded-md bg-accented/60 cursor-pointer border transition-colors"
            :class="asset.status === 'missing' ? 'border-warning-500/60' : 'border-transparent hover:border-primary/60'"
            :title="asset.name"
            :draggable="asset.status !== 'missing'"
            tabindex="0"
            @click="asset.status !== 'missing' && handleAddToTimeline(asset)"
            @keydown.enter.self.prevent="asset.status !== 'missing' && handleAddToTimeline(asset)"
            @keydown.space.self.prevent="asset.status !== 'missing' && handleAddToTimeline(asset)"
            @dragstart="handleAssetDragStart($event, asset)"
          >
            <div class="relative w-24 h-14 rounded overflow-hidden shrink-0 bg-accented dark:bg-studio-panel">
              <img
                v-if="assetKind(asset) !== 'audio' && asset.thumbPath && !thumbErrors[asset.id]"
                :src="getThumbUrl(asset)"
                alt=""
                draggable="false"
                class="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                decoding="async"
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
                class="absolute inset-0 m-auto size-6 text-muted"
              />

              <div
                v-if="asset.status === 'analyzing'"
                class="absolute inset-0 bg-black/50 flex items-center justify-center"
              >
                <UIcon
                  name="i-lucide-loader-circle"
                  class="size-4 animate-spin text-toned"
                />
              </div>
              <div
                v-if="asset.status === 'missing'"
                class="absolute inset-0 bg-warning-950/60 flex items-center justify-center"
              >
                <UIcon name="i-lucide-alert-triangle" class="size-4 text-warning-400" />
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
                class="absolute px-1 rounded bg-warning-500/90 text-[9px] font-bold text-black flex items-center gap-0.5"
                :class="isAssetOnTimeline(asset) ? 'top-4 left-0.5' : 'top-0.5 left-0.5'"
                :title="t('tmcut.proxy.readyDesc')"
              >
                <UIcon name="i-lucide-zap" class="size-2.5 text-black" />
                <span>PXY</span>
              </span>
              <span
                v-else-if="asset.proxyStatus === 'generating'"
                class="absolute px-1 rounded bg-warning-500/30 border border-warning-500/50 text-[9px] font-medium text-warning-200 flex items-center gap-0.5"
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
                class="text-[11px] font-medium text-toned truncate"
                :title="asset.name"
              >
                {{ asset.name }}
              </p>
              <p class="text-[9px] font-mono text-muted truncate">
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
              <p v-if="asset.status === 'missing'" class="text-[9px] font-medium text-warning-400 truncate">
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
                :aria-label="t('tmcut.media.addToTimeline')"
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
                :aria-label="asset.proxyStatus === 'ready' ? t('tmcut.proxy.ready') : t('tmcut.proxy.generate')"
                :title="asset.proxyStatus === 'ready' ? t('tmcut.proxy.ready') : t('tmcut.proxy.generate')"
                class="pointer-events-none group-hover/thumb:pointer-events-auto"
                @click.stop="handleProxyAction(asset)"
              />
              <UButton
                icon="i-lucide-folder-input"
                size="xs"
                variant="ghost"
                color="neutral"
                :aria-label="t('tmcut.folders.moveToFolder')"
                :title="t('tmcut.folders.moveToFolder')"
                class="pointer-events-none group-hover/thumb:pointer-events-auto"
                @click.stop="openMoveAssetModal(asset)"
              />
              <UButton
                icon="i-lucide-trash"
                size="xs"
                variant="ghost"
                color="error"
                :aria-label="t('tmcut.media.remove')"
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
            class="group/thumb relative rounded-md bg-accented/60 cursor-pointer border transition-colors overflow-hidden"
            :class="asset.status === 'missing' ? 'border-warning-500/60' : 'border-transparent hover:border-primary/60'"
            :title="asset.name"
            :draggable="asset.status !== 'missing'"
            tabindex="0"
            @click="asset.status !== 'missing' && handleAddToTimeline(asset)"
            @keydown.enter.self.prevent="asset.status !== 'missing' && handleAddToTimeline(asset)"
            @keydown.space.self.prevent="asset.status !== 'missing' && handleAddToTimeline(asset)"
            @dragstart="handleAssetDragStart($event, asset)"
          >
            <div class="relative aspect-video bg-accented dark:bg-studio-panel">
              <img
                v-if="assetKind(asset) !== 'audio' && asset.thumbPath && !thumbErrors[asset.id]"
                :src="getThumbUrl(asset)"
                alt=""
                draggable="false"
                class="absolute inset-0 w-full h-full object-cover"
                loading="lazy"
                decoding="async"
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
                class="absolute inset-0 m-auto size-7 @[530px]:size-5 text-muted"
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
                class="absolute top-1 right-1 px-1 rounded bg-warning-500/90 text-[9px] font-bold text-black"
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
                  :aria-label="t('tmcut.media.addToTimeline')"
                  :title="t('tmcut.media.addToTimeline')"
                  class="pointer-events-auto"
                  @click.stop="handleAddToTimeline(asset)"
                />
                <UButton
                  icon="i-lucide-folder-input"
                  size="xs"
                  variant="solid"
                  color="neutral"
                  :aria-label="t('tmcut.folders.moveToFolder')"
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
                  :aria-label="asset.proxyStatus === 'ready' ? t('tmcut.proxy.ready') : t('tmcut.proxy.generate')"
                  :title="asset.proxyStatus === 'ready' ? t('tmcut.proxy.ready') : t('tmcut.proxy.generate')"
                  class="pointer-events-auto"
                  @click.stop="handleProxyAction(asset)"
                />
                <UButton
                  icon="i-lucide-trash"
                  size="xs"
                  variant="solid"
                  color="error"
                  :aria-label="t('tmcut.media.remove')"
                  :title="t('tmcut.media.remove')"
                  class="pointer-events-auto"
                  @click.stop="handleRemoveAsset(asset)"
                />
              </div>
            </div>
            <div class="p-1 @[530px]:px-0.5 @[530px]:py-0.5">
              <p
                class="text-[11px] font-medium text-toned truncate"
                :title="asset.name"
              >
                {{ asset.name }}
              </p>
              <p class="text-[9px] font-mono text-muted truncate hidden @[530px]:block">
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
          class="border border-default hover:border-primary/60 cursor-pointer rounded-lg p-3 bg-muted/60 dark:bg-studio-panel/60 transition-colors"
          role="button"
          tabindex="0"
          @click="handleAddTextPreset(preset)"
          @keydown.enter.self.prevent="handleAddTextPreset(preset)"
          @keydown.space.self.prevent="handleAddTextPreset(preset)"
        >
          <p
            class="font-bold text-center leading-tight truncate"
            :style="{ color: preset.color, fontSize: `${Math.min(preset.fontSize, 28)}px` }"
          >
            {{ preset.text }}
          </p>
          <p class="text-[10px] text-muted text-center mt-1.5">
            {{ preset.name }}
          </p>
        </div>
        <p class="text-[10px] text-muted text-center px-2">
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
        <span class="text-[10px] font-semibold text-muted uppercase tracking-wider">
          {{ t('tmcut.media.clips') }}
        </span>
        <div v-for="track in currentProject.timeline.tracks" :key="track.id">
          <div
            v-for="item in track.items"
            :key="item.id"
            class="group/clip flex items-center justify-between gap-1.5 p-2 rounded bg-default/80 border border-default/80 text-xs hover:border-accented transition-colors"
          >
            <div class="flex items-center gap-2 min-w-0">
              <UIcon
                :name="track.type === 'video' ? 'i-lucide-film' : track.type === 'text' ? 'i-lucide-type' : 'i-lucide-music'"
                class="size-3.5 shrink-0"
                :class="track.type === 'video' ? 'text-blue-400' : track.type === 'text' ? 'text-warning-400' : 'text-emerald-400'"
              />
              <span
                class="truncate font-medium text-toned text-[11px]"
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
                <span class="text-[9px] font-mono text-muted">
                  {{ clipDurationSec(item).toFixed(1) }}s
                </span>
                <div
                  class="absolute right-0 inset-y-0 flex items-center gap-1 opacity-0 group-hover/clip:opacity-100 transition-opacity bg-default/80"
                >
                  <UButton
                    v-if="item.src"
                    icon="i-lucide-eye"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :aria-label="t('tmcut.previewFile')"
                    :title="t('tmcut.previewFile')"
                    @click.stop="openFilePreview(item.src, item.name)"
                  />
                  <UButton
                    v-if="item.src"
                    icon="i-lucide-folder"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :aria-label="t('tmcut.openInFolder')"
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

  <!-- Direct Media Preview Modal -->
  <ToolsVideoPreviewModal v-model:open="previewModalOpen" :file-path="previewFilePath" :title="previewFileTitle" />

  <!-- Create Folder Modal (Roadmap G-3) -->
  <UModal v-model:open="createFolderModalOpen" :title="t('tmcut.folders.createTitle')">
    <template #body>
      <div class="space-y-4">
        <div class="space-y-1.5">
          <label for="tmcut-folder-create-name" class="text-xs font-medium text-toned">{{ t('tmcut.folders.nameLabel')
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
          <label class="text-xs font-medium text-toned">{{ t('tmcut.folders.colorLabel')
          }}</label>
          <div class="flex items-center gap-2">
            <button
              v-for="c in folderTagColors"
              :key="c"
              type="button"
              class="size-6 rounded-full transition-transform cursor-pointer border-2"
              :class="newFolderColor === c ? 'scale-115 border-white ring-2 ring-primary/50' : 'border-transparent hover:border-white/60'"
              :style="{ backgroundColor: c }"
              :aria-label="t('tmcut.folders.colorOption', { color: c })"
              :aria-pressed="newFolderColor === c"
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
          <label for="tmcut-folder-edit-name" class="text-xs font-medium text-toned">{{ t('tmcut.folders.nameLabel')
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
          <label class="text-xs font-medium text-toned">{{ t('tmcut.folders.colorLabel')
          }}</label>
          <div class="flex items-center gap-2">
            <button
              v-for="c in folderTagColors"
              :key="c"
              type="button"
              class="size-6 rounded-full transition-transform cursor-pointer border-2"
              :class="editingFolderColor === c ? 'scale-115 border-white ring-2 ring-primary/50' : 'border-transparent hover:border-white/60'"
              :style="{ backgroundColor: c }"
              :aria-label="t('tmcut.folders.colorOption', { color: c })"
              :aria-pressed="editingFolderColor === c"
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
        <p v-if="targetMoveAsset" class="text-xs text-muted truncate mb-3">
          {{ targetMoveAsset.name }}
        </p>
        <!-- Unassigned / Clear folder option -->
        <button
          type="button"
          class="w-full flex items-center justify-between p-2.5 rounded-lg border border-default hover:border-accented bg-default/60 transition-colors cursor-pointer text-left"
          @click="targetMoveAsset && handleMoveAsset(targetMoveAsset.id, null)"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-folder-minus" class="size-4 text-muted" />
            <span class="text-xs font-medium text-toned">{{
              t('tmcut.folders.clearFolder') }}</span>
          </div>
          <UIcon
            v-if="targetMoveAsset && !getAssetFolderId(targetMoveAsset)"
            name="i-lucide-check"
            class="size-4 text-primary"
          />
        </button>

        <!-- List of existing folders -->
        <div v-if="projectFolders.length === 0" class="py-4 text-center text-xs text-muted">
          {{ t('tmcut.folders.noFolders') }}
        </div>
        <button
          v-for="folder in projectFolders"
          :key="folder.id"
          type="button"
          class="w-full flex items-center justify-between p-2.5 rounded-lg border border-default hover:border-accented bg-default/60 transition-colors cursor-pointer text-left"
          @click="targetMoveAsset && handleMoveAsset(targetMoveAsset.id, folder.id)"
        >
          <div class="flex items-center gap-2 min-w-0">
            <span class="size-3 rounded-full shrink-0" :style="{ backgroundColor: folder.color || '#3b82f6' }" />
            <span class="text-xs font-medium text-toned truncate">{{ folder.name
            }}</span>
            <span class="text-[10px] text-muted font-mono">({{ folderCounts[folder.id] || 0 }})</span>
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
</template>
