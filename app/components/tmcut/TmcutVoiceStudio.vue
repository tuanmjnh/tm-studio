<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'voice-added', path: string): void }>()
const { t } = useI18n()
</script>

<template>
  <UModal v-model:open="open" :title="t('tmcut.voice.title')" :ui="{ content: 'max-w-3xl' }">
    <template #content>
      <TmcutVoiceStudioBody
        v-if="open"
        @close="open = false"
        @voice-added="emit('voice-added', $event)"
      />
    </template>
  </UModal>
</template>
