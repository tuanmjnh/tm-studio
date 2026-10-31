<script setup lang="ts">
const { t } = useI18n()

definePageMeta({
  title: 'nav.home'
})
</script>

<template>
  <BasePage id="home" :title="t('nav.home')" :description="t('nav.home')">
    <template #right>
      <UButton
        :to="'/tmcut'"
        color="primary"
        variant="soft"
        icon="i-lucide-clapperboard"
      >
        {{ t('nav.tmcut') }}
      </UButton>
    </template>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-clapperboard" class="size-5 text-primary" />
            <span class="font-medium">{{ t('nav.tmcut') }}</span>
          </div>
        </template>
        <p class="text-sm text-muted">
          {{ t('nav.tmcut_dashboard') }}
        </p>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-cable" class="size-5 text-primary" />
            <span class="font-medium">{{ t('nav.connections') }}</span>
          </div>
        </template>
        <p class="text-sm text-muted">
          {{ t('nav.resources') }}
        </p>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-brain" class="size-5 text-primary" />
            <span class="font-medium">{{ t('nav.ai_keys') }}</span>
          </div>
        </template>
        <p class="text-sm text-muted">
          {{ t('nav.system') }}
        </p>
      </UCard>
    </div>
  </BasePage>
</template>
