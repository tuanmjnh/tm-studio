<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutMediaImport } from '~/composables/useTmcutMediaImport'
import { useTmcutUiPrefs } from '~/composables/useTmcutUiPrefs'
import { useTmcutEditorCanvas } from '~/composables/useTmcutEditorCanvas'
import { useTmcutEditorDialogs } from '~/composables/useTmcutEditorDialogs'
import { useAgentProposalCount } from '~/composables/useTmcutAgentTools'
import { useMcpRendererBridge } from '~/composables/useMcpRendererBridge'
import { useTmcutTemplates } from '~/composables/useTmcutTemplates'
import { findCanvasPreset, canvasFpsValue, normalizeCanvas } from '~/utils/tmcut/canvas'
import { instantiateTemplate } from 'tmcut-core'
import { parseTemplateFile } from '~/utils/tmcut/templateIo'
import { tmcutHostBridge } from '~/utils/tmcut/hostBridge'
import { disposeFrameService } from '~/utils/tmcut/frameStore'
import type { TmcutTrack } from '~/composables/useTmcutProject'

definePageMeta({ layout: 'studio' })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const {
  currentProject,
  loadProject,
  saveProject,
  saveStatus,
  lastSavedAt,
  refreshProjects,
  loadSnapshots,
  pushHistory,
  revisionAtLoad,
  currentRevision
} = useTmcutProject()

const { loadLibrary, checkMissing } = useTmcutMedia()

const { handleImportMedia } = useTmcutMediaImport()
const { shortcutsOpen } = useTmcutUiPrefs()
const {
  showExportModal,
  showSnapshotModal,
  aiScriptModalOpen,
  aiEditorModalOpen,
  agentPanelOpen,
  audioOrchestrationOpen,
  saveSnapshot,
  closeAllDialogs
} = useTmcutEditorDialogs()

const { canvasLabel, canvasMenuItems, handleDuplicateAs } = useTmcutEditorCanvas()

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

// Shared with the toolbar (panel toggles) and the workspace (overlays on
// compact viewports).
const compactPanel = ref<'media' | 'inspector' | null>(null)

const saveLabel = computed(() => {
  if (saveStatus.value === 'saving') return t('tmcut.save.saving')
  if (saveStatus.value === 'saved') return t('tmcut.save.saved')
  if (saveStatus.value === 'error') return t('tmcut.save.error')
  return ''
})

const staleRevision = computed(() => revisionAtLoad.value !== null && currentRevision() > revisionAtLoad.value)

onMounted(async () => {
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
    const bridge = tmcutHostBridge()
    if (bridge?.mcp?.respond) {
      bridge.mcp.respond(event.payload.requestId || '', event)
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleEditorKeydown)
  // The dialog flags live at module scope, so the editor session ends them —
  // the dock may still be an unresolved lazy chunk and cannot self-reset.
  closeAllDialogs()
  // The frame cache and its decoder pool are module-scope too: every strip the
  // timeline painted is an object URL only this service can revoke (slice F10).
  disposeFrameService()
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
      onSelect: () => saveSnapshot()
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
  const api = tmcutHostBridge()
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

    <!-- The navbar renders its title as a span, so a full-bleed workspace is a
         page with no heading at all; this gives AT one without adding chrome. -->
    <h1 class="sr-only">
      {{ currentProject?.name || t('tmcut.editor') }}
    </h1>

    <TmcutEditorWorkspace v-model="compactPanel" />
  </BasePage>
</template>
