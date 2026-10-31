<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiGatewayStatus, AiModelInfo, AiProviderPreset, AiTaskStatus } from '#shared/types/electron'
import { useHub } from '~/composables/useHub'
import { useHubAi } from '~/composables/useHubAi'
import { useTmcutAi } from '~/composables/useTmcutAi'
import { AI_TASK_META, type AiTaskId } from '~/utils/tmcut/aiTasks'
import {
  connectionBaseUrl,
  connectionModel,
  firstAnsweringModel,
  isUsableHubConnection,
  resolveGatewayProvider,
  selectHubConnection,
  type HubConnectionLike,
  type ModelProbeVerdict
} from '~/utils/tmcut/hubAiConnection'

// =============================================================================
//  AI connection panel (roadmap R128 / R129).
//
//  Structure: ONE global config (AI_PROVIDER / AI_BASE_URL / AI_API_KEY /
//  AI_MODEL) + two per-surface overrides:
//
//    Editor  — script generation (task `plan`) + captions (task `transcribe`)
//    AutoCut — captions (task `transcribe`) + future analysis (task `triage`)
//
//  A surface card set to "custom" writes the AI_*_<TASK> slots (set-config
//  -> process.env, so the gateway picks changes up without restart); left
//  at "global" it simply inherits the top form. The read-only surface rows
//  show the RESOLVED provider/model each part of the app actually runs on
//  (tasksStatus), so a user can see "script = GPT-4o, captions = whisper"
//  at a glance. The API key is WRITE-ONLY in this panel (never read back).
// =============================================================================

const emit = defineEmits<{
  (e: 'saved'): void
}>()

const { t } = useI18n()
const toast = useToast()
const { status, listModels, providerPresets, tasks, complete } = useTmcutAi()

const expanded = ref(false)
const loading = ref(false)
const saving = ref(false)
const hasStoredKey = ref(false)
const gatewayStatus = ref<AiGatewayStatus | null>(null)
const presets = ref<AiProviderPreset[]>([])
const models = ref<AiModelInfo[]>([])
const surfaceTasks = ref<Record<string, AiTaskStatus> | null>(null)

const form = ref({ provider: 'openai', baseUrl: '', apiKey: '', model: '' })

/**
 * Editable surfaces = every AI task with a real caller in the app:
 * `plan` is the editor script writer, `transcribe` is AutoCut/caption audio,
 * `triage` is the AutoCut content-analysis blend (docs §194).
 */
type SurfaceTask = 'plan' | 'transcribe' | 'triage'
const SURFACE_KEYS: SurfaceTask[] = ['plan', 'transcribe', 'triage']

interface SurfaceForm {
  custom: boolean
  provider: string
  baseUrl: string
  apiKey: string
  model: string
}

const surfaces = ref<Record<SurfaceTask, SurfaceForm>>({
  plan: { custom: false, provider: '', baseUrl: '', apiKey: '', model: '' },
  transcribe: { custom: false, provider: '', baseUrl: '', apiKey: '', model: '' },
  triage: { custom: false, provider: '', baseUrl: '', apiKey: '', model: '' }
})

const isDesktop = computed(() => typeof window !== 'undefined' && !!window.electronAPI?.tools?.aiGateway)

const selectedPreset = computed(() => presets.value.find(p => p.id === form.value.provider) || null)

const baseUrlMissing = computed(() => !form.value.baseUrl.trim() && !selectedPreset.value?.baseUrl)

const configured = computed(() => gatewayStatus.value?.configured === true)

const statusColor = computed(() => {
  if (configured.value) return 'success'
  return isDesktop.value ? 'warning' : 'neutral'
})

onMounted(async () => {
  // Web: refresh() reads the relay status/presets/hub choices — the status
  // badge must reflect the real runtime on both desktop and web.
  await refresh()
})

async function refresh() {
  await loadPresets()
  void loadHubChoices()
  gatewayStatus.value = await status()
  hasStoredKey.value = gatewayStatus.value?.hasKey === true
  if (gatewayStatus.value) {
    form.value.provider = gatewayStatus.value.provider || 'openai'
    form.value.baseUrl = gatewayStatus.value.baseUrl || selectedPreset.value?.baseUrl || ''
    form.value.model = gatewayStatus.value.model || ''
  }
  surfaceTasks.value = await tasks()
  // Hydrate the override editors from the RESOLVED surface status: a
  // customized surface starts from its own provider/model/endpoint, a
  // global one stays inherited (with the current key shown as "stored").
  for (const task of SURFACE_KEYS) {
    const st = surfaceTasks.value?.[task]
    const s = surfaces.value[task]
    if (!st) continue
    s.custom = st.customized === true
    if (s.custom) {
      s.provider = st.provider
      s.baseUrl = st.baseUrl || presetBaseUrl(st.provider) || ''
      s.model = st.model || ''
    } else {
      s.provider = ''
      s.baseUrl = ''
      s.apiKey = ''
      s.model = ''
    }
  }
}

function presetBaseUrl(provider: string): string | undefined {
  return presets.value.find(p => p.id === provider)?.baseUrl || undefined
}

/** Icons/labels for the surface cards come from the task registry. */
function surfaceIcon(task: SurfaceTask): string {
  return AI_TASK_META[task as AiTaskId].icon
}
function surfaceLabelKey(task: SurfaceTask): string {
  return AI_TASK_META[task as AiTaskId].labelKey
}

async function loadPresets() {
  if (presets.value.length > 0) return
  presets.value = await providerPresets()
}

/** Switching the global provider prefills the built-in endpoint. */
function handleProviderChange() {
  models.value = []
  const preset = selectedPreset.value
  form.value.baseUrl = preset?.baseUrl || ''
  if (form.value.provider === 'anthropic') form.value.model = form.value.model || 'claude-haiku-4-5'
  else form.value.model = form.value.model || ''
}

function handleSurfaceToggle(task: SurfaceTask) {
  const s = surfaces.value[task]
  if (!s.custom) {
    // Start the override from the CURRENTLY RESOLVED values so toggling is
    // non-destructive: the surface keeps what it ran on before.
    const st = surfaceTasks.value?.[task]
    s.provider = st?.provider || form.value.provider
    s.baseUrl = st?.baseUrl || presetBaseUrl(s.provider) || form.value.baseUrl
    s.model = st?.model || form.value.model
    s.custom = true
  } else {
    s.custom = false
    s.provider = ''
    s.baseUrl = ''
    s.apiKey = ''
    s.model = ''
  }
}

/** Load models for the FORM the button sits next to (global or a surface). */
async function handleLoadModels(target: 'global' | SurfaceTask) {
  loading.value = true
  try {
    const args: { provider?: string, baseUrl?: string, apiKey?: string } = {}
    if (target === 'global') {
      args.provider = form.value.provider
      args.baseUrl = form.value.baseUrl.trim()
      if (form.value.apiKey.trim()) args.apiKey = form.value.apiKey.trim()
      const list = await listModels(args)
      models.value = list
      if (!form.value.model && list.length === 1) form.value.model = list[0]!.id
      toast.add({
        title: t('tmcut.aiConnect.modelsLoadedTitle'),
        description: t('tmcut.aiConnect.modelsLoadedDesc', { count: list.length }),
        color: 'success'
      })
    } else {
      const s = surfaces.value[target]
      args.provider = s.provider
      args.baseUrl = s.baseUrl.trim()
      if (s.apiKey.trim()) args.apiKey = s.apiKey.trim()
      const list = await listModels(args)
      s.baseUrl = args.baseUrl || s.baseUrl
      s.model = list.length === 1 ? list[0]!.id : s.model
      toast.add({
        title: t('tmcut.aiConnect.modelsLoadedTitle'),
        description: t('tmcut.aiConnect.modelsLoadedDesc', { count: list.length }),
        color: 'success'
      })
    }
  } catch (err) {
    toast.add({
      title: t('tmcut.aiConnect.loadFailedTitle'),
      description: String((err as Error)?.message || err),
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  if (!isDesktop.value) return
  if (baseUrlMissing.value) {
    toast.add({
      title: t('tmcut.aiConnect.needsBaseTitle'),
      description: t('tmcut.aiConnect.needsBaseDesc'),
      color: 'warning'
    })
    return
  }
  saving.value = true
  try {
    const values: Record<string, string> = {
      AI_PROVIDER: form.value.provider,
      AI_BASE_URL: form.value.baseUrl.trim(),
      AI_MODEL: form.value.model.trim()
    }
    if (form.value.apiKey.trim()) values.AI_API_KEY = form.value.apiKey.trim()

    // Per-surface slots: a surface toggled to custom writes its
    // AI_*_<TASK> keys; a surface back at "global" clears its slots so the
    // saved state is exactly what the UI shows.
    for (const task of SURFACE_KEYS) {
      const up = task.toUpperCase()
      const s = surfaces.value[task]
      if (!s.custom) {
        values[`AI_PROVIDER_${up}`] = ''
        values[`AI_BASE_URL_${up}`] = ''
        values[`AI_API_KEY_${up}`] = ''
        values[`AI_MODEL_${up}`] = ''
        continue
      }
      const preset = presets.value.find(p => p.id === s.provider)
      if (!s.baseUrl.trim() && !preset?.baseUrl) {
        throw new Error(`${task}: ${t('tmcut.aiConnect.needsBaseDesc')}`)
      }
      values[`AI_PROVIDER_${up}`] = s.provider
      values[`AI_BASE_URL_${up}`] = s.baseUrl.trim()
      if (s.apiKey.trim()) values[`AI_API_KEY_${up}`] = s.apiKey.trim()
      values[`AI_MODEL_${up}`] = s.model.trim()
    }

    const res = await window.electronAPI?.setConfig(values)
    if (!res?.success) throw new Error('set-config failed')
    // Saved config changed → every previous test verdict is stale.
    testResults.value = {}
    form.value.apiKey = ''
    for (const task of SURFACE_KEYS) surfaces.value[task].apiKey = ''
    await refresh()
    emit('saved')
    toast.add({
      title: t('tmcut.aiConnect.savedTitle'),
      description: t('tmcut.aiConnect.savedDesc'),
      color: 'success'
    })
  } catch (err) {
    toast.add({
      title: t('tmcut.aiConnect.saveFailedTitle'),
      description: String((err as Error)?.message || err),
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

// ===== Adopt a TM Hub connection (R151, spec tmcut_hub_ai_connection) =====
// AI Script / AutoCut should run on the SAME providers the app is connected
// to on TM Hub, without hand-typing a key. The panel fetches the stored key
// ONCE (it travels to the main process only), proves a candidate model
// answers with a REAL completion, then writes the GLOBAL gateway slots
// through the exact same save path as the manual form.
const ADOPT_PROBE_TIMEOUT_MS = 20_000

interface HubChoice {
  id: string
  connection: HubConnectionLike
  /** Display label: hub provider name — connection name. */
  label: string
}

const hubChoices = ref<HubChoice[]>([])
const hubLoading = ref(false)
const hubSelected = ref('')
const hubAdopting = ref(false)
const hubError = ref('')

/** Usable connections this app may adopt, fail-soft when the hub is away. */
async function loadHubChoices() {
  hubLoading.value = true
  hubError.value = ''
  try {
    const { appId } = useHub()
    const items = await useHubAi().listProviders(appId)
    const found: HubChoice[] = []
    for (const item of items) {
      for (const connection of item.connections || []) {
        if (!isUsableHubConnection(connection as HubConnectionLike)) continue
        const providerName = item.definition?.name || connection.provider
        found.push({
          id: connection.id,
          connection: connection as unknown as HubConnectionLike,
          label: `${providerName} — ${connection.name}`
        })
      }
    }
    hubChoices.value = found
    if (!hubChoices.value.some(c => c.id === hubSelected.value)) {
      hubSelected.value = found[0]?.id || ''
    }
  } catch (err) {
    hubChoices.value = []
    hubError.value = String((err as Error)?.message || err).slice(0, 120)
  } finally {
    hubLoading.value = false
  }
}

async function handleAdoptHub() {
  const choice = hubChoices.value.find(c => c.id === hubSelected.value)
  if (!choice || hubAdopting.value) return
  hubAdopting.value = true
  try {
    // 1) The stored key, fetched once from the hub key endpoint.
    const { appId, hubFetch } = useHub()
    const keyRes = await hubFetch<{ success: boolean, data?: { apiKey?: string } }>(
      `/api/v1/apps/${encodeURIComponent(appId)}/ai/connections/${encodeURIComponent(choice.id)}/key`
    )
    const apiKey = String(keyRes?.data?.apiKey || '').trim()
    if (!apiKey) throw new Error(t('tmcut.aiConnect.hubNoKey'))

    const presetList = await providerPresets()
    const probeProvider = resolveGatewayProvider(choice.connection.provider, presetList)
    const probeBaseUrl = connectionBaseUrl(choice.connection, presetList)

    // 2) Candidate models: the stored pick first, then every enabled row
    //    of the hub catalogue for this connection (aggregators have no
    //    stored model, which is exactly why the walk exists).
    let catalogue: string[] = []
    try {
      const rows = await useHubAi().listModels(appId, { provider: choice.connection.provider, connectionId: choice.id })
      catalogue = rows.filter(m => m.isEnabled !== false).map(m => m.modelId)
    } catch {
      // A provider without a published catalogue still has the stored model.
    }
    const storedModel = connectionModel(choice.connection, catalogue)
    const candidates = Array.from(new Set([storedModel, ...catalogue].map(m => m.trim()).filter(Boolean)))

    // 3) PROBE before saving anything. A stored-but-retired id (NVIDIA's
    //    01-ai/yi-large answers 404) would silence BOTH AI callers at once,
    //    because they swallow errors and fall back to presets — so the
    //    first walk verdict must be a real answer, not the catalogue.
    const probe = async (model: string): Promise<ModelProbeVerdict> => {
      try {
        await complete({
          provider: probeProvider,
          baseUrl: probeBaseUrl,
          apiKey,
          model,
          task: 'plan',
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
          // Reasoning models (GLM, Nemotron…) spend their first tokens
          // thinking: 8 tokens would end inside the reasoning block. 512
          // gives them room, 20s fails a hanging endpoint quickly.
          maxTokens: 512,
          timeoutMs: ADOPT_PROBE_TIMEOUT_MS
        })
        return { state: 'ok' }
      } catch (err) {
        const msg = String((err as Error)?.message || err)
        if (/401|403|unauthorized|forbidden/i.test(msg)) return { state: 'unreachable', detail: msg }
        if (/timed?[\s-]?out|timeout/i.test(msg)) return { state: 'timeout', detail: msg }
        return { state: 'missing', detail: msg }
      }
    }
    const answer = await firstAnsweringModel(candidates, probe, { concurrency: 3, silentLimit: 3 })
    if (!answer.model) {
      const silent = answer.reason === 'silent'
      toast.add({
        title: t('tmcut.aiConnect.hubProbeFailTitle'),
        description: silent
          ? t('tmcut.aiConnect.hubProbeSilentDesc')
          : t('tmcut.aiConnect.hubProbeFailDesc', { detail: (answer.last?.detail || '').slice(0, 140) }),
        color: 'warning'
      })
      return
    }

    // 4) Resolve every slot through the shared rules, then save through the
    //    SAME handleSave() path as the manual form. Surface overrides are
    //    reset first so plan/transcribe/triage ALL inherit the adoption.
    const selection = selectHubConnection(choice.connection, presetList, { apiKey, model: answer.model })
    if (!selection.ok) {
      toast.add({
        title: t('tmcut.aiConnect.hubNoModelTitle'),
        description: selection.error === 'missing-base-url'
          ? t('tmcut.aiConnect.needsBaseDesc')
          : t('tmcut.aiConnect.hubNoModelDesc'),
        color: 'warning'
      })
      return
    }
    const swapped = gatewayStatus.value?.hasKey === true
    form.value.provider = selection.provider
    form.value.baseUrl = selection.baseUrl
    form.value.model = selection.model
    form.value.apiKey = selection.apiKey
    for (const task of SURFACE_KEYS) {
      surfaces.value[task] = { custom: false, provider: '', baseUrl: '', apiKey: '', model: '' }
    }
    await handleSave()
    toast.add({
      title: t('tmcut.aiConnect.hubAdoptedTitle'),
      description: swapped
        ? t('tmcut.aiConnect.hubAdoptedSwappedDesc', { model: selection.model })
        : t('tmcut.aiConnect.hubAdoptedDesc', { model: selection.model }),
      color: 'success'
    })
  } catch (err) {
    toast.add({
      title: t('tmcut.aiConnect.hubKeyFailedTitle'),
      description: String((err as Error)?.message || err).slice(0, 180),
      color: 'error'
    })
  } finally {
    hubAdopting.value = false
  }
}

/** Read-only rows: what each part of the app actually runs right now. */
const surfaceRows = computed(() => {
  const rows: Array<{ key: string, task: TestTarget, label: string, st: AiTaskStatus | null }> = [
    { key: 'editorScript', task: 'plan', label: t('tmcut.aiConnect.surfaceEditorScript'), st: surfaceTasks.value?.['plan'] || null },
    { key: 'captions', task: 'transcribe', label: t('tmcut.aiConnect.surfaceCaptions'), st: surfaceTasks.value?.['transcribe'] || null },
    { key: 'autocut', task: 'triage', label: t('tmcut.aiConnect.surfaceAutocut'), st: surfaceTasks.value?.['triage'] || null }
  ]
  return rows
})

// ===== Test a saved connection (R139, docs §203) ======================
// The ONLY honest test of a stored key is a request the MAIN process
// signs with it: listModels resolves the surface's own AI_*_<TASK> slots
// server-side, so the panel verifies what it cannot read. A 401/403 is
// the key being wrong; a 404 on /models still proves the endpoint + key
// handshake works (some providers just do not publish a model list).
type TestTarget = 'global' | 'plan' | 'transcribe' | 'triage'
interface TestResult {
  state: 'ok' | 'warn' | 'fail'
  detail: string
}
const testing = ref<Record<string, boolean>>({})
const testResults = ref<Record<string, TestResult>>({})

async function handleTest(task: TestTarget) {
  if (testing.value[task]) return
  testing.value = { ...testing.value, [task]: true }
  try {
    const list = await listModels(task === 'global' ? {} : { task })
    testResults.value = {
      ...testResults.value,
      [task]: { state: 'ok', detail: t('tmcut.aiConnect.testOk', { count: list.length }) }
    }
  } catch (err) {
    const message = String((err as Error)?.message || err)
    // Provider did answer, just not with a model list → credentials fine.
    const reachable = /no model ids|has no model/i.test(message)
    testResults.value = {
      ...testResults.value,
      [task]: { state: reachable ? 'warn' : 'fail', detail: message.slice(0, 180) }
    }
  } finally {
    testing.value = { ...testing.value, [task]: false }
  }
}

const testStateColor = (r: TestResult | undefined) =>
  r?.state === 'ok' ? 'success' : r?.state === 'warn' ? 'warning' : 'error'

/** Surfaces with a verdict, pre-joined so the template never indexes a
 *  Record with a possibly-missing key. The loop shape (not filter) is
 *  what narrows `res` to TestResult for vue-tsc. */
const testedRows = computed(() => {
  const rows: Array<{ task: TestTarget, label: string, res: TestResult }> = []
  for (const row of surfaceRows.value) {
    const res = testResults.value[row.task]
    if (res) rows.push({ task: row.task, label: row.label, res })
  }
  return rows
})
</script>

<template>
  <div class="rounded-lg border border-neutral-200 dark:border-neutral-800">
    <button
      type="button"
      class="w-full flex items-center justify-between gap-2 px-3 py-2 text-left"
      @click="expanded = !expanded"
    >
      <span class="flex items-center gap-2 text-xs font-medium text-neutral-700 dark:text-neutral-300">
        <UIcon name="i-lucide-plug" class="w-4 h-4 shrink-0" />
        {{ t('tmcut.aiConnect.title') }}
      </span>
      <span class="flex items-center gap-2 shrink-0">
        <UBadge :color="statusColor" variant="subtle" size="xs">
          {{ configured ? t('tmcut.aiConnect.ready') : t('tmcut.aiConnect.notConfigured') }}
        </UBadge>
        <UIcon :name="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="w-4 h-4 text-neutral-400" />
      </span>
    </button>

    <div
      v-if="expanded"
      class="px-3 pb-3 pt-3 border-t border-neutral-200 dark:border-neutral-800 flex flex-col gap-3"
    >
      <p v-if="!isDesktop" class="text-[11px] text-amber-600 dark:text-amber-400">
        {{ t('tmcut.aiConnect.desktopOnly') }}
      </p>

      <template v-else>
        <!-- ============ What each part of the app runs RIGHT NOW ============ -->
        <div class="rounded-md border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
          <div
            v-for="row in surfaceRows"
            :key="row.key"
            class="flex items-center justify-between gap-2 px-2 py-1.5"
          >
            <span class="text-[11px] text-neutral-600 dark:text-neutral-300">{{ row.label }}</span>
            <span class="flex items-center gap-1 min-w-0">
              <span
                class="text-[10px] font-mono text-neutral-500 dark:text-neutral-400 truncate max-w-[55%]"
                :class="row.st?.configured ? '' : 'text-amber-600 dark:text-amber-400'"
              >
                {{ row.st ? `${row.st.providerLabel}${row.st.overridden ? ' •' : ''}${row.st.model ? ' · ' + row.st.model : ''}` : '—' }}
              </span>
              <!-- Tests the SAVED slots for this task IN THE MAIN PROCESS
                   (the stored key never travels here), so the result is
                   about the real config, not about unsaved form values. -->
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-plug-zap"
                :loading="testing[row.task]"
                :title="t('tmcut.aiConnect.testTitle')"
                :aria-label="t('tmcut.aiConnect.testTitle')"
                @click="handleTest(row.task)"
              />
            </span>
          </div>
          <!-- Last test verdict per surface (kept until the next test). -->
          <div
            v-for="tested in testedRows"
            :key="`res-${tested.task}`"
            class="flex items-center gap-1.5 px-2 py-1"
          >
            <UBadge :color="testStateColor(tested.res)" variant="subtle" size="xs">
              {{ tested.label }}
            </UBadge>
            <span class="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">
              {{ tested.res.detail }}
            </span>
          </div>
        </div>
        <p class="text-[10px] text-neutral-400 dark:text-neutral-500 -mt-1.5">
          {{ t('tmcut.aiConnect.surfaceHint') }}
        </p>

        <!-- ============ Adopt a TM Hub connection (no re-typing) ========= -->
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-cloud-download" class="w-3.5 h-3.5 text-neutral-400" />
          <span class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase tracking-wide">
            {{ t('tmcut.aiConnect.hubLabel') }}
          </span>
        </div>
        <template v-if="hubChoices.length > 0">
          <div class="flex items-center gap-1.5">
            <select
              id="tmcut-aiconnect-hub"
              v-model="hubSelected"
              :aria-label="t('tmcut.aiConnect.hubLabel')"
              class="w-full min-w-0 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
              :disabled="hubAdopting"
            >
              <option value="">
                {{ t('tmcut.aiConnect.hubEmpty') }}
              </option>
              <option v-for="choice in hubChoices" :key="choice.id" :value="choice.id">
                {{ choice.label }}
              </option>
            </select>
            <UButton
              color="primary"
              variant="soft"
              size="xs"
              icon="i-lucide-download"
              class="shrink-0"
              :loading="hubAdopting"
              :disabled="!hubSelected"
              @click="handleAdoptHub"
            >
              {{ t('tmcut.aiConnect.hubUse') }}
            </UButton>
          </div>
          <p class="text-[10px] text-neutral-400 dark:text-neutral-500 -mt-1.5">
            {{ t('tmcut.aiConnect.hubHint') }}
          </p>
        </template>
        <p
          v-else-if="!hubLoading"
          class="text-[10px]"
          :class="hubError ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-400 dark:text-neutral-500'"
        >
          {{ hubError || t('tmcut.aiConnect.hubEmpty') }}
        </p>

        <!-- ============ Global (default) configuration ==================== -->
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-settings" class="w-3.5 h-3.5 text-neutral-400" />
          <span class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase tracking-wide">
            {{ t('tmcut.aiConnect.globalLabel') }}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="tmcut-aiconnect-provider" class="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
              {{ t('tmcut.aiConnect.providerLabel') }}
            </label>
            <select
              id="tmcut-aiconnect-provider"
              v-model="form.provider"
              class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
              @change="handleProviderChange"
            >
              <option v-for="preset in presets" :key="preset.id" :value="preset.id">
                {{ preset.label }}
              </option>
            </select>
          </div>
          <div>
            <label for="tmcut-aiconnect-model" class="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
              {{ t('tmcut.aiConnect.modelLabel') }}
            </label>
            <div class="flex items-center gap-1">
              <select
                v-if="models.length > 0"
                id="tmcut-aiconnect-model"
                v-model="form.model"
                class="w-full min-w-0 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
              >
                <option value="">
                  {{ t('tmcut.aiConnect.modelNone') }}
                </option>
                <option v-for="model in models" :key="model.id" :value="model.id">
                  {{ model.label === model.id ? model.id : `${model.label} — ${model.id}` }}
                </option>
              </select>
              <input
                v-else
                id="tmcut-aiconnect-model"
                v-model="form.model"
                type="text"
                spellcheck="false"
                :placeholder="t('tmcut.aiConnect.modelPlaceholder')"
                class="w-full min-w-0 text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
              >
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-refresh-cw"
                :loading="loading"
                :title="t('tmcut.aiConnect.loadModels')"
                @click="handleLoadModels('global')"
              />
            </div>
          </div>
        </div>

        <div>
          <label for="tmcut-aiconnect-base-url" class="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {{ t('tmcut.aiConnect.baseUrlLabel') }}
          </label>
          <input
            id="tmcut-aiconnect-base-url"
            v-model="form.baseUrl"
            type="text"
            spellcheck="false"
            :placeholder="t('tmcut.aiConnect.baseUrlPlaceholder')"
            class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
          >
          <p v-if="baseUrlMissing" class="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
            {{ t('tmcut.aiConnect.needsBaseHint') }}
          </p>
        </div>

        <div>
          <label for="tmcut-aiconnect-api-key" class="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
            {{ t('tmcut.aiConnect.apiKeyLabel') }}
          </label>
          <input
            id="tmcut-aiconnect-api-key"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="hasStoredKey ? t('tmcut.aiConnect.apiKeyKeepPlaceholder') : t('tmcut.aiConnect.apiKeyPlaceholder')"
            class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
          >
          <p v-if="hasStoredKey && !form.apiKey" class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {{ t('tmcut.aiConnect.apiKeyStoredHint') }}
          </p>
        </div>

        <!-- ============ Per-surface overrides (AI_*_<TASK> slots) ========= -->
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-git-branch" class="w-3.5 h-3.5 text-neutral-400" />
          <span class="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 uppercase tracking-wide">
            {{ t('tmcut.aiConnect.overridesLabel') }}
          </span>
        </div>

        <div
          v-for="task in SURFACE_KEYS"
          :key="task"
          class="rounded-md border border-neutral-200 dark:border-neutral-800 p-2 space-y-2"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between gap-2"
            @click="handleSurfaceToggle(task)"
          >
            <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
              <UIcon :name="surfaceIcon(task)" class="w-3.5 h-3.5 text-neutral-400" />
              {{ t(surfaceLabelKey(task)) }}
            </span>
            <UBadge :color="surfaces[task].custom ? 'primary' : 'neutral'" variant="subtle" size="xs">
              {{ surfaces[task].custom ? t('tmcut.aiConnect.surfaceCustom') : t('tmcut.aiConnect.surfaceGlobal') }}
            </UBadge>
          </button>

          <template v-if="surfaces[task].custom">
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label :for="`tmcut-aiconnect-${task}-provider`" class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  {{ t('tmcut.aiConnect.providerLabel') }}
                </label>
                <select
                  :id="`tmcut-aiconnect-${task}-provider`"
                  v-model="surfaces[task].provider"
                  class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
                >
                  <option v-for="preset in presets" :key="preset.id" :value="preset.id">
                    {{ preset.label }}
                  </option>
                </select>
              </div>
              <div>
                <label :for="`tmcut-aiconnect-${task}-model`" class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                  {{ t('tmcut.aiConnect.modelLabel') }}
                </label>
                <input
                  :id="`tmcut-aiconnect-${task}-model`"
                  v-model="surfaces[task].model"
                  type="text"
                  spellcheck="false"
                  :placeholder="t('tmcut.aiConnect.modelPlaceholder')"
                  class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
                >
              </div>
            </div>
            <div>
              <label :for="`tmcut-aiconnect-${task}-base-url`" class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {{ t('tmcut.aiConnect.baseUrlLabel') }}
              </label>
              <input
                :id="`tmcut-aiconnect-${task}-base-url`"
                v-model="surfaces[task].baseUrl"
                type="text"
                spellcheck="false"
                :placeholder="presetBaseUrl(surfaces[task].provider) || t('tmcut.aiConnect.baseUrlPlaceholder')"
                class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
              >
            </div>
            <div>
              <label :for="`tmcut-aiconnect-${task}-api-key`" class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                {{ t('tmcut.aiConnect.apiKeyLabel') }}
              </label>
              <input
                :id="`tmcut-aiconnect-${task}-api-key`"
                v-model="surfaces[task].apiKey"
                type="password"
                autocomplete="off"
                :placeholder="t('tmcut.aiConnect.apiKeyPlaceholder')"
                class="w-full text-xs rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1.5"
              >
            </div>
          </template>
        </div>

        <div class="flex items-center justify-between gap-2">
          <p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
            {{ t('tmcut.aiConnect.hint') }}
          </p>
          <span class="flex items-center gap-1 shrink-0">
            <UButton
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-plug-zap"
              :loading="testing['global']"
              @click="handleTest('global')"
            >
              {{ t('tmcut.aiConnect.test') }}
            </UButton>
            <UButton
              color="primary"
              variant="soft"
              size="xs"
              icon="i-lucide-save"
              :loading="saving"
              :disabled="baseUrlMissing"
              @click="handleSave"
            >
              {{ t('tmcut.aiConnect.save') }}
            </UButton>
          </span>
        </div>
        <p
          v-if="testResults['global']"
          class="text-[10px] -mt-1"
          :class="testResults['global'].state === 'ok'
            ? 'text-emerald-600 dark:text-emerald-400'
            : testResults['global'].state === 'warn'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-red-600 dark:text-red-400'"
        >
          {{ testResults['global'].detail }}
        </p>
      </template>
    </div>
  </div>
</template>
