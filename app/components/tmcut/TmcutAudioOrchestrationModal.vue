<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutAudioOrchestration } from '~/composables/useTmcutAudioOrchestration'
import { useTmcutAi } from '~/composables/useTmcutAi'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ (e: 'saved'): void }>()

const { t } = useI18n()
const toast = useToast()

const {
  orchestrating,
  lastError,
  candidatePool,
  orchestrate
} = useTmcutAudioOrchestration()

const { isDesktop } = useTmcutAi()

const dialoguePresent = ref(false)
const bedVolume = ref(35)
const doMusic = ref(true)
const doSfx = ref(true)

const candidates = computed(() => candidatePool())

function handleOrchestrate() {
  const result = orchestrate({ music: doMusic.value, sfx: doSfx.value, dialoguePresent: dialoguePresent.value, bedVolume: bedVolume.value })
  if (!result) {
    toast.add({
      title: t('tmcut.audioOrchestration.errorTitle'),
      description: lastError.value || t('tmcut.audioOrchestration.noCandidateDesc'),
      color: 'error'
    })
    return
  }
  if (result.applied === 0) {
    toast.add({
      title: t('tmcut.audioOrchestration.noCandidateTitle'),
      description: t('tmcut.audioOrchestration.noCandidateDesc'),
      color: 'warning'
    })
  } else {
    toast.add({
      title: t('tmcut.audioOrchestration.successTitle'),
      description: t('tmcut.audioOrchestration.appliedDesc', { n: result.applied, skipped: result.skippedOps }),
      color: 'success'
    })
    emit('saved')
    open.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'max-w-2xl' }">
    <template #content>
      <div class="p-6 flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-9 h-9 rounded-lg bg-primary-500/10 flex items-center justify-center text-primary-500">
              <UIcon name="i-lucide-music-2" class="w-5 h-5" />
            </div>
            <div>
              <h3 class="text-base font-semibold text-neutral-900 dark:text-white">
                {{ t('tmcut.audioOrchestration.title') }}
              </h3>
              <p class="text-xs text-neutral-500">
                {{ t('tmcut.audioOrchestration.subtitle') }}
              </p>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            size="sm"
            @click="open = false"
          />
        </div>

        <div v-if="!isDesktop" class="rounded-md bg-amber-500/10 border border-amber-500/30 p-2.5">
          <p class="text-[11px] text-amber-200 flex items-center gap-1.5">
            <UIcon name="i-lucide-monitor-off" class="size-3.5" />
            {{ t('tmcut.audioOrchestration.webOnly') }}
          </p>
        </div>

        <div class="flex items-center gap-4">
          <UCheckbox v-model="doMusic" name="music">
            {{ t('tmcut.audioOrchestration.musicBed') }}
          </UCheckbox>
          <UCheckbox v-model="doSfx" name="sfx">
            {{ t('tmcut.audioOrchestration.sfxCues') }}
          </UCheckbox>
          <UCheckbox v-model="dialoguePresent" name="dialogue">
            {{ t('tmcut.audioOrchestration.hasDialogue') }}
          </UCheckbox>
        </div>

        <div class="flex items-center gap-3">
          <label for="tmcut-audio-bed-volume" class="text-xs font-medium text-neutral-700 dark:text-neutral-300">{{ t('tmcut.audioOrchestration.bedVolume') }}</label>
          <!-- UInputNumber forwards `id` to its inner <input>, so this is a real
               label association (the control is labelable, unlike the slider and
               select roots elsewhere in the editor). -->
          <UInputNumber
            id="tmcut-audio-bed-volume"
            v-model="bedVolume"
            :min="0"
            :max="100"
          />
        </div>

        <div class="rounded-lg border border-neutral-300 dark:border-neutral-800 overflow-hidden max-h-56">
          <div class="px-3 py-1.5 bg-neutral-100/80 dark:bg-neutral-900/80 border-b border-neutral-300 dark:border-neutral-800 text-[11px] font-semibold">
            {{ t('tmcut.audioOrchestration.candidatesTitle') }} ({{ candidates.length }})
          </div>
          <div class="overflow-y-auto max-h-40 p-2 space-y-1">
            <div v-for="c in candidates" :key="c.mediaRef" class="text-[11px] font-mono truncate">
              {{ c.mediaRef }} — {{ c.name }} ({{ c.origin }} / {{ c.licenseStatus }})
            </div>
            <div v-if="candidates.length === 0" class="text-[11px] text-neutral-500 px-2 py-2">
              {{ t('tmcut.audioOrchestration.noCandidates') }}
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" @click="open = false">
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            :loading="orchestrating"
            :disabled="!isDesktop"
            @click="handleOrchestrate"
          >
            {{ t('tmcut.audioOrchestration.applyButton') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
