<script setup lang="ts">
// =============================================================================
//  TMCut — Asset Center panel (roadmap v3 PART A, Phase 2)
//
//  The "Asset" tab of the left library: browse the on-demand catalog
//  (starter set shipped in the installer + remote catalog entries), check
//  rights (license badges — review/unknown are hard blocks), install with
//  verified downloads (progress + retry + cancel), and apply installed
//  assets into the project (media -> library, effect-preset -> selected
//  clip, title-preset -> text clip). Everything stays in the validated
//  store — nothing here touches the filesystem directly (roadmap §14).
// =============================================================================
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { EFFECT_REGISTRY, secToTicks, TICKS_PER_SECOND } from '@tmcut-core'
import { useTmcutAssetCenter } from '~/composables/useTmcutAssetCenter'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { humanizeKey } from '~/utils/tmcut/fxLibrary'

const { t } = useI18n()
const toast = useToast()

const {
  catalogEntries,
  installed,
  catalogLoaded,
  jobs,
  load,
  install,
  retry,
  cancel,
  uninstall,
  verifyAll,
  installedFilePath,
  installedPayload,
  canInstallEntry,
  takedownFor,
  takedownAffected,
  hasEntitlement
} = useTmcutAssetCenter()

const { isDesktop, importFiles } = useTmcutMedia()
const { selectedClipId, selectedClip, updateClip, pushHistory, addClipToTrack } = useTmcutProject()
const { playhead } = useTmcutPlayback()

const search = ref('')
const activeCategory = ref('all')
const applyBusy = ref<string | null>(null)

onMounted(async () => {
  await load()
  // Missing-asset health pass (roadmap §15): re-verify installed packages
  // once so a deleted/corrupted file flips to a recoverable 'missing' state.
  if (isDesktop.value) await verifyAll()
})

const categories = computed(() => {
  const set = new Set<string>()
  for (const entry of catalogEntries.value) set.add(entry.category)
  return ['all', ...[...set].sort()]
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return catalogEntries.value.filter((entry) => {
    if (activeCategory.value !== 'all' && entry.category !== activeCategory.value) return false
    if (!q) return true
    const hay = [entry.title, entry.description, entry.category, ...entry.tags].join(' ').toLowerCase()
    return hay.includes(q)
  })
})

const isDesktopStore = computed(() => isDesktop.value)

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

function licenseTone(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'approved') return 'success'
  if (status === 'review') return 'warning'
  return 'neutral'
}

function licenseLabel(status: string): string {
  if (status === 'approved') return t('tmcut.assetCenter.licenseApproved')
  if (status === 'review') return t('tmcut.assetCenter.licenseReview')
  return t('tmcut.assetCenter.licenseUnknown')
}

function categoryLabel(category: string): string {
  return t(`tmcut.assetCenter.categories.${category}`, humanizeKey(category))
}

function kindIcon(entry: { assetKind: string, category: string }): string {
  if (entry.assetKind === 'title-preset') return 'i-lucide-type'
  if (entry.assetKind === 'effect-preset') return 'i-lucide-palette'
  if (entry.category === 'music') return 'i-lucide-music'
  if (entry.category === 'sound-effects') return 'i-lucide-audio-lines'
  if (entry.category === 'fonts') return 'i-lucide-case-sensitive'
  return 'i-lucide-package'
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function handleInstall(entryId: string) {
  const res = await install(entryId)
  if (!res.ok && res.reason) {
    toast.add({ title: t(`tmcut.assetCenter.blocked.${res.reason}`, t('tmcut.assetCenter.installBlocked')), color: 'warning' })
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

// ----- Apply installed assets into the project ------------------------------

async function applyMedia(entryId: string) {
  const path = installedFilePath(entryId)
  if (!path) return
  applyBusy.value = entryId
  try {
    const result = await importFiles([path])
    if (result.failed > 0) {
      toast.add({ title: t('tmcut.assetCenter.applyFailed'), color: 'error' })
    } else {
      toast.add({ title: t('tmcut.assetCenter.addedToLibrary'), color: 'success' })
    }
  } finally {
    applyBusy.value = null
  }
}

function applyEffectPreset(entryId: string) {
  if (!selectedClipId.value || !selectedClip.value) {
    toast.add({ title: t('tmcut.assetCenter.selectClipFirst'), color: 'warning' })
    return
  }
  const payload = installedPayload(entryId)
  if (!payload) return
  const effectType = String(payload.effectType || '')
  // Validate against the registry: an unknown effect type must never be
  // written into the project (roadmap §14 — no unvalidated edits).
  const desc = EFFECT_REGISTRY[effectType]
  if (!desc) {
    toast.add({ title: t('tmcut.assetCenter.applyFailed'), color: 'error' })
    return
  }
  const params: Record<string, unknown> = {}
  for (const p of desc.params) {
    params[p.name] = p.default
  }
  // Overlay only the declared preset params (unknown keys are ignored).
  const preset = (payload.params || {}) as Record<string, unknown>
  for (const p of desc.params) {
    if (p.name in preset) params[p.name] = preset[p.name]
  }
  const current = [...(selectedClip.value.item.effects || [])]
  current.push({ type: effectType, params })
  pushHistory()
  updateClip(selectedClipId.value, { effects: current })
  toast.add({ title: t('tmcut.assetCenter.appliedToClip'), color: 'success' })
}

function applyTitlePreset(entryId: string) {
  const payload = installedPayload(entryId)
  if (!payload) return
  const clip = addClipToTrack('text', {
    name: String(payload.text || 'Title'),
    text: String(payload.text || 'Title'),
    in: 0,
    out: 4 * TICKS_PER_SECOND,
    offset: Math.round(secToTicks(playhead.value)),
    fontSize: Number(payload.fontSize) || 48,
    color: String(payload.color || '#ffffff')
  })
  if (clip) toast.add({ title: t('tmcut.assetCenter.titleAdded'), color: 'success' })
}

function handleApply(entryId: string, assetKind: string) {
  if (assetKind === 'media') return void applyMedia(entryId)
  if (assetKind === 'effect-preset') return applyEffectPreset(entryId)
  if (assetKind === 'title-preset') return applyTitlePreset(entryId)
}
</script>

<template>
  <!-- Web runtime: no verified install path (no local packages) — honest note,
       no dead controls (roadmap: every control does something real). -->
  <div v-if="!isDesktopStore" class="px-3 py-6 text-center text-[11px] text-neutral-500 dark:text-neutral-500">
    <UIcon name="i-lucide-monitor-pc" class="size-5 mx-auto mb-2 opacity-60" />
    {{ t('tmcut.assetCenter.webOnly') }}
  </div>

  <div v-else class="flex flex-col gap-2">
    <!-- Search + category chips -->
    <div class="space-y-2">
      <UInput
        id="tmcut-asset-center-search"
        v-model="search"
        icon="i-lucide-search"
        size="xs"
        color="neutral"
        class="w-full"
        :placeholder="t('tmcut.assetCenter.search')"
        :aria-label="t('tmcut.assetCenter.search')"
      />
      <div class="flex items-center gap-1 overflow-x-auto pb-0.5 scrollbar-none">
        <button
          v-for="category in categories"
          :key="category"
          type="button"
          class="px-2 py-1 rounded-md text-[10px] font-medium shrink-0 border transition-colors cursor-pointer"
          :class="activeCategory === category
            ? 'bg-primary/20 border-primary text-primary font-semibold'
            : 'bg-neutral-200/60 dark:bg-neutral-800/60 border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-700'"
          @click="activeCategory = category"
        >
          {{ category === 'all' ? t('tmcut.assetCenter.all') : categoryLabel(category) }}
        </button>
      </div>
    </div>

    <!-- Audit banner (roadmap §26): installed copies hit by live notices -->
    <div
      v-if="takedownAffected.length > 0"
      class="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-200"
    >
      <UIcon name="i-lucide-shield-alert" class="size-3 shrink-0" />
      {{ t('tmcut.assetCenter.takedownAffectedCount', { count: takedownAffected.length }) }}
    </div>

    <!-- Catalog list (the parent media-scroll container owns the scroll) -->
    <div class="space-y-1.5">
      <div
        v-if="catalogLoaded && filtered.length === 0"
        class="border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg p-4 text-center text-[11px] text-neutral-500"
      >
        {{ t('tmcut.assetCenter.empty') }}
      </div>

      <div
        v-for="entry in filtered"
        :key="entry.id"
        class="rounded-lg border border-neutral-300/80 dark:border-neutral-800/80 bg-neutral-100/70 dark:bg-neutral-900/70 p-2.5 space-y-1.5"
      >
        <div class="flex items-start gap-2">
          <UIcon :name="kindIcon(entry)" class="size-4 shrink-0 mt-0.5 text-primary" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 min-w-0">
              <p class="text-[11px] font-semibold truncate">
                {{ entry.title }}
              </p>
              <span class="text-[9px] font-mono text-neutral-500 shrink-0">v{{ entry.version }}</span>
            </div>
            <p class="text-[10px] text-neutral-500 dark:text-neutral-400 line-clamp-2 leading-snug">
              {{ entry.description }}
            </p>
          </div>
          <UBadge
            :color="licenseTone(entry.license.status)"
            variant="soft"
            size="xs"
            class="shrink-0"
            :title="entry.license.name + (entry.license.attribution ? ' — ' + entry.license.attribution : '')"
          >
            {{ entry.license.name || licenseLabel(entry.license.status) }}
          </UBadge>
        </div>

        <!-- Takedown notice (roadmap §26: notice beats license). Installed
             copies keep working offline but show a warning + uninstall
             option; not-installed copies are hard-blocked. Never delete
             silently. -->
        <div
          v-if="takedownFor(entry.id) && entryState(entry.id) !== 'installed'"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-[10px] text-red-200"
        >
          <UIcon name="i-lucide-shield-off" class="size-3 shrink-0" />
          {{ t('tmcut.assetCenter.takedownBlocked') }}
        </div>

        <div
          v-else-if="takedownFor(entry.id)"
          class="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-200"
        >
          <span class="flex items-center gap-1.5 min-w-0">
            <UIcon name="i-lucide-shield-alert" class="size-3 shrink-0" />
            <span class="truncate">{{ t('tmcut.assetCenter.takedownAffected') }}</span>
          </span>
          <UButton
            size="xs"
            variant="soft"
            color="error"
            :label="t('tmcut.assetCenter.uninstall')"
            @click="handleUninstall(entry.id)"
          />
        </div>

        <!-- License gate notice (review/unknown never render as usable) -->
        <div
          v-else-if="!canInstallEntry(entry.id).allowed && entryState(entry.id) === 'catalog'"
          class="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-200"
        >
          <UIcon name="i-lucide-shield-alert" class="size-3 shrink-0" />
          {{ t(`tmcut.assetCenter.blocked.${canInstallEntry(entry.id).reason || 'review'}`, t('tmcut.assetCenter.installBlocked')) }}
        </div>

        <!-- In-flight progress -->
        <div v-if="entryState(entry.id) === 'active' || entryState(entry.id) === 'retrying'" class="space-y-1">
          <div class="flex items-center justify-between text-[10px] text-neutral-500">
            <span class="flex items-center gap-1">
              <UIcon name="i-lucide-download" class="size-3" />
              {{ entryState(entry.id) === 'retrying' ? t('tmcut.assetCenter.retrying') : t('tmcut.assetCenter.downloading') }}
            </span>
            <span class="font-mono">{{ entryProgress(entry.id) }}%</span>
          </div>
          <UProgress :model-value="entryProgress(entry.id)" size="sm" :indicator="entryProgress(entry.id) > 0" />
        </div>

        <!-- Failure / missing reason + recovery action -->
        <div
          v-else-if="entryState(entry.id) === 'error'"
          class="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-red-500/10 border border-red-500/30 text-[10px] text-red-200"
        >
          <span class="truncate flex items-center gap-1">
            <UIcon name="i-lucide-alert-triangle" class="size-3 shrink-0" />
            {{ t(`tmcut.assetCenter.failReason.${entryReason(entry.id) || 'network'}`, t('tmcut.assetCenter.downloadFailed')) }}
          </span>
          <UButton
            size="xs"
            variant="soft"
            color="warning"
            :disabled="applyBusy === entry.id"
            @click="handleRetry(entry.id)"
          >
            {{ t('tmcut.assetCenter.retry') }}
          </UButton>
        </div>

        <!-- Footer meta + actions -->
        <div class="flex items-center justify-between gap-2 pt-0.5">
          <div class="flex items-center gap-2 text-[9px] text-neutral-500 min-w-0">
            <span class="truncate">{{ categoryLabel(entry.category) }}</span>
            <span v-if="entry.sizeBytes" class="font-mono shrink-0">{{ formatBytes(entry.sizeBytes) }}</span>
            <span
              v-if="entry.priceUsd > 0"
              class="shrink-0 font-semibold"
              :class="hasEntitlement(entry.id, entry.version) ? 'text-emerald-500' : 'text-amber-500'"
            >
              {{ hasEntitlement(entry.id, entry.version)
                ? t('tmcut.assetCenter.owned')
                : `$${entry.priceUsd.toFixed(2)}` }}
            </span>
            <span v-if="entry.license.attribution" class="truncate" :title="entry.license.attribution">
              {{ t('tmcut.assetCenter.by') }} {{ entry.license.attribution }}
            </span>
          </div>

          <!-- Action set per lifecycle state — no dead controls -->
          <div class="flex items-center gap-1 shrink-0">
            <template v-if="entryState(entry.id) === 'catalog'">
              <UButton
                icon="i-lucide-download"
                size="xs"
                variant="soft"
                color="primary"
                :disabled="!canInstallEntry(entry.id).allowed || applyBusy === entry.id"
                :title="t('tmcut.assetCenter.install')"
                @click="handleInstall(entry.id)"
              >
                {{ t('tmcut.assetCenter.install') }}
              </UButton>
            </template>

            <template v-else-if="entryState(entry.id) === 'queued'">
              <UButton
                icon="i-lucide-x"
                size="xs"
                variant="ghost"
                color="neutral"
                :title="t('tmcut.assetCenter.cancel')"
                @click="handleCancel(entry.id)"
              />
            </template>

            <template v-else-if="entryState(entry.id) === 'installed'">
              <!-- Serving is blocked once a notice is live (notice beats
                   license); the warn banner above offers uninstall. -->
              <UButton
                v-if="!takedownFor(entry.id)"
                icon="i-lucide-play"
                size="xs"
                variant="solid"
                color="primary"
                :loading="applyBusy === entry.id"
                :title="t('tmcut.assetCenter.apply')"
                @click="handleApply(entry.id, entry.assetKind)"
              >
                {{ t('tmcut.assetCenter.apply') }}
              </UButton>
              <UDropdownMenu
                :items="[{ label: t('tmcut.assetCenter.uninstall'), icon: 'i-lucide-trash', onSelect: () => handleUninstall(entry.id) }]"
                :content="{ side: 'bottom', align: 'end' }"
              >
                <UButton
                  icon="i-lucide-more-vertical"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  :title="t('tmcut.assetCenter.uninstall')"
                />
              </UDropdownMenu>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
