<script lang="ts">
export type { HeaderAction, HeaderActionChild } from '@tuanmjnh/tm-ui'
</script>

<script setup lang="ts">
import { HeaderActions as TmHeaderActions } from '@tuanmjnh/tm-ui'
import type { HeaderAction } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  actions: HeaderAction[]
  maxInline?: number
}>(), {
  maxInline: 3
})

const { t } = useI18n()
</script>

<template>
  <TmHeaderActions :actions="actions" :max-inline="maxInline" :more-label="t('common.more')" v-bind="$attrs" />
</template>
