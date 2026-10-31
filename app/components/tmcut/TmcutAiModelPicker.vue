<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useHub } from '~/composables/useHub'
import { useHubAi } from '~/composables/useHubAi'
import { useTmcutAi } from '~/composables/useTmcutAi'
import {
  isUsableHubConnection,
  selectHubConnection,
  type HubConnectionLike
} from '~/utils/tmcut/hubAiConnection'

// =============================================================================
//  AI model chooser for one surface (AI Scriptwriter & Storyboard = `plan`).
//
//  Only models from providers that are ALREADY connected on TM Hub are
//  offered — this surface has no connection form on purpose: keys are
//  configured once (TM Hub / AutoCut panel) and here the user just picks which
//  connected model the scriptwriter runs on, then tests it.
//
//  Picking a model writes that SURFACE's routing: desktop persists the
//  AI_*_<TASK> config slots (key included, from the hub) via gateway IPC; web
//  persists just the routing decision (connectionId + provider + model) in
//  the browser slot store — the relay resolves credentials server-side, so
//  no key ever reaches the renderer. Testing runs a tiny real completion,
//  which is the only honest check (listing models proves nothing).
// =============================================================================

const props = withDefaults(defineProps<{
  task?: 'plan' | 'transcribe' | 'triage'
  /** i18n key naming the surface (hint line, e.g. "runs this AI Edit"). */
  labelKey?: string
}>(), {
  task: 'plan',
  labelKey: ''
})

const emit = defineEmits<{
  (e: 'applied'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { complete, tasks, providerPresets, saveTaskSlot } = useTmcutAi()

interface ModelChoice {
  value: string
  connection: HubConnectionLike
  modelId: string
  label: string
}

const loading = ref(false)
const applying = ref(false)
const testing = ref(false)
const choices = ref<ModelChoice[]>([])
const selected = ref('')
const testResult = ref<{ state: 'ok' | 'fail', detail: string } | null>(null)
const current = ref('')
// "no models connected" and "the hub could not be asked" look identical in
// the DOM but mean very different things — an expired session must never
// read as "you have no providers".
const hubError = ref<'' | 'signin' | 'unavailable'>('')

const isDesktop = computed(() => typeof window !== 'undefined' && !!window.electronAPI?.tools?.aiGateway)
const surfaceLabel = computed(() => props.labelKey ? t(props.labelKey) : t('tmcut.aiModelPicker.surfaceScript'))

onMounted(async () => {
  // Web: loadChoices / refreshCurrent work over the hub client + the relay
  // status path (no gateway needed) — do load on both runtimes.
  await Promise.all([loadChoices(), refreshCurrent()])
})

async function refreshCurrent() {
  const all = await tasks()
  const st = all?.[props.task]
  current.value = st?.model ? `${st.providerLabel} · ${st.model}` : ''
}

/** Connected connections → their enabled models, fail-soft when the hub is away. */
async function loadChoices() {
  loading.value = true
  hubError.value = ''
  try {
    const { appId } = useHub()
    const hubAi = useHubAi()
    const providers = await hubAi.listProviders(appId)
    const found: ModelChoice[] = []
    for (const item of providers) {
      for (const connection of item.connections || []) {
        if (!isUsableHubConnection(connection as HubConnectionLike)) continue
        // The list reads "Provider name — model id", so the provider's NAME
        // (definition.name, e.g. "NVIDIA NIM"), never the connection's URL.
        const providerName = item.definition?.name || connection.provider
        const typed = {
          ...(connection as unknown as HubConnectionLike),
          name: providerName,
          label: null
        } as HubConnectionLike
        try {
          const models = await hubAi.listModels(appId, { provider: connection.provider, connectionId: connection.id })
          for (const model of models) {
            if (model.isEnabled === false) continue
            found.push({
              value: `${connection.id}::${model.modelId}`,
              connection: typed,
              modelId: model.modelId,
              label: `${providerName} — ${model.modelId}`
            })
          }
        } catch {
          // A single provider without a published catalogue must not empty the list.
        }
      }
    }
    choices.value = found
    const match = found.find(c => current.value.endsWith(c.modelId))
    if (match) selected.value = match.value
  } catch (err) {
    choices.value = []
    const raw = JSON.stringify(err || {})
    hubError.value = /401|Unauthorized/.test(raw) ? 'signin' : 'unavailable'
  } finally {
    loading.value = false
  }
}

/** Pick → adopt that connection's key into THIS surface's slots only. */
async function handleSelect() {
  const choice = choices.value.find(c => c.value === selected.value)
  if (!choice || applying.value) return
  applying.value = true
  testResult.value = null
  try {
    if (isDesktop.value) {
      const { appId, hubFetch } = useHub()
      const res = await hubFetch<{ success: boolean, data: { apiKey: string } }>(
        `/api/v1/apps/${encodeURIComponent(appId)}/ai/connections/${encodeURIComponent(choice.connection.id)}/key`
      )
      const apiKey = String(res?.data?.apiKey || '').trim()
      if (!apiKey) throw new Error(t('tmcut.aiConnect.hubNoKey'))

      const presets = await providerPresets()
      const selection = selectHubConnection(choice.connection, presets, { apiKey, model: choice.modelId })
      if (!selection.ok) {
        throw new Error(selection.error === 'missing-base-url' ? t('tmcut.aiConnect.needsBaseDesc') : t('tmcut.aiConnect.hubNoModelDesc'))
      }

      const up = props.task.toUpperCase()
      const saved = await window.electronAPI?.setConfig({
        [`AI_PROVIDER_${up}`]: selection.provider,
        [`AI_BASE_URL_${up}`]: selection.baseUrl,
        [`AI_MODEL_${up}`]: selection.model,
        [`AI_API_KEY_${up}`]: selection.apiKey
      })
      if (!saved?.success) throw new Error('set-config failed')
    } else {
      // Web: the relay resolves credentials server-side per connectionId,
      // so the browser only remembers the routing decision — no key
      // fetch, no stored secret.
      saveTaskSlot(props.task, {
        connectionId: choice.connection.id,
        provider: choice.connection.provider,
        model: choice.modelId
      })
    }

    await refreshCurrent()
    emit('applied')
    toast.add({
      title: t('tmcut.aiModelPicker.appliedTitle'),
      description: t('tmcut.aiModelPicker.appliedDesc', { model: choice.label }),
      color: 'success'
    })
  } catch (err) {
    toast.add({
      title: t('tmcut.aiModelPicker.applyFailedTitle'),
      description: String((err as Error)?.message || err).slice(0, 180),
      color: 'error'
    })
  } finally {
    applying.value = false
  }
}

/**
 * Test = a REAL completion (a few tokens) through the main-process gateway
 * with the stored key. Listing models is not enough: AMD's catalogue answers
 * while its /chat/completions hangs, so only a chat round-trip proves the
 * model actually works.
 */
async function handleTest() {
  if (testing.value) return
  testing.value = true
  try {
    const started = Date.now()
    await complete({
      task: props.task,
      messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
      // Reasoning models (GLM, Nemotron…) spend their first tokens thinking:
      // 8 tokens would end inside the reasoning block and report a healthy
      // model as "no message content". 512 gives them room to actually answer,
      // and 20s fails a hanging endpoint instead of freezing the dialog for 60s.
      maxTokens: 512,
      timeoutMs: 20000
    })
    testResult.value = { state: 'ok', detail: t('tmcut.aiModelPicker.testOk', { ms: Date.now() - started }) }
  } catch (err) {
    testResult.value = { state: 'fail', detail: String((err as Error)?.message || err).slice(0, 160) }
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <div class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2.5 space-y-2">
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-1.5 text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase tracking-wide">
        <UIcon name="i-lucide-sparkles" class="w-3.5 h-3.5 text-neutral-400" />
        {{ t('tmcut.aiModelPicker.label') }}
      </span>
      <UBadge
        v-if="current"
        color="neutral"
        variant="subtle"
        size="xs"
        class="max-w-[60%] truncate"
      >
        {{ current }}
      </UBadge>
    </div>

    <div class="flex items-center gap-1.5">
      <select
        id="tmcut-ai-model-picker"
        v-model="selected"
        :aria-label="t('tmcut.aiModelPicker.label')"
        class="w-full min-w-0 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
        :disabled="loading || choices.length === 0"
        @change="handleSelect"
      >
        <option value="">
          {{ loading ? t('tmcut.aiModelPicker.loading') : t('tmcut.aiModelPicker.choose') }}
        </option>
        <option v-for="choice in choices" :key="choice.value" :value="choice.value">
          {{ choice.label }}
        </option>
      </select>
      <UButton
        color="neutral"
        variant="soft"
        size="xs"
        icon="i-lucide-plug-zap"
        class="shrink-0"
        :loading="testing"
        :disabled="!current"
        @click="handleTest"
      >
        {{ t('tmcut.aiModelPicker.test') }}
      </UButton>
    </div>
    <p v-if="hubError === 'signin' && !loading" class="text-[10px] text-amber-600 dark:text-amber-400">
      {{ t('tmcut.aiModelPicker.hubSignIn') }}
    </p>
    <p v-else-if="hubError === 'unavailable' && !loading" class="text-[10px] text-amber-600 dark:text-amber-400">
      {{ t('tmcut.aiModelPicker.hubUnavailable') }}
    </p>
    <p v-else-if="choices.length === 0 && !loading" class="text-[10px] text-amber-600 dark:text-amber-400">
      {{ t('tmcut.aiModelPicker.empty') }}
    </p>
    <p v-else class="text-[10px] text-neutral-400 dark:text-neutral-500">
      {{ t('tmcut.aiModelPicker.hint', { surface: surfaceLabel }) }}
    </p>

    <p
      v-if="testResult"
      class="text-[10px]"
      :class="testResult.state === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'"
    >
      {{ testResult.detail }}
    </p>
  </div>
</template>
