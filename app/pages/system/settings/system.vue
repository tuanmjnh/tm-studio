<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { t } = useI18n()

const health = ref<{ status: string, version: string, db: string, uptimeSec: number } | null>(null)
const healthLoading = ref(false)

const loadHealth = async () => {
  healthLoading.value = true
  try {
    const res = await $fetch<{ success: boolean, data: any }>('/api/v1/health')
    health.value = res.data
  } catch {
    health.value = null
  } finally {
    healthLoading.value = false
  }
}

onMounted(loadHealth)

const formatUptime = (sec?: number) => {
  if (sec === undefined || sec === null || Number.isNaN(sec)) return '—'
  const s = Math.max(0, Math.floor(sec))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${r}s`
  return `${r}s`
}

const stats = computed(() => health.value
  ? [
      { label: t('settings.hubVersion'), value: health.value.version || '—' },
      { label: t('settings.primaryDatabase'), value: health.value.db || '—' },
      { label: t('settings.uptime'), value: formatUptime(health.value.uptimeSec) },
      { label: t('settings.defaultPort'), value: '3000' }
    ]
  : [])

const navItems = computed<NavigationMenuItem[]>(() => [
  { label: t('settings.appearance'), icon: 'i-lucide-palette', to: '/system/settings' },
  { label: t('nav.system'), icon: 'i-lucide-cpu', to: '/system/settings/system' }
])

const mobileBar = useMobileBar()
mobileBar.registerActions(computed(() => [
  {
    icon: 'i-lucide-refresh-cw',
    label: t('common.refresh'),
    disabled: healthLoading.value,
    onSelect: loadHealth
  }
]))

useHead({ title: computed(() => t('nav.system')) })
</script>

<template>
  <BasePage id="settings" :title="t('nav.system')" :description="t('settings.systemDesc')">
    <template #right>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="soft"
        size="sm"
        square
        :loading="healthLoading"
        :aria-label="t('common.refresh')"
        @click="loadHealth"
      />
    </template>

    <BaseSectionNav :items="navItems">
      <UCard>
        <USkeleton v-if="healthLoading && !health" class="h-40 w-full" />

        <div v-else-if="health" class="space-y-5">
          <UAlert
            :color="health.status === 'healthy' ? 'success' : 'warning'"
            variant="subtle"
            :icon="health.status === 'healthy' ? 'i-lucide-check-circle' : 'i-lucide-alert-triangle'"
            :title="health.status"
            :description="`${t('settings.primaryDatabase')}: ${health.db}`"
          />
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="stat in stats" :key="stat.label" class="rounded-xl border border-default bg-elevated/40 p-4">
              <p class="text-xs font-medium text-muted">
                {{ stat.label }}
              </p>
              <p class="mt-1 truncate text-sm font-semibold text-highlighted font-mono">
                {{ stat.value }}
              </p>
            </div>
          </div>
        </div>

        <UAlert
          v-else
          color="warning"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          :title="t('error.serverError')"
        />

        <template #footer>
          <div class="flex justify-start">
            <UButton
              :label="t('nav.docs')"
              icon="i-lucide-book-open"
              color="neutral"
              variant="soft"
              to="/system/docs"
            />
          </div>
        </template>
      </UCard>
    </BaseSectionNav>
  </BasePage>
</template>
