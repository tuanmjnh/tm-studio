<script setup lang="ts">
import { useHub } from '~/composables/useHub'
import { useHubAi, type HubAiProviderItem } from '~/composables/useHubAi'
import { getErrorMessage } from '~/shared/utils/errors'
import {
  AI_TRANSFER_FORMATS,
  parseAiTransfer,
  serializeAiTransfer,
  type AiTransferFormat,
  type AiTransferRow
} from '~/utils/aiProviderTransfer'

/**
 * Import/Export modal for TM Hub AI credentials (TM Studio).
 *
 * The hub is the store of record: import writes through the same
 * `/ai/connections/manual` endpoint the credential form uses, and export reads
 * the hub export endpoint (root callers may include API keys; that request is
 * audited on the hub).
 */
const props = defineProps<{
  appId: string
  mode: 'import' | 'export'
  providers: HubAiProviderItem[]
  canExportSecrets: boolean
}>()

const emit = defineEmits<{ (e: 'completed'): void }>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const notify = useNotify()
const { hubFetch } = useHub()
const { saveCredential: hubSaveCredential, patchConnection: hubPatchConnection } = useHubAi()

const fileInput = ref<HTMLInputElement | null>(null)
const fileName = ref('')
const importData = ref('')
const format = ref<AiTransferFormat>('json')
const defaultModel = ref('')
const overwrite = ref(false)
const includeSecrets = ref(false)
const previewing = ref(false)
const committing = ref(false)
const exporting = ref(false)

interface PreviewRow extends AiTransferRow {
  duplicate: boolean
}

const preview = ref<{ rows: PreviewRow[], errors: Array<{ source: string, message: string }> } | null>(null)

const knownProviders = computed(() => props.providers.map(p => p.definition.key))

const existingKeys = computed(() => new Set(
  props.providers.flatMap(p => p.connections.map(c => `${c.provider}:${c.name || 'default'}`))
))

const importableCount = computed(() => {
  const rows = preview.value?.rows || []
  return overwrite.value ? rows.length : rows.filter(r => !r.duplicate).length
})

const canCommit = computed(() => !!preview.value && importableCount.value > 0 && !previewing.value)

watch(open, (value) => {
  if (!value) return
  includeSecrets.value = false
  exporting.value = false
  previewing.value = false
  committing.value = false
  if (props.mode === 'import') {
    fileName.value = ''
    importData.value = ''
    defaultModel.value = ''
    overwrite.value = false
    preview.value = null
    format.value = 'json'
  }
})

function applyFormatForName(name: string) {
  const lower = (name || '').toLowerCase()
  if (lower.endsWith('.json')) format.value = 'json'
  else if (lower.endsWith('.csv')) format.value = 'csv'
  else if (lower.endsWith('.env') || lower.endsWith('.txt')) format.value = 'env'
}

watch(fileName, name => applyFormatForName(name))

async function readFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  applyFormatForName(file.name)
  importData.value = await file.text()
  preview.value = null
  input.value = ''
  // Preview immediately: the operator picked a file to import, so rows,
  // duplicates and errors must be visible without an extra click. Without
  // this, "Import now" stays disabled with no explanation.
  runPreview()
}

function runPreview() {
  if (!importData.value.trim()) return
  previewing.value = true
  try {
    const parsed = parseAiTransfer(importData.value, {
      format: format.value,
      fileName: fileName.value,
      defaultModel: defaultModel.value,
      knownProviders: knownProviders.value
    })
    preview.value = {
      rows: parsed.rows.map(row => ({ ...row, duplicate: existingKeys.value.has(`${row.provider}:${row.name}`) })),
      errors: parsed.errors
    }
  } catch (err) {
    notify.error(t('aiProviders.import_title'), getErrorMessage(err, key => t(key)))
  } finally {
    previewing.value = false
  }
}

async function commitImport() {
  const rows = preview.value?.rows || []
  const targets = overwrite.value ? rows : rows.filter(r => !r.duplicate)
  if (!targets.length) return
  committing.value = true
  let imported = 0
  let failed = 0
  const failures: string[] = []
  try {
    for (const row of targets) {
      try {
        const values: Record<string, string> = { AI_MODEL: row.model }
        if (row.apiKey) values.AI_API_KEY = row.apiKey
        if (row.baseUrl) values.AI_BASE_URL = row.baseUrl
        const saved = await hubSaveCredential(props.appId, {
          provider: row.provider,
          name: row.name,
          values,
          baseUrlOverride: row.baseUrl || undefined,
          isShared: false,
          preserveSecrets: false
        })
        // A disabled row in the file must not come back enabled.
        const connectionId = saved.connection?.id
        if (!row.enabled && connectionId) {
          await hubPatchConnection(props.appId, connectionId, { isEnabled: false })
        }
        imported += 1
      } catch (err) {
        failed += 1
        failures.push(`${row.provider}:${row.name} — ${getErrorMessage(err, key => t(key))}`)
      }
    }
    const skipped = rows.length - targets.length
    if (imported) {
      notify.success(t('aiProviders.import_done'), t('aiProviders.import_result', { imported, skipped, failed }))
    }
    if (failed) {
      notify.error(t('aiProviders.import_title'), failures.slice(0, 3).join(' · '))
    }
    if (imported) {
      open.value = false
      emit('completed')
    }
  } finally {
    committing.value = false
  }
}

function download(content: string, name: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

async function exportNow() {
  if (includeSecrets.value && !window.confirm(t('aiProviders.export_secrets_confirm'))) return
  exporting.value = true
  try {
    const res = await hubFetch<{ data: { connections: AiTransferRow[] } }>(
      `/api/v1/apps/${encodeURIComponent(props.appId)}/ai/providers/export?includeSecrets=${includeSecrets.value ? 1 : 0}`
    )
    const rows = (res.data?.connections || []).map(row => ({
      provider: row.provider,
      name: row.name || 'default',
      model: row.model || '',
      baseUrl: row.baseUrl || '',
      apiKey: row.apiKey || '',
      enabled: row.enabled !== false
    }))
    if (!rows.length) {
      notify.warning(t('aiProviders.export_title'), t('aiProviders.no_connected_providers'))
      return
    }
    const out = serializeAiTransfer(rows, format.value, {
      appName: 'tm-studio',
      appId: props.appId,
      includeSecrets: includeSecrets.value
    })
    download(out.content, out.fileName, out.mime)
    notify.success(t('aiProviders.export_done'), t('aiProviders.exported', { count: rows.length }))
    open.value = false
    emit('completed')
  } catch (err) {
    notify.error(t('aiProviders.export_title'), getErrorMessage(err, key => t(key)))
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="mode === 'import' ? t('aiProviders.import_title') : t('aiProviders.export_title')"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-xs text-muted">
          {{ mode === 'import' ? t('aiProviders.import_help') : t('aiProviders.export_help') }}
        </p>

        <UFormField :label="t('aiProviders.format')">
          <div class="flex flex-wrap items-center gap-1">
            <UButton
              v-for="item in AI_TRANSFER_FORMATS"
              :key="item"
              size="xs"
              :label="t(`aiProviders.format_${item}`)"
              :color="format === item ? 'primary' : 'neutral'"
              :variant="format === item ? 'soft' : 'ghost'"
              :icon="format === item ? 'i-lucide-check' : undefined"
              @click="format = item"
            />
          </div>
        </UFormField>

        <template v-if="mode === 'import'">
          <input
            ref="fileInput"
            type="file"
            accept=".json,.env,.csv,.txt,application/json,text/csv,text/plain"
            class="hidden"
            @change="readFile"
          >
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              icon="i-lucide-file-up"
              color="neutral"
              variant="soft"
              size="sm"
              :label="t('aiProviders.choose_file')"
              @click="fileInput?.click()"
            />
            <span class="text-xs text-muted">{{ fileName || t('aiProviders.no_file') }}</span>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField :label="t('aiProviders.field_default_model')" :help="t('aiProviders.default_model_help')">
              <UInput
                v-model="defaultModel"
                class="w-full"
                placeholder="gpt-4o-mini"
                autocomplete="off"
              />
            </UFormField>
            <UFormField :label="t('aiProviders.overwrite')" :help="t('aiProviders.overwrite_help')">
              <div class="flex h-8 items-center">
                <USwitch v-model="overwrite" />
              </div>
            </UFormField>
          </div>

          <div v-if="preview" class="space-y-2 rounded border border-default p-3">
            <p class="text-sm text-highlighted">
              {{ t('aiProviders.preview_summary', { valid: preview.rows.length, invalid: preview.errors.length }) }}
            </p>
            <p v-if="preview.rows.some(r => r.duplicate)" class="text-xs text-warning">
              {{ t('aiProviders.preview_duplicates', { count: preview.rows.filter(r => r.duplicate).length }) }}
            </p>
            <p v-if="preview.rows.length && importableCount === 0" class="text-xs font-medium text-error">
              {{ t('aiProviders.import_blocked') }}
            </p>
            <div v-if="preview.rows.length" class="max-h-56 space-y-1 overflow-auto">
              <div
                v-for="row in preview.rows"
                :key="`${row.provider}:${row.name}`"
                class="flex flex-wrap items-center gap-2 text-xs"
              >
                <span class="font-mono text-muted">{{ row.provider }}</span>
                <span class="font-medium text-highlighted">{{ row.name }}</span>
                <span class="text-muted">{{ row.model }}</span>
                <UBadge
                  v-if="row.baseUrl"
                  size="sm"
                  variant="subtle"
                  color="neutral"
                  class="font-mono"
                >
                  {{ row.baseUrl }}
                </UBadge>
                <UBadge
                  v-if="row.apiKey"
                  size="sm"
                  variant="subtle"
                  color="success"
                >
                  {{ t('aiProviders.has_key') }}
                </UBadge>
                <UBadge
                  v-if="row.duplicate"
                  size="sm"
                  variant="subtle"
                  color="warning"
                >
                  {{ t('aiProviders.duplicate_row') }}
                </UBadge>
                <UBadge
                  v-if="!row.enabled"
                  size="sm"
                  variant="subtle"
                  color="neutral"
                >
                  {{ t('aiProviders.disabled') }}
                </UBadge>
              </div>
            </div>
            <div v-if="preview.errors.length" class="max-h-40 space-y-1 overflow-auto">
              <p v-for="(err, index) in preview.errors" :key="index" class="text-xs text-error">
                {{ err.source }} — {{ err.message }}
              </p>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="flex items-start gap-3">
            <USwitch v-model="includeSecrets" :aria-label="t('aiProviders.include_secrets')" :disabled="!canExportSecrets" />
            <div>
              <p class="text-sm font-medium text-highlighted">
                {{ t('aiProviders.include_secrets') }}
              </p>
              <p class="text-xs text-muted">
                {{ canExportSecrets ? t('aiProviders.include_secrets_help') : t('aiProviders.include_secrets_root_only')
                }}
              </p>
            </div>
          </div>
          <UAlert
            v-if="includeSecrets"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :description="t('aiProviders.export_secrets_confirm')"
          />
        </template>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <template v-if="mode === 'import'">
          <UButton
            color="neutral"
            variant="soft"
            :label="t('aiProviders.preview')"
            :loading="previewing"
            :disabled="!importData"
            @click="runPreview"
          />
          <UButton
            :label="t('aiProviders.import_now')"
            variant="soft"
            :loading="committing"
            :disabled="!canCommit"
            @click="commitImport"
          />
        </template>
        <template v-else>
          <UButton
            icon="i-lucide-download"
            :label="t('aiProviders.export_download')"
            :loading="exporting"
            variant="soft"
            @click="exportNow"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
