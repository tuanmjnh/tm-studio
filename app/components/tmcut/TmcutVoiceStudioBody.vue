<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutInsertAsset } from '~/composables/useTmcutInsertAsset'
import { secToTicks } from '@tmcut-core'

const props = defineProps<{ embedded?: boolean }>()
const emit = defineEmits<{
  (e: 'voice-added', path: string): void
  (e: 'close'): void
}>()
const { t } = useI18n()
const toast = useToast()
const { pickFile } = useFileSystem()
const { currentProject, addClipToTrack } = useTmcutProject()
const { insertAsset } = useTmcutInsertAsset()

const DEFAULT_LOCAL_URL = 'http://127.0.0.1:8000'
const LOCAL_URL_KEY = 'tmcut_vieneu_base_url'
const baseUrl = ref(DEFAULT_LOCAL_URL)
const apiKey = ref('')
const geminiKeySaved = ref(false)
const geminiKeySaving = ref(false)
const selectedLocalVoice = ref('')
const activeEngine = ref<'local' | 'gemini'>('local')
const localBusy = ref(false)
const geminiBusy = ref(false)
const localOnline = ref(false)
const localError = ref('')
const localVoices = ref<Array<{ name: string, description: string }>>([])
const managedVoices = ref<Array<{ id: string, name: string, engineName: string, description: string, createdAt: string }>>([])
const selectedVoiceId = ref('')
const selectedGeminiVoice = ref('Kore')
const voiceName = ref('')
const voiceDescription = ref('')
const samplePath = ref('')
const narration = ref('')
const style = ref('')
const autoCaptions = ref(true)
const model = ref('gemini-3.8-flash-tts')

const geminiVoices = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
]

// The web build has no IPC: it reaches the local service through the Nitro
// proxy (/api/v1/media/tts) and can only import server-stored audio.
const isDesktop = computed(() => typeof window !== 'undefined' && !!window.electronAPI?.tmcut)

const chosenLocal = computed(() => managedVoices.value.find(voice => voice.id === selectedVoiceId.value) || null)
const selectedEngineVoice = computed(() => chosenLocal.value?.engineName || selectedLocalVoice.value)

function requestError(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  return String(data?.message || (error as Error)?.message || error)
}

function readSavedSettings() {
  if (typeof window === 'undefined') return
  baseUrl.value = localStorage.getItem(LOCAL_URL_KEY) || DEFAULT_LOCAL_URL
  apiKey.value = ''
  geminiKeySaved.value = false
  void window.electronAPI?.getConfig().then((config) => {
    geminiKeySaved.value = !!config?.TMCUT_GEMINI_API_KEY
  }).catch(() => { geminiKeySaved.value = false })
}

function saveLocalUrl() {
  if (typeof window !== 'undefined') localStorage.setItem(LOCAL_URL_KEY, baseUrl.value.trim() || DEFAULT_LOCAL_URL)
}

async function saveGeminiKey(): Promise<boolean> {
  if (!apiKey.value.trim() || !window.electronAPI?.setConfig) return false
  geminiKeySaving.value = true
  try {
    const result = await window.electronAPI.setConfig({ TMCUT_GEMINI_API_KEY: apiKey.value.trim() })
    if (!result?.success) throw new Error(t('tmcut.voice.keySaveFailed'))
    apiKey.value = ''
    geminiKeySaved.value = true
    toast.add({ title: t('tmcut.voice.keySaved'), color: 'success' })
    return true
  } catch (error) {
    toast.add({ title: t('tmcut.voice.keySaveFailed'), description: String((error as Error)?.message || error), color: 'error' })
    return false
  } finally {
    geminiKeySaving.value = false
  }
}

async function loadManagedVoices() {
  const ipc = window.electronAPI?.tmcut
  managedVoices.value = ipc?.listManagedVoices ? await ipc.listManagedVoices() : []
  if (!managedVoices.value.some(voice => voice.id === selectedVoiceId.value)) {
    selectedVoiceId.value = managedVoices.value[0]?.id || ''
  }
}

async function checkLocalService() {
  const ipc = window.electronAPI?.tmcut
  localBusy.value = true
  localError.value = ''
  try {
    if (ipc?.voiceStatus) {
      const result = await ipc.voiceStatus({ baseUrl: baseUrl.value })
      localOnline.value = !!result?.ok
      if (result?.ok && result.data) localVoices.value = result.data.voices
      else localError.value = result?.error || t('tmcut.voice.serviceOffline')
      return
    }
    const result = await $fetch<{ ok: boolean, data: { voices: Array<{ name: string, description: string }> } }>(
      '/api/v1/media/tts/status',
      { query: { baseUrl: baseUrl.value } }
    )
    localOnline.value = true
    localVoices.value = result.data.voices
  } catch (error) {
    localOnline.value = false
    localError.value = requestError(error) || t('tmcut.voice.serviceOffline')
  } finally {
    localBusy.value = false
  }
}

async function chooseSample() {
  const picked = await pickFile({
    title: t('tmcut.voice.pickReference'),
    filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'ogg', 'flac', 'webm'] }]
  })
  if (typeof picked === 'string' && picked) samplePath.value = picked
}

async function addVoice() {
  const ipc = window.electronAPI?.tmcut
  if (!ipc?.addManagedVoice || !samplePath.value || !voiceName.value.trim()) return
  localBusy.value = true
  try {
    const result = await ipc.addManagedVoice({ filePath: samplePath.value, name: voiceName.value.trim(), description: voiceDescription.value.trim() })
    if (!result?.ok || !result.data) throw new Error(result?.error || t('tmcut.voice.addFailed'))
    await loadManagedVoices()
    selectedVoiceId.value = result.data.id
    voiceName.value = ''
    voiceDescription.value = ''
    samplePath.value = ''
    toast.add({ title: t('tmcut.voice.added'), description: t('tmcut.voice.addedLocalOnly'), color: 'success' })
  } catch (error) {
    toast.add({ title: t('tmcut.voice.addFailed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    localBusy.value = false
  }
}

async function syncVoice() {
  const ipc = window.electronAPI?.tmcut
  if (!ipc?.syncManagedVoice || !chosenLocal.value) return
  localBusy.value = true
  try {
    const result = await ipc.syncManagedVoice({ id: chosenLocal.value.id, baseUrl: baseUrl.value })
    if (!result?.ok) throw new Error(result?.error || t('tmcut.voice.syncFailed'))
    await checkLocalService()
    toast.add({ title: t('tmcut.voice.synced'), color: 'success' })
  } catch (error) {
    toast.add({ title: t('tmcut.voice.syncFailed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    localBusy.value = false
  }
}

async function deleteVoice() {
  const ipc = window.electronAPI?.tmcut
  if (!ipc?.deleteManagedVoice || !chosenLocal.value) return
  const deleted = await ipc.deleteManagedVoice(chosenLocal.value.id)
  if (!deleted?.ok) {
    toast.add({ title: t('tmcut.voice.deleteFailed'), description: deleted?.error || '', color: 'error' })
    return
  }
  await loadManagedVoices()
}

async function importAndPlace(path: string, engine: 'local' | 'gemini') {
  const outcome = await insertAsset(path).catch(() => {
    throw new Error(t('tmcut.voice.importFailed'))
  })
  emit('voice-added', path)
  if (outcome.placed) await addAutomaticCaptions(path, outcome.offsetSec)
  toast.add({
    title: t('tmcut.voice.generated'),
    description: outcome.placed
      ? t('tmcut.voice.addedToTimeline', { engine: t(`tmcut.voice.engines.${engine}`) })
      : t('tmcut.voice.addedToLibrary', { engine: t(`tmcut.voice.engines.${engine}`) }),
    color: 'success'
  })
}

async function makeLocalVoiceover() {
  const ipc = window.electronAPI?.tmcut
  const voice = selectedEngineVoice.value || localVoices.value[0]?.name || ''
  if (!voice) {
    toast.add({ title: t('tmcut.voice.noVoice'), color: 'warning' })
    return
  }
  localBusy.value = true
  try {
    let path: string
    if (ipc?.synthesizeVoice) {
      if (chosenLocal.value) {
        const sync = await ipc.syncManagedVoice?.({ id: chosenLocal.value.id, baseUrl: baseUrl.value })
        if (!sync?.ok) throw new Error(sync?.error || t('tmcut.voice.syncFailed'))
      }
      const result = await ipc.synthesizeVoice({ baseUrl: baseUrl.value, text: narration.value, voice })
      if (!result?.ok || !result.path) throw new Error(result?.error || t('tmcut.voice.generateFailed'))
      path = result.path
    } else {
      const result = await $fetch<{ ok: boolean, url: string }>('/api/v1/media/tts', {
        method: 'POST',
        body: { baseUrl: baseUrl.value, text: narration.value, voice }
      })
      if (!result?.url) throw new Error(t('tmcut.voice.generateFailed'))
      path = result.url
    }
    await importAndPlace(path, 'local')
  } catch (error) {
    toast.add({ title: t('tmcut.voice.generateFailed'), description: requestError(error), color: 'error' })
  } finally {
    localBusy.value = false
  }
}

async function makeGeminiVoiceover() {
  const ipc = window.electronAPI?.tmcut
  if (!ipc?.synthesizeGeminiVoice) {
    toast.add({ title: t('tmcut.voice.geminiDesktopOnly'), color: 'warning' })
    return
  }
  geminiBusy.value = true
  try {
    if (apiKey.value.trim() && !await saveGeminiKey()) return
    if (!geminiKeySaved.value) throw new Error(t('tmcut.voice.keyRequired'))
    const result = await ipc.synthesizeGeminiVoice({ text: narration.value, voice: selectedGeminiVoice.value, style: style.value, model: model.value })
    if (!result?.ok || !result.path) throw new Error(result?.error || t('tmcut.voice.generateFailed'))
    await importAndPlace(result.path, 'gemini')
  } catch (error) {
    toast.add({ title: t('tmcut.voice.generateFailed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    geminiBusy.value = false
  }
}

async function addAutomaticCaptions(audioPath: string, offsetSec: number) {
  const ipc = window.electronAPI?.tmcut
  if (!autoCaptions.value || !ipc?.extractAudio || !currentProject.value) return
  try {
    const audio = await ipc.extractAudio({ filePath: audioPath })
    if (!audio?.ok || !audio.path) throw new Error(audio?.error || t('tmcut.voice.captionFailed'))
    const gateway = window.electronAPI?.tools?.aiGateway
    if (!gateway?.transcribe) throw new Error(t('tmcut.voice.captionNeedsWhisper'))
    const response = await gateway.transcribe({ filePath: audio.path, format: 'verbose_json' })
    if (!response?.ok || !response.data) throw new Error(response?.error || t('tmcut.voice.captionFailed'))
    const cues = (response.data.segments || []).filter(cue => cue.text.trim() && cue.end > cue.start)
    for (const cue of cues) {
      const start = Math.max(0, cue.start)
      const end = Math.max(start + 0.1, cue.end)
      addClipToTrack('text', {
        name: cue.text.trim().slice(0, 24),
        text: cue.text.trim(),
        in: 0,
        out: Math.round(secToTicks(end - start)),
        offset: Math.round(secToTicks(offsetSec + start)),
        speed: 1,
        opacity: 1,
        scale: 1,
        x: 0,
        y: 0,
        rotation: 0,
        fontSize: 42,
        color: '#ffffff'
      })
    }
    if (!cues.length) toast.add({ title: t('tmcut.voice.captionEmpty'), color: 'warning' })
    else toast.add({ title: t('tmcut.voice.captionCreated', { n: cues.length }), color: 'success' })
  } catch (error) {
    toast.add({ title: t('tmcut.voice.captionFailed'), description: String((error as Error)?.message || error), color: 'error' })
  }
}

onMounted(async () => {
  readSavedSettings()
  await Promise.all([loadManagedVoices(), checkLocalService()])
})
</script>

<template>
  <div class="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
    <header v-if="!props.embedded" class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">
          {{ t('tmcut.voice.title') }}
        </h2>
        <p class="text-xs text-neutral-500">
          {{ t('tmcut.voice.subtitle') }}
        </p>
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        :aria-label="t('common.close')"
        @click="emit('close')"
      />
    </header>

    <section class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-3">
      <h3 class="font-medium text-sm">
        {{ t('tmcut.voice.localTitle') }}
      </h3>
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <UFormField :label="t('tmcut.voice.baseUrl')">
          <UInput v-model="baseUrl" class="w-full" @change="saveLocalUrl" />
        </UFormField>
        <UButton
          color="neutral"
          variant="soft"
          :loading="localBusy"
          @click="checkLocalService"
        >
          {{ t('tmcut.voice.checkService') }}
        </UButton>
        <UBadge :color="localOnline ? 'success' : 'neutral'" variant="subtle">
          <UIcon :name="localOnline ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mr-1 size-3.5" />{{ localOnline ? t('tmcut.voice.online') : t('tmcut.voice.offline') }}
        </UBadge>
      </div>
      <p v-if="localError" class="text-xs text-amber-600">
        {{ localError }}
      </p>
      <div v-if="isDesktop" class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
        <UFormField :label="t('tmcut.voice.name')">
          <UInput v-model="voiceName" maxlength="64" />
        </UFormField>
        <UFormField :label="t('tmcut.voice.reference')">
          <UInput :model-value="samplePath ? samplePath.split(/[\\/]/).pop() : ''" readonly :placeholder="t('tmcut.voice.pickReference')" />
        </UFormField>
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-folder-open"
          @click="chooseSample"
        >
          {{ t('tmcut.voice.browse') }}
        </UButton>
      </div>
      <div v-if="isDesktop" class="flex flex-wrap gap-2">
        <UButton
          color="primary"
          variant="soft"
          :disabled="!voiceName.trim() || !samplePath"
          :loading="localBusy"
          @click="addVoice"
        >
          {{ t('tmcut.voice.saveReference') }}
        </UButton>
        <span class="text-xs text-neutral-500 self-center">{{ t('tmcut.voice.referencePrivacy') }}</span>
      </div>
      <p v-else class="text-[11px] text-neutral-500">
        {{ t('tmcut.voice.referenceDesktopOnly') }}
      </p>
      <div v-if="managedVoices.length" class="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
        <UFormField :label="t('tmcut.voice.voiceList')">
          <USelect v-model="selectedVoiceId" :items="managedVoices.map(v => ({ label: `${v.name} · ${v.engineName}`, value: v.id }))" class="w-full" />
        </UFormField>
        <UButton
          color="neutral"
          variant="soft"
          :disabled="!chosenLocal || !localOnline"
          :loading="localBusy"
          @click="syncVoice"
        >
          {{ t('tmcut.voice.sync') }}
        </UButton>
        <UButton
          color="error"
          variant="ghost"
          :disabled="!chosenLocal"
          @click="deleteVoice"
        >
          {{ t('tmcut.voice.delete') }}
        </UButton>
      </div>
      <p v-if="localVoices.length" class="text-[11px] text-neutral-500">
        {{ t('tmcut.voice.serviceVoices', { count: localVoices.length }) }}
      </p>
      <p v-if="isDesktop" class="text-[11px] text-neutral-500">
        {{ t('tmcut.voice.localPersistenceNote') }}
      </p>
    </section>
    <section class="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-3">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-medium text-sm mr-auto">
          {{ t('tmcut.voice.narrationTitle') }}
        </h3>
        <UButton
          size="xs"
          :variant="activeEngine === 'local' ? 'solid' : 'soft'"
          :color="activeEngine === 'local' ? 'primary' : 'neutral'"
          @click="activeEngine = 'local'"
        >
          {{ t('tmcut.voice.engines.local') }}
        </UButton>
        <UButton
          size="xs"
          :variant="activeEngine === 'gemini' ? 'solid' : 'soft'"
          :color="activeEngine === 'gemini' ? 'primary' : 'neutral'"
          :disabled="!isDesktop"
          @click="activeEngine = 'gemini'"
        >
          {{ t('tmcut.voice.engines.gemini') }}
        </UButton>
      </div>
      <UFormField :label="t('tmcut.voice.narration')">
        <UTextarea
          v-model="narration"
          :rows="5"
          maxlength="20000"
          class="w-full"
        />
      </UFormField>
      <template v-if="activeEngine === 'local'">
        <UFormField v-if="managedVoices.length" :label="t('tmcut.voice.selectedVoice')">
          <USelect v-model="selectedVoiceId" :items="managedVoices.map(v => ({ label: `${v.name} · ${v.engineName}`, value: v.id }))" class="w-full" />
        </UFormField>
        <UFormField v-else :label="t('tmcut.voice.selectedVoice')">
          <USelect v-model="selectedLocalVoice" :items="localVoices.map(v => ({ label: v.name, value: v.name }))" class="w-full" />
        </UFormField>
        <p class="text-[11px] text-neutral-500">
          {{ t('tmcut.voice.localOnlyInfo') }}
        </p>
      </template>
      <template v-else>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField :label="t('tmcut.voice.geminiVoice')">
            <USelect v-model="selectedGeminiVoice" :items="geminiVoices" class="w-full" />
          </UFormField>
          <UFormField :label="t('tmcut.voice.geminiModel')">
            <USelect v-model="model" :items="['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']" class="w-full" />
          </UFormField>
        </div>
        <UFormField :label="t('tmcut.voice.style')">
          <UInput v-model="style" maxlength="500" :placeholder="t('tmcut.voice.styleHint')" />
        </UFormField>
        <div class="flex items-end gap-2">
          <UFormField :label="t('tmcut.voice.geminiKey')" class="flex-1">
            <UInput
              v-model="apiKey"
              type="password"
              autocomplete="off"
              :placeholder="geminiKeySaved ? t('tmcut.voice.keyAlreadySaved') : t('tmcut.voice.keySetInSettings')"
            />
          </UFormField>
          <UButton
            color="neutral"
            variant="soft"
            :loading="geminiKeySaving"
            :disabled="!apiKey.trim()"
            @click="saveGeminiKey"
          >
            {{ t('tmcut.voice.saveKey') }}
          </UButton>
        </div>
        <p class="text-[11px] text-amber-600">
          {{ t('tmcut.voice.geminiPrivacy') }}
        </p>
      </template>
      <UCheckbox
        v-if="isDesktop"
        v-model="autoCaptions"
        name="tmcut-voice-auto-captions"
        :label="t('tmcut.voice.autoCaptions')"
      />
      <div class="flex justify-end">
        <UButton
          color="primary"
          variant="soft"
          :disabled="!narration.trim() || (activeEngine === 'local' && !localOnline) || (activeEngine === 'gemini' && !apiKey.trim() && !geminiKeySaved)"
          :loading="activeEngine === 'local' ? localBusy : geminiBusy"
          @click="activeEngine === 'local' ? makeLocalVoiceover() : makeGeminiVoiceover()"
        >
          {{ t('tmcut.voice.generate') }}
        </UButton>
      </div>
    </section>
  </div>
</template>
