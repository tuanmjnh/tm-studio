<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutMediaImport } from '~/composables/useTmcutMediaImport'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutUiPrefs } from '~/composables/useTmcutUiPrefs'
import { useTmcutEditorLayout } from '~/composables/useTmcutEditorLayout'
import { useAgentProposalCount } from '~/composables/useTmcutAgentTools'
import { useMcpRendererBridge } from '~/composables/useMcpRendererBridge'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutTemplates } from '~/composables/useTmcutTemplates'
import { TMUTCANVAS_PRESETS, TMUTCUT_SOCIAL_PRESETS, findCanvasPreset, findCanvasPresetByDimensions, ratioLabel, canvasFpsValue, normalizeCanvas } from '~/utils/tmcut/canvas'
import { instantiateTemplate } from '@tmcut-core'
import { parseTemplateFile } from '~/utils/tmcut/templateIo'
import type { TmcutTrack } from '~/composables/useTmcutProject'

definePageMeta({ layout: 'studio' })

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
  pushHistory,
  revisionAtLoad,
  currentRevision
} = useTmcutProject()

const {
  isDesktop,
  loadLibrary,
  uploadWebFile,
  checkMissing
} = useTmcutMedia()

const { formatTimecode } = useTmcutPlayback()
const { mediaFilters, handleImportMedia } = useTmcutMediaImport()
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

// Desktop dock sizes persist per browser; mobile overlays ignore them.
// The resize handles read the same refs through the shared composable.
const { layoutVars, timelineHeight, hydrateLayout } = useTmcutEditorLayout()

const saveLabel = computed(() => {
  if (saveStatus.value === 'saving') return t('tmcut.save.saving')
  if (saveStatus.value === 'saved') return t('tmcut.save.saved')
  if (saveStatus.value === 'error') return t('tmcut.save.error')
  return ''
})

const staleRevision = computed(() => revisionAtLoad.value !== null && currentRevision() > revisionAtLoad.value)

const statusCanvasLabel = computed(() => {
  const canvas = currentProject.value?.canvas
  if (!canvas) return null
  return `${canvas.width}x${canvas.height} · ${canvasFpsValue(canvas)}fps`
})

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
  hydrateLayout()
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

const canvasLabel = computed(() => {
  const canvas = currentProject.value?.canvas
  if (!canvas) return ''
  return `${currentRatioLabel.value} (${canvasFpsValue(canvas)}fps)`
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
    hide-default-actions
  >
    <template #left>
      <div class="flex min-w-0 items-center gap-2">
        <UButton
          to="/tmcut"
          icon="i-lucide-arrow-left"
          size="sm"
          variant="ghost"
          color="neutral"
          :aria-label="t('tmcut.back')"
          :title="t('tmcut.back')"
        />
        <TmcutNavPopover />
        <UIcon name="i-lucide-clapperboard" class="size-5 text-primary shrink-0" />
        <input
          v-if="currentProject"
          id="tmcut-project-name"
          v-model="currentProject.name"
          :aria-label="t('tmcut.templateLibrary.projectNameLabel')"
          class="bg-transparent border-none font-semibold text-sm text-highlighted focus:outline-none focus:ring-1 focus:ring-primary rounded px-1.5 py-0.5 min-w-0 w-36 2xl:w-50 truncate"
          @blur="saveProject()"
        >
      </div>
    </template>

    <template #right>
      <TmcutEditorToolbar
        :compact-panel="compactPanel"
        :has-canvas="Boolean(currentProject?.canvas)"
        :canvas-label="canvasLabel"
        :canvas-menu-items="canvasMenuItems"
        :save-label="saveLabel"
        :save-status="saveStatus"
        :last-saved-at="lastSavedAt"
        :stale-revision="staleRevision"
        :active-jobs-count="activeJobsCount"
        :pending-agent-ops="pendingAgentOps"
        :extra-actions="editorExtraActions"
        @toggle-panel="compactPanel = compactPanel === $event ? null : $event"
        @shortcuts="shortcutsOpen = true"
        @queue="queueModalOpen = true"
        @ai-script="aiScriptModalOpen = true"
        @ai-editor="aiEditorModalOpen = true"
        @agent="agentPanelOpen = true"
        @audio="audioOrchestrationOpen = true"
        @export="showExportModal = true"
        @save="saveProject()"
      />
    </template>

    <!-- Full viewport Workspace (flush p-0) -->
    <div
      class="flex-1 flex flex-col min-h-0 bg-muted dark:bg-studio-canvas text-highlighted overflow-hidden select-none"
      :style="layoutVars"
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
        <TmcutMediaPanel
          :mobile-open="compactPanel === 'media'"
          @close="compactPanel = null"
        />

        <!-- Media dock resize handle (desktop only) -->
        <TmcutResizeHandle panel="media" :label="t('tmcut.workspace.resizeMedia')" />

        <!-- Center Player Preview (compact, CapCut-style). The column spans
             the whole center panel so the HUD and the transport deck stretch
             edge to edge; only the monitor inside the stage is fitted, so the
             preview-quality selector resizes the picture — never the trays. -->
        <main
          class="flex-1 flex flex-col items-center justify-center bg-muted dark:bg-studio-canvas relative overflow-hidden min-w-0 min-h-0"
        >
          <div class="w-full h-full min-h-0 flex flex-col">
            <TmcutPreviewPlayer />
          </div>
        </main>

        <!-- Inspector dock resize handle (desktop only) -->
        <TmcutResizeHandle panel="inspector" :label="t('tmcut.workspace.resizeInspector')" />

        <!-- Right Inspector Panel -->
        <aside
          id="tmcut-inspector-panel"
          class="absolute inset-y-0 right-0 z-20 xl:static w-72 xl:w-[var(--tmcut-inspector-w)] max-w-full border-l border-default bg-default flex-col overflow-y-auto p-4 shrink-0"
          :class="compactPanel === 'inspector' ? 'flex' : 'hidden xl:flex'"
        >
          <div class="flex items-center justify-between gap-2 pb-2 border-b border-default mb-3">
            <span class="text-xs font-semibold text-muted uppercase tracking-wider">
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

      <!-- Timeline resize handle -->
      <TmcutResizeHandle panel="timeline" :label="t('tmcut.workspace.resizeTimeline')" />

      <!-- Bottom Timeline (resizable, persisted) -->
      <div
        class="border-t border-default bg-default flex flex-col shrink-0 z-10 max-h-[55vh]"
        :style="{ height: `${timelineHeight}px` }"
      >
        <TmcutTimeline
          @open-export="showExportModal = true"
          @open-voice-studio="voiceStudioOpen = true"
        />
      </div>

      <!-- Status footer (design #2): honest project/engine info -->
      <TmcutEditorStatusBar
        :project-name="currentProject?.name"
        :canvas-label="statusCanvasLabel"
        :timecode="formatTimecode(contentDuration)"
        :clip-count="clipCount"
        :hardware-label="hardwareLabel"
      />

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
                <label for="tmcut-canvas-width" class="text-xs text-muted">{{ t('tmcut.canvas.width') }}</label>
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
                <label for="tmcut-canvas-height" class="text-xs text-muted">{{ t('tmcut.canvas.height') }}</label>
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
              <span class="text-xs text-muted">{{ t('tmcut.canvas.fps') }}</span>
              <USelect
                v-model="customCanvas.fps"
                :aria-label="t('tmcut.canvas.fps')"
                :items="fpsOptions"
                class="w-full mt-1"
              />
            </div>
            <p class="text-[11px] text-muted">
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
              class="border border-dashed border-default rounded-lg p-6 text-center"
            >
              <UIcon name="i-lucide-history" class="w-8 h-8 text-muted mx-auto mb-2" />
              <p class="text-sm font-medium text-highlighted">
                {{ t('tmcut.snapshot.empty') }}
              </p>
              <p class="text-xs text-muted mt-1">
                {{ t('tmcut.snapshot.emptyDesc') }}
              </p>
            </div>

            <div v-else class="space-y-2 max-h-80 overflow-y-auto">
              <div
                v-for="snapshot in snapshots"
                :key="snapshot.ts"
                class="flex items-center justify-between gap-2 border border-default rounded-lg p-3"
              >
                <div class="min-w-0">
                  <p class="text-sm font-medium text-highlighted truncate">
                    {{ snapshot.name }}
                  </p>
                  <p class="text-xs text-muted">
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
                    :aria-label="t('tmcut.snapshot.delete')"
                    @click="handleDeleteSnapshot(snapshot.ts)"
                  />
                </div>
              </div>
            </div>
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
