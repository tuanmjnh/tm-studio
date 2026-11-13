<script lang="ts">
export type { GridColumn, GridSwipeAction } from '@tuanmjnh/tm-ui'
</script>

<script setup lang="ts" generic="T extends object">
import { GridList as TmGridList } from '@tuanmjnh/tm-ui'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { GridColumn, GridSwipeAction } from '@tuanmjnh/tm-ui'

defineOptions({ inheritAttrs: false })

defineProps<{
  items: T[]
  columns: GridColumn[]
  loading?: boolean
  selected?: T[]
  itemKey?: string
  selectable?: boolean
  actionOptions?: (item: T) => DropdownMenuItem[] | DropdownMenuItem[][]
  swipeLeftActions?: (item: T) => GridSwipeAction<T>[]
  swipeRightActions?: (item: T) => GridSwipeAction<T>[]
  mobileActionMode?: 'swipe' | 'dropdown' | 'context'
  viewMode?: 'list' | 'grid'
  gridCols?: string
  skeletonCount?: number
  draggable?: boolean
  storageKey?: string
  hideHeader?: boolean
  uiScrollArea?: { root?: string, viewport?: string }
  actionsButtonVisibility?: 'always' | 'list' | 'grid' | 'never'
  canLoadMore?: boolean
}>()

const emit = defineEmits<{
  'update:selected': [value: T[]]
  'update:viewMode': [value: 'list' | 'grid']
  'sort': [column: GridColumn]
  'click': [item: T]
  'refresh': []
  'load-more': []
  'update:items': [items: T[]]
}>()

const { t } = useI18n()

const labels = computed(() => ({
  selectAll: t('common.selectAll'),
  selectRow: t('common.selectRow'),
  more: t('common.more'),
  emptyTitle: t('common.no_data'),
  emptyDescription: t('common.no_data_desc'),
  refresh: t('common.refresh')
}))
</script>

<template>
  <TmGridList :items="items" :columns="columns" :loading="loading" :selected="selected" :item-key="itemKey"
    :selectable="selectable" :action-options="actionOptions" :swipe-left-actions="swipeLeftActions"
    :swipe-right-actions="swipeRightActions" :mobile-action-mode="mobileActionMode" :view-mode="viewMode"
    :grid-cols="gridCols" :skeleton-count="skeletonCount" :draggable="draggable" :storage-key="storageKey"
    :hide-header="hideHeader" :ui-scroll-area="uiScrollArea"
    :actions-button-visibility="actionsButtonVisibility" :can-load-more="canLoadMore" :labels="labels"
    v-bind="$attrs"
    @update:selected="emit('update:selected', $event)"
    @update:view-mode="emit('update:viewMode', $event)"
    @sort="emit('sort', $event)"
    @click="emit('click', $event)"
    @refresh="emit('refresh')"
    @load-more="emit('load-more')"
    @update:items="emit('update:items', $event)"
  >
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmGridList>
</template>
