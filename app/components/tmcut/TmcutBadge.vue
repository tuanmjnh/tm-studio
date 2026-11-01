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
  size: 'sm'
})

const baseClass = 'inline-flex items-center gap-1 font-medium rounded-full'
const sizeClasses = {
  xs: 'px-1.5 py-0.5 text-[10px]',
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm'
}
const variantClasses = {
  primary: 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300',
  secondary: 'bg-secondary-100 text-secondary-700 dark:bg-secondary-900/30 dark:text-secondary-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  warning: 'bg-warning-100 text-warning-700 dark:bg-warning-900/30 dark:text-warning-300',
  error: 'bg-error-100 text-error-700 dark:bg-error-900/30 dark:text-error-300',
  neutral: 'bg-muted text-toned'
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
