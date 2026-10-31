<script setup lang="ts">
import { cn } from '~/utils/tmcut/ui'

interface Props {
  variant?: 'default' | 'elevated' | 'interactive' | 'glass'
  class?: string
  onClick?: () => void
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'default'
})

const computedClass = computed(() => cn(
  'rounded-xl transition-all duration-200',
  props.variant === 'default' && 'bg-elevated border border-default shadow-sm',
  props.variant === 'elevated' && 'bg-elevated border border-default rounded-xl shadow-md',
  props.variant === 'interactive' && 'bg-elevated border border-default shadow-sm hover:shadow-md hover:border-primary/40 cursor-pointer',
  props.variant === 'glass' && 'bg-elevated/80 backdrop-blur-md border border-default/60',
  props.class
))
</script>

<template>
  <div
    :class="computedClass"
    role="button"
    tabindex="0"
    @click="onClick"
    @keydown.enter="onClick"
    @keydown.space.prevent="onClick"
  >
    <slot />
  </div>
</template>
