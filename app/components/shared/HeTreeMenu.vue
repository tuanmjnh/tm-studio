<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { Draggable } from '@he-tree/vue'
import '@he-tree/vue/style/default.css'

// -- Props --
interface ExampleFieldNames {
  id: string
  label: string
  children: string
}

interface Props {
  modelValue?: any[]
  fieldNames?: ExampleFieldNames
  selectedKeys?: Set<string | number> | (string | number)[]
  class?: string
  classNode?: string
  defaultIcon?: string
  hideIcon?: boolean
  defaultExpandAll?: boolean
  expandedIds?: (string | number)[]
  draggable?: boolean
  actionOptions?: (node: any) => any[] // Context menu items
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: () => [],
  fieldNames: () => ({ id: 'id', label: 'label', children: 'children' }),
  selectedKeys: () => [],
  class: '',
  classNode: '',
  defaultIcon: undefined,
  hideIcon: false,
  defaultExpandAll: false,
  expandedIds: () => [],
  draggable: true,
  actionOptions: undefined
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: any[]): void
  (e: 'node:click', node: any): void
  (e: 'node:toggle', payload: { node: any, isOpen: boolean }): void
  (e: 'node:select', payload: { node: any, isSelected: boolean }): void
  (e: 'node:drop', payload: any): void
  (e: 'node:after-drop', payload: any): void
  (e: 'update:expandedIds', value: (string | number)[]): void
}>()

// -- State --
const treeRef = ref<any>(null)
const dragTriggerClass = 'tree-drag-handle'
const isLoading = ref(false)
let expansionTimerId: any = null

const clearExpansionTimers = () => {
  if (expansionTimerId) {
    clearTimeout(expansionTimerId)
    expansionTimerId = null
  }
}

// -- Computed --
const normalizeId = (id: any): string | number => {
  if (!id) return ''
  if (id && typeof id === 'object') {
    if (id.$oid) return id.$oid
    return id._id || id.id || JSON.stringify(id)
  }
  return id
}

// State variable: Fully On/Fully Closed
const openNodeIds = ref(new Set<string | number>((props.expandedIds || []).map(id => normalizeId(id))))
const isAllExpanded = ref(props.defaultExpandAll)

const treeData = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val)
})

// -- Helpers --
const getId = (node: any) => node[props.fieldNames.id]
const getNodeKey = (stat: any) => normalizeId(getId(stat.data))

const isSelected = (node: any) => {
  if (Array.isArray(props.selectedKeys)) {
    const keys = props.selectedKeys as (string | number)[]
    return keys.some(k => normalizeId(k) === normalizeId(getId(node)))
  }
  if (props.selectedKeys instanceof Set) {
    return props.selectedKeys.has(normalizeId(getId(node)))
  }
  return false
}

// -- Context Menu Logic --
const contextMenu = ref({
  isOpen: false,
  x: 0,
  y: 0,
  items: [] as any[]
})

const handleContextMenu = (node: any, event: MouseEvent) => {
  if (!props.actionOptions) return

  contextMenu.value = {
    isOpen: true,
    x: event.clientX,
    y: event.clientY,
    items: props.actionOptions(node)
  }
}

// -- Events --
const toggleNode = (node: any, stat: any) => {
  if (!stat) return
  stat.open = !stat.open
  syncStatsToOpenIds()
  emit('node:toggle', { node, isOpen: stat.open })
}

const syncStatsToOpenIds = () => {
  if (!treeRef.value?.stats) return
  const stats = treeRef.value.stats
  const newSet = new Set<string | number>()
  for (const key in stats) {
    if (stats[key]?.open) {
      const id = normalizeId(getId(stats[key].data))
      if (id) newSet.add(id)
    }
  }
  openNodeIds.value = newSet
  emit('update:expandedIds', Array.from(newSet))
}

const onSelect = (node: any, isSelected: boolean) => {
  emit('node:select', { node, isSelected })
}

const onNodeClick = (node: any) => {
  emit('node:click', node)
}

const onDrop = (store: any) => {
  emit('node:drop', store)
}

const onChange = (data: any) => {
  // Structure change logic
}

const onAfterDrop = (store: any) => {
  emit('node:after-drop', store)
}

// -- Initialization & Loading Logic --
const initTree = async () => {
  // Synchronize the isAllExpanded state with the original prop.
  isAllExpanded.value = props.defaultExpandAll

  if (!props.modelValue || props.modelValue.length === 0) {
    isLoading.value = true
    return
  }

  // If we already have data, don't show loading
  isLoading.value = false

  await nextTick()

  // Give HeTree a moment to generate new stats.
  clearExpansionTimers()
  expansionTimerId = setTimeout(() => {
    restoreOpenStates()
  }, 100)
}

const restoreOpenStates = () => {
  if (!treeRef.value?.stats) return
  const stats = treeRef.value.stats

  // Do multiple passes to handle deep nesting (children stats might depend on parents being open)
  const apply = () => {
    let changed = false
    if (!treeRef.value?.stats) return false
    const currentStats = treeRef.value.stats

    for (const key in currentStats) {
      if (!currentStats[key]) continue
      const id = normalizeId(getId(currentStats[key].data))

      // If defaultExpandAll is true (e.g. during search), we want all nodes open.
      // Otherwise, we restore only if the node ID is in our saved openNodeIds.
      const shouldBeOpen = props.defaultExpandAll || (id && openNodeIds.value.has(id))

      if (shouldBeOpen && !currentStats[key].open) {
        currentStats[key].open = true
        changed = true
      }
    }
    return changed
  }

  // Initial pass
  apply()

  clearExpansionTimers()

  // Start recursion for deeply nested nodes
  const nextPass = (depth = 0) => {
    if (depth > 12) return // Safety break for extremely deep trees

    expansionTimerId = setTimeout(() => {
      const changed = apply()

      // When searching, we keep going for at least 8 levels to be safe
      const shouldContinue = changed || (props.defaultExpandAll && depth < 8)

      if (shouldContinue) {
        nextPass(depth + 1)
      } else if (props.defaultExpandAll) {
        // Final sync for search mode
        isAllExpanded.value = true
        syncStatsToOpenIds()
      }
    }, 80)
  }

  nextPass()
}

watch(() => props.modelValue, async (newVal, oldVal) => {
  if (!newVal) {
    isLoading.value = true
    return
  }

  const isInitial = !oldVal || oldVal.length === 0
  isLoading.value = false
  await nextTick()

  // Give HeTree a moment to generate new stats.
  clearExpansionTimers()
  expansionTimerId = setTimeout(() => {
    restoreOpenStates()
  }, 100)
}, { immediate: true, deep: false })

// Trigger restoration if defaultExpandAll changes (e.g. search starts/ends)
watch(() => props.defaultExpandAll, (newVal) => {
  if (newVal) {
    restoreOpenStates()
  }
})

// Synchronize external expandedIds with local openNodeIds
watch(() => props.expandedIds, (newVal) => {
  // If search mode is active, expansion is controlled by search logic
  if (props.defaultExpandAll) return

  const normalizedNew = new Set((newVal || []).map(id => normalizeId(id)))

  // Check difference
  let hasDifference = normalizedNew.size !== openNodeIds.value.size
  if (!hasDifference) {
    for (const id of normalizedNew) {
      if (!openNodeIds.value.has(id)) {
        hasDifference = true
        break
      }
    }
  }

  if (hasDifference) {
    openNodeIds.value = normalizedNew
    restoreOpenStates()
  }
}, { deep: true })

// -- Action Methods (Exposed) --
const expandAll = () => {
  if (!treeRef.value) return
  const stats = treeRef.value.stats
  for (const key in stats) {
    stats[key].open = true
  }
  isAllExpanded.value = true
  syncStatsToOpenIds()
}

const collapseAll = () => {
  if (!treeRef.value) return
  const stats = treeRef.value.stats
  for (const key in stats) {
    stats[key].open = false
  }
  isAllExpanded.value = false
  syncStatsToOpenIds()
}

const toggleAll = () => {
  if (isAllExpanded.value) {
    collapseAll()
  } else {
    expandAll()
  }
}

// Open a specific node (Supported from parent calling in)
const openNode = (key: any) => {
  if (!treeRef.value) return
  const stat = treeRef.value.stats[key]
  if (stat) stat.open = true
}

defineExpose({
  expandAll,
  collapseAll,
  toggleAll,
  isAllExpanded,
  openNode
})
</script>

<template>
  <div class="tree-menu" :class="class">
    <div v-if="isLoading" class="space-y-2 py-2">
      <div v-for="i in 5" :key="i" class="flex items-center gap-2 px-3">
        <USkeleton class="h-4 w-4 rounded-full" />
        <USkeleton class="h-4 w-4 rounded" />
        <USkeleton class="h-4 rounded" :style="{ width: Math.floor(Math.random() * 40 + 30) + '%' }" />
      </div>
    </div>

    <div v-show="!isLoading">
      <Draggable
        ref="treeRef"
        v-model="treeData"
        :children-key="fieldNames.children"
        :node-key="getNodeKey"
        :default-open="defaultExpandAll"
        class="he-tree-root"
        :trigger-class="dragTriggerClass"
        tree-line
        @drop="onDrop"
        @change="onChange"
        @after-drop="onAfterDrop"
      >
        <template #default="{ node, stat }">
          <div
            class="group flex flex-col mb-2 py-2 px-3 rounded-lg border border-gray-300/50 dark:border-gray-700/50 bg-white/40 dark:bg-gray-800/40 backdrop-blur-sm shadow-xs transition-all hover:bg-white/60 dark:hover:bg-gray-800/60 hover:shadow-md hover:border-primary-500/50"
            :class="[classNode, { 'bg-blue-50/50! dark:bg-sky-300/20! border-sky-500/50 dark:border-sky-800/50': isSelected(node) }]"
            @contextmenu.prevent="(e: any) => handleContextMenu(node, e)"
          >
            <div class="flex items-center gap-2">
              <div
                v-if="draggable"
                :class="dragTriggerClass"
                class="flex cursor-move p-1 text-gray-400 opacity-50 group-hover:opacity-100"
              >
                <UIcon name="i-lucide-grip-vertical" class="w-4 h-4" />
              </div>

              <div class="flex items-center p-1" @click.stop>
                <UCheckbox :model-value="isSelected(node)" @update:model-value="(val: any) => onSelect(node, val)" />
              </div>

              <slot
                v-if="!hideIcon"
                name="icon"
                :node="node"
                :stat="stat"
              >
                <UIcon
                  v-if="node.icon || defaultIcon"
                  :name="node.icon || defaultIcon"
                  class="w-4 h-4 text-gray-500 dark:text-gray-400"
                />
              </slot>

              <div class="flex-1 min-w-0 cursor-pointer select-none" @click="onNodeClick(node)">
                <div class="flex flex-col">
                  <slot name="title" :node="node" :stat="stat">
                    <span class="text-sm font-medium text-gray-700 dark:text-gray-200 truncate block">
                      {{ node[fieldNames.label] }}
                    </span>
                  </slot>
                  <slot name="description" :node="node" :stat="stat" />
                </div>
              </div>

              <div class="flex items-center gap-1">
                <slot name="right-text" :node="node" :stat="stat" />

                <button
                  type="button"
                  class="flex items-center justify-center w-5 h-5 mr-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors focus:outline-none"
                  :class="{ 'invisible pointer-events-none': !node[fieldNames.children]?.length }"
                  @click.stop="toggleNode(node, stat)"
                >
                  <UIcon
                    name="i-lucide-chevron-right"
                    class="text-gray-500 transition-transform duration-200"
                    :class="{ 'rotate-90': stat.open }"
                  />
                </button>

                <slot name="actions" :node="node" :stat="stat" />
              </div>
            </div>

            <!-- Mobile Extra Slot (Visible only on mobile) -->
            <div
              v-if="$slots['mobile-extra']"
              class="block lg:hidden px-3 pb-3 -mt-1 ml-10 sm:ml-12 border-t border-gray-100 dark:border-gray-800/10 pt-2"
            >
              <slot name="mobile-extra" :node="node" :stat="stat" />
            </div>
          </div>
        </template>
      </Draggable>
      <slot name="last-item">
        <div class="pb-20 md:pb-16" />
      </slot>
    </div>
    <!-- Global Context Menu (Virtual) -->
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
  </div>
</template>

<style>
.he-tree-drag-placeholder {
  background: #3b82f6 !important;
  height: 2px !important;
}

.tree-line {
  background-color: transparent;
}

.tree-vline {
  background-color: #e5e7eb;
}

.dark .tree-vline {
  background-color: #374151;
}

.tree-hline {
  background-color: #e5e7eb;
}

.dark .tree-hline {
  background-color: #374151;
}
</style>
