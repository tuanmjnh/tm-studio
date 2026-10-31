<script setup lang="ts">
const props = withDefaults(defineProps<{
  title?: string
  description?: string
  icon?: string
  color?: 'primary' | 'neutral' | 'error' | 'warning' | 'success'
  confirmLabel?: string
  cancelLabel?: string
  confirmIcon?: string
  loading?: boolean
}>(), {
  title: '',
  description: '',
  icon: 'i-lucide-alert-triangle',
  color: 'error',
  confirmLabel: '',
  cancelLabel: '',
  confirmIcon: '',
  loading: false
})

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ confirm: [], cancel: [] }>()
const { t } = useI18n()

const iconClass = computed(() => {
  const map: Record<string, string> = {
    primary: 'text-(--ui-primary)',
    neutral: 'text-(--ui-muted)',
    error: 'text-(--ui-error)',
    warning: 'text-(--ui-warning)',
    success: 'text-(--ui-success)'
  }
  return map[props.color]
})

function onCancel() {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ footer: 'justify-end' }">
    <slot />

    <template #body>
      <div v-if="description" class="flex items-start gap-3 py-1">
        <UIcon
          v-if="icon"
          :name="icon"
          class="text-xl shrink-0 mt-0.5"
          :class="iconClass"
        />
        <p class="text-sm text-muted">
          {{ description }}
        </p>
      </div>
      <slot v-else name="body" />
    </template>

    <template #footer>
      <UButton
        :label="cancelLabel || t('global.cancel')"
        color="neutral"
        variant="ghost"
        :disabled="loading"
        @click="onCancel"
      />
      <UButton
        :label="confirmLabel || t('global.confirm')"
        variant="soft"
        :icon="confirmIcon"
        :color="color"
        :loading="loading"
        @click="emit('confirm')"
      />
    </template>
  </UModal>
</template>
