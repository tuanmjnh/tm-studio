<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { selectFileRows } from 'tmcut-core'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { canvasFpsValue } from '~/utils/tmcut/canvas'
import { useTmcutPlatform } from '~/composables/useTmcutPlatform'
import { useTmcutTelemetry } from '~/composables/useTmcutTelemetry'
import { createWebExportHost } from '~/utils/tmcut/webExportHost'
import { planWebExport } from '~/utils/tmcut/webExportChoice'
import type { WebExportRefusalCode } from '~/utils/tmcut/webExportChoice'
import { useTmcutUsageTracker } from '~/composables/useTmcutUsageTracker'

const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { currentProject, contentDuration, timelineTransitionCount } = useTmcutProject()
const { formatTimecode } = useTmcutPlayback()
const { findAssetBySrc, mediaUrl, resolveMediaSrc, bytesForAsset } = useTmcutMedia()
// ADR-014: the host answer, not a global sniff. Zero-FFmpeg slice I deleted the
// desktop render queue, so this object now only answers "where can this window
// write" — both hosts paint and encode the picture here.
const platform = useTmcutPlatform()
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

const UNSAFE_NAME = /[/:*?"<>|]/g

const isDesktop = computed(() => platform.info.name === 'electron')

// ---- Output configuration ----
// One writer, one answer: the WebCodecs session asks for H.264 in MP4 and the
// preset ladder answers with exactly that or nothing. Audio mode, GIF, the other
// codecs, in/out ranges, denoise and LUTs were FFmpeg argument choices; a
// control that can only be refused is worse than no control.
const videoFormat = ref<'mp4-h264'>('mp4-h264')
const mode = ref<'video'>('video')
const outScale = ref(1)
const fps = ref(0) // 0 = follow the canvas fps

const fileName = ref('')

watch(open, (isOpen) => {
  if (isOpen) {
    exportDone.value = false
    exportError.value = ''
    releaseWebResult()
    if (!fileName.value) {
      const safe = (currentProject.value?.name || 'TMCut_Video').replace(UNSAFE_NAME, '_')
      fileName.value = safe
    }
  }
})

// ---- Progress / result state ----
const isExporting = ref(false)
const exportDone = ref(false)
const exportError = ref('')
const previewModalOpen = ref(false)
const webResultUrl = ref('')
const isWebRendering = ref(false)
const webProgress = ref(0)

const progressPercent = computed(() => (isWebRendering.value ? webProgress.value : 0))

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

const downloadName = computed(() => {
  const base = fileName.value.trim().replace(/\.(mp4|mov|mkv|webm|avi|m4a|mp3|wav|gif|png)$/i, '')
  return `${base || 'TMCut_Video'}.mp4`
})

// ---- Specs (duration / estimated size / audio) ----
// Full range means the last frame of content, never the ruler's 5-second pad.
const outputDuration = computed(() => contentDuration.value)

const estimatedSize = computed<string | null>(() => {
  const duration = outputDuration.value
  if (duration <= 0) return null
  // 0.1 bits per pixel-second between a 1 and 40 Mbps floor/ceiling — the same
  // law core's preset ladder hands the encoder, so the guess agrees with it.
  const bitrate = Math.min(40_000_000, Math.max(1_000_000, Math.round(outputW.value * outputH.value * effectiveFps.value * 0.1)))
  const mb = ((bitrate + 192_000) * duration) / 8 / 1_000_000
  return `~${mb >= 100 ? mb.toFixed(0) : mb.toFixed(1)} MB`
})

const hasAudioRows = computed(() => {
  if (!currentProject.value) return false
  return selectFileRows(currentProject.value).audio.length > 0
})

const audioSpecValue = computed(() => (hasAudioRows.value ? t('tmcut.export.audioVideoSpec') : '—'))

// ---- Poster preview ----
// The poster is a frame of the row the file will actually carry, so it comes
// from core's row law — not from `.find(video)`, which would happily pick a row
// the user hid.
const posterUrl = computed(() => {
  const rows = selectFileRows(currentProject.value)
  const tracks = currentProject.value?.timeline?.tracks || []
  const base = rows.base ? tracks[rows.base.trackIndex] : null
  const clip = (base?.items || []).find(item => !!item.src)
  if (!clip?.src) return ''
  const asset = findAssetBySrc(clip.src)
  return asset?.thumbPath ? mediaUrl(asset.thumbPath) : ''
})

// Both surfaces composite every visible footage row in paint order, so a second
// row is a fact worth stating — not a preview-only surprise.
const parallelTracksWarning = computed(() => {
  if (!currentProject.value) return false
  return selectFileRows(currentProject.value).stacked.length > 0
})

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

// ---- Browser export (zero-FFmpeg H3d-3 + slice I) ----
// Both hosts paint and encode the file in this window: `createWebExportHost`
// owns the four ports — plate reader, offline mixer, canvas and the shared
// surface law — so this function only turns one honest result into UI: a file
// to download, or the refusal's own words.
const webAbort = ref<AbortController | null>(null)

function releaseWebResult() {
  if (webResultUrl.value.startsWith('blob:')) URL.revokeObjectURL(webResultUrl.value)
  webResultUrl.value = ''
}

/** One sentence per dialog choice this writer cannot honour. */
const WEB_REFUSAL_KEYS: Record<WebExportRefusalCode, string> = {
  mode: 'tmcut.export.webRefuseMode',
  format: 'tmcut.export.webRefuseFormat',
  range: 'tmcut.export.webRefuseRange',
  effects: 'tmcut.export.webRefuseEffects'
}

/**
 * One sentence per reason core can give. Core owns the vocabulary and the
 * decision; this only answers "what does a person do about `mask`?". A missing
 * entry is not a fallback to the raw code — the spec fails on it.
 */
const WEB_CONTENT_REFUSAL_KEYS: Record<string, string> = {
  'bad-canvas': 'tmcut.export.webRefuseBadCanvas',
  'background-image': 'tmcut.export.webRefuseBackgroundImage',
  'background-transparent': 'tmcut.export.webRefuseBackgroundTransparent',
  'empty': 'tmcut.export.webRefuseEmpty',
  'stacked-rows': 'tmcut.export.webRefuseStackedRows',
  'text': 'tmcut.export.webRefuseText',
  'effects': 'tmcut.export.webRefuseContentEffects',
  'mask': 'tmcut.export.webRefuseMask',
  'blend': 'tmcut.export.webRefuseBlend',
  'transition': 'tmcut.export.webRefuseTransition',
  'reverse': 'tmcut.export.webRefuseReverse',
  'stabilize': 'tmcut.export.webRefuseStabilize',
  'fit-unsupported': 'tmcut.export.webRefuseFit',
  'rotation': 'tmcut.export.webRefuseRotation'
}

function explainContentReasons(reasons: readonly string[]): string[] {
  return reasons.map(reason => t(WEB_CONTENT_REFUSAL_KEYS[reason] ?? 'tmcut.export.webRefuseUnknown', { reason }))
}

async function runWebExport(): Promise<void> {
  isWebRendering.value = true
  webProgress.value = 0
  releaseWebResult()
  const controller = new AbortController()
  webAbort.value = controller
  try {
    const plan = planWebExport((currentProject.value ?? {}) as { canvas?: { width?: number, height?: number, fps?: unknown } }, {
      width: outputW.value,
      height: outputH.value,
      fps: effectiveFps.value,
      mode: mode.value,
      format: videoFormat.value,
      range: null,
      denoise: false,
      lut: null
    })
    if (plan.refusals.length > 0) {
      // Named, not dropped: a control that is quietly ignored is how the user
      // asks for 9:16 and finds 16:9 in the file afterwards.
      throw new Error(plan.refusals.map(code => t(WEB_REFUSAL_KEYS[code])).join(' · '))
    }
    const host = createWebExportHost()
    const result = await host.run({
      project: plan.project as never,
      resolveSrc: src => resolveMediaSrc(src),
      // The browser's own copy first (slice H3d-6): a project whose upload the
      // server no longer has still exports its picture and its sound, because
      // the bytes the preview played are the bytes the file is written from.
      bytesFor: bytesForAsset,
      signal: controller.signal,
      onProgress: (value) => {
        webProgress.value = Math.max(0, Math.min(99, Math.round(value * 100)))
      }
    })

    if (result.kind === 'exported') {
      const output = result.output
      if (!(output instanceof Blob)) throw new Error(t('tmcut.export.webNoFile'))
      webProgress.value = 100
      webResultUrl.value = URL.createObjectURL(output)
      exportDone.value = true
      recordExportCompleted()
      toast.add({ title: t('tmcut.export.success'), color: 'success' })
      return
    }
    if (result.kind === 'canceled') {
      webProgress.value = 0
      return
    }
    // Refusals are the laws' own sentences, never a translation of them: the
    // user is told which project or which runtime this host cannot paint.
    const words = result.kind === 'content-refused'
      ? explainContentReasons(result.reasons)
      : result.kind === 'runtime-refused'
        ? result.errors
        : []
    throw new Error(words.length > 0 ? words.join(' · ') : (result.message ?? t('tmcut.export.errorDesc')))
  } catch (err) {
    exportError.value = err instanceof Error ? err.message : String(err)
    toast.add({ title: t('tmcut.export.failed'), description: exportError.value, color: 'error' })
  } finally {
    webAbort.value = null
    isWebRendering.value = false
    isExporting.value = false
  }
}

// The render had no path to begin with: the encoder hands back a Blob, and the
// browser's download lane is how it reaches disk on either host (Electron shows
// its save dialog for an `<a download>`).
function downloadWebResult(): void {
  if (!webResultUrl.value) return
  const link = document.createElement('a')
  link.href = webResultUrl.value
  link.download = downloadName.value
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function startExport() {
  if (!currentProject.value) return
  isExporting.value = true
  exportDone.value = false
  exportError.value = ''
  webResultUrl.value = ''
  await runWebExport()
}

function cancelExport() {
  webAbort.value?.abort()
  isExporting.value = false
}

function previewResultDirectly() {
  if (!webResultUrl.value) return
  previewModalOpen.value = true
}

onUnmounted(() => {
  webAbort.value?.abort()
  releaseWebResult()
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('tmcut.export.title')"
    :ui="{ content: 'w-[calc(100%-2rem)] max-w-5xl' }"
  >
    <template #content>
      <div class="flex flex-col max-h-[90vh] overflow-hidden rounded-xl bg-muted border border-default shadow-2xl">
        <!-- HEADER: title + file name & destination -->
        <div class="px-5 py-4 bg-muted border-b border-default flex flex-col gap-3 shrink-0">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3 min-w-0">
              <div class="w-7 h-7 rounded bg-primary/15 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-clapperboard" class="size-4 text-primary" />
              </div>
              <div class="flex items-baseline gap-2 min-w-0">
                <h2 class="text-base font-semibold text-highlighted truncate">
                  {{ t('tmcut.export.title') }}
                </h2>
                <span class="px-1.5 py-0.5 rounded bg-accented text-primary text-[10px] font-medium tracking-wide shrink-0">
                  {{ t('tmcut.export.badgeMaster') }}
                </span>
              </div>
            </div>
            <UButton
              icon="i-lucide-x"
              size="xs"
              color="neutral"
              variant="ghost"
              :aria-label="t('common.close')"
              @click="open = false"
            />
          </div>

          <div class="grid grid-cols-12 gap-3">
            <div class="col-span-12 sm:col-span-7 flex items-center gap-2 bg-muted border border-default rounded-lg px-3 py-1.5 focus-within:border-primary/50 transition-colors">
              <span class="text-xs text-muted whitespace-nowrap">{{ t('tmcut.export.fileName') }}:</span>
              <UInput
                id="tmcut-export-file-name"
                v-model="fileName"
                :aria-label="t('tmcut.export.fileName')"
                size="sm"
                class="flex-1 min-w-0"
                :ui="{ base: 'border-0 bg-transparent focus:ring-0' }"
              />
              <span class="font-mono text-[11px] text-muted">.mp4</span>
            </div>
            <!-- Both hosts write through the browser download lane: the encoder
                 hands back a file, not a path, so there is no folder to pick. -->
            <div class="col-span-12 sm:col-span-5 flex items-center gap-2 bg-muted border border-default rounded-lg px-3 py-1.5">
              <UIcon :name="isDesktop ? 'i-lucide-download' : 'i-lucide-server'" class="size-4 text-primary shrink-0" />
              <span class="text-xs text-muted truncate flex-1 min-w-0">
                {{ t('tmcut.export.webDestination') }}
              </span>
            </div>
          </div>

          <!-- Transitions confirmation badge (Roadmap R3) -->
          <div
            v-if="timelineTransitionCount > 0"
            class="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2"
          >
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary shrink-0 mt-0.5" />
            <div class="flex flex-col gap-0.5 min-w-0">
              <span class="text-xs font-medium text-primary">
                {{ t('tmcut.export.transitionsTitle', { n: timelineTransitionCount }) }}
              </span>
              <span class="text-[11px] leading-snug text-toned">
                {{ t('tmcut.export.transitionsDesc') }}
              </span>
            </div>
          </div>
        </div>

        <!-- BODY: left specs / right parameters -->
        <div class="flex-1 min-h-0 overflow-y-auto grid grid-cols-1 lg:grid-cols-12">
          <div class="lg:col-span-5 p-5 flex flex-col gap-4 bg-muted/60 lg:border-r border-default">
            <!-- Poster preview -->
            <div class="relative w-full aspect-video rounded-lg overflow-hidden bg-muted border border-default group">
              <img
                v-if="posterUrl"
                :src="posterUrl"
                alt=""
                class="w-full h-full object-cover"
              >
              <div v-else class="w-full h-full flex flex-col items-center justify-center gap-1.5 text-muted">
                <UIcon name="i-lucide-image" class="size-7" />
                <span class="text-[11px]">{{ t('tmcut.export.posterEmpty') }}</span>
              </div>
              <div class="absolute top-2 left-2 flex items-center gap-1.5">
                <span class="px-1.5 py-0.5 rounded bg-black/70 backdrop-blur font-mono text-[10px] text-primary tracking-wider">
                  {{ outputW }}×{{ outputH }}
                </span>
                <span class="px-1.5 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] text-toned">
                  {{ aspectLabel }}
                </span>
              </div>
              <div class="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur font-mono text-[11px] text-primary">
                {{ formatTimecode(outputDuration) }}
              </div>
            </div>

            <!-- Specs snapshot -->
            <div class="grid grid-cols-2 gap-3 p-3.5 bg-muted rounded-lg border border-default">
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('tmcut.export.specDuration') }}</span>
                <span class="font-mono text-sm text-highlighted font-semibold">{{ formatTimecode(outputDuration) }}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('tmcut.export.specSize') }}</span>
                <span class="text-sm text-primary font-bold">{{ estimatedSize ?? '—' }}</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('tmcut.export.projectResolution') }}</span>
                <span class="font-mono text-[11px] text-toned">{{ canvasW }} × {{ canvasH }} px</span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-[10px] uppercase tracking-wider text-muted">{{ t('tmcut.export.specAudio') }}</span>
                <span class="font-mono text-[11px] text-toned">{{ audioSpecValue }}</span>
              </div>
            </div>

            <!-- The writer's own terms, stated where the choice is made -->
            <div class="mt-auto p-3 rounded-lg bg-muted/70 border border-default flex items-center gap-3">
              <div class="w-8 h-8 rounded bg-primary/15 flex items-center justify-center shrink-0">
                <UIcon name="i-lucide-cpu" class="size-4 text-primary" />
              </div>
              <div class="flex flex-col min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span class="text-xs text-highlighted font-medium truncate">WebCodecs · H.264 / MP4</span>
                </div>
                <span class="text-[10px] text-muted leading-snug">
                  {{ t('tmcut.export.writerNote') }}
                </span>
              </div>
            </div>
          </div>

          <div class="lg:col-span-7 p-5 flex flex-col gap-4 bg-muted/20">
            <!-- Social presets -->
            <div class="flex flex-col gap-1.5">
              <span class="text-xs text-muted font-medium">{{ t('tmcut.export.presetsLabel') }}</span>
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
                      ? 'bg-accented border-primary/40 text-highlighted'
                      : 'bg-muted border-default hover:border-accented text-muted hover:text-toned')
                    : 'bg-muted/50 border-default/50 text-muted cursor-not-allowed'"
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
                <span class="text-xs text-muted font-medium">{{ t('tmcut.export.resLabel') }}</span>
                <span class="font-mono text-[11px] text-primary">{{ t('tmcut.export.resCurrent', { w: outputW, h: outputH }) }}</span>
              </div>
              <div class="grid grid-cols-4 gap-1.5 p-1 bg-muted rounded-lg border border-default">
                <button
                  v-for="s in scaleOptions"
                  :key="s"
                  type="button"
                  class="py-1.5 rounded text-center transition-colors"
                  :class="outScale === s
                    ? 'bg-primary/15 text-primary font-semibold shadow-sm'
                    : 'text-muted hover:text-toned hover:bg-accented/50'"
                  @click="outScale = s"
                >
                  <span class="block text-xs font-semibold">{{ s }}×</span>
                  <span class="block text-[9px] opacity-70 font-mono">{{ scaledSize(s).w }}×{{ scaledSize(s).h }}</span>
                </button>
              </div>
            </div>

            <!-- Frame rate + format -->
            <div class="grid grid-cols-2 gap-3">
              <div class="flex flex-col gap-1.5">
                <span class="text-xs text-muted font-medium">{{ t('tmcut.export.fpsLabel') }}</span>
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
                <span class="text-xs text-muted font-medium">{{ t('tmcut.export.formatLabel') }}</span>
                <div class="h-8 px-2.5 rounded-md bg-muted border border-default flex items-center text-xs text-toned font-mono">
                  {{ t('tmcut.export.formatMp4H264') }}
                </div>
              </div>
            </div>

            <!-- What this writer cannot do, said before the button -->
            <div class="p-3 rounded-lg bg-muted border border-default flex items-start gap-2.5">
              <UIcon name="i-lucide-info" class="size-4 text-primary shrink-0 mt-0.5" />
              <p class="text-[11px] text-muted leading-snug">
                {{ t('tmcut.export.webRenderNote') }}
              </p>
            </div>
          </div>
        </div>

        <!-- Parallel footage rows: the file composites them, so this names a
             fact about the output rather than a preview gap. -->
        <div
          v-if="parallelTracksWarning"
          class="mx-5 mb-2 px-3 py-2 rounded-lg bg-warning-500/10 border border-warning-500/30 flex items-start gap-2 shrink-0"
        >
          <UIcon name="i-lucide-alert-triangle" class="size-3.5 text-warning-400 shrink-0 mt-0.5" />
          <p class="text-[11px] text-warning-200 leading-snug">
            {{ t('tmcut.export.parallelTracksWarning') }}
          </p>
        </div>

        <!-- FOOTER: status/estimate + actions -->
        <div class="px-5 py-3 bg-muted border-t border-default flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div class="flex items-center gap-3 min-w-0 flex-1">
            <template v-if="isExporting">
              <div class="h-1.5 w-32 sm:w-40 bg-accented rounded-full overflow-hidden shrink-0">
                <div
                  v-if="isWebRendering && webProgress === 0"
                  class="h-full w-1/3 bg-primary rounded-full animate-pulse"
                />
                <div
                  v-else
                  class="h-full bg-primary transition-all duration-200"
                  :style="{ width: `${progressPercent}%` }"
                />
              </div>
              <span
                v-if="isWebRendering && webProgress === 0"
                class="text-[11px] text-primary font-medium shrink-0"
              >{{ t('tmcut.export.webRendering') }}</span>
              <span v-else class="font-mono text-xs text-primary font-semibold shrink-0">{{ progressPercent }}%</span>
            </template>

            <template v-else-if="exportDone">
              <span class="flex items-center gap-1.5 text-xs text-emerald-400 min-w-0">
                <UIcon name="i-lucide-check-circle-2" class="size-4 shrink-0" />
                <span class="truncate">{{ t('tmcut.export.completed') }}</span>
              </span>
              <div class="flex items-center gap-1.5 shrink-0">
                <UButton
                  v-if="webResultUrl"
                  icon="i-lucide-play"
                  size="xs"
                  color="primary"
                  variant="soft"
                  :aria-label="t('tmcut.export.previewNow')"
                  :title="t('tmcut.export.previewNow')"
                  @click="previewResultDirectly"
                />
                <UButton
                  icon="i-lucide-download"
                  size="xs"
                  color="primary"
                  variant="soft"
                  :title="t('tmcut.export.download')"
                  @click="downloadWebResult"
                >
                  {{ t('tmcut.export.download') }}
                </UButton>
              </div>
            </template>

            <template v-else-if="exportError">
              <span
                class="text-xs text-error-400 truncate"
                :title="exportError"
              >{{ exportError }}</span>
            </template>

            <template v-else>
              <span class="flex items-center gap-1.5 text-xs text-muted">
                <UIcon name="i-lucide-hard-drive" class="size-3.5 text-primary" />
                {{ t('tmcut.export.labelSize') }}:
                <strong class="font-mono text-highlighted">{{ estimatedSize ?? '—' }}</strong>
              </span>
              <span class="hidden sm:block w-1 h-1 rounded-full bg-accented" />
              <span class="hidden sm:flex items-center gap-1.5 text-xs text-muted">
                <UIcon name="i-lucide-clock" class="size-3.5 text-primary" />
                {{ t('tmcut.export.specDuration') }}:
                <strong class="font-mono text-highlighted">{{ formatTimecode(outputDuration) }}</strong>
              </span>
            </template>
          </div>

          <div class="flex items-center gap-2 shrink-0">
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
              color="error"
              variant="soft"
              size="sm"
              @click="cancelExport"
            >
              {{ t('tmcut.export.cancelExport') }}
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
    :file-path="webResultUrl"
    :title="currentProject?.name"
  />
</template>
