<script setup lang="ts">
interface Option {
  value: string
  label: string
  icon?: string
  count?: number
  disabled?: boolean
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'neutral'
}

interface Props {
  modelValue: string[]
  options: Option[]
  maxSelected?: number
  label?: string
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  maxSelected: Infinity,
  label: 'Filters'
})

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const isSelected = (value: string) => props.modelValue.includes(value)
const canSelectMore = computed(() => props.modelValue.length < props.maxSelected)
// A single-select group has no "full" state: the limit only means one at a
// time. Disabling the siblings (the multi-select rule) instead made every
// chip unreachable as soon as one was on — including the 'all' entry the
// template library selects by default.
const isSingleSelect = computed(() => props.maxSelected === 1)
const isBlocked = (value: string) => !isSingleSelect.value && !canSelectMore.value && !isSelected(value)

function toggle(value: string) {
  if (isSelected(value)) {
    emit('update:modelValue', props.modelValue.filter(v => v !== value))
  } else if (canSelectMore.value) {
    emit('update:modelValue', [...props.modelValue, value])
  } else if (isSingleSelect.value) {
    emit('update:modelValue', [value])
  }
}

const colorClasses = {
  primary: 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300',
  secondary: 'border-secondary-300 dark:border-secondary-700 bg-secondary-50 dark:bg-secondary-900/20 text-secondary-700 dark:text-secondary-300',
  success: 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300',
  error: 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300',
  neutral: 'border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="props.label">
    <button
      v-for="option in props.options"
      :key="option.value"
      type="button"
      :aria-pressed="isSelected(option.value)"
      :disabled="option.disabled || isBlocked(option.value)"
      :class="[
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150',
        isSelected(option.value)
          ? 'shadow-sm font-semibold'
          : 'hover:shadow-sm',
        colorClasses[option.color || 'neutral'],
        { 'opacity-50 cursor-not-allowed': option.disabled || isBlocked(option.value) }
      ]"
      @click="toggle(option.value)"
    >
      <UIcon v-if="option.icon" :name="option.icon" class="w-3.5 h-3.5 shrink-0" />
      <span>{{ option.label }}</span>
      <span v-if="option.count !== undefined" class="px-1.5 py-0.5 rounded-full text-[10px] font-mono" :class="isSelected(option.value) ? 'bg-white/30 dark:bg-white/10' : 'bg-white/50 dark:bg-white/5'">
        {{ option.count }}
      </span>
    </button>
  </div>
</template>
