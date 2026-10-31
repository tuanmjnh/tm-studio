<script setup lang="ts">
import { cn } from '~/utils/tmcut/ui'

interface Props {
  variant?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral'
  size?: 'xs' | 'sm' | 'md'
  class?: string
  dot?: boolean
  dotColor?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'neutral',
  size: 'sm',
})

const baseClass = 'inline-flex items-center gap-1 font-medium rounded-full'
const sizeClasses = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
}
const variantClasses = {
  primary: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  secondary: 'bg-secondary-100 text-secondary-700 dark:bg-secondary-900/30 dark:text-secondary-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  neutral: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
}

const computedClass = computed(() => cn(
  baseClass,
  sizeClasses[props.size],
  variantClasses[props.variant],
  props.class
))
</script>

<template>
  <span :class="computedClass">
    <span v-if="props.dot" class="w-1.5 h-1.5 rounded-full" :style="{ backgroundColor: props.dotColor || 'currentColor' }" />
    <slot />
  </span>
</template>