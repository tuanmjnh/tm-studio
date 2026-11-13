<script setup lang="ts">
import { FormModal as TmFormModal } from '@tuanmjnh/tm-ui'
import type { FormSubmitEvent } from '@nuxt/ui'

defineOptions({ inheritAttrs: false })

defineProps<{
  title: string
  description?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema?: any
  state: Record<string, unknown>
  loading?: boolean
  submitLabel?: string
  cancelLabel?: string
  ui?: Record<string, unknown>
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  submit: [event: FormSubmitEvent<Record<string, unknown>>]
  cancel: []
}>()

const { t } = useI18n()
</script>

<template>
  <TmFormModal v-model:open="open" :title="title" :description="description" :schema="schema" :state="state"
    :loading="loading" :ui="ui" :cancel-label="cancelLabel || t('global.cancel')"
    :submit-label="submitLabel || t('global.save')" v-bind="$attrs" @submit="emit('submit', $event)"
    @cancel="emit('cancel')">
    <template v-for="(_, name) in $slots" #[name]="data">
      <slot :name="name" v-bind="data ?? {}" />
    </template>
  </TmFormModal>
</template>
