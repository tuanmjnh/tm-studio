<script setup lang="ts">
import type { CommandPaletteGroup, NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const { t } = useI18n()
const auth = useAuth()
const nav = useNavMenu()
const appUpdater = useAppUpdater()
const open = ref(false)

onMounted(() => {
  if (appUpdater.isElectron.value) {
    appUpdater.checkForUpdates(true)
  }
})

watch(() => auth.isAuthenticated.value, async (val) => {
  if (val) {
    await nav.fetchRoutes()
  } else {
    nav.clearRoutes()
    if (route.path !== '/login' && route.path !== '/register') {
      const redirect = route.fullPath !== '/' ? route.fullPath : undefined
      await navigateTo(redirect ? { path: '/login', query: { redirect } } : '/login')
    }
  }
}, { immediate: true })

const links = computed<NavigationMenuItem[][]>(() => [nav.buildNavItems(open)])

const groups = computed<CommandPaletteGroup[]>(() => [{
  id: 'links',
  label: t('nav.goTo'),
  items: links.value.flat() as unknown as CommandPaletteGroup['items']
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <LazyDashboardTeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton
          :collapsed="collapsed"
          :label="$t('global.search')"
          class="bg-transparent ring-default"
        />

        <UNavigationMenu
          v-if="links[0]?.length"
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <LazyDashboardUserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" :placeholder="$t('global.searchPlaceholder')" />

    <slot />

    <LazyDashboardNotificationsSlideover />
    <LazyDashboardSettingsSlideover />
    <LazyDashboardAppUpdateModal />
  </UDashboardGroup>
</template>
