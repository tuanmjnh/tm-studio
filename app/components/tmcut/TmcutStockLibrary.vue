<script setup lang="ts">
// =============================================================================
//  Stock media panel (kho tài nguyên) — free-for-commercial sources.
//
//  Sources mirror the app's Connections: Openverse is keyless and always on;
//  Pexels and Pixabay appear only when their hub connection is connected.
//  There is no API-key field here — the hub holds the credential and injects it
//  server-side (see useTmcutStock).
//
//  Opening the panel preloads a "what's hot" grid; scrolling loads the next
//  page (IntersectionObserver sentinel) with the button kept as a fallback.
//  Every result shows its licence and credit line.
//
//  Import works on both runtimes (see useTmcutStock): download on desktop,
//  upload to /api/v1/media/upload on web.
// =============================================================================
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutStock } from '~/composables/useTmcutStock'
import { requiresAttribution } from '~/utils/tmcut/stockProviders'
import type { StockItem, StockKind } from '~/utils/tmcut/stockProviders'

const { t } = useI18n()
const toast = useToast()

const {
  providers,
  hiddenProviders,
  provider,
  kind,
  kinds,
  query,
  items,
  mode,
  loading,
  error,
  hasMore,
  importingId,
  currentProvider,
  initialize,
  selectProvider,
  selectKind,
  search,
  retry,
  loadMore,
  importItem,
  importToTimeline
} = useTmcutStock()

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

onMounted(() => {
  void initialize()
  if (typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting)) void loadMore()
  }, { rootMargin: '240px' })
  if (sentinel.value) observer.observe(sentinel.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
})

const kindOptions = computed(() => kinds.value.map(value => ({
  value,
  label: t(`tmcut.stock.kind_${value}`),
  icon: value === 'video' ? 'i-lucide-film' : value === 'audio' ? 'i-lucide-music' : 'i-lucide-image'
})))

const hiddenLabels = computed(() => hiddenProviders.value.map(entry => entry.label).join(' · '))

function onSearch() {
  void search()
}

async function onImport(item: StockItem, toTimeline: boolean) {
  const result = toTimeline ? await importToTimeline(item) : await importItem(item)
  if (!result.ok) {
    toast.add({ title: t('tmcut.stock.importFailed'), description: result.error, color: 'error' })
    return
  }
  toast.add({
    title: toTimeline ? t('tmcut.stock.addedToTimeline') : t('tmcut.stock.addedToLibrary'),
    description: requiresAttribution(item) ? t('tmcut.stock.attributionHint') : undefined,
    color: 'success'
  })
}

async function copyCredit(item: StockItem) {
  try {
    await navigator.clipboard.writeText(item.attribution)
    toast.add({ title: t('tmcut.stock.creditCopied'), color: 'success' })
  } catch {
    toast.add({ title: t('tmcut.stock.creditCopyFailed'), color: 'error' })
  }
}

function thumb(item: StockItem): string {
  return item.previewUrl || item.downloadUrl
}

function durationLabel(item: StockItem): string {
  if (!item.durationSec) return ''
  const total = Math.round(item.durationSec)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
</script>

<template>
  <div class="flex flex-col min-h-0 gap-2">
    <!-- Provider chips: only sources connected to the hub -->
    <div class="flex items-center gap-1 overflow-x-auto pb-1">
      <button
        v-for="entry in providers"
        :key="entry.id"
        type="button"
        class="shrink-0 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer"
        :class="provider === entry.id
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-default text-muted hover:text-toned'"
        :title="entry.licenseNote"
        @click="selectProvider(entry.id)"
      >
        {{ entry.label }}
      </button>

      <!-- Locked providers stay out of the list; one info icon explains why. -->
      <UPopover
        v-if="hiddenProviders.length"
        :content="{ side: 'bottom', align: 'end' }"
        :ui="{ content: 'p-3 w-64' }"
      >
        <UButton
          icon="i-lucide-circle-help"
          size="xs"
          variant="ghost"
          color="warning"
          square
          class="ml-auto shrink-0"
          :aria-label="t('tmcut.stock.connectHint', { providers: hiddenLabels })"
        />
        <template #content>
          <div class="space-y-2.5">
            <p class="text-[11px] leading-snug text-toned flex items-start gap-1.5">
              <UIcon name="i-lucide-plug-zap" class="size-3.5 shrink-0 mt-px text-amber-500" />
              <span>{{ t('tmcut.stock.connectHint', { providers: hiddenLabels }) }}</span>
            </p>
            <UButton
              to="/resources/connections"
              size="xs"
              variant="soft"
              color="primary"
              icon="i-lucide-plug"
              :label="t('tmcut.stock.connectAction')"
              block
            />
          </div>
        </template>
      </UPopover>
    </div>

    <!-- Media kind -->
    <div class="flex items-center gap-1">
      <button
        v-for="option in kindOptions"
        :key="option.value"
        type="button"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer"
        :class="kind === option.value
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-default text-muted'"
        @click="selectKind(option.value as StockKind)"
      >
        <UIcon :name="option.icon" class="size-3" />
        {{ option.label }}
      </button>
    </div>

    <!-- Licence guarantee -->
    <p class="text-[10px] leading-snug text-muted flex items-start gap-1">
      <UIcon name="i-lucide-scale" class="size-3 shrink-0 mt-0.5 text-emerald-500" />
      <span>{{ currentProvider?.licenseNote }}</span>
    </p>

    <!-- Search -->
    <div class="flex items-center gap-1.5">
      <UInput
        v-model="query"
        icon="i-lucide-search"
        size="xs"
        class="flex-1"
        :placeholder="t('tmcut.stock.searchPlaceholder')"
        :aria-label="t('tmcut.stock.searchPlaceholder')"
        @keydown.enter="onSearch"
      />
      <UButton
        size="xs"
        icon="i-lucide-search"
        :aria-label="t('common.search')"
        :loading="loading"
        :disabled="!query.trim()"
        @click="onSearch"
      />
    </div>

    <!-- Result header -->
    <div v-if="items.length" class="flex items-center justify-between text-[10px] text-muted">
      <span>{{ mode === 'feed' ? t('tmcut.stock.suggested') : t('tmcut.stock.results') }}</span>
      <span class="font-mono">{{ items.length }}</span>
    </div>

    <!-- State messages -->
    <div v-if="error" class="space-y-1">
      <p class="text-[10px] text-red-400 break-words flex items-start gap-1">
        <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0 mt-0.5" />
        {{ error }}
      </p>
      <UButton
        size="xs"
        variant="soft"
        color="neutral"
        icon="i-lucide-refresh-cw"
        :label="t('tmcut.stock.retry')"
        @click="retry"
      />
    </div>

    <!-- Results -->
    <div class="grid grid-cols-2 gap-2">
      <figure
        v-for="item in items"
        :key="item.id"
        class="rounded-lg border border-default bg-muted/60 overflow-hidden"
      >
        <div class="relative aspect-video bg-neutral-900">
          <img
            :src="thumb(item)"
            :alt="item.title"
            class="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          >
          <span
            v-if="item.kind !== 'image'"
            class="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[9px] font-mono text-white"
          >{{ durationLabel(item) || item.kind }}</span>
          <span class="absolute top-1 left-1 rounded bg-black/70 px-1 py-px text-[9px] font-medium text-emerald-300">
            {{ item.license }}
          </span>
        </div>
        <figcaption class="p-1.5 space-y-1">
          <p class="text-[10px] font-medium text-toned truncate" :title="item.title">
            {{ item.title }}
          </p>
          <p class="text-[9px] text-muted truncate">
            {{ item.author }}
          </p>
          <div class="flex items-center gap-1">
            <UButton
              size="xs"
              variant="soft"
              color="primary"
              class="flex-1 justify-center"
              icon="i-lucide-plus"
              :loading="importingId === item.id"
              :disabled="!!importingId"
              :label="t('tmcut.stock.add')"
              @click="onImport(item, false)"
            />
            <UButton
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-arrow-right-to-line"
              :disabled="!!importingId"
              :title="t('tmcut.stock.addToTimeline')"
              @click="onImport(item, true)"
            />
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-quote"
              :title="t('tmcut.stock.copyCredit')"
              @click="copyCredit(item)"
            />
          </div>
          <NuxtLink
            v-if="item.pageUrl"
            :to="item.pageUrl"
            target="_blank"
            class="block text-[9px] text-muted underline truncate hover:text-primary"
          >
            {{ t('tmcut.stock.source') }}
          </NuxtLink>
        </figcaption>
      </figure>
    </div>

    <div v-if="!items.length && loading" class="py-6 text-center text-[11px] text-muted border border-dashed border-default rounded-lg">
      {{ t('tmcut.stock.loading') }}
    </div>
    <div v-else-if="!items.length && !error" class="py-6 text-center text-[11px] text-muted border border-dashed border-default rounded-lg">
      {{ mode === 'feed' ? t('tmcut.stock.emptyFeed') : t('tmcut.stock.empty') }}
    </div>

    <!-- Infinite-scroll sentinel + fallback button -->
    <div ref="sentinel" class="h-px w-full" aria-hidden="true" />
    <UButton
      v-if="hasMore"
      size="xs"
      variant="soft"
      color="neutral"
      block
      :loading="loading"
      :label="t('tmcut.stock.loadMore')"
      @click="loadMore"
    />
  </div>
</template>
