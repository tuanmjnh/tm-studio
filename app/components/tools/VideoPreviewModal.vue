<script setup lang="ts">
import { computed } from 'vue'
import { tmcutHostBridge } from '~/utils/tmcut/hostBridge'
import { useTmcutPlatform } from '~/composables/useTmcutPlatform'
import { toURL } from '~/utils/tmcut/media'

const props = defineProps<{
  filePath?: string
  title?: string
  /**
   * What the caller knows it produced. Extension matching is the fallback, but
   * a `blob:` URL has no extension: the export's own result is one, and without
   * this the modal answered "unsupported preview format" for a file it had just
   * written.
   */
  kind?: 'video' | 'audio'
}>()

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

// ADR-014: host identity is negotiated once by the adapter, not re-sniffed here.
const platform = useTmcutPlatform()
const isDesktop = computed(() => platform.info.name === 'electron')

const isAudio = computed(() => {
  if (!props.filePath) return false
  // The extension is the fallback; a caller that knows better is believed.
  if (props.kind) return props.kind === 'audio'
  return /\.(mp3|wav|aac|m4a|ogg|flac)$/i.test(props.filePath)
})

const isVideo = computed(() => {
  if (!props.filePath) return false
  if (props.kind) return props.kind === 'video'
  return /\.(mp4|mkv|webm|mov|avi|flv|ts)$/i.test(props.filePath)
})

const mediaUrl = computed(() => {
  if (!props.filePath) return ''
  // Shared builder: local paths via media://, web blob:/http(s): passthrough
  return toURL(props.filePath)
})

function showInFolder() {
  const bridge = tmcutHostBridge()
  if (props.filePath && bridge?.showItemInFolder) {
    bridge.showItemInFolder(props.filePath)
  }
}

async function openDefaultPlayer() {
  const bridge = tmcutHostBridge()
  if (props.filePath && bridge?.openPath) {
    await bridge.openPath(props.filePath)
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title || t('tools.previewResult')"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4">
        <div
          class="flex flex-col items-center justify-center rounded-xl overflow-hidden min-h-75 max-h-[70vh] p-2 bg-black/90"
        >
          <video
            v-if="isVideo"
            :key="mediaUrl"
            :src="mediaUrl"
            controls
            autoplay
            class="w-full max-h-[60vh] rounded-lg object-contain"
          />
          <div
            v-else-if="isAudio"
            class="flex flex-col items-center justify-center p-8 w-full"
          >
            <UIcon
              name="i-lucide-music"
              class="size-16 mb-4 text-primary"
            />
            <audio
              :key="mediaUrl"
              :src="mediaUrl"
              controls
              autoplay
              class="w-full max-w-md"
            />
          </div>
          <div
            v-else
            class="p-8 text-center text-sm text-neutral-400"
          >
            {{ t('tools.unsupportedPreviewFormat') }}
          </div>
        </div>

        <div
          class="flex items-center justify-between p-3 rounded-lg border border-default bg-elevated/50 text-xs"
        >
          <div class="flex items-center gap-2 min-w-0 pr-4">
            <UIcon
              :name="isAudio ? 'i-lucide-file-audio' : 'i-lucide-file-video'"
              class="size-5 shrink-0 text-primary"
            />
            <span
              class="font-mono truncate"
              :title="filePath"
            >{{ filePath }}</span>
          </div>
          <div
            v-if="isDesktop"
            class="flex items-center gap-1.5 shrink-0"
          >
            <UButton
              icon="i-lucide-folder"
              size="xs"
              variant="outline"
              color="neutral"
              :title="t('tools.openInFolder')"
              @click="showInFolder"
            >
              {{ t('tools.openInFolder') }}
            </UButton>
            <UButton
              icon="i-lucide-external-link"
              size="xs"
              variant="soft"
              color="primary"
              :title="t('tools.openWithApp')"
              @click="openDefaultPlayer"
            >
              {{ t('tools.openWithApp') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
