<script setup lang="ts">
withDefaults(defineProps<{
  /** Render the isometric floor grid (dashboard hero + login only). */
  grid?: boolean
}>(), {
  grid: false
})
</script>

<template>
  <div class="tm-backdrop" aria-hidden="true">
    <div class="tm-aurora" />
    <div class="tm-streak" />
    <div class="tm-orb tm-orb-1" />
    <div class="tm-orb tm-orb-2" />
    <div v-if="grid" class="tm-iso-grid" />
  </div>
</template>
