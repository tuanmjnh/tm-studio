<script setup lang="ts">
interface Props {
  placeholder: {
    id: string
    label: string
    type: 'text' | 'video' | 'image' | 'audio'
  }
  textInputs: Record<string, string>
  disabled?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:text-inputs': [value: Record<string, string>]
}>()

function updateTextInput(value: string) {
  emit('update:text-inputs', { ...props.textInputs, [props.placeholder.id]: value })
}
</script>

<template>
  <div class="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm space-y-2">
    <div class="flex items-center justify-between text-sm">
      <span class="font-medium text-neutral-800 dark:text-neutral-200 flex items-center gap-2">
        <UIcon
          :name="props.placeholder.type === 'text' ? 'i-lucide-type' : props.placeholder.type === 'audio' ? 'i-lucide-music' : 'i-lucide-video'"
          class="w-4 h-4 text-primary-500"
        />
        {{ props.placeholder.label }}
      </span>
      <span class="text-xs text-neutral-400 font-mono">
        {{ props.placeholder.type === 'text' ? $t('tmcut.templateLibrary.textSlot') : $t('tmcut.templateLibrary.mediaSlot') }}
      </span>
    </div>

    <div v-if="props.placeholder.type === 'text'">
      <UInput
        :model-value="props.textInputs[props.placeholder.id] ?? ''"
        :aria-label="props.placeholder.label"
        :name="props.placeholder.id"
        :disabled="props.disabled"
        size="sm"
        class="w-full"
        @update:model-value="updateTextInput"
      />
    </div>
    <div v-else class="text-xs text-neutral-400 italic">
      {{ $t('tmcut.templateLibrary.mediaSlotHint') }}
    </div>
  </div>
</template>
