<script setup lang="ts">
import { useTmcutEditorLayout, type TmcutLayoutPanel } from '~/composables/useTmcutEditorLayout'

const props = defineProps<{
  panel: TmcutLayoutPanel
  label: string
}>()

const { startResize, nudgeResize, resetLayout } = useTmcutEditorLayout()
const horizontal = computed(() => props.panel === 'timeline')
</script>

<template>
  <div
    class="group relative"
    :class="horizontal
      ? 'h-1.5 shrink-0 cursor-row-resize z-20'
      : 'hidden xl:flex w-1 shrink-0 cursor-col-resize z-10'"
    role="separator"
    :aria-orientation="horizontal ? 'horizontal' : 'vertical'"
    :aria-label="label"
    tabindex="0"
    @pointerdown="startResize(panel, $event)"
    @keydown="nudgeResize(panel, $event)"
    @dblclick="resetLayout(panel)"
  >
    <span
      class="absolute bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary transition-colors"
      :class="horizontal
        ? 'inset-x-0 top-1/2 -translate-y-1/2 h-px'
        : 'inset-y-0 left-1/2 -translate-x-1/2 w-px'"
    />
  </div>
</template>
