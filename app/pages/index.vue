<script setup lang="ts">
const { t } = useI18n()

definePageMeta({
  title: 'nav.home'
})

const cards = computed(() => [
  {
    to: '/tmcut',
    icon: 'i-lucide-clapperboard',
    title: t('nav.tmcut'),
    description: t('home.cards.tmcut')
  },
  {
    to: '/resources/connections',
    icon: 'i-lucide-cable',
    title: t('nav.connections'),
    description: t('home.cards.connections')
  },
  {
    to: '/system/ai-keys',
    icon: 'i-lucide-brain',
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
        class="group rounded-lg border border-default bg-default p-4 transition-colors hover:border-primary/40 hover:bg-elevated/40"
      >
        <div class="flex items-start gap-3">
          <span class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <UIcon :name="card.icon" class="size-5" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="font-medium text-highlighted">{{ card.title }}</p>
            <p class="mt-1 text-sm text-muted">{{ card.description }}</p>
            <p class="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
              {{ t('home.open') }}
              <UIcon
                name="i-lucide-arrow-right"
                class="size-3.5 transition-transform group-hover:translate-x-0.5"
              />
            </p>
          </div>
        </div>
      </NuxtLink>
    </div>
  </BasePage>
</template>
