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
const emit = defineEmits<{ confirm: []; cancel: [] }>()
const { t } = useI18n()

/**
 * Small tinted plate behind the icon — the same hairline + 4px radius language
 * as the bento tiles, coloured by the confirm intent.
 */
const toneClass = computed(() => {
  const map: Record<string, string> = {
    primary: 'bg-primary/10 text-primary ring-primary/20',
    neutral: 'bg-elevated text-toned ring-default/70',
    error: 'bg-error/10 text-error ring-error/20',
    warning: 'bg-warning/10 text-warning ring-warning/20',
    success: 'bg-success/10 text-success ring-success/20'
  }
  return map[props.color]
})

function onCancel() {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <UModal v-model:open="open" :title="title" :ui="{ footer: 'justify-end gap-2' }">
    <slot />

    <template #body>
      <div v-if="description" class="flex items-center gap-3">
        <span v-if="icon" class="grid size-9 shrink-0 place-items-center rounded-[4px] ring-1 ring-inset"
          :class="toneClass">
          <UIcon :name="icon" class="size-4" />
        </span>
        <p class="pt-1.5 text-sm leading-relaxed text-muted">
          {{ description }}
        </p>
      </div>
      <slot v-else name="body" />
    </template>

    <template #footer>
      <UButton :label="cancelLabel || t('global.cancel')" color="neutral" variant="ghost" :disabled="loading"
        @click="onCancel" />
      <UButton :label="confirmLabel || t('global.confirm')" variant="soft" :icon="confirmIcon" :color="color"
        :loading="loading" @click="emit('confirm')" />
    </template>
  </UModal>
</template>
