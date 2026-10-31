<script setup lang="ts">
// =============================================================================
//  Avatar picker (single image) — upload to Cloudinary or paste a URL.
//
//  TMCut has no media-library page, so the old LazyMediaGallery reference in
//  the profile modal never resolved. This keeps the same contract (a single
//  image URL out) without porting the full gallery: the signed upload goes
//  through useCloudinary, which proxies the hub media signature server-side.
// =============================================================================
const model = defineModel<string | null>({ default: null })

const props = withDefaults(defineProps<{
  folder?: string
  alt?: string
}>(), {
  folder: 'avatars',
  alt: ''
})

const { t } = useI18n()
const { uploadToCloudinary } = useCloudinary()

const fileInputRef = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const progress = ref(0)
const error = ref('')

const urlValue = computed({
  get: () => model.value ?? '',
  set: (value: string) => {
    model.value = value.trim() || null
  }
})

function openFilePicker() {
  fileInputRef.value?.click()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  uploading.value = true
  progress.value = 0
  error.value = ''
  try {
    const res = await uploadToCloudinary(file, props.folder, (value) => {
      progress.value = value
    })
    model.value = res.secure_url || res.url || null
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('media.upload_error')
  } finally {
    uploading.value = false
    progress.value = 0
  }
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-center">
      <UAvatar
        :src="model || undefined"
        :alt="alt"
        size="3xl"
        class="ring-2 ring-default"
      />
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      @change="onFileChange"
    >

    <UButton
      icon="i-lucide-upload"
      color="primary"
      variant="soft"
      block
      class="justify-center"
      :loading="uploading"
      :label="uploading ? t('media.uploading_text') : t('media.upload_from_computer_text')"
      @click="openFilePicker"
    />

    <UProgress
      v-if="uploading"
      :model-value="progress"
      :max="100"
      class="h-1"
    />

    <p v-if="error" class="flex items-start gap-1.5 text-xs text-red-400">
      <UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0 mt-0.5" />
      <span>{{ error }}</span>
    </p>

    <div class="flex items-center gap-2 text-[11px] uppercase tracking-wider text-dimmed">
      <span class="h-px flex-1 bg-default" />
      <span>{{ t('common.or') }}</span>
      <span class="h-px flex-1 bg-default" />
    </div>

    <UInput
      v-model="urlValue"
      icon="i-lucide-link"
      class="w-full"
      placeholder="https://"
      :aria-label="t('media.image_url')"
    >
      <template v-if="urlValue" #trailing>
        <UButton
          color="neutral"
          variant="link"
          size="xs"
          icon="i-lucide-x"
          :aria-label="t('common.clear')"
          @click="urlValue = ''"
        />
      </template>
    </UInput>
  </div>
</template>
