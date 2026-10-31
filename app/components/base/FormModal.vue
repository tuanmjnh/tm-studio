<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

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

function onCancel() {
  open.value = false
  emit('cancel')
}
</script>

<template>
  <BaseResponsiveModal
    v-model:open="open"
    :title="title"
    :description="description"
    :ui="ui"
    :close="!loading"
    :dismissible="!loading"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="emit('submit', $event)"
      >
        <slot />

        <slot name="actions">
          <div class="flex justify-end gap-2 pt-2">
            <UButton
              :label="cancelLabel || t('global.cancel')"
              color="neutral"
              variant="ghost"
              :disabled="loading"
              @click="onCancel"
            />
            <UButton
              type="submit"
              :label="submitLabel || t('global.save')"
              :loading="loading"
            />
          </div>
        </slot>
      </UForm>
    </template>
  </BaseResponsiveModal>
</template>
