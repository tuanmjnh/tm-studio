<script setup lang="ts">
import { AppBackdrop as TmAppBackdrop } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })
</script>

<template>
  <TmAppBackdrop v-bind="$attrs">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmAppBackdrop>
</template>
