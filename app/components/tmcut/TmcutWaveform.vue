<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  points: number[]
  width?: number
  height?: number
  color?: string
}>(), {
  width: 80,
  height: 48,
  color: '#34d399'
})

const bars = computed(() => {
  const pts = Array.isArray(props.points) ? props.points : []
  if (pts.length === 0) return []
  const n = pts.length
  const gap = 1
  const barW = Math.max(0.5, (props.width - (n - 1) * gap) / n)
  return pts.map((p, i) => {
    const clamped = Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0
    const h = Math.max(1, clamped * props.height)
    return {
      x: i * (barW + gap),
      y: (props.height - h) / 2,
      w: barW,
      h
    }
  })
})
</script>

<template>
  <svg
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="block"
    aria-hidden="true"
  >
    <template v-for="(bar, i) in bars" :key="i">
      <rect
        :x="bar.x"
        :y="bar.y"
        :width="bar.w"
        :height="bar.h"
        rx="0.5"
        :fill="color"
      />
    </template>
  </svg>
</template>
