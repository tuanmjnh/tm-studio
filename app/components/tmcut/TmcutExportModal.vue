<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useToolTaskManager } from '~/composables/useToolTaskManager'
import { useFileSystem } from '~/composables/useFileSystem'
import { compileTimelineToFfmpeg } from '~/utils/tmcut/compiler'
import type { TmcutCompileMode } from '~/utils/tmcut/compiler'
import { canvasFpsValue } from '~/utils/tmcut/canvas'
import { useTmcutExportQueue } from '~/composables/useTmcutExportQueue'
import { useTmcutTelemetry } from '~/composables/useTmcutTelemetry'
import { useTmcutUsageTracker } from '~/composables/useTmcutUsageTracker'
import type { ToolTask } from '#shared/types/electron'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { currentProject, contentDuration, timelineTransitionCount } = useTmcutProject()
const { formatTimecode, renderRange } = useTmcutPlayback()
const { findAssetBySrc, mediaUrl } = useTmcutMedia()
const { pickFile, pickFolder } = useFileSystem()
const taskManager = useToolTaskManager('ffmpeg')
const { enqueueJob, activeJobsCount, queueModalOpen, activeJobId, cancelJob } = useTmcutExportQueue()
const toast = useToast()
const telemetry = useTmcutTelemetry()
const usage = useTmcutUsageTracker()

// Phase 10: record one export event + usage counter when a render completes.
// Opt-in only — telemetry.record is a no-op when the user has not enabled it.
function recordExportCompleted() {
  const durationSec = Math.round(contentDuration.value || 0)
  telemetry.trackExport('render-complete', {
    exportFormat: videoFormat.value,
    exportDurationSec: durationSec,
    canvasWidth: canvasW.value,
    canvasHeight: canvasH.value,
    fps: effectiveFps.value
  })
  usage.trackExport({ durationSec })
}

// ---- Output configuration (design #3) ----
const outputPath = ref('')
const mode = ref<TmcutCompileMode>('video')
const rangeMode = ref<'full' | 'inout'>('full')
const outScale = ref(1)
const fps = ref(0) // 0 = follow the canvas fps

// Format & Codec (design #3)
type VideoFormatKey = 'mp4-h264' | 'mp4-h265' | 'mov-prores' | 'webm-vp9'
const videoFormat = ref<VideoFormatKey>('mp4-h264')

// Bitrate options (design #3)
type BitratePresetKey = 'standard' | 'recommended' | 'high' | 'custom'
const bitratePreset = ref<BitratePresetKey>('recommended')
const customBitrate = ref(32)

const effectiveBitrateMbps = computed(() => {
  if (bitratePreset.value === 'standard') return 22
  if (bitratePreset.value === 'recommended') return 32
  if (bitratePreset.value === 'high') return 45
  return Math.max(1, Math.min(200, Number(customBitrate.value) || 32))
})

// Hardware Acceleration Engine (§10, §13)
const hwEngineEnabled = ref(true)
const autoPreview = ref(true)
const gpuSupport = ref<{ nvenc: boolean, amf: boolean, qsv: boolean, gpus: string[] }>({
  nvenc: false,
  amf: false,
  qsv: false,
  gpus: []
})
const profileOverride = ref<'nvenc' | 'qsv' | 'amf' | 'cpu' | null>(null)

async function detectHardware() {
  if (window.electronAPI?.tools?.ffmpeg?.detectGpuSupport) {
    try {
      const res = await window.electronAPI.tools.ffmpeg.detectGpuSupport()
      if (res) {
        gpuSupport.value = res
      }
    } catch {
      // ignore
    }
  }
}

function selectEncoderProfile(p: 'nvenc' | 'qsv' | 'amf' | 'cpu') {
  if (p === 'nvenc') {
    if (!gpuSupport.value.nvenc) {
      toast.add({ title: 'NVIDIA NVENC', description: t('tmcut.export.hwUnsupported'), color: 'warning' })
      return
    }
    profileOverride.value = 'nvenc'
    hwEngineEnabled.value = true
  } else if (p === 'qsv') {
    if (!gpuSupport.value.qsv) {
      toast.add({ title: 'Intel QSV', description: t('tmcut.export.hwUnsupported'), color: 'warning' })
      return
    }
    profileOverride.value = 'qsv'
    hwEngineEnabled.value = true
  } else if (p === 'amf') {
    if (!gpuSupport.value.amf) {
      toast.add({ title: 'AMD AMF', description: t('tmcut.export.hwUnsupported'), color: 'warning' })
      return
    }
    profileOverride.value = 'amf'
    hwEngineEnabled.value = true
  } else {
    profileOverride.value = 'cpu'
    hwEngineEnabled.value = false
  }
}

// Active encoder resolution
const activeEncoder = computed(() => {
  if (!hwEngineEnabled.value || profileOverride.value === 'cpu') {
    if (videoFormat.value === 'mp4-h265') return 'libx265'
    if (videoFormat.value === 'mov-prores') return 'prores_ks'
    if (videoFormat.value === 'webm-vp9') return 'libvpx-vp9'
    return 'libx264'
  }

  const prof = profileOverride.value
  if (videoFormat.value === 'mp4-h264') {
    if (prof === 'nvenc' && gpuSupport.value.nvenc) return 'h264_nvenc'
    if (prof === 'qsv' && gpuSupport.value.qsv) return 'h264_qsv'
    if (prof === 'amf' && gpuSupport.value.amf) return 'h264_amf'
    if (!prof) {
      if (gpuSupport.value.nvenc) return 'h264_nvenc'
      if (gpuSupport.value.qsv) return 'h264_qsv'
      if (gpuSupport.value.amf) return 'h264_amf'
    }
    return 'libx264'
  }

  if (videoFormat.value === 'mp4-h265') {
    if (prof === 'nvenc' && gpuSupport.value.nvenc) return 'hevc_nvenc'
    if (prof === 'qsv' && gpuSupport.value.qsv) return 'hevc_qsv'
    if (prof === 'amf' && gpuSupport.value.amf) return 'hevc_amf'
    if (!prof) {
      if (gpuSupport.value.nvenc) return 'hevc_nvenc'
      if (gpuSupport.value.qsv) return 'hevc_qsv'
      if (gpuSupport.value.amf) return 'hevc_amf'
    }
    return 'libx265'
  }

  if (videoFormat.value === 'mov-prores') return 'prores_ks'
  if (videoFormat.value === 'webm-vp9') return 'libvpx-vp9'

  return 'libx264'
})

const detectedGpuName = computed(() => {
  if (gpuSupport.value.gpus && gpuSupport.value.gpus.length > 0) {
    return gpuSupport.value.gpus[0]
  }
  return 'Standard GPU/CPU Engine'
})

const hwInfo = computed(() => {
  const enc = activeEncoder.value
  const isGpu = enc.includes('nvenc') || enc.includes('qsv') || enc.includes('amf')
  return {
    label: isGpu
      ? `${detectedGpuName.value} (${enc})`
      : 'CPU Software Engine (libx264)',
    desc: isGpu
      ? t('tmcut.export.hwToggleDesc')
      : t('tmcut.export.hwCpuDesc')
  }
})

const audioFormat = ref<'mp3' | 'wav'>('mp3')
const audioBitrate = ref(320)
// Noise reduction (roadmap D-3)
const denoise = ref(false)

// Color LUT (roadmap E-4)
const lut3dPath = ref<string | null>(null)
const lut3dName = computed(() =>
  lut3dPath.value ? (lut3dPath.value.split(/[\\/]/).pop() || lut3dPath.value) : ''
)

async function pickLutFile() {
  const path = await pickFile({
    title: t('tmcut.export.lutChoose'),
    filters: [{ name: 'LUT', extensions: ['cube'] }]
  })
  if (!path || typeof path !== 'string') return
  if (path.includes('\'')) {
    toast.add({ title: t('tmcut.export.lutBadPath'), color: 'warning' })
    return
  }
  lut3dPath.value = path
}

// ---- Progress / result state ----
const isExporting = ref(false)
const exportDone = ref(false)
const exportError = ref('')
const previewModalOpen = ref(false)
const watchFolder = ref(false)
const lastWatchedPath = ref('')

// Web export (web-parity step 3): the browser posts the compiled ffmpeg args
// to the Nitro server, which runs ffmpeg and returns a /uploads/ URL. This
// holds that result so the completed row can offer a plain download.
const webResultUrl = ref('')
const isWebRendering = ref(false)
const webProgress = ref(0)

const isDesktop = computed(() => !!window.electronAPI?.tmcut)

let offRenderDone: (() => void) | null = null

function normalizeWatchPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').toLowerCase()
}

function stopWatching() {
  if (offRenderDone) {
    offRenderDone()
    offRenderDone = null
  }
  const api = window.electronAPI?.tmcut
  if (lastWatchedPath.value && api?.unwatchOutput) {
    api.unwatchOutput({ filePath: lastWatchedPath.value }).catch(() => {})
  }
  lastWatchedPath.value = ''
}

function startWatching(filePath: string) {
  const api = window.electronAPI?.tmcut
  if (!api?.watchOutput || !api?.onRenderDone) return
  stopWatching()
  lastWatchedPath.value = filePath
  api.watchOutput({ filePath }).catch(() => {})
  offRenderDone = api.onRenderDone((payload) => {
    if (normalizeWatchPath(payload.filePath) !== normalizeWatchPath(filePath)) return
    if (!exportDone.value) {
      isExporting.value = false
      exportDone.value = true
      recordExportCompleted()
      toast.add({ title: t('tmcut.export.success'), color: 'success' })
      if (autoPreview.value) {
        previewModalOpen.value = true
      }
    }
    stopWatching()
  })
}

// ---- Derived canvas / output info ----
const canvasW = computed(() => currentProject.value?.canvas?.width || 1920)
const canvasH = computed(() => currentProject.value?.canvas?.height || 1080)
const canvasFps = computed(() => canvasFpsValue(currentProject.value?.canvas))

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

const aspectLabel = computed(() => {
  const g = gcd(canvasW.value, canvasH.value) || 1
  return `${canvasW.value / g}:${canvasH.value / g}`
})

function scaledSize(scale: number): { w: number, h: number } {
  return {
    w: Math.trunc((canvasW.value * scale) / 2) * 2,
    h: Math.trunc((canvasH.value * scale) / 2) * 2
  }
}

const outputW = computed(() => scaledSize(outScale.value).w)
const outputH = computed(() => scaledSize(outScale.value).h)
const effectiveFps = computed(() => (fps.value > 0 ? fps.value : canvasFps.value))

const ext = computed(() => {
  if (mode.value === 'audio') return audioFormat.value === 'wav' ? 'wav' : 'mp3'
  if (mode.value === 'gif') return 'gif'
  if (videoFormat.value === 'mov-prores') return 'mov'
  if (videoFormat.value === 'webm-vp9') return 'webm'
  return 'mp4'
})

// File name / destination split over a single outputPath (design #3 header)
const fileName = computed({
  get: () => outputPath.value.split(/[\\/]/).pop() || '',
  set: (value: string) => {
    outputPath.value = joinDir(dirName.value, value)
  }
})

const dirName = computed(() => outputPath.value.replace(/[\\/][^\\/]*$/, ''))

function joinDir(dir: string, name: string): string {
  if (!dir) return name
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${dir}${sep}${name}`
}

async function pickDestinationFolder() {
  const defaultDir = dirName.value || undefined
  const picked = await pickFolder({
    title: t('tmcut.export.browseFolder'),
    defaultPath: defaultDir
  })
  if (picked) {
    outputPath.value = joinDir(picked, fileName.value)
  }
}

// Keep the extension in sync when the output mode/format changes
watch([mode, audioFormat, videoFormat], () => {
  if (!outputPath.value || !fileName.value) return
  const base = fileName.value.replace(/\.(mp4|mov|mkv|webm|avi|m4a|mp3|wav|gif|png)$/i, '')
  const next = `${base}.${ext.value}`
  if (next !== fileName.value) fileName.value = next
})

// ---- In/Out render zone (design #3 range selector) ----
const hasRange = computed(() => !!renderRange.value)

const activeRange = computed(() => (
  rangeMode.value === 'inout' ? renderRange.value : null
))

watch(renderRange, (value) => {
  if (!value && rangeMode.value === 'inout') rangeMode.value = 'full'
})

const rangeLabel = computed(() => {
  const range = renderRange.value
  if (!range) return t('tmcut.export.rangeInOutEmpty')
  return t('tmcut.export.rangeInOut', {
    in: formatTimecode(range.start),
    out: formatTimecode(range.end)
  })
})

// ---- Specs (duration / estimated size / audio) ----
// Full-range must match what the compiler renders: the last frame of content,
// never the ruler's 5-second padding.
const outputDuration = computed(() => {
  const range = activeRange.value
  return range ? range.end - range.start : contentDuration.value
})

const estimatedSize = computed<string | null>(() => {
  if (mode.value === 'gif') return null
  const duration = outputDuration.value
  if (duration <= 0) return null
  let videoMbps = 0
  if (mode.value === 'video') {
    videoMbps = effectiveBitrateMbps.value
  }
  const audioMbps = mode.value === 'audio'
    ? (audioFormat.value === 'wav' ? 1.536 : audioBitrate.value / 1000)
    : 0.192
  const mb = ((videoMbps + audioMbps) * duration) / 8
  return `~${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`
})

const audioSpecValue = computed(() => {
  if (mode.value === 'gif') return '—'
  if (mode.value === 'audio') {
    return audioFormat.value === 'wav'
      ? t('tmcut.export.audioWavSpec')
      : t('tmcut.export.audioMp3Spec', { kbps: audioBitrate.value })
  }
  return t('tmcut.export.audioVideoSpec')
})

// ---- Poster preview ----
const posterUrl = computed(() => {
  const videoTrack = currentProject.value?.timeline?.tracks.find(tr => tr.type === 'video')
  const clip = videoTrack?.items.find(c => !!c.src)
  if (!clip?.src) return ''
  const asset = findAssetBySrc(clip.src)
  return asset?.thumbPath ? mediaUrl(asset.thumbPath) : ''
})

// Honest warning for the parallel-track gap (R122): the preview scans
// every video/text track, but compileTimelineToFfmpeg still takes only
// the FIRST of each. Whenever a SECOND track of a rendered type carries
// clips, the exported file will not match the preview — warn instead of
// surprising the user with missing layers.
const parallelTracksWarning = computed(() => {
  const tracks = currentProject.value?.timeline?.tracks
  if (!tracks) return false
  let seenVideo = false
  let seenText = false
  for (const track of tracks) {
    if ((track.items || []).length === 0) continue
    if (track.type === 'video') {
      if (seenVideo) return true
      seenVideo = true
    } else if (track.type === 'text') {
      if (seenText) return true
      seenText = true
    }
  }
  return false
})

const formatOptions = computed(() => [
  { value: 'mp4-h264', label: t('tmcut.export.formatMp4H264') },
  { value: 'mp4-h265', label: t('tmcut.export.formatMp4H265') },
  { value: 'mov-prores', label: t('tmcut.export.formatMovProres') },
  { value: 'webm-vp9', label: t('tmcut.export.formatWebmVp9') }
])

const modeTabs = computed(() => [
  { value: 'video' as const, label: t('tmcut.export.modeVideo'), icon: 'i-lucide-video' },
  { value: 'audio' as const, label: t('tmcut.export.modeAudio'), icon: 'i-lucide-audio-lines' },
  { value: 'gif' as const, label: t('tmcut.export.modeGif'), icon: 'i-lucide-image' }
])

const scaleOptions = [0.5, 1, 1.5, 2]

const fpsOptions = computed(() => {
  const values = [24, 25, 30, 50, 60]
  if (!values.includes(canvasFps.value)) values.unshift(canvasFps.value)
  return values.map(n => ({
    value: String(n),
    label: n === canvasFps.value ? t('tmcut.export.fpsCanvas', { n }) : `${n} fps`
  }))
})

const fpsValue = computed(() => String(effectiveFps.value))

// ---- Social presets (roadmap R8) ----
type SocialPreset = { id: string, labelKey: string, w: number, h: number, ratio: string, fps: number }

const socialPresets: SocialPreset[] = [
  { id: 'vertical', labelKey: 'tmcut.export.presetVertical', w: 1080, h: 1920, ratio: '9:16', fps: 30 },
  { id: 'youtube', labelKey: 'tmcut.export.presetYoutube', w: 1920, h: 1080, ratio: '16:9', fps: 30 },
  { id: 'square', labelKey: 'tmcut.export.presetSquare', w: 1080, h: 1080, ratio: '1:1', fps: 30 }
]

function presetFit(p: SocialPreset): boolean {
  if (!canvasW.value || !canvasH.value) return false
  const out = scaledSize(p.w / canvasW.value)
  return out.w === p.w && out.h === p.h
}

function applyPreset(p: SocialPreset) {
  if (!presetFit(p)) return
  outScale.value = p.w / canvasW.value
  fps.value = p.fps === canvasFps.value ? 0 : p.fps
}

function presetActive(p: SocialPreset): boolean {
  return presetFit(p)
    && Math.abs(outScale.value - p.w / canvasW.value) < 1e-9
    && effectiveFps.value === p.fps
}

// ---- Current task / progress ----
const activeTask = computed(() => taskManager.taskList.value[0])

const progressPercent = computed(() => activeTask.value?.progress ?? 0)

const exportSpeed = computed(() => (activeTask.value?.speed ? `${activeTask.value.speed}` : ''))

const etaText = computed(() => {
  if (!isExporting.value) return ''
  const speed = parseFloat(String(activeTask.value?.speed ?? ''))
  if (!isFinite(speed) || speed <= 0 || outputDuration.value <= 0) return ''
  const remain = ((1 - progressPercent.value / 100) * outputDuration.value) / speed
  return formatTimecode(remain)
})

onMounted(() => {
  taskManager.setupListeners()
  detectHardware()
})

onUnmounted(() => {
  stopWatching()
})

watch(open, (isOpen) => {
  if (isOpen) {
    exportDone.value = false
    exportError.value = ''
    detectHardware()
    if (!outputPath.value) {
      const sanitizedName = (currentProject.value?.name || 'TMCut_Video').replace(/[/\\:*?"<>|]/g, '_')
      outputPath.value = `D:/${sanitizedName}.${ext.value}`
    }
  } else {
    stopWatching()
  }
})

watch(
  () => activeTask.value?.status,
  (status) => {
    if (isExporting.value) {
      if (status === 'done') {
        isExporting.value = false
        exportDone.value = true
        recordExportCompleted()
        toast.add({ title: t('tmcut.export.success'), color: 'success' })
        if (autoPreview.value) {
          previewModalOpen.value = true
        }
      } else if (status === 'failed') {
        isExporting.value = false
        exportError.value = activeTask.value?.error || t('tmcut.export.errorDesc')
        toast.add({ title: t('tmcut.export.failed'), description: exportError.value, color: 'error' })
      }
    }
  }
)

function validateExportPreconditions(): boolean {
  if (!currentProject.value) return false
  // Web has no destination picker: the server owns the output path. Only the
  // desktop flow needs a chosen file path.
  if (isDesktop.value && (!outputPath.value || !fileName.value.trim())) {
    toast.add({ title: t('tmcut.export.specifyPath'), color: 'error' })
    return false
  }

  // Rotated text needs center alignment (roadmap R12)
  const rotatedConflict = (currentProject.value.timeline?.tracks ?? []).some(
    track => track.type === 'text'
      && (track.items ?? []).some(item => (item.rotation || 0) !== 0 && (item.align || 'center') !== 'center')
  )
  if (rotatedConflict) {
    toast.add({
      title: t('tmcut.export.rotationConflict'),
      description: t('tmcut.export.rotationConflictDesc'),
      color: 'warning'
    })
    return false
  }
  return true
}

function buildCompileResult() {
  if (!currentProject.value) {
    throw new Error('No active project to compile')
  }
  return compileTimelineToFfmpeg(currentProject.value, outputPath.value, {
    encoder: activeEncoder.value,
    bitrate: effectiveBitrateMbps.value,
    crf: 22,
    mode: mode.value,
    range: activeRange.value,
    outScale: outScale.value,
    outFps: mode.value === 'video' ? effectiveFps.value : undefined,
    audioBitrate: audioBitrate.value,
    denoise: denoise.value,
    lut3dPath: lut3dPath.value || undefined
  })
}

const specsSummary = computed(() => {
  if (mode.value === 'audio') {
    return `Audio ${audioFormat.value.toUpperCase()} · ${audioBitrate.value} kbps`
  }
  if (mode.value === 'gif') {
    return `GIF · ${outputW.value}x${outputH.value} · 15fps`
  }
  return `${outputW.value}x${outputH.value} · ${effectiveFps.value}fps · ${effectiveBitrateMbps.value}Mbps · ${activeEncoder.value}`
})

// Web export: POST the compiled ffmpeg args; the Nitro server starts a job and
// runs ffmpeg in the background. We then poll the job for REAL progress
// (ffmpeg's -progress output vs. the timeline span) until it finishes, and keep
// the resulting /uploads/ URL for the download button.
const WEB_POLL_MS = 700
const WEB_POLL_LIMIT = Math.ceil((20 * 60 * 1000) / WEB_POLL_MS)

async function runWebExport(compileResult: ReturnType<typeof buildCompileResult>): Promise<void> {
  isWebRendering.value = true
  webProgress.value = 0
  try {
    const started = await $fetch<{ ok: boolean, jobId: string }>('/api/v1/media/render', {
      method: 'POST',
      body: {
        args: compileResult.args,
        outputName: fileName.value || `render.${ext.value}`,
        duration: compileResult.duration
      }
    })

    for (let i = 0; i < WEB_POLL_LIMIT; i++) {
      await new Promise(resolve => setTimeout(resolve, WEB_POLL_MS))
      const job = await $fetch<{ status: string, progress: number, url: string | null, error: string | null }>(
        `/api/v1/media/render/${started.jobId}`
      )
      if (job.status === 'running') {
        webProgress.value = Math.max(0, Math.min(99, job.progress || 0))
        continue
      }
      if (job.status === 'done' && job.url) {
        webProgress.value = 100
        webResultUrl.value = job.url
        exportDone.value = true
        recordExportCompleted()
        toast.add({ title: t('tmcut.export.success'), color: 'success' })
        return
      }
      throw new Error(job.error || t('tmcut.export.errorDesc'))
    }
    throw new Error(t('tmcut.export.errorDesc'))
  } catch (err) {
    exportError.value = err instanceof Error ? err.message : String(err)
    toast.add({ title: t('tmcut.export.failed'), description: exportError.value, color: 'error' })
  } finally {
    isWebRendering.value = false
    isExporting.value = false
  }
}

// Save the rendered file from the server (the browser has no file handle).
function downloadWebResult(): void {
  if (!webResultUrl.value) return
  const link = document.createElement('a')
  link.href = webResultUrl.value
  link.download = fileName.value || 'render.mp4'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function startExport() {
  if (!validateExportPreconditions()) return

  isExporting.value = true
  exportDone.value = false
  exportError.value = ''
  webResultUrl.value = ''

  try {
    const compileResult = buildCompileResult()
    // Web runtime: hand the compiled args to the Nitro renderer instead of
    // the Electron ffmpeg bridge.
    if (!isDesktop.value) {
      await runWebExport(compileResult)
      return
    }
    const task: ToolTask = {
      args: compileResult.args,
      meta: {
        taskId: `tmcut-${Date.now()}`,
        output: outputPath.value,
        duration: compileResult.duration,
        threads: 1,
        startedAt: new Date().toISOString()
      }
    }

    enqueueJob({
      projectId: currentProject.value?.id,
      projectName: currentProject.value?.name || fileName.value,
      outputPath: outputPath.value,
      mode: mode.value,
      specs: specsSummary.value,
      duration: compileResult.duration,
      task,
      watchFolder: watchFolder.value && isDesktop.value,
      autoPreview: autoPreview.value
    }, true)

    if (watchFolder.value && isDesktop.value) {
      startWatching(outputPath.value)
    }
  } catch (err: unknown) {
    isExporting.value = false
    exportError.value = err instanceof Error ? err.message : String(err)
    toast.add({ title: t('tmcut.export.compilerError'), description: exportError.value, color: 'error' })
  }
}

function addToQueue() {
  if (!validateExportPreconditions()) return

  try {
    const compileResult = buildCompileResult()
    const task: ToolTask = {
      args: compileResult.args,
      meta: {
        taskId: `tmcut-${Date.now()}`,
        output: outputPath.value,
        duration: compileResult.duration,
        threads: 1,
        startedAt: new Date().toISOString()
      }
    }

    enqueueJob({
      projectId: currentProject.value?.id,
      projectName: currentProject.value?.name || fileName.value,
      outputPath: outputPath.value,
      mode: mode.value,
      specs: specsSummary.value,
      duration: compileResult.duration,
      task,
      watchFolder: watchFolder.value && isDesktop.value,
      autoPreview: autoPreview.value
    }, false)

    toast.add({
      title: t('tmcut.queue.jobAdded', { name: currentProject.value?.name || fileName.value }),
      color: 'success'
    })
  } catch (err: unknown) {
    exportError.value = err instanceof Error ? err.message : String(err)
    toast.add({ title: t('tmcut.export.compilerError'), description: exportError.value, color: 'error' })
  }
}

async function cancelExport() {
  if (activeJobId.value) {
    await cancelJob(activeJobId.value)
  } else {
    await taskManager.stopAll()
  }
  stopWatching()
  isExporting.value = false
}

function openResultFile() {
  if (outputPath.value && window.electronAPI?.openPath) {
    window.electronAPI.openPath(outputPath.value)
  }
}

function openResultFolder() {
  if (outputPath.value && window.electronAPI?.showItemInFolder) {
    window.electronAPI.showItemInFolder(outputPath.value)
  }
}

function previewResultDirectly() {
  previewModalOpen.value = true
}
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'w-[calc(100%-2rem)] max-w-5xl' }"
  >
    <template #content>
      <div class="flex flex-col max-h-[90vh] overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 shadow-2xl">
        <!-- HEADER: title + master badge + file name & destination grid -->
        <div class="px-5 py-4 bg-neutral-100 dark:bg-neutral-900 border-b border-neutral-300 dark:border-neutral-800 flex flex-col gap-3 shrink-0">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-7 h-7 rounded bg-primary/15 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-clapperboard" class="size-4 text-primary" />
              </div>
              <div class="flex items-baseline gap-2 min-w-0">
                <h2 class="text-base font-semibold text-neutral-800 dark:text-neutral-100 truncate">
                  {{ t('tmcut.export.title') }}
                </h2>
                <span class="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-primary text-[10px] font-medium tracking-wide shrink-0">
                  {{ t('tmcut.export.badgeMaster') }}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-list-checks"
                size="xs"
                variant="soft"
                :color="activeJobsCount > 0 ? 'primary' : 'neutral'"
                :title="t('tmcut.queue.title')"
                @click="queueModalOpen = true"
              >
                <span>{{ t('tmcut.export.queueCount', { n: activeJobsCount }) }}</span>
              </UButton>
              <UButton
                icon="i-lucide-x"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="open = false"
              />
            </div>
          </div>

          <!-- File name (7) + destination (5) -->
          <div class="grid grid-cols-12 gap-3">
            <div class="col-span-12 sm:col-span-7 flex items-center gap-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-lg px-3 py-1.5 focus-within:border-primary/50 transition-colors">
              <span class="text-xs text-neutral-500 dark:text-neutral-400 whitespace-nowrap">{{ t('tmcut.export.fileName') }}:</span>
              <UInput
                id="tmcut-export-file-name"
                v-model="fileName"
                :aria-label="t('tmcut.export.fileName')"
                size="sm"
                class="flex-1 min-w-0"
                :ui="{ base: 'border-0 bg-transparent focus:ring-0' }"
              />
              <span class="font-mono text-[11px] text-neutral-500">.{{ ext }}</span>
            </div>
            <!-- Destination picker is desktop-only (Electron folder dialog). On
                 web the server owns the output path, so show that instead of a
                 dead button. -->
            <div
              v-if="isDesktop"
              class="col-span-12 sm:col-span-5 flex items-center gap-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-lg px-3 py-1.5 focus-within:border-primary/50 transition-colors"
            >
              <UIcon name="i-lucide-folder-open" class="size-4 text-neutral-500 shrink-0" />
              <span class="font-mono text-xs text-neutral-500 dark:text-neutral-400 truncate flex-1 min-w-0" :title="dirName">{{ dirName || 'D:/' }}</span>
              <UButton
                size="xs"
                variant="soft"
                color="neutral"
                class="shrink-0"
                :title="t('tmcut.export.browseFolder')"
                @click="pickDestinationFolder"
              >
                {{ t('tmcut.export.browseFolder') }}
              </UButton>
            </div>
            <div
              v-else
              class="col-span-12 sm:col-span-5 flex items-center gap-2 bg-neutral-100 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-800 rounded-lg px-3 py-1.5"
            >
              <UIcon name="i-lucide-server" class="size-4 text-primary shrink-0" />
              <span class="text-xs text-neutral-500 dark:text-neutral-400 truncate flex-1 min-w-0">
                {{ t('tmcut.export.webDestination') }}
              </span>
            </div>
          </div>

          <!-- Watch folder (desktop only: it watches a local file path) -->
          <div v-if="isDesktop" class="flex items-center justify-between pt-0.5">
            <!-- UCheckbox renders role="checkbox" on a button, which <label>
                 cannot bind; the row is a plain click target instead, and the
                 checkbox itself stops propagation so a direct click toggles once. -->
            <div
              class="flex items-center gap-2.5 select-none"
              :class="isExporting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'"
              @click="isExporting || (watchFolder = !watchFolder)"
            >
              <UCheckbox
                v-model="watchFolder"
                :aria-label="t('tmcut.export.watchFolder')"
                :disabled="isExporting"
                size="sm"
                @click.stop
              />
              <UIcon name="i-lucide-folder-search" class="size-3.5 text-primary" />
              <span class="text-xs text-neutral-600 dark:text-neutral-300 font-medium">
                {{ t('tmcut.export.watchFolder') }} · {{ t('tmcut.export.watchFolderHint') }}
              </span>
            </div>
            <span class="font-mono text-[10px] text-primary/80 bg-neutral-200 dark:bg-neutral-800 px-2 py-0.5 rounded">media://watch-sync</span>
          </div>

          <!-- Transitions confirmation badge (Roadmap R3) -->
          <div
            v-if="timelineTransitionCount > 0 && mode !== 'audio'"
            class="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2"
          >
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0 mt-0.5" />
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-xs font-medium text-primary">
                {{ t('tmcut.export.transitionsTitle', { n: timelineTransitionCount }) }}
              </span>
              <span class="text-[11px] leading-snug text-neutral-600 dark:text-neutral-300">
                {{ t('tmcut.export.transitionsDesc') }}
              </span>
            </div>
          </div>
        </div>

        <!-- BODY: left specs (5) / right parameters (7) -->
        <div class="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-12">
          <!-- LEFT: poster + specs + range + hardware -->
          <div class="lg:col-span-5 p-5 flex flex-col gap-4 bg-neutral-100/60 dark:bg-neutral-950/60 lg:border-r border-neutral-300 dark:border-neutral-800">
            <!-- Poster preview -->
            <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 group">
              <img
                v-if="posterUrl"
                :src="posterUrl"
                alt=""
                class="w-full h-full object-cover"
              >
              <div v-else class="w-full h-full flex flex-col items-center justify-center gap-1.5 text-neutral-500 dark:text-neutral-600">
                <UIcon name="i-lucide-image" class="size-7" />
                <span class="text-[11px]">{{ t('tmcut.export.posterEmpty') }}</span>
              </div>
              <!-- Floating badges -->
              <div class="absolute top-2 left-2 flex items-center gap-1.5">
                <span class="px-1.5 py-0.5 rounded bg-black/70 backdrop-blur font-mono text-[10px] text-primary tracking-wider">
                  {{ outputW }}×{{ outputH }}
                </span>
                <span class="px-1.5 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] text-neutral-700 dark:text-neutral-200">
                  {{ aspectLabel }}
                </span>
              </div>
              <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur font-mono text-[11px] text-primary">
                {{ formatTimecode(outputDuration) }}
              </div>
            </div>

            <!-- Specs snapshot -->
            <div class="grid grid-cols-2 gap-3 p-3.5 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-neutral-500">{{ t('tmcut.export.specDuration') }}</span>
                <span class="font-mono text-sm text-neutral-800 dark:text-neutral-100 font-semibold">{{ formatTimecode(outputDuration) }}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-neutral-500">{{ t('tmcut.export.specSize') }}</span>
                <span class="text-sm text-primary font-bold">{{ estimatedSize ?? '—' }}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-neutral-500">{{ t('tmcut.export.projectResolution') }}</span>
                <span class="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">{{ canvasW }} × {{ canvasH }} px</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-neutral-500">{{ t('tmcut.export.specAudio') }}</span>
                <span class="font-mono text-[11px] text-neutral-600 dark:text-neutral-300">{{ audioSpecValue }}</span>
              </div>
            </div>

            <!-- Export range selector (In/Out zone) -->
            <div class="flex flex-col gap-1.5">
              <span class="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
                <UIcon name="i-lucide-clock" class="size-3.5" />
                {{ t('tmcut.export.rangeLabel') }}
              </span>
              <div class="grid grid-cols-2 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
                <button
                  type="button"
                  class="py-1.5 px-2 rounded text-xs font-semibold transition-colors"
                  :class="rangeMode === 'full'
                    ? 'bg-neutral-200 dark:bg-neutral-800 text-primary shadow-sm'
                    : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                  @click="rangeMode = 'full'"
                >
                  {{ t('tmcut.export.rangeFull') }}
                </button>
                <button
                  type="button"
                  class="py-1.5 px-2 rounded text-xs font-medium transition-colors"
                  :class="!hasRange
                    ? 'text-neutral-500 dark:text-neutral-600 cursor-not-allowed'
                    : rangeMode === 'inout'
                      ? 'bg-neutral-200 dark:bg-neutral-800 text-primary shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                  :disabled="!hasRange"
                  @click="rangeMode = 'inout'"
                >
                  {{ rangeLabel }}
                </button>
              </div>
              <p class="text-[10px] text-neutral-500 dark:text-neutral-600 leading-snug">
                {{ t('tmcut.export.rangeHint') }}
              </p>
            </div>

            <!-- Hardware status -->
            <div class="mt-auto p-3 rounded-lg bg-neutral-100/70 dark:bg-neutral-900/70 border border-neutral-300 dark:border-neutral-800 flex items-center gap-3">
              <div class="w-8 h-8 rounded bg-primary/15 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-cpu" class="size-4 text-primary" />
              </div>
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                  <span class="text-xs text-neutral-800 dark:text-neutral-100 font-medium truncate">{{ hwInfo.label }}</span>
                </div>
                <span class="text-[10px] text-neutral-500">
                  {{ isDesktop ? hwInfo.desc : t('tmcut.export.hwDesktopOnly') }}
                </span>
              </div>
            </div>
          </div>

          <!-- RIGHT: mode tabs + parameters -->
          <div class="lg:col-span-7 p-5 flex flex-col gap-4 bg-neutral-100/20 dark:bg-neutral-900/20">
            <!-- Mode tabs -->
            <div class="flex items-center gap-1 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
              <button
                v-for="tab in modeTabs"
                :key="tab.value"
                type="button"
                class="flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                :class="mode === tab.value
                  ? 'bg-primary/15 text-primary shadow-sm'
                  : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                @click="mode = tab.value"
              >
                <UIcon :name="tab.icon" class="size-3.5" />
                {{ tab.label }}
              </button>
            </div>

            <!-- VIDEO settings -->
            <template v-if="mode === 'video'">
              <!-- Social presets -->
              <div class="flex flex-col gap-1.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.presetsLabel') }}</span>
                <div class="grid grid-cols-3 gap-1.5">
                  <button
                    v-for="p in socialPresets"
                    :key="p.id"
                    type="button"
                    :disabled="!presetFit(p)"
                    :title="presetFit(p)
                      ? `${t(p.labelKey)} — ${p.w}×${p.h} · ${p.fps}fps`
                      : `${t(p.labelKey)} — ${t('tmcut.export.presetNeedsCanvas', { ratio: p.ratio })}`"
                    class="py-1.5 px-2 rounded-lg border text-center transition-colors"
                    :class="presetFit(p)
                      ? (presetActive(p)
                        ? 'bg-neutral-200 dark:bg-neutral-800 border-primary/40 text-neutral-800 dark:text-neutral-100'
                        : 'bg-neutral-100 dark:bg-neutral-900 border-neutral-300 dark:border-neutral-800 hover:border-neutral-400 dark:hover:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200')
                      : 'bg-neutral-100/50 dark:bg-neutral-900/50 border-neutral-300/50 dark:border-neutral-800/50 text-neutral-500 dark:text-neutral-600 cursor-not-allowed'"
                    @click="applyPreset(p)"
                  >
                    <span class="block text-[11px] font-medium truncate">{{ t(p.labelKey) }}</span>
                    <span class="block text-[9px] font-mono opacity-70">{{ p.w }}×{{ p.h }} · {{ p.fps }}</span>
                  </button>
                </div>
              </div>

              <!-- Output resolution -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.resLabel') }}</span>
                  <span class="font-mono text-[11px] text-primary">{{ t('tmcut.export.resCurrent', { w: outputW, h: outputH }) }}</span>
                </div>
                <div class="grid grid-cols-4 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
                  <button
                    v-for="s in scaleOptions"
                    :key="s"
                    type="button"
                    class="py-1.5 rounded text-center transition-colors"
                    :class="outScale === s
                      ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="outScale = s"
                  >
                    <span class="block text-xs font-semibold">{{ s }}×</span>
                    <span class="block text-[9px] opacity-70 font-mono">{{ scaledSize(s).w }}×{{ scaledSize(s).h }}</span>
                  </button>
                </div>
              </div>

              <!-- Frame rate & Format & Codec side-by-side -->
              <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.fpsLabel') }}</span>
                  <USelect
                    :model-value="fpsValue"
                    :aria-label="t('tmcut.export.fpsLabel')"
                    :items="fpsOptions"
                    size="sm"
                    class="w-full"
                    @update:model-value="(v: string | number) => { fps = Number(v) }"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.formatLabel') }}</span>
                  <USelect
                    v-model="videoFormat"
                    :aria-label="t('tmcut.export.formatLabel')"
                    :items="formatOptions"
                    size="sm"
                    class="w-full"
                  />
                </div>
              </div>

              <!-- Bitrate Options -->
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.bitrateLabel') }}</span>
                  <span class="font-mono text-[11px] text-primary">{{ effectiveBitrateMbps }} Mbps</span>
                </div>
                <div class="grid grid-cols-4 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
                  <button
                    type="button"
                    class="py-1.5 rounded text-[11px] text-center transition-colors"
                    :class="bitratePreset === 'standard'
                      ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="bitratePreset = 'standard'"
                  >
                    {{ t('tmcut.export.bitrateStandard') }}
                  </button>
                  <button
                    type="button"
                    class="py-1.5 rounded text-[11px] text-center transition-colors"
                    :class="bitratePreset === 'recommended'
                      ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="bitratePreset = 'recommended'"
                  >
                    {{ t('tmcut.export.bitrateRecommended') }}
                  </button>
                  <button
                    type="button"
                    class="py-1.5 rounded text-[11px] text-center transition-colors"
                    :class="bitratePreset === 'high'
                      ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="bitratePreset = 'high'"
                  >
                    {{ t('tmcut.export.bitrateHigh') }}
                  </button>
                  <button
                    type="button"
                    class="py-1.5 rounded text-[11px] text-center transition-colors"
                    :class="bitratePreset === 'custom'
                      ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="bitratePreset = 'custom'"
                  >
                    {{ t('tmcut.export.bitrateCustom', { mbps: customBitrate }) }}
                  </button>
                </div>
                <div v-if="bitratePreset === 'custom'" class="flex items-center gap-2 pt-1">
                  <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ t('tmcut.export.bitrateCustomLabel') }}:</span>
                  <UInput
                    id="tmcut-export-bitrate-custom"
                    v-model.number="customBitrate"
                    :aria-label="t('tmcut.export.bitrateCustomLabel')"
                    type="number"
                    size="xs"
                    min="1"
                    max="200"
                    class="w-24 font-mono"
                  />
                  <span class="text-xs text-neutral-500 dark:text-neutral-400 font-mono">Mbps</span>
                </div>
              </div>

              <!-- Hardware Acceleration Engine (§10, §13) -->
              <div class="flex flex-col gap-2.5 p-3.5 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-2.5">
                    <div class="w-6 h-6 rounded bg-primary/15 flex items-center justify-center text-primary">
                      <UIcon name="i-lucide-zap" class="size-3.5" />
                    </div>
                    <div>
                      <div class="text-xs font-medium text-neutral-700 dark:text-neutral-200">
                        {{ t('tmcut.export.hwToggle') }}
                      </div>
                      <div class="text-[10px] text-neutral-500">
                        {{ t('tmcut.export.hwToggleDesc') }}
                      </div>
                    </div>
                  </div>
                  <USwitch
                    v-model="hwEngineEnabled"
                    :aria-label="t('tmcut.export.hwToggle')"
                    size="sm"
                  />
                </div>

                <div class="flex flex-col gap-1.5 pt-1">
                  <span class="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.hwEncoderProfiles') }}:</span>
                  <div class="grid grid-cols-2 gap-2">
                    <!-- NVENC Profile -->
                    <div
                      class="p-2 rounded border flex items-center justify-between text-xs transition-colors cursor-pointer"
                      :class="activeEncoder.includes('nvenc')
                        ? 'bg-neutral-200 dark:bg-neutral-800 border-primary/40 text-neutral-800 dark:text-neutral-100'
                        : gpuSupport.nvenc
                          ? 'bg-neutral-100/60 dark:bg-neutral-950/60 border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-700'
                          : 'bg-neutral-100/30 dark:bg-neutral-950/30 border-neutral-300/40 dark:border-neutral-800/40 text-neutral-500 dark:text-neutral-600 cursor-not-allowed'"
                      @click="selectEncoderProfile('nvenc')"
                    >
                      <div class="flex items-center gap-1.5 truncate">
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          :class="activeEncoder.includes('nvenc') ? 'bg-primary animate-pulse' : gpuSupport.nvenc ? 'bg-emerald-400' : 'bg-neutral-300 dark:bg-neutral-600'"
                        />
                        <span class="font-medium truncate">NVIDIA NVENC</span>
                      </div>
                      <span
                        class="text-[10px] shrink-0 font-medium"
                        :class="activeEncoder.includes('nvenc') ? 'text-primary' : gpuSupport.nvenc ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-500 dark:text-neutral-600'"
                      >
                        {{ activeEncoder.includes('nvenc') ? t('tmcut.export.hwActive') : gpuSupport.nvenc ? t('tmcut.export.hwReady') : t('tmcut.export.hwUnsupported') }}
                      </span>
                    </div>

                    <!-- Intel QSV Profile -->
                    <div
                      class="p-2 rounded border flex items-center justify-between text-xs transition-colors cursor-pointer"
                      :class="activeEncoder.includes('qsv')
                        ? 'bg-neutral-200 dark:bg-neutral-800 border-primary/40 text-neutral-800 dark:text-neutral-100'
                        : gpuSupport.qsv
                          ? 'bg-neutral-100/60 dark:bg-neutral-950/60 border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-700'
                          : 'bg-neutral-100/30 dark:bg-neutral-950/30 border-neutral-300/40 dark:border-neutral-800/40 text-neutral-500 dark:text-neutral-600 cursor-not-allowed'"
                      @click="selectEncoderProfile('qsv')"
                    >
                      <div class="flex items-center gap-1.5 truncate">
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          :class="activeEncoder.includes('qsv') ? 'bg-primary animate-pulse' : gpuSupport.qsv ? 'bg-emerald-400' : 'bg-neutral-300 dark:bg-neutral-600'"
                        />
                        <span class="font-medium truncate">Intel QuickSync (QSV)</span>
                      </div>
                      <span
                        class="text-[10px] shrink-0 font-medium"
                        :class="activeEncoder.includes('qsv') ? 'text-primary' : gpuSupport.qsv ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-500 dark:text-neutral-600'"
                      >
                        {{ activeEncoder.includes('qsv') ? t('tmcut.export.hwActive') : gpuSupport.qsv ? t('tmcut.export.hwReady') : t('tmcut.export.hwUnsupported') }}
                      </span>
                    </div>

                    <!-- AMD AMF Profile -->
                    <div
                      class="p-2 rounded border flex items-center justify-between text-xs transition-colors cursor-pointer"
                      :class="activeEncoder.includes('amf')
                        ? 'bg-neutral-200 dark:bg-neutral-800 border-primary/40 text-neutral-800 dark:text-neutral-100'
                        : gpuSupport.amf
                          ? 'bg-neutral-100/60 dark:bg-neutral-950/60 border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-700'
                          : 'bg-neutral-100/30 dark:bg-neutral-950/30 border-neutral-300/40 dark:border-neutral-800/40 text-neutral-500 dark:text-neutral-600 cursor-not-allowed'"
                      @click="selectEncoderProfile('amf')"
                    >
                      <div class="flex items-center gap-1.5 truncate">
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          :class="activeEncoder.includes('amf') ? 'bg-primary animate-pulse' : gpuSupport.amf ? 'bg-emerald-400' : 'bg-neutral-300 dark:bg-neutral-600'"
                        />
                        <span class="font-medium truncate">AMD AMF</span>
                      </div>
                      <span
                        class="text-[10px] shrink-0 font-medium"
                        :class="activeEncoder.includes('amf') ? 'text-primary' : gpuSupport.amf ? 'text-neutral-500 dark:text-neutral-400' : 'text-neutral-500 dark:text-neutral-600'"
                      >
                        {{ activeEncoder.includes('amf') ? t('tmcut.export.hwActive') : gpuSupport.amf ? t('tmcut.export.hwReady') : t('tmcut.export.hwUnsupported') }}
                      </span>
                    </div>

                    <!-- CPU Profile -->
                    <div
                      class="p-2 rounded border flex items-center justify-between text-xs transition-colors cursor-pointer"
                      :class="!activeEncoder.includes('nvenc') && !activeEncoder.includes('qsv') && !activeEncoder.includes('amf')
                        ? 'bg-neutral-200 dark:bg-neutral-800 border-primary/40 text-neutral-800 dark:text-neutral-100'
                        : 'bg-neutral-100/60 dark:bg-neutral-950/60 border-neutral-300 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-700'"
                      @click="selectEncoderProfile('cpu')"
                    >
                      <div class="flex items-center gap-1.5 truncate">
                        <span
                          class="w-1.5 h-1.5 rounded-full shrink-0"
                          :class="!activeEncoder.includes('nvenc') && !activeEncoder.includes('qsv') && !activeEncoder.includes('amf') ? 'bg-primary' : 'bg-neutral-500'"
                        />
                        <span class="font-medium truncate">CPU / Software Engine</span>
                      </div>
                      <span
                        class="text-[10px] shrink-0 font-medium"
                        :class="!activeEncoder.includes('nvenc') && !activeEncoder.includes('qsv') && !activeEncoder.includes('amf') ? 'text-primary' : 'text-neutral-500 dark:text-neutral-400'"
                      >
                        {{ !activeEncoder.includes('nvenc') && !activeEncoder.includes('qsv') && !activeEncoder.includes('amf') ? t('tmcut.export.hwActive') : t('tmcut.export.hwReady') }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Auto-preview via media:// -->
                <div
                  class="flex items-center gap-2 pt-1 cursor-pointer select-none"
                  @click="autoPreview = !autoPreview"
                >
                  <UCheckbox
                    v-model="autoPreview"
                    :aria-label="t('tmcut.export.autoPreview')"
                    size="xs"
                    @click.stop
                  />
                  <UIcon name="i-lucide-play-square" class="size-3.5 text-primary shrink-0" />
                  <span class="text-[11px] text-neutral-600 dark:text-neutral-300">{{ t('tmcut.export.autoPreview') }}</span>
                </div>
              </div>

              <!-- Color LUT (roadmap E-4) -->
              <div v-if="isDesktop" class="flex flex-col gap-1.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.lutLabel') }}</span>
                <div class="flex items-center gap-1.5">
                  <UButton
                    size="xs"
                    variant="soft"
                    color="neutral"
                    icon="i-lucide-palette"
                    :class="lut3dPath ? 'flex-1 justify-start min-w-0' : ''"
                    @click="pickLutFile"
                  >
                    <span class="truncate">{{ lut3dPath ? lut3dName : t('tmcut.export.lutChoose') }}</span>
                  </UButton>
                  <UButton
                    v-if="lut3dPath"
                    icon="i-lucide-x"
                    size="xs"
                    variant="ghost"
                    color="neutral"
                    :title="t('tmcut.export.lutClear')"
                    @click="lut3dPath = null"
                  />
                </div>
                <p class="text-[10px] text-neutral-500 dark:text-neutral-600 leading-snug">
                  {{ t('tmcut.export.lutNote') }}
                </p>
              </div>
            </template>

            <!-- AUDIO settings -->
            <template v-else-if="mode === 'audio'">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.audioFormatLabel') }}</span>
                <div class="grid grid-cols-2 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
                  <button
                    v-for="fmt in ([{ value: 'mp3' }, { value: 'wav' }] as const)"
                    :key="fmt.value"
                    type="button"
                    class="py-2 px-2 rounded text-left transition-colors"
                    :class="audioFormat === fmt.value
                      ? 'bg-primary/15 text-primary shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="audioFormat = fmt.value"
                  >
                    <span class="block text-xs font-semibold">{{ fmt.value.toUpperCase() }}</span>
                    <span class="block text-[9px] opacity-80">
                      {{ fmt.value === 'mp3' ? t('tmcut.export.audioFormatMp3') : t('tmcut.export.audioFormatWav') }}
                    </span>
                  </button>
                </div>
              </div>

              <div
                v-if="audioFormat === 'mp3'"
                class="flex flex-col gap-1.5"
              >
                <span class="text-xs text-neutral-500 dark:text-neutral-400 font-medium">{{ t('tmcut.export.audioBitrateLabel') }}</span>
                <div class="grid grid-cols-3 gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg border border-neutral-300 dark:border-neutral-800">
                  <button
                    v-for="kbps in [128, 192, 320]"
                    :key="kbps"
                    type="button"
                    class="py-1.5 rounded text-[11px] transition-colors"
                    :class="audioBitrate === kbps
                      ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200/50 dark:hover:bg-neutral-800/50'"
                    @click="audioBitrate = kbps"
                  >
                    {{ kbps }} kbps
                  </button>
                </div>
              </div>

              <p class="text-[10px] text-neutral-500 dark:text-neutral-600 leading-snug">
                {{ t('tmcut.export.audioNote') }}
              </p>
            </template>

            <!-- GIF settings -->
            <template v-else>
              <div class="p-3 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-800 flex items-start gap-2.5">
                <UIcon name="i-lucide-info" class="size-4 text-primary shrink-0 mt-0.5" />
                <p class="text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                  {{ t('tmcut.export.gifNote') }}
                </p>
              </div>
            </template>

            <!-- Noise reduction (roadmap D-3) -->
            <div
              v-if="mode !== 'gif'"
              class="flex items-center gap-2.5 select-none"
              :class="isExporting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'"
              @click="isExporting || (denoise = !denoise)"
            >
              <UCheckbox
                v-model="denoise"
                :aria-label="t('tmcut.export.denoiseLabel')"
                :disabled="isExporting"
                size="sm"
                @click.stop
              />
              <UIcon name="i-lucide-waves" class="size-3.5 text-primary" />
              <span class="text-xs text-neutral-600 dark:text-neutral-300 font-medium">
                {{ t('tmcut.export.denoiseLabel') }} · {{ t('tmcut.export.denoiseNote') }}
              </span>
            </div>
          </div>
        </div>

        <!-- Multi-track honesty banner (R122): the ffmpeg compiler
             consumes the FIRST video/text track only, so parallel tracks
             preview but are not exported yet. Say so instead of shipping
             a silent surprise file. -->
        <div
          v-if="parallelTracksWarning"
          class="mx-5 mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-start gap-2 shrink-0"
        >
          <UIcon name="i-lucide-alert-triangle" class="size-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p class="text-[11px] text-amber-200 leading-snug">
            {{ t('tmcut.export.parallelTracksWarning') }}
          </p>
        </div>

        <!-- FOOTER: status/estimate + actions -->
        <div class="px-5 py-3 bg-neutral-100 dark:bg-neutral-900 border-t border-neutral-300 dark:border-neutral-800 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <!-- Status / estimate -->
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <template v-if="isExporting">
              <div class="h-1.5 w-32 sm:w-40 bg-neutral-200 dark:bg-neutral-800 rounded-full overflow-hidden shrink-0">
                <div
                  v-if="isWebRendering && webProgress === 0"
                  class="h-full w-1/3 bg-primary rounded-full animate-pulse"
                />
                <div
                  v-else
                  class="h-full bg-primary transition-all duration-200"
                  :style="{ width: `${isWebRendering ? webProgress : progressPercent}%` }"
                />
              </div>
              <span
                v-if="isWebRendering && webProgress === 0"
                class="text-[11px] text-primary font-medium shrink-0"
              >{{ t('tmcut.export.webRendering') }}</span>
              <span v-else class="font-mono text-xs text-primary font-semibold shrink-0">{{ isWebRendering ? webProgress : progressPercent }}%</span>
              <span
                v-if="etaText"
                class="text-[11px] text-neutral-500 dark:text-neutral-400 shrink-0"
              >
                {{ t('tmcut.export.etaLabel') }} {{ etaText }}
              </span>
              <span
                v-if="exportSpeed"
                class="hidden sm:inline text-[11px] text-neutral-500 shrink-0"
              >({{ exportSpeed }})</span>
            </template>

            <template v-else-if="exportDone">
              <span class="flex items-center gap-1.5 text-xs text-emerald-400 min-w-0">
                <UIcon name="i-lucide-check-circle-2" class="size-4 shrink-0" />
                <span class="truncate">{{ t('tmcut.export.completed') }}</span>
              </span>
              <div class="flex items-center gap-1.5 shrink-0">
                <!-- Web: the render lives on the server, so the only action is
                     a plain download (no file-system handle to open). -->
                <UButton
                  v-if="!isDesktop"
                  icon="i-lucide-download"
                  size="xs"
                  color="primary"
                  variant="soft"
                  :title="t('tmcut.export.download')"
                  @click="downloadWebResult"
                >
                  {{ t('tmcut.export.download') }}
                </UButton>
                <template v-else>
                  <UButton
                    icon="i-lucide-play"
                    size="xs"
                    color="primary"
                    variant="soft"
                    :title="t('tmcut.export.previewNow')"
                    @click="previewResultDirectly"
                  />
                  <UButton
                    icon="i-lucide-external-link"
                    size="xs"
                    variant="soft"
                    color="neutral"
                    :title="t('tmcut.export.openWithApp')"
                    @click="openResultFile"
                  />
                  <UButton
                    icon="i-lucide-folder"
                    size="xs"
                    variant="soft"
                    color="neutral"
                    :title="t('tmcut.export.openFolder')"
                    @click="openResultFolder"
                  />
                </template>
              </div>
            </template>

            <template v-else-if="exportError">
              <span
                class="text-xs text-red-400 truncate"
                :title="exportError"
              >{{ exportError }}</span>
            </template>

            <template v-else>
              <span class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <UIcon name="i-lucide-hard-drive" class="size-3.5 text-primary" />
                {{ t('tmcut.export.labelSize') }}:
                <strong class="font-mono text-neutral-800 dark:text-neutral-100">{{ estimatedSize ?? '—' }}</strong>
              </span>
              <span class="hidden sm:block w-1 h-1 rounded-full bg-neutral-300 dark:bg-neutral-700" />
              <span class="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                <UIcon name="i-lucide-clock" class="size-3.5 text-primary" />
                {{ t('tmcut.export.specDuration') }}:
                <strong class="font-mono text-neutral-800 dark:text-neutral-100">{{ formatTimecode(outputDuration) }}</strong>
              </span>
            </template>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2 shrink-0">
            <p
              v-if="!isDesktop && !isExporting && !exportDone"
              class="text-[11px] text-neutral-400 dark:text-neutral-500 mr-auto"
            >
              {{ t('tmcut.export.webRenderNote') }}
            </p>
            <UButton
              v-if="!isExporting"
              variant="soft"
              color="neutral"
              size="sm"
              @click="open = false"
            >
              {{ t('tmcut.export.close') }}
            </UButton>
            <UButton
              v-if="isExporting"
              color="primary"
              variant="soft"
              icon="i-lucide-list-checks"
              size="sm"
              @click="open = false; queueModalOpen = true"
            >
              {{ t('tmcut.export.viewQueue') }}
            </UButton>
            <UButton
              v-if="isExporting && isDesktop"
              color="error"
              variant="soft"
              size="sm"
              @click="cancelExport"
            >
              {{ t('tmcut.export.cancelExport') }}
            </UButton>
            <UButton
              v-if="!isExporting && !exportDone && isDesktop"
              color="neutral"
              variant="soft"
              icon="i-lucide-list-plus"
              size="sm"
              @click="addToQueue"
            >
              {{ t('tmcut.export.addToQueue') }}
            </UButton>
            <UButton
              v-if="!isExporting && !exportDone"
              color="primary"
              variant="solid"
              icon="i-lucide-download"
              size="sm"
              @click="startExport"
            >
              {{ t('tmcut.export.startExport') }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UModal>

  <!-- In-App Direct Video Preview Modal -->
  <ToolsVideoPreviewModal
    v-model:open="previewModalOpen"
    :file-path="outputPath"
    :title="currentProject?.name"
  />

  <!-- Export Queue Modal -->
  <TmcutExportQueueModal v-model:open="queueModalOpen" />
</template>
