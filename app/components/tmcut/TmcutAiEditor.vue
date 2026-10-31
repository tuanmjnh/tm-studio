<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutAiEditor } from '~/composables/useTmcutAiEditor'
import { useTmcutAiScript } from '~/composables/useTmcutAiScript'

// AI Editor (roadmap v3 PART C / §13): the model proposes an Edit Plan,
// the core validates it, the user reviews the diff, and apply runs it
// through core commands as ONE undo entry. The chat is a thin control
// surface — it never holds project state.
const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  (e: 'plan-applied', applied: number, skipped: number): void
}>()

const { t } = useI18n()
const toast = useToast()

const {
  generating,
  applying,
  plan,
  planLines,
  unresolvedMediaRefs,
  validationErrors,
  lastError,
  lastTrace,
  generatePlan,
  applyPlan,
  clearPlan
} = useTmcutAiEditor()
const { hasAiKey, checkGatewayStatus } = useTmcutAiScript()

const prompt = ref('')

const ready = computed(() => plan.value && validationErrors.value.length === 0)

onMounted(() => {
  checkGatewayStatus()
})

async function handleGenerate() {
  if (!prompt.value.trim()) {
    toast.add({
      title: t('tmcut.aiEditor.emptyPromptTitle'),
      description: t('tmcut.aiEditor.emptyPromptDesc'),
      color: 'warning'
    })
    return
  }
  await generatePlan(prompt.value.trim())
  if (lastError.value) {
    toast.add({
      title: t('tmcut.aiEditor.errorTitle'),
      description: lastError.value,
      color: 'error'
    })
  } else if (validationErrors.value.length > 0) {
    toast.add({
      title: t('tmcut.aiEditor.invalidPlanTitle'),
      description: t('tmcut.aiEditor.invalidPlanDesc'),
      color: 'warning'
    })
  }
}

function handleApply() {
  const result = applyPlan()
  if (!result.ok) return
  emit('plan-applied', result.applied, result.skipped)
  toast.add({
    title: t('tmcut.aiEditor.appliedTitle'),
    description: t('tmcut.aiEditor.appliedDesc', { applied: result.applied, skipped: result.skipped }),
    color: result.skipped > 0 ? 'info' : 'success'
  })
}

function closeModal() {
  clearPlan()
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
            <UIcon name="i-lucide-wand-sparkles" class="w-5 h-5" />
          </div>
          <div>
            <h3 class="text-base font-semibold text-neutral-900 dark:text-white flex items-center gap-2">
              {{ t('tmcut.aiEditor.title') }}
              <UBadge :color="hasAiKey ? 'success' : 'neutral'" variant="subtle" size="xs">
                {{ hasAiKey ? t('tmcut.aiEditor.gatewayOnline') : t('tmcut.aiEditor.gatewayOff') }}
              </UBadge>
            </h3>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.aiEditor.subtitle') }}
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
        <!-- Left: prompt + model choice (connection management lives elsewhere) -->
        <div class="lg:col-span-5 flex flex-col gap-4">
          <TmcutAiModelPicker task="plan" label-key="tmcut.aiModelPicker.surfaceEdit" @applied="checkGatewayStatus()" />

          <div>
            <label for="tmcut-aieditor-prompt-label" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300 mb-1.5">
              {{ t('tmcut.aiEditor.promptLabel') }}
            </label>
            <UTextarea
              id="tmcut-aieditor-prompt-label"
              v-model="prompt"
              :placeholder="t('tmcut.aiEditor.promptPlaceholder')"
              :rows="5"
              class="w-full text-sm"
            />
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
              {{ t('tmcut.aiEditor.generateButton') }}
            </UButton>
            <UButton
              v-if="plan"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-rotate-ccw"
              :loading="generating"
              @click="handleGenerate"
            >
              {{ t('tmcut.aiEditor.regenerateButton') }}
            </UButton>
          </div>
        </div>

        <!-- Right: plan review -->
        <div class="lg:col-span-7 flex flex-col gap-3">
          <!-- Empty state -->
          <div
            v-if="!plan && validationErrors.length === 0 && !lastError"
            class="flex-1 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg p-6 text-center"
          >
            <UIcon name="i-lucide-clipboard-list" class="size-8 mx-auto text-neutral-400 mb-2" />
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ t('tmcut.aiEditor.emptyStateTitle') }}
            </p>
            <p class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
              {{ t('tmcut.aiEditor.emptyStateDesc') }}
            </p>
          </div>

          <!-- Error / invalid state -->
          <div
            v-else-if="!plan && (validationErrors.length > 0 || lastError)"
            class="rounded-lg border border-red-500/40 bg-red-500/10 p-4"
          >
            <div class="flex items-center gap-2 mb-2">
              <UIcon name="i-lucide-circle-alert" class="size-4 text-red-400" />
              <p class="text-xs font-semibold text-red-300">
                {{ t('tmcut.aiEditor.invalidPlanTitle') }}
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

          <!-- Reviewed plan -->
          <div v-else-if="plan" class="flex flex-col gap-3 min-h-0">
            <div class="rounded-lg border border-primary-500/40 bg-primary-500/10 p-3">
              <p class="text-xs font-semibold text-primary-200">
                {{ plan.intentSummary || t('tmcut.aiEditor.intent') }}
              </p>
              <ul v-if="plan.assumptions && plan.assumptions.length > 0" class="mt-1.5 space-y-0.5">
                <li
                  v-for="assumption in plan.assumptions"
                  :key="assumption"
                  class="text-[11px] text-primary-200/80 flex items-start gap-1.5"
                >
                  <UIcon name="i-lucide-info" class="size-3 mt-0.5 shrink-0" />
                  <span>{{ assumption }}</span>
                </li>
              </ul>
            </div>

            <div class="rounded-lg border border-neutral-300 dark:border-neutral-800 overflow-hidden flex-1 min-h-0 flex flex-col">
              <div class="px-3 py-1.5 bg-neutral-100/80 dark:bg-neutral-900/80 border-b border-neutral-300 dark:border-neutral-800 flex items-center justify-between">
                <p class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">
                  {{ t('tmcut.aiEditor.operationsTitle') }}
                </p>
                <UBadge color="neutral" variant="subtle" size="xs">
                  {{ plan.operations.length }}
                </UBadge>
              </div>
              <div class="flex-1 overflow-y-auto max-h-64 p-2 space-y-1">
                <div
                  v-for="(line, index) in planLines"
                  :key="index"
                  class="flex items-center gap-2 px-2 py-1 rounded-md text-[11px] font-mono bg-neutral-100/70 dark:bg-neutral-900/70 text-neutral-700 dark:text-neutral-300"
                >
                  <UIcon name="i-lucide-check" class="size-3 text-primary-400 shrink-0" />
                  <span class="truncate">{{ line }}</span>
                </div>
              </div>
            </div>

            <!-- Unresolvable media refs (would be skipped at apply time) -->
            <div
              v-if="unresolvedMediaRefs.length > 0"
              class="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200"
            >
              <UIcon name="i-lucide-triangle-alert" class="size-3.5 mt-0.5 shrink-0" />
              <span>{{ t('tmcut.aiEditor.unresolvedMedia', { count: unresolvedMediaRefs.length }) }}</span>
            </div>

            <div class="flex items-center gap-2">
              <UButton
                color="primary"
                variant="soft"
                icon="i-lucide-check-check"
                :loading="applying"
                :disabled="!ready"
                @click="handleApply"
              >
                {{ t('tmcut.aiEditor.applyButton') }}
              </UButton>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-trash-2"
                @click="clearPlan"
              >
                {{ t('tmcut.aiEditor.discardButton') }}
              </UButton>
              <span class="text-[10px] text-neutral-400 ml-auto flex items-center gap-1">
                <UIcon name="i-lucide-history" class="size-3" />
                {{ t('tmcut.aiEditor.undoHint') }}
              </span>
            </div>
          </div>

          <!-- Apply result summary -->
          <div
            v-if="lastTrace"
            class="rounded-lg border border-neutral-300 dark:border-neutral-800 p-3 flex items-center gap-2"
          >
            <UIcon name="i-lucide-badge-check" class="size-4 text-primary-400" />
            <p class="text-[11px] text-neutral-600 dark:text-neutral-300">
              {{ t('tmcut.aiEditor.appliedDesc', { applied: lastTrace.applied.length, skipped: lastTrace.skipped.length }) }}
            </p>
            <ul v-if="lastTrace.skipped.length > 0" class="ml-auto text-[10px] font-mono text-neutral-400 text-right max-w-48">
              <li v-for="step in lastTrace.skipped.slice(0, 3)" :key="step.index">
                op[{{ step.index }}]: {{ step.reason }}
              </li>
            </ul>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
