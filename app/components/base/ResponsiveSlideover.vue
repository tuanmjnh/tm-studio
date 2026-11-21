<script setup lang="ts">
import { ResponsiveSlideover as TmResponsiveSlideover } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

// Boolean props with defaults must declare those defaults, or an absent prop
// arrives as `false` and hides the close button (an undismissable slideover).
// `open` is a real model for the same reason.
withDefaults(defineProps<{
  title?: string
  description?: string
  loading?: boolean
  disabled?: boolean
  dismissible?: boolean
  close?: boolean
  side?: 'top' | 'right' | 'bottom' | 'left'
  icon?: string
  ui?: { title?: string, description?: string, [key: string]: unknown }
}>(), {
  loading: false,
  disabled: false,
  dismissible: true,
  close: true,
  side: 'right'
})

const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <TmResponsiveSlideover v-model:open="open" :title="title" :description="description" :loading="loading"
    :disabled="disabled" :dismissible="dismissible" :close="close" :side="side" :icon="icon" :ui="ui"
    :back-label="t('common.back')" v-bind="$attrs" @close="emit('close')">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmResponsiveSlideover>
</template>
