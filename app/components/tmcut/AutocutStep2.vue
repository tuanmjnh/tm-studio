<script setup lang="ts">
import { TmcutBadge, TmcutButton, TmcutProfileCard, TmcutAiConnect, USwitch, USlider } from '#components'
import type { AutocutProfile } from '~/composables/useTmcutAutocut'
import { splitKeywords, joinKeywords } from '~/utils/tmcut/autocutPrefs'

interface Props {
  sourceAsset: {
    name: string
  } | null
  selectedProfile: string
  filterFillerWords: boolean
  aiAnalysis: boolean
  aiWeight: number
  keywordChips: string[]
  keywordDraft: string
  highlightKeywordsText: string
  aiProfiles: Array<{
    id: string
    name: string
    desc: string
    icon: string
  }>
  analyzing: boolean
  highlightKeywords: string[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  back: []
  analyze: []
  rescore: [profile: string]
  'update:filterFillerWords': [value: boolean]
  'update:aiAnalysis': [value: boolean]
  'update:aiWeight': [value: number]
  'update:highlightKeywordsText': [value: string]
  'update:selectedProfile': [value: string]
}>()

// Commit the keyword input (Enter/comma/blur share this handler). Kept out of
// the template so the EventTarget narrowing lives in TypeScript, not in
// repeated inline casts.
function keywordsInput(event: Event) {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  emit('update:highlightKeywordsText', joinKeywords([...props.keywordChips, ...target.value.split(',')]))
}
</script>

<template>
  <div class="space-y-6 animate-slide-up">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <TmcutProfileCard
        v-for="prof in aiProfiles"
        :key="prof.id"
        :profile="prof"
        :selected="props.selectedProfile === prof.id"
        @select="emit('update:selectedProfile', prof.id as 'viral-shorts' | 'podcast-summary' | 'cinematic-vlog')"
      />
    </div>

    <div class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 space-y-6">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-8 h-8 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-500">
            <UIcon name="i-lucide-sparkles" class="w-4 h-4" />
          </div>
          <h4 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ $t('tmcut.autocutV2.title') }}</h4>
        </div>
        <TmcutBadge variant="primary" size="xs" class="font-mono">{{ $t('tmcut.autocutV2.badge') }}</TmcutBadge>
      </div>

      <p class="text-sm text-neutral-500">{{ $t('tmcut.autocutV2.desc') }}</p>

      <div class="space-y-4 pt-2">
        <div class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-filter-x" class="w-4 h-4 text-amber-500 shrink-0" />
              <span class="text-xs font-medium text-neutral-900 dark:text-neutral-100">{{ $t('tmcut.autocutV2.filterFillerLabel') }}</span>
            </div>
            <p class="text-xs text-neutral-500">{{ $t('tmcut.autocutV2.filterFillerDesc') }}</p>
          </div>
          <USwitch v-model="props.filterFillerWords" size="md" @update:model-value="emit('update:filterFillerWords', $event)" />
        </div>

        <div class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl p-4">
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-sky-500 shrink-0" />
              <span class="text-xs font-medium text-neutral-900 dark:text-neutral-100">{{ $t('tmcut.autocutV2.aiAnalysisLabel') }}</span>
            </div>
            <p class="text-xs text-neutral-500">{{ $t('tmcut.autocutV2.aiAnalysisDesc') }}</p>
          </div>
          <USwitch v-model="props.aiAnalysis" size="md" @update:model-value="emit('update:aiAnalysis', $event)" />
        </div>

        <div v-if="props.aiAnalysis" class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-neutral-900 dark:text-neutral-100">{{ $t('tmcut.autocutV2.aiWeightLabel') }}</span>
            <span class="text-xs tabular-nums text-neutral-500 font-mono">{{ Math.round(props.aiWeight * 100) }}%</span>
          </div>
          <USlider v-model="props.aiWeight" :min="0" :max="0.5" :step="0.05" @update:model-value="emit('update:aiWeight', $event as number)" />
          <p class="text-xs text-neutral-400">{{ $t('tmcut.autocutV2.aiWeightDesc') }}</p>
        </div>

        <div class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-tag" class="w-4 h-4 text-purple-500 shrink-0" />
              <span class="text-xs font-medium text-neutral-900 dark:text-neutral-100">{{ $t('tmcut.autocutV2.keywordsLabel') }}</span>
            </div>
            <span class="text-xs text-neutral-400">{{ $t('tmcut.autocutV2.keywordsOptional') }}</span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 px-2 py-1.5">
            <span v-for="chip in props.keywordChips" :key="chip" class="inline-flex items-center gap-1 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 px-2 py-0.5 text-xs font-medium">
              {{ chip }}
              <button type="button" class="hover:text-purple-800 dark:hover:text-purple-200" @click="$emit('update:highlightKeywordsText', joinKeywords(props.highlightKeywordsText.split(',').filter(c => c !== chip)))">
                <UIcon name="i-lucide-x" class="w-3 h-3" />
              </button>
            </span>
            <input :value="props.keywordDraft" size="sm" class="flex-1 min-w-24 bg-transparent text-xs text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none" :placeholder="props.keywordChips.length ? '' : $t('tmcut.autocutV2.keywordsPlaceholder')" @input="keywordsInput" @keydown.enter="keywordsInput" @blur="keywordsInput" />
          </div>
          <p class="text-xs text-neutral-400">{{ $t('tmcut.autocutV2.keywordsHelp') }}</p>
        </div>
      </div>

      <TmcutAiConnect class="my-4" />

      <div class="flex justify-between pt-2 border-t border-neutral-200 dark:border-neutral-800">
        <TmcutButton variant="soft" color="neutral" @click="$emit('back')">{{ $t('tmcut.back') }}</TmcutButton>
        <TmcutButton color="primary" variant="solid" size="lg" icon="i-lucide-play" :disabled="!sourceAsset" @click="$emit('analyze')">{{ $t('tmcut.steps.analyzeEdl') }}</TmcutButton>
      </div>
    </div>
  </div>
</template>