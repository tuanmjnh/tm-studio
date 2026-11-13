<script setup lang="ts">
import { RowActions as TmRowActions } from '@tuanmjnh/tm-ui'
import type { DropdownMenuItem } from '@nuxt/ui'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{
  items: DropdownMenuItem[][]
  align?: 'start' | 'center' | 'end'
}>(), {
  align: 'end'
})

const { t } = useI18n()
</script>

<template>
  <TmRowActions :items="items" :align="align" :label="t('common.actions')" v-bind="$attrs" />
</template>
