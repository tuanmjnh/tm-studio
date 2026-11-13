<script setup lang="ts">
import { ResponsiveSlideover as TmResponsiveSlideover } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

defineProps<{
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
  ui?: { title?: string, description?: string, [key: string]: unknown }
}>()

const emit = defineEmits<{
  (e: 'update:modelValue' | 'update:open', value: boolean): void
  (e: 'close'): void
}>()

const { t } = useI18n()
</script>

<template>
  <TmResponsiveSlideover :model-value="modelValue" :open="open" :title="title" :description="description"
    :loading="loading" :disabled="disabled" :dismissible="dismissible" :close="close" :side="side" :icon="icon"
    :ui="ui" :back-label="t('common.back')" v-bind="$attrs"
    @update:model-value="emit('update:modelValue', $event)" @update:open="emit('update:open', $event)"
    @close="emit('close')">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmResponsiveSlideover>
</template>
