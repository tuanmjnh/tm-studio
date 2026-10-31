<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TICKS_PER_SECOND } from '@tmcut-core'
import { useTmcutAiTemplates } from '~/composables/useTmcutAiTemplates'
import { useTmcutAiScript } from '~/composables/useTmcutAiScript'
import { useTmcutTemplates } from '~/composables/useTmcutTemplates'
import { AI_TEMPLATE_PROMPTS, type AiTemplatePrompt } from '~/assets/templates/ai-prompts'

// §6.5 — AI template builder: brief -> Template Plan (add-clip only) ->
// core-built template object -> review -> save into the template library.
// The saved template is a normal template: validateTemplate passed,
// requiredAssets + placeholders derived, `generatedBy` labelled.
const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  (e: 'saved', name: string): void
}>()

const { t } = useI18n()
const toast = useToast()

const {
  generating,
  draft,
  validationErrors,
  lastError,
  generateTemplate,
  clearDraft
} = useTmcutAiTemplates()
const { hasAiKey, checkGatewayStatus } = useTmcutAiScript()
const { saveAiTemplate } = useTmcutTemplates()

const brief = ref('')

const durationSec = computed(() => {
  const tpl = draft.value?.template
  return tpl ? (tpl.durationTicks / TICKS_PER_SECOND).toFixed(0) : null
})

// Group prompts by category for the suggestion UI
const promptsByCategory = computed((): Record<CategoryKey, AiTemplatePrompt[]> => {
  const groups: Record<CategoryKey, AiTemplatePrompt[]> = {
    intro: [],
    promo: [],
    outro: [],
    minimal: []
  }
  for (const p of AI_TEMPLATE_PROMPTS) {
    groups[p.category].push(p)
  }
  return groups
})

const categoryOrder = ['intro', 'promo', 'outro', 'minimal'] as const
type CategoryKey = typeof categoryOrder[number]

const categoryLabels: Record<CategoryKey, string> = {
  intro: t('tmcut.aiTemplates.promptCategoryIntro'),
  promo: t('tmcut.aiTemplates.promptCategoryPromo'),
  outro: t('tmcut.aiTemplates.promptCategoryOutro'),
  minimal: t('tmcut.aiTemplates.promptCategoryMinimal')
}

// Pre-computed array of categories that have prompts, for template typing
const categoriesWithPrompts = computed(() =>
  categoryOrder.filter(cat => promptsByCategory.value[cat].length > 0) as CategoryKey[]
)

onMounted(() => {
  checkGatewayStatus()
})

async function handleGenerate() {
  if (!brief.value.trim()) {
    toast.add({
      title: t('tmcut.aiTemplates.emptyBriefTitle'),
      description: t('tmcut.aiTemplates.emptyBriefDesc'),
      color: 'warning'
    })
    return
  }
  await generateTemplate(brief.value.trim())
  if (lastError.value) {
    toast.add({
      title: t('tmcut.aiTemplates.errorTitle'),
      description: lastError.value,
      color: 'error'
    })
  } else if (validationErrors.value.length > 0) {
    toast.add({
      title: t('tmcut.aiTemplates.invalidPlanTitle'),
      description: t('tmcut.aiTemplates.invalidPlanDesc'),
      color: 'warning'
    })
  }
}

function handleSave() {
  const tpl = draft.value?.template
  if (!tpl) return
  const saved = saveAiTemplate(tpl)
  if (!saved) {
    toast.add({
      title: t('tmcut.aiTemplates.saveFailedTitle'),
      description: t('tmcut.aiTemplates.saveFailedDesc'),
      color: 'error'
    })
    return
  }
  emit('saved', saved.name)
  toast.add({
    title: t('tmcut.aiTemplates.savedTitle'),
    description: saved.name,
    color: 'success'
  })
  open.value = false
}

function closeModal() {
  clearDraft()
  open.value = false
}

function usePrompt(prompt: string) {
  brief.value = prompt
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #content>
      <!-- Header -->
      <div class="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-lg bg-primary-500/10 dark:bg-primary-400/10 flex items-center justify-center text-primary-500"
          >
            <UIcon name="i-lucide-layout-template" class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              {{ t('tmcut.aiTemplates.title') }}
              <UBadge :color="hasAiKey ? 'success' : 'neutral'" variant="subtle" size="xs">
                {{ hasAiKey ? t('tmcut.aiTemplates.gatewayOnline') : t('tmcut.aiTemplates.gatewayOff') }}
              </UBadge>
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.aiTemplates.subtitle') }}
            </p>
          </div>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          size="sm"
          :aria-label="t('tmcut.hotkeys.close')"
          @click="closeModal"
        />
      </div>

      <!-- Body -->
      <div class="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 max-h-[75vh] overflow-y-auto">
        <!-- Left: brief + provider -->
        <div class="flex flex-col gap-4">
          <TmcutAiConnect @saved="checkGatewayStatus()" />

          <div>
            <label for="tmcut-aitemplates-brief-label" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.aiTemplates.briefLabel') }}
            </label>
            <UTextarea
              id="tmcut-aitemplates-brief-label"
              v-model="brief"
              :placeholder="t('tmcut.aiTemplates.briefPlaceholder')"
              :rows="6"
              class="w-full text-sm"
            />
          </div>

          <!-- Prompt Suggestions -->
          <div class="space-y-3 border-t border-neutral-200 dark:border-neutral-800 pt-3">
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.aiTemplates.promptSuggestionsDesc') }}
            </p>
            <div class="space-y-2">
              <div v-for="category in categoriesWithPrompts" :key="category">
                <p class="text-[11px] font-medium text-neutral-600 dark:text-neutral-300 uppercase tracking-wider mb-1">
                  {{ categoryLabels[category] }}
                </p>
                <div class="flex flex-wrap gap-1.5">
                  <UButton
                    v-for="prompt in promptsByCategory[category]"
                    :key="prompt.name"
                    size="xs"
                    variant="outline"
                    color="neutral"
                    class="whitespace-nowrap text-[11px] h-6"
                    @click="usePrompt(prompt.prompt)"
                  >
                    {{ prompt.name }}
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-col gap-2 pt-1">
            <UButton
              color="primary"
              variant="soft"
              icon="i-lucide-sparkles"
              :loading="generating"
              :disabled="!hasAiKey"
              @click="handleGenerate"
            >
              {{ t('tmcut.aiTemplates.generateButton') }}
            </UButton>
            <UButton
              v-if="draft"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-rotate-ccw"
              :loading="generating"
              @click="handleGenerate"
            >
              {{ t('tmcut.aiTemplates.regenerateButton') }}
            </UButton>
          </div>
        </div>

        <!-- Right: review -->
        <div class="flex flex-col gap-3">
          <div
            v-if="!draft && validationErrors.length === 0 && !lastError"
            class="flex-1 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg p-6 text-center"
          >
            <UIcon name="i-lucide-clipboard-list" class="size-8 mx-auto text-neutral-400 mb-2" />
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.aiTemplates.emptyStateTitle') }}
            </p>
            <p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
              {{ t('tmcut.aiTemplates.emptyStateDesc') }}
            </p>
          </div>

          <div
            v-else-if="!draft && (validationErrors.length > 0 || lastError)"
            class="rounded-lg border border-red-500/40 bg-red-500/10 p-4"
          >
            <div class="flex items-center gap-2 mb-2">
              <UIcon name="i-lucide-circle-alert" class="size-4 text-red-400" />
              <p class="text-xs font-semibold text-red-300">
                {{ t('tmcut.aiTemplates.invalidPlanTitle') }}
              </p>
            </div>
            <ul class="space-y-1 text-[11px] text-red-200/90 font-mono max-h-40 overflow-y-auto">
              <li v-if="lastError">
                {{ lastError }}
              </li>
              <li v-for="err in validationErrors" :key="err">
                {{ err }}
              </li>
            </ul>
          </div>

          <div v-else-if="draft" class="flex flex-col gap-3 min-h-0">
            <div class="rounded-lg border border-primary-500/40 bg-primary-500/10 p-3">
              <p class="text-xs font-semibold text-primary-200">
                {{ draft.template.name }}
              </p>
              <p class="text-[11px] text-primary-200/80 mt-0.5">
                {{ draft.template.description }}
              </p>
              <p class="text-[11px] text-primary-200/70 mt-1">
                {{ draft.template.canvas.width }}x{{ draft.template.canvas.height }} · {{ draft.template.aspectRatio }} · {{ t('tmcut.aiTemplates.aboutDuration', { sec: durationSec || '0' }) }}
              </p>
              <UBadge
                color="warning"
                variant="subtle"
                size="xs"
                class="mt-2"
              >
                {{ t('tmcut.aiTemplates.aiLabel') }}
              </UBadge>
            </div>

            <div class="rounded-lg border border-neutral-300 dark:border-neutral-800 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div class="px-3 py-1.5 bg-neutral-100/80 dark:bg-neutral-900/80 border-b border-neutral-300 dark:border-neutral-800 flex items-center justify-between">
                <p class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                  {{ t('tmcut.aiTemplates.operationsTitle') }}
                </p>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ draft.plan.operations.length }}
                </UBadge>
              </div>
              <div class="flex-1 overflow-y-auto max-h-60 p-2 space-y-1">
                <div
                  v-for="(line, index) in draft.lines"
                  :key="index"
                  class="flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-mono bg-neutral-100/70 dark:bg-neutral-900/70 text-neutral-700 dark:text-neutral-300"
                >
                  <UIcon name="i-lucide-check" class="size-3 text-primary-400 shrink-0" />
                  <span class="truncate">{{ line }}</span>
                </div>
              </div>
            </div>

            <div
              v-if="draft.warnings.length > 0"
              class="rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2"
            >
              <p class="text-[11px] text-amber-200 flex items-center gap-1.5">
                <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
                {{ t('tmcut.aiTemplates.placeholderNote') }}
              </p>
              <ul class="mt-1 ml-5 space-y-0.5">
                <li
                  v-for="warning in draft.warnings"
                  :key="warning"
                  class="text-[10px] font-mono text-amber-200/80"
                >
                  {{ warning }}
                </li>
              </ul>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-bookmark-plus"
                @click="handleSave"
              >
                {{ t('tmcut.aiTemplates.saveButton') }}
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-trash-2"
                @click="clearDraft"
              >
                {{ t('tmcut.aiTemplates.discardButton') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
