<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

withDefaults(defineProps<{
  items: DropdownMenuItem[][]
  align?: 'start' | 'center' | 'end'
}>(), {
  align: 'end'
})

const { t } = useI18n()
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align }">
    <UButton
      icon="i-lucide-ellipsis-vertical"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="t('common.actions')"
      @click.stop
    />
  </UDropdownMenu>
</template>
