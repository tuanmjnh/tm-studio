<script setup lang="ts">
defineOptions({ inheritAttrs: false })
const { isMobile } = useDeviceBreakpoints()
const props = withDefaults(defineProps<{
  modelValue?: boolean
  open?: boolean
  title?: string
  description?: string
  modal?: boolean
  fullscreen?: boolean
  loading?: boolean
  disabled?: boolean
  dismissible?: boolean
  close?: boolean
  icon?: string
  ui?: {
    title?: string
    description?: string
    [key: string]: unknown
  }
}>(), {
  modelValue: undefined,
  open: undefined,
  title: '',
  description: undefined,
  modal: true,
  fullscreen: false,
  loading: false,
  disabled: false,
  dismissible: true,
  close: true,
  icon: undefined,
  ui: () => ({})
})

const emit = defineEmits<{
  (e: 'update:modelValue' | 'update:open', value: boolean): void
  (e: 'close'): void
}>()

const isOpen = computed({
  get: () => props.modelValue ?? props.open ?? false,
  set: (val) => {
    emit('update:modelValue', val)
    emit('update:open', val)
    if (!val) emit('close')
  }
})

const isLoading = computed(() => props.loading)
const isDisabled = computed(() => props.disabled)

// Default UI configuration for responsive fullscreen modal
const defaultUi: Record<string, unknown> = {
  header: 'flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800',
  body: 'flex-1 overflow-y-auto p-4',
  footer: 'flex items-center justify-end gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50'
}

const uiConfig = computed(() => {
  const ui: Record<string, unknown> = { ...defaultUi }
  if (props.ui) {
    for (const key in props.ui) {
      const propVal = props.ui[key]
      const currentVal = ui[key]
      if (typeof propVal === 'object' && propVal !== null && typeof currentVal === 'object' && currentVal !== null) {
        ui[key] = { ...(currentVal as Record<string, unknown>), ...(propVal as Record<string, unknown>) }
      } else {
        ui[key] = propVal
      }
    }
  }
  return ui
})
</script>

<template>
  <UModal
    v-model:open="isOpen"
    :fullscreen="fullscreen || isMobile"
    :modal="modal"
    :title="title"
    :description="description"
    :ui="uiConfig"
    :dismissible="isDisabled || isLoading ? false : dismissible"
    :close="close"
    v-bind="$attrs"
  >
    <template v-if="$slots.header" #header="slotProps">
      <slot name="header" v-bind="slotProps" />
    </template>

    <template v-if="$slots['header-left'] || $slots.icon || icon" #title>
      <div class="flex items-center gap-2 min-w-0">
        <!-- Mobile Back Button -->
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          class="inline-flex sm:hidden"
          :disabled="isDisabled"
          :loading="isLoading"
          @click="isOpen = false"
        />

        <slot name="icon">
          <UIcon v-if="icon" :name="icon" class="size-5 text-primary shrink-0" />
        </slot>

        <span class="truncate">{{ title }}</span>
        <slot name="header-left" />
      </div>
    </template>

    <template v-if="$slots['header-right']" #actions>
      <slot name="header-right" />
    </template>

    <template v-if="$slots.content" #content>
      <slot name="content" />
    </template>
    <template v-else-if="$slots.body" #body>
      <slot name="body" />
    </template>
    <template v-else #body>
      <slot />
    </template>

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UModal>
</template>
