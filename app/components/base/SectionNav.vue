<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

defineProps<{ items: NavigationMenuItem[] }>()
</script>

<template>
  <div class="flex flex-col md:flex-row gap-4 md:gap-0 w-full">
    <nav
      class="w-full md:w-52 shrink-0 border-b md:border-b-0 md:border-e border-default md:pe-5 pb-3 md:pb-0 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden"
      :aria-label="$t('common.navigation')"
    >
      <!-- Mobile: Horizontal navigation -->
      <UNavigationMenu
        :items="items"
        orientation="horizontal"
        class="md:hidden w-full"
        :ui="{
          list: 'flex-nowrap gap-1',
          item: 'shrink-0',
          link: 'shrink-0 whitespace-nowrap',
          linkLabel: 'truncate-none whitespace-nowrap'
        }"
      />

      <!-- Desktop: Vertical navigation -->
      <UNavigationMenu :items="items" orientation="vertical" class="hidden md:flex w-full" />
    </nav>
    <div class="flex-1 min-w-0 w-full md:ps-5">
      <slot />
    </div>
  </div>
</template>
