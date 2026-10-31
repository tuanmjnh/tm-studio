<script setup lang="ts">
// =============================================================================
//  Effects / Transitions / Filters library (roadmap R112, R128 expansion) —
//  the "More" tab of the media library, replacing the old coming-soon
//  placeholder. Fully DATA-DRIVEN from the core registries at runtime:
//  EFFECT_REGISTRY (effects + their `category`), the lut3d preset enum
//  (filters) and app/utils/tmcut/fxCatalog.ts (transition names + grouping),
//  so this panel can never drift from what actually renders in preview/export.
//
//  R128: a search box matches type + label, effects are grouped under their
//  registry category with a category chip row, the Filters tab shows every
//  lut3d preset the core ships (>= 18), and transitions are grouped by the
//  catalog's category with readable labels.
//
//  Semantics: effects & filters apply to the SELECTED clip (add/toggle);
//  transitions apply to the selected clip's cut with its left neighbor via
//  the store's validated applyClipTransition (reasons surface as toasts —
//  the same contract the clip context menu uses).
// =============================================================================
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { EFFECT_REGISTRY, KNOWN_TRANSITIONS } from '@tmcut-core'
import { useTmcutProject } from '~/composables/useTmcutProject'
import {
  toggleEffectOnClip,
  setLutPresetOnClip,
  activeLutPreset,
  transitionReasonKey,
  registryEntries,
  searchEffects,
  groupEffectsByCategory,
  effectCategoryOf,
  filterPresets,
  humanizeKey,
  groupsFromCatalog,
  groupTransitions,
  FX_OTHER_CATEGORY
} from '~/utils/tmcut/fxLibrary'
import type { FxRegistryEntry, FxTransitionEntry } from '~/utils/tmcut/fxLibrary'
import { TRANSITION_CATALOG, TRANSITION_CATEGORIES, transitionsByCategory } from '~/utils/tmcut/fxCatalog'

// R120: the media panel splits Effects / Transitions / Filters into their
// own top-level tabs (mock #2 subtab bar); the component keeps its internal
// switcher too (tab='all') so the old "More" aggregate stays available.
const props = withDefaults(defineProps<{ tab?: FxTab | 'all' }>(), { tab: 'all' })

type FxTab = 'effects' | 'transitions' | 'filters'
const fxTab = ref<FxTab>('effects')
watch(() => props.tab, (v) => {
  if (v !== 'all') fxTab.value = v
}, { immediate: true })
const showSubTabs = computed(() => props.tab === 'all')

const { t, te } = useI18n()
const toast = useToast()
const {
  selectedClip,
  selectedClipId,
  updateClip,
  pushHistory,
  applyClipTransition,
  clearClipTransition
} = useTmcutProject()

const DEFAULT_TRANSITION_SEC = 0.5

// --- Search + category filter (shared by the three sub-tabs) ---------------
const search = ref('')
const activeCategory = ref('all')
// The chip row is per-tab: a category picked for effects makes no sense once
// the user switches to transitions/filters.
watch(fxTab, () => {
  activeCategory.value = 'all'
})
const query = computed(() => search.value.trim())
// The hint names what the active tab actually searches (R153): a stale
// "Search effects…" on the Transitions tab was the copy bug users reported.
const searchPlaceholder = computed(() => t(`tmcut.fxLib.searchPh_${fxTab.value}`))

// Icon per effect type (registry owns the truth; this is presentation only).
const EFFECT_ICONS: Record<string, string> = {
  'blur': 'i-lucide-cloud-fog',
  'sharpen': 'i-lucide-aperture',
  'vignette': 'i-lucide-circle-dot',
  'grain': 'i-lucide-grid-3x3',
  'chromakey': 'i-lucide-droplet',
  'lut3d': 'i-lucide-palette',
  'stabilize': 'i-lucide-wind',
  'eq-grade': 'i-lucide-contrast',
  // R128 wave.
  'pixelate': 'i-lucide-grid-2x2',
  'emboss': 'i-lucide-layers',
  'edge-detect': 'i-lucide-scan',
  'letterbox': 'i-lucide-frame',
  'mirror-h': 'i-lucide-flip-horizontal',
  'mirror-v': 'i-lucide-flip-vertical',
  'rotate-90': 'i-lucide-rotate-cw',
  'chromatic': 'i-lucide-git-compare',
  'fisheye': 'i-lucide-globe',
  'motion-blur': 'i-lucide-wind',
  'afterimage': 'i-lucide-copy',
  'denoise': 'i-lucide-eraser',
  'deband': 'i-lucide-layers',
  'sepia': 'i-lucide-coffee',
  'mono': 'i-lucide-contrast',
  'vhs': 'i-lucide-tv',
  'negate': 'i-lucide-circle-slash',
  'vivid': 'i-lucide-sun',
  'bleach-bypass': 'i-lucide-snowflake',
  'teal-orange': 'i-lucide-paint-bucket',
  'vibrance': 'i-lucide-waves'
}

const TRANSITION_ICONS: Record<string, string> = {
  'fade': 'i-lucide-sun-medium',
  'dissolve': 'i-lucide-layers',
  'wipe-left': 'i-lucide-arrow-left-to-line',
  'wipe-right': 'i-lucide-arrow-right-to-line',
  'slide-left': 'i-lucide-move-left',
  'zoom-in': 'i-lucide-zoom-in'
}

const selectionKind = computed(() => selectedClip.value?.track || null)
// Effects/filters need a media clip; a text clip carries its own anim model
// and an audio clip has no visual channel — no dead tiles.
const canApplyVisual = computed(() => selectionKind.value === 'video')
const canApplyTransition = computed(() => selectionKind.value === 'video')
// The hint bar reflects what the CURRENT sub-tab acts on.
const targetOk = computed(() => !!selectedClip.value
  && (fxTab.value === 'transitions' ? canApplyTransition.value : canApplyVisual.value))

const clipEffects = computed(() => selectedClip.value?.item.effects || [])
const activeEffectTypes = computed(() => new Set(clipEffects.value.map(e => e.type)))
const activeLut = computed(() => activeLutPreset(clipEffects.value))
const activeTransition = computed(() => {
  const ti = selectedClip.value?.item.transitionIn
  return (ti?.duration ?? 0) > 0 ? ti!.type : null
})

// --- Localised labels (registry/catalog text is the English fallback) ------
function effectIcon(type: string): string {
  return EFFECT_ICONS[type] || 'i-lucide-sparkles'
}

/**
 * The selected clip's live params for one effect, so an applied tile previews
 * the strength the clip actually carries instead of the registry default.
 * The resolver clamps whatever is stored, so a dirty project JSON cannot
 * drive an out-of-range tile.
 */
function clipParamsFor(type: string): Record<string, unknown> {
  return clipEffects.value.find(effect => effect.type === type)?.params || {}
}

// A tile that has keyboard focus plays its reveal too (Roadmap v1 §6.4: hover,
// focus or selection, consistently across the three tabs). The library owns the
// button, so it forwards that state as the thumb's `active` prop.
const focusedKey = ref<string | null>(null)
function tileActive(kind: 'effect' | 'filter' | 'transition', key: string, applied: boolean): boolean {
  return applied || focusedKey.value === `${kind}:${key}`
}

function effectCategoryLabel(category: string): string {
  return t(`tmcut.fxLib.effectCategories.${category}`, humanizeKey(category))
}

function transitionCategoryLabel(category: string): string {
  return t(`tmcut.fxLib.transitionCategories.${category}`, humanizeKey(category))
}

function effectLabel(entry: FxRegistryEntry): string {
  const key = entry.type === 'eq-grade' ? 'eqGrade' : entry.type
  return t(`tmcut.effects.${key}`, entry.label || humanizeKey(entry.type))
}

function filterLabel(preset: string): string {
  return t(`tmcut.fxLib.lut.${preset}`, humanizeKey(preset))
}

function transitionLabel(key: string, fallback?: string): string {
  return t(`tmcut.clipMenu.types.${key}`, fallback || humanizeKey(key))
}

// --- Effects: registry-driven, grouped by category -------------------------
// lut3d lives in the Filters tab; stabilize has its own E-5 inspector section.
const allEffects = computed(() =>
  registryEntries(EFFECT_REGISTRY).filter(desc => desc.type !== 'lut3d' && desc.type !== 'stabilize')
)

const matchedEffects = computed(() => searchEffects(allEffects.value, query.value))

const categoryChips = computed(() => [
  'all',
  ...groupEffectsByCategory(allEffects.value).map(group => group.category)
])

const effectGroups = computed(() => {
  // A live query searches across every category (never hides a match behind
  // the chip row the user picked earlier).
  const list = activeCategory.value === 'all' || query.value
    ? matchedEffects.value
    : matchedEffects.value.filter(desc => effectCategoryOf(desc) === activeCategory.value)
  return groupEffectsByCategory(list).map(group => ({
    category: group.category,
    label: effectCategoryLabel(group.category),
    items: group.items.map(desc => ({
      type: desc.type,
      icon: effectIcon(desc.type),
      label: effectLabel(desc),
      // Honest fallback: no per-effect description key yet -> name the
      // category the registry filed it under instead of an empty line.
      // te() guards the lookup: `t(key, fallback)` still logs
      // "[intlify] Not found '<key>'" for every described-as-category
      // effect, which buried real console errors in dev (R148).
      desc: (() => {
        const key = `tmcut.effects.${desc.type === 'eq-grade' ? 'eqGradeDesc' : `${desc.type}Desc`}`
        return te(key) ? t(key) : effectCategoryLabel(effectCategoryOf(desc))
      })(),
      active: activeEffectTypes.value.has(desc.type)
    }))
  }))
})

const matchedEffectCount = computed(() =>
  effectGroups.value.reduce((total, group) => total + group.items.length, 0)
)

// --- Filters: every lut3d preset the core registry ships -------------------
const lutPresets = computed(() => filterPresets(EFFECT_REGISTRY))

const filterCards = computed(() => {
  const needle = query.value.toLowerCase()
  return lutPresets.value
    .filter(preset => !needle
      || preset.toLowerCase().includes(needle)
      || filterLabel(preset).toLowerCase().includes(needle))
    .map(preset => ({
      preset,
      label: filterLabel(preset),
      active: activeLut.value === preset
    }))
})

// --- Transitions: fxCatalog categories + readable labels -------------------
// transitionsByCategory() keeps every xfade alias pair (zoom-in vs zoomin) as
// its own row, so tiles are keyed by `key`, never by the xfade name.
const transitionGroups = computed(() => {
  const groups: Array<{ category: string, items: Array<{ key: string, label: string }> }> = []
  if (TRANSITION_CATALOG.length) {
    // Normalize the catalog Record so a key the catalog does not mention yet
    // still renders (never hide a transition the core accepts).
    const buckets: Record<string, readonly FxTransitionEntry[]> = {}
    for (const [category, entries] of Object.entries(transitionsByCategory())) buckets[category] = entries
    for (const group of groupsFromCatalog(KNOWN_TRANSITIONS, buckets, [...TRANSITION_CATEGORIES, FX_OTHER_CATEGORY])) {
      groups.push({ category: group.category, items: group.items })
    }
  } else {
    for (const group of groupTransitions(KNOWN_TRANSITIONS)) {
      groups.push({ category: group.category, items: group.items })
    }
  }
  const needle = query.value.toLowerCase()
  return groups
    .map(group => ({
      category: group.category,
      label: transitionCategoryLabel(group.category),
      items: group.items
        .map(item => ({
          key: item.key,
          icon: TRANSITION_ICONS[item.key] || 'i-lucide-shapes',
          label: transitionLabel(item.key, item.label),
          active: activeTransition.value === item.key
        }))
        .filter(card => !needle || card.key.toLowerCase().includes(needle) || card.label.toLowerCase().includes(needle))
    }))
    .filter(group => group.items.length > 0)
})

const matchedTransitionCount = computed(() =>
  transitionGroups.value.reduce((total, group) => total + group.items.length, 0)
)

const emptyKey = computed(() => {
  if (fxTab.value === 'filters') return lutPresets.value.length ? 'noMatches' : 'noPresets'
  return 'noMatches'
})

function toastNeedClip() {
  toast.add({ title: t('tmcut.fxLib.needClip'), color: 'neutral' })
}

function handleToggleEffect(descType: string) {
  if (!selectedClipId.value || !canApplyVisual.value) {
    toastNeedClip()
    return
  }
  const desc = EFFECT_REGISTRY[descType as keyof typeof EFFECT_REGISTRY]
  if (!desc) return
  pushHistory()
  updateClip(selectedClipId.value, { effects: toggleEffectOnClip(selectedClip.value!.item.effects || [], desc) })
}

function handleToggleLut(preset: string) {
  if (!selectedClipId.value || !canApplyVisual.value) {
    toastNeedClip()
    return
  }
  const next = setLutPresetOnClip(selectedClip.value!.item.effects || [], preset)
  pushHistory()
  if (next === null) {
    // Toggle-off of the active preset: drop the lut3d entry entirely.
    updateClip(selectedClipId.value, { effects: clipEffects.value.filter(e => e.type !== 'lut3d') })
  } else {
    updateClip(selectedClipId.value, { effects: next })
  }
}

function handlePickTransition(type: string) {
  const clipId = selectedClipId.value
  if (!clipId || !canApplyTransition.value) {
    toastNeedClip()
    return
  }
  // Same tile again = remove the transition (matches the filter toggle feel).
  if (activeTransition.value === type) {
    clearClipTransition(clipId)
    return
  }
  const res = applyClipTransition(clipId, type, DEFAULT_TRANSITION_SEC)
  if (!res.ok) {
    toast.add({
      title: t('tmcut.fxLib.transitionRejected'),
      description: t(`tmcut.fxLib.${transitionReasonKey(res.reason)}`),
      color: 'warning'
    })
  }
}
</script>

<template>
  <!-- The library panel lives inside the media panel's own scroll area, so
       it must not set its own height/overflow (double scrollbars). -->
  <div class="flex flex-col min-h-0">
    <!-- Sub-tab bar (Effects / Transitions / Filters) — hidden when the
         host tab already fixes the category (R120 split tabs). -->
    <div v-if="showSubTabs" class="flex items-center gap-1 border-b border-neutral-300 dark:border-neutral-800 pb-1.5">
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
        :class="fxTab === 'effects' ? 'bg-primary/15 text-primary' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        @click="fxTab = 'effects'"
      >
        <UIcon name="i-lucide-sparkles" class="size-3" />
        {{ t('tmcut.tabs.effects') }}
      </button>
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
        :class="fxTab === 'transitions' ? 'bg-primary/15 text-primary' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        @click="fxTab = 'transitions'"
      >
        <UIcon name="i-lucide-shapes" class="size-3" />
        {{ t('tmcut.tabs.transitions') }}
      </button>
      <button
        type="button"
        class="flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
        :class="fxTab === 'filters' ? 'bg-primary/15 text-primary' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        @click="fxTab = 'filters'"
      >
        <UIcon name="i-lucide-palette" class="size-3" />
        {{ t('tmcut.tabs.filters') }}
      </button>
    </div>

    <!-- Context hint: which clip the library acts on -->
    <div
      class="mx-2 mt-2 px-2 py-1.5 rounded-md text-[10px] leading-snug flex items-start gap-1.5"
      :class="targetOk
        ? 'bg-primary/10 text-primary border border-primary/20'
        : 'bg-neutral-200/60 dark:bg-neutral-800/60 text-neutral-500 dark:text-neutral-400 border border-neutral-300 dark:border-neutral-800'"
    >
      <UIcon :name="targetOk ? 'i-lucide-mouse-pointer-click' : 'i-lucide-info'" class="size-3 shrink-0 mt-0.5" />
      <span>{{ t('tmcut.fxLib.targetHint', { clip: selectedClip?.item?.name || selectedClip?.item?.text || t('tmcut.fxLib.unnamedClip') }) }}</span>
    </div>

    <!-- Search (matches registry type + label, catalog key + label) -->
    <div class="px-2 pt-2">
      <UInput
        id="tmcut-fx-library-search"
        v-model="search"
        icon="i-lucide-search"
        size="xs"
        class="w-full"
        :placeholder="searchPlaceholder"
        :aria-label="searchPlaceholder"
      />
    </div>

    <!-- Category filter row (effects only; scrolls instead of overflowing) -->
    <div
      v-if="fxTab === 'effects' && categoryChips.length > 2"
      class="flex items-center gap-1 px-2 pt-2 overflow-x-auto"
    >
      <button
        v-for="chip in categoryChips"
        :key="chip"
        type="button"
        class="shrink-0 px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors cursor-pointer"
        :class="activeCategory === chip
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-neutral-300 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        @click="activeCategory = chip"
      >
        {{ chip === 'all' ? t('tmcut.fxLib.categoryAll') : effectCategoryLabel(chip) }}
      </button>
    </div>

    <div class="p-2 space-y-3 overflow-y-auto min-h-0">
      <!-- Effects: one grid per registry category -->
      <template v-if="fxTab === 'effects'">
        <div v-for="group in effectGroups" :key="group.category" class="space-y-1.5">
          <span class="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            {{ group.label }}
          </span>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="card in group.items"
              :key="card.type"
              type="button"
              class="flex flex-col gap-1.5 p-1.5 rounded-lg border text-left transition-colors cursor-pointer"
              :class="card.active
                ? 'border-primary bg-primary/10'
                : 'border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/60 hover:border-primary/60'"
              :title="card.desc"
              @click="handleToggleEffect(card.type)"
              @focusin="focusedKey = `effect:${card.type}`"
              @focusout="focusedKey = null"
            >
              <!-- Real demo frame: the scene through the effect's own CSS face,
                   scaled by the clip's params (registry-driven, see fxPreview). -->
              <TmcutFxThumb
                kind="effect"
                :type="card.type"
                :params="clipParamsFor(card.type)"
                :active="tileActive('effect', card.type, card.active)"
              />
              <div class="flex items-center gap-1.5 w-full px-0.5">
                <UIcon :name="card.icon" class="size-3.5 shrink-0" :class="card.active ? 'text-primary' : 'text-neutral-500 dark:text-neutral-400'" />
                <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-200 leading-tight truncate flex-1">{{ card.label }}</span>
                <UIcon v-if="card.active" name="i-lucide-check" class="size-3.5 text-primary shrink-0" />
              </div>
            </button>
          </div>
        </div>

        <!-- Honest empty state: registry/query produced no tile -->
        <div
          v-if="matchedEffectCount === 0"
          class="py-6 text-center text-[11px] text-neutral-500 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg"
        >
          {{ t(`tmcut.fxLib.${emptyKey}`) }}
        </div>
      </template>

      <!-- Filters: every lut3d preset from the registry enum -->
      <template v-else-if="fxTab === 'filters'">
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="card in filterCards"
            :key="card.preset"
            type="button"
            class="flex flex-col items-stretch gap-1.5 p-1.5 rounded-lg border text-left transition-colors cursor-pointer"
            :class="card.active
              ? 'border-primary bg-primary/10'
              : 'border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/60 hover:border-primary/60'"
            @click="handleToggleLut(card.preset)"
            @focusin="focusedKey = `filter:${card.preset}`"
            @focusout="focusedKey = null"
          >
            <!-- Real demo frame: the scene graded by this preset's export chain. -->
            <TmcutFxThumb
              kind="filter"
              :type="card.preset"
              :active="tileActive('filter', card.preset, card.active)"
            />
            <div class="flex items-center gap-1.5 px-0.5">
              <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-200 truncate flex-1">{{ card.label }}</span>
              <UIcon v-if="card.active" name="i-lucide-check" class="size-3.5 text-primary shrink-0" />
            </div>
          </button>
        </div>

        <div
          v-if="filterCards.length === 0"
          class="py-6 text-center text-[11px] text-neutral-500 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg"
        >
          {{ t(`tmcut.fxLib.${emptyKey}`) }}
        </div>
      </template>

      <!-- Transitions: grouped by fxCatalog category, readable labels -->
      <template v-else>
        <div v-for="group in transitionGroups" :key="group.category" class="space-y-1.5">
          <span class="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">
            {{ group.label }}
          </span>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="card in group.items"
              :key="card.key"
              type="button"
              class="flex flex-col gap-1.5 p-1.5 rounded-lg border text-left transition-colors cursor-pointer"
              :class="card.active
                ? 'border-primary bg-primary/10'
                : 'border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/60 hover:border-primary/60'"
              :title="t('tmcut.fxLib.transitionDefault')"
              @click="handlePickTransition(card.key)"
              @focusin="focusedKey = `transition:${card.key}`"
              @focusout="focusedKey = null"
            >
              <!-- A/B schematic: the outgoing frame's geometry morphing into the
                   incoming one, keyed by the same catalog the export reads. -->
              <TmcutFxThumb
                kind="transition"
                :type="card.key"
                :active="tileActive('transition', card.key, card.active)"
              />
              <div class="flex items-center gap-1.5 w-full px-0.5">
                <UIcon :name="card.icon" class="size-3.5 shrink-0" :class="card.active ? 'text-primary' : 'text-neutral-500 dark:text-neutral-400'" />
                <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-200 leading-tight truncate flex-1">{{ card.label }}</span>
                <UIcon v-if="card.active" name="i-lucide-check" class="size-3.5 text-primary shrink-0" />
              </div>
            </button>
          </div>
        </div>

        <div
          v-if="matchedTransitionCount === 0"
          class="py-6 text-center text-[11px] text-neutral-500 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg"
        >
          {{ t(`tmcut.fxLib.${emptyKey}`) }}
        </div>
      </template>
    </div>
  </div>
</template>
