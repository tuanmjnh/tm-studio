<script setup lang="ts">
import { ListFooter as TmListFooter } from '@tuanmjnh/tm-ui'

const props = withDefaults(defineProps<{
  count?: number
  hasMore?: boolean
  loading?: boolean
  showNoMore?: boolean
}>(), {
  count: 0,
  hasMore: false,
  loading: false,
  showNoMore: false
})

const { t } = useI18n()
</script>

<template>
  <TmListFooter
    :count="props.count"
    :has-more="props.hasMore"
    :loading="props.loading"
    :show-no-more="props.showNoMore"
    :records-label="t('common.records')"
    :loading-label="t('common.loading_text')"
    :no-more-label="t('common.no_more_data')"
  >
    <template #left>
      <slot name="left" />
    </template>
    <template #right>
      <slot name="right" />
    </template>
  </TmListFooter>
</template>
