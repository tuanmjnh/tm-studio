<script setup lang="ts">
import { EmptyState as TmEmptyState } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })
</script>

<template>
  <TmEmptyState v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmEmptyState>
</template>
