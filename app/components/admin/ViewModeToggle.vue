<script setup lang="ts">
const props = defineProps<{
  modelValue?: 'list' | 'grid'
}>()

const emit = defineEmits<{
  'update:modelValue': [('list' | 'grid')]
}>()

const { t } = useI18n()

const mode = computed({
  get: () => props.modelValue || 'list',
  set: (v: 'list' | 'grid') => emit('update:modelValue', v)
})
</script>

<template>
  <UFieldGroup class="hidden lg:flex shrink-0">
    <UButton
      icon="i-lucide-list"
      :color="mode === 'list' ? 'primary' : 'neutral'"
      variant="soft"
      size="sm"
      :aria-label="t('common.list')"
      :aria-pressed="mode === 'list'"
      @click="mode = 'list'"
    />
    <UButton
      icon="i-lucide-layout-grid"
      :color="mode === 'grid' ? 'primary' : 'neutral'"
      variant="soft"
      size="sm"
      :aria-label="t('common.grid')"
      :aria-pressed="mode === 'grid'"
      @click="mode = 'grid'"
    />
  </UFieldGroup>
</template>
