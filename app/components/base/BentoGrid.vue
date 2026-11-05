<script setup lang="ts">
withDefaults(defineProps<{
  /** Gap between bento cells. */
  gap?: string
}>(), {
  gap: 'gap-3'
})
</script>

<template>
  <!-- 1 col → 6 cols → 12 cols. BentoCard spans use the 12-col grid at xl. -->
  <div class="grid grid-cols-1 sm:grid-cols-6 xl:grid-cols-12" :class="gap">
    <slot />
  </div>
</template>
