<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'voice-added', path: string): void }>()
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-3xl' }">
    <template #content>
      <TmcutVoiceStudioBody
        v-if="open"
        @close="open = false"
        @voice-added="emit('voice-added', $event)"
      />
    </template>
  </UModal>
</template>
