import { useStorage } from '@vueuse/core'

// Global storage for all view modes
// Stores data like: { "admin-pricing-view-mode": "grid", "default": "list", ... }
const globalViewModeStore = useStorage<Record<string, 'list' | 'grid'>>('admin-view-modes-storage', {
  default: 'list'
})

export const useAdminGridView = (componentKey: string, defaultMode: 'list' | 'grid' = 'list') => {
  const viewMode = computed({
    get: () => {
      // 1. Specific component preference
      if (globalViewModeStore.value[componentKey]) {
        return globalViewModeStore.value[componentKey]
      }
      // 2. Global default in store
      if (globalViewModeStore.value['default']) {
        return globalViewModeStore.value['default']
      }
      // 3. Argument default
      return defaultMode
    },
    set: (val: 'list' | 'grid') => {
      globalViewModeStore.value = {
        ...globalViewModeStore.value,
        [componentKey]: val
      }
    }
  })

  const toggleViewMode = () => {
    viewMode.value = viewMode.value === 'list' ? 'grid' : 'list'
  }

  const setViewMode = (mode: 'list' | 'grid') => {
    viewMode.value = mode
  }

  // Helper to set the global default
  const setGlobalDefault = (mode: 'list' | 'grid') => {
    globalViewModeStore.value = {
      ...globalViewModeStore.value,
      default: mode
    }
  }

  return {
    viewMode,
    toggleViewMode,
    setViewMode,
    setGlobalDefault,
    isGrid: computed(() => viewMode.value === 'grid'),
    isList: computed(() => viewMode.value === 'list')
  }
}
