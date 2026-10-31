<script setup lang="ts">
defineProps<{
  projectName?: string | null
  canvasLabel?: string | null
  timecode: string
  clipCount: number
  hardwareLabel: string
}>()

const { t } = useI18n()
</script>

<template>
  <div
    class="h-7 shrink-0 border-t border-default bg-default/70 px-4 flex items-center justify-between text-[11px] text-muted"
  >
    <div class="flex items-center gap-3 min-w-0">
      <span class="text-toned font-medium truncate">{{ projectName }}</span>
      <span v-if="canvasLabel" class="font-mono shrink-0">{{ canvasLabel }}</span>
      <span class="font-mono shrink-0">{{ timecode }}</span>
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <span>{{ t('tmcut.workspace.clipCount', { count: clipCount }) }}</span>
      <span class="flex items-center gap-1">
        <UIcon name="i-lucide-cpu" class="size-3" />
        {{ hardwareLabel }}
      </span>
    </div>
  </div>
</template>
