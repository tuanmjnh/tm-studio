<script setup lang="ts">
defineProps<{
  collapsed?: boolean
}>()
const { t } = useI18n()
const appConfig = useAppConfig()
const appUpdater = useAppUpdater()
</script>

<template>
  <div
    class="flex items-center gap-2 px-1 py-1 select-none overflow-hidden h-9 w-full"
    :class="collapsed ? 'justify-center' : 'justify-between'"
  >
    <div class="flex items-center gap-2.5 min-w-0">
      <!-- Brand Logo Icon -->
      <MediaVisual src="/logo.svg" size="w-7 h-7" />

      <!-- Brand Name & Version (hidden when collapsed) -->
      <Transition
        enter-active-class="transition-opacity duration-200"
        leave-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-to-class="opacity-0"
      >
        <div v-if="!collapsed" class="flex flex-col min-w-0">
          <span class="text-sm font-bold text-highlighted truncate leading-tight tracking-wide uppercase">
            {{ appConfig.system.app_name }}
          </span>
          <button
            type="button"
            class="flex items-center gap-1 text-[10px] text-muted hover:text-primary transition-colors cursor-pointer text-left leading-none group"
            :title="t('appUpdate.checkUpdate')"
            @click="appUpdater.openModal()"
          >
            <span>v{{ appConfig.system.app_version }}</span>
            <UBadge
              v-if="appUpdater.hasUpdate.value"
              color="primary"
              variant="solid"
              size="xs"
              class="animate-pulse px-1 py-0 text-[9px]"
            >
              Update
            </UBadge>
          </button>
        </div>
      </Transition>
    </div>

    <!-- Network Status flexed to the right -->
    <LazyDashboardNetworkStatus v-if="!collapsed" icon-only class="shrink-0 flex justify-center" />
  </div>
</template>
