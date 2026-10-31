<script setup lang="ts">
import { useVModel, useInfiniteScroll } from '@vueuse/core'
import Sortable from 'sortablejs'

/**
 * GridList Component
 * A hybrid list/table view that renders items as rows/cards but maintains column alignment.
 * Supports:
 * - Sortable headers
 * - Swipe actions (via SwipeCard)
 * - Selection
 * - Responsive columns (hide on mobile via classes)
 * - Custom slot rendering
 */

export interface GridColumn {
  key: string
  label?: string
  sortable?: boolean
  class?: string
  rowClass?: string
  slot?: string
  headerClass?: string
  sort?: 'asc' | 'desc' | 1 | -1 | null
}

const props = withDefaults(defineProps<{
  items: any[]
  columns: GridColumn[]
  loading?: boolean
  selected?: any[]
  itemKey?: string
  selectable?: boolean
  actionOptions?: (item: any) => any[] // For desktop dropdown
  swipeLeftActions?: (item: any) => any[]
  swipeRightActions?: (item: any) => any[]
  mobileActionMode?: 'swipe' | 'dropdown' | 'context'
  viewMode?: 'list' | 'grid'
  gridCols?: string
  skeletonCount?: number
  draggable?: boolean
  storageKey?: string
  hideHeader?: boolean
  uiScrollArea?: any
  actionsButtonVisibility?: 'always' | 'list' | 'grid' | 'never'
  canLoadMore?: boolean
}>(), {
  mobileActionMode: 'context',
  draggable: false,
  viewMode: 'list',
  gridCols: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  skeletonCount: 20,
  hideHeader: false,
  actionsButtonVisibility: 'always',
  canLoadMore: true
})

const emit = defineEmits<{
  (e: 'update:selected', value: any[]): void
  (e: 'update:viewMode', value: 'list' | 'grid'): void
  (e: 'sort', column: any): void
  (e: 'click', item: any): void
  (e: 'refresh'): void
  (e: 'load-more'): void
  (e: 'update:items', items: any[]): void
}>()

const selectedItems = useVModel(props, 'selected', emit, { passive: true, defaultValue: [] }) as Ref<any[]>
const currentViewMode = useVModel(props, 'viewMode', emit, { passive: true, defaultValue: 'list' }) as Ref<'list' | 'grid'>

// Handle View Mode Persistence via Composable
const keyToUse = props.storageKey || 'default'
const { viewMode: storedView } = useAdminGridView(keyToUse)

// Sync initial
if (storedView.value) {
  currentViewMode.value = storedView.value
}

// Two-way sync
watch(currentViewMode, (val) => {
  storedView.value = val
})
watch(storedView, (val) => {
  if (val) currentViewMode.value = val
})
const mergedUi = computed(() => {
  const defaults = {
    root: 'flex-1',
    viewport: 'h-full w-full rounded-[inherit] outline-none'
  }

  if (!props.uiScrollArea) return defaults
  const merged = {
    ...defaults,
    ...props.uiScrollArea,
    // Safely merge classes for root and viewport if both exist
    root: [defaults.root, props.uiScrollArea.root].filter(Boolean).join(' '),
    viewport: [defaults.viewport, props.uiScrollArea.viewport].filter(Boolean).join(' ')
  }
  return merged
})

const scrollEl = ref<any>(null)
// Target the viewport div inside UScrollArea for infinite scroll
const scrollTarget = computed(() => scrollEl.value?.$el?.querySelector('[data-radix-scroll-area-viewport]') || scrollEl.value?.$el)

useInfiniteScroll(scrollTarget, () => {
  if (!props.loading && props.canLoadMore) {
    emit('load-more')
  }
}, { distance: 10 })

const openCardId = ref<string | number | null>(null)

// Select All Logic
const isAllSelected = computed(() => {
  return props.items.length > 0 && selectedItems.value.length === props.items.length
})

const isIndeterminate = computed(() => {
  return selectedItems.value.length > 0 && selectedItems.value.length < props.items.length
})

const toggleAll = (val: boolean | 'indeterminate') => {
  selectedItems.value = (val === true) ? [...props.items] : []
}

const toggleSelect = (item: any, val: boolean | 'indeterminate') => {
  const key = props.itemKey || '_id'
  const id = item[key]

  if (val === true) {
    if (!selectedItems.value.find(i => i[key] === id)) {
      selectedItems.value = [...selectedItems.value, item]
    }
  } else {
    selectedItems.value = selectedItems.value.filter(i => i[key] !== id)
  }
}

const isSelected = (item: any) => {
  const key = props.itemKey || '_id'
  return !!selectedItems.value.find(i => i[key] === item[key])
}

// Drag & Drop Sorting
const dragEl = ref<HTMLElement | null>(null)
const isDraggable = computed(() => props.draggable)

const sortableInstance = ref<Sortable | null>(null)

const initSortable = () => {
  if (sortableInstance.value) return // Already initialized
  if (!isDraggable.value || !dragEl.value) return // Not ready

  sortableInstance.value = new Sortable(dragEl.value, {
    handle: '.drag-handle',
    animation: 150,
    ghostClass: 'sortable-ghost',
    fallbackClass: 'sortable-fallback',
    forceFallback: true,
    swapThreshold: 0.65,
    onUpdate: (evt: any) => {
      const newItems = [...props.items]
      const [moved] = newItems.splice(evt.oldIndex, 1)
      newItems.splice(evt.newIndex, 0, moved)
      emit('update:items', newItems)
    }
  })
}

const destroySortable = () => {
  sortableInstance.value?.destroy()
  sortableInstance.value = null
}

onMounted(() => {
  initSortable()
})

onUnmounted(() => {
  destroySortable()
})

// Watchers to handle dynamic data (SPA) and config changes
watch(() => [props.items.length, isDraggable.value, dragEl.value], () => {
  // If we became draggable or got data
  if (isDraggable.value && props.items.length > 0 && dragEl.value) {
    initSortable()
  } else if (!isDraggable.value) {
    destroySortable()
  }
}, { flush: 'post' }) // Post flush to ensure DOM is updated

// Context Menu Logic
const contextMenu = ref({
  isOpen: false,
  x: 0,
  y: 0,
  items: [] as any[]
})

const handleContextMenu = (item: any, event: MouseEvent) => {
  if (!props.actionOptions) return
  // event.preventDefault() // Handled by @contextmenu.prevent

  contextMenu.value = {
    isOpen: true,
    x: event.clientX,
    y: event.clientY,
    items: props.actionOptions(item)
  }
}

const handleLongPress = (payload: { item: any, clientX: number, clientY: number }) => {
  if (!props.actionOptions) return

  contextMenu.value = {
    isOpen: true,
    x: payload.clientX,
    y: payload.clientY,
    items: props.actionOptions(payload.item)
  }
}

const slots = useSlots()

const showActions = computed(() => {
  if (props.actionsButtonVisibility === 'never') return false
  if (props.actionsButtonVisibility === 'list') return currentViewMode.value === 'list'
  if (props.actionsButtonVisibility === 'grid') return currentViewMode.value === 'grid'
  return true
})

const isActionCol = (key: string) => key === 'actions' || key === 'action'
const actionsCol = computed(() => props.columns.find(c => isActionCol(c.key)))
const displayColumns = computed(() => props.columns.filter(c => !isActionCol(c.key)))
const hasActions = computed(() => showActions.value && (!!props.actionOptions || !!slots.actions || !!slots.action || !!actionsCol.value))

const actionsClass = computed(() => {
  if (actionsCol.value?.class && actionsCol.value.class.split(' ').some(c => c.startsWith('w-') || c.startsWith('min-w-'))) {
    return actionsCol.value.class.includes('shrink-0') ? actionsCol.value.class : `${actionsCol.value.class} shrink-0`
  }
  if (slots.actions || slots.action) {
    return 'w-24 shrink-0'
  }
  return 'w-14 shrink-0'
})
</script>

<template>
  <div class="flex flex-col h-full min-h-0 bg-transparent">
    <!-- Table Header (Visible only on Desktop List Mode) -->
    <div
      v-if="viewMode === 'list' && !hideHeader"
      class="hidden lg:flex items-center pl-0.75 pr-3.25 py-3 mb-1 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 bg-transparent"
    >
      <!-- Drag Handle Placeholder (Aligned with SwipeCard pl-2 + w-6 = 32px) -->
      <div v-if="isDraggable" class="w-8 shrink-0" />

      <!-- Checkbox Column -->
      <div v-if="selectable" class="w-8 shrink-0 flex items-center justify-center mr-2">
        <UCheckbox :model-value="isAllSelected" :indeterminate="isIndeterminate" @update:model-value="toggleAll" />
      </div>

      <!-- Columns -->
      <div
        v-for="col in displayColumns"
        :key="col.key"
        class="flex items-center min-w-0 px-2"
        :class="[
          (!col.class || !col.class.split(' ').some(c => c.startsWith('w-') || c.startsWith('flex-'))) ? 'flex-1' : '',
          col.class || '',
          col.headerClass || ''
        ]"
      >
        <div
          v-if="col.sortable"
          class="cursor-pointer select-none flex items-center hover:text-primary-500 transition-colors"
          @click="emit('sort', col)"
        >
          {{ col.label }}
          <UIcon
            :name="(col.sort === 'asc' || col.sort === 1) ? 'i-lucide-arrow-up-narrow-wide' : (col.sort === 'desc' || col.sort === -1) ? 'i-lucide-arrow-down-wide-narrow' : 'i-lucide-arrow-up-down'"
            class="w-4 h-4 ml-1"
            :class="col.sort ? 'text-primary-500' : 'text-gray-400'"
          />
        </div>
        <span v-else>{{ col.label }}</span>
      </div>

      <!-- Actions Placeholder / Header (Right) -->
      <div
        v-if="hasActions"
        class="shrink-0 flex items-center justify-end px-2"
        :class="[actionsClass, actionsCol?.headerClass || '']"
      >
        <span v-if="actionsCol?.label">{{ actionsCol.label }}</span>
      </div>
    </div>

    <!-- Scrollable Content -->
    <UScrollArea ref="scrollEl" :ui="mergedUi">
      <!-- Loading State -->
      <div
        v-if="loading && items.length === 0"
        :class="currentViewMode === 'list' ? 'space-y-3 pr-3 pl-0.5' : `grid ${gridCols} gap-4 pb-4 pr-3 pl-0.5`"
        class="w-full h-full"
      >
        <USkeleton
          v-for="i in skeletonCount"
          :key="i"
          :class="[currentViewMode === 'list' ? 'h-20' : 'h-48', 'w-full rounded-xl bg-gray-100 dark:bg-gray-800/50']"
        />
      </div>

      <!-- Empty State -->
      <div v-else-if="items.length === 0" class="flex flex-col items-center justify-center py-20 text-gray-500">
        <slot name="empty">
          <UEmpty
            size="xl"
            icon="i-lucide-package-open"
            :title="$t('common.no_data')"
            :description="$t('common.no_data_desc')"
            :actions="[{ label: $t('common.refresh'), onClick: () => emit('refresh'), variant: 'soft' }]"
          />
        </slot>
      </div>

      <!-- List Items (Separated Cards) -->
      <div
        v-else
        ref="dragEl"
        :class="viewMode === 'list' ? 'space-y-2 pb-4 pr-3 pl-0.5' : `grid ${gridCols} gap-4 pb-4 pr-3 pl-0.5`"
      >
        <slot name="first-item" />
        <div v-for="item in items" :key="item[itemKey || '_id']">
          <LazyGridListSwipeCard
            :id="item[itemKey || '_id']"
            :item="item"
            :open-id="openCardId"
            :disabled="false"
            :mobile-mode="mobileActionMode"
            :draggable="isDraggable"
            :class="['h-full transition-all duration-200', { 'bg-blue-50/50! dark:bg-sky-300/20! border-sky-500/50 dark:border-sky-800/50': isSelected(item) }]"
            @update:open-id="openCardId = $event"
            @click="emit('click', item)"
            @long-press="handleLongPress"
            @contextmenu.prevent="(e: any) => handleContextMenu(item, e)"
          >
            <!-- Left Slot: Drag Handle Only -->
            <template v-if="isDraggable" #left />
            <!-- Center (Default) Slot -->
            <template #default>
              <div class="w-full h-full">
                <!-- {{ index }} -->
                <!-- Mobile Content (Custom Slot) -->
                <div
                  v-if="$slots['mobile-content']"
                  :class="[viewMode === 'grid' ? 'block' : 'block lg:hidden', 'p-4 relative group/mobile']"
                >
                  <slot name="mobile-content" :item="item" />

                  <!-- Mobile Dropdown Mode -->
                  <div
                    v-if="showActions && mobileActionMode === 'dropdown' && actionOptions"
                    class="absolute top-2 right-2"
                  >
                    <UDropdownMenu :items="actionOptions(item)" :popper="{ placement: 'bottom-end' }">
                      <UButton
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-ellipsis-vertical"
                        size="sm"
                      />
                    </UDropdownMenu>
                  </div>
                </div>

                <!-- Desktop Center Columns -->
                <div v-if="viewMode === 'list'" class="hidden lg:flex items-center py-3 h-full w-full overflow-hidden">
                  <!-- Checkbox (Moved here for alignment) -->
                  <div v-if="selectable" class="w-8 shrink-0 flex items-center justify-center mr-2" @click.stop>
                    <UCheckbox :model-value="isSelected(item)" @update:model-value="(val) => toggleSelect(item, val)" />
                  </div>

                  <!-- Columns Loop -->
                  <div
                    v-for="col in displayColumns"
                    :key="col.key"
                    class="min-w-0 flex items-center px-2"
                    :class="[
                      (!col.class || !col.class.split(' ').some(c => c.startsWith('w-') || c.startsWith('flex-'))) ? 'flex-1' : '',
                      col.class || '',
                      col.rowClass || ''
                    ]"
                  >
                    <slot v-if="col.slot || $slots[col.key]" :name="col.slot || col.key" :item="item">
                      <div class="truncate text-xs text-gray-700 dark:text-gray-300">
                        {{ item[col.key] }}
                      </div>
                    </slot>
                    <div v-else class="truncate text-sm text-gray-700 dark:text-gray-300">
                      {{ item[col.key] }}
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- Right Slot: Actions -->
            <template #right>
              <div
                v-if="hasActions"
                class="hidden lg:flex items-center justify-end px-2 h-full shrink-0"
                :class="[actionsClass, actionsCol?.rowClass || '']"
                @click.stop
              >
                <slot name="actions" :item="item">
                  <slot name="action" :item="item">
                    <UDropdownMenu
                      v-if="actionOptions"
                      :items="actionOptions(item)"
                      :popper="{ placement: 'bottom-end' }"
                    >
                      <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                      />
                    </UDropdownMenu>
                  </slot>
                </slot>
              </div>
            </template>

            <!-- Swipe Actions (Mobile) -->
            <template #actions="{ close }">
              <div class="flex h-full">
                <slot name="swipe-actions" :item="item" :close="close">
                  <!-- Fallback if prop provided -->
                  <template v-if="swipeRightActions">
                    <UButton
                      v-for="(action, idx) in swipeRightActions(item)"
                      :key="idx"
                      :color="action.color || 'primary'"
                      :icon="action.icon"
                      variant="solid"
                      square
                      class="h-full rounded-none"
                      @click="() => { action.click?.(item); close() }"
                    />
                  </template>
                </slot>
              </div>
            </template>
          </LazyGridListSwipeCard>
        </div>
        <div :class="{ 'col-span-full': viewMode === 'grid' }">
          <slot name="last-item">
            <div class="pb-16 md:pb-16" />
          </slot>
        </div>
      </div>

      <!-- Global Context Menu (Virtual) -->
      <Teleport to="body">
        <div
          v-if="contextMenu.isOpen"
          class="fixed w-1 h-1 z-9999 pointer-events-none"
          :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
        >
          <UDropdownMenu
            :items="contextMenu.items"
            :open="true"
            :popper="{ placement: 'bottom-start' }"
            class="pointer-events-auto"
            @update:open="(val) => !val && (contextMenu.isOpen = false)"
          >
            <div />
          </UDropdownMenu>
        </div>
      </Teleport>
    </UScrollArea>
  </div>
</template>
