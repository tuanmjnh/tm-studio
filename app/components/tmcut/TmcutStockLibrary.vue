<script setup lang="ts">
// =============================================================================
//  Stock media panel (kho tài nguyên) — free-for-commercial sources.
//
//  Openverse needs no key (CC0 / CC BY / CC BY-SA only); Pexels and Pixabay
//  take a free search API key the user pastes here (stored in localStorage,
//  never in the project). Every result shows its licence and credit line, and
//  the panel refuses to search a keyed provider without a key instead of
//  failing with a 401.
//
//  Import works on both runtimes (see useTmcutStock): download on desktop,
//  upload to /api/v1/media/upload on web.
// =============================================================================
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutStock } from '~/composables/useTmcutStock'
import { requiresAttribution } from '~/utils/tmcut/stockProviders'
import type { StockItem, StockKind } from '~/utils/tmcut/stockProviders'

const { t } = useI18n()
const toast = useToast()

const {
  providers,
  provider,
  kind,
  kinds,
  query,
  items,
  loading,
  error,
  hasMore,
  importingId,
  currentProvider,
  apiKey,
  needsKey,
  setKey,
  selectProvider,
  selectKind,
  search,
  loadMore,
  importItem,
  importToTimeline
} = useTmcutStock()

const keyDraft = ref('')
const showKey = ref(false)

watch(provider, () => {
  keyDraft.value = apiKey.value
})
onMounted(() => {
  keyDraft.value = apiKey.value
})

const kindOptions = computed(() => kinds.value.map(value => ({
  value,
  label: t(`tmcut.stock.kind_${value}`),
  icon: value === 'video' ? 'i-lucide-film' : value === 'audio' ? 'i-lucide-music' : 'i-lucide-image'
})))

function saveKey() {
  setKey(keyDraft.value)
  showKey.value = false
  toast.add({
    title: keyDraft.value.trim() ? t('tmcut.stock.keySaved', { provider: currentProvider.value?.label }) : t('tmcut.stock.keyCleared'),
    color: 'success'
  })
}

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
    <!-- Provider chips -->
    <div class="flex items-center gap-1 overflow-x-auto pb-1">
      <button
        v-for="entry in providers"
        :key="entry.id"
        type="button"
        class="shrink-0 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer"
        :class="provider === entry.id
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        :title="entry.licenseNote"
        @click="selectProvider(entry.id)"
      >
        {{ entry.label }}
        <UIcon v-if="entry.requiresKey" name="i-lucide-key-round" class="size-3 inline-block ml-0.5 opacity-70" />
      </button>
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
          : 'border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400'"
        @click="selectKind(option.value as StockKind)"
      >
        <UIcon :name="option.icon" class="size-3" />
        {{ option.label }}
      </button>
    </div>

    <!-- Licence guarantee -->
    <p class="text-[10px] leading-snug text-neutral-500 dark:text-neutral-400 flex items-start gap-1">
      <UIcon name="i-lucide-scale" class="size-3 shrink-0 mt-0.5 text-emerald-500" />
      <span>{{ currentProvider?.licenseNote }}</span>
    </p>

    <!-- API key (keyed providers only) -->
    <div v-if="currentProvider?.requiresKey" class="space-y-1">
      <div class="flex items-center gap-1.5">
        <UInput
          v-model="keyDraft"
          :type="showKey ? 'text' : 'password'"
          size="xs"
          class="flex-1"
          :placeholder="apiKey ? t('tmcut.stock.keySavedShort') : t('tmcut.stock.keyPlaceholder', { provider: currentProvider?.label })"
          :aria-label="t('tmcut.stock.keyLabel', { provider: currentProvider?.label })"
          @keydown.enter="saveKey"
        />
        <UButton
          size="xs"
          variant="soft"
          :label="t('tmcut.stock.saveKey')"
          @click="saveKey"
        />
      </div>
      <div class="flex items-center justify-between text-[10px] text-neutral-500">
        <NuxtLink :to="currentProvider?.keyUrl" target="_blank" class="underline hover:text-primary">
          {{ t('tmcut.stock.getKey', { provider: currentProvider?.label }) }}
        </NuxtLink>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="showKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
          :aria-label="t('tmcut.stock.toggleKey')"
          @click="showKey = !showKey"
        />
      </div>
    </div>

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
        :loading="loading"
        :disabled="needsKey || !query.trim()"
        @click="onSearch"
      />
    </div>

    <!-- State messages -->
    <p v-if="needsKey" class="text-[10px] text-amber-500 flex items-start gap-1">
      <UIcon name="i-lucide-key-round" class="size-3 shrink-0 mt-0.5" />
      {{ t('tmcut.stock.keyRequired', { provider: currentProvider?.label }) }}
    </p>
    <p v-else-if="error" class="text-[10px] text-red-400 break-words flex items-start gap-1">
      <UIcon name="i-lucide-triangle-alert" class="size-3 shrink-0 mt-0.5" />
      {{ error }}
    </p>

    <!-- Results -->
    <div class="grid grid-cols-2 gap-2 overflow-y-auto min-h-0">
      <figure
        v-for="item in items"
        :key="item.id"
        class="rounded-lg border border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/60 overflow-hidden"
      >
        <div class="relative aspect-video bg-neutral-900">
          <img
            :src="thumb(item)"
            :alt="item.title"
            class="w-full h-full object-cover"
            loading="lazy"
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
          <p class="text-[10px] font-medium text-neutral-700 dark:text-neutral-200 truncate" :title="item.title">
            {{ item.title }}
          </p>
          <p class="text-[9px] text-neutral-500 truncate">
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
            class="block text-[9px] text-neutral-500 underline truncate hover:text-primary"
          >
            {{ t('tmcut.stock.source') }}
          </NuxtLink>
        </figcaption>
      </figure>
    </div>

    <div v-if="!items.length && !loading && !error && !needsKey" class="py-6 text-center text-[11px] text-neutral-500 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg">
      {{ t('tmcut.stock.empty') }}
    </div>

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
