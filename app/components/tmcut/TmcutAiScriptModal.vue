<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import {
  useTmcutAiScript,
  type AiScriptPlatform,
  type AiScriptDuration,
  type TmcutAiScript,
  CURATED_SCRIPT_PRESETS
} from '~/composables/useTmcutAiScript'
import { useTmcutProject } from '~/composables/useTmcutProject'

// Nuxt UI v4 UModal contract (same defineModel('open') as every other
// studio modal): UModal ignores the old modelValue prop, which is why
// this modal used to never open from the toolbar button.
const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  (e: 'script-inserted', count: number): void
}>()

const { t } = useI18n()
const router = useRouter()
const toast = useToast()

const {
  generating,
  error,
  generatedScript,
  hasAiKey,
  checkGatewayStatus,
  generateScript,
  createProjectFromScript,
  insertScriptToCurrentTimeline,
  exportScriptMarkdown
} = useTmcutAiScript()

const { currentProject } = useTmcutProject()

const prompt = ref('')
const selectedPlatform = ref<AiScriptPlatform>('tiktok-shorts')
const selectedDuration = ref<AiScriptDuration>('30s')

const platformOptions = computed(() => [
  { value: 'tiktok-shorts' as AiScriptPlatform, label: t('tmcut.aiScript.platforms.tiktokShorts'), icon: 'i-lucide-smartphone' },
  { value: 'youtube-explainer' as AiScriptPlatform, label: t('tmcut.aiScript.platforms.youtubeExplainer'), icon: 'i-lucide-monitor' },
  { value: 'storytelling-vlog' as AiScriptPlatform, label: t('tmcut.aiScript.platforms.storytellingVlog'), icon: 'i-lucide-book-open' },
  { value: 'commercial-promo' as AiScriptPlatform, label: t('tmcut.aiScript.platforms.commercialPromo'), icon: 'i-lucide-megaphone' }
])

const durationOptions = computed(() => [
  { value: '15s' as AiScriptDuration, label: '15s' },
  { value: '30s' as AiScriptDuration, label: '30s' },
  { value: '60s' as AiScriptDuration, label: '60s' },
  { value: '120s' as AiScriptDuration, label: '2 min' }
])

const totalScriptDuration = computed(() => {
  if (!generatedScript.value) return 0
  return generatedScript.value.scenes.reduce((acc, s) => acc + (s.durationSec || 0), 0)
})

onMounted(async () => {
  await checkGatewayStatus()
})

async function handleGenerate() {
  if (!prompt.value.trim()) {
    toast.add({
      title: t('tmcut.aiScript.emptyPromptTitle'),
      description: t('tmcut.aiScript.emptyPromptDesc'),
      color: 'warning'
    })
    return
  }

  await generateScript({
    prompt: prompt.value.trim(),
    platform: selectedPlatform.value,
    duration: selectedDuration.value
  })

  if (error.value) {
    toast.add({
      title: t('tmcut.aiScript.generateNoticeTitle'),
      description: t('tmcut.aiScript.generateNoticeDesc', { reason: error.value }),
      color: 'info'
    })
  } else {
    toast.add({
      title: t('tmcut.aiScript.generateSuccessTitle'),
      description: t('tmcut.aiScript.generateSuccessDesc'),
      color: 'success'
    })
  }
}

function handleLoadPreset(preset: TmcutAiScript) {
  generatedScript.value = JSON.parse(JSON.stringify(preset))
  prompt.value = preset.title
  selectedPlatform.value = preset.platform
  toast.add({
    title: t('tmcut.aiScript.presetLoadedTitle'),
    description: preset.title,
    color: 'info'
  })
}

function handleCopyMarkdown() {
  if (!generatedScript.value) return
  const md = exportScriptMarkdown(generatedScript.value)
  navigator.clipboard.writeText(md)
  toast.add({
    title: t('global.copied'),
    description: t('tmcut.aiScript.copiedDesc'),
    color: 'success'
  })
}

function handleCreateNewProject() {
  if (!generatedScript.value) return
  const proj = createProjectFromScript(generatedScript.value)
  toast.add({
    title: t('tmcut.aiScript.projectCreatedTitle'),
    description: proj.name,
    color: 'success'
  })
  open.value = false
  router.push('/tmcut/editor')
}

function handleInsertToTimeline() {
  if (!generatedScript.value || !currentProject.value) return
  const count = insertScriptToCurrentTimeline(generatedScript.value, 0)
  toast.add({
    title: t('tmcut.aiScript.insertedTitle'),
    description: t('tmcut.aiScript.insertedDesc', { count }),
    color: 'success'
  })
  emit('script-inserted', count)
  open.value = false
}

function closeModal() {
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'max-w-5xl' }"
  >
    <template #content>
      <!-- Modal Header -->
      <div class="px-6 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-lg bg-primary-500/10 dark:bg-primary-400/10 flex items-center justify-center text-primary-500"
          >
            <UIcon name="i-lucide-sparkles" class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              {{ t('tmcut.aiScript.title') }}
              <UBadge :color="hasAiKey ? 'success' : 'neutral'" variant="subtle" size="xs">
                {{ hasAiKey ? t('tmcut.aiScript.gatewayOnline') : t('tmcut.aiScript.presetMode') }}
              </UBadge>
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.aiScript.subtitle') }}
            </p>
          </div>
        </div>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          size="sm"
          @click="closeModal"
        />
      </div>

      <!-- Modal Body -->
      <div class="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-h-[75vh] overflow-y-auto">
        <!-- Left Panel: Configuration -->
        <div class="lg:col-span-5 flex flex-col gap-4">
          <!-- R148: MODEL CHOOSER, not a connection form. This surface only
               offers models whose provider is already connected and enabled
               on TM Hub (keys are configured once, in the AI panel of AutoCut
               step 2), plus a Test button that runs a real completion. The
               Badge above reflects the stored config for this surface. -->
          <TmcutAiModelPicker @applied="checkGatewayStatus()" />

          <div>
            <label for="tmcut-aiscriptmodal-topic-label" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.aiScript.topicLabel') }}
            </label>
            <UTextarea
              id="tmcut-aiscriptmodal-topic-label"
              v-model="prompt"
              :placeholder="t('tmcut.aiScript.topicPlaceholder')"
              :rows="3"
              class="w-full text-sm"
            />
          </div>

          <div>
            <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.aiScript.platformLabel') }}
            </label>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="plat in platformOptions"
                :key="plat.value"
                type="button"
                class="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border text-left transition-all"
                :class="selectedPlatform === plat.value
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 text-primary-600 dark:text-primary-400 font-semibold'
                  : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'"
                @click="selectedPlatform = plat.value"
              >
                <UIcon :name="plat.icon" class="w-4 h-4 shrink-0" />
                <span class="truncate">{{ plat.label }}</span>
              </button>
            </div>
          </div>

          <div>
            <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.aiScript.durationLabel') }}
            </label>
            <div class="flex items-center gap-2">
              <button
                v-for="dur in durationOptions"
                :key="dur.value"
                type="button"
                class="flex-1 py-1.5 text-xs font-medium rounded-md border text-center transition-all"
                :class="selectedDuration === dur.value
                  ? 'border-primary-500 bg-primary-50/50 dark:bg-primary-950/30 text-primary-600 dark:text-primary-400'
                  : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900'"
                @click="selectedDuration = dur.value"
              >
                {{ dur.label }}
              </button>
            </div>
          </div>

          <div class="pt-2 flex flex-col gap-2">
            <UButton
              color="primary"
              variant="solid"
              icon="i-lucide-sparkles"
              :loading="generating"
              block
              @click="handleGenerate"
            >
              {{ t('tmcut.aiScript.generateButton') }}
            </UButton>
          </div>

          <!-- Curated Presets Bar -->
          <div class="pt-3 border-t border-neutral-200 dark:border-neutral-800">
            <span class="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 uppercase tracking-wider block mb-2">
              {{ t('tmcut.aiScript.samplePresets') }}
            </span>
            <div class="flex flex-col gap-1.5">
              <button
                v-for="(preset, idx) in CURATED_SCRIPT_PRESETS"
                :key="idx"
                type="button"
                class="text-left px-2.5 py-1.5 rounded text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors flex items-center justify-between group"
                @click="handleLoadPreset(preset)"
              >
                <span class="truncate group-hover:text-primary-500">{{ preset.title }}</span>
                <span class="text-[10px] text-neutral-500 dark:text-neutral-400 shrink-0 ml-2">{{ preset.targetDurationSec }}s</span>
              </button>
            </div>
          </div>
        </div>

        <!-- Right Panel: Storyboard Output -->
        <div class="lg:col-span-7 flex flex-col min-h-87.5">
          <template v-if="generatedScript">
            <div
              class="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800 mb-3"
            >
              <div>
                <h4 class="text-sm font-semibold text-neutral-900 dark:text-white">
                  {{ generatedScript.title }}
                </h4>
                <p class="text-xs text-neutral-500 line-clamp-1">
                  {{ generatedScript.synopsis }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge variant="subtle" color="primary" size="xs">
                  {{ generatedScript.scenes.length }} {{ t('tmcut.aiScript.scenesCount') }}
                </UBadge>
                <UBadge variant="subtle" color="neutral" size="xs">
                  ~{{ totalScriptDuration }}s
                </UBadge>
              </div>
            </div>

            <!-- Scene Cards List -->
            <div class="flex-1 overflow-y-auto space-y-3 pr-1">
              <div
                v-for="scene in generatedScript.scenes"
                :key="scene.id"
                class="p-3.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-900/40 text-xs flex flex-col gap-2 transition-all hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span
                      class="w-5 h-5 rounded-full bg-primary-100 dark:bg-primary-950 text-primary-600 dark:text-primary-400 flex items-center justify-center font-bold text-[10px]"
                    >
                      {{ scene.order }}
                    </span>
                    <span class="font-semibold text-neutral-800 dark:text-neutral-200">
                      {{ scene.title }}
                    </span>
                  </div>
                  <UBadge variant="outline" color="neutral" size="xs">
                    {{ scene.durationSec }}s
                  </UBadge>
                </div>

                <div v-if="scene.visualPrompt" class="flex items-start gap-2 text-neutral-600 dark:text-neutral-400">
                  <UIcon name="i-lucide-video" class="w-3.5 h-3.5 shrink-0 mt-0.5 text-neutral-500 dark:text-neutral-400" />
                  <span class="italic leading-relaxed">{{ scene.visualPrompt }}</span>
                </div>

                <div
                  v-if="scene.voiceover"
                  class="flex items-start gap-2 text-neutral-700 dark:text-neutral-300 bg-white dark:bg-neutral-950/60 p-2 rounded border border-neutral-200/60 dark:border-neutral-800/60"
                >
                  <UIcon name="i-lucide-mic" class="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary-500" />
                  <span class="leading-relaxed">"{{ scene.voiceover }}"</span>
                </div>

                <div
                  v-if="scene.onScreenText"
                  class="flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium"
                >
                  <UIcon name="i-lucide-type" class="w-3.5 h-3.5 shrink-0" />
                  <span>{{ scene.onScreenText }}</span>
                </div>
              </div>
            </div>
          </template>

          <!-- Empty State -->
          <div
            v-else
            class="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-neutral-200 dark:border-neutral-800 rounded-xl p-8 text-center text-neutral-500 dark:text-neutral-400"
          >
            <div
              class="w-12 h-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mb-3 text-neutral-500 dark:text-neutral-400"
            >
              <UIcon name="i-lucide-film" class="w-6 h-6" />
            </div>
            <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1">
              {{ t('tmcut.aiScript.emptyStateTitle') }}
            </p>
            <p class="text-xs text-neutral-500 dark:text-neutral-400 max-w-sm">
              {{ t('tmcut.aiScript.emptyStateDesc') }}
            </p>
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div
        class="px-6 py-3.5 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between bg-neutral-50/50 dark:bg-neutral-900/30"
      >
        <div>
          <UButton
            v-if="generatedScript"
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            size="sm"
            @click="handleCopyMarkdown"
          >
            {{ t('tmcut.aiScript.copyMarkdown') }}
          </UButton>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            @click="closeModal"
          >
            {{ t('global.cancel') }}
          </UButton>
          <UButton
            v-if="generatedScript && currentProject"
            color="neutral"
            variant="soft"
            icon="i-lucide-plus"
            size="sm"
            @click="handleInsertToTimeline"
          >
            {{ t('tmcut.aiScript.insertToTimeline') }}
          </UButton>
          <UButton
            v-if="generatedScript"
            color="primary"
            variant="solid"
            icon="i-lucide-folder-plus"
            size="sm"
            @click="handleCreateNewProject"
          >
            {{ t('tmcut.aiScript.createProject') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
