<script setup lang="ts">
import { getErrorMessage } from '~/shared/utils/errors'

const props = defineProps<{
  base: string
}>()

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  sent: []
}>()

const { t } = useI18n()
const notify = useNotify()
const { hubFetch } = useHub()

const to = ref('')
const subject = ref('')
const body = ref('')
const sending = ref(false)

function reset() {
  to.value = ''
  subject.value = ''
  body.value = ''
}

async function handleSend() {
  const targetTo = to.value.trim()
  const targetSub = subject.value.trim()
  const targetBody = body.value.trim()

  if (!targetTo || !targetSub || !targetBody) return

  sending.value = true
  try {
    await hubFetch(`${props.base}/messages/send`, {
      method: 'POST',
      body: {
        to: targetTo,
        subject: targetSub,
        body: targetBody
      }
    })
    notify.success(t('inbox.mailSent'))
    open.value = false
    reset()
    emit('sent')
  } catch (err) {
    notify.error(getErrorMessage(err, key => t(key)))
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <BaseResponsiveModal
    v-model:open="open"
    :title="t('inbox.newMail')"
    :description="t('inbox.description')"
    icon="i-lucide-square-pen"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <form id="compose-form" class="space-y-4" @submit.prevent="handleSend">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-highlighted flex items-center justify-between">
          <span>{{ t('inbox.to') }}</span>
          <span class="text-muted text-[11px]">*</span>
        </label>
        <UInput
          v-model="to"
          type="email"
          required
          icon="i-lucide-at-sign"
          :placeholder="t('inbox.toPlaceholder')"
          class="w-full"
          :disabled="sending"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-xs font-medium text-highlighted flex items-center justify-between">
          <span>{{ t('inbox.subject') }}</span>
          <span class="text-muted text-[11px]">*</span>
        </label>
        <UInput
          v-model="subject"
          required
          icon="i-lucide-heading"
          :placeholder="t('inbox.subjectPlaceholder')"
          class="w-full"
          :disabled="sending"
        />
      </div>

      <div class="space-y-1.5">
        <label class="text-xs font-medium text-highlighted flex items-center justify-between">
          <span>{{ t('inbox.replyPlaceholder') }}</span>
          <span class="text-muted text-[11px]">*</span>
        </label>
        <UTextarea
          v-model="body"
          required
          autoresize
          :rows="8"
          :placeholder="t('inbox.bodyPlaceholder')"
          class="w-full font-mono text-xs sm:text-sm"
          :disabled="sending"
        />
      </div>
    </form>

    <template #footer>
      <div class="flex items-center justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :label="t('inbox.discard')"
          :disabled="sending"
          @click="open = false"
        />
        <UButton
          type="submit"
          form="compose-form"
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-send"
          :label="t('inbox.sendMail')"
          :loading="sending"
        />
      </div>
    </template>
  </BaseResponsiveModal>
</template>
