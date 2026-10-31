<script setup lang="ts">
import type { TmcutProject } from '~/composables/useTmcutProject'
import type { DropdownMenuItem } from '@nuxt/ui'
import { canvasFpsValue, ratioLabel } from '~/utils/tmcut/canvas'
import { TmcutBadge, TmcutButton } from '#components'

const { t, locale } = useI18n()
const router = useRouter()
const { projects, createProject, deleteProject, renameProject, duplicateProject, togglePinProject, refreshProjects } = useTmcutProject()

onMounted(() => {
  refreshProjects()
})

// ===== Create actions =====
function handleNewProject() {
  const proj = createProject(t('tmcut.newProject'))
  router.push(`/tmcut/editor?project=${proj.id}`)
}

// ===== Project helpers =====
function aspectKey(project: TmcutProject): 'vertical' | 'horizontal' | 'square' {
  const w = project.canvas?.width || 1920
  const h = project.canvas?.height || 1080
  if (h > w) return 'vertical'
  if (w > h) return 'horizontal'
  return 'square'
}

function fmtDuration(project: TmcutProject): string {
  const totalSec = Math.round((project.durationMs || 0) / 1000)
  if (totalSec <= 0) return ''
  const hrs = Math.floor(totalSec / 3600)
  const min = Math.floor((totalSec % 3600) / 60)
  const sec = totalSec % 60
  const mm = String(min).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`
}

function editedLabel(project: TmcutProject): string {
  const date = new Date(project.updated_at || project.created_at)
  const formatted = Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
  return t('tmcut.home.editedAt', { date: formatted })
}

// ===== Quick Presets =====
// Labels/descs store i18n keys; the template resolves them with t() so the
// cards re-translate when the locale changes (and are never double-translated).
const quickPresets = [
  { id: 'vertical', width: 1080, height: 1920, fps: 30, label: 'tmcut.home.actionVertical', desc: 'tmcut.home.actionVerticalDesc', icon: 'i-lucide-smartphone', color: 'primary' },
  { id: 'horizontal', width: 1920, height: 1080, fps: 30, label: 'tmcut.home.actionHorizontal', desc: 'tmcut.home.actionHorizontalDesc', icon: 'i-lucide-monitor', color: 'secondary' }
]

function applyQuickPreset(preset: typeof quickPresets[0]) {
  const project = createProject(t('tmcut.newProject'), { width: preset.width, height: preset.height, fps: { numerator: preset.fps, denominator: 1 } })
  router.push(`/tmcut/editor?project=${project.id}`)
}

// ===== Template Presets =====
const templatePresets = computed(() => [
  { id: 'preset-shorts-vertical', name: t('tmcut.presets.shortsName'), canvas: '1080x1920', fps: 30, icon: 'i-lucide-smartphone', aspect: '9:16', duration: '15-60s' },
  { id: 'preset-youtube-horizontal', name: t('tmcut.presets.youtubeName'), canvas: '1920x1080', fps: 30, icon: 'i-lucide-monitor', aspect: '16:9', duration: '5-15min' },
  { id: 'preset-instagram-feed', name: t('tmcut.presets.instagramName'), canvas: '1080x1080', fps: 30, icon: 'i-lucide-square', aspect: '1:1', duration: '30-60s' }
])

function applyTemplatePreset(preset: { canvas: string, name: string, fps: number }) {
  const parts = preset.canvas.split('x').map(Number)
  const project = createProject(`${t('tmcut.project')} ${preset.name}`, { width: parts[0] || 1920, height: parts[1] || 1080, fps: { numerator: preset.fps, denominator: 1 } })
  router.push(`/tmcut/editor?project=${project.id}`)
}

// ===== Filters & Sort =====
type AspectFilter = 'all' | 'vertical' | 'horizontal' | 'square'
type SortKey = 'recent' | 'opened' | 'name' | 'duration'

const search = ref('')
const aspectFilter = ref<AspectFilter>('all')
const sortBy = ref<SortKey>('recent')
const viewMode = ref<'grid' | 'list'>('grid')

const aspectCounts = computed(() => {
  const counts = { vertical: 0, horizontal: 0, square: 0 }
  for (const project of projects.value) counts[aspectKey(project)]++
  return counts
})

const filterOptions = computed(() => [
  { value: 'all', label: t('tmcut.home.filterAll'), count: projects.value.length, icon: 'i-lucide-grid' },
  { value: 'vertical', label: t('tmcut.home.filterVertical'), count: aspectCounts.value.vertical, icon: 'i-lucide-smartphone' },
  { value: 'horizontal', label: t('tmcut.home.filterHorizontal'), count: aspectCounts.value.horizontal, icon: 'i-lucide-monitor' },
  { value: 'square', label: t('tmcut.home.filterSquare'), count: aspectCounts.value.square, icon: 'i-lucide-square' }
])

const sortOptions = [
  { value: 'recent', label: t('tmcut.home.sortRecent'), icon: 'i-lucide-clock' },
  { value: 'opened', label: t('tmcut.home.sortOpened'), icon: 'i-lucide-mouse-pointer-click' },
  { value: 'name', label: t('tmcut.home.sortName'), icon: 'i-lucide-sort-asc' },
  { value: 'duration', label: t('tmcut.home.sortDuration'), icon: 'i-lucide-timer' }
]

const filteredProjects = computed(() => {
  const q = search.value.trim().toLowerCase()
  let list = projects.value.filter((p) => {
    if (q && !(p.name || '').toLowerCase().includes(q)) return false
    if (aspectFilter.value !== 'all' && aspectKey(p) !== aspectFilter.value) return false
    return true
  })
  const rank = (p: TmcutProject) => (p.pinned ? 0 : 1)
  const openedAt = (p: TmcutProject) => new Date(p.lastOpenedAt || p.updated_at || p.created_at).getTime()
  list = [...list]
  if (sortBy.value === 'name') list.sort((a, b) => rank(a) - rank(b) || (a.name || '').localeCompare(b.name || ''))
  else if (sortBy.value === 'duration') list.sort((a, b) => rank(a) - rank(b) || (b.durationMs || 0) - (a.durationMs || 0))
  else if (sortBy.value === 'opened') list.sort((a, b) => rank(a) - rank(b) || openedAt(b) - openedAt(a))
  else list.sort((a, b) => rank(a) - rank(b) || new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime())
  return list
})

// ===== Modals =====
const renameModalOpen = ref(false)
const renameTarget = ref<TmcutProject | null>(null)
const renameValue = ref('')
const deleteModalOpen = ref(false)
const deleteTarget = ref<TmcutProject | null>(null)

function openRename(project: TmcutProject) {
  renameTarget.value = project
  renameValue.value = project.name || ''
  renameModalOpen.value = true
}
function confirmRename() {
  renameModalOpen.value = false
  if (!renameTarget.value) return
  const name = renameValue.value.trim()
  if (!name) return
  void renameProject(renameTarget.value.id, name)
}
function openDelete(project: TmcutProject) {
  deleteTarget.value = project
  deleteModalOpen.value = true
}
function confirmDelete() {
  const target = deleteTarget.value
  deleteModalOpen.value = false
  if (target) void deleteProject(target.id)
}
function handleDuplicate(project: TmcutProject) {
  duplicateProject(project.id, t('tmcut.home.dupSuffix'))
}

function cardMenuItems(project: TmcutProject): DropdownMenuItem[] {
  return [
    { label: t('tmcut.home.menuOpen'), icon: 'i-lucide-play', onSelect: () => router.push(`/tmcut/editor?project=${project.id}`) },
    { label: project.pinned ? t('tmcut.home.menuUnpin') : t('tmcut.home.menuPin'), icon: project.pinned ? 'i-lucide-pin-off' : 'i-lucide-pin', onSelect: () => void togglePinProject(project.id) },
    { label: t('tmcut.home.menuRename'), icon: 'i-lucide-pencil', onSelect: () => openRename(project) },
    { label: t('tmcut.home.menuDuplicate'), icon: 'i-lucide-copy', onSelect: () => handleDuplicate(project) },
    { type: 'separator' },
    { label: t('tmcut.home.menuDelete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => openDelete(project) }
  ]
}
</script>

<template>
  <BasePage id="tmcut-index" :title="t('nav.tmcut')" :description="t('tmcut.subtitle')">
    <template #right>
      <div class="flex items-center gap-2">
        <TmcutButton
          icon="i-lucide-plus"
          variant="solid"
          size="lg"
          @click="handleNewProject"
        >
          {{ t('tmcut.newProject') }}
        </TmcutButton>
      </div>
    </template>

    <div class="space-y-6">
      <!-- Hero Section -->
      <div class="relative overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-primary-50 via-white to-secondary-50 dark:from-primary-900/20 dark:via-neutral-950 dark:to-secondary-900/20 p-8 shadow-xl">
        <div class="absolute inset-0 overflow-hidden pointer-events-none">
          <div class="absolute -right-24 -top-24 w-72 h-72 bg-primary-500/10 rounded-full blur-3xl" />
          <div class="absolute left-1/4 -bottom-24 w-64 h-64 bg-secondary-500/10 rounded-full blur-3xl" />
          <div class="absolute right-1/4 top-1/3 w-48 h-48 bg-primary-500/5 rounded-full blur-2xl" />
        </div>

        <div class="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div class="min-w-0">
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-flex items-center justify-center w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span class="text-xs uppercase tracking-wider text-primary-600 dark:text-primary-400 font-semibold">
                {{ t('tmcut.home.heroEyebrow') }}
              </span>
            </div>
            <h1 class="text-3xl lg:text-4xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100 max-w-2xl">
              {{ t('tmcut.home.heroTitle') }}
            </h1>
            <p class="text-base lg:text-lg text-neutral-600 dark:text-neutral-400 mt-2 max-w-2xl leading-relaxed">
              {{ t('tmcut.home.heroDesc') }}
            </p>
          </div>

          <!-- The single primary CTA lives in the navbar #right slot: a hero
               button with the same label two hundred pixels away duplicated
               the action without adding context. -->
        </div>

        <!-- Quick Actions Dock -->
        <div class="relative z-10 mt-8 pt-6 border-t border-neutral-200/50 dark:border-neutral-800/50">
          <div class="flex items-center justify-between mb-4">
            <span class="text-xs uppercase tracking-wider text-neutral-500 font-semibold">
              {{ t('tmcut.home.quickTools') }}
            </span>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
            <!-- Import Video -->
            <button type="button" class="group relative p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md transition-all duration-200 text-left cursor-pointer flex flex-col items-start">
              <div class="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-500 group-hover:bg-primary-500 group-hover:text-white transition-colors">
                <UIcon name="i-lucide-video" class="w-5 h-5" />
              </div>
              <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mt-3">{{ t('tmcut.home.actionImport') }}</span>
              <span class="text-xs text-neutral-500 mt-1">{{ t('tmcut.home.actionImportDesc') }}</span>
            </button>

            <!-- Quick Presets -->
            <button
              v-for="preset in quickPresets"
              :key="preset.id"
              type="button"
              class="group relative p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md transition-all duration-200 text-left cursor-pointer flex flex-col items-start"
              @click="applyQuickPreset(preset)"
            >
              <div :class="['w-10 h-10 rounded-lg flex items-center justify-center transition-colors', 'group-hover:bg-' + preset.color + '-500 group-hover:text-white', 'bg-' + preset.color + '-500/10 text-' + preset.color + '-500']">
                <UIcon :name="preset.icon" class="w-5 h-5" />
              </div>
              <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mt-3">{{ t(preset.label) }}</span>
              <span class="text-xs text-neutral-500 mt-1">{{ t(preset.desc) }}</span>
            </button>

            <!-- AutoCut -->
            <button type="button" class="group relative p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm hover:border-secondary-300 dark:hover:border-secondary-700 hover:shadow-md transition-all duration-200 text-left cursor-pointer flex flex-col items-start" @click="router.push('/tmcut/autocut')">
              <div class="w-10 h-10 rounded-lg bg-secondary-500/10 flex items-center justify-center text-secondary-500 group-hover:bg-secondary-500 group-hover:text-white transition-colors">
                <UIcon name="i-lucide-sparkles" class="w-5 h-5" />
              </div>
              <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mt-3">{{ t('tmcut.shortcuts.autocutTitle') }}</span>
              <span class="text-xs text-neutral-500 mt-1">{{ t('tmcut.shortcuts.autocutDesc') }}</span>
            </button>

            <!-- Templates -->
            <button type="button" class="group relative p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-md transition-all duration-200 text-left cursor-pointer flex flex-col items-start" @click="router.push('/tmcut/templates')">
              <div class="w-10 h-10 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-500 group-hover:bg-primary-500 group-hover:text-white transition-colors">
                <UIcon name="i-lucide-layout-template" class="w-5 h-5" />
              </div>
              <span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mt-3">{{ t('nav.tmcut_templates') }}</span>
              <span class="text-xs text-neutral-500 mt-1">{{ t('tmcut.templatesDesc') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Search & Filters Bar. The filter group is ~600px wide, so it only
           shares a row with the search field from 1280px up; below that the
           bar stacks. (At lg it used to sit side-by-side and the sort options
           and view toggles fell off the right edge.) -->
      <div class="flex flex-col xl:flex-row items-center justify-between gap-4">
        <div class="relative w-full xl:w-80">
          <UIcon name="i-lucide-search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            id="tmcut-project-search"
            v-model="search"
            name="tmcut-project-search"
            type="text"
            :aria-label="t('tmcut.home.searchPlaceholder')"
            :placeholder="t('tmcut.home.searchPlaceholder')"
            class="w-full bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
          >
        </div>

        <div class="flex flex-wrap items-center gap-2 w-full xl:w-auto justify-between xl:justify-end">
          <TmcutSegmentedControl
            v-model="aspectFilter"
            :options="filterOptions"
            :label="t('tmcut.home.filterLabel')"
            size="sm"
          />
          <TmcutSegmentedControl
            v-model="sortBy"
            :options="sortOptions"
            :label="t('tmcut.home.sortLabel')"
            size="sm"
          />
          <div class="flex items-center bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl p-0.5">
            <TmcutButton
              size="xs"
              icon="i-lucide-grid-2x2"
              :aria-label="t('tmcut.home.viewGrid')"
              :variant="viewMode === 'grid' ? 'soft' : 'ghost'"
              :color="viewMode === 'grid' ? 'primary' : 'neutral'"
              @click="viewMode = 'grid'"
            />
            <TmcutButton
              size="xs"
              icon="i-lucide-list"
              :aria-label="t('tmcut.home.viewList')"
              :variant="viewMode === 'list' ? 'soft' : 'ghost'"
              :color="viewMode === 'list' ? 'primary' : 'neutral'"
              @click="viewMode = 'list'"
            />
          </div>
        </div>
      </div>

      <!-- Projects Grid -->
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <h2 class="text-xl font-bold text-neutral-900 dark:text-neutral-100">
              {{ t('tmcut.recentProjects') }}
            </h2>
          </div>
        </div>

        <div v-if="projects.length === 0" class="text-center py-16 rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50">
          <UIcon name="i-lucide-film" class="w-16 h-16 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" />
          <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
            {{ t('tmcut.noProjects') }}
          </h3>
          <p class="text-sm text-neutral-500 max-w-sm mx-auto mb-6">
            {{ t('tmcut.noProjectsDesc') }}
          </p>
          <TmcutButton icon="i-lucide-plus" variant="solid" @click="handleNewProject">
            {{ t('tmcut.createFirstProject') }}
          </TmcutButton>
        </div>

        <div v-else-if="filteredProjects.length === 0" class="text-center py-12 text-neutral-500">
          {{ t('tmcut.home.noMatches') }}
        </div>

        <!-- Grid View -->
        <div v-else-if="viewMode === 'grid'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div
            v-for="project in filteredProjects"
            :key="project.id"
            class="group relative bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden hover:border-primary-300 dark:hover:border-primary-700 hover:shadow-xl transition-all duration-300 hover:-translate-y-1 flex flex-col"
            @click="router.push(`/tmcut/editor?project=${project.id}`)"
          >
            <div class="aspect-video bg-neutral-100 dark:bg-neutral-800 relative overflow-hidden">
              <img v-if="project.cover" :src="project.cover" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105">
              <UIcon v-else name="i-lucide-film" class="w-12 h-12 text-neutral-300 dark:text-neutral-600 absolute inset-0 m-auto" />

              <!-- Badges -->
              <div class="absolute bottom-3 left-3 flex items-center gap-1.5">
                <TmcutBadge variant="neutral" size="xs" class="font-mono">
                  {{ ratioLabel(project.canvas?.width || 1920, project.canvas?.height || 1080) }}
                </TmcutBadge>
                <TmcutBadge
                  v-if="project.canvas?.width && project.canvas.width >= 1920"
                  variant="primary"
                  size="xs"
                  class="font-semibold"
                >
                  {{ project.canvas.width >= 3840 ? '4K' : project.canvas.width >= 2560 ? '1440p' : '1080p' }}
                </TmcutBadge>
              </div>

              <span v-if="fmtDuration(project)" class="absolute bottom-3 right-3 px-2 py-1 rounded bg-black/70 text-white backdrop-blur text-xs font-mono">
                {{ fmtDuration(project) }}
              </span>

              <TmcutBadge
                v-if="project.pinned"
                variant="primary"
                size="xs"
                class="absolute top-3 right-3"
                :dot="true"
                dot-color="#f59e0b"
              >
                {{ t('tmcut.home.pinned') }}
              </TmcutBadge>

              <!-- Play Overlay -->
              <div class="absolute inset-0 bg-primary-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                <div class="w-14 h-14 rounded-full bg-primary-500 text-white flex items-center justify-center shadow-xl transform group-hover:scale-105 transition-transform">
                  <UIcon name="i-lucide-play" class="w-6 h-6 ml-1" />
                </div>
              </div>
            </div>

            <div class="p-4 flex-1 flex flex-col justify-between">
              <div class="flex items-start justify-between gap-2">
                <h4 class="font-semibold text-sm text-neutral-900 dark:text-neutral-100 truncate flex-1 pr-2">
                  {{ project.name }}
                </h4>
                <UDropdownMenu :items="cardMenuItems(project)" :content="{ align: 'end' }">
                  <TmcutButton
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-more-vertical"
                    color="neutral"
                    :aria-label="t('tmcut.home.menuLabel')"
                    @click.stop
                  />
                </UDropdownMenu>
              </div>
              <p class="text-xs text-neutral-500 mt-2 flex items-center gap-1.5">
                <span class="truncate">{{ editedLabel(project) }}</span>
              </p>
              <p v-if="project.canvas?.fps" class="text-xs font-mono text-neutral-400 mt-1">
                {{ canvasFpsValue(project.canvas) }}fps · {{ project.canvas.width }}×{{ project.canvas.height }}
              </p>
            </div>
          </div>
        </div>

        <!-- List View -->
        <div v-else class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl overflow-hidden divide-y divide-neutral-200/50 dark:divide-neutral-800/50">
          <div
            v-for="project in filteredProjects"
            :key="project.id"
            class="flex items-center gap-4 px-5 py-4 bg-white/50 dark:bg-neutral-900/50 hover:bg-primary-50/50 dark:hover:bg-primary-900/10 transition-colors cursor-pointer"
            @click="router.push(`/tmcut/editor?project=${project.id}`)"
          >
            <UIcon name="i-lucide-film" class="w-5 h-5 text-neutral-400 shrink-0" />
            <TmcutBadge
              v-if="project.pinned"
              variant="primary"
              size="xs"
              :dot="true"
              dot-color="#f59e0b"
              class="shrink-0"
            />
            <span class="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate flex-1">{{ project.name }}</span>
            <TmcutBadge variant="neutral" size="xs" class="font-mono shrink-0">
              {{ ratioLabel(project.canvas?.width || 1920, project.canvas?.height || 1080) }}
            </TmcutBadge>
            <span v-if="fmtDuration(project)" class="text-xs font-mono text-neutral-400 w-16 text-right shrink-0">{{ fmtDuration(project) }}</span>
            <span class="text-xs text-neutral-500 w-40 text-right shrink-0 hidden lg:block">{{ editedLabel(project) }}</span>
            <UDropdownMenu :items="cardMenuItems(project)" :content="{ align: 'end' }">
              <TmcutButton
                variant="ghost"
                size="xs"
                icon="i-lucide-more-vertical"
                color="neutral"
                :aria-label="t('tmcut.home.menuLabel')"
                @click.stop
              />
            </UDropdownMenu>
          </div>
        </div>
      </div>

      <!-- Template Presets Strip -->
      <div class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-flame" class="w-5 h-5 text-primary-500" />
              <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {{ t('tmcut.presetSizes') }}
              </h3>
            </div>
            <p class="text-xs text-neutral-500 mt-0.5">
              {{ t('tmcut.templatesDesc') }}
            </p>
          </div>
          <TmcutButton
            to="/tmcut/templates"
            icon="i-lucide-chevron-right"
            size="xs"
            variant="ghost"
            color="primary"
            trailing
          >
            {{ t('tmcut.home.templatesLink') }}
          </TmcutButton>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <button
            v-for="preset in templatePresets"
            :key="preset.id"
            type="button"
            class="group flex items-center gap-4 p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:border-primary-300 dark:hover:border-primary-700 transition-all duration-200 text-left cursor-pointer"
            @click="applyTemplatePreset(preset)"
          >
            <div class="w-12 h-12 rounded-xl bg-primary-500/10 flex items-center justify-center text-primary-500 group-hover:bg-primary-500 group-hover:text-white transition-colors shrink-0">
              <UIcon :name="preset.icon" class="w-6 h-6" />
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                {{ preset.name }}
              </p>
              <div class="flex items-center gap-3 mt-1">
                <TmcutBadge variant="primary" size="xs" class="font-mono">
                  {{ preset.aspect }}
                </TmcutBadge>
                <TmcutBadge variant="neutral" size="xs" class="font-mono">
                  {{ preset.duration }}
                </TmcutBadge>
              </div>
            </div>
            <TmcutButton
              size="xs"
              color="primary"
              variant="soft"
              class="shrink-0 group-hover:bg-primary-500 group-hover:text-white transition-colors"
            >
              {{ t('tmcut.apply') }}
            </TmcutButton>
          </button>
        </div>
      </div>

      <!-- Modals -->
      <LazyTmcutModal v-model:open="renameModalOpen" :title="t('tmcut.home.renameTitle')">
        <template #body>
          <input
            id="tmcut-home-rename"
            v-model="renameValue"
            :aria-label="t('tmcut.home.renameTitle')"
            type="text"
            :placeholder="t('tmcut.home.renameTitle')"
            class="w-full border border-neutral-200 dark:border-neutral-800 rounded-xl p-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
            @keydown.enter="confirmRename"
          >
        </template>
        <template #footer>
          <TmcutButton variant="ghost" @click="renameModalOpen = false">
            {{ t('global.cancel') }}
          </TmcutButton>
          <TmcutButton variant="solid" @click="confirmRename">
            {{ t('global.save') }}
          </TmcutButton>
        </template>
      </LazyTmcutModal>

      <LazyTmcutModal v-model:open="deleteModalOpen" :title="t('tmcut.home.deleteTitle')" color="error">
        <template #body>
          <p class="text-sm text-neutral-500">
            {{ t('tmcut.home.deleteDesc', { name: deleteTarget?.name || '' }) }}
          </p>
        </template>
        <template #footer>
          <TmcutButton variant="ghost" @click="deleteModalOpen = false">
            {{ t('global.cancel') }}
          </TmcutButton>
          <TmcutButton variant="destructive" @click="confirmDelete">
            {{ t('tmcut.home.deleteConfirm') }}
          </TmcutButton>
        </template>
      </LazyTmcutModal>
    </div>
  </BasePage>
</template>
