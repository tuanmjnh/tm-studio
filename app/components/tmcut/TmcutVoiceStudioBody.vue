<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { CloudVoiceProviderInfo, ManagedEngineStatus } from '#shared/types/electron'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutInsertAsset } from '~/composables/useTmcutInsertAsset'
import { useTmcutPlatform } from '~/composables/useTmcutPlatform'
import { tmcutHostBridge, tmcutHostIpc } from '~/utils/tmcut/hostBridge'
import { secToTicks } from '@tuanmjnh/tm-cut-core'

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

// Two loopback engines, same contract as server/utils/tts.ts: VieNeu-TTS is
// the OpenAI-compatible server on 8000, CIT Voice Studio bundles VieNeu and
// serves its own API on 8001.
type LocalProvider = 'vieneu' | 'cit'
const PROVIDERS: Array<{ id: LocalProvider, defaultUrl: string, urlKey: string }> = [
  { id: 'vieneu', defaultUrl: 'http://127.0.0.1:8000', urlKey: 'tmcut_vieneu_base_url' },
  { id: 'cit', defaultUrl: 'http://127.0.0.1:8001', urlKey: 'tmcut_cit_base_url' }
]
const PROVIDER_KEY = 'tmcut_tts_provider'
const provider = ref<LocalProvider>('vieneu')
const providerSpec = computed(() => PROVIDERS.find(item => item.id === provider.value) || PROVIDERS[0]!)
const baseUrl = ref(PROVIDERS[0]!.defaultUrl)
const apiKey = ref('')
const geminiKeySaved = ref(false)
const geminiKeySaving = ref(false)
const selectedLocalVoice = ref('')
const activeEngine = ref<'local' | 'gemini' | 'cloud'>('local')
const localBusy = ref(false)
const geminiBusy = ref(false)
const localOnline = ref(false)
const localError = ref('')
const localVoices = ref<Array<{ name: string, description: string }>>([])
// Desktop-only: Main downloads each pinned engine into the app data dir and
// runs one loopback server per engine. The web build keeps the manual URL.
// Statuses are keyed by provider because both engines report on one channel.
const engineStatuses = ref<Record<LocalProvider, ManagedEngineStatus | null>>({ vieneu: null, cit: null })
const engineStatus = computed(() => engineStatuses.value[provider.value])
const engineBusy = ref(false)
let engineUnsubscribe: (() => void) | null = null
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
const localSettingsOpen = ref(false)
const geminiSettingsOpen = ref(false)
const providerLabel = computed(() => t(`tmcut.voice.providers.${provider.value}`))

// Cloud engines (R146): the desktop build reaches all five through Main, the
// web build only the keyless Google Translate one. Catalogue and key flags are
// loaded from the host, never hardcoded here twice.
const cloudProviders = ref<CloudVoiceProviderInfo[]>([])
const cloudProvider = ref('gtts')
const cloudVoice = ref('vi')
const cloudBusy = ref(false)
const cloudSettingsOpen = ref(false)
const cloudKeyInput = ref('')
const cloudRegionInput = ref('')
const cloudKeySaving = ref(false)
const cloudProviderInfo = computed(() => cloudProviders.value.find(item => item.id === cloudProvider.value) || null)
const cloudVoiceItems = computed(() => cloudProviderInfo.value?.voices || [])
// Provider-fetched voices (ElevenLabs / Google Cloud) replace the static
// defaults for this session; reset when the provider changes.
const cloudDynamicVoices = ref<Array<{ id: string, label: string }>>([])
const effectiveCloudVoices = computed(() => cloudDynamicVoices.value.length ? cloudDynamicVoices.value : cloudVoiceItems.value)
const cloudVoicesBusy = ref(false)
const cloudRequestId = ref('')
const cloudProgress = ref<{ done: number, total: number } | null>(null)
let webCloudAbort: AbortController | null = null
let cloudProgressUnsubscribe: (() => void) | null = null
const cloudProgressLabel = computed(() => cloudProgress.value
  ? t('tmcut.voice.cloudProgress', { done: cloudProgress.value.done, total: cloudProgress.value.total })
  : '')
const cloudCanListVoices = computed(() => isDesktop.value
  && !!cloudProviderInfo.value?.hasKey
  && (cloudProvider.value === 'elevenlabs' || cloudProvider.value === 'google'))
const cloudReady = computed(() => {
  const info = cloudProviderInfo.value
  if (!info) return false
  if (!isDesktop.value && info.id !== 'gtts') return false
  return (!info.keySlot || info.hasKey) && (!info.needsRegion || info.hasRegion)
})

const geminiVoices = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
]

// The web build has no IPC: it reaches the local service through the Nitro
// proxy (/api/v1/media/tts) and can only import server-stored audio.
// ADR-014: this panel drives local TTS processes and reads native config,
// so it gates on the host identity the adapter negotiated rather than sniffing
// the preload global.
const platform = useTmcutPlatform()
const isDesktop = computed(() => platform.info.name === 'electron')

// Cloned voices are kept in a local registry for both managed engines. VieNeu
// only holds them in memory per process, so they must be re-synced; CIT stores
// them on disk but rejects an upload without the consent version it serves.
const managedAvailable = computed(() => managedVoices.value.length > 0)
const chosenLocal = computed(() => managedAvailable.value ? managedVoices.value.find(voice => voice.id === selectedVoiceId.value) || null : null)
const selectedEngineVoice = computed(() => chosenLocal.value?.engineName || selectedLocalVoice.value)
const citConsent = ref<{ rightsStatement: string, termsVersion: string } | null>(null)
const consentConfirmed = ref(false)

// The latest take stays reachable after the toast: it is already in the media
// library, but the standalone /tmcut/voice page has no media panel to play it.
// History is one flat list capped at MAX_TAKES entries, newest first.
type TakeEngine = 'local' | 'gemini' | 'gtts' | 'openai' | 'elevenlabs' | 'azure' | 'google'
type VoiceTake = { path: string, engine: TakeEngine, text: string, createdAt: number }
const TAKES_KEY = 'tmcut_voice_takes'
const MAX_TAKES = 20
const voiceTakes = ref<VoiceTake[]>([])
const lastTake = computed(() => voiceTakes.value[0] || null)
const takesOpen = ref(false)
const previewPath = ref('')
const takePreviewOpen = ref(false)
const takeName = computed(() => lastTake.value ? fileName(lastTake.value.path) : '')

function fileName(path: string) {
  return path.split(/[\\/]/).pop() || path
}

// Web takes are served from /uploads/**, which has no folder on this machine.
function canReveal(path: string) {
  return isDesktop.value && !path.startsWith('/uploads/')
}

function openTakePreview(path: string) {
  previewPath.value = path
  takePreviewOpen.value = true
}

function showTakeInFolder(path: string) {
  void tmcutHostBridge()?.showItemInFolder?.(path)
}

function readTakes() {
  if (typeof window === 'undefined') return
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(TAKES_KEY) || '[]')
    voiceTakes.value = Array.isArray(raw)
      ? raw.filter((item): item is VoiceTake => !!item && typeof item.path === 'string').slice(0, MAX_TAKES)
      : []
  } catch {
    voiceTakes.value = []
  }
}

function persistTakes() {
  if (typeof window === 'undefined') return
  localStorage.setItem(TAKES_KEY, JSON.stringify(voiceTakes.value.slice(0, MAX_TAKES)))
}

function recordTake(path: string, engine: TakeEngine) {
  const take: VoiceTake = { path, engine, text: narration.value.trim().slice(0, 120), createdAt: Date.now() }
  voiceTakes.value = [take, ...voiceTakes.value.filter(item => item.path !== path)].slice(0, MAX_TAKES)
  persistTakes()
}

function clearTakes() {
  voiceTakes.value = []
  persistTakes()
}

function formatTakeTime(timestamp: number) {
  return new Date(timestamp).toLocaleString()
}

function requestError(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data
  return String(data?.message || (error as Error)?.message || error)
}

function readSavedSettings() {
  if (typeof window === 'undefined') return
  const saved = localStorage.getItem(PROVIDER_KEY)
  provider.value = saved === 'cit' ? 'cit' : 'vieneu'
  baseUrl.value = localStorage.getItem(providerSpec.value.urlKey) || providerSpec.value.defaultUrl
  apiKey.value = ''
  geminiKeySaved.value = false
  void tmcutHostBridge()?.getConfig().then((config) => {
    geminiKeySaved.value = !!config?.TMCUT_GEMINI_API_KEY
  }).catch(() => { geminiKeySaved.value = false })
}

function saveLocalUrl() {
  if (typeof window !== 'undefined') localStorage.setItem(providerSpec.value.urlKey, baseUrl.value.trim() || providerSpec.value.defaultUrl)
}

async function switchProvider(value: LocalProvider) {
  provider.value = value
  if (typeof window !== 'undefined') localStorage.setItem(PROVIDER_KEY, provider.value)
  selectedVoiceId.value = ''
  selectedLocalVoice.value = ''
  localVoices.value = []
  localOnline.value = false
  localError.value = ''
  citConsent.value = null
  consentConfirmed.value = false
  baseUrl.value = (typeof window !== 'undefined' && localStorage.getItem(providerSpec.value.urlKey)) || providerSpec.value.defaultUrl
  await checkLocalService()
}

function formatBytes(bytes: number): string {
  const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}

const engineWorking = computed(() => engineBusy.value || ['downloading', 'packages', 'models', 'starting', 'stopping'].includes(engineStatus.value?.phase || ''))
const enginePhaseLabel = computed(() => {
  const phase = engineStatus.value?.phase || 'idle'
  return ['downloading', 'packages', 'models', 'starting', 'stopping'].includes(phase) ? t(`tmcut.voice.engine.phases.${phase}`) : ''
})

function applyEngineStatus(status: ManagedEngineStatus) {
  engineStatuses.value[status.provider] = status
  // A started managed engine owns the origin; pin that provider's URL field.
  if (status.phase === 'running' && status.origin) {
    const spec = PROVIDERS.find(item => item.id === status.provider)
    if (spec && typeof window !== 'undefined') {
      localStorage.setItem(spec.urlKey, status.origin)
    }
    if (provider.value === status.provider && baseUrl.value !== status.origin) {
      baseUrl.value = status.origin
      void checkLocalServiceWhenReady()
    }
  }
}

// The server answers /health as soon as it binds, but /voices stays 503 until
// the voice model finishes loading (tens of seconds on first run). Polling
// here keeps the badge honest instead of showing Offline right after Start.
let serviceRetryTimer: ReturnType<typeof setTimeout> | null = null
async function checkLocalServiceWhenReady() {
  if (serviceRetryTimer) return
  const tick = async () => {
    serviceRetryTimer = null
    if (engineStatus.value?.phase !== 'running' || localOnline.value) return
    await checkLocalService()
    if (!localOnline.value && engineStatus.value?.phase === 'running') {
      serviceRetryTimer = setTimeout(tick, 3000)
    }
  }
  await tick()
}

function engineIpc() {
  const ipc = tmcutHostIpc()
  if (!ipc) return null
  return provider.value === 'cit'
    ? { status: ipc.citEngineStatus, install: ipc.citEngineInstall, start: ipc.citEngineStart, stop: ipc.citEngineStop }
    : { status: ipc.vieneuEngineStatus, install: ipc.vieneuEngineInstall, start: ipc.vieneuEngineStart, stop: ipc.vieneuEngineStop }
}

async function loadEngineStatus() {
  const ipc = tmcutHostIpc()
  if (!ipc) return
  try {
    const [vieneu, cit] = await Promise.all([ipc.vieneuEngineStatus(), ipc.citEngineStatus()])
    applyEngineStatus(vieneu.data)
    applyEngineStatus(cit.data)
  } catch {
    // The engine panel is optional; leave the manual URL working.
  }
}

async function installEngine() {
  const ipc = engineIpc()
  if (!ipc || engineWorking.value) return
  try {
    applyEngineStatus((await ipc.install()).data)
  } catch (error) {
    toast.add({ title: t('tmcut.voice.engine.failed'), description: String((error as Error)?.message || error), color: 'error' })
  }
}

async function startEngine() {
  const ipc = engineIpc()
  if (!ipc || engineWorking.value) return
  engineBusy.value = true
  try {
    const result = await ipc.start()
    if (!result.ok) throw new Error(result.error || t('tmcut.voice.engine.failed'))
    if (result.data?.origin) {
      baseUrl.value = result.data.origin
      saveLocalUrl()
    }
    await loadEngineStatus()
    await checkLocalServiceWhenReady()
  } catch (error) {
    toast.add({ title: t('tmcut.voice.engine.failed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    engineBusy.value = false
  }
}

async function stopEngine() {
  const ipc = engineIpc()
  if (!ipc || engineWorking.value) return
  engineBusy.value = true
  if (serviceRetryTimer) {
    clearTimeout(serviceRetryTimer)
    serviceRetryTimer = null
  }
  try {
    await ipc.stop()
    localOnline.value = false
    localError.value = ''
    localVoices.value = []
    await loadEngineStatus()
  } catch (error) {
    toast.add({ title: t('tmcut.voice.engine.failed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    engineBusy.value = false
  }
}

const engineHint = computed(() => {
  const status = engineStatus.value
  if (!status) return ''
  if (status.error) return status.error
  if (enginePhaseLabel.value) return enginePhaseLabel.value
  return status.installed
    ? t('tmcut.voice.engine.installed')
    : t('tmcut.voice.engine.size', { size: formatBytes(status.estimatedBytes || 0) })
})

const localPrimary = computed(() => {
  if (isDesktop.value && engineStatus.value) {
    const status = engineStatus.value
    if (!status.installed) {
      return {
        label: t('tmcut.voice.engine.install'),
        icon: 'i-lucide-download',
        color: 'primary' as const,
        loading: engineWorking.value,
        disabled: engineWorking.value,
        run: installEngine
      }
    }
    if (status.phase === 'running') {
      return {
        label: t('tmcut.voice.engine.stop'),
        icon: 'i-lucide-square',
        color: 'neutral' as const,
        loading: engineWorking.value,
        disabled: engineWorking.value,
        run: stopEngine
      }
    }
    return {
      label: t('tmcut.voice.engine.start'),
      icon: 'i-lucide-play',
      color: 'primary' as const,
      loading: engineWorking.value,
      disabled: engineWorking.value,
      run: startEngine
    }
  }
  return {
    label: t('tmcut.voice.checkService'),
    icon: 'i-lucide-refresh-cw',
    color: 'neutral' as const,
    loading: localBusy.value,
    disabled: false,
    run: checkLocalService
  }
})

const localActionItems = computed<DropdownMenuItem[][]>(() => {
  const items: DropdownMenuItem[][] = [[
    {
      label: t('tmcut.voice.settings'),
      icon: 'i-lucide-settings-2',
      onSelect: () => {
        localSettingsOpen.value = true
      }
    },
    {
      label: t('tmcut.voice.checkService'),
      icon: 'i-lucide-refresh-cw',
      disabled: localBusy.value,
      onSelect: () => {
        void checkLocalService()
      }
    }
  ]]
  const status = isDesktop.value ? engineStatus.value : null
  if (status) {
    items.push([status.installed
      ? status.phase === 'running'
        ? {
            label: t('tmcut.voice.engine.stop'),
            icon: 'i-lucide-square',
            disabled: engineWorking.value,
            onSelect: () => {
              void stopEngine()
            }
          }
        : {
            label: t('tmcut.voice.engine.start'),
            icon: 'i-lucide-play',
            disabled: engineWorking.value,
            onSelect: () => {
              void startEngine()
            }
          }
      : {
          label: t('tmcut.voice.engine.install'),
          icon: 'i-lucide-download',
          disabled: engineWorking.value,
          onSelect: () => {
            void installEngine()
          }
        }])
  }
  if (managedAvailable.value) {
    items.push([
      {
        label: t('tmcut.voice.sync'),
        icon: 'i-lucide-refresh-cw',
        disabled: !chosenLocal.value || !localOnline.value,
        onSelect: () => {
          void syncVoice()
        }
      },
      {
        label: t('tmcut.voice.delete'),
        icon: 'i-lucide-trash-2',
        color: 'error',
        disabled: !chosenLocal.value,
        onSelect: () => {
          void deleteVoice()
        }
      }
    ])
  }
  return items
})

function onGeminiSettingsOpen(value: boolean) {
  if (!value) apiKey.value = ''
}

async function saveGeminiKey(): Promise<boolean> {
  const bridge = tmcutHostBridge()
  if (!apiKey.value.trim() || !bridge?.setConfig) return false
  geminiKeySaving.value = true
  try {
    const result = await bridge.setConfig({ TMCUT_GEMINI_API_KEY: apiKey.value.trim() })
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
  const ipc = tmcutHostIpc()
  managedVoices.value = ipc?.listManagedVoices ? await ipc.listManagedVoices() : []
  if (!managedVoices.value.some(voice => voice.id === selectedVoiceId.value)) {
    selectedVoiceId.value = managedVoices.value[0]?.id || ''
  }
}

async function checkLocalService() {
  const ipc = tmcutHostIpc()
  localBusy.value = true
  localError.value = ''
  try {
    if (ipc?.voiceStatus) {
      const result = await ipc.voiceStatus({ provider: provider.value, baseUrl: baseUrl.value })
      localOnline.value = !!result?.ok
      if (result?.ok && result.data) localVoices.value = result.data.voices
      else localError.value = result?.error || t('tmcut.voice.serviceOffline')
      if (result?.ok && provider.value === 'cit') void loadConsent()
      return
    }
    const result = await $fetch<{ ok: boolean, data: { voices: Array<{ name: string, description: string }> } }>(
      '/api/v1/media/tts/status',
      { query: { provider: provider.value, baseUrl: baseUrl.value } }
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

// CIT refuses a clone upload unless the caller echoes the consent version it
// is currently serving, so the panel reads it from the engine it will enroll into.
async function loadConsent() {
  const ipc = tmcutHostIpc()
  citConsent.value = null
  if (!ipc?.voiceConsent || provider.value !== 'cit') return
  try {
    const result = await ipc.voiceConsent({ provider: 'cit', baseUrl: baseUrl.value })
    citConsent.value = result?.ok && result.data ? result.data : null
  } catch {
    citConsent.value = null
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
  const ipc = tmcutHostIpc()
  if (!ipc?.addManagedVoice || !samplePath.value || !voiceName.value.trim()) return
  if (provider.value === 'cit' && !consentConfirmed.value) {
    toast.add({ title: t('tmcut.voice.consentRequired'), color: 'warning' })
    return
  }
  localBusy.value = true
  try {
    const result = await ipc.addManagedVoice({ filePath: samplePath.value, name: voiceName.value.trim(), description: voiceDescription.value.trim() })
    if (!result?.ok || !result.data) throw new Error(result?.error || t('tmcut.voice.addFailed'))
    await loadManagedVoices()
    selectedVoiceId.value = result.data.id
    voiceName.value = ''
    voiceDescription.value = ''
    samplePath.value = ''
    // CIT saves clones on its side; enroll right away so the voice is usable
    // without a manual Sync. VieNeu keeps the historical local-only add.
    let synced = false
    if (provider.value === 'cit' && localOnline.value && ipc.syncManagedVoice) {
      const sync = await ipc.syncManagedVoice({
        id: result.data.id,
        provider: 'cit',
        baseUrl: baseUrl.value,
        rightsVersion: citConsent.value?.termsVersion
      })
      synced = !!sync?.ok
      if (!sync?.ok) toast.add({ title: t('tmcut.voice.syncFailed'), description: sync?.error || '', color: 'error' })
    }
    toast.add({
      title: t('tmcut.voice.added'),
      description: synced ? t('tmcut.voice.addedAndSynced') : t('tmcut.voice.addedLocalOnly'),
      color: 'success'
    })
  } catch (error) {
    toast.add({ title: t('tmcut.voice.addFailed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    localBusy.value = false
  }
}

async function syncVoice() {
  const ipc = tmcutHostIpc()
  if (!ipc?.syncManagedVoice || !chosenLocal.value) return
  if (provider.value === 'cit' && !citConsent.value) await loadConsent()
  if (provider.value === 'cit' && !citConsent.value) {
    toast.add({ title: t('tmcut.voice.syncFailed'), description: t('tmcut.voice.consentUnavailable'), color: 'error' })
    return
  }
  localBusy.value = true
  try {
    const result = await ipc.syncManagedVoice({
      id: chosenLocal.value.id,
      provider: provider.value,
      baseUrl: baseUrl.value,
      rightsVersion: citConsent.value?.termsVersion
    })
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
  const ipc = tmcutHostIpc()
  if (!ipc?.deleteManagedVoice || !chosenLocal.value) return
  const deleted = await ipc.deleteManagedVoice({ id: chosenLocal.value.id, provider: provider.value, baseUrl: baseUrl.value })
  if (!deleted?.ok) {
    toast.add({ title: t('tmcut.voice.deleteFailed'), description: deleted?.error || '', color: 'error' })
    return
  }
  if (deleted.data?.remote === 'offline' || deleted.data?.remote?.startsWith('failed')) {
    toast.add({ title: t('tmcut.voice.deleteRemoteFailed'), color: 'warning' })
  }
  await loadManagedVoices()
}

async function importAndPlace(path: string, engine: TakeEngine) {
  const outcome = await insertAsset(path).catch(() => {
    throw new Error(t('tmcut.voice.importFailed'))
  })
  emit('voice-added', path)
  recordTake(path, engine)
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
  const ipc = tmcutHostIpc()
  const voice = selectedEngineVoice.value || localVoices.value[0]?.name || ''
  if (!voice) {
    toast.add({ title: t('tmcut.voice.noVoice'), color: 'warning' })
    return
  }
  localBusy.value = true
  try {
    let path: string
    if (ipc?.synthesizeVoice) {
      // VieNeu forgets clones per process; CIT keeps them on disk, and its
      // upload needs the consent echo that only the add/sync flow carries.
      if (chosenLocal.value && provider.value === 'vieneu') {
        const sync = await ipc.syncManagedVoice?.({ id: chosenLocal.value.id, provider: 'vieneu', baseUrl: baseUrl.value })
        if (!sync?.ok) throw new Error(sync?.error || t('tmcut.voice.syncFailed'))
      }
      const result = await ipc.synthesizeVoice({ provider: provider.value, baseUrl: baseUrl.value, text: narration.value, voice })
      if (!result?.ok || !result.path) throw new Error(result?.error || t('tmcut.voice.generateFailed'))
      path = result.path
    } else {
      const result = await $fetch<{ ok: boolean, url: string }>('/api/v1/media/tts', {
        method: 'POST',
        body: { provider: provider.value, baseUrl: baseUrl.value, text: narration.value, voice }
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
  const ipc = tmcutHostIpc()
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

async function loadCloudProviders() {
  const ipc = tmcutHostIpc()
  try {
    if (ipc?.cloudVoices) {
      const result = await ipc.cloudVoices()
      if (!result?.ok) throw new Error(result?.error || t('tmcut.voice.cloudLoadFailed'))
      cloudProviders.value = result.data || []
    } else {
      const result = await $fetch<{ ok: boolean, data: CloudVoiceProviderInfo[] }>('/api/v1/media/tts-cloud')
      cloudProviders.value = result?.data || []
    }
  } catch {
    cloudProviders.value = []
  }
  syncCloudVoice()
}

function syncCloudVoice() {
  const info = cloudProviderInfo.value
  if (!info) {
    cloudVoice.value = ''
    return
  }
  if (!info.voices.some(voice => voice.id === cloudVoice.value)) cloudVoice.value = info.defaultVoice
}

function switchCloudProvider(value: string) {
  cloudProvider.value = value
  cloudKeyInput.value = ''
  cloudRegionInput.value = ''
  cloudDynamicVoices.value = []
  cloudProgress.value = null
  syncCloudVoice()
}

function isAbortError(error: unknown) {
  const value = error as { name?: string, code?: string, cause?: { name?: string } }
  return value?.name === 'AbortError' || value?.code === 'ABORT_ERR' || value?.cause?.name === 'AbortError'
}

async function loadCloudVoices() {
  const ipc = tmcutHostIpc()
  if (!ipc?.cloudListVoices) return
  cloudVoicesBusy.value = true
  try {
    const result = await ipc.cloudListVoices({ provider: cloudProvider.value })
    if (!result?.ok || !result.data?.length) throw new Error(result?.error || t('tmcut.voice.cloudVoicesFailed'))
    cloudDynamicVoices.value = result.data
    if (!result.data.some(voice => voice.id === cloudVoice.value)) cloudVoice.value = result.data[0]!.id
    toast.add({ title: t('tmcut.voice.cloudVoicesLoaded', { n: result.data.length }), color: 'success' })
  } catch (error) {
    toast.add({ title: t('tmcut.voice.cloudVoicesFailed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    cloudVoicesBusy.value = false
  }
}

async function cancelCloudVoiceover() {
  const ipc = tmcutHostIpc()
  if (ipc?.cloudCancel && cloudRequestId.value) {
    await ipc.cloudCancel({ requestId: cloudRequestId.value }).catch(() => null)
  }
  webCloudAbort?.abort()
}

function onCloudSettingsOpen(value: boolean) {
  if (!value) {
    cloudKeyInput.value = ''
    cloudRegionInput.value = ''
  }
}

async function saveCloudKey(): Promise<boolean> {
  const info = cloudProviderInfo.value
  const bridge = tmcutHostBridge()
  if (!info?.keySlot || !bridge?.setConfig) {
    toast.add({ title: t('tmcut.voice.cloudDesktopOnly'), color: 'warning' })
    return false
  }
  const region = cloudRegionInput.value.trim()
  if (info.needsRegion && !/^[a-z0-9-]{2,30}$/.test(region)) {
    toast.add({ title: t('tmcut.voice.cloudRegionInvalid'), color: 'warning' })
    return false
  }
  if (!cloudKeyInput.value.trim()) return false
  cloudKeySaving.value = true
  try {
    const values: Record<string, string> = { [info.keySlot]: cloudKeyInput.value.trim() }
    if (info.needsRegion && region) values.TMCUT_AZURE_SPEECH_REGION = region
    const result = await bridge.setConfig(values)
    if (!result?.success) throw new Error(t('tmcut.voice.cloudKeySaveFailed'))
    info.hasKey = true
    if (info.needsRegion) info.hasRegion = true
    cloudKeyInput.value = ''
    toast.add({ title: t('tmcut.voice.cloudKeySaved'), color: 'success' })
    return true
  } catch (error) {
    toast.add({ title: t('tmcut.voice.cloudKeySaveFailed'), description: String((error as Error)?.message || error), color: 'error' })
    return false
  } finally {
    cloudKeySaving.value = false
  }
}

async function makeCloudVoiceover() {
  const ipc = tmcutHostIpc()
  cloudBusy.value = true
  cloudProgress.value = null
  try {
    let path: string
    if (ipc?.cloudSynthesize) {
      cloudRequestId.value = `cloud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const result = await ipc.cloudSynthesize({
        provider: cloudProvider.value,
        text: narration.value,
        voice: cloudVoice.value,
        requestId: cloudRequestId.value
      })
      if (result?.canceled) {
        toast.add({ title: t('tmcut.voice.cloudCanceled'), color: 'neutral' })
        return
      }
      if (!result?.ok || !result.path) throw new Error(result?.error || t('tmcut.voice.generateFailed'))
      path = result.path
    } else if (cloudProvider.value === 'gtts') {
      webCloudAbort = new AbortController()
      const result = await $fetch<{ ok: boolean, url: string }>('/api/v1/media/tts-cloud', {
        method: 'POST',
        body: { text: narration.value, voice: cloudVoice.value },
        signal: webCloudAbort.signal
      })
      if (!result?.url) throw new Error(t('tmcut.voice.generateFailed'))
      path = result.url
    } else {
      throw new Error(t('tmcut.voice.cloudDesktopOnly'))
    }
    await importAndPlace(path, cloudProvider.value as TakeEngine)
  } catch (error) {
    if (isAbortError(error)) {
      toast.add({ title: t('tmcut.voice.cloudCanceled'), color: 'neutral' })
      return
    }
    toast.add({ title: t('tmcut.voice.generateFailed'), description: requestError(error), color: 'error' })
  } finally {
    cloudBusy.value = false
    cloudProgress.value = null
    cloudRequestId.value = ''
    webCloudAbort = null
  }
}

async function addAutomaticCaptions(audioPath: string, offsetSec: number) {
  if (!autoCaptions.value || !currentProject.value) return
  try {
    const gateway = tmcutHostBridge()?.tools?.aiGateway
    if (!gateway?.transcribe) throw new Error(t('tmcut.voice.captionNeedsWhisper'))
    // The FFmpeg mp3 extraction went with the engine (slice I). The gateway
    // uploads the media file itself, so the take is transcribed without a
    // second transcode.
    const response = await gateway.transcribe({ filePath: audioPath, format: 'verbose_json' })
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
  readTakes()
  if (isDesktop.value) {
    engineUnsubscribe = tmcutHostIpc()?.onEngineProgress?.(applyEngineStatus) || null
    cloudProgressUnsubscribe = tmcutHostIpc()?.onCloudProgress?.((payload) => {
      if (payload.requestId !== cloudRequestId.value) return
      cloudProgress.value = { done: payload.done, total: payload.total }
    }) || null
    await loadEngineStatus()
  }
  await Promise.all([loadManagedVoices(), checkLocalService(), loadCloudProviders()])
})

onUnmounted(() => {
  engineUnsubscribe?.()
  cloudProgressUnsubscribe?.()
  if (serviceRetryTimer) clearTimeout(serviceRetryTimer)
})
</script>

<template>
  <div class="p-5 space-y-4 max-h-[85vh] overflow-y-auto">
    <header v-if="!props.embedded" class="flex items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">
          {{ t('tmcut.voice.title') }}
        </h2>
        <p class="text-xs text-muted">
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

    <section class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <article class="flex flex-col gap-2.5 rounded-lg border border-default p-3">
        <div class="flex items-start gap-2.5">
          <div class="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <UIcon name="i-lucide-hard-drive" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <p class="text-sm font-medium">
                {{ t('tmcut.voice.engines.local') }}
              </p>
              <UBadge :color="localOnline ? 'success' : 'neutral'" variant="subtle" size="sm">
                <UIcon :name="localOnline ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mr-1 size-3" />{{ localOnline ? t('tmcut.voice.online') : t('tmcut.voice.offline') }}
              </UBadge>
              <UBadge
                v-if="engineStatus?.phase === 'running'"
                color="success"
                variant="subtle"
                size="sm"
              >
                {{ t('tmcut.voice.engine.running') }}
              </UBadge>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-muted" :title="`${providerLabel} · ${baseUrl}`">
              {{ providerLabel }} · {{ baseUrl }}
            </p>
          </div>
          <UDropdownMenu :items="localActionItems" :content="{ align: 'end' }" :ui="{ content: 'w-56' }">
            <UButton
              icon="i-lucide-ellipsis-vertical"
              color="neutral"
              variant="ghost"
              size="sm"
              :aria-label="t('tmcut.voice.actions')"
              class="-me-1 -mt-1"
            />
          </UDropdownMenu>
        </div>
        <p
          v-if="engineHint || localError"
          class="text-[11px]"
          :class="engineStatus?.error || localError ? 'text-warning-600' : 'text-muted'"
        >
          {{ engineStatus?.error || localError || engineHint }}
        </p>
        <UProgress v-if="engineWorking && engineStatus?.progress" :model-value="engineStatus.progress.percent ?? 0" size="xs" />
        <div class="flex items-center justify-between gap-2">
          <UButton
            size="xs"
            :color="localPrimary.color"
            variant="soft"
            :icon="localPrimary.icon"
            :loading="localPrimary.loading"
            :disabled="localPrimary.disabled"
            @click="localPrimary.run()"
          >
            {{ localPrimary.label }}
          </UButton>
          <span v-if="localVoices.length" class="text-[11px] text-muted">
            {{ t('tmcut.voice.serviceVoices', { count: localVoices.length }) }}
          </span>
        </div>
      </article>

      <article class="flex flex-col gap-2.5 rounded-lg border border-default p-3">
        <div class="flex items-start gap-2.5">
          <div class="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <UIcon name="i-lucide-sparkles" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <p class="text-sm font-medium">
                {{ t('tmcut.voice.engines.gemini') }}
              </p>
              <UBadge :color="geminiKeySaved ? 'success' : 'neutral'" variant="subtle" size="sm">
                <UIcon :name="geminiKeySaved ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mr-1 size-3" />{{ geminiKeySaved ? t('tmcut.voice.keySavedBadge') : t('tmcut.voice.geminiKeyMissing') }}
              </UBadge>
            </div>
            <p class="mt-0.5 truncate text-[11px] text-muted">
              {{ model }} · {{ selectedGeminiVoice }}
            </p>
          </div>
        </div>
        <p class="text-[11px] text-warning-600">
          {{ t('tmcut.voice.geminiPrivacy') }}
        </p>
        <div class="flex items-center justify-between gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-settings-2"
            @click="geminiSettingsOpen = true"
          >
            {{ t('tmcut.voice.settings') }}
          </UButton>
          <span v-if="!isDesktop" class="text-[11px] text-muted">
            {{ t('tmcut.voice.geminiDesktopOnly') }}
          </span>
        </div>
      </article>
    </section>

    <section class="rounded-lg border border-default p-3 space-y-3">
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
        <UButton
          size="xs"
          :variant="activeEngine === 'cloud' ? 'solid' : 'soft'"
          :color="activeEngine === 'cloud' ? 'primary' : 'neutral'"
          @click="activeEngine = 'cloud'"
        >
          {{ t('tmcut.voice.cloudTab') }}
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
        <UFormField v-if="managedAvailable" :label="t('tmcut.voice.selectedVoice')">
          <USelect v-model="selectedVoiceId" :items="managedVoices.map(v => ({ label: `${v.name} · ${v.engineName}`, value: v.id }))" class="w-full" />
        </UFormField>
        <UFormField v-else :label="t('tmcut.voice.selectedVoice')">
          <USelect v-model="selectedLocalVoice" :items="localVoices.map(v => ({ label: v.name, value: v.name }))" class="w-full" />
        </UFormField>
        <p class="text-[11px] text-muted">
          {{ t('tmcut.voice.localOnlyInfo') }}
        </p>
      </template>
      <template v-else-if="activeEngine === 'gemini'">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <UFormField :label="t('tmcut.voice.geminiVoice')">
            <USelect v-model="selectedGeminiVoice" :items="geminiVoices" class="w-full" />
          </UFormField>
          <UFormField :label="t('tmcut.voice.geminiModel')">
            <USelect v-model="model" :items="['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']" class="w-full" />
          </UFormField>
          <UFormField :label="t('tmcut.voice.style')">
            <UInput
              v-model="style"
              maxlength="500"
              :placeholder="t('tmcut.voice.styleHint')"
              class="w-full"
            />
          </UFormField>
        </div>
        <div v-if="!geminiKeySaved" class="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2">
          <UIcon name="i-lucide-key-round" class="size-3.5 text-warning" />
          <span class="flex-1 text-[11px] text-warning-600">{{ t('tmcut.voice.keyRequired') }}</span>
          <UButton
            size="xs"
            color="warning"
            variant="ghost"
            @click="geminiSettingsOpen = true"
          >
            {{ t('tmcut.voice.configure') }}
          </UButton>
        </div>
        <p class="text-[11px] text-warning-600">
          {{ t('tmcut.voice.geminiPrivacy') }}
        </p>
      </template>
      <template v-else>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField :label="t('tmcut.voice.cloudProvider')">
            <USelect
              v-model="cloudProvider"
              :items="cloudProviders.map(item => ({ label: item.label, value: item.id }))"
              class="w-full"
              @update:model-value="switchCloudProvider"
            />
          </UFormField>
          <UFormField v-if="cloudProviderInfo?.voiceInput === 'id' && !cloudDynamicVoices.length" :label="t('tmcut.voice.cloudVoiceId')">
            <UInput v-model="cloudVoice" :placeholder="t('tmcut.voice.cloudVoiceIdHint')" class="w-full" />
          </UFormField>
          <UFormField v-else :label="t('tmcut.voice.cloudVoice')">
            <USelect v-model="cloudVoice" :items="effectiveCloudVoices.map(item => ({ label: item.label, value: item.id }))" class="w-full" />
          </UFormField>
        </div>
        <div v-if="cloudCanListVoices" class="flex justify-end">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="cloudVoicesBusy"
            :disabled="cloudVoicesBusy"
            @click="loadCloudVoices"
          >
            {{ t('tmcut.voice.cloudVoicesLoad') }}
          </UButton>
        </div>
        <div v-if="!cloudProviders.length" class="text-[11px] text-muted">
          {{ t('tmcut.voice.cloudLoadFailed') }}
        </div>
        <div
          v-else-if="cloudProviderInfo?.keySlot && !cloudProviderInfo.hasKey"
          class="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2"
        >
          <UIcon name="i-lucide-key-round" class="size-3.5 text-warning" />
          <span class="flex-1 text-[11px] text-warning-600">{{ t('tmcut.voice.keyRequired') }}</span>
          <UButton
            size="xs"
            color="warning"
            variant="ghost"
            @click="cloudSettingsOpen = true"
          >
            {{ t('tmcut.voice.configure') }}
          </UButton>
        </div>
        <div v-else-if="cloudProviderInfo?.keySlot" class="flex items-center justify-between gap-2">
          <UBadge color="success" variant="subtle" size="sm">
            <UIcon name="i-lucide-key-round" class="mr-1 size-3" />{{ t('tmcut.voice.keySavedBadge') }}
          </UBadge>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-settings-2"
            @click="cloudSettingsOpen = true"
          >
            {{ t('tmcut.voice.settings') }}
          </UButton>
        </div>
        <p class="text-[11px] text-muted">
          {{ isDesktop ? t('tmcut.voice.cloudPrivacy') : t('tmcut.voice.cloudWebNote') }}
        </p>
      </template>
      <UCheckbox
        v-if="isDesktop"
        v-model="autoCaptions"
        name="tmcut-voice-auto-captions"
        :label="t('tmcut.voice.autoCaptions')"
      />
      <div class="flex items-center justify-between gap-2">
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-history"
          @click="takesOpen = true"
        >
          {{ t('tmcut.voice.historyTitle') }}
        </UButton>
        <div class="flex items-center gap-2">
          <span v-if="activeEngine === 'cloud' && cloudBusy && cloudProgressLabel" class="text-[11px] text-muted">
            {{ cloudProgressLabel }}
          </span>
          <UButton
            v-if="activeEngine === 'cloud' && cloudBusy"
            color="neutral"
            variant="soft"
            icon="i-lucide-x"
            @click="cancelCloudVoiceover"
          >
            {{ t('tmcut.voice.cancel') }}
          </UButton>
          <UButton
            color="primary"
            variant="soft"
            :disabled="!narration.trim() || (activeEngine === 'local' && !localOnline) || (activeEngine === 'gemini' && !geminiKeySaved) || (activeEngine === 'cloud' && !cloudReady)"
            :loading="activeEngine === 'local' ? localBusy : activeEngine === 'gemini' ? geminiBusy : cloudBusy"
            @click="activeEngine === 'local' ? makeLocalVoiceover() : activeEngine === 'gemini' ? makeGeminiVoiceover() : makeCloudVoiceover()"
          >
            {{ t('tmcut.voice.generate') }}
          </UButton>
        </div>
      </div>
      <div
        v-if="lastTake"
        class="flex items-center gap-2 rounded-md border border-default bg-elevated/40 px-2.5 py-2"
      >
        <UIcon name="i-lucide-file-audio" class="size-4 shrink-0 text-primary" />
        <span class="flex-1 truncate text-[11px] text-muted" :title="lastTake.path">{{ takeName }}</span>
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          icon="i-lucide-play"
          @click="openTakePreview(lastTake.path)"
        >
          {{ t('tmcut.voice.listen') }}
        </UButton>
        <UButton
          v-if="canReveal(lastTake.path)"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-folder"
          @click="showTakeInFolder(lastTake.path)"
        >
          {{ t('tmcut.voice.showInFolder') }}
        </UButton>
      </div>
    </section>
  </div>

  <USlideover
    v-model:open="localSettingsOpen"
    :title="t('tmcut.voice.localSettingsTitle')"
    :description="providerLabel"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div class="space-y-5">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField :label="t('tmcut.voice.provider')">
            <USelect
              v-model="provider"
              :items="PROVIDERS.map(item => ({ label: t(`tmcut.voice.providers.${item.id}`), value: item.id }))"
              class="w-full"
              @update:model-value="switchProvider"
            />
          </UFormField>
          <UFormField :label="t('tmcut.voice.baseUrl')">
            <UInput v-model="baseUrl" class="w-full" @change="saveLocalUrl" />
          </UFormField>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            size="sm"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="localBusy"
            @click="checkLocalService"
          >
            {{ t('tmcut.voice.checkService') }}
          </UButton>
          <UBadge :color="localOnline ? 'success' : 'neutral'" variant="subtle">
            <UIcon :name="localOnline ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mr-1 size-3.5" />{{ localOnline ? t('tmcut.voice.online') : t('tmcut.voice.offline') }}
          </UBadge>
        </div>
        <p v-if="localError" class="text-xs text-warning-600">
          {{ localError }}
        </p>
        <p v-if="provider === 'cit'" class="text-[11px] text-muted">
          {{ t('tmcut.voice.citHint') }}
        </p>

        <div
          v-if="isDesktop && (provider === 'vieneu' || provider === 'cit')"
          class="space-y-2 rounded-md border border-default p-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs font-medium">
                {{ t('tmcut.voice.engine.title') }}
              </p>
              <p class="text-[11px] text-muted">
                {{ engineHint }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UBadge :color="engineStatus?.phase === 'running' ? 'success' : 'neutral'" variant="subtle">
                {{ engineStatus?.phase === 'running' ? t('tmcut.voice.engine.running') : t('tmcut.voice.engine.stopped') }}
              </UBadge>
              <UButton
                v-if="!engineStatus?.installed"
                color="primary"
                variant="soft"
                size="xs"
                icon="i-lucide-download"
                :loading="engineWorking"
                :disabled="engineWorking"
                @click="installEngine"
              >
                {{ t('tmcut.voice.engine.install') }}
              </UButton>
              <UButton
                v-else-if="engineStatus?.phase === 'running'"
                color="neutral"
                variant="soft"
                size="xs"
                :loading="engineWorking"
                :disabled="engineWorking"
                @click="stopEngine"
              >
                {{ t('tmcut.voice.engine.stop') }}
              </UButton>
              <UButton
                v-else
                color="primary"
                variant="soft"
                size="xs"
                icon="i-lucide-play"
                :loading="engineWorking"
                :disabled="engineWorking"
                @click="startEngine"
              >
                {{ t('tmcut.voice.engine.start') }}
              </UButton>
            </div>
          </div>
          <UProgress v-if="engineWorking && engineStatus?.progress" :model-value="engineStatus.progress.percent ?? 0" size="xs" />
          <p v-if="engineStatus?.dir" class="truncate text-[10px] text-muted" :title="engineStatus.dir">
            {{ engineStatus.dir }}
          </p>
        </div>

        <div class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {{ t('tmcut.voice.voiceLibrary') }}
          </h4>
          <p v-if="localVoices.length" class="text-[11px] text-muted">
            {{ t('tmcut.voice.serviceVoices', { count: localVoices.length }) }}
          </p>
          <div v-if="managedAvailable" class="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_auto_auto]">
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
          <p v-if="managedAvailable" class="text-[11px] text-muted">
            {{ provider === 'cit' ? t('tmcut.voice.citPersistenceNote') : t('tmcut.voice.localPersistenceNote') }}
          </p>
        </div>

        <div v-if="isDesktop" class="space-y-2">
          <h4 class="text-[11px] font-semibold uppercase tracking-wide text-muted">
            {{ t('tmcut.voice.cloning') }}
          </h4>
          <p v-if="provider === 'cit'" class="text-[11px] text-muted">
            {{ t('tmcut.voice.cloneHintCit') }}
          </p>
          <div v-if="provider === 'cit'" class="space-y-1 rounded-md border border-default bg-elevated/40 p-2.5">
            <UCheckbox v-model="consentConfirmed" :label="t('tmcut.voice.consent')" />
            <p class="text-[11px] text-muted">
              {{ citConsent?.rightsStatement || t('tmcut.voice.consentUnavailable') }}
            </p>
          </div>
          <div class="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto]">
            <UFormField :label="t('tmcut.voice.name')">
              <UInput v-model="voiceName" maxlength="64" class="w-full" />
            </UFormField>
            <UFormField :label="t('tmcut.voice.reference')">
              <UInput
                :model-value="samplePath ? samplePath.split(/[\\/]/).pop() : ''"
                readonly
                :placeholder="t('tmcut.voice.pickReference')"
                class="w-full"
              />
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
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              color="primary"
              variant="soft"
              :disabled="!voiceName.trim() || !samplePath || (provider === 'cit' && !consentConfirmed)"
              :loading="localBusy"
              @click="addVoice"
            >
              {{ t('tmcut.voice.saveReference') }}
            </UButton>
            <span class="text-xs text-muted">{{ t('tmcut.voice.referencePrivacy') }}</span>
          </div>
        </div>
        <p v-else class="text-[11px] text-muted">
          {{ t('tmcut.voice.referenceDesktopOnly') }}
        </p>
      </div>
    </template>
  </USlideover>

  <USlideover
    v-model:open="geminiSettingsOpen"
    :title="t('tmcut.voice.geminiSettingsTitle')"
    :ui="{ content: 'sm:max-w-md' }"
    @update:open="onGeminiSettingsOpen"
  >
    <template #body>
      <div class="space-y-4">
        <UBadge :color="geminiKeySaved ? 'success' : 'neutral'" variant="subtle">
          <UIcon :name="geminiKeySaved ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mr-1 size-3.5" />{{ geminiKeySaved ? t('tmcut.voice.keySavedBadge') : t('tmcut.voice.geminiKeyMissing') }}
        </UBadge>
        <div class="space-y-3">
          <UFormField :label="t('tmcut.voice.geminiKey')">
            <UInput
              v-model="apiKey"
              type="password"
              autocomplete="off"
              :placeholder="geminiKeySaved ? t('tmcut.voice.keyAlreadySaved') : t('tmcut.voice.keySetInSettings')"
              class="w-full"
              @keyup.enter="saveGeminiKey"
            />
          </UFormField>
          <UButton
            color="primary"
            variant="soft"
            block
            :loading="geminiKeySaving"
            :disabled="!apiKey.trim()"
            @click="saveGeminiKey"
          >
            {{ t('tmcut.voice.saveKey') }}
          </UButton>
        </div>
        <p class="text-[11px] text-muted">
          {{ t('tmcut.voice.keySetInSettings') }}
        </p>
        <p class="text-[11px] text-warning-600">
          {{ t('tmcut.voice.geminiPrivacy') }}
        </p>
      </div>
    </template>
  </USlideover>

  <USlideover
    v-model:open="cloudSettingsOpen"
    :title="t('tmcut.voice.cloudSettingsTitle')"
    :description="cloudProviderInfo?.label"
    :ui="{ content: 'sm:max-w-md' }"
    @update:open="onCloudSettingsOpen"
  >
    <template #body>
      <div class="space-y-4">
        <UBadge
          :color="cloudProviderInfo?.hasKey ? 'success' : 'neutral'"
          variant="subtle"
        >
          <UIcon :name="cloudProviderInfo?.hasKey ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'" class="mr-1 size-3.5" />{{ cloudProviderInfo?.hasKey ? t('tmcut.voice.keySavedBadge') : t('tmcut.voice.keyRequired') }}
        </UBadge>
        <div class="space-y-3">
          <UFormField :label="t('tmcut.voice.cloudKey')">
            <UInput
              v-model="cloudKeyInput"
              type="password"
              autocomplete="off"
              :placeholder="cloudProviderInfo?.hasKey ? t('tmcut.voice.keyAlreadySaved') : t('tmcut.voice.keySetInSettings')"
              class="w-full"
              @keyup.enter="saveCloudKey"
            />
          </UFormField>
          <UFormField v-if="cloudProviderInfo?.needsRegion" :label="t('tmcut.voice.cloudRegion')">
            <UInput
              v-model="cloudRegionInput"
              autocomplete="off"
              :placeholder="t('tmcut.voice.cloudRegionHint')"
              class="w-full"
            />
          </UFormField>
          <UButton
            color="primary"
            variant="soft"
            block
            :loading="cloudKeySaving"
            :disabled="!cloudKeyInput.trim()"
            @click="saveCloudKey"
          >
            {{ t('tmcut.voice.saveKey') }}
          </UButton>
        </div>
        <p class="text-[11px] text-muted">
          {{ t('tmcut.voice.cloudKeyNote') }}
        </p>
      </div>
    </template>
  </USlideover>

  <USlideover
    v-model:open="takesOpen"
    :title="t('tmcut.voice.historyTitle')"
    :description="t('tmcut.voice.historyDesc')"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <template #body>
      <div v-if="!voiceTakes.length" class="text-sm text-muted">
        {{ t('tmcut.voice.historyEmpty') }}
      </div>
      <div v-else class="space-y-2">
        <div class="flex justify-end">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-trash-2"
            @click="clearTakes"
          >
            {{ t('tmcut.voice.historyClear') }}
          </UButton>
        </div>
        <div
          v-for="take in voiceTakes"
          :key="take.path"
          class="rounded-md border border-default px-2.5 py-2"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-file-audio" class="size-4 shrink-0 text-primary" />
            <span class="flex-1 truncate text-xs" :title="take.path">{{ fileName(take.path) }}</span>
            <UBadge size="sm" color="neutral" variant="subtle">
              {{ t(`tmcut.voice.engines.${take.engine}`) }}
            </UBadge>
          </div>
          <p v-if="take.text" class="mt-1 truncate text-[11px] text-muted" :title="take.text">
            {{ take.text }}
          </p>
          <div class="mt-1.5 flex items-center justify-between gap-2">
            <span class="text-[11px] text-muted">{{ formatTakeTime(take.createdAt) }}</span>
            <div class="flex items-center gap-1">
              <UButton
                size="xs"
                color="neutral"
                variant="soft"
                icon="i-lucide-play"
                @click="openTakePreview(take.path)"
              >
                {{ t('tmcut.voice.listen') }}
              </UButton>
              <UButton
                v-if="canReveal(take.path)"
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-folder"
                @click="showTakeInFolder(take.path)"
              >
                {{ t('tmcut.voice.showInFolder') }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </USlideover>

  <LazyToolsVideoPreviewModal
    v-model:open="takePreviewOpen"
    :file-path="previewPath"
    :title="previewPath ? fileName(previewPath) : undefined"
    kind="audio"
  />
</template>
