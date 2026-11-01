<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutEditorLayout } from '~/composables/useTmcutEditorLayout'
import { useTmcutEditorDialogs } from '~/composables/useTmcutEditorDialogs'
import { useTmcutEditorCanvas } from '~/composables/useTmcutEditorCanvas'

const { t } = useI18n()
const toast = useToast()

// The workspace owns its dock state: media/inspector overlays on compact
// viewports, the persisted dock sizes, the recovery banner and the footer
// metrics. The page keeps only the navbar and the toolbar.
const compactPanel = defineModel<'media' | 'inspector' | null>({ default: null })

const {
  currentProject,
  contentDuration,
  pendingRecovery,
  applyRecovery,
  dismissRecovery
} = useTmcutProject()
const { isDesktop } = useTmcutMedia()
const { formatTimecode } = useTmcutPlayback()
const { layoutVars, timelineHeight, hydrateLayout } = useTmcutEditorLayout()
const { showExportModal, voiceStudioOpen } = useTmcutEditorDialogs()
const { statusCanvasLabel } = useTmcutEditorCanvas()

// WebGPU availability is really detectable; the engine side names the
// export backend (FFmpeg on desktop, preview-only on the web).
const hasWebGPU = ref(false)
const hardwareLabel = computed(() => {
  const gpu = hasWebGPU.value ? 'WebGPU' : 'WebGL'
  return `${gpu} · ${isDesktop.value ? 'FFmpeg' : t('tmcut.workspace.previewOnly')}`
})

const clipCount = computed(() => (
  (currentProject.value?.timeline?.tracks || [])
    .reduce((n, track) => n + (track.items?.length || 0), 0)
))

async function handleRestoreRecovery() {
  await applyRecovery()
  if (!pendingRecovery.value) {
    toast.add({ title: t('tmcut.recovery.restored'), color: 'success' })
  }
}

async function handleDismissRecovery() {
  await dismissRecovery()
}

// Focus usually stays on the toolbar toggle, which sits outside the overlay
// markup, so an inline keydown handler never fires. Listen on the window and
// leave Escape to whatever already consumed it (open context menu, dialog).
function handleCompactEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || !compactPanel.value) return
  const target = event.target
  if (target instanceof HTMLElement
    && (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"]'))) return
  compactPanel.value = null
}

onMounted(() => {
  hasWebGPU.value = typeof navigator !== 'undefined' && 'gpu' in navigator
  hydrateLayout()
  window.addEventListener('keydown', handleCompactEscape)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleCompactEscape)
})
</script>

<template>
  <div
    class="flex-1 flex flex-col min-h-0 bg-muted dark:bg-studio-canvas text-highlighted overflow-hidden select-none"
    :style="layoutVars"
  >
    <!-- Recovery banner -->
    <div
      v-if="pendingRecovery"
      class="flex items-center justify-between gap-3 px-4 py-2 bg-warning-500/10 border-b border-warning-500/30 text-warning-200 text-xs"
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
    <div class="relative flex-1 flex overflow-hidden min-h-0">
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

    <!-- Export, voice, snapshot, canvas and AI dialogs -->
    <LazyTmcutEditorOverlays />
  </div>
</template>
