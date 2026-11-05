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
    <StudioAmbientBackdrop />

    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="tm-chrome border-e border-default/70"
      :ui="{ footer: 'lg:border-t lg:border-default/70' }"
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
          :ui="{
            link: 'data-[active]:text-highlighted! data-[active]:before:bg-primary/10 data-[active]:before:ring-1 data-[active]:before:ring-inset data-[active]:before:ring-primary/25 data-[state=open]:text-highlighted! data-[state=open]:before:bg-primary/10 data-[state=open]:before:ring-1 data-[state=open]:before:ring-inset data-[state=open]:before:ring-primary/25',
            childLink: 'data-[active]:text-highlighted! data-[active]:before:bg-primary/10 data-[active]:before:ring-1 data-[active]:before:ring-inset data-[active]:before:ring-primary/25'
          }"
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
