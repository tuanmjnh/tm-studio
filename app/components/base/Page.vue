<script setup lang="ts">
import { Page as TmPage } from '@tuanmjnh/tm-ui'
import type { HeaderAction } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

const props = withDefaults(defineProps<{
  id: string
  title: string
  description?: string
  navbarUi?: Record<string, unknown>
  flush?: boolean
  compact?: boolean
  /** Full-bleed workspaces own their chrome — no global bell/settings buttons. */
  hideDefaultActions?: boolean
  actions?: HeaderAction[]
  search?: string
  searchPlaceholder?: string
  viewMode?: 'list' | 'grid'
  count?: number
  hasMore?: boolean
  loading?: boolean
  refresh?: () => unknown
}>(), {
  description: undefined,
  navbarUi: undefined,
  flush: false,
  compact: false,
  hideDefaultActions: false,
  actions: undefined,
  search: undefined,
  searchPlaceholder: undefined,
  viewMode: undefined,
  count: undefined,
  hasMore: false,
  loading: false,
  refresh: undefined
})

const emit = defineEmits<{
  'update:search': [value: string]
  'update:viewMode': [value: 'list' | 'grid']
}>()

const { t } = useI18n()
const auth = useAuth()
const { isSettingsSlideoverOpen } = useDashboard()

useHead(() => ({ title: props.title }))

const labels = computed(() => ({
  search: t('common.search'),
  refresh: t('common.refresh'),
  actions: t('common.actions'),
  list: t('common.list'),
  grid: t('common.grid'),
  records: t('common.records'),
  loading: t('common.loading_text'),
  noMore: t('common.no_more_data')
}))
</script>

<template>
  <TmPage :id="id" :title="title" :description="description" :navbar-ui="navbarUi" :flush="flush"
    :compact="compact" :actions="actions" :search="search" :search-placeholder="searchPlaceholder"
    :view-mode="viewMode" :count="count" :has-more="hasMore" :loading="loading" :refresh="refresh"
    :labels="labels" v-bind="$attrs" @update:search="emit('update:search', $event)"
    @update:view-mode="emit('update:viewMode', $event)">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>

    <template v-if="!hideDefaultActions" #chrome>
      <LazyDashboardBellButton />
      <UButton v-if="auth.isAuthenticated.value" icon="i-lucide-settings" color="neutral" variant="ghost" square
        :aria-label="t('settings.title')" :ui="{ leadingIcon: 'text-dimmed' }"
        @click="isSettingsSlideoverOpen = !isSettingsSlideoverOpen" />
    </template>
  </TmPage>
</template>
