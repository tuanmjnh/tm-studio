<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  compactPanel: 'media' | 'inspector' | null
  hasCanvas: boolean
  canvasLabel: string
  canvasMenuItems: DropdownMenuItem[][]
  saveLabel: string
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  lastSavedAt: string | null
  staleRevision: boolean
  pendingAgentOps: number
  extraActions: DropdownMenuItem[][]
}>()

const emit = defineEmits<{
  togglePanel: [panel: 'media' | 'inspector']
  shortcuts: []
  aiScript: []
  aiEditor: []
  agent: []
  audio: []
  export: []
  save: []
}>()

const { t } = useI18n()
</script>

<template>
  <UButton
    class="xl:hidden"
    icon="i-lucide-library"
    size="sm"
    variant="ghost"
    color="neutral"
    :aria-label="t('tmcut.media.library')"
    aria-controls="tmcut-media-panel"
    :aria-expanded="compactPanel === 'media'"
    @click="emit('togglePanel', 'media')"
  />
  <UButton
    class="xl:hidden"
    icon="i-lucide-sliders-horizontal"
    size="sm"
    variant="ghost"
    color="neutral"
    :aria-label="t('tmcut.inspector')"
    aria-controls="tmcut-inspector-panel"
    :aria-expanded="compactPanel === 'inspector'"
    @click="emit('togglePanel', 'inspector')"
  />
  <!-- Shortcuts help (shared overlay with the timeline Ctrl+K / ?) -->
  <UButton
    icon="i-lucide-keyboard"
    size="sm"
    variant="soft"
    color="neutral"
    :title="t('tmcut.workspace.shortcutsBtn')"
    @click="emit('shortcuts')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.workspace.shortcutsBtn') }}</span>
  </UButton>

  <!-- Aspect Ratio & Resolution Preset Dropdown -->
  <UDropdownMenu :items="canvasMenuItems" :content="{ side: 'bottom', align: 'end' }">
    <UButton
      v-if="hasCanvas"
      icon="i-lucide-proportions"
      size="sm"
      variant="soft"
      color="neutral"
      :title="t('tmcut.canvasRatio')"
    >
      <span class="font-mono text-xs">{{ canvasLabel }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-3 text-muted" />
    </UButton>
  </UDropdownMenu>

  <span
    v-if="saveLabel"
    class="hidden lg:inline text-[11px] font-mono text-muted"
    :class="saveStatus === 'error' ? 'text-error-400' : ''"
    :title="lastSavedAt ? new Date(lastSavedAt).toLocaleString() : ''"
  >
    {{ saveLabel }}
  </span>
  <!-- R132: the project revision is the single honest answer to
       "was this file written outside this session while I held it
       open". It is advisory, not a lock — the app is still the
       single writer. -->
  <UButton
    v-if="staleRevision"
    icon="i-lucide-file-pen"
    size="xs"
    color="warning"
    variant="soft"
    :title="t('tmcut.save.staleRevision')"
  >
    <span class="hidden md:inline">{{ t('tmcut.save.staleRevision') }}</span>
  </UButton>
  <UButton
    icon="i-lucide-save"
    size="sm"
    color="neutral"
    variant="soft"
    @click="emit('save')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('global.save') }}</span>
  </UButton>
  <!-- AI tools share one violet "intelligence" family; Export stays the
       only solid primary action in the bar. -->
  <div class="hidden 2xl:block w-px h-5 shrink-0 bg-accented" />

  <!-- AI Scriptwriter & Storyboard modal trigger (Alt+A) -->
  <UButton
    icon="i-lucide-sparkles"
    size="sm"
    variant="soft"
    color="primary"
    :title="t('tmcut.aiScript.buttonTooltip')"
    @click="emit('aiScript')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.aiScript.buttonLabel') }}</span>
  </UButton>

  <!-- AI Edit Plan modal trigger (Alt+E) — proposes, core validates, user applies -->
  <UButton
    icon="i-lucide-wand-sparkles"
    size="sm"
    variant="soft"
    color="primary"
    :title="t('tmcut.aiEditor.buttonTooltip')"
    @click="emit('aiEditor')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.aiEditor.buttonLabel') }}</span>
  </UButton>

  <!-- Agent & voice commands (roadmap v1 §4): draft → review → apply as one undo group -->
  <UButton
    icon="i-lucide-terminal"
    size="sm"
    variant="soft"
    color="primary"
    :title="t('tmcut.agent.buttonTooltip')"
    @click="emit('agent')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.agent.buttonLabel') }}</span>
    <UBadge
      v-if="pendingAgentOps > 0"
      color="primary"
      variant="solid"
      size="xs"
      class="ml-0.5"
    >
      {{ pendingAgentOps }}
    </UBadge>
  </UButton>

  <!-- Audio orchestration (Phase 8 §24): music bed and SFX cue planner -->
  <UButton
    icon="i-lucide-music-2"
    size="sm"
    variant="soft"
    color="primary"
    :title="t('tmcut.audioOrchestration.buttonTooltip')"
    @click="emit('audio')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.audioOrchestration.buttonLabel') }}</span>
  </UButton>

  <UButton
    icon="i-lucide-download"
    size="sm"
    color="primary"
    variant="solid"
    @click="emit('export')"
  >
    <span class="sr-only 2xl:not-sr-only">{{ t('tmcut.exportVideo') }}</span>
  </UButton>
  <UDropdownMenu :items="extraActions" :content="{ side: 'bottom', align: 'end' }">
    <UButton
      icon="i-lucide-ellipsis-vertical"
      color="neutral"
      variant="soft"
      size="sm"
      :aria-label="t('common.more')"
    />
  </UDropdownMenu>
</template>
