<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  modelValue?: boolean
  open?: boolean
  title?: string
  description?: string
  loading?: boolean
  disabled?: boolean
  dismissible?: boolean
  close?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
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
  loading: false,
  disabled: false,
  dismissible: true,
  close: true,
  side: 'right',
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

const sideTransitions: Record<string, string> = {
  right: 'data-[state=open]:animate-[slide-in-right_0.3s_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[slide-out-right_0.2s_ease-in]',
  left: 'data-[state=open]:animate-[slide-in-left_0.3s_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[slide-out-left_0.2s_ease-in]',
  top: 'data-[state=open]:animate-[slide-in-top_0.3s_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[slide-out-top_0.2s_ease-in]',
  bottom: 'data-[state=open]:animate-[slide-in-bottom_0.3s_cubic-bezier(0.16,1,0.3,1)] data-[state=closed]:animate-[slide-out-bottom_0.2s_ease-in]'
}

// Default UI configuration for slideover
const defaultUi: Record<string, unknown> = {
  header: 'flex items-center gap-2 justify-between w-full border-b border-gray-200 dark:border-gray-800 px-4 py-3',
  body: 'flex-1 overflow-y-auto p-4 sm:p-6',
  content: 'w-screen max-w-xl flex flex-col',
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

  // Merge side-based slide animation onto content
  const sideAnim = sideTransitions[props.side || 'right'] || sideTransitions.right
  if (ui.content && typeof ui.content === 'string') {
    ui.content = `${ui.content} ${sideAnim}`
  } else {
    ui.content = sideAnim
  }

  return ui
})
</script>

<template>
  <USlideover
    v-model:open="isOpen"
    :title="title"
    :description="description"
    :ui="uiConfig"
    :dismissible="isDisabled || isLoading ? false : dismissible"
    :side="side"
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

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </USlideover>
</template>
