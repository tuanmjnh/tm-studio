import { computed } from 'vue'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutMediaImport } from '~/composables/useTmcutMediaImport'
import { useTmcutEditorDialogs } from '~/composables/useTmcutEditorDialogs'
import { useFileSystem } from '~/composables/useFileSystem'
import {
  TMUTCANVAS_PRESETS,
  TMUTCUT_SOCIAL_PRESETS,
  findCanvasPreset,
  findCanvasPresetByDimensions,
  ratioLabel,
  canvasFpsValue
} from '~/utils/tmcut/canvas'

// Canvas contract of the editor: presets, aspect-ratio menu, background and
// frame rate. It lives beside the page instead of inside it so the toolbar
// menu and the status footer read one source; every mutation still goes
// through useTmcutProject, which owns saving and history.
export function useTmcutEditorCanvas() {
  const { t } = useI18n()
  const toast = useToast()
  const {
    currentProject,
    saveProject,
    switchCanvas,
    setCanvasBackground,
    duplicateAsProject
  } = useTmcutProject()
  const { isDesktop, uploadWebFile } = useTmcutMedia()
  const { mediaFilters } = useTmcutMediaImport()
  const { pickFile, pickWebFiles } = useFileSystem()
  const { customCanvas, showCustomCanvasModal } = useTmcutEditorDialogs()

  const fpsOptions = [
    { label: '24 FPS', value: 24 },
    { label: '30 FPS', value: 30 },
    { label: '60 FPS', value: 60 }
  ]

  const statusCanvasLabel = computed(() => {
    const canvas = currentProject.value?.canvas
    if (!canvas) return null
    return `${canvas.width}x${canvas.height} · ${canvasFpsValue(canvas)}fps`
  })

  // Canvas background image (roadmap Phase 4): the DSL + exporter already
  // support `{ type: 'image' }` (R76); this picks the file. Desktop stores
  // the absolute path (media:// resolves it at play/export time); web mode
  // keeps an object URL for the session, same as web-imported assets.
  async function handlePickBackgroundImage() {
    const imageFilters = [mediaFilters[2]!]
    try {
      if (!isDesktop.value) {
        const files = await pickWebFiles(imageFilters.flatMap(g => g.extensions), false)
        const file = files[0]
        if (!file) return
        // Upload it so the background is a durable /uploads/ URL: a blob: URL
        // dies on reload AND the server-side renderer cannot read it, so a web
        // export with an image background would fail.
        const uploaded = await uploadWebFile(file, file.name)
        setCanvasBackground('image', uploaded.url)
        return
      }
      const picked = await pickFile({ title: t('tmcut.canvas.bgImage'), filters: imageFilters })
      const path = Array.isArray(picked) ? picked[0] : picked
      if (!path) return
      setCanvasBackground('image', path)
    } catch (error) {
      console.error('Background image pick failed:', error)
      toast.add({ title: t('tmcut.canvas.bgImageFailed'), color: 'error' })
    }
  }

  const canvasPresets = computed(() => TMUTCANVAS_PRESETS.map(preset => ({
    label: t(`tmcut.ratios.${preset.id.replace(':', '_')}`),
    ratio: preset.id,
    width: preset.width,
    height: preset.height,
    icon: preset.icon
  })))

  const socialPresets = computed(() => TMUTCUT_SOCIAL_PRESETS.map(preset => ({
    label: t(`tmcut.social.${preset.id.replace(/-/g, '_')}`),
    presetId: preset.id,
    icon: preset.icon
  })))

  const currentRatioLabel = computed(() => {
    if (!currentProject.value?.canvas) return ''
    const { width, height } = currentProject.value.canvas
    return ratioLabel(width, height)
  })

  const canvasLabel = computed(() => {
    const canvas = currentProject.value?.canvas
    if (!canvas) return ''
    return `${currentRatioLabel.value} (${canvasFpsValue(canvas)}fps)`
  })

  function applyCanvasPreset(preset: { ratio: string, width: number, height: number }) {
    if (!currentProject.value) return
    switchCanvas(preset.width, preset.height)
    toast.add({
      title: t('tmcut.aspectRatioUpdated'),
      description: `${preset.ratio} (${preset.width}x${preset.height})`,
      color: 'success'
    })
  }

  function applySocialPreset(social: { presetId: string, label: string }) {
    const preset = findCanvasPreset(social.presetId)
    if (!preset || !currentProject.value) return
    switchCanvas(preset.width, preset.height)
    toast.add({
      title: t('tmcut.canvas.socialApplied'),
      description: `${social.label} · ${preset.id} (${preset.width}x${preset.height})`,
      color: 'success'
    })
  }

  function applyFps(fps: number) {
    if (!currentProject.value) return
    currentProject.value.canvas.fps = { numerator: fps, denominator: 1 }
    saveProject()
    toast.add({
      title: t('tmcut.fpsUpdated'),
      description: `${fps} FPS`,
      color: 'success'
    })
  }

  function handleDuplicateAs(presetId: string) {
    const cloned = duplicateAsProject(presetId)
    if (cloned) {
      toast.add({
        title: t('tmcut.reframe.duplicated', { ratio: findCanvasPreset(presetId)?.id || presetId }),
        color: 'success'
      })
    }
  }

  const canvasMenuItems = computed(() => {
    const currentWidth = currentProject.value?.canvas?.width
    const currentHeight = currentProject.value?.canvas?.height
    // canvas.fps is a rational (C16); the menu and the custom modal speak float.
    const currentFps = canvasFpsValue(currentProject.value?.canvas)

    const presetItems = canvasPresets.value.map(preset => ({
      label: `${preset.ratio} - ${preset.label}`,
      icon: preset.icon,
      checked: currentWidth === preset.width && currentHeight === preset.height,
      onSelect: () => applyCanvasPreset(preset)
    }))

    presetItems.push({
      label: t('tmcut.canvas.custom'),
      icon: 'i-lucide-settings-2',
      checked: !findCanvasPresetByDimensions(currentWidth || 0, currentHeight || 0),
      onSelect: () => {
        customCanvas.value = {
          width: currentWidth || 1080,
          height: currentHeight || 1080,
          fps: currentFps || 30
        }
        showCustomCanvasModal.value = true
      }
    })

    const socialItems = socialPresets.value.map(preset => ({
      label: preset.label,
      icon: preset.icon,
      onSelect: () => applySocialPreset(preset)
    }))

    const backgroundItems = [
      {
        label: t('tmcut.canvas.bgBlack'),
        icon: 'i-lucide-circle',
        onSelect: () => setCanvasBackground('color', '#000000')
      },
      {
        label: t('tmcut.canvas.bgWhite'),
        icon: 'i-lucide-circle',
        onSelect: () => setCanvasBackground('color', '#ffffff')
      },
      {
        label: t('tmcut.canvas.bgDark'),
        icon: 'i-lucide-circle',
        onSelect: () => setCanvasBackground('color', '#1a1a1a')
      },
      {
        label: t('tmcut.canvas.bgLight'),
        icon: 'i-lucide-circle',
        onSelect: () => setCanvasBackground('color', '#e5e5e5')
      },
      {
        label: t('tmcut.canvas.transparent'),
        icon: 'i-lucide-circle-dashed',
        onSelect: () => setCanvasBackground('transparent')
      },
      {
        label: t('tmcut.canvas.bgImage'),
        icon: 'i-lucide-image',
        onSelect: () => void handlePickBackgroundImage()
      }
    ]

    const fpsItems = fpsOptions.map(item => ({
      label: `${item.label}`,
      icon: 'i-lucide-gauge',
      checked: currentFps === item.value,
      onSelect: () => applyFps(item.value)
    }))

    return [presetItems, socialItems, backgroundItems, fpsItems]
  })

  return { canvasLabel, statusCanvasLabel, canvasMenuItems, handleDuplicateAs }
}
