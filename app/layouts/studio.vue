<script setup lang="ts">
// Full-bleed studio shell: the editor owns the whole viewport, navigation
// moves into the TmcutNavPopover in the top bar instead of a persistent
// sidebar. Route access is still enforced by the global auth middleware.
const auth = useAuth()
const nav = useNavMenu()

onMounted(() => {
  if (auth.isAuthenticated.value) nav.fetchRoutes()
})
</script>

<template>
  <UDashboardGroup unit="rem">
    <slot />

    <LazyDashboardNotificationsSlideover />
    <LazyDashboardSettingsSlideover />
  </UDashboardGroup>
</template>
