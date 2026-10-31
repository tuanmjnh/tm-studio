import type { AppUpdateStatus } from '#shared/types/electron'

const status = ref<AppUpdateStatus['state']>('idle')
const currentVersion = ref('')
const updateInfo = ref<AppUpdateStatus['updateInfo']>(null)
const progress = ref<AppUpdateStatus['progress']>({
  percent: 0,
  bytesPerSecond: 0,
  transferred: 0,
  total: 0
})
const error = ref<string | null>(null)
const isUpdateModalOpen = ref(false)
let listenerRegistered = false

export function useAppUpdater() {
  const toast = useToast()
  const { t } = useI18n()

  const isElectron = computed(() => !!window.electronAPI?.isElectron)
  const checking = computed(() => status.value === 'checking')
  const downloading = computed(() => status.value === 'downloading')
  const downloaded = computed(() => status.value === 'downloaded')
  const hasUpdate = computed(() => status.value === 'available' || status.value === 'downloading' || status.value === 'downloaded')

  function initListeners() {
    if (import.meta.server || listenerRegistered) return
    const updater = window.electronAPI?.appUpdater
    if (!updater) return

    listenerRegistered = true
    updater.onStatusChanged((newStatus: AppUpdateStatus) => {
      status.value = newStatus.state
      if (newStatus.currentVersion) currentVersion.value = newStatus.currentVersion
      if (newStatus.updateInfo) updateInfo.value = newStatus.updateInfo
      if (newStatus.progress) progress.value = newStatus.progress
      error.value = newStatus.error || null

      if (newStatus.state === 'downloaded') {
        toast.add({
          title: t('appUpdate.downloadCompleted'),
          description: t('appUpdate.readyToInstall'),
          color: 'success',
          icon: 'i-lucide-check-circle'
        })
      }
    })

    // Query initial status
    updater.getStatus().then((res) => {
      if (res && res.status && res.data) {
        status.value = res.data.state
        currentVersion.value = res.data.currentVersion
        updateInfo.value = res.data.updateInfo
        progress.value = res.data.progress
        error.value = res.data.error || null
      }
    }).catch(() => {
      // ignore
    })
  }

  async function checkForUpdates(silent = false) {
    const updater = window.electronAPI?.appUpdater
    if (!updater) {
      if (!silent) {
        toast.add({
          title: t('appUpdate.notSupportedInBrowser'),
          color: 'warning'
        })
      }
      return
    }

    status.value = 'checking'
    error.value = null

    try {
      const res = await updater.checkForUpdates()
      if (res && res.status) {
        const data = res.data as { hasUpdate?: boolean, latestVersion?: string, message?: string } | undefined
        if (data && data.hasUpdate === false) {
          if (!silent) {
            toast.add({
              title: t('appUpdate.upToDate'),
              color: 'success',
              icon: 'i-lucide-check-circle'
            })
          }
        } else if (data && data.hasUpdate === true) {
          isUpdateModalOpen.value = true
          toast.add({
            title: t('appUpdate.updateAvailable'),
            description: `v${data.latestVersion || ''}`,
            color: 'primary',
            icon: 'i-lucide-arrow-up-circle'
          })
        }
      } else {
        if (!silent) {
          toast.add({
            title: res?.message || t('appUpdate.checkFailed'),
            color: 'error'
          })
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      status.value = 'error'
      if (!silent) {
        toast.add({
          title: msg,
          color: 'error'
        })
      }
    }
  }

  async function startDownload() {
    const updater = window.electronAPI?.appUpdater
    if (!updater) return

    status.value = 'downloading'
    progress.value = { percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 }
    error.value = null

    try {
      const res = await updater.downloadUpdate()
      if (!res.status && res.message) {
        error.value = res.message
        status.value = 'error'
        toast.add({ title: res.message, color: 'error' })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      error.value = msg
      status.value = 'error'
      toast.add({ title: msg, color: 'error' })
    }
  }

  function quitAndInstall() {
    const updater = window.electronAPI?.appUpdater
    if (!updater) return
    updater.quitAndInstall()
  }

  function openModal() {
    isUpdateModalOpen.value = true
  }

  function closeModal() {
    isUpdateModalOpen.value = false
  }

  onMounted(() => {
    initListeners()
  })

  return {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isUpdateModalOpen,
    isElectron,
    checking,
    downloading,
    downloaded,
    hasUpdate,
    initListeners,
    checkForUpdates,
    startDownload,
    quitAndInstall,
    openModal,
    closeModal
  }
}
