<script setup lang="ts">
import { ResponsiveModal as TmResponsiveModal } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

defineProps<{
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
  ui?: { title?: string, description?: string, [key: string]: unknown }
}>()

const emit = defineEmits<{
  (e: 'update:modelValue' | 'update:open', value: boolean): void
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <TmResponsiveModal :model-value="modelValue" :open="open" :title="title" :description="description" :modal="modal"
    :fullscreen="fullscreen" :loading="loading" :disabled="disabled" :dismissible="dismissible" :close="close"
    :icon="icon" :ui="ui" :back-label="t('common.back')" v-bind="$attrs"
    @update:model-value="emit('update:modelValue', $event)" @update:open="emit('update:open', $event)"
    @close="emit('close')">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmResponsiveModal>
</template>
