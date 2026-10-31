<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'

const { t } = useI18n()
const { hubFetch, appId } = useHub()
const { fetchNotify, success: notifySuccess, error: notifyError, warning: notifyWarning } = useNotify()

const open = defineModel<boolean>('open', { default: false })

const sendForm = reactive({
  title: '',
  body: '',
  icon: '',
  url: '',
  userId: ''
})
const isSending = ref(false)

async function handleSend() {
  if (isSending.value) return
  if (!sendForm.title.trim() || !sendForm.body.trim()) {
    notifyWarning(t('notifications.sendFailed'), t('error.required'))
    return
  }

  isSending.value = true
  try {
    const res = await hubFetch<{ success: boolean, sentCount: number }>(
      `/api/v1/apps/${appId}/notifications/send`,
      {
        method: 'POST',
        body: {
          title: sendForm.title.trim(),
          body: sendForm.body.trim(),
          icon: sendForm.icon.trim() || undefined,
          url: sendForm.url.trim() || undefined,
          userId: sendForm.userId.trim() || undefined
        }
      }
    )
    notifySuccess(t('notifications.sendSuccess'), t('notifications.sendSuccessDesc', { count: res.sentCount || 0 }))
    Object.assign(sendForm, { title: '', body: '', icon: '', url: '', userId: '' })
    open.value = false
    await fetchNotify()
  } catch (err: any) {
    notifyError(t('notifications.sendFailed'), getErrorMessage(err, key => t(key)))
  } finally {
    isSending.value = false
  }
}
</script>

<template>
  <BaseResponsiveSlideover
    v-model:open="open"
    :title="t('notifications.sendTitle')"
    icon="i-lucide-send"
    side="right"
  >
    <template #body>
      <form class="space-y-4" @submit.prevent="handleSend">
        <UFormField :label="t('notifications.fieldTitle')" name="title" required>
          <UInput
            v-model="sendForm.title"
            :placeholder="t('notifications.fieldTitlePlaceholder')"
            class="w-full"
            size="lg"
          />
        </UFormField>
        <UFormField :label="t('notifications.fieldBody')" name="body" required>
          <UTextarea
            v-model="sendForm.body"
            name="body"
            :rows="4"
            :placeholder="t('notifications.fieldBodyPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="t('notifications.fieldUrl')">
          <UInput
            v-model="sendForm.url"
            icon="i-lucide-link"
            placeholder="https://..."
            class="w-full"
          />
        </UFormField>
        <UFormField :label="t('notifications.fieldUserId')">
          <UInput v-model="sendForm.userId" :placeholder="t('notifications.fieldUserIdPlaceholder')" class="w-full" />
        </UFormField>
      </form>
    </template>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="open = false"
        />
        <UButton
          icon="i-lucide-send"
          :label="t('notifications.send')"
          variant="soft"
          color="primary"
          :loading="isSending"
          @click="handleSend"
        />
      </div>
    </template>
  </BaseResponsiveSlideover>
</template>
