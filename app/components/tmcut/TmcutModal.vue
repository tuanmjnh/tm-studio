<script setup lang="ts">
interface Props {
  open: boolean
  title: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
  closeOnOverlayClick?: boolean
  showClose?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  closeOnOverlayClick: true,
  showClose: true
})

const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const sizeClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-4xl'
}
</script>

<template>
  <UModal :open="props.open" :title="props.title" :description="props.description"
    :dismissible="props.closeOnOverlayClick" :close="props.showClose"
    :ui="{ content: sizeClasses[props.size], footer: 'justify-end gap-2' }" @update:open="emit('update:open', $event)">
    <template #body="{ close }">
      <slot name="body" :close="close">
        <slot :close="close" />
      </slot>
    </template>
    <template v-if="$slots.footer" #footer="{ close }">
      <slot name="footer" :close="close" />
    </template>
  </UModal>
</template>
