<script setup lang="ts">
import { cn } from '~/utils/tmcut/ui'

interface Props {
  variant?: 'default' | 'elevated' | 'interactive' | 'glass'
  class?: string
  onClick?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default',
})

const computedClass = computed(() => cn(
  'rounded-xl transition-all duration-200',
  props.variant === 'default' && 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm',
  props.variant === 'elevated' && 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-md',
  props.variant === 'interactive' && 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm hover:shadow-md hover:border-primary-300 dark:hover:border-primary-700 cursor-pointer',
  props.variant === 'glass' && 'bg-white/80 dark:bg-neutral-900/80 backdrop-blur-md border border-neutral-200/50 dark:border-neutral-800/50',
  props.class
))
</script>

<template>
  <div
    :class="computedClass"
    @click="onClick"
    role="button"
    tabindex="0"
    @keydown.enter="onClick"
    @keydown.space.prevent="onClick"
  >
    <slot />
  </div>
</template>