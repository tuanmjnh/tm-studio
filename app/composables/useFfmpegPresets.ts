import { ref, computed, watch } from 'vue'
import type { FfmpegConfig } from '#shared/types/electron'

const PRESET_STORAGE_KEY = 'tools:video:last_preset_id'

export function useFfmpegPresets() {
  const taskManager = useToolTaskManager('ffmpeg')
  const toast = useToast()
  const { t } = useI18n()

  const presets = ref<FfmpegConfig[]>([])
  const selectedPresetId = ref<string>(
    import.meta.client ? (localStorage.getItem(PRESET_STORAGE_KEY) || '') : ''
  )
  const editingConfig = ref<FfmpegConfig | null>(null)
  const savingConfig = ref(false)
  const deletingPreset = ref(false)
  const deletePresetTarget = ref<FfmpegConfig | null>(null)

  const showConfigSlideover = ref(false)
  const showDeletePresetModal = ref(false)
  const showPresetListModal = ref(false)

  const config = ref<Partial<FfmpegConfig>>({
    title: '',
    aspect_ratio: 0,
    background_type: 'color',
    background_color: '#000000',
    background_boxblur: 10,
    background_file: '',
    center: 1,
    speed: 1,
    volume: 1,
    zoom_enable: 0,
    zoom_ratio: 1.1,
    zoom_time_start: 0,
    zoom_time_duration: 0,
    zoom_time_loop: 0,
    hflip_enable: 0,
    hflip_all: 1,
    hflip_time_start: 0,
    hflip_time_duration: 0,
    hflip_time_loop: 0,
    vflip_enable: 0,
    vflip_all: 1,
    vflip_time_start: 0,
    vflip_time_duration: 0,
    vflip_time_loop: 0,
    scale_x: 0,
    scale_y: 0,
    scale_w: 0,
    scale_h: 0,
    labels: [],
    files: [],
    subtitle: '',
    render_code: ''
  })

  const selectedPresetTitle = computed(() => {
    return presets.value.find((p: FfmpegConfig) => p.id === selectedPresetId.value)?.title || ''
  })

  const presetOptions = computed(() => {
    return presets.value.map((p: FfmpegConfig) => ({ label: p.title, value: p.id }))
  })

  async function loadPresets() {
    presets.value = await taskManager.api!.listFfmpegConfigs?.() || []
    const savedId = selectedPresetId.value || (import.meta.client ? (localStorage.getItem(PRESET_STORAGE_KEY) || '') : '')
    if (savedId) {
      const matched = presets.value.find((p: FfmpegConfig) => p.id === savedId)
      if (matched) {
        selectedPresetId.value = savedId
        applyPreset(matched)
      } else {
        selectedPresetId.value = ''
        if (import.meta.client) {
          localStorage.removeItem(PRESET_STORAGE_KEY)
        }
      }
    }
  }

  function applyPreset(preset: FfmpegConfig) {
    selectedPresetId.value = preset.id
    config.value = {
      ...preset,
      aspect_ratio: Number(preset.aspect_ratio ?? 0),
      scale_x: Number(preset.scale_x ?? 0),
      scale_y: Number(preset.scale_y ?? 0),
      scale_w: Number(preset.scale_w ?? 0),
      scale_h: Number(preset.scale_h ?? 0)
    }
    if (typeof preset.labels === 'string') {
      try {
        config.value.labels = JSON.parse(preset.labels)
      } catch (e) {
        config.value.labels = []
        console.error(e)
      }
    }
    if (typeof preset.files === 'string') {
      try {
        config.value.files = JSON.parse(preset.files)
      } catch (e) {
        config.value.files = []
        console.error(e)
      }
    }
  }

  watch(selectedPresetId, (newId) => {
    if (import.meta.client) {
      if (newId) {
        localStorage.setItem(PRESET_STORAGE_KEY, newId)
      } else {
        localStorage.removeItem(PRESET_STORAGE_KEY)
      }
    }
    if (newId) {
      const preset = presets.value.find(p => p.id === newId)
      if (preset && config.value.id !== newId) {
        applyPreset(preset)
      }
    } else {
      resetConfig()
    }
  })

  function resetConfig() {
    if (selectedPresetId.value) {
      selectedPresetId.value = ''
    }
    config.value = {
      title: '',
      aspect_ratio: 0,
      background_type: 'color',
      background_color: '#000000',
      background_boxblur: 10,
      background_file: '',
      center: 1,
      speed: 1,
      volume: 1,
      zoom_enable: 0,
      zoom_ratio: 1.1,
      zoom_time_start: 0,
      zoom_time_duration: 0,
      zoom_time_loop: 0,
      hflip_enable: 0,
      hflip_all: 1,
      hflip_time_start: 0,
      hflip_time_duration: 0,
      hflip_time_loop: 0,
      vflip_enable: 0,
      vflip_all: 1,
      vflip_time_start: 0,
      vflip_time_duration: 0,
      vflip_time_loop: 0,
      scale_x: 0,
      scale_y: 0,
      scale_w: 0,
      scale_h: 0,
      labels: [],
      files: [],
      subtitle: '',
      render_code: ''
    }
  }

  async function savePreset(data: Partial<FfmpegConfig>) {
    savingConfig.value = true
    try {
      const payload = JSON.parse(JSON.stringify({ ...data, flag: 1 }))
      const rs = await taskManager.api!.createFfmpegConfig?.(payload)
      if (rs?.status) {
        toast.add({ title: t('tools.configSaved'), color: 'success' })
        await loadPresets()
        selectedPresetId.value = rs.data?.id || ''
      } else {
        toast.add({ title: t('tools.configSaveFailed'), color: 'error' })
      }
    } finally {
      savingConfig.value = false
      showConfigSlideover.value = false
    }
  }

  async function updatePreset(data: Partial<FfmpegConfig>) {
    if (!editingConfig.value?.id) return
    savingConfig.value = true
    try {
      const payload = JSON.parse(JSON.stringify(data))
      const rs = await taskManager.api!.updateFfmpegConfig?.({ id: editingConfig.value.id, data: payload })
      if (rs?.status) {
        toast.add({ title: t('tools.configSaved'), color: 'success' })
        await loadPresets()
        const updated = presets.value.find(p => p.id === editingConfig.value?.id)
        if (updated) {
          applyPreset(updated)
        }
      } else {
        toast.add({ title: t('tools.configSaveFailed'), color: 'error' })
      }
    } finally {
      savingConfig.value = false
      showConfigSlideover.value = false
    }
  }

  function openCreateConfig() {
    editingConfig.value = null
    showConfigSlideover.value = true
  }

  function openEditConfig(preset: FfmpegConfig) {
    editingConfig.value = preset
    showConfigSlideover.value = true
  }

  function onEditPresetClick() {
    const preset = presets.value.find(p => p.id === selectedPresetId.value)
    if (preset) openEditConfig(preset)
  }

  function onSaveConfig(data: Partial<FfmpegConfig>) {
    if (editingConfig.value?.id) updatePreset(data)
    else savePreset(data)
  }

  function openDeletePreset(preset: FfmpegConfig) {
    deletePresetTarget.value = preset
    showConfigSlideover.value = false
    showDeletePresetModal.value = true
  }

  async function doDeletePreset() {
    if (!deletePresetTarget.value) return
    const id = deletePresetTarget.value.id
    deletingPreset.value = true
    try {
      const rs = await taskManager.api!.deleteFfmpegConfig?.(id)
      if (rs?.status) {
        toast.add({ title: t('tools.configDeleted'), color: 'success' })
        await loadPresets()
        if (selectedPresetId.value === id) {
          selectedPresetId.value = ''
          resetConfig()
        }
      }
    } finally {
      deletingPreset.value = false
      showDeletePresetModal.value = false
      deletePresetTarget.value = null
    }
  }

  return {
    presets,
    selectedPresetId,
    selectedPresetTitle,
    presetOptions,
    config,
    editingConfig,
    savingConfig,
    deletingPreset,
    deletePresetTarget,
    showConfigSlideover,
    showDeletePresetModal,
    showPresetListModal,
    loadPresets,
    applyPreset,
    resetConfig,
    savePreset,
    updatePreset,
    openCreateConfig,
    openEditConfig,
    onEditPresetClick,
    onSaveConfig,
    openDeletePreset,
    doDeletePreset
  }
}
