<script setup lang="ts">
const props = defineProps<{
  id: string
  title: string
  description?: string
  navbarUi?: Record<string, unknown>
  flush?: boolean
}>()

const { t } = useI18n()
const auth = useAuth()
const { isSettingsSlideoverOpen } = useDashboard()

const panelUi = computed(() => ({
  root: 'min-h-full',
  ...(props.flush ? { body: 'p-0 sm:p-0 gap-0 sm:gap-0' } : {})
}))

useHead(() => ({
  title: props.title
}))
</script>

<template>
  <UDashboardPanel :id="id" :ui="panelUi">
    <template #header>
      <div class="shrink-0">
        <UDashboardNavbar
          :title="title"
          :ui="{
            title: description ? 'flex flex-col items-start justify-center gap-px h-full truncate' : undefined,
            ...navbarUi
          }"
        >
          <template v-if="description" #title>
            <span class="truncate font-semibold">{{ title }}</span>
            <span class="truncate text-xs font-normal text-muted">{{ description }}</span>
          </template>
          <template #leading>
            <slot name="leading">
              <UDashboardSidebarCollapse />
            </slot>
          </template>
          <template v-if="$slots.left" #left>
            <slot name="left" />
          </template>
          <template #right>
            <div class="flex items-center gap-2">
              <slot name="right" />
              <LazyDashboardBellButton />
              <UButton
                v-if="auth.isAuthenticated.value"
                icon="i-lucide-settings"
                color="neutral"
                variant="ghost"
                square
                :aria-label="t('settings.title')"
                :ui="{ leadingIcon: 'text-dimmed' }"
                @click="isSettingsSlideoverOpen = !isSettingsSlideoverOpen"
              />
            </div>
          </template>
        </UDashboardNavbar>
        <slot name="toolbar" />
      </div>
    </template>

    <template #body>
      <div class="flex-1 min-h-0 flex flex-col" :class="{ 'h-full': flush }">
        <slot />
      </div>
    </template>

    <template #footer>
      <div
        v-if="$slots.footer"
        class="hidden sm:block shrink-0 border-t border-default bg-elevated/50 backdrop-blur-md px-4 sm:px-6 py-2 z-10 empty:hidden"
      >
        <slot name="footer" />
      </div>
    </template>
  </UDashboardPanel>
</template>
