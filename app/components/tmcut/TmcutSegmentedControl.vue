<script setup lang="ts">
import { cn } from '~/utils/tmcut/ui'

interface Option {
  value: string
  label: string
  icon?: string
  count?: number
  disabled?: boolean
}

interface Props {
  modelValue: string
  options: Option[]
  size?: 'sm' | 'md'
  label?: string
  class?: string
  fullWidth?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'sm',
  label: 'Segmented control',
  fullWidth: false
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const sizeClasses = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-3 py-1.5 text-sm'
}

const computedClass = computed(() => cn(
  'inline-flex items-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5',
  sizeClasses[props.size],
  props.fullWidth ? 'w-full' : '',
  props.class
))
</script>

<template>
  <div :class="computedClass" role="radiogroup" :aria-label="props.label">
    <button
      v-for="option in props.options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="props.modelValue === option.value"
      :aria-disabled="option.disabled"
      :disabled="option.disabled"
      :class="cn(
        'flex items-center gap-1.5 rounded-md transition-all duration-150 font-medium',
        props.modelValue === option.value ? 'bg-white dark:bg-neutral-900 shadow-sm text-primary' : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100',
        option.disabled && 'opacity-50 cursor-not-allowed',
        props.size === 'sm' && 'px-2.5 py-1 text-xs',
        props.size === 'md' && 'px-3 py-1.5 text-sm'
      )"
      @click="!option.disabled && emit('update:modelValue', option.value)"
    >
      <UIcon
        v-if="option.icon"
        :name="option.icon"
        class="w-3.5 h-3.5 shrink-0"
        :class="{ 'text-primary': props.modelValue === option.value }"
      />
      <span :class="{ 'font-semibold': props.modelValue === option.value }">{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="px-1.5 py-0.5 rounded-full text-[10px] font-mono" :class="props.modelValue === option.value ? 'bg-primary/20 text-primary' : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-500'">
        {{ option.count }}
      </span>
    </button>
  </div>
</template>
