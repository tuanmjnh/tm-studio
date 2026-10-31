<script setup lang="ts">
// R124 A6 (CapCut §3.4): Sticker library — curated emoji groups inserted
// as text-track graphic layers at the playhead. Catalog lives in core
// sticker.mjs so picker and future packs share one source. Everything a
// sticker inherits from the text pipeline is free: move/scale/rotate in
// the preview, keyframes, masks, animations — and the drawtext export
// (monochrome glyph there, color in preview — documented v1 gap).
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { STICKER_GROUPS, stickerMatches, TICKS_PER_SECOND, secToTicks } from '@tmcut-core'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'

const STICKER_SIZE = 96
const STICKER_SEC = 4

const { t } = useI18n()
const toast = useToast()
const { addClipToTrack } = useTmcutProject()
const { playhead } = useTmcutPlayback()

const search = ref('')
const activeGroup = ref('all')

const groupChips = computed(() => ['all', ...STICKER_GROUPS.map(g => g.id)])

function groupLabel(id: string) {
  return id === 'all' ? t('tmcut.stickers.groupAll') : t(`tmcut.stickers.groups.${id}`)
}

const visibleGroups = computed(() => {
  const q = search.value.trim()
  return STICKER_GROUPS
    .filter(g => activeGroup.value === 'all' || g.id === activeGroup.value)
    .map(g => ({ ...g, emojis: g.emojis.filter(e => stickerMatches(q, e)) }))
    .filter(g => g.emojis.length > 0)
})

function insertSticker(emoji: string) {
  const clip = addClipToTrack('text', {
    // Name shows in the timeline/inspector; the glyph doubles as its icon.
    name: emoji,
    text: emoji,
    in: 0,
    out: STICKER_SEC * TICKS_PER_SECOND,
    offset: Math.round(secToTicks(playhead.value)),
    fontSize: STICKER_SIZE
  })
  if (clip) {
    toast.add({ title: t('tmcut.stickers.added'), color: 'success' })
  }
}
</script>

<template>
  <!-- Lives inside the media panel's own scroll area — no nested overflow. -->
  <div class="flex flex-col min-h-0">
    <!-- Search -->
    <div class="px-2 pt-2">
      <UInput
        id="tmcut-sticker-library-search"
        v-model="search"
        icon="i-lucide-search"
        size="xs"
        class="w-full"
        :placeholder="t('tmcut.stickers.searchPlaceholder')"
        :aria-label="t('tmcut.stickers.searchPlaceholder')"
      />
    </div>

    <!-- Category chips -->
    <div class="flex items-center gap-1 px-2 pt-2 overflow-x-auto">
      <button
        v-for="chip in groupChips"
        :key="chip"
        type="button"
        class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors cursor-pointer"
        :class="activeGroup === chip
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        @click="activeGroup = chip"
      >
        {{ groupLabel(chip) }}
      </button>
    </div>

    <div class="p-2 space-y-3 pb-3">
      <div v-for="group in visibleGroups" :key="group.id" class="space-y-1.5">
        <span class="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider px-0.5">
          {{ groupLabel(group.id) }}
        </span>
        <div class="grid grid-cols-5 gap-1">
          <button
            v-for="emoji in group.emojis"
            :key="emoji"
            type="button"
            class="aspect-square flex items-center justify-center rounded-lg border border-transparent hover:border-primary/50 hover:bg-primary/10 text-2xl leading-none transition-colors cursor-pointer"
            :title="groupLabel(group.id)"
            @click="insertSticker(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </div>

      <p
        v-if="visibleGroups.length === 0"
        class="text-[10px] text-neutral-500 dark:text-neutral-600 text-center px-2 py-4"
      >
        {{ t('tmcut.stickers.empty') }}
      </p>
    </div>
  </div>
</template>
