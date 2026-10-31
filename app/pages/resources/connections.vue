<script setup lang="ts">
import type { HubConnectionProvider, HubConnectionTestResult } from 'tm-hub-client'
import { getErrorMessage } from '~/shared/utils/errors'

type ConnectionProvider = HubConnectionProvider & { quick?: boolean, ai?: boolean, category?: string, connections?: HubConnectionProvider['connection'][] }

definePageMeta({
  middleware: () => {
    if (import.meta.client) {
      const a = useAuth()
      if (!a.isAuthenticated.value) return navigateTo('/login')
    }
  },
  alias: ['/system/connections', '/settings/connections']
})

const { t } = useI18n()
const toast = useToast()
const { appId, connections, hubUrl } = useHub()

const loading = ref(false)
const providers = ref<ConnectionProvider[]>([])
const testingKey = ref('')
const quickingKey = ref('')

const isManualOpen = ref(false)
const manualSaving = ref(false)
const manualProvider = ref<ConnectionProvider | null>(null)
const manualValues = ref<Record<string, string>>({})

const isDisconnectOpen = ref(false)
const disconnectProvider = ref<ConnectionProvider | null>(null)

// Add Connection Wizard
const isAddOpen = ref(false)
const addStep = ref<'category' | 'provider' | 'form'>('category')
const addCategory = ref<string>('')
const addProvider = ref<ConnectionProvider | null>(null)
const addSaving = ref(false)
const addValues = ref<Record<string, string>>({})
const addSearchQuery = ref('')
const wizardTitle = computed(() => {
  if (addStep.value === 'category') return t('connections.add')
  if (addStep.value === 'provider') return categoryLabel(addCategory.value) || t('connections.add')
  return addProvider.value ? `${t('connections.configure')} - ${addProvider.value.name}` : t('connections.add')
})

const isConnected = (p: ConnectionProvider) => !!p.connection && p.connection.status === 'connected'
const hasRow = (p: ConnectionProvider) => !!p.connection
const statusLabel = (p: ConnectionProvider) => {
  if (!p.connection) return t('connections.not_connected')
  return p.connection.status === 'connected' ? t('connections.connected') : t('common.error')
}
function cleanVal(v: unknown): string {
  let s = String(v ?? '').trim()
  while ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith('\'') && s.endsWith('\''))) {
    if (s.length < 2) break
    s = s.slice(1, -1).trim()
  }
  return s
}

const accountOf = (p: ConnectionProvider) => {
  const cfg = p.connection?.config || {}
  return cleanVal(cfg.email || cfg.CLOUDINARY_CLOUD_NAME || p.connection?.label || '')
}

function showTestFail(res: HubConnectionTestResult | undefined) {
  toast.add({
    title: res?.message ? `${t('connections.test_fail')}: ${res.message}` : t('connections.test_fail'),
    color: 'error'
  })
}

async function refresh() {
  loading.value = true
  try {
    // Hub merges BOTH domains in one canonical inventory (R147):
    // code-registry providers (cloudinary, google) + DB-backed AI
    // providers flagged `ai: true` with all credentials in `connections`.
    const res = await connections.list(appId)
    providers.value = ((res.data || []) as ConnectionProvider[]).filter(p => !p.ai && p.category !== "exchange" && p.category !== "market_data")
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    loading.value = false
  }
}

async function connectOAuth(p: ConnectionProvider) {
  let popup: Window | null = null

  try {
    const res = await connections.oauthStart(p.key, appId)
    const authUrl = res.data?.authUrl
    if (!authUrl) {
      toast.add({ title: t('connections.test_fail') + ': No auth URL returned', color: 'error' })
      return
    }

    popup = window.open(authUrl, 'tmhub-oauth', 'width=540,height=680')
    if (!popup) {
      toast.add({ title: t('connections.popup_blocked'), color: 'error' })
      return
    }
    toast.add({
      title: t('connections.connect') + ': ' + p.name,
      color: 'info'
    })
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
    return
  }

  let isFinished = false
  let pollAttempts = 0
  const maxAttempts = 120

  const cleanup = () => {
    isFinished = true
    clearInterval(pollTimer)
  }

  const pollTimer = setInterval(async () => {
    if (isFinished) return
    pollAttempts++

    try {
      const res = await connections.list(appId)
      const current = res.data?.find(item => item.key === p.key)
      if (current?.connection?.status === 'connected') {
        cleanup()
        providers.value = res.data || []
        toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
        return
      }
    } catch {
      // transient poll failure, retry next tick
    }

    if (pollAttempts >= maxAttempts) {
      cleanup()
      refresh()
    }
  }, 1500)
}

function onOAuthMessage(event: MessageEvent) {
  const allowedOrigins = [window.location.origin]
  try {
    if (hubUrl) allowedOrigins.push(new URL(hubUrl).origin)
  } catch { /* ignore */ }
  if (!allowedOrigins.includes(event.origin)) return

  const data = event.data as { type?: string, status?: string, reason?: string } | null
  if (!data || data.type !== 'tm-hub-oauth') return
  if (data.status === 'connected') {
    toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
    refresh()
  } else {
    toast.add({ title: data.reason || t('connections.test_fail'), color: 'error' })
    refresh()
  }
}

let bc: BroadcastChannel | null = null
onMounted(() => {
  window.addEventListener('message', onOAuthMessage)
  try {
    bc = new BroadcastChannel('tm-hub-oauth')
    bc.onmessage = (event) => {
      if (event.data?.type === 'tm-hub-oauth' && event.data?.status === 'connected') {
        toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
        refresh()
      }
    }
  } catch { /* ignore */ }
  refresh()
})
onUnmounted(() => {
  window.removeEventListener('message', onOAuthMessage)
  try {
    bc?.close()
  } catch { /* ignore */ }
})

function openManual(p: ConnectionProvider) {
  manualProvider.value = p
  const values: Record<string, string> = {}
  for (const field of p.fields || []) {
    if (field.type !== 'password') values[field.key] = cleanVal(p.connection?.config?.[field.key] || '')
    else values[field.key] = ''
  }
  manualValues.value = values
  isManualOpen.value = true
}

async function saveManual() {
  const p = manualProvider.value
  if (!p) return
  manualSaving.value = true
  try {
    const cleanedValues: Record<string, string> = {}
    for (const [k, v] of Object.entries(manualValues.value)) {
      cleanedValues[k] = cleanVal(v)
    }
    const res = await connections.saveManual(p.key, cleanedValues, appId)
    if (res.data?.test?.ok) toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
    else showTestFail(res.data?.test)
    isManualOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    manualSaving.value = false
  }
}

async function quickConnect(p: ConnectionProvider) {
  quickingKey.value = p.key
  try {
    const res = await connections.quick(p.key, appId)
    if (res.data?.test?.ok) toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
    else showTestFail(res.data?.test)
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    quickingKey.value = ''
  }
}

async function testConnection(p: ConnectionProvider) {
  testingKey.value = p.key
  try {
    const res = await connections.test(p.key, appId)
    if (res.data?.ok) toast.add({ title: t('connections.test_ok'), icon: 'i-lucide-check', color: 'success' })
    else showTestFail(res.data)
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    testingKey.value = ''
  }
}

function askDisconnect(p: ConnectionProvider) {
  disconnectProvider.value = p
  isDisconnectOpen.value = true
}

async function doDisconnect() {
  const p = disconnectProvider.value
  if (!p) return
  try {
    await connections.disconnect(p.key, appId)
    toast.add({ title: t('connections.disconnected'), icon: 'i-lucide-check', color: 'success' })
    isDisconnectOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  }
}

// ============ ADD CONNECTION WIZARD ============
// Category list mirrors roadmap §2 (provider-connections-upgrade-roadmap).
// Labels/descriptions live in i18n (`connections.wizard.<key>_label/_desc`);
// categories with no registered provider yet show an honest empty state —
// Phase 4 registers non-AI categories incrementally.
const CATEGORIES = [
  { key: 'media_storage', icon: 'i-lucide-hard-drive' },
  { key: 'media_generation', icon: 'i-lucide-sparkles' },
  { key: 'notifications', icon: 'i-lucide-bell' },
  { key: 'mcp', icon: 'i-lucide-plug-zap' },
  { key: 'custom', icon: 'i-lucide-plus-circle' }
] as const

function categoryLabel(key: string): string {
  return key ? t(`connections.wizard.${key}_label`) : ''
}

function openAddWizard() {
  addStep.value = 'category'
  addCategory.value = ''
  addProvider.value = null
  addValues.value = {}
  addSearchQuery.value = ''
  isAddOpen.value = true
}

function selectCategory(cat: typeof CATEGORIES[number]) {
  addCategory.value = cat.key
  addStep.value = 'provider'
}

/** Providers offered for the chosen category (roadmap §2: wizard starts
 *  with a category, then a provider-specific form). Legacy code-registry
 *  providers carry no category — they show under custom. */
const categoryProviders = computed(() => {
  const list = addCategory.value === 'custom'
    ? providers.value.filter(p => !p.category)
    : providers.value.filter(p => p.category === addCategory.value)
  if (!addSearchQuery.value.trim()) return list
  const q = addSearchQuery.value.trim().toLowerCase()
  return list.filter(p => p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q))
})

function providerFields(p: ConnectionProvider) {
  return p.fields || []
}

function selectProvider(p: ConnectionProvider) {
  addProvider.value = p
  addValues.value = {}
  for (const field of providerFields(p)) {
    if (field.type !== 'password') addValues.value[field.key] = ''
    else addValues.value[field.key] = ''
  }
  addStep.value = 'form'
}

function backToCategory() {
  addStep.value = 'category'
}
function backToProvider() {
  addStep.value = 'provider'
}


async function saveAddConnection() {
  const p = addProvider.value
  if (!p) return
  addSaving.value = true
  try {
    const cleanedValues: Record<string, string> = {}
    for (const [k, v] of Object.entries(addValues.value)) {
      const trimmed = cleanVal(v)
      // Keep saved secrets rotatable: an untouched password field means
      // "leave as-is" when a record already exists.
      if (v === '' && fieldIsSecret(p, k) && hasRow(p)) continue
      cleanedValues[k] = trimmed
    }
    // Same canonical record for both screens (roadmap §2: no duplicate
    // writes): AI credentials go through the AI endpoint which persists
    // name/environment/isShared alongside the AES-GCM secret.
    const saved = await connections.saveManual(p.key, cleanedValues, appId)
    const test = saved.data?.test
    if (test?.ok) toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
    else if (test) showTestFail(test)
    else toast.add({ title: t('connections.saved'), icon: 'i-lucide-check', color: 'success' })
    isAddOpen.value = false
    refresh()
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, key => t(key)), color: 'error' })
  } finally {
    addSaving.value = false
  }
}

function fieldIsSecret(p: ConnectionProvider, key: string): boolean {
  return providerFields(p).some(f => f.key === key && f.type === 'password')
}

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  { icon: 'i-lucide-refresh-cw', label: t('common.refresh'), onSelect: () => refresh() },
  { icon: 'i-lucide-plus', label: t('connections.add'), onSelect: () => openAddWizard() }
]))

useHead({ title: t('connections.title') })
</script>

<template>
  <BasePage id="system-connections" :title="t('connections.title')" :description="t('connections.description')">
    <template #right>
      <div class="flex items-center gap-2">
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          @click="openAddWizard"
        >
          {{ t('connections.add') }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          variant="soft"
          size="sm"
          :loading="loading"
          @click="refresh"
        />
      </div>
    </template>

    <div class="flex flex-col gap-4 pb-6">
      <div v-if="loading && !providers.length" class="flex items-center justify-center py-20">
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-muted" />
      </div>

      <div v-else-if="!providers.length" class="flex flex-col items-center justify-center gap-2 py-16 text-center">
        <UIcon name="i-lucide-plug" class="size-10 text-muted" />
        <p class="text-sm text-muted">
          {{ t('connections.empty') }}
        </p>
        <UButton
          icon="i-lucide-plus"
          variant="soft"
          size="sm"
          @click="openAddWizard"
        >
          {{ t('connections.add_first') }}
        </UButton>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <div
          v-for="p in providers"
          :key="p.key"
          class="rounded-xl border border-primary/30 p-4 flex flex-col gap-3 shadow-xs"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-3 min-w-0">
              <div class="flex items-center justify-center size-10 rounded-lg bg-elevated/50 shrink-0">
                <UIcon :name="p.icon" class="size-6" />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-semibold text-highlighted truncate">{{ p.name }}</span>
                  <UBadge :label="p.mode === 'oauth' ? t('connections.mode_oauth') : t('connections.mode_manual')" variant="subtle" size="xs" />
                </div>
                <p class="text-xs text-muted truncate">
                  {{ p.description }}
                </p>
              </div>
            </div>
            <UBadge
              :label="statusLabel(p)"
              :color="p.connection ? (isConnected(p) ? 'success' : 'error') : 'neutral'"
              variant="subtle"
              size="sm"
              class="shrink-0"
            />
          </div>

          <div v-if="hasRow(p)" class="text-xs text-muted space-y-1">
            <p v-if="accountOf(p)">
              <span class="text-toned">{{ t('connections.account') }}: </span>
              <span class="text-highlighted">{{ accountOf(p) }}</span>
            </p>
                        <p>
              <span class="text-toned">{{ t('connections.last_test') }}: </span>
              <span :class="p.connection?.lastTestOk === false ? 'text-error' : 'text-highlighted'">
                {{ p.connection?.lastTestAt ? new Date(p.connection.lastTestAt).toLocaleString() : t('connections.never') }}
                <template v-if="p.connection?.lastTestOk === false"> ({{ t('connections.test_fail') }})</template>
              </span>
            </p>
          </div>

          <p v-if="p.mode === 'oauth' && p.scopes?.length" class="text-xs text-muted flex items-center gap-1 flex-wrap">
            <span class="text-toned">{{ t('connections.scopes') }}:</span>
            <UPopover :content="{ align: 'start', side: 'bottom', sideOffset: 8 }">
              <UButton
                color="neutral"
                variant="subtle"
                size="xs"
                icon="i-lucide-shield-check"
                :label="String(p.scopes.length)"
              />
              <template #content>
                <div class="p-3 max-w-80 space-y-2">
                  <p class="text-xs font-semibold text-highlighted">
                    {{ t('connections.scopes') }}
                  </p>
                  <ul class="space-y-1.5">
                    <li v-for="s in p.scopes" :key="s" class="flex items-start gap-1.5 text-xs text-muted">
                      <UIcon name="i-lucide-check" class="size-3.5 mt-0.5 text-success shrink-0" />
                      <span class="font-mono break-all">{{ s }}</span>
                    </li>
                  </ul>
                </div>
              </template>
            </UPopover>
          </p>

          <div class="flex items-center gap-2 mt-auto pt-1 flex-wrap">
            <UButton
              v-if="p.mode === 'oauth' && !isConnected(p)"
              :label="t('connections.connect')"
              icon="i-lucide-external-link"
              color="primary"
              variant="soft"
              size="sm"
              @click="connectOAuth(p)"
            />
            <UButton
              v-if="p.mode === 'oauth' && isConnected(p)"
              :label="t('connections.reconnect')"
              icon="i-lucide-refresh-cw"
              color="warning"
              variant="soft"
              size="sm"
              @click="connectOAuth(p)"
            />
            <UButton
              v-if="p.quick && !isConnected(p)"
              :label="t('connections.quick_connect')"
              icon="i-lucide-zap"
              color="primary"
              variant="soft"
              size="sm"
              :loading="quickingKey === p.key"
              @click="quickConnect(p)"
            />
            <UButton
              v-if="p.mode === 'manual'"
              :label="hasRow(p) ? t('connections.configure') : t('connections.connect')"
              icon="i-lucide-key-round"
              color="primary"
              variant="soft"
              size="sm"
              @click="openManual(p)"
            />
                        <UButton
              v-if="hasRow(p)"
              :label="t('connections.test')"
              icon="i-lucide-activity"
              :loading="testingKey === p.key"
              color="success"
              variant="soft"
              size="sm"
              @click="testConnection(p)"
            />
            <UButton
              v-if="hasRow(p)"
              :label="t('connections.disconnect')"
              icon="i-lucide-unplug"
              color="error"
              variant="soft"
              size="sm"
              @click="askDisconnect(p)"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Manual Configure Modal (legacy single-credential) -->
    <BaseFormModal
      v-model:open="isManualOpen"
      :title="`${t('connections.configure')} - ${manualProvider?.name || ''}`"
      :state="manualValues"
      :loading="manualSaving"
      :submit-label="t('global.save')"
      @submit="saveManual"
    >
      <UFormField
        v-for="field in manualProvider?.fields"
        :key="field.key"
        :label="field.label"
        :required="field.required"
        class="mb-3"
      >
        <UInput
          v-model="manualValues[field.key]"
          :type="field.type === 'password' ? 'password' : 'text'"
          class="w-full"
          :placeholder="field.type === 'password' ? '••••••••' : field.label"
          autocomplete="off"
        />
      </UFormField>
    </BaseFormModal>

    <!-- Add Connection Wizard Modal -->
    <BaseResponsiveModal
      v-model:open="isAddOpen"
      :title="wizardTitle"
      :close="!addSaving"
      :dismissible="!addSaving"
    >
      <template #body>
        <!-- Step Indicator -->
        <div class="flex items-center justify-between pb-4 border-b border-default/40">
          <div class="flex items-center gap-2">
            <span
              class="flex items-center justify-center size-6 rounded-full text-xs font-semibold transition-colors"
              :class="addStep === 'category'
                ? 'bg-primary text-white'
                : 'bg-primary/20 text-primary cursor-pointer'"
              @click="!addSaving && (addStep = 'category')"
            >
              1
            </span>
            <span class="text-xs font-medium" :class="addStep === 'category' ? 'text-highlighted font-semibold' : 'text-muted'">
              {{ t('connections.wizard.category_step', 'Category') }}
            </span>
            <UIcon name="i-lucide-chevron-right" class="size-3.5 text-muted/60" />

            <span
              class="flex items-center justify-center size-6 rounded-full text-xs font-semibold transition-colors"
              :class="addStep === 'provider'
                ? 'bg-primary text-white'
                : (addStep === 'form' ? 'bg-primary/20 text-primary cursor-pointer' : 'bg-elevated text-muted')"
              @click="!addSaving && addCategory && (addStep = 'provider')"
            >
              2
            </span>
            <span class="text-xs font-medium" :class="addStep === 'provider' ? 'text-highlighted font-semibold' : 'text-muted'">
              {{ t('connections.wizard.provider_step', 'Provider') }}
            </span>
            <UIcon name="i-lucide-chevron-right" class="size-3.5 text-muted/60" />

            <span
              class="flex items-center justify-center size-6 rounded-full text-xs font-semibold"
              :class="addStep === 'form' ? 'bg-primary text-white' : 'bg-elevated text-muted'"
            >
              3
            </span>
            <span class="text-xs font-medium" :class="addStep === 'form' ? 'text-highlighted font-semibold' : 'text-muted'">
              {{ t('connections.wizard.configure_step', 'Configure') }}
            </span>
          </div>

          <UBadge
            v-if="addStep === 'form' && addProvider"
            :label="addProvider.mode === 'oauth' ? t('connections.mode_oauth') : t('connections.mode_manual')"
            variant="subtle"
            size="xs"
          />
        </div>

        <!-- Step 1: Category Selection -->
        <div v-if="addStep === 'category'" class="space-y-4 pt-4">
          <p class="text-xs text-muted">
            {{ t('connections.add_category_hint') }}
          </p>
          <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            <div
              v-for="cat in CATEGORIES"
              :key="cat.key"
              class="group relative rounded-xl border border-default/60 p-4 cursor-pointer hover:border-primary hover:bg-primary/5 transition-all flex flex-col items-center text-center gap-2"
              @click="selectCategory(cat)"
            >
              <div class="flex items-center justify-center size-12 rounded-xl bg-primary/10 text-primary group-hover:scale-105 transition-transform">
                <UIcon :name="cat.icon" class="size-6" />
              </div>
              <div class="min-w-0">
                <p class="text-sm font-semibold text-highlighted group-hover:text-primary transition-colors">
                  {{ categoryLabel(cat.key) }}
                </p>
                <p class="text-[11px] text-muted line-clamp-2 mt-1">
                  {{ t(`connections.wizard.${cat.key}_desc`) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2: Provider Selection -->
        <div v-if="addStep === 'provider'" class="space-y-4 pt-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div class="flex items-center gap-2 min-w-0">
              <UButton
                variant="ghost"
                color="neutral"
                size="xs"
                icon="i-lucide-arrow-left"
                @click="backToCategory"
              />
              <span class="text-xs font-semibold text-highlighted truncate">{{ categoryLabel(addCategory) }}</span>
            </div>
            <UInput
              v-model="addSearchQuery"
              icon="i-lucide-search"
              size="xs"
              class="w-full sm:w-56"
              :placeholder="t('common.search')"
            />
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
            <div
              v-for="p in categoryProviders"
              :key="p.key"
              class="group rounded-xl border border-default/60 p-3.5 cursor-pointer hover:border-primary hover:bg-primary/5 transition-all flex items-center gap-3"
              @click="selectProvider(p)"
            >
              <div class="flex items-center justify-center size-10 rounded-lg bg-elevated/70 shrink-0 group-hover:scale-105 transition-transform">
                <UIcon :name="p.icon" class="size-5 text-highlighted group-hover:text-primary transition-colors" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                  <p class="text-xs font-semibold text-highlighted truncate group-hover:text-primary transition-colors">
                    {{ p.name }}
                  </p>
                  <UBadge
                    v-if="p.connection"
                    :label="isConnected(p) ? t('connections.connected') : t('common.error')"
                    :color="isConnected(p) ? 'success' : 'error'"
                    variant="subtle"
                    size="xs"
                  />
                </div>
                <p class="text-[11px] text-muted truncate mt-0.5">
                  {{ p.description }}
                </p>
              </div>
              <UIcon name="i-lucide-chevron-right" class="size-4 text-muted group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
            </div>

            <div v-if="!categoryProviders.length" class="col-span-full py-12 flex flex-col items-center justify-center text-center gap-2">
              <UIcon name="i-lucide-inbox" class="size-8 text-muted" />
              <p class="text-xs text-muted">
                {{ t('connections.no_providers_in_category') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Step 3: Provider Configuration Form -->
        <div v-if="addStep === 'form'" class="space-y-4 pt-4">
          <div class="flex items-center gap-2 pb-2 border-b border-default/40">
            <UButton
              variant="ghost"
              color="neutral"
              size="xs"
              icon="i-lucide-arrow-left"
              @click="backToProvider"
            />
            <div class="flex items-center gap-2 min-w-0">
              <UIcon :name="addProvider?.icon" class="size-5 shrink-0" />
              <span class="text-xs font-semibold text-highlighted truncate">{{ addProvider?.name }}</span>
            </div>
          </div>

          <p v-if="addProvider?.description" class="text-xs text-muted">
            {{ addProvider.description }}
          </p>

          <div class="space-y-3">
            <UFormField
              v-for="field in addProvider ? providerFields(addProvider) : []"
              :key="field.key"
              :label="field.label"
              :required="field.required"
            >
              <UInput
                v-model="addValues[field.key]"
                :type="field.type === 'password' ? 'password' : 'text'"
                class="w-full"
                :placeholder="field.type === 'password' ? '••••••••' : field.label"
                autocomplete="off"
              />
            </UFormField>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex items-center justify-between w-full pt-2">
          <UButton
            v-if="addStep !== 'category'"
            :label="t('common.back')"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            size="sm"
            :disabled="addSaving"
            @click="addStep === 'provider' ? backToCategory() : backToProvider()"
          />
          <div v-else />

          <div class="flex items-center gap-2">
            <UButton
              :label="t('common.cancel')"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="addSaving"
              @click="isAddOpen = false"
            />
            <UButton
              v-if="addStep === 'form'"
              type="button"
              :label="t('global.save')"
              icon="i-lucide-save"
              :loading="addSaving"
              variant="soft"
              color="primary"
              size="sm"
              @click="saveAddConnection"
            />
          </div>
        </div>
      </template>
    </BaseResponsiveModal>

    <LazyBaseConfirmModal
      v-model:open="isDisconnectOpen"
      :title="t('connections.disconnect_title')"
      :description="t('connections.disconnect_desc', [disconnectProvider?.name || ''])"
      :confirm-label="t('connections.disconnect')"
      :cancel-label="t('common.cancel')"
      color="error"
      icon="i-lucide-unplug"
      @confirm="doDisconnect"
    />
  </BasePage>
</template>
