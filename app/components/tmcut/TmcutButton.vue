<script setup lang="ts">
type Variant = 'solid' | 'soft' | 'ghost' | 'outline' | 'destructive'
type Size = 'xs' | 'sm' | 'md' | 'lg'
type Color = 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

interface Props {
  variant?: Variant
  color?: Color
  size?: Size
  icon?: string
  iconPosition?: 'left' | 'right'
  loading?: boolean
  disabled?: boolean
  fullWidth?: boolean
  // Wrapper props that would otherwise fall through by accident: declaring
  // ariaLabel keeps an icon-only call site named after Vue stops treating the
  // attribute as an inherited attr, and label covers text-only call sites.
  label?: string
  ariaLabel?: string
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'soft',
  color: 'primary',
  size: 'sm',
  iconPosition: 'left',
  loading: false,
  disabled: false,
  fullWidth: false
})
</script>

<template>
  <UButton
    :variant="props.variant === 'destructive' ? 'soft' : props.variant"
    :color="props.variant === 'destructive' ? 'error' : props.color"
    :size="props.size"
    :icon="props.icon"
    :trailing="props.iconPosition === 'right'"
    :loading="props.loading"
    :disabled="props.disabled"
    :block="props.fullWidth"
    :label="props.label"
    :aria-label="props.ariaLabel"
  >
    <slot v-if="$slots.default" />
  </UButton>
</template>
