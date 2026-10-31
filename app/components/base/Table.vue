<script setup lang="ts" generic="T">
import type { TableColumn } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  data: T[]
  columns: TableColumn<T>[]
  loading?: boolean
  total?: number
  pageSize?: number
  page?: number
  styled?: boolean
  ui?: Record<string, unknown>
}>(), {
  loading: false,
  total: undefined,
  pageSize: 10,
  page: 1,
  styled: true,
  ui: () => ({})
})

const emit = defineEmits<{
  'update:page': [page: number]
}>()

const currentPage = computed({
  get: () => props.page,
  set: val => emit('update:page', val)
})

const tableUi = computed(() => {
  if (!props.styled) return props.ui
  return {
    base: 'table-fixed border-separate border-spacing-0',
    thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
    tbody: '[&>tr]:last:[&>td]:border-b-0',
    th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
    td: 'border-b border-default',
    separator: 'h-0',
    ...props.ui
  }
})
</script>

<template>
  <div class="space-y-4 flex flex-col flex-1 min-h-0">
    <div class="overflow-x-auto">
      <UTable
        v-bind="$attrs"
        :data="data"
        :columns="columns"
        :loading="loading"
        :ui="tableUi"
      >
        <template v-for="(_, name) in $slots" #[name]="slotData">
          <slot :name="name" v-bind="slotData" />
        </template>
      </UTable>
    </div>

    <div v-if="total !== undefined && total > 0" class="flex items-center justify-between gap-3 border-t border-default pt-4 mt-auto">
      <slot name="footer-left">
        <div class="text-sm text-muted">
          <slot name="footer-text">
            {{ $t('global.showingCount', { count: data.length, total }) }}
          </slot>
        </div>
      </slot>

      <slot name="footer-right">
        <UPagination
          v-model:page="currentPage"
          :items-per-page="pageSize"
          :total="total"
        />
      </slot>
    </div>
  </div>
</template>
