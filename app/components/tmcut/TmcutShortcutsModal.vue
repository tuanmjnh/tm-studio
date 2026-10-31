<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { useTmcutUiPrefs } from '~/composables/useTmcutUiPrefs'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { shortcutTips } = useTmcutUiPrefs()

type Category = 'editing' | 'playback' | 'project' | 'ai'

interface ShortcutItem {
  id: string
  category: Category
  label: string
  desc: string
  keys: string[]
  /** Render "/" separators between key chips (e.g. Del / Backspace). */
  keySep: boolean
  /** Extra lowercase English search tokens matched by the filter. */
  keywords: string
  badge?: 'dynamic' | 'ai' | 'planned'
  wide?: boolean
}

const query = ref('')
const activeTab = ref<'all' | Category>('all')
const searchInput = ref<HTMLInputElement | null>(null)

const sectionMeta: Array<{ key: Category, icon: string }> = [
  { key: 'editing', icon: 'i-lucide-scissors' },
  { key: 'playback', icon: 'i-lucide-circle-play' },
  { key: 'project', icon: 'i-lucide-settings' },
  { key: 'ai', icon: 'i-lucide-sparkles' }
]

// Every documented action. Items marked "planned" (In/Out points, AI
// automation) are shown dimmed with a badge until the feature ships, so
// the action counter and the help stay truthful (§65.1).
const items = computed<ShortcutItem[]>(() => [
  {
    id: 'split', category: 'editing', label: t('tmcut.hotkeys.split'),
    desc: t('tmcut.hotkeys.desc.split'), keys: ['S'], keySep: false,
    keywords: 'split cut clip playhead'
  },
  {
    id: 'delete', category: 'editing', label: t('tmcut.hotkeys.delete'),
    desc: t('tmcut.hotkeys.desc.delete'), keys: ['Del', 'Backspace'], keySep: true,
    keywords: 'delete remove del backspace'
  },
  {
    id: 'copyPaste', category: 'editing', label: t('tmcut.hotkeys.copyPaste'),
    desc: t('tmcut.hotkeys.desc.copyPaste'), keys: ['Ctrl + C', 'Ctrl + V'], keySep: true,
    keywords: 'copy paste ctrl c ctrl v'
  },
  {
    id: 'duplicate', category: 'editing', label: t('tmcut.hotkeys.duplicate'),
    desc: t('tmcut.hotkeys.desc.duplicate'), keys: ['Ctrl + D'], keySep: false,
    keywords: 'duplicate clone ctrl d'
  },
  {
    id: 'rippleToggle', category: 'editing', label: t('tmcut.hotkeys.rippleToggle'),
    desc: t('tmcut.hotkeys.desc.rippleToggle'), keys: ['R'], keySep: false,
    keywords: 'ripple toggle gap gapless editing r', badge: 'dynamic', wide: true
  },
  {
    id: 'zoomScroll', category: 'editing', label: t('tmcut.hotkeys.zoomScroll'),
    desc: t('tmcut.hotkeys.desc.zoomScroll'), keys: ['Ctrl + Scroll'], keySep: false,
    keywords: 'zoom timeline scroll wheel ctrl cuộn phóng to thu nhỏ'
  },
  {
    id: 'zoomKeys', category: 'editing', label: t('tmcut.hotkeys.zoomKeys'),
    desc: t('tmcut.hotkeys.desc.zoomKeys'), keys: ['Ctrl + =', 'Ctrl + -'], keySep: true,
    keywords: 'zoom keyboard equals minus ctrl equal cộng trừ phím tắt phóng thu'
  },
  {
    id: 'snapMagnet', category: 'editing', label: t('tmcut.hotkeys.snapMagnet'),
    desc: t('tmcut.hotkeys.desc.snapMagnet'), keys: ['N'], keySep: false,
    keywords: 'snap magnet magnetic bám dính từ tính toggle n'
  },
  {
    id: 'addMarker', category: 'editing', label: t('tmcut.hotkeys.addMarker'),
    desc: t('tmcut.hotkeys.desc.addMarker'), keys: ['M'], keySep: false,
    keywords: 'marker bookmark ruler flag mốc đánh dấu m'
  },
  {
    id: 'trimKeyboard', category: 'editing', label: t('tmcut.hotkeys.trimKeyboard'),
    desc: t('tmcut.hotkeys.desc.trimKeyboard'), keys: ['Alt + [', 'Alt + ]'], keySep: true,
    keywords: 'trim cut in out edge playhead alt bracket cắt đầu đuôi'
  },
  {
    id: 'groupUngroup', category: 'editing', label: t('tmcut.hotkeys.groupUngroup'),
    desc: t('tmcut.hotkeys.desc.groupUngroup'), keys: ['Ctrl + G', 'Ctrl + Shift + G'], keySep: true,
    keywords: 'group ungroup nhóm gỡ nhóm ctrl g'
  },
  {
    id: 'linkUnlink', category: 'editing', label: t('tmcut.hotkeys.linkUnlink'),
    desc: t('tmcut.hotkeys.desc.linkUnlink'), keys: ['Ctrl + L', 'Ctrl + Shift + L'], keySep: true,
    keywords: 'link unlink pair audio video liên kết ctrl l'
  },
  {
    id: 'fadeToggle', category: 'editing', label: t('tmcut.hotkeys.fadeToggle'),
    desc: t('tmcut.hotkeys.desc.fadeToggle'), keys: ['Shift + D'], keySep: false,
    keywords: 'fade in out envelope audio volume shift d mờ nhạt rung cảm'
  },
  {
    id: 'playPause', category: 'playback', label: t('tmcut.hotkeys.playPause'),
    desc: t('tmcut.hotkeys.desc.playPause'), keys: ['Space'], keySep: false,
    keywords: 'play pause space spacebar'
  },
  {
    id: 'shuttle', category: 'playback', label: t('tmcut.hotkeys.shuttle'),
    desc: t('tmcut.hotkeys.desc.shuttle'), keys: ['J', 'K', 'L'], keySep: false,
    keywords: 'shuttle j k l rewind stop fast forward speed'
  },
  {
    id: 'step', category: 'playback', label: t('tmcut.hotkeys.step'),
    desc: t('tmcut.hotkeys.desc.step'), keys: ['←', '→'], keySep: false,
    keywords: 'step arrow left right second shift'
  },
  {
    id: 'jumpStartEnd', category: 'playback', label: t('tmcut.hotkeys.jumpStartEnd'),
    desc: t('tmcut.hotkeys.desc.jumpStartEnd'), keys: ['Home', 'End'], keySep: true,
    keywords: 'home end jump start beginning cuối đầu nhảy về đầu cuối'
  },
  {
    id: 'inOut', category: 'playback', label: t('tmcut.hotkeys.inOut'),
    desc: t('tmcut.hotkeys.desc.inOut'), keys: ['I', 'O'], keySep: true,
    keywords: 'in out point mark i o export zone range clear toggle'
  },
  {
    id: 'save', category: 'project', label: t('tmcut.hotkeys.save'),
    desc: t('tmcut.hotkeys.desc.save'), keys: ['Ctrl + S'], keySep: false,
    keywords: 'save flush disk flushdisksave ctrl s'
  },
  {
    id: 'export', category: 'project', label: t('tmcut.hotkeys.export'),
    desc: t('tmcut.hotkeys.desc.export'), keys: ['Ctrl + E'], keySep: false,
    keywords: 'export render modal ctrl e'
  },
  {
    id: 'undoRedo', category: 'project', label: t('tmcut.hotkeys.undoRedo'),
    desc: t('tmcut.hotkeys.desc.undoRedo'), keys: ['Ctrl + Z', 'Ctrl + Shift + Z'], keySep: true,
    keywords: 'undo redo history ctrl z ctrl shift z'
  },
  {
    id: 'help', category: 'project', label: t('tmcut.hotkeys.help'),
    desc: t('tmcut.hotkeys.desc.help'), keys: ['?', 'F1', 'Ctrl + K'], keySep: true,
    keywords: 'help shortcuts question f1 ctrl k'
  },
  {
    id: 'aiScript', category: 'ai', label: t('tmcut.hotkeys.aiScript'),
    desc: t('tmcut.hotkeys.desc.aiScript'), keys: ['Alt + A'], keySep: false,
    keywords: 'ai script scriptwriter storyboard prompt autocut alt a', badge: 'ai'
  },
  {
    id: 'smartMask', category: 'ai', label: t('tmcut.hotkeys.smartMask'),
    desc: t('tmcut.hotkeys.desc.smartMask'), keys: ['Alt + T'], keySep: false,
    keywords: 'mask tracking motion smart alt t', badge: 'planned'
  }
])

// Only non-planned items are counted as shipped default actions
const implementedCount = computed(() => items.value.filter(i => i.badge !== 'planned').length)

const tabs = computed(() => [
  { key: 'all' as const, label: t('tmcut.hotkeys.tabs.all', { count: implementedCount.value }) },
  { key: 'editing' as const, label: t('tmcut.hotkeys.tabs.editing') },
  { key: 'playback' as const, label: t('tmcut.hotkeys.tabs.playback') },
  { key: 'project' as const, label: t('tmcut.hotkeys.tabs.project') },
  { key: 'ai' as const, label: t('tmcut.hotkeys.tabs.ai') }
])

const labels = computed(() => ({
  editing: t('tmcut.hotkeys.sections.editing'),
  playback: t('tmcut.hotkeys.sections.playback'),
  project: t('tmcut.hotkeys.sections.project'),
  ai: t('tmcut.hotkeys.sections.ai')
}))

const tags = computed(() => ({
  editing: t('tmcut.hotkeys.sectionTags.editing'),
  playback: t('tmcut.hotkeys.sectionTags.playback'),
  project: t('tmcut.hotkeys.sectionTags.project')
}))

const visibleItems = computed(() => {
  const q = query.value.trim().toLowerCase()
  return items.value.filter((item) => {
    if (activeTab.value !== 'all' && item.category !== activeTab.value) return false
    if (!q) return true
    return `${item.label} ${item.desc} ${item.keywords}`.toLowerCase().includes(q)
  })
})

// Sections with no visible item are hidden entirely (design: applyFilter)
const sections = computed(() => sectionMeta
  .map(meta => ({ ...meta, items: visibleItems.value.filter(item => item.category === meta.key) }))
  .filter(section => section.items.length > 0))

const noResults = computed(() => visibleItems.value.length === 0)

function badgeLabel(badge: NonNullable<ShortcutItem['badge']>): string {
  if (badge === 'dynamic') return t('tmcut.hotkeys.badges.dynamic')
  if (badge === 'ai') return t('tmcut.hotkeys.badges.ai')
  return t('tmcut.hotkeys.badges.planned')
}

function focusSearch(select = false) {
  if (!searchInput.value) return
  searchInput.value.focus()
  if (select) searchInput.value.select()
}

// Ctrl+K focuses the search field while the modal is open (the timeline
// handler opens the modal when it is closed)
function onGlobalKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    focusSearch(true)
  }
}

watch(open, async (isOpen) => {
  if (isOpen) {
    await nextTick()
    focusSearch()
    window.addEventListener('keydown', onGlobalKeydown)
  } else {
    window.removeEventListener('keydown', onGlobalKeydown)
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'w-[calc(100%-2rem)] max-w-4xl' }">
    <template #content>
      <div class="flex flex-col max-h-[85vh] overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 shadow-2xl">
        <!-- HEADER: title + version badge + close -->
        <div class="px-5 py-4 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-800 flex flex-col gap-3 shrink-0">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-7 h-7 rounded bg-primary/15 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-keyboard" class="size-4 text-primary" />
              </div>
              <div class="flex items-baseline gap-2 min-w-0">
                <h1 class="text-base font-bold text-primary truncate">
                  {{ t('tmcut.hotkeys.title') }}
                </h1>
                <span class="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-primary/80 font-mono text-[10px] shrink-0">
                  {{ t('tmcut.hotkeys.versionBadge') }}
                </span>
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              :title="t('tmcut.hotkeys.closeAria')"
              @click="open = false"
            />
          </div>

          <!-- SEARCH + live filter + action counter -->
          <div class="flex items-center gap-3">
            <div class="relative flex-1 min-w-0">
              <UIcon
                name="i-lucide-search"
                class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-neutral-500 pointer-events-none"
              />
              <input
                id="tmcut-shortcuts-search"
                ref="searchInput"
                v-model="query"
                type="text"
                class="w-full h-9 pl-9 pr-16 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 text-sm text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:border-primary/60"
                :placeholder="t('tmcut.hotkeys.searchPlaceholder')"
                :aria-label="t('tmcut.hotkeys.searchPlaceholder')"
              >
              <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
                <kbd class="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 font-mono text-[10px]">Ctrl</kbd>
                <kbd class="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 font-mono text-[10px]">K</kbd>
              </div>
            </div>
            <div
              class="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-200/60 dark:bg-neutral-800/60 text-[10px] font-mono text-neutral-500 dark:text-neutral-400 shrink-0"
            >
              <span class="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
              <span>{{ t('tmcut.hotkeys.defaultActions', { count: implementedCount }) }}</span>
            </div>
          </div>

          <!-- CATEGORY TABS -->
          <div class="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1">
            <button
              v-for="tab in tabs"
              :key="tab.key"
              type="button"
              class="px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors"
              :class="activeTab === tab.key
                ? 'bg-primary/15 text-primary border border-primary/40'
                : 'bg-neutral-200/70 dark:bg-neutral-800/70 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 border border-transparent'"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <!-- BODY: scrollable shortcut matrix -->
        <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
          <section v-for="section in sections" :key="section.key">
            <div class="flex items-center justify-between pb-2">
              <div class="flex items-center gap-2 text-primary min-w-0">
                <UIcon :name="section.icon" class="size-4 shrink-0" />
                <h2 class="text-xs font-semibold uppercase tracking-wide truncate">
                  {{ labels[section.key] }}
                </h2>
              </div>
              <span
                v-if="section.key === 'ai'"
                class="px-1.5 py-0.5 rounded bg-primary/15 text-primary font-mono text-[10px] shrink-0"
              >
                {{ t('tmcut.hotkeys.badges.ai') }}
              </span>
              <span v-else class="font-mono text-[10px] text-neutral-500 dark:text-neutral-600 shrink-0">
                {{ tags[section.key as 'editing' | 'playback' | 'project'] }}
              </span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1">
              <div
                v-for="item in section.items"
                :key="item.id"
                class="flex items-center justify-between gap-3 p-3 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200/70 dark:hover:bg-neutral-800/70 transition-colors"
                :class="item.wide && 'md:col-span-2'"
              >
                <div class="flex flex-col min-w-0">
                  <div class="flex items-center gap-1.5 min-w-0">
                    <span class="text-sm text-neutral-800 dark:text-neutral-100 font-medium truncate">{{ item.label }}</span>
                    <span
                      v-if="item.badge"
                      class="px-1.5 py-0.5 rounded text-[10px] font-mono shrink-0"
                      :class="item.badge === 'planned'
                        ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-500 border border-neutral-400 dark:border-neutral-700'
                        : 'bg-secondary/15 text-secondary border border-secondary/40'"
                    >
                      {{ badgeLabel(item.badge) }}
                    </span>
                  </div>
                  <span class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">{{ item.desc }}</span>
                </div>
                <div class="flex items-center gap-1 shrink-0" :class="item.badge === 'planned' && 'opacity-50'">
                  <template v-for="(key, ki) in item.keys" :key="key">
                    <span v-if="ki > 0 && item.keySep" class="text-neutral-500 dark:text-neutral-600 text-[10px]">/</span>
                    <kbd
                      class="px-2 py-1 rounded bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 font-mono text-[11px] text-primary shadow-sm"
                    >
                      {{ key }}
                    </kbd>
                  </template>
                </div>
              </div>
            </div>
          </section>

          <!-- EMPTY STATE -->
          <div v-if="noResults" class="py-12 flex flex-col items-center text-center">
            <UIcon name="i-lucide-search-x" class="size-9 text-neutral-500 dark:text-neutral-600 mb-2" />
            <p class="text-sm font-semibold text-neutral-700 dark:text-neutral-200">
              {{ t('tmcut.hotkeys.emptyTitle') }}
            </p>
            <p class="text-xs text-neutral-500 mt-1">
              {{ t('tmcut.hotkeys.emptyHint') }}
            </p>
          </div>
        </div>

        <!-- FOOTER: toolbar tips toggle + language note + close -->
        <div
          class="px-5 py-3 bg-neutral-100 dark:bg-neutral-900 border-t border-neutral-300 dark:border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0"
        >
          <div
            class="flex items-center gap-2 cursor-pointer select-none"
            @click="shortcutTips = !shortcutTips"
          >
            <UCheckbox
              v-model="shortcutTips"
              :aria-label="t('tmcut.hotkeys.tipsToggle')"
              size="sm"
              @click.stop
            />
            <span class="text-xs text-neutral-600 dark:text-neutral-300">{{ t('tmcut.hotkeys.tipsToggle') }}</span>
          </div>
          <div class="flex items-center gap-4">
            <span class="hidden md:inline font-mono text-[10px] text-neutral-500">
              {{ t('tmcut.hotkeys.langNote') }}
            </span>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              @click="open = false"
            >
              {{ t('tmcut.hotkeys.close') }}
              <span class="font-mono text-[10px] opacity-70">(Esc)</span>
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
