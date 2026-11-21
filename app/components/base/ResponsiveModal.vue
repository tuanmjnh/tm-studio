<script setup lang="ts">
import { ResponsiveModal as TmResponsiveModal } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

// Boolean props with defaults must declare those defaults, or an absent prop
// arrives as `false` and hides the close button (an undismissable dialog).
// `open` is a real model for the same reason: tm-ui resolves
// `modelValue ?? open`, so forwarding a declared-but-absent `model-value`
// pins every modal closed.
withDefaults(defineProps<{
  title?: string
  description?: string
  modal?: boolean
  fullscreen?: boolean
  loading?: boolean
  disabled?: boolean
  dismissible?: boolean
  close?: boolean
  icon?: string
  ui?: { title?: string, description?: string, [key: string]: unknown }
}>(), {
  modal: true,
  fullscreen: false,
  loading: false,
  disabled: false,
  dismissible: true,
  close: true
})

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <TmResponsiveModal v-model:open="open" :title="title" :description="description" :modal="modal"
    :fullscreen="fullscreen" :loading="loading" :disabled="disabled" :dismissible="dismissible" :close="close"
    :icon="icon" :ui="ui" :back-label="t('common.back')" v-bind="$attrs" @close="emit('close')">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmResponsiveModal>
</template>
