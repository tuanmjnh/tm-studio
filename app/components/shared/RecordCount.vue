<script setup lang="ts">
const props = withDefaults(defineProps<{
  count?: number
  hasMore?: boolean
}>(), {
  count: 0,
  hasMore: false
})

const { t } = useI18n()
</script>

<template>
  <span class="flex items-center gap-1.5 text-[11px] sm:text-xs text-muted font-medium shrink-0 whitespace-nowrap">
    <strong class="text-highlighted font-semibold">{{ props.hasMore ? `${props.count}+` : props.count }}</strong>
    {{ t('common.records') }}
  </span>
</template>
