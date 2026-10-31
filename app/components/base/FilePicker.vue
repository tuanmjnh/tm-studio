<script setup lang="ts">
import { computed } from 'vue'
import type { DialogFileFilter } from '#shared/types/electron'

const model = defineModel<string>({ default: '' })

const emit = defineEmits<{
  (e: 'select', value: string): void
}>()

const props = withDefaults(defineProps<{
  placeholder?: string
  mode?: 'file' | 'folder' | 'save'
  filters?: DialogFileFilter[]
  title?: string
  size?: 'sm' | 'md' | 'lg'
  disabled?: boolean
  loading?: boolean
  readonly?: boolean
  showClear?: boolean
  defaultValue?: string
}>(), {
  placeholder: '',
  mode: 'file',
  filters: () => [] as DialogFileFilter[],
  title: '',
  size: 'md',
  disabled: false,
  loading: false,
  readonly: false,
  showClear: false,
  defaultValue: undefined
})

const { t } = useI18n()
const { pickFile, pickFolder, selectSaveFile } = useFileSystem()
const isElectron = computed(() => !!window.electronAPI?.isElectron)

async function browse() {
  if (!isElectron.value) return
  try {
    if (props.mode === 'folder') {
      const picked = await pickFolder({ title: props.title, defaultPath: model.value })
      if (picked) {
        model.value = picked
        emit('select', picked)
      }
      return
    }
    if (props.mode === 'save') {
      const picked = await selectSaveFile({ title: props.title, filters: props.filters, defaultPath: model.value })
      if (picked) {
        model.value = picked
        emit('select', picked)
      }
      return
    }
    const picked = await pickFile({ title: props.title, filters: props.filters, defaultPath: model.value })

    if (typeof picked === 'string' && picked) {
      model.value = picked
      emit('select', picked)
    }
  } catch {
    // ignore
  }
}
</script>

<template>
  <UInput
    v-model="model"
    :placeholder="placeholder"
    :size="size"
    :disabled="disabled"
    :readonly="readonly"
    class="w-full"
    :ui="{ trailing: 'pe-0.5' }"
  >
    <template #trailing>
      <div class="flex items-center gap-0.5">
        <!-- Reset/Default Button -->
        <UButton
          v-if="defaultValue !== undefined && model !== defaultValue"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-rotate-ccw"
          :title="t('global.reset')"
          :aria-label="t('global.reset')"
          :disabled="disabled"
          @click="model = defaultValue"
        />
        <!-- Clear Button -->
        <UButton
          v-if="showClear && model"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-x"
          :title="t('global.clear')"
          :aria-label="t('global.clear')"
          :disabled="disabled"
          @click="model = ''"
        />
        <!-- Browse Button -->
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-folder-open"
          :title="t('tools.browse')"
          :aria-label="t('tools.browse')"
          :disabled="disabled || !isElectron"
          :loading="loading"
          @click="browse"
        />
      </div>
    </template>
  </UInput>
</template>
