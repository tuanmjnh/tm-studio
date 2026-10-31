<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutAssetCenter } from '~/composables/useTmcutAssetCenter'

const { t } = useI18n()
const toast = useToast()

const {
  catalogEntries,
  installed,
  jobs,
  load,
  install,
  retry,
  cancel,
  uninstall,
  canInstallEntry
} = useTmcutAssetCenter()

const isDesktop = computed(() => typeof window !== 'undefined' && !!window.electronAPI?.tmcut)

const search = ref('')
const activeCategory = ref('all')
const activeTab = ref<'music' | 'sfx' | 'fonts' | 'all'>('all')

// Local helpers (mirrors TmcutAssetCenter.vue)
function entryState(entryId: string): string {
  const job = jobs.value.find(j => j.entryId === entryId && ['queued', 'active', 'retrying'].includes(j.state))
  if (job) return job.state
  const record = installed.value.find(r => r.entryId === entryId)
  return record?.state || 'catalog'
}

function entryProgress(entryId: string): number {
  const job = jobs.value.find(j => j.entryId === entryId)
  return job?.percent ?? 0
}

function entryReason(entryId: string): string | null {
  const job = jobs.value.find(j => j.entryId === entryId)
  if (job && job.reason) return job.reason
  return installed.value.find(r => r.entryId === entryId)?.reason ?? null
}

const categories = computed(() => {
  const set = new Set<string>()
  for (const entry of catalogEntries.value) set.add(entry.category)
  return ['all', ...[...set].sort()]
})

// Marketplace-specific categories
const marketplaceCategories = ['music', 'sound-effects', 'fonts']

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const catFilter = activeCategory.value
  const tabFilter = activeTab.value

  return catalogEntries.value.filter((entry) => {
    // Only show marketplace entries (id starts with marketplace-)
    if (!entry.id.startsWith('marketplace-')) return false
    // Filter by tab category
    if (tabFilter !== 'all' && entry.category !== tabFilter) return false
    // Filter by category filter (if not 'all')
    if (catFilter !== 'all' && entry.category !== catFilter) return false
    if (!q) return true
    const hay = [entry.title, entry.description, entry.category, ...entry.tags].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

const licenseTone = (status: string): 'success' | 'warning' | 'neutral' => {
  if (status === 'approved') return 'success'
  if (status === 'review') return 'warning'
  return 'neutral'
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function handleInstall(entryId: string) {
  const entry = catalogEntries.value.find(e => e.id === entryId)
  const res = await install(entryId)
  if (!res.ok && res.reason) {
    toast.add({ title: t(`tmcut.assetCenter.blocked.${res.reason}`, t('tmcut.assetCenter.installBlocked')), color: 'warning' })
  } else if (res.ok) {
    toast.add({ title: t('tmcut.assetCenter.installed', { name: entry?.title || '' }), color: 'success' })
  }
}

async function handleRetry(entryId: string) {
  await retry(entryId)
}

function handleCancel(entryId: string) {
  cancel(entryId)
}

async function handleUninstall(entryId: string) {
  await uninstall(entryId)
  toast.add({ title: t('tmcut.assetCenter.uninstalled'), color: 'neutral' })
}

function getCategoryIcon(category: string): string {
  if (category === 'music') return 'i-lucide-music'
  if (category === 'sound-effects') return 'i-lucide-audio-lines'
  if (category === 'fonts') return 'i-lucide-case-sensitive'
  return 'i-lucide-package'
}

const tabOptions = [
  { id: 'music', label: 'Music', icon: 'i-lucide-music' },
  { id: 'sfx', label: 'Sound Effects', icon: 'i-lucide-audio-lines' },
  { id: 'fonts', label: 'Fonts', icon: 'i-lucide-case-sensitive' }
]

onMounted(async () => {
  await load()
})

// Show web-only notice
const webOnly = !isDesktop.value
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Web-only notice -->
    <div v-if="webOnly" class="mb-4 p-3 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg">
      <div class="flex items-center gap-2 text-amber-700 dark:text-amber-300">
        <UIcon name="i-lucide-alert-circle" class="w-5 h-5 shrink-0" />
        <span class="text-sm">{{ t('tmcut.assetCenter.webOnly') }}</span>
      </div>
    </div>

    <!-- Search & Category Filter -->
    <div class="mb-4 flex flex-col sm:flex-row gap-3">
      <div class="relative flex-1">
        <UIcon name="i-lucide-search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          id="tmcut-marketplace-search"
          v-model="search"
          type="text"
          :placeholder="t('tmcut.assetCenter.search')"
          :aria-label="t('tmcut.assetCenter.search')"
          class="w-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg pl-9 pr-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-primary/50"
        />
      </div>
      <div class="flex items-center gap-1.5">
        <USelect
          v-model="activeCategory"
          :aria-label="t('tmcut.assetCenter.filterCategory')"
          :items="categories.filter(c => marketplaceCategories.includes(c) || c === 'all')"
          value-key="id"
          label-key="label"
          :placeholder="t('tmcut.assetCenter.all')"
          class="w-40"
          :options="categories.filter(c => marketplaceCategories.includes(c) || c === 'all').map(c => ({ id: c, label: c === 'all' ? t('tmcut.assetCenter.all') : t(`tmcut.assetCenter.categories.${c}`, c) }))"
        />
      </div>
    </div>

    <!-- Category Tabs -->
    <div class="mb-4 flex gap-1 bg-white dark:bg-neutral-900 p-1 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <button
        v-for="tab in tabOptions"
        :key="tab.id"
        type="button"
        :class="activeTab === tab.id
          ? 'bg-primary/15 text-primary'
          : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        class="flex-1 py-1.5 px-3 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 transition-colors"
        @click="activeTab = tab.id as 'music' | 'sfx' | 'fonts'"
      >
        <UIcon :name="tab.icon" class="w-4 h-4" />
        <span class="hidden sm:inline">{{ t(`tmcut.marketplace.tab${tab.id.charAt(0).toUpperCase() + tab.id.slice(1)}`) }}</span>
      </button>
    </div>

    <!-- Marketplace Grid -->
    <div class="flex-1 overflow-y-auto">
      <div v-if="filtered.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-1">
        <div
          v-for="entry in filtered"
          :key="entry.id"
          class="group bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 flex flex-col hover:border-primary/50 transition-all"
        >
          <!-- Header -->
          <div class="flex items-start justify-between gap-2 mb-3">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <UIcon :name="getCategoryIcon(entry.category)" class="w-4 h-4 text-primary" />
              </div>
              <div>
                <p class="text-xs font-medium text-neutral-900 dark:text-neutral-100 truncate">{{ entry.title }}</p>
                <p class="text-[10px] text-neutral-500 uppercase tracking-wider">
                  {{ t(`tmcut.assetCenter.categories.${entry.category}`, entry.category) }}
                </p>
              </div>
            </div>
            <div class="flex items-center gap-1">
              <span class="px-1.5 py-0.5 rounded text-[10px] font-medium" :class="licenseTone(entry.license?.status)">
                {{ t(`tmcut.assetCenter.license${entry.license?.status?.charAt(0).toUpperCase() + entry.license?.status?.slice(1)}`, entry.license?.status || 'unknown') }}
              </span>
            </div>
          </div>

          <!-- Description -->
          <p class="text-sm text-neutral-600 dark:text-neutral-400 line-clamp-2 mb-3 flex-1">
            {{ entry.description }}
          </p>

          <!-- Meta -->
          <div class="flex items-center gap-3 text-[11px] text-neutral-500 mb-3">
            <span class="flex items-center gap-1">
              <UIcon name="i-lucide-package" class="w-3 h-3" />
              {{ formatBytes(entry.sizeBytes) }}
            </span>
            <span v-if="entry.creator" class="flex items-center gap-1">
              <UIcon name="i-lucide-user" class="w-3 h-3" />
              {{ entry.creator }}
            </span>
          </div>

          <!-- Tags -->
          <div class="flex flex-wrap gap-1 mb-3">
            <span
              v-for="tag in entry.tags.slice(0, 4)"
              :key="tag"
              class="px-1.5 py-0.5 rounded text-[10px] bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400"
            >
              {{ tag }}
            </span>
            <span v-if="entry.tags.length > 4" class="px-1.5 py-0.5 rounded text-[10px] bg-neutral-100 dark:bg-neutral-800 text-neutral-500">
              +{{ entry.tags.length - 4 }}
            </span>
          </div>

          <!-- Action Bar -->
          <div class="flex items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <div class="flex items-center gap-1.5">
              <span v-if="entryState(entry.id) === 'downloading'" class="flex items-center gap-1 text-xs text-primary">
                <UIcon name="i-lucide-loader" class="w-3 h-3 animate-spin" />
                {{ entryProgress(entry.id) }}%
              </span>
              <span v-else-if="entryState(entry.id) === 'verifying'" class="flex items-center gap-1 text-xs text-warning">
                <UIcon name="i-lucide-shield-check" class="w-3 h-3" />
                {{ t('tmcut.assetCenter.verifying') }}
              </span>
              <span v-else-if="entryState(entry.id) === 'error'" class="flex items-center gap-1 text-xs text-error">
                <UIcon name="i-lucide-alert-triangle" class="w-3 h-3" />
                {{ t(`tmcut.assetCenter.failReason.${entryReason(entry.id) || 'failed'}`, t('tmcut.assetCenter.downloadFailed')) }}
              </span>
              <span v-else-if="entryState(entry.id) === 'installed'" class="flex items-center gap-1 text-xs text-success">
                <UIcon name="i-lucide-check-circle" class="w-3 h-3" />
                {{ t('tmcut.assetCenter.owned') }}
              </span>
            </div>

            <div class="flex items-center gap-1.5 ml-auto">
              <UButton
                v-if="['catalog', 'error'].includes(entryState(entry.id))"
                :disabled="!canInstallEntry(entry.id)?.allowed"
                :title="canInstallEntry(entry.id)?.reason ? t(`tmcut.assetCenter.blocked.${canInstallEntry(entry.id).reason}`) : ''"
                icon="i-lucide-download"
                size="xs"
                variant="soft"
                color="primary"
                @click="handleInstall(entry.id)"
              >
                {{ t('tmcut.assetCenter.install') }}
              </UButton>
              <UButton
                v-else-if="entryState(entry.id) === 'downloading'"
                icon="i-lucide-x"
                size="xs"
                variant="ghost"
                color="neutral"
                @click="handleCancel(entry.id)"
              >
                {{ t('tmcut.assetCenter.cancel') }}
              </UButton>
              <UButton
                v-else-if="entryState(entry.id) === 'error'"
                icon="i-lucide-rotate-ccw"
                size="xs"
                variant="soft"
                color="warning"
                @click="handleRetry(entry.id)"
              >
                {{ t('tmcut.assetCenter.retry') }}
              </UButton>
              <UButton
                v-else-if="entryState(entry.id) === 'installed'"
                icon="i-lucide-trash-2"
                size="xs"
                variant="ghost"
                color="error"
                @click="handleUninstall(entry.id)"
              >
                {{ t('tmcut.assetCenter.uninstall') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="flex flex-col items-center justify-center py-16 text-center px-4">
        <div class="w-16 h-16 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 mb-4">
          <UIcon :name="activeTab === 'music' ? 'i-lucide-music' : activeTab === 'sfx' ? 'i-lucide-audio-lines' : 'i-lucide-case-sensitive'" class="w-8 h-8" />
        </div>
        <h3 class="text-base font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
          {{ t('tmcut.marketplace.emptyTitle') }}
        </h3>
        <p class="text-sm text-neutral-500 max-w-sm">
          {{ t('tmcut.marketplace.emptyDesc') }}
        </p>
      </div>
    </div>
  </div>
</template>