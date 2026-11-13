<script setup lang="ts">
import { BentoCard as TmBentoCard } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })
</script>

<template>
  <TmBentoCard v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmBentoCard>
</template>
