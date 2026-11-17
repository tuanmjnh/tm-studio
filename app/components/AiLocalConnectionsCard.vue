<script setup lang="ts">
import {
  AIConnectionsEditor,
  type AIConnectionRow,
  type AIConnectionsEditorLabels,
  type AIProviderOption
} from '@tuanmjnh/tm-ui'
import { AI_PROVIDERS, providerIconFor } from '@tuanmjnh/tm-ai-client'
import { getErrorMessage } from '~/shared/utils/errors'

/**
 * Per-account AI connections (Hybrid AI).
 *
 * Rows live in this app's own database, one document per account. The key is
 * sealed server-side (AES-256-GCM) and the server only reports `hasKey`, so the
 * field below starts empty on every load and an empty value keeps the stored key.
 */
interface SafeAIModel {
  modelId: string
  displayName?: string
  enabled: boolean
  isPrimary?: boolean
}

interface SafeAIConnection {
  connectionId: string
  providerKey: string
  baseUrl: string
  apiKeyEnv: string | null
  hasKey: boolean
  models: SafeAIModel[]
}

interface TestResult {
  ok: boolean
  message: string
}

const { t } = useI18n()
const notify = useNotify()

const rows = ref<AIConnectionRow[]>([])
const models = ref<Record<string, SafeAIModel[]>>({})
const loading = ref(true)
const saving = ref(false)
const refreshing = ref(false)
const loadError = ref('')
const testingId = ref('')
const tests = ref<Record<string, TestResult>>({})
const removeOpen = ref(false)
const removing = ref(false)
const removingRow = ref<AIConnectionRow | null>(null)

const providers: AIProviderOption[] = AI_PROVIDERS.map(provider => ({
  key: provider.key,
  name: provider.name,
  keyless: provider.keyless,
  defaultBaseUrl: provider.defaultBaseUrl
}))

const labels = computed<AIConnectionsEditorLabels>(() => ({
  connectionId: t('settings.aiLocal.connectionId'),
  connectionIdDesc: t('settings.aiLocal.connectionIdDesc'),
  provider: t('settings.aiLocal.provider'),
  providerDesc: t('settings.aiLocal.providerDesc'),
  keyless: t('settings.aiLocal.providerKeyless'),
  baseUrl: t('settings.aiLocal.baseUrl'),
  baseUrlDesc: t('settings.aiLocal.baseUrlDesc'),
  models: t('settings.aiLocal.models'),
  modelsDesc: t('settings.aiLocal.modelsDesc'),
  keySlot: t('settings.aiLocal.keySlot'),
  keySlotDesc: t('settings.aiLocal.keySlotDesc'),
  keyValue: t('settings.aiLocal.keyValue'),
  keyValueSaved: t('settings.aiLocal.keyValueSaved'),
  keyValueHint: t('settings.aiLocal.keyValueHint'),
  test: t('settings.aiLocal.test'),
  remove: t('settings.aiLocal.remove'),
  add: t('settings.aiLocal.add'),
  save: t('settings.aiLocal.save'),
  unsavedHint: t('settings.aiLocal.unsavedHint'),
  empty: t('settings.aiLocal.empty')
}))

const persistedCount = computed(() =>
  rows.value.filter(row => models.value[row.connectionId.trim()] !== undefined).length
)

function emptyRow(): AIConnectionRow {
  return {
    connectionId: '',
    providerKey: 'custom',
    baseUrl: '',
    models: '',
    apiKeyEnv: '',
    apiKey: '',
    hasKey: false
  }
}

function toRow(entry: SafeAIConnection): AIConnectionRow {
  return {
    connectionId: entry.connectionId,
    providerKey: entry.providerKey,
    baseUrl: entry.baseUrl,
    models: entry.models.map(model => model.modelId).join(', '),
    apiKeyEnv: entry.apiKeyEnv || '',
    apiKey: '',
    hasKey: entry.hasKey
  }
}

function splitModels(value: string): string[] {
  return value.split(',').map(model => model.trim()).filter(Boolean)
}

function joinModels(entries: SafeAIModel[]): string {
  return entries.map(model => model.modelId).join(', ')
}

async function loadConnections() {
  try {
    const res = await $fetch<{ success: boolean, data: { connections: SafeAIConnection[] } }>(
      '/api/v1/ai/connections'
    )
    const connections = res?.data?.connections || []
    rows.value = connections.map(toRow)
    models.value = Object.fromEntries(connections.map(entry => [entry.connectionId, entry.models]))
    loadError.value = ''
  } catch (err) {
    loadError.value = getErrorMessage(err, key => t(key)) || t('settings.aiLocal.loadFailed')
  } finally {
    loading.value = false
  }
}

onMounted(loadConnections)

function addRow() {
  rows.value.push(emptyRow())
}

/**
 * The editor only knows a comma list, so the stored model objects are kept
 * aside and re-attached by id: `enabled`, `displayName` and `isPrimary`
 * survive a save, and a deleted primary promotes the new first model.
 */
function modelsForSave(row: AIConnectionRow): SafeAIModel[] {
  const previous = new Map((models.value[row.connectionId.trim()] || []).map(model => [model.modelId, model]))
  const payload = splitModels(row.models).map(id => previous.get(id) ?? { modelId: id, enabled: true })
  if (payload.length && !payload.some(model => model.isPrimary)) payload[0] = { ...payload[0]!, isPrimary: true }
  return payload
}

async function saveAll() {
  const incomplete = rows.value.find(row =>
    !row.connectionId.trim()
    && (row.baseUrl.trim() || row.models.trim() || row.apiKey.trim() || row.apiKeyEnv.trim())
  )
  if (incomplete) {
    notify.error(t('settings.aiLocal.invalid'), t('settings.aiLocal.connectionIdRequired'))
    return
  }

  const target = rows.value.filter(row => row.connectionId.trim())
  saving.value = true
  try {
    for (const row of target) {
      const res = await $fetch<{ success: boolean, data: SafeAIConnection }>('/api/v1/ai/connections', {
        method: 'PUT',
        body: {
          connectionId: row.connectionId.trim(),
          providerKey: row.providerKey,
          baseUrl: row.baseUrl.trim(),
          apiKey: row.apiKey.trim() || undefined,
          apiKeyEnv: row.apiKeyEnv.trim(),
          models: modelsForSave(row)
        }
      })
      const saved = res.data
      models.value[saved.connectionId] = saved.models
      row.connectionId = saved.connectionId
      row.baseUrl = saved.baseUrl
      row.apiKeyEnv = saved.apiKeyEnv || ''
      row.hasKey = saved.hasKey
      row.models = joinModels(saved.models)
      row.apiKey = ''
      tests.value = Object.fromEntries(
        Object.entries(tests.value).filter(([id]) => id !== saved.connectionId)
      )
    }
    notify.success(t('settings.aiLocal.saved'), '')
  } catch (err) {
    notify.error(t('settings.aiLocal.saveFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    saving.value = false
  }
}

function requestRemove(row: AIConnectionRow) {
  const connectionId = row.connectionId.trim()
  if (!connectionId || models.value[connectionId] === undefined) {
    rows.value = rows.value.filter(entry => entry !== row)
    return
  }
  removingRow.value = row
  removeOpen.value = true
}

async function confirmRemove() {
  const row = removingRow.value
  if (!row) return
  const connectionId = row.connectionId.trim()
  removing.value = true
  try {
    await $fetch(`/api/v1/ai/connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' })
    rows.value = rows.value.filter(entry => entry !== row)
    models.value = Object.fromEntries(
      Object.entries(models.value).filter(([id]) => id !== connectionId)
    )
    tests.value = Object.fromEntries(
      Object.entries(tests.value).filter(([id]) => id !== connectionId)
    )
    removeOpen.value = false
    removingRow.value = null
  } catch (err) {
    notify.error(t('settings.aiLocal.removeFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    removing.value = false
  }
}

async function reloadModels(ids: string[]) {
  const res = await $fetch<{ success: boolean, data: { connections: SafeAIConnection[] } }>(
    '/api/v1/ai/connections'
  )
  for (const entry of res?.data?.connections || []) {
    if (!ids.includes(entry.connectionId)) continue
    models.value[entry.connectionId] = entry.models
    const row = rows.value.find(item => item.connectionId.trim() === entry.connectionId)
    if (row) row.models = joinModels(entry.models)
  }
}

async function refreshModels() {
  const ids = rows.value
    .map(row => row.connectionId.trim())
    .filter(id => id && models.value[id] !== undefined)
  if (!ids.length) return

  refreshing.value = true
  const failed: string[] = []
  let total = 0
  try {
    for (const id of ids) {
      try {
        const res = await $fetch<{ success: boolean, data: { total: number } }>(
          `/api/v1/ai/connections/${encodeURIComponent(id)}/models/refresh`,
          { method: 'POST' }
        )
        total += res.data.total
      } catch {
        failed.push(id)
      }
    }
    const refreshed = ids.filter(id => !failed.includes(id))
    if (refreshed.length) await reloadModels(refreshed)
    if (failed.length) notify.error(t('settings.aiLocal.refreshFailed'), failed.join(', '))
    else notify.success(t('settings.aiLocal.modelsRefreshed', { count: total }), '')
  } catch (err) {
    notify.error(t('settings.aiLocal.refreshFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    refreshing.value = false
  }
}

async function testRow(row: AIConnectionRow) {
  const connectionId = row.connectionId.trim()
  if (!connectionId) return
  testingId.value = connectionId
  try {
    const res = await $fetch<{ success: boolean, data: TestResult }>(
      `/api/v1/ai/connections/${encodeURIComponent(connectionId)}/test`,
      { method: 'POST' }
    )
    tests.value[connectionId] = { ok: res.data.ok, message: res.data.message }
  } catch (err) {
    tests.value[connectionId] = { ok: false, message: getErrorMessage(err, key => t(key)) }
  } finally {
    testingId.value = ''
  }
}
</script>

<template>
  <div class="space-y-4">
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-x"
      :title="t('settings.aiLocal.loadFailed')"
      :description="loadError"
    />

    <UCard>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <span class="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary/10 p-2.5 text-primary">
            <UIcon name="i-lucide-hard-drive" class="size-5" />
          </span>
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-highlighted">
              {{ t('settings.aiLocal.title') }}
            </h2>
            <p class="text-xs text-muted">
              {{ t('settings.aiLocal.description') }}
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <UBadge color="neutral" variant="subtle" size="sm">
            {{ t('settings.aiLocal.localBadge') }}
          </UBadge>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-rotate-cw"
            :label="t('settings.aiLocal.refreshModels')"
            :loading="refreshing"
            :disabled="!persistedCount"
            @click="refreshModels"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            icon="i-lucide-refresh-cw"
            square
            :loading="loading"
            :aria-label="t('common.refresh')"
            @click="loadConnections"
          />
        </div>
      </div>

      <USkeleton v-if="loading && !rows.length" class="mt-4 h-24 w-full" />

      <div v-else class="mt-4">
        <AIConnectionsEditor
          :rows="rows"
          :providers="providers"
          :labels="labels"
          :saving="saving"
          :testing-id="testingId"
          :tests="tests"
          :provider-icon="providerIconFor"
          @add="addRow"
          @remove="requestRemove"
          @test="testRow"
          @save="saveAll"
        />
      </div>
    </UCard>

    <LazyBaseConfirmModal
      v-model:open="removeOpen"
      :title="t('settings.aiLocal.removeTitle')"
      :description="t('settings.aiLocal.removeDesc', { name: removingRow?.connectionId || '' })"
      :confirm-label="t('common.delete')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-alert-triangle"
      :loading="removing"
      @confirm="confirmRemove"
    />
  </div>
</template>
