<script setup lang="ts">
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutEditorDialogs } from '~/composables/useTmcutEditorDialogs'

const { t } = useI18n()
const toast = useToast()
const {
  showExportModal,
  voiceStudioOpen,
  showSnapshotModal,
  showCustomCanvasModal,
  aiScriptModalOpen,
  aiEditorModalOpen,
  agentPanelOpen,
  audioOrchestrationOpen,
  customCanvas,
  saveSnapshot
} = useTmcutEditorDialogs()
const { queueModalOpen } = useTmcutExportQueue()
const {
  currentProject,
  snapshots,
  switchCanvas,
  saveProject,
  restoreSnapshot,
  deleteSnapshot
} = useTmcutProject()

const fpsOptions = [
  { label: '24 FPS', value: 24 },
  { label: '30 FPS', value: 30 },
  { label: '60 FPS', value: 60 }
]

function applyCustomCanvas() {
  const { width, height, fps } = customCanvas.value
  if (!width || !height || width < 64 || height < 64 || width > 7680 || height > 4320) {
    toast.add({ title: t('tmcut.canvas.customInvalid'), color: 'warning' })
    return
  }
  if (!currentProject.value) return
  switchCanvas(Math.round(width), Math.round(height))
  const canvas = currentProject.value?.canvas
  if (canvas) {
    canvas.fps = { numerator: fps, denominator: 1 }
    saveProject()
  }
  showCustomCanvasModal.value = false
  toast.add({
    title: t('tmcut.aspectRatioUpdated'),
    description: `${t('tmcut.canvas.custom')} (${width}x${height})`,
    color: 'success'
  })
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
</script>

<template>
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
            @click="saveSnapshot"
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
</template>
