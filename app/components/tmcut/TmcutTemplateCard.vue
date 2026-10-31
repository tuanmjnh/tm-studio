<script setup lang="ts">
import { TmcutBadge, TmcutButton } from '#components'
import { ticksToSeconds } from '~/composables/useTmcutTemplates'
import type { TmcutTemplate } from '~/types/tmcut'

interface Props {
  template: TmcutTemplate
}

defineProps<Props>()
const emit = defineEmits<{ use: [tpl: TmcutTemplate], customize: [tpl: TmcutTemplate], export: [tpl: TmcutTemplate], delete: [tpl: TmcutTemplate] }>()

const { industryLabel, industryIcon } = useTmcutIndustries()

function getMediaSlotsCount(tpl: TmcutTemplate): number {
  if (!Array.isArray(tpl.placeholders)) return 0
  return tpl.placeholders.filter(p => p.type === 'video' || p.type === 'image').length
}

function getTextSlotsCount(tpl: TmcutTemplate): number {
  if (!Array.isArray(tpl.placeholders)) return 0
  return tpl.placeholders.filter(p => p.type === 'text').length
}

function getAspectRatioClass(aspectRatio: string): string {
  switch (aspectRatio) {
    case '9:16': return 'w-20 h-32'
    case '16:9': return 'w-40 h-24'
    case '1:1': return 'w-28 h-28'
    case '4:5': return 'w-36 h-20'
    case '21:9': return 'w-48 h-18'
    default: return 'w-32 h-20'
  }
}
</script>

<template>
  <div class="group relative bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-xl transition-all duration-300 flex flex-col">
    <!-- Visual Preview -->
    <div class="w-full h-40 bg-neutral-950 flex items-center justify-center relative overflow-hidden p-4 border-b border-neutral-100 dark:border-neutral-800">
      <div
        class="border-2 border-dashed border-neutral-700 rounded-lg flex items-center justify-center bg-neutral-900/80"
        :class="getAspectRatioClass(template.aspectRatio)"
      >
        <UIcon :name="template.thumbnail || 'i-lucide-layout-template'" class="w-8 h-8 text-primary-500/80" />
      </div>

      <!-- Badges Top -->
      <div class="absolute top-3 left-3 flex items-center gap-1.5">
        <TmcutBadge variant="neutral" size="xs" class="font-mono">
          {{ template.aspectRatio }}
        </TmcutBadge>
        <TmcutBadge variant="primary" size="xs" class="font-mono">
          {{ ticksToSeconds(template.durationTicks) }}s
        </TmcutBadge>
      </div>

      <div class="absolute top-3 right-3 flex items-center gap-1">
        <TmcutBadge
          v-if="template.generatedBy"
          variant="secondary"
          size="xs"
          class="flex items-center gap-1"
        >
          <UIcon name="i-lucide-sparkles" class="w-3 h-3" /> AI
        </TmcutBadge>
        <TmcutBadge
          v-else-if="template.isBuiltin"
          variant="primary"
          size="xs"
          class="flex items-center gap-1"
        >
          <UIcon name="i-lucide-sparkles" class="w-3 h-3" /> {{ $t('tmcut.templateLibrary.builtInBadge') }}
        </TmcutBadge>
        <TmcutBadge
          v-else
          variant="success"
          size="xs"
          class="flex items-center gap-1"
        >
          <UIcon name="i-lucide-user" class="w-3 h-3" /> {{ $t('tmcut.templateLibrary.customBadge') }}
        </TmcutBadge>
      </div>
    </div>

    <!-- Content -->
    <div class="p-4 flex-1 flex flex-col justify-between">
      <div>
        <div class="flex items-start justify-between gap-2 mb-2">
          <h3 class="font-semibold text-base text-neutral-900 dark:text-neutral-100 group-hover:text-primary-600 dark:group-hover:text-primary-400 transition-colors truncate">
            {{ template.name }}
          </h3>
          <div v-if="!template.isBuiltin" class="flex items-center gap-1 shrink-0">
            <TmcutButton
              icon="i-lucide-file-down"
              size="xs"
              variant="ghost"
              color="neutral"
              :aria-label="$t('tmcut.templateLibrary.exportBtn')"
              @click.stop="emit('export', template)"
            />
            <TmcutButton
              icon="i-lucide-trash-2"
              size="xs"
              variant="ghost"
              color="error"
              :aria-label="$t('tmcut.templateLibrary.deleteTemplate')"
              @click.stop="emit('delete', template)"
            />
          </div>
        </div>
        <div
          v-if="template.industry"
          class="flex items-center gap-1.5 mb-2 text-[11px] font-medium text-primary-600 dark:text-primary-400"
        >
          <UIcon :name="industryIcon(template.industry)" class="w-3.5 h-3.5 shrink-0" />
          <span class="truncate">{{ industryLabel(template.industry) }}</span>
        </div>

        <p class="text-xs text-neutral-500 line-clamp-2 mb-3">
          {{ template.description || $t('tmcut.templateLibrary.subtitle') }}
        </p>

        <!-- Placeholders Stats -->
        <div class="flex items-center gap-3 text-xs text-neutral-500 border-t border-neutral-100 dark:border-neutral-800 pt-3">
          <div class="flex items-center gap-1">
            <UIcon name="i-lucide-video" class="w-3.5 h-3.5 text-neutral-400" />
            <span>{{ $t('tmcut.templateLibrary.videoPlaceholders', { n: getMediaSlotsCount(template) }) }}</span>
          </div>
          <div class="flex items-center gap-1">
            <UIcon name="i-lucide-type" class="w-3.5 h-3.5 text-neutral-400" />
            <span>{{ $t('tmcut.templateLibrary.textPlaceholders', { n: getTextSlotsCount(template) }) }}</span>
          </div>
          <div class="flex items-center gap-1 ml-auto">
            <UIcon name="i-lucide-layers" class="w-3.5 h-3.5 text-neutral-400" />
            <span>{{ $t('tmcut.templateLibrary.tracksCount', { n: template.tracks?.length || 1 }) }}</span>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="mt-4 pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2">
        <TmcutButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-sliders"
          @click="emit('customize', template)"
        >
          {{ $t('tmcut.templateLibrary.previewDetails') }}
        </TmcutButton>
        <TmcutButton
          size="xs"
          color="primary"
          variant="soft"
          icon="i-lucide-sparkles"
          @click="emit('use', template)"
        >
          {{ $t('tmcut.templateLibrary.useTemplate') }}
        </TmcutButton>
      </div>
    </div>
  </div>
</template>
