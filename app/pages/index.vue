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
    accent: 'var(--color-studio-mint)',
    title: t('nav.ai_keys'),
    description: t('home.cards.aiKeys')
  }
])
</script>

<template>
  <BasePage id="home" :title="t('nav.home')" :description="t('home.description')">
    <template #right>
      <UButton to="/tmcut" color="primary" variant="soft" icon="i-lucide-clapperboard">
        {{ t('nav.tmcut') }}
      </UButton>
    </template>

    <div class="relative">
      <div class="tm-iso-region" aria-hidden="true">
        <div class="tm-iso-grid" />
      </div>

      <BaseBentoGrid>
        <!-- Hero -->
        <BaseBentoCard :span="12" :span-sm="6" refract>
          <div class="relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
            <div class="tm-orb-soft -right-24 -bottom-40 size-104" aria-hidden="true" />

            <div class="relative max-w-xl">
              <p class="text-[10px] font-semibold uppercase tracking-[0.16em] text-dimmed">
                {{ t('home.heroEyebrow') }}
              </p>
              <h2
                class="mt-2 text-2xl font-semibold leading-tight tracking-[-0.03em] text-highlighted sm:text-[1.75rem]">
                {{ t('home.heroTitle') }}
              </h2>
              <p class="mt-2 text-sm leading-relaxed text-toned">
                {{ t('home.heroSubtitle') }}
              </p>

              <div class="mt-5 flex flex-wrap items-center gap-2">
                <UButton to="/tmcut" color="primary" variant="solid" size="sm" icon="i-lucide-clapperboard">
                  {{ t('nav.tmcut') }}
                </UButton>
                <UButton to="/resources/connections" color="neutral" variant="soft" size="sm" icon="i-lucide-cable">
                  {{ t('nav.connections') }}
                </UButton>
                <UButton to="/system/ai-keys" color="neutral" variant="ghost" size="sm" icon="i-lucide-brain">
                  {{ t('nav.ai_keys') }}
                </UButton>
              </div>
            </div>
          </div>
        </BaseBentoCard>

        <!-- Modules -->
        <BaseBentoCard v-for="card in cards" :key="card.to" :span="4" :span-sm="6">
          <NuxtLink :to="card.to" class="group flex h-full flex-col gap-3 p-4"
            :style="{ '--tile-accent': card.accent }">
            <span
              class="grid size-9 shrink-0 place-items-center rounded-[4px] border border-default/70 bg-elevated/40 text-(--tile-accent)">
              <UIcon :name="card.icon" class="size-4" />
            </span>

            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-semibold tracking-tight text-highlighted">{{ card.title }}</p>
              <p class="mt-1 text-[11px] leading-relaxed text-muted">{{ card.description }}</p>
            </div>

            <p class="flex items-center gap-1 text-[11px] font-medium text-primary">
              {{ t('home.open') }}
              <UIcon name="i-lucide-arrow-right" class="size-3 transition-transform group-hover:translate-x-0.5" />
            </p>
          </NuxtLink>
        </BaseBentoCard>
      </BaseBentoGrid>
    </div>
  </BasePage>
</template>
