<script setup lang="ts">
import { FilterPopover as TmFilterPopover } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

withDefaults(defineProps<{ popover?: boolean }>(), {
  popover: false
})

const { t } = useI18n()
</script>

<template>
  <TmFilterPopover :popover="popover" :label="t('common.filter')" v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmFilterPopover>
</template>
