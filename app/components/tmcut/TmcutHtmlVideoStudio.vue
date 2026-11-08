<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { collectHtmlTokens, createClock, createFramePace, fpsToRational, lintHtmlVideo, replaceHtmlTokens, secToTicks, selectFileRows, ticksToSec } from 'tmcut-core'
import { HTML_VIDEO_STARTERS, buildHtmlVideoPreviewDocument } from '~/utils/tmcut/htmlVideoStarters'
import type { HtmlVideoStarter } from '~/utils/tmcut/htmlVideoStarters'
import { useFileSystem } from '~/composables/useFileSystem'
import { useTmcutIndustries } from '~/composables/useTmcutIndustries'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { clipDurationSec, clipStartSec } from '~/utils/tmcut/clipTime'
import { parseCaptionCues, serializeCaptionCues, toCaptionCues } from '~/utils/tmcut/captions'

/**
 * HTML/CSS video studio. The composition is authored here and previewed in a
 * sandboxed iframe that is driven frame-first (postMessage → __hf.seek).
 *
 * Zero-FFmpeg slice I retired the server-side MP4 render (POST
 * /api/v1/media/html-video spawned ffmpeg over headless-Chrome frames), so this
 * surface authors, previews and saves the composition; turning it into an MP4
 * needs a WebCodecs capture leg that does not exist yet (see
 * docs/audit/zero-ffmpeg-audit.md, section 10 item 3).
 *
 * The preview iframe runs with `sandbox="allow-scripts"` (opaque origin): it
 * cannot touch the studio DOM or storage, and the only channel is the bridge
 * appended by buildHtmlVideoPreviewDocument.
 */
const props = defineProps<{ embedded?: boolean }>()
const { t } = useI18n()
const toast = useToast()
const { selectSaveFile, writeText, isElectron } = useFileSystem()
const { currentProject } = useTmcutProject()

const FALLBACK_DURATION = 5

const starterId = ref<string>('kinetic-title')
const html = ref('')
const width = ref(1080)
const height = ref(1920)
const fps = ref(30)
const variables = ref<Record<string, string>>({})
const previewFrame = ref<HTMLIFrameElement | null>(null)
const previewTime = ref(0)
const declaredDuration = ref(0)
const previewError = ref('')
const playing = ref(false)
const previewDoc = ref('')

const tokens = computed(() => collectHtmlTokens(html.value))
const usesCues = computed(() => tokens.value.includes('cues'))
const captionCueCount = computed(() => parseCaptionCues(variables.value.cues ?? '').length)
const effectiveHtml = computed(() => replaceHtmlTokens(html.value, variables.value))
const lint = computed(() => lintHtmlVideo(effectiveHtml.value))
const lintErrors = computed(() => lint.value.filter(issue => issue.level === 'error'))
const lintWarnings = computed(() => lint.value.filter(issue => issue.level === 'warn'))
const renderDuration = computed(() => declaredDuration.value > 0 ? declaredDuration.value : FALLBACK_DURATION)
const aspectModel = computed({
  get: () => `${width.value}x${height.value}`,
  set: (value: string) => {
    const [nextWidth, nextHeight] = value.split('x').map(Number)
    if (!nextWidth || !nextHeight) return
    width.value = nextWidth
    height.value = nextHeight
  }
})

let previewTimer: ReturnType<typeof setTimeout> | undefined
let rafId = 0

// The preview's grid and pace come from core, exactly like the editor transport
// (Zero-FFmpeg slice F6b). The capture job paints frame `i` at `i / fps`, so a
// preview that integrates its own wall-clock intervals is asking the composition
// for times the file never contains; pacing on the clock's grid makes the two
// walks identical.
const previewClock = computed(() => createClock(fpsToRational(fps.value)))
const previewPace = computed(() => createFramePace(previewClock.value))
const lastPreviewFrame = computed(() => Math.max(
  0,
  previewClock.value.durationFrames(secToTicks(renderDuration.value)) - 1
))

function currentPreviewFrame(): number {
  return previewClock.value.frameIndexAt(secToTicks(previewTime.value))
}

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
}

function rebuildPreview(): void {
  previewDoc.value = buildHtmlVideoPreviewDocument(effectiveHtml.value)
}

watch([html, variables], () => {
  clearTimeout(previewTimer)
  previewTimer = setTimeout(rebuildPreview, 350)
}, { deep: true, immediate: true })

function postSeek(time: number): void {
  const target = Math.max(0, Math.min(renderDuration.value, time))
  previewTime.value = target
  previewFrame.value?.contentWindow?.postMessage({ type: 'hf:seek', time: target }, '*')
}

/**
 * Put the playhead on a frame the file can be painted at, and re-arm the pace:
 * a seek the pace did not produce invalidates the interval it was carrying.
 */
function seekFrame(frame: number): void {
  previewPace.value.reset()
  showFrame(Math.min(lastPreviewFrame.value, Math.max(0, frame)))
}

/** The one position the pace is allowed to deliver: a frame start. */
function showFrame(frame: number): void {
  postSeek(ticksToSec(previewClock.value.frameStartAt(frame)))
}

function handlePreviewMessage(event: MessageEvent): void {
  if (event.source !== previewFrame.value?.contentWindow) return
  const data = event.data as { type?: string, duration?: number, message?: string } | null
  if (!data || typeof data.type !== 'string') return
  if (data.type === 'hf:ready') {
    const duration = Number(data.duration) || 0
    declaredDuration.value = duration
    previewError.value = ''
    // A fresh document restarted the composition at its own frame 0.
    seekFrame(currentPreviewFrame())
  } else if (data.type === 'hf:error') {
    previewError.value = data.message || t('tmcut.htmlVideo.previewError')
    playing.value = false
  }
}

function togglePlay(): void {
  if (playing.value) {
    playing.value = false
    cancelAnimationFrame(rafId)
    previewPace.value.reset()
    return
  }
  playing.value = true
  previewPace.value.reset()
  rafId = requestAnimationFrame(tick)
}

function tick(now: number): void {
  if (!playing.value) return
  const last = lastPreviewFrame.value
  const frame = previewPace.value.at(now, 1, currentPreviewFrame()).frame
  if (frame > last) {
    // Wrapping back to the first frame starts a new segment; the interval that
    // carried the playhead past the end is spent, not replayed.
    previewPace.value.reset()
    showFrame(0)
  } else {
    showFrame(frame)
  }
  rafId = requestAnimationFrame(tick)
}

function step(frames: number): void {
  playing.value = false
  cancelAnimationFrame(rafId)
  seekFrame(currentPreviewFrame() + frames)
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

function fillCuesFromTimeline(): void {
  const tracks = currentProject.value?.timeline?.tracks || []
  // The caption rows of the composition are core's, not a type filter: the same
  // lanes the file overlays, so a hidden or empty text row never becomes a cue.
  const textTracks = selectFileRows(currentProject.value).overlays
    .map(row => tracks[row.trackIndex])
    .filter((track): track is NonNullable<typeof track> => !!track)
  const sources = textTracks
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

onMounted(() => {
  loadStarter(HTML_VIDEO_STARTERS[0]!)
  window.addEventListener('message', handlePreviewMessage)
})

onBeforeUnmount(() => {
  clearTimeout(previewTimer)
  playing.value = false
  cancelAnimationFrame(rafId)
  window.removeEventListener('message', handlePreviewMessage)
})
</script>

<template>
  <section class="space-y-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div v-if="!props.embedded">
        <h2 class="text-lg font-semibold text-highlighted dark:text-white">
          {{ t('tmcut.htmlVideo.title') }}
        </h2>
        <p class="text-sm text-muted max-w-2xl">
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
      </div>
    </header>

    <!-- Starter gallery -->
    <div>
      <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
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
            : 'border-default bg-white/70 hover:border-default dark:bg-default/60 dark:hover:border-accented'"
          :aria-pressed="item.id === starterId"
          :data-starter="item.id"
          @click="loadStarter(item)"
        >
          <span class="flex items-center justify-between gap-1">
            <span class="truncate text-sm font-medium text-highlighted">{{ item.name }}</span>
            <UIcon v-if="item.id === starterId" name="i-lucide-check-circle-2" class="h-4 w-4 shrink-0 text-primary-500" />
          </span>
          <span class="text-[11px] text-muted">{{ item.aspect }} · {{ item.durationSec }}s · {{ item.fps }}fps</span>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
      <!-- Editor -->
      <UCard :ui="{ body: 'space-y-3' }">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <label class="text-sm font-medium text-highlighted dark:text-white" for="tmcut-html-video-code">
            {{ t('tmcut.htmlVideo.editorLabel') }}
          </label>
          <span class="font-mono text-xs tabular-nums text-muted">{{ width }}×{{ height }} · {{ fps }} FPS</span>
        </div>
        <textarea
          id="tmcut-html-video-code"
          v-model="html"
          name="tmcut-html-video-code"
          spellcheck="false"
          class="h-[440px] w-full resize-y rounded-lg border border-default bg-neutral-950 p-4 font-mono text-xs leading-5 text-emerald-100 outline-none focus:border-primary-500 dark:border-accented"
        />
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label class="space-y-1 text-xs text-muted">
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
          <label class="space-y-1 text-xs text-muted">
            {{ t('tmcut.htmlVideo.fps') }}
            <USelect
              v-model="fps"
              :items="[24, 25, 30, 50, 60].map(value => ({ label: String(value), value }))"
              size="sm"
            />
          </label>
        </div>
        <p class="text-xs text-muted">
          {{ t('tmcut.htmlVideo.durationHint', { duration: renderDuration.toFixed(2) }) }}
        </p>
      </UCard>

      <!-- Preview -->
      <UCard :ui="{ body: 'space-y-3' }">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-medium text-highlighted dark:text-white">
            {{ t('tmcut.htmlVideo.preview') }}
          </h3>
          <span class="font-mono text-xs tabular-nums text-muted">
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
            @load="seekFrame(currentPreviewFrame())"
          />
        </div>
        <label class="block space-y-1 text-xs text-muted">
          {{ t('tmcut.htmlVideo.scrub') }}
          <input
            id="tmcut-html-video-scrub"
            class="w-full accent-primary-500"
            name="tmcut-html-video-scrub"
            type="range"
            min="0"
            :max="lastPreviewFrame"
            step="1"
            :value="currentPreviewFrame()"
            :aria-label="t('tmcut.htmlVideo.scrub')"
            @input="playing = false; seekFrame(Number(($event.target as HTMLInputElement).value))"
          >
        </label>
        <div class="grid grid-cols-4 gap-2">
          <UButton
            size="xs"
            color="neutral"
            variant="soft"
            icon="i-lucide-skip-back"
            :aria-label="t('tmcut.htmlVideo.start')"
            @click="playing = false; seekFrame(0)"
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
        <p class="text-xs text-muted">
          {{ t('tmcut.htmlVideo.previewHint') }}
        </p>
        <p v-if="previewError" class="text-xs text-error">
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
              <h3 class="text-sm font-medium text-highlighted dark:text-white">
                {{ t('tmcut.htmlVideo.variablesLabel') }}
              </h3>
              <p class="text-xs text-muted">
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
          <p v-if="usesCues" class="mt-2 text-xs text-muted">
            {{ currentProject ? t('tmcut.htmlVideo.captionsHint', { n: captionCueCount }) : t('tmcut.htmlVideo.captionsNoProject') }}
          </p>
        </div>
        <p v-if="tokens.length === 0" class="text-sm text-muted">
          {{ t('tmcut.htmlVideo.noVariables') }}
        </p>
        <div v-else class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label v-for="token in tokens" :key="token" class="space-y-1 text-xs text-muted">
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
          <h3 class="text-sm font-medium text-highlighted dark:text-white">
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
            :class="issue.level === 'error' ? 'text-error' : 'text-warning'"
          >
            <UIcon :name="issue.level === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'" class="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span><span class="font-mono">{{ issue.code }}</span> — {{ issue.message }}</span>
          </li>
        </ul>
        <p v-else class="text-xs text-muted">
          {{ t('tmcut.htmlVideo.checksClean') }}
        </p>
        <p class="text-xs text-muted">
          {{ t('tmcut.htmlVideo.contractHint') }}
        </p>
      </UCard>
    </div>
  </section>
</template>
