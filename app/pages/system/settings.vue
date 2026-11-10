<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { t } = useI18n()

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('settings.appearance'), icon: 'i-lucide-palette', to: '/system/settings/appearance' },
  { label: t('settings.production'), icon: 'i-lucide-shield-check', to: '/system/settings/production' },
  { label: t('nav.system'), icon: 'i-lucide-cpu', to: '/system/settings/system' },
  { label: t('profile.info'), icon: 'i-lucide-user-circle', to: '/system/settings/profile' },
  { label: t('profile.security'), icon: 'i-lucide-shield', to: '/system/settings/security' },
  { label: t('profile.sessions'), icon: 'i-lucide-monitor-smartphone', to: '/system/settings/sessions' },
  { label: t('devices.myTitle'), icon: 'i-lucide-laptop-minimal', to: '/system/settings/devices' },
  { label: t('notifications.pushTitle'), icon: 'i-lucide-radio-tower', to: '/system/settings/push' }
])
</script>

<template>
  <BasePage id="settings" :title="t('settings.title')" :description="t('settings.description')">
    <BaseSectionNav :items="navItems">
      <NuxtPage />
    </BaseSectionNav>
  </BasePage>
</template>
