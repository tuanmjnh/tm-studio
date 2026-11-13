<script setup lang="ts">
import { ViewModeToggle as TmViewModeToggle } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

defineProps<{ modelValue?: 'list' | 'grid' }>()
const emit = defineEmits<{ 'update:modelValue': [('list' | 'grid')] }>()

const { t } = useI18n()
</script>

<template>
  <TmViewModeToggle :model-value="modelValue" :list-label="t('common.list')" :grid-label="t('common.grid')"
    v-bind="$attrs" @update:model-value="emit('update:modelValue', $event)" />
</template>
