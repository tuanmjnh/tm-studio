<script setup lang="ts">
const { t } = useI18n()

definePageMeta({
  title: 'nav.home'
})

const cards = computed(() => [
  {
    to: '/tmcut',
    icon: 'i-lucide-clapperboard',
    accent: 'var(--ui-primary)',
    title: t('nav.tmcut'),
    description: t('home.cards.tmcut')
  },
  {
    to: '/resources/connections',
    icon: 'i-lucide-cable',
    accent: 'var(--ui-secondary)',
    title: t('nav.connections'),
    description: t('home.cards.connections')
  },
  {
    to: '/system/ai-keys',
    icon: 'i-lucide-brain',
    accent: 'var(--ui-info)',
    title: t('nav.ai_keys'),
    description: t('home.cards.aiKeys')
  }
])
</script>

<template>
  <BasePage id="home" :title="t('nav.home')" :description="t('home.description')">
    <template #right>
      <UButton
        to="/tmcut"
        color="primary"
        variant="soft"
        icon="i-lucide-clapperboard"
      >
        {{ t('nav.tmcut') }}
      </UButton>
    </template>

    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <NuxtLink
        v-for="card in cards"
        :key="card.to"
        :to="card.to"
        class="glass-surface group flex flex-col gap-4 rounded-2xl p-5 transition duration-200 hover:-translate-y-0.5 hover:border-primary/40"
        :style="{ '--tile-accent': card.accent }"
      >
        <span class="studio-icon-tile">
          <UIcon :name="card.icon" class="size-6" />
        </span>

        <div class="min-w-0 flex-1">
          <p class="text-base font-semibold text-highlighted">{{ card.title }}</p>
          <p class="mt-1 text-sm text-muted">{{ card.description }}</p>
        </div>

        <p class="flex items-center gap-1 text-xs font-medium text-primary">
          {{ t('home.open') }}
          <UIcon
            name="i-lucide-arrow-right"
            class="size-3.5 transition-transform group-hover:translate-x-0.5"
          />
        </p>
      </NuxtLink>
    </div>
  </BasePage>
</template>
