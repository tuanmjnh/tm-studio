<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { collectHtmlTokens, lintHtmlVideo, replaceHtmlTokens } from '@tmcut-core'
import { HTML_VIDEO_STARTERS, buildHtmlVideoPreviewDocument } from '~/utils/tmcut/htmlVideoStarters'
import type { HtmlVideoStarter } from '~/utils/tmcut/htmlVideoStarters'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutInsertAsset } from '~/composables/useTmcutInsertAsset'
import { useTmcutIndustries } from '~/composables/useTmcutIndustries'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { clipDurationSec, clipStartSec } from '~/utils/tmcut/clipTime'
import { parseCaptionCues, serializeCaptionCues, toCaptionCues } from '~/utils/tmcut/captions'

/**
 * HTML/CSS video studio. The composition is authored here, previewed in a
 * sandboxed iframe that is driven frame-first (postMessage → __hf.seek), and
 * rendered by the Nitro server (POST /api/v1/media/html-video) — the same job
 * store the timeline export polls, so progress is the real capture progress and
 * the file is served from /uploads/**.
 *
 * The preview iframe runs with `sandbox="allow-scripts"` (opaque origin): it
 * cannot touch the studio DOM or storage, and the only channel is the bridge
 * appended by buildHtmlVideoPreviewDocument.
 */
const props = defineProps<{ embedded?: boolean }>()
const { t } = useI18n()
const toast = useToast()
const { selectSaveFile, writeText, isElectron } = useFileSystem()
const { insertAsset } = useTmcutInsertAsset()
const { currentProject } = useTmcutProject()
const inserting = ref(false)

const POLL_MS = 500
const POLL_LIMIT = Math.ceil((15 * 60 * 1000) / POLL_MS)
const FALLBACK_DURATION = 5

const starterId = ref<string>('kinetic-title')
const html = ref('')
const width = ref(1080)
const height = ref(1920)
const fps = ref(30)
const variables = ref<Record<string, string>>({})
const allowRemote = ref(false)
const quality = ref(92)
const previewFrame = ref<HTMLIFrameElement | null>(null)
const previewTime = ref(0)
const declaredDuration = ref(0)
const previewError = ref('')
const playing = ref(false)
const previewDoc = ref('')

interface RenderResult {
  url: string
  size: number
  duration: number
  frames: number
}
const rendering = ref(false)
const progress = ref(0)
const outTime = ref(0)
const jobDuration = ref(0)
const result = ref<RenderResult | null>(null)
const renderError = ref('')
let pollAbort = false

const tokens = computed(() => collectHtmlTokens(html.value))
const usesCues = computed(() => tokens.value.includes('cues'))
const captionCueCount = computed(() => parseCaptionCues(variables.value.cues ?? '').length)
const effectiveHtml = computed(() => replaceHtmlTokens(html.value, variables.value))
const lint = computed(() => lintHtmlVideo(effectiveHtml.value))
const lintErrors = computed(() => lint.value.filter(issue => issue.level === 'error'))
const lintWarnings = computed(() => lint.value.filter(issue => issue.level === 'warn'))
const renderDuration = computed(() => declaredDuration.value > 0 ? declaredDuration.value : FALLBACK_DURATION)
const framesEstimate = computed(() => Math.max(1, Math.round(renderDuration.value * fps.value)))
const aspectModel = computed({
  get: () => `${width.value}x${height.value}`,
  set: (value: string) => {
    const [nextWidth, nextHeight] = value.split('x').map(Number)
    if (!nextWidth || !nextHeight) return
    width.value = nextWidth
    height.value = nextHeight
  }
})
const canRender = computed(() => !rendering.value && lintErrors.value.length === 0 && html.value.trim().length > 0)
const progressPercent = computed(() => Math.round(progress.value))

let previewTimer: ReturnType<typeof setTimeout> | undefined
let rafId = 0
let lastFrameAt = 0

// Chips are derived from the starters themselves: catalog order, and only
// industries that a starter actually claims, so the filter can never produce
// an empty grid.
const { industries, industryLabel } = useTmcutIndustries()
const industryFilter = ref<string[]>(['all'])

const industryChips = computed(() => {
  const counts = new Map<string, number>()
  for (const starter of HTML_VIDEO_STARTERS) {
    for (const id of starter.industries) counts.set(id, (counts.get(id) || 0) + 1)
  }
  const chips = [{
    value: 'all',
    label: t('tmcut.htmlVideo.industryAll'),
    count: HTML_VIDEO_STARTERS.length,
    icon: 'i-lucide-shapes'
  }]
  for (const meta of industries) {
    const count = counts.get(meta.id) || 0
    if (!count) continue
    chips.push({ value: meta.id, label: industryLabel(meta.id), count, icon: meta.icon })
  }
  return chips
})

const visibleStarters = computed(() => {
  const selected = industryFilter.value[0]
  if (!selected || selected === 'all') return HTML_VIDEO_STARTERS
  return HTML_VIDEO_STARTERS.filter(starter => starter.industries.includes(selected))
})

function loadStarter(item: HtmlVideoStarter): void {
  starterId.value = item.id
  html.value = item.html
  width.value = item.width
  height.value = item.height
  fps.value = item.fps
  const values: Record<string, string> = {}
  for (const variable of item.variables) values[variable.key] = variable.value
  variables.value = values
  previewTime.value = 0
  declaredDuration.value = 0
  previewError.value = ''
  result.value = null
  renderError.value = ''
}

function rebuildPreview(): void {
  previewDoc.value = buildHtmlVideoPreviewDocument(effectiveHtml.value)
}

watch([html, variables], () => {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(rebuildPreview, 350)
}, { deep: true, immediate: true })

// Any edit invalidates the previous MP4: it was rendered from different HTML.
watch([html, variables, width, height, fps, quality, allowRemote], () => {
  if (result.value && !rendering.value) result.value = null
})

function postSeek(time: number): void {
  const target = Math.max(0, Math.min(renderDuration.value, time))
  previewTime.value = target
  previewFrame.value?.contentWindow?.postMessage({ type: 'hf:seek', time: target }, '*')
}

function handlePreviewMessage(event: MessageEvent): void {
  if (event.source !== previewFrame.value?.contentWindow) return
  const data = event.data as { type?: string, duration?: number, message?: string } | null
  if (!data || typeof data.type !== 'string') return
  if (data.type === 'hf:ready') {
    const duration = Number(data.duration) || 0
    declaredDuration.value = duration
    previewError.value = ''
    postSeek(previewTime.value)
  } else if (data.type === 'hf:error') {
    previewError.value = data.message || t('tmcut.htmlVideo.previewError')
    playing.value = false
  }
}

function togglePlay(): void {
  if (playing.value) {
    playing.value = false
    cancelAnimationFrame(rafId)
    return
  }
  playing.value = true
  lastFrameAt = 0
  rafId = requestAnimationFrame(tick)
}

function tick(now: number): void {
  if (!playing.value) return
  const delta = lastFrameAt ? Math.min(0.25, (now - lastFrameAt) / 1000) : 0
  lastFrameAt = now
  let next = previewTime.value + delta
  if (next >= renderDuration.value) next = 0
  postSeek(next)
  rafId = requestAnimationFrame(tick)
}

function step(frames: number): void {
  playing.value = false
  cancelAnimationFrame(rafId)
  postSeek(previewTime.value + frames / fps.value)
}

function errorMessage(err: unknown): string {
  const detail = err as { data?: { message?: string, statusMessage?: string }, message?: string } | null
  const status = detail?.data?.statusMessage || ''
  if (status === 'error.renderBusy') return t('tmcut.htmlVideo.busy')
  if (status === 'error.htmlVideo.noBrowser') return t('tmcut.htmlVideo.noBrowser')
  return detail?.data?.message || detail?.message || String(err)
}

async function renderVideo(): Promise<void> {
  if (!canRender.value) return
  rendering.value = true
  progress.value = 0
  outTime.value = 0
  result.value = null
  renderError.value = ''
  pollAbort = false
  try {
    const started = await $fetch<{ jobId: string, duration: number, frames: number }>('/api/v1/media/html-video', {
      method: 'POST',
      body: {
        html: html.value,
        width: width.value,
        height: height.value,
        fps: fps.value,
        durationSec: renderDuration.value,
        variables: { ...variables.value },
        allowRemote: allowRemote.value,
        quality: quality.value,
        outputName: `${starterId.value || 'html-video'}.mp4`
      }
    })
    jobDuration.value = started.duration
    for (let attempt = 0; attempt < POLL_LIMIT; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS))
      if (pollAbort) throw new Error(t('tmcut.htmlVideo.cancelled'))
      const job = await $fetch<{
        status: 'running' | 'done' | 'failed'
        progress: number
        outTimeSec: number
        duration: number
        url: string | null
        size: number
        error: string | null
      }>(`/api/v1/media/render/${started.jobId}`)
      if (job.status === 'running') {
        progress.value = Math.max(0, Math.min(99, job.progress || 0))
        outTime.value = job.outTimeSec || 0
        jobDuration.value = job.duration || jobDuration.value
        continue
      }
      if (job.status === 'done' && job.url) {
        progress.value = 100
        result.value = {
          url: job.url,
          size: job.size,
          duration: job.duration || started.duration,
          frames: started.frames
        }
        toast.add({ title: t('tmcut.htmlVideo.renderComplete'), color: 'success' })
        return
      }
      throw new Error(job.error || t('tmcut.htmlVideo.renderFailed'))
    }
    throw new Error(t('tmcut.htmlVideo.renderTimeout'))
  } catch (err) {
    renderError.value = errorMessage(err)
    toast.add({ title: t('tmcut.htmlVideo.renderFailed'), description: renderError.value, color: 'error' })
  } finally {
    rendering.value = false
  }
}

async function saveHtml(): Promise<void> {
  const documentHtml = effectiveHtml.value
  if (isElectron.value) {
    const path = await selectSaveFile({
      title: t('tmcut.htmlVideo.saveCompositionTitle'),
      filters: [{ name: 'HTML Composition', extensions: ['html'] }],
      defaultPath: `${starterId.value || 'composition'}.html`,
      showOverwriteConfirmation: true
    })
    if (!path) return
    await writeText({ filePath: path, data: documentHtml })
    toast.add({ title: t('tmcut.htmlVideo.compositionSaved'), description: path, color: 'success' })
    return
  }
  const blob = new Blob([documentHtml], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${starterId.value || 'composition'}.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  toast.add({ title: t('tmcut.htmlVideo.compositionSaved'), color: 'success' })
}

function downloadResult(): void {
  if (!result.value) return
  const link = document.createElement('a')
  link.href = result.value.url
  link.download = `${starterId.value || 'html-video'}.mp4`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function fillCuesFromTimeline(): void {
  const tracks = currentProject.value?.timeline?.tracks || []
  const sources = tracks
    .filter(track => track.type === 'text')
    .flatMap(track => (track.items || [])
      .filter(item => String(item.text || '').trim())
      .map(item => ({
        text: item.text,
        startSec: clipStartSec(item),
        endSec: clipStartSec(item) + clipDurationSec(item)
      })))
  const cues = toCaptionCues(sources)
  if (!cues.length) {
    toast.add({
      title: t('tmcut.htmlVideo.captionsEmpty'),
      description: t('tmcut.htmlVideo.captionsEmptyHint'),
      color: 'warning'
    })
    return
  }
  variables.value = { ...variables.value, cues: serializeCaptionCues(cues) }
  toast.add({ title: t('tmcut.htmlVideo.captionsFilled', { n: cues.length }), color: 'success' })
}

async function addResultToTimeline(): Promise<void> {
  if (!result.value || inserting.value) return
  inserting.value = true
  try {
    const outcome = await insertAsset(result.value.url).catch(() => {
      throw new Error(t('tmcut.htmlVideo.addFailed'))
    })
    toast.add({
      title: t('tmcut.htmlVideo.added'),
      description: outcome.placed ? t('tmcut.htmlVideo.addedToTimeline') : t('tmcut.htmlVideo.addedToLibrary'),
      color: 'success'
    })
  } catch (error) {
    toast.add({ title: t('tmcut.htmlVideo.addFailed'), description: String((error as Error)?.message || error), color: 'error' })
  } finally {
    inserting.value = false
  }
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, exponent)).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

onMounted(() => {
  loadStarter(HTML_VIDEO_STARTERS[0]!)
  window.addEventListener('message', handlePreviewMessage)
})

onBeforeUnmount(() => {
  clearTimeout(previewTimer)
  playing.value = false
  cancelAnimationFrame(rafId)
  pollAbort = true
  window.removeEventListener('message', handlePreviewMessage)
})
</script>

<template>
  <section class="space-y-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div v-if="!props.embedded">
        <h2 class="text-lg font-semibold text-neutral-900 dark:text-white">
          {{ t('tmcut.htmlVideo.title') }}
        </h2>
        <p class="text-sm text-neutral-500 max-w-2xl">
          {{ t('tmcut.htmlVideo.description') }}
        </p>
      </div>
      <div class="flex items-center gap-2" :class="{ 'ml-auto': props.embedded }">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-save"
          @click="saveHtml"
        >
          {{ t('tmcut.htmlVideo.saveHtml') }}
        </UButton>
        <UButton
          color="primary"
          variant="soft"
          size="sm"
          icon="i-lucide-film"
          :loading="rendering"
          :disabled="!canRender"
          @click="renderVideo"
        >
          {{ t('tmcut.htmlVideo.render') }}
        </UButton>
      </div>
    </header>

    <!-- Starter gallery -->
    <div>
      <p class="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {{ t('tmcut.htmlVideo.startersLabel') }}
      </p>
      <TmcutFilterChips
        v-model="industryFilter"
        :options="industryChips"
        :max-selected="1"
        :label="t('tmcut.htmlVideo.industryFilterLabel')"
        class="mb-3"
      />
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <button
          v-for="item in visibleStarters"
          :key="item.id"
          type="button"
          class="group flex flex-col gap-1 rounded-xl border p-3 text-left transition-colors"
          :class="item.id === starterId
            ? 'border-primary-500 bg-primary-50/70 dark:bg-primary-950/30'
            : 'border-neutral-200 bg-white/70 hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/60 dark:hover:border-neutral-700'"
          :aria-pressed="item.id === starterId"
          :data-starter="item.id"
          @click="loadStarter(item)"
        >
          <span class="flex items-center justify-between gap-1">
            <span class="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{{ item.name }}</span>
            <UIcon v-if="item.id === starterId" name="i-lucide-check-circle-2" class="h-4 w-4 shrink-0 text-primary-500" />
          </span>
          <span class="text-[11px] text-neutral-500">{{ item.aspect }} · {{ item.durationSec }}s · {{ item.fps }}fps</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <!-- Editor -->
      <UCard :ui="{ body: 'space-y-3' }">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <label class="text-sm font-medium text-neutral-900 dark:text-white" for="tmcut-html-video-code">
            {{ t('tmcut.htmlVideo.editorLabel') }}
          </label>
          <span class="font-mono text-xs tabular-nums text-neutral-500">{{ width }}×{{ height }} · {{ fps }} FPS</span>
        </div>
        <textarea
          id="tmcut-html-video-code"
          v-model="html"
          name="tmcut-html-video-code"
          spellcheck="false"
          class="h-[440px] w-full resize-y rounded-lg border border-neutral-200 bg-neutral-950 p-4 font-mono text-xs leading-5 text-emerald-100 outline-none focus:border-primary-500 dark:border-neutral-700"
        />
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label class="space-y-1 text-xs text-neutral-500">
            {{ t('tmcut.htmlVideo.aspect') }}
            <USelect
              v-model="aspectModel"
              :items="[
                { label: '9:16', value: '1080x1920' },
                { label: '16:9', value: '1920x1080' },
                { label: '1:1', value: '1080x1080' },
                { label: '4:5', value: '1080x1350' }
              ]"
              size="sm"
            />
          </label>
          <label class="space-y-1 text-xs text-neutral-500">
            {{ t('tmcut.htmlVideo.fps') }}
            <USelect
              v-model="fps"
              :items="[24, 25, 30, 50, 60].map(value => ({ label: String(value), value }))"
              size="sm"
            />
          </label>
          <label class="space-y-1 text-xs text-neutral-500">
            {{ t('tmcut.htmlVideo.quality') }}
            <UInput
              id="tmcut-html-video-quality"
              v-model.number="quality"
              name="tmcut-html-video-quality"
              type="number"
              min="60"
              max="100"
              step="2"
              size="sm"
            />
          </label>
          <label class="flex items-end gap-2 pb-1 text-xs text-neutral-500">
            <input
              id="tmcut-html-video-allow-remote"
              v-model="allowRemote"
              name="tmcut-html-video-allow-remote"
              type="checkbox"
              class="accent-primary-500"
            >
            <span>{{ t('tmcut.htmlVideo.allowRemote') }}</span>
          </label>
        </div>
        <p class="text-xs text-neutral-500">
          {{ t('tmcut.htmlVideo.durationHint', { duration: renderDuration.toFixed(2), frames: framesEstimate }) }}
        </p>
        <p v-if="allowRemote" class="text-xs text-amber-600 dark:text-amber-400">
          {{ t('tmcut.htmlVideo.allowRemoteHint') }}
        </p>
      </UCard>

      <!-- Preview -->
      <UCard :ui="{ body: 'space-y-3' }">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-neutral-900 dark:text-white">
            {{ t('tmcut.htmlVideo.preview') }}
          </h3>
          <span class="font-mono text-xs tabular-nums text-neutral-500">
            {{ previewTime.toFixed(2) }} / {{ renderDuration.toFixed(2) }}s
          </span>
        </div>
        <div class="flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg bg-neutral-950 p-3">
          <iframe
            ref="previewFrame"
            :srcdoc="previewDoc"
            :title="t('tmcut.htmlVideo.preview')"
            sandbox="allow-scripts"
            class="max-h-[520px] max-w-full border-0 bg-neutral-950"
            :style="{ width: `${Math.min(width, 640)}px`, aspectRatio: `${width} / ${height}` }"
            @load="postSeek(previewTime)"
          />
        </div>
        <label class="block space-y-1 text-xs text-neutral-500">
          {{ t('tmcut.htmlVideo.scrub') }}
          <input
            id="tmcut-html-video-scrub"
            class="w-full accent-primary-500"
            name="tmcut-html-video-scrub"
            type="range"
            min="0"
            :max="renderDuration"
            step="0.01"
            :value="previewTime"
            :aria-label="t('tmcut.htmlVideo.scrub')"
            @input="playing = false; postSeek(Number(($event.target as HTMLInputElement).value))"
          >
        </label>
        <div class="grid grid-cols-4 gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-skip-back"
            :aria-label="t('tmcut.htmlVideo.start')"
            @click="playing = false; postSeek(0)"
          >
            {{ t('tmcut.htmlVideo.start') }}
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-step-back"
            :aria-label="t('tmcut.htmlVideo.previous')"
            @click="step(-1)"
          >
            {{ t('tmcut.htmlVideo.previous') }}
          </UButton>
          <UButton
            size="xs"
            :color="playing ? 'primary' : 'neutral'"
            variant="soft"
            :icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
            :aria-label="playing ? t('tmcut.htmlVideo.pause') : t('tmcut.htmlVideo.play')"
            @click="togglePlay"
          >
            {{ playing ? t('tmcut.htmlVideo.pause') : t('tmcut.htmlVideo.play') }}
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-step-forward"
            :aria-label="t('tmcut.htmlVideo.next')"
            @click="step(1)"
          >
            {{ t('tmcut.htmlVideo.next') }}
          </UButton>
        </div>
        <p class="text-xs text-neutral-500">
          {{ t('tmcut.htmlVideo.previewHint') }}
        </p>
        <p v-if="previewError" class="text-xs text-red-600 dark:text-red-400">
          {{ previewError }}
        </p>
      </UCard>
    </div>

    <!-- Variables + diagnostics -->
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <UCard :ui="{ body: 'space-y-3' }">
        <div>
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-medium text-neutral-900 dark:text-white">
                {{ t('tmcut.htmlVideo.variablesLabel') }}
              </h3>
              <p class="text-xs text-neutral-500">
                {{ t('tmcut.htmlVideo.variablesHint') }}
              </p>
            </div>
            <UButton
              v-if="usesCues"
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-captions"
              :disabled="!currentProject"
              @click="fillCuesFromTimeline"
            >
              {{ t('tmcut.htmlVideo.captionsFromTimeline') }}
            </UButton>
          </div>
          <p v-if="usesCues" class="mt-2 text-xs text-neutral-500">
            {{ currentProject ? t('tmcut.htmlVideo.captionsHint', { n: captionCueCount }) : t('tmcut.htmlVideo.captionsNoProject') }}
          </p>
        </div>
        <p v-if="tokens.length === 0" class="text-sm text-neutral-500">
          {{ t('tmcut.htmlVideo.noVariables') }}
        </p>
        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label v-for="token in tokens" :key="token" class="space-y-1 text-xs text-neutral-500">
            <span class="font-mono">{{ token }}</span>
            <UTextarea
              v-if="token === 'cues'"
              :model-value="variables[token] ?? ''"
              :rows="4"
              size="sm"
              :name="`tmcut-html-var-${token}`"
              @update:model-value="variables[token] = String($event ?? '')"
            />
            <UInput
              v-else
              :model-value="variables[token] ?? ''"
              size="sm"
              :name="`tmcut-html-var-${token}`"
              @update:model-value="variables[token] = String($event ?? '')"
            />
          </label>
        </div>
      </UCard>

      <UCard :ui="{ body: 'space-y-3' }">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-neutral-900 dark:text-white">
            {{ t('tmcut.htmlVideo.checksLabel') }}
          </h3>
          <UBadge :color="lintErrors.length ? 'error' : lintWarnings.length ? 'warning' : 'success'" variant="soft" size="sm">
            {{ lintErrors.length ? t('tmcut.htmlVideo.checksBlocked') : lintWarnings.length ? t('tmcut.htmlVideo.checksWarn') : t('tmcut.htmlVideo.checksOk') }}
          </UBadge>
        </div>
        <ul v-if="lint.length" class="space-y-2">
          <li
            v-for="issue in lint"
            :key="issue.code"
            class="flex gap-2 text-xs"
            :class="issue.level === 'error' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'"
          >
            <UIcon :name="issue.level === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span><span class="font-mono">{{ issue.code }}</span> — {{ issue.message }}</span>
          </li>
        </ul>
        <p v-else class="text-xs text-neutral-500">
          {{ t('tmcut.htmlVideo.checksClean') }}
        </p>
        <p class="text-xs text-neutral-500">
          {{ t('tmcut.htmlVideo.contractHint') }}
        </p>
      </UCard>
    </div>

    <!-- Render job -->
    <UCard v-if="rendering || result || renderError" :ui="{ body: 'space-y-3' }">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-medium text-neutral-900 dark:text-white">
          {{ t('tmcut.htmlVideo.resultTitle') }}
        </h3>
        <span v-if="rendering" class="font-mono text-xs tabular-nums text-neutral-500">
          {{ progressPercent }}% · {{ outTime.toFixed(2) }} / {{ jobDuration.toFixed(2) }}s
        </span>
      </div>
      <UProgress v-if="rendering" :model-value="progressPercent" size="sm" />
      <p v-if="rendering" class="text-xs text-neutral-500">
        {{ t('tmcut.htmlVideo.renderProgress', { frames: framesEstimate }) }}
      </p>
      <p v-if="renderError" class="text-sm text-red-600 dark:text-red-400">
        {{ renderError }}
      </p>
      <template v-if="result">
        <video
          :src="result.url"
          class="max-h-[420px] w-full rounded-lg bg-black"
          controls
          playsinline
        />
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-500">
          <span class="font-mono tabular-nums">{{ result.duration.toFixed(2) }}s · {{ result.frames }} {{ t('tmcut.htmlVideo.frames') }} · {{ formatBytes(result.size) }}</span>
          <div class="flex items-center gap-2">
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-external-link"
              :href="result.url"
              external
              target="_blank"
              rel="noopener"
            >
              {{ t('tmcut.htmlVideo.openResult') }}
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              icon="i-lucide-list-plus"
              :loading="inserting"
              @click="addResultToTimeline"
            >
              {{ t('tmcut.htmlVideo.addToTimeline') }}
            </UButton>
            <UButton
              size="xs"
              color="primary"
              variant="soft"
              icon="i-lucide-download"
              @click="downloadResult"
            >
              {{ t('tmcut.htmlVideo.download') }}
            </UButton>
          </div>
        </div>
      </template>
    </UCard>
  </section>
</template>
