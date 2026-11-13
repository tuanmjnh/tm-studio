<script setup lang="ts">
import { BentoGrid as TmBentoGrid } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })
</script>

<template>
  <TmBentoGrid v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmBentoGrid>
</template>
