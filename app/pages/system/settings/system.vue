<script setup lang="ts">
const { t } = useI18n()

interface HealthPayload {
  config?: {
    authProvider?: string
    mongodbUri?: string
    supabaseUrl?: string
    supabaseKey?: string
    supabaseServiceRoleKey?: string
    appPort?: number
  }
  database?: string
  adapter?: string
  testUser?: string
  error?: string
}

const health = ref<HealthPayload | null>(null)
const healthLoading = ref(false)
const healthError = ref(false)

const loadHealth = async () => {
  healthLoading.value = true
  healthError.value = false
  try {
    const res = await $fetch<{ success: boolean, data: HealthPayload }>('/api/health')
    health.value = res.data
  } catch {
    health.value = null
    healthError.value = true
  } finally {
    healthLoading.value = false
  }
}

onMounted(loadHealth)

const dbConnected = computed(() => health.value?.database === 'connected')

const stats = computed(() => {
  const cfg = health.value?.config
  if (!cfg) return []
  return [
    { label: t('settings.primaryDatabase'), value: health.value?.adapter || health.value?.database || '—' },
    { label: t('settings.defaultPort'), value: String(cfg.appPort ?? '—') },
    { label: t('settings.authProvider'), value: cfg.authProvider || '—' },
    { label: t('settings.supabase'), value: cfg.supabaseUrl === '(set)' ? t('settings.configured') : t('settings.notConfigured') }
  ]
})

useHead({ title: computed(() => t('nav.system')) })
</script>

<template>
  <UCard>
    <div class="mb-4 flex items-center justify-between gap-3">
      <h2 class="text-sm font-medium text-highlighted">
        {{ t('settings.systemHealth') }}
      </h2>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        :loading="healthLoading"
        :aria-label="t('common.refresh')"
        @click="loadHealth"
      />
    </div>

    <USkeleton v-if="healthLoading && !health" class="h-40 w-full" />

    <div v-else-if="health" class="space-y-5">
      <UAlert
        :color="dbConnected ? 'success' : 'error'"
        variant="subtle"
        :icon="dbConnected ? 'i-lucide-circle-check' : 'i-lucide-circle-x'"
        :title="dbConnected ? t('settings.healthy') : t('settings.unhealthy')"
        :description="health.error || `${t('settings.primaryDatabase')}: ${health.adapter || health.database || '—'}`"
      />
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div v-for="stat in stats" :key="stat.label" class="panel p-4">
          <p class="text-xs font-medium text-muted">
            {{ stat.label }}
          </p>
          <p class="mt-1 truncate font-mono text-sm font-semibold text-highlighted">
            {{ stat.value }}
          </p>
        </div>
      </div>
    </div>

    <UAlert
      v-else
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('error.serverError')"
      :description="healthError ? t('settings.healthUnavailable') : undefined"
    >
      <template #actions>
        <UButton
          :label="t('global.retry')"
          color="warning"
          variant="soft"
          size="sm"
          @click="loadHealth"
        />
      </template>
    </UAlert>

    <template #footer>
      <div class="flex justify-start">
        <UButton
          :label="t('nav.docs')"
          icon="i-lucide-book-open"
          color="neutral"
          variant="ghost"
          to="/system/docs"
        />
      </div>
    </template>
  </UCard>
</template>
