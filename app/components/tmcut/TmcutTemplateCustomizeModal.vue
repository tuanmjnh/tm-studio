<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  open: boolean
  activeTemplate: {
    name: string
    aspectRatio: string
    durationTicks: number
    placeholders: Array<{
      id: string
      label: string
      type: 'text' | 'video' | 'image' | 'audio'
      defaultContent?: string
    }> | null
  } | null
  projectNameInput: string
  placeholderTextInputs: Record<string, string>
  isCreating: boolean
  activeReadiness: {
    missingAssets: Array<{ assetId: string }>
    localNeeds: Array<{ assetId: string, sourceHint?: string }>
  } | null
  assetInstallState: (assetId: string) => string
  assetTitle: (assetId: string) => string
  tts: (ticks: number) => string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'update:projectNameInput': [value: string]
  'update:placeholderTextInputs': [value: Record<string, string>]
  'install-asset': [assetId: string]
  'confirm': []
  'close': []
}>()

const description = computed(() => {
  if (!props.activeTemplate) return undefined
  return `${props.activeTemplate.name} · ${props.activeTemplate.aspectRatio} (${props.tts(props.activeTemplate.durationTicks || 0)}s)`
})

function handleConfirmCustomize() {
  if (!props.isCreating && props.activeTemplate) emit('confirm')
}

function handleOpenUpdate(open: boolean) {
  emit('update:open', open)
  if (!open) emit('close')
}
</script>

<template>
  <UModal
    :open="props.open"
    :title="$t('tmcut.templateLibrary.modalTitle')"
    :description="description"
    :close="!props.isCreating"
    :dismissible="!props.isCreating"
    :ui="{ content: 'max-w-2xl', footer: 'justify-end gap-2' }"
    @update:open="handleOpenUpdate"
  >
    <template #body>
      <div class="space-y-6">
        <UFormField name="projectName" :label="$t('tmcut.templateLibrary.projectNameLabel')">
          <UInput
            :model-value="props.projectNameInput"
            :placeholder="$t('tmcut.templateLibrary.projectNamePlaceholder')"
            :aria-label="$t('tmcut.templateLibrary.projectNameLabel')"
            :disabled="props.isCreating"
            class="w-full"
            @update:model-value="emit('update:projectNameInput', $event)"
          />
        </UFormField>

        <!-- Placeholders -->
        <div class="space-y-4">
          <div>
            <h4 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider mb-2">
              {{ $t('tmcut.templateLibrary.placeholdersTitle') }}
            </h4>
            <p class="text-xs text-neutral-500">
              {{ $t('tmcut.templateLibrary.placeholdersHint') }}
            </p>
          </div>
          <div class="space-y-3 max-h-80 overflow-y-auto pr-1">
            <TmcutPlaceholderEditor
              v-for="ph in props.activeTemplate?.placeholders"
              :key="ph.id"
              :placeholder="ph"
              :text-inputs="props.placeholderTextInputs"
              :disabled="props.isCreating"
              @update:text-inputs="emit('update:placeholderTextInputs', $event)"
            />
          </div>
        </div>

        <!-- Required Assets -->
        <div v-if="props.activeReadiness && (props.activeReadiness.missingAssets.length > 0 || props.activeReadiness.localNeeds.length > 0)" class="space-y-3 border-t border-neutral-200 dark:border-neutral-800 pt-4">
          <h4 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 uppercase tracking-wider">
            {{ $t('tmcut.templateLibrary.requiredAssetsTitle') }}
          </h4>
          <div v-for="req in props.activeReadiness.missingAssets" :key="req.assetId" class="flex items-center justify-between gap-2 p-3 rounded-xl border border-amber-500/40 bg-amber-500/5">
            <span class="text-sm text-neutral-700 dark:text-neutral-300 flex items-center gap-2 min-w-0 truncate">
              <UIcon name="i-lucide-package-x" class="w-4 h-4 text-amber-500 shrink-0" />
              {{ props.assetTitle(req.assetId) }}
            </span>
            <div class="flex items-center gap-2">
              <UButton
                v-if="props.assetInstallState(req.assetId) === 'catalog'"
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-lucide-download"
                :disabled="props.isCreating"
                @click="emit('install-asset', req.assetId)"
              >
                {{ $t('tmcut.assetCenter.install') }}
              </UButton>
              <UButton
                v-else-if="props.assetInstallState(req.assetId) === 'error'"
                color="warning"
                variant="outline"
                size="xs"
                icon="i-lucide-rotate-ccw"
                :disabled="props.isCreating"
                @click="emit('install-asset', req.assetId)"
              >
                {{ $t('tmcut.assetCenter.retry') }}
              </UButton>
              <span v-else class="text-xs text-neutral-500 shrink-0">{{ props.assetInstallState(req.assetId) === 'installed' ? $t('tmcut.templateLibrary.assetReady') : $t('tmcut.assetCenter.downloading') }}</span>
            </div>
          </div>
          <div v-for="need in props.activeReadiness.localNeeds" :key="need.assetId" class="flex items-center gap-2 p-3 rounded-xl border border-neutral-300 dark:border-neutral-800 text-sm text-neutral-500">
            <UIcon name="i-lucide-file-question" class="w-4 h-4 shrink-0" />
            {{ $t('tmcut.templateLibrary.localAssetNote', { file: need.sourceHint || need.assetId }) }}
          </div>
        </div>
      </div>
    </template>

    <template #footer="{ close }">
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="props.isCreating"
        @click="close"
      >
        {{ $t('tmcut.hotkeys.close') }}
      </UButton>
      <UButton
        color="primary"
        variant="soft"
        icon="i-lucide-sparkles"
        :loading="props.isCreating"
        :disabled="props.isCreating || !props.activeTemplate"
        @click="handleConfirmCustomize"
      >
        {{ $t('tmcut.templateLibrary.createProjectBtn') }}
      </UButton>
    </template>
  </UModal>
</template>
