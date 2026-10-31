<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const { t } = useI18n()
const toast = useToast()
const auth = useAuth()
const { uploadToCloudinary } = useCloudinary()

const open = defineModel<boolean>('open', { default: false })
const loading = ref(false)
const uploadingFile = ref(false)
const uploadProgress = ref(0)

const schema = z.object({
  type: z.enum(['bug', 'feature', 'question', 'other']),
  email: z.string().email(t('error.validation')),
  title: z.string().min(3, t('error.validation')),
  description: z.string().min(10, t('error.validation')),
  screenshot: z.string().optional()
})

type FeedbackState = z.infer<typeof schema>

const state = reactive<FeedbackState>({
  type: 'bug',
  email: auth.user.value?.email || '',
  title: '',
  description: '',
  screenshot: ''
})

// Prefill email when user changes
watch(() => auth.user.value, (user) => {
  if (user?.email) {
    state.email = user.email
  }
}, { immediate: true })

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  uploadingFile.value = true
  uploadProgress.value = 0
  try {
    const res = await uploadToCloudinary(file, 'feedback', (progress) => {
      uploadProgress.value = progress
    })
    state.screenshot = res.secure_url
    toast.add({ title: t('global.success'), description: t('media.file_uploaded_title') || 'Image uploaded' })
  } catch (error) {
    toast.add({ title: t('global.error'), description: error instanceof Error ? error.message : 'Upload failed', color: 'error' })
  } finally {
    uploadingFile.value = false
    uploadProgress.value = 0
  }
}

async function onSubmit(event: FormSubmitEvent<Record<string, unknown>>) {
  loading.value = true
  try {
    const data = event.data as unknown as FeedbackState
    await $fetch('/api/system/feedback', {
      method: 'POST',
      body: data
    })
    toast.add({
      title: t('feedback.success_title'),
      description: t('feedback.success_desc'),
      color: 'success'
    })
    open.value = false
    // reset form except email
    state.title = ''
    state.description = ''
    state.screenshot = ''
    state.type = 'bug'
  } catch (error) {
    toast.add({
      title: t('global.error'),
      description: error instanceof Error ? error.message : 'Submission failed',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <BaseFormModal
    v-model:open="open"
    :title="t('feedback.title')"
    :description="t('feedback.desc')"
    :schema="schema"
    :state="state"
    :loading="loading"
    :submit-label="t('feedback.submit')"
    @submit="onSubmit"
  >
    <UFormField :label="t('feedback.type')" name="type">
      <USelect
        v-model="state.type"
        :items="[
          { label: t('feedback.type_bug'), value: 'bug' },
          { label: t('feedback.type_feature'), value: 'feature' },
          { label: t('feedback.type_question'), value: 'question' },
          { label: t('feedback.type_other'), value: 'other' }
        ]"
        class="w-full"
      />
    </UFormField>

    <UFormField :label="t('feedback.email')" name="email">
      <UInput v-model="state.email" type="email" class="w-full" />
    </UFormField>

    <UFormField :label="t('feedback.subject')" name="title">
      <UInput v-model="state.title" :placeholder="t('feedback.subject_placeholder')" class="w-full" />
    </UFormField>

    <UFormField :label="t('feedback.details')" name="description">
      <UTextarea
        v-model="state.description"
        :placeholder="t('feedback.details_placeholder')"
        :rows="4"
        class="w-full"
      />
    </UFormField>

    <UFormField :label="t('feedback.screenshot')" name="screenshot">
      <div class="space-y-2 w-full">
        <UInput v-model="state.screenshot" placeholder="https://..." class="w-full">
          <template #trailing>
            <div class="relative flex items-center h-full">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-upload"
                :loading="uploadingFile"
                class="relative overflow-hidden cursor-pointer"
              >
                <input
                  type="file"
                  accept="image/*"
                  class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  @change="onFileChange"
                >
              </UButton>
            </div>
          </template>
        </UInput>

        <!-- Progress Bar -->
        <UProgress
          v-if="uploadingFile"
          :model-value="uploadProgress"
          :max="100"
          class="h-1"
        />

        <!-- Image Preview -->
        <div
          v-if="state.screenshot"
          class="relative w-full max-h-40 rounded-lg overflow-hidden border border-default bg-muted/10 flex items-center justify-center p-1"
        >
          <img :src="state.screenshot" class="max-w-full max-h-36 object-contain rounded">
          <UButton
            icon="i-lucide-x"
            size="xs"
            color="error"
            variant="solid"
            class="absolute top-2 right-2 rounded-full"
            @click="state.screenshot = ''"
          />
        </div>
      </div>
    </UFormField>
  </BaseFormModal>
</template>
