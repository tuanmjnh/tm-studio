<script setup lang="ts" generic="T">
import { Table as TmTable } from '@tuanmjnh/tm-ui'
import type { TableColumn } from '@nuxt/ui'

defineOptions({ inheritAttrs: false })

defineProps<{
  data: T[]
  columns: TableColumn<T>[]
  loading?: boolean
  total?: number
  pageSize?: number
  page?: number
  styled?: boolean
  ui?: Record<string, unknown>
}>()

const emit = defineEmits<{ 'update:page': [page: number] }>()

const { t } = useI18n()
</script>

<template>
  <TmTable :data="data" :columns="columns" :loading="loading" :total="total" :page-size="pageSize" :page="page"
    :styled="styled" :ui="ui" :showing-template="t('global.showingCount')" v-bind="$attrs"
    @update:page="emit('update:page', $event)">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmTable>
</template>
