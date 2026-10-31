<script setup lang="ts">
const { t } = useI18n()

const props = withDefaults(defineProps<{
  count?: number
  hasMore?: boolean
  loading?: boolean
}>(), {
  count: 0,
  hasMore: false,
  loading: false
})
</script>

<template>
  <!-- min-h-8: matches the sidebar UserMenu footer row height (49px with wrapper py-2 + border) -->
  <div class="flex min-h-8 items-center justify-between gap-3 w-full">
    <div class="flex items-center gap-2 min-w-0">
      <slot name="left" />
    </div>

    <div class="flex items-center gap-3 shrink-0">
      <slot name="right" />

      <div class="flex items-center gap-2 text-[11px] sm:text-xs text-muted font-medium">
        <SharedRecordCount :count="props.count" :has-more="props.hasMore" />

        <div v-if="props.loading" class="flex items-center gap-1.5 text-primary">
          <UIcon name="i-lucide-loader-2" class="size-3.5 animate-spin" />
          <span class="hidden sm:inline text-xs">{{ t('common.loading_text') }}</span>
        </div>

        <div
          v-else-if="!props.hasMore && props.count > 0"
          class="hidden sm:flex items-center gap-1.5 text-dimmed italic"
        >
          <UIcon name="i-lucide-check-circle-2" class="size-3.5" />
          {{ t('common.no_more_data') }}
        </div>
      </div>
    </div>
  </div>
</template>
