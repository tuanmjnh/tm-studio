<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useToast } from '#imports'
import { TmcutButton, TmcutSegmentedControl, TmcutFilterChips } from '#components'
import type { TmcutTemplate } from '~/types/tmcut'

const { t } = useI18n()
const router = useRouter()
const toast = useToast()
const { createProject } = useTmcutProject()
const {
  filteredTemplates,
  categoryCounts,
  industryCounts,
  selectedCategory: composableSelectedCategory,
  selectedIndustry: composableSelectedIndustry,
  selectedAspectRatio: composableSelectedAspectRatio,
  searchQuery,
  createProjectFromTemplate,
  deleteUserTemplate,
  exportTemplate,
  importTemplates,
  templateAssetReadiness,
  ticksToSeconds: tts
} = useTmcutTemplates()

// Local filter state for UI components (arrays for multi-select components).
// 'all' is a real selection here: starting empty left the "All Categories"
// chip unlit while the grid was in fact showing everything.
const selectedCategory = ref<string[]>(['all'])
const selectedIndustry = ref<string[]>(['all'])
const selectedAspectRatio = ref<string>('all')

// Sync with composable
watch(composableSelectedCategory, (val) => {
  selectedCategory.value = val ? [val] : ['all']
})
watch(selectedCategory, (val) => {
  composableSelectedCategory.value = val[0] || 'all'
})
watch(composableSelectedIndustry, (val) => {
  selectedIndustry.value = val ? [val] : ['all']
})
watch(selectedIndustry, (val) => {
  composableSelectedIndustry.value = val[0] || 'all'
})
watch(composableSelectedAspectRatio, (val) => {
  selectedAspectRatio.value = val
})
watch(selectedAspectRatio, (val) => {
  composableSelectedAspectRatio.value = val
})
const assetCenter = useTmcutAssetCenter()

// AI template builder modal
const aiTemplateModalOpen = ref(false)

// Library tabs
const libraryTab = ref<'timeline' | 'studio' | 'factory' | 'marketplace' | 'html-video'>('timeline')

// Modal customization state
const customizeModalOpen = ref(false)
const activeTemplate = ref<TmcutTemplate | null>(null)
const projectNameInput = ref('')
const placeholderTextInputs = ref<Record<string, string>>({})
const isCreating = ref(false)

// Delete confirm modal
const deleteModalOpen = ref(false)
const targetDeleteId = ref<string | null>(null)
const targetDeleteName = ref<string | null>(null)

const categories = computed(() => [
  { value: 'all', label: t('tmcut.templateLibrary.allCategories'), count: categoryCounts.value.all || 0, icon: 'i-lucide-grid' },
  { value: 'intro', label: t('tmcut.templateLibrary.catIntro'), count: categoryCounts.value.intro || 0, icon: 'i-lucide-play' },
  { value: 'outro', label: t('tmcut.templateLibrary.catOutro'), count: categoryCounts.value.outro || 0, icon: 'i-lucide-stop-circle' },
  { value: 'split-screen', label: t('tmcut.templateLibrary.catSplit'), count: categoryCounts.value['split-screen'] || 0, icon: 'i-lucide-layout-grid' },
  { value: 'promo', label: t('tmcut.templateLibrary.catPromo'), count: categoryCounts.value.promo || 0, icon: 'i-lucide-megaphone' },
  { value: 'minimal', label: t('tmcut.templateLibrary.catMinimal'), count: categoryCounts.value.minimal || 0, icon: 'i-lucide-minimize' },
  { value: 'custom', label: t('tmcut.templateLibrary.catCustom'), count: categoryCounts.value.custom || 0, icon: 'i-lucide-settings' }
])

const aspectRatios = computed(() => [
  { value: 'all', label: t('tmcut.templateLibrary.allRatios'), icon: 'i-lucide-maximize' },
  { value: '9:16', label: t('tmcut.templateLibrary.ratioVertical'), icon: 'i-lucide-smartphone' },
  { value: '16:9', label: t('tmcut.templateLibrary.ratioHorizontal'), icon: 'i-lucide-monitor' },
  { value: '1:1', label: t('tmcut.templateLibrary.ratioSquare'), icon: 'i-lucide-square' }
])

// Industry chips are derived, never hardcoded: they appear in catalog order
// and only for industries that actually have a card under the current
// search/ratio/category filters, with a count of what clicking shows.
const { industries, industryLabel } = useTmcutIndustries()

const industryChips = computed(() => {
  const counts = industryCounts.value
  const chips = [{
    value: 'all',
    label: t('tmcut.templateLibrary.allIndustries'),
    count: counts.all || 0,
    icon: 'i-lucide-shapes'
  }]
  for (const meta of industries) {
    const count = counts[meta.id] || 0
    if (count === 0) continue
    chips.push({ value: meta.id, label: industryLabel(meta.id), count, icon: meta.icon })
  }
  return chips
})

const libraryTabOptions = computed(() => [
  { value: 'timeline', label: t('tmcut.videoTemplates.tabTimeline'), icon: 'i-lucide-layout-template' },
  { value: 'studio', label: t('tmcut.videoTemplates.tabStudio'), icon: 'i-lucide-wand' },
  { value: 'factory', label: t('tmcut.videoTemplates.tabFactory'), icon: 'i-lucide-factory' },
  { value: 'marketplace', label: t('tmcut.videoTemplates.tabMarketplace'), icon: 'i-lucide-store' },
  { value: 'html-video', label: t('tmcut.videoTemplates.tabHtmlVideo'), icon: 'i-lucide-code-2' }
])

onMounted(() => {
  assetCenter.load()
})

const activeReadiness = computed(() => {
  if (!activeTemplate.value) return null
  return templateAssetReadiness(activeTemplate.value)
})

function handleCreateBlank() {
  const proj = createProject(t('tmcut.newProject'))
  router.push(`/tmcut/editor?project=${proj.id}`)
}

async function handleDirectUse(tpl: TmcutTemplate) {
  try {
    isCreating.value = true
    const proj = await createProjectFromTemplate(tpl, { projectName: `${tpl.name} - Project` })
    toast.add({ title: t('tmcut.templateLibrary.createdToast', { name: tpl.name }), color: 'success', icon: 'i-lucide-check-circle' })
    router.push(`/tmcut/editor?project=${proj.id}`)
  } catch (err) {
    console.error('Failed to instantiate template', err)
    toast.add({ title: t('tmcut.save.error'), color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isCreating.value = false
  }
}

function openCustomizeModal(tpl: TmcutTemplate) {
  activeTemplate.value = tpl
  projectNameInput.value = `${tpl.name} - Project`
  placeholderTextInputs.value = {}
  if (Array.isArray(tpl.placeholders)) {
    for (const ph of tpl.placeholders) {
      if (ph.type === 'text') placeholderTextInputs.value[ph.id] = ph.defaultContent || ''
    }
  }
  customizeModalOpen.value = true
}

function assetEntryId(assetId: string): string {
  return assetId.startsWith('asset:') ? assetId.slice('asset:'.length) : assetId
}

function assetInstallState(assetId: string): string {
  const entryId = assetEntryId(assetId)
  const record = assetCenter.installed.value.find(r => r.entryId === entryId)
  const job = assetCenter.jobs.value.find(j => j.entryId === entryId && ['queued', 'active', 'retrying'].includes(j.state))
  return job?.state || record?.state || 'catalog'
}

function assetTitle(assetId: string): string {
  const entry = assetCenter.findEntry(assetEntryId(assetId))
  return entry?.title || assetEntryId(assetId)
}

async function handleInstallRequiredAsset(assetId: string) {
  const res = await assetCenter.install(assetEntryId(assetId))
  if (!res.ok) {
    toast.add({ title: t(`tmcut.assetCenter.blocked.${res.reason || 'review'}`, t('tmcut.assetCenter.installBlocked')), color: 'warning' })
  }
}

async function handleConfirmCustomize() {
  if (!activeTemplate.value) return
  try {
    isCreating.value = true
    const replacements: Record<string, { text?: string }> = {}
    for (const [phId, textVal] of Object.entries(placeholderTextInputs.value)) {
      if (textVal.trim()) replacements[phId] = { text: textVal.trim() }
    }
    const proj = await createProjectFromTemplate(activeTemplate.value, {
      projectName: projectNameInput.value.trim() || activeTemplate.value.name,
      replacements
    })
    toast.add({ title: t('tmcut.templateLibrary.createdToast', { name: activeTemplate.value.name }), color: 'success', icon: 'i-lucide-check-circle' })
    customizeModalOpen.value = false
    router.push(`/tmcut/editor?project=${proj.id}`)
  } catch (err) {
    console.error('Failed to create customized template project', err)
    toast.add({ title: t('tmcut.save.error'), color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    isCreating.value = false
  }
}

function promptDeleteTemplate(tpl: TmcutTemplate) {
  targetDeleteId.value = tpl.id
  targetDeleteName.value = tpl.name
  deleteModalOpen.value = true
}

async function handleExportTemplate(tpl: TmcutTemplate) {
  try {
    const res = await exportTemplate(tpl)
    if (res.canceled) return
    toast.add({ title: t('tmcut.templateLibrary.exportedToast', { name: tpl.name }), description: res.path, color: 'success', icon: 'i-lucide-file-down' })
  } catch (err) {
    console.error('Failed to export template', err)
    toast.add({ title: t('tmcut.templateLibrary.exportFailedToast'), color: 'error', icon: 'i-lucide-alert-triangle' })
  }
}

const importing = ref(false)

async function handleImportTemplates() {
  if (importing.value) return
  importing.value = true
  try {
    const res = await importTemplates()
    if (res.canceled) return
    if (res.imported.length > 0) toast.add({ title: t('tmcut.templateLibrary.importedToast', { count: res.imported.length }), color: 'success', icon: 'i-lucide-file-up' })
    if (res.failed > 0) toast.add({ title: t('tmcut.templateLibrary.importFailedToast', { count: res.failed }), color: 'warning', icon: 'i-lucide-file-x' })
    if (res.imported.length === 0 && res.failed === 0) toast.add({ title: t('tmcut.templateLibrary.importEmptyToast'), color: 'neutral', icon: 'i-lucide-file-question' })
  } catch (err) {
    console.error('Failed to import templates', err)
    toast.add({ title: t('tmcut.templateLibrary.importFailedToast', { count: 0 }), color: 'error', icon: 'i-lucide-alert-triangle' })
  } finally {
    importing.value = false
  }
}

function confirmDeleteTemplate() {
  if (targetDeleteId.value) {
    deleteUserTemplate(targetDeleteId.value)
    toast.add({ title: t('tmcut.templateLibrary.deleted'), color: 'success', icon: 'i-lucide-trash-2' })
  }
  deleteModalOpen.value = false
  targetDeleteId.value = null
  targetDeleteName.value = null
}
</script>

<template>
  <BasePage
    id="tmcut-templates"
    :title="t('tmcut.templateLibrary.title')"
    :description="t('tmcut.templateLibrary.subtitle')"
  >
    <template #right>
      <div v-if="libraryTab === 'timeline'" class="flex items-center gap-2">
        <TmcutButton
          to="/tmcut"
          icon="i-lucide-arrow-left"
          variant="soft"
          color="neutral"
          size="sm"
        >
          <span class="hidden sm:inline">{{ t('tmcut.back') }}</span>
        </TmcutButton>
        <TmcutButton
          icon="i-lucide-file-up"
          variant="soft"
          color="neutral"
          size="sm"
          :loading="importing"
          @click="handleImportTemplates"
        >
          <span class="hidden sm:inline">{{ t('tmcut.templateLibrary.importBtn') }}</span>
        </TmcutButton>
        <TmcutButton
          icon="i-lucide-plus"
          color="primary"
          variant="solid"
          size="sm"
          @click="handleCreateBlank"
        >
          {{ t('tmcut.templateLibrary.createBlank') }}
        </TmcutButton>
        <TmcutButton
          icon="i-lucide-wand-sparkles"
          color="secondary"
          variant="soft"
          size="sm"
          :title="t('tmcut.aiTemplates.buttonTooltip')"
          @click="aiTemplateModalOpen = true"
        >
          <span class="hidden sm:inline">{{ t('tmcut.aiTemplates.buttonLabel') }}</span>
        </TmcutButton>
      </div>
    </template>

    <!-- Library Tabs -->
    <div class="flex items-center gap-2 mb-6">
      <TmcutSegmentedControl
        v-model="libraryTab"
        :options="libraryTabOptions"
        :label="t('tmcut.templateLibrary.tabsLabel')"
        size="sm"
      />
    </div>

    <!-- Video Factory Template Studio -->
    <LazyTmcutVideoTemplateStudio v-if="libraryTab === 'studio'" class="mb-6" />

    <!-- Video Factory Batch Console -->
    <LazyTmcutVideoFactory v-if="libraryTab === 'factory'" class="mb-6" />

    <!-- Asset Marketplace -->
    <LazyTmcutMarketplace v-if="libraryTab === 'marketplace'" class="mb-6" />

    <!-- HTML/CSS video studio -->
    <LazyTmcutHtmlVideoStudio v-if="libraryTab === 'html-video'" class="mb-6" />

    <!-- Timeline Template Library -->
    <div v-show="libraryTab === 'timeline'" class="space-y-6 animate-fade-in">
      <!-- Search & Filters Toolbar -->
      <div class="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4">
        <!-- Search -->
        <div class="relative w-full lg:w-80 mb-4 lg:mb-0">
          <UIcon name="i-lucide-search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            id="tmcut-template-search"
            v-model="searchQuery"
            name="tmcut-template-search"
            type="text"
            :aria-label="t('tmcut.templateLibrary.searchPlaceholder')"
            :placeholder="t('tmcut.templateLibrary.searchPlaceholder')"
            class="w-full bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border border-neutral-200 dark:border-neutral-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 transition-all"
          >
        </div>

        <!-- Aspect Ratio Filters -->
        <TmcutSegmentedControl
          v-model="selectedAspectRatio"
          :options="aspectRatios"
          :label="t('tmcut.templateLibrary.ratioFiltersLabel')"
          size="sm"
          class="mb-4"
        />

        <!-- Industry Filters -->
        <TmcutFilterChips
          v-model="selectedIndustry"
          :options="industryChips"
          :max-selected="1"
          :label="t('tmcut.templateLibrary.industryFiltersLabel')"
          class="mb-4"
        />

        <!-- Category Filters -->
        <TmcutFilterChips
          v-model="selectedCategory"
          :options="categories"
          :max-selected="1"
          :label="t('tmcut.templateLibrary.filtersLabel')"
        />
      </div>

      <!-- Templates Grid -->
      <div v-if="filteredTemplates.length > 0" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        <TmcutTemplateCard
          v-for="tpl in filteredTemplates"
          :key="tpl.id"
          :template="tpl"
          @use="handleDirectUse"
          @customize="openCustomizeModal"
          @export="handleExportTemplate"
          @delete="promptDeleteTemplate"
        />
      </div>

      <!-- Empty State -->
      <div v-else class="text-center py-16 rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-white/50 dark:bg-neutral-900/50">
        <UIcon name="i-lucide-layout-template" class="w-16 h-16 text-neutral-300 dark:text-neutral-600 mx-auto mb-4" />
        <h3 class="text-lg font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
          {{ t('tmcut.templateLibrary.emptyTitle') }}
        </h3>
        <p class="text-sm text-neutral-500 max-w-sm mx-auto mb-6">
          {{ t('tmcut.templateLibrary.emptyDesc') }}
        </p>
        <TmcutButton variant="ghost" size="sm" @click="selectedCategory = ['all']; selectedIndustry = ['all']; selectedAspectRatio = 'all'; searchQuery = ''">
          {{ t('tmcut.animation.reset') }}
        </TmcutButton>
      </div>
    </div>

    <!-- Customize Modal -->
    <LazyTmcutTemplateCustomizeModal
      v-model:open="customizeModalOpen"
      :active-template="activeTemplate"
      :project-name-input="projectNameInput"
      :placeholder-text-inputs="placeholderTextInputs"
      :is-creating="isCreating"
      :active-readiness="activeReadiness"
      :asset-install-state="assetInstallState"
      :asset-title="assetTitle"
      :tts="tts"
      @update:project-name-input="projectNameInput = $event"
      @update:placeholder-text-inputs="placeholderTextInputs = $event"
      @install-asset="handleInstallRequiredAsset"
      @confirm="handleConfirmCustomize"
      @close="customizeModalOpen = false"
    />

    <!-- Delete Confirm Modal -->
    <LazyTmcutModal v-model:open="deleteModalOpen" :title="t('tmcut.templateLibrary.deleteTemplate')" size="sm">
      <template #body>
        <p class="text-sm text-neutral-500">
          {{ t('tmcut.templateLibrary.deleteConfirm', { name: targetDeleteName }) }}
        </p>
      </template>
      <template #footer="{ close }">
        <UButton color="neutral" variant="ghost" @click="close">
          {{ t('tmcut.hotkeys.close') }}
        </UButton>
        <UButton color="error" variant="soft" @click="confirmDeleteTemplate">
          {{ t('tmcut.home.deleteConfirm') }}
        </UButton>
      </template>
    </LazyTmcutModal>

    <!-- AI Template Builder -->
    <LazyTmcutAiTemplates v-model:open="aiTemplateModalOpen" />
  </BasePage>
</template>
