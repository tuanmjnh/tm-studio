<script setup lang="ts">
import { SectionNav as TmSectionNav } from '@tuanmjnh/tm-ui'
import type { NavigationMenuItem } from '@nuxt/ui'

defineOptions({ inheritAttrs: false })

defineProps<{ items: NavigationMenuItem[] }>()

const { t } = useI18n()
</script>

<template>
  <TmSectionNav :items="items" :aria-label="t('common.navigation')" v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmSectionNav>
</template>
