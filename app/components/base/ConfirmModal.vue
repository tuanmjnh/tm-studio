<script setup lang="ts">
import { ConfirmModal as TmConfirmModal } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
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
</script>

<template>
  <TmConfirmModal v-model:open="open" :title="title" :description="description" :icon="icon" :color="color"
    :confirm-icon="confirmIcon" :loading="loading" :cancel-label="cancelLabel || t('global.cancel')"
    :confirm-label="confirmLabel || t('global.confirm')" v-bind="$attrs" @confirm="emit('confirm')"
    @cancel="emit('cancel')">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmConfirmModal>
</template>
