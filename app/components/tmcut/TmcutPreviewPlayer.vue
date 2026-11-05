<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutProject } from '~/composables/useTmcutProject'
import type { TmcutTrack, TmcutTimelineItem } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import type { PaintSurface, TextSurface } from '~/composables/useTmcutPlayback'
import { computeFitObjectStyle, CROP_RATIO_PRESETS, clampCropRect, applyCropRatio, canvasFpsValue } from '~/utils/tmcut/canvas'
import { effectCssParts, layerOverlayPlates } from '~/utils/tmcut/fxPreview'
import { previewScale, evalKeyframe, gainAt, safeAreaRects, SAFE_AREA_PRESETS, secToTicks, maskCssMaskImage, previewTransitionRamp, classifyAssetKind, DEFAULT_TEXT_COLOR, DEFAULT_TEXT_FONT_SIZE, textBoxPadding, textShadowOffset, textStrokeWidth } from 'tmcut-core'
import type { CoreEvaluatedLayer, CoreEvaluatedLayout } from 'tmcut-core'
import { clipDurationTicks, clipStartSec, clipEndSec, clipMediaTimeSec } from '~/utils/tmcut/clipTime'
import { assetStateView, isMediaOffline } from '~/utils/tmcut/assetImport'
import { useTmcutFrames } from '~/composables/useTmcutFrames'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutRelink } from '~/composables/useTmcutRelink'

const { t } = useI18n()
const toast = useToast()
const { available: canExtractFrames, extractFrame } = useTmcutFrames()
const { proxyPreview, findAssetBySrc } = useTmcutMedia()
const { relinkWithPicker } = useTmcutRelink()
// Phase 5 (R90): runtime media decisions live behind one engine seam —
// every playable URL and every desktop-only capability question goes
// through it now (the preview never touches FFmpeg on either runtime).
const previewEngine = useTmcutPreviewEngine()
const { currentProject, contentDuration, hasTimelineClips, selectedClipId, selectClip, updateClip, pushHistory, isCropEditing, toggleCropEditing } = useTmcutProject()
const {
  playhead,
  renderSeconds,
  isPlaying,
  videoRef,
  outgoingVideoRef,
  mainSurface,
  crossfadeSurface,
  stackedSurfaces,
  setStackedVideoEl,
  activeVideoClip,
  transitionCrossfade,
  activeTextSurfaces,
  formatTimecode,
  seek,
  pause,
  togglePlayPause,
  stepForward,
  stepBackward,
  stepFrame,
  shuttleForward,
  shuttleBackward,
  shuttleStop,
  renderIn,
  renderOut,
  setRenderMark,
  loopPlayback,
  previewVolume,
  previewMuted
} = useTmcutPlayback()

const internalVideoRef = ref<HTMLVideoElement | null>(null)
// OUTGOING crossfade layer (roadmap B3): second <video> registered into
// the playback composable, synced by its rAF loop while a transition
// window is active.
const internalOutgoingRef = ref<HTMLVideoElement | null>(null)

// Safe area / guides overlays (session-level editor settings)
const showSafeArea = ref(false)
const showGuides = ref(false)
const showGrid = ref(false)
const showCenter = ref(false)

const overlayToggles = computed(() => [
  { key: 'safe', label: t('tmcut.safeArea.safe'), icon: 'i-lucide-frame', active: showSafeArea.value, onSelect: () => (showSafeArea.value = !showSafeArea.value) },
  { key: 'guides', label: t('tmcut.safeArea.guides'), icon: 'i-lucide-layout-grid', active: showGuides.value, onSelect: () => (showGuides.value = !showGuides.value) },
  { key: 'grid', label: t('tmcut.safeArea.grid'), icon: 'i-lucide-grid-3x3', active: showGrid.value, onSelect: () => (showGrid.value = !showGrid.value) },
  { key: 'center', label: t('tmcut.safeArea.center'), icon: 'i-lucide-crosshair', active: showCenter.value, onSelect: () => (showCenter.value = !showCenter.value) }
])

function pct(fraction: number) {
  return `${Number((fraction * 100).toFixed(4))}%`
}

// Preview quality (mock #2): scales the monitor box (1 / 0.5 / 0.25 /
// 0.33). Default 'full' keeps the historical fill-the-panel fit — the
// selector is a deliberate step-DOWN tool for heavy timelines, matching
// the mock's performance intent. The source always decodes at full
// resolution (no re-encoding) — honest preview sizing, export untouched.
const previewQuality = ref<'full' | 'half' | 'quarter' | 'proxy'>('full')
const qualityFactor = computed(() => {
  switch (previewQuality.value) {
    case 'half': return 0.5
    case 'quarter': return 0.25
    case 'proxy': return 0.33
    default: return 1
  }
})

// Frame field of every transport readout follows the canvas rate; the old
// hardcoded 30s counted 0-29 on a 60fps project.
const previewFps = computed(() => canvasFpsValue(currentProject.value?.canvas) || 30)

const qualityItems = computed(() => [
  { label: t('tmcut.player.qualityFull'), value: 'full' },
  { label: t('tmcut.player.qualityHalf'), value: 'half' },
  { label: t('tmcut.player.qualityQuarter'), value: 'quarter' },
  { label: t('tmcut.player.qualityProxy'), value: 'proxy' }
])

function onQualityChange(value: unknown) {
  if (value === 'full' || value === 'half' || value === 'quarter' || value === 'proxy') {
    previewQuality.value = value
  }
}

// USlider reports number | number[]; the monitor is single-thumb, but the
// union still has to be narrowed before it reaches the gain ref.
function onVolumeChange(value: number | number[] | undefined) {
  previewVolume.value = Array.isArray(value) ? (value[0] ?? 0) : (value ?? 0)
}

// Safe-area rects (roadmap C13 / core canvas.mjs): action safe 0.90 and
// title safe 0.80 as centered fractions — replaces the hardcoded
// 2.5%/5% insets with the broadcast standard.
const safeArea = computed(() => safeAreaRects(currentProject.value?.canvas))

// Ratio frame guides (roadmap C13): pick a target ratio to draw its
// centered box inside the canvas — a composition aid, not a crop.
const ratioGuideId = ref<string | null>(null)

const ratioGuideItems = computed(() => [
  { label: t('tmcut.safeArea.none'), icon: 'i-lucide-x', onSelect: () => (ratioGuideId.value = null) },
  ...SAFE_AREA_PRESETS.map(preset => ({
    label: preset.label,
    icon: preset.id === ratioGuideId.value ? 'i-lucide-check' : undefined,
    onSelect: () => (ratioGuideId.value = preset.id)
  }))
])

// HUD snapshot (roadmap G-1, core C14 plans the timestamp): grab the
// active clip's frame at the current media time through the Electron
// extractor and report the cached PNG path. Hidden on web sessions —
// there is no IPC there, so the button would be dead.
const snapshotBusy = ref(false)

async function snapshotFrame() {
  const active = activeVideoClip.value
  if (!active || snapshotBusy.value) return
  snapshotBusy.value = true
  try {
    const path = await extractFrame(active.clip.src ?? '', active.mediaCurrentTime, 1280)
    if (path) {
      toast.add({ title: t('tmcut.player.snapshotSaved'), description: path, color: 'success' })
    } else {
      toast.add({ title: t('tmcut.player.snapshotFailed'), color: 'warning' })
    }
  } finally {
    snapshotBusy.value = false
  }
}

const ratioGuideStyle = computed(() => {
  const preset = SAFE_AREA_PRESETS.find(candidate => candidate.id === ratioGuideId.value)
  const canvas = currentProject.value?.canvas
  if (!preset || !canvas?.width || !canvas?.height) return null
  const canvasRatio = canvas.width / canvas.height
  const w = canvasRatio >= preset.ratio ? preset.ratio / canvasRatio : 1
  const h = canvasRatio >= preset.ratio ? 1 : canvasRatio / preset.ratio
  return { left: pct((1 - w) / 2), top: pct((1 - h) / 2), width: pct(w), height: pct(h) }
})

// HUD aspect label: reduce canvas WxH to the simplest ratio (1920x1080 →
// 16:9). Odd sizes that do not reduce below 64 stay as raw W:H numbers.
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

const aspectLabel = computed(() => {
  const canvas = currentProject.value?.canvas
  if (!canvas?.width || !canvas?.height) return ''
  const g = gcd(canvas.width, canvas.height)
  const w = Math.round(canvas.width / g)
  const h = Math.round(canvas.height / g)
  return w <= 64 && h <= 64 ? `${w}:${h}` : `${canvas.width}:${canvas.height}`
})

// Mini scrub bar (R154): click or drag the track itself to seek. The hit strip
// is the track only — it used to be the whole row, so clicking a time label
// seeked to a wrong ratio. The bar spans the content, not the padded ruler, so
// the full width always maps to real media.
const scrubTrackRef = ref<HTMLDivElement | null>(null)
const scrubProgress = computed(() => (
  contentDuration.value > 0
    ? Math.min(100, (playhead.value / contentDuration.value) * 100)
    : 0
))

function seekFromScrub(clientX: number) {
  const el = scrubTrackRef.value
  if (!el || !hasTimelineClips.value) return
  const rect = el.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  seek(ratio * contentDuration.value)
}

// Pointer events (not mouse) so a drag keeps tracking outside the element and
// touch/pen work too; pointer capture is released automatically on pointerup.
function onScrubPointerDown(e: PointerEvent) {
  if (!hasTimelineClips.value) return
  ; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  seekFromScrub(e.clientX)
}
function onScrubPointerMove(e: PointerEvent) {
  if (e.buttons !== 1) return
  seekFromScrub(e.clientX)
}

// Expose video element to playback composable
watch(internalVideoRef, (el) => {
  videoRef.value = el
})

// Expose the OUTGOING crossfade layer to the playback composable
watch(internalOutgoingRef, (el) => {
  outgoingVideoRef.value = el
})

// Monitor box: explicit pixel dimensions preserving the canvas ratio
// (CapCut-style fixed frame). Pure CSS `aspect-ratio` breaks whenever the
// width-implied height exceeds `max-height` clamping, so the frame is
// measured instead: fit canvas WxH into the available column width and
// ~40% viewport height, whichever binds first. 16:9 renders wide, 9:16
// renders tall, 1:1 renders square — always exact.
const viewportRef = ref<HTMLElement | null>(null)
// The stage (video area) is the ONLY box that may grow or shrink: the HUD
// header is pinned above it and the transport deck below it, so the frame
// is fitted into the stage's own measured box — never into `window.innerHeight`.
// A window/panel resize therefore only ever scales the video.
const stageRef = ref<HTMLElement | null>(null)
const viewportWidth = ref(0)
const viewportHeight = ref(0)

function measureViewport() {
  const el = stageRef.value
  if (!el) return
  viewportWidth.value = el.clientWidth
  viewportHeight.value = el.clientHeight
}

// Canvas zoom (roadmap F-2 / design #2 "100% Fit"): 'fit' keeps the
// auto-fit frame pixel-identical to the old layout; a percent renders
// the canvas at that scale and the monitor stage scrolls inside a fixed
// 40vh box so the HUD header and transport deck stay pinned. The step
// list doubles as the ± control (a dropdown keeps the HUD lean).
const canvasZoom = ref<'fit' | number>('fit')
const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2]

const canvasZoomItems = computed(() => [
  {
    label: t('tmcut.player.zoomFit'),
    icon: canvasZoom.value === 'fit' ? 'i-lucide-check' : undefined,
    onSelect: () => (canvasZoom.value = 'fit')
  },
  ...ZOOM_STEPS.map(step => ({
    label: `${Math.round(step * 100)}%`,
    icon: canvasZoom.value === step ? 'i-lucide-check' : undefined,
    onSelect: () => (canvasZoom.value = step)
  }))
])

// Stage budget: the measured height of the video-area box itself
// (`viewportHeight` is set by measureViewport from stageRef). The 288px
// fallback is only used before the first measurement (SSR / first paint);
// it matches the historical 36vh budget so nothing jumps on mount.
const monitorStageHeight = computed(() =>
  Math.max(160, viewportHeight.value || 288)
)

const monitorBoxStyle = computed(() => {
  const canvas = currentProject.value?.canvas
  const w = canvas?.width || 1920
  const h = canvas?.height || 1080
  const availW = Math.max(200, viewportWidth.value || 640)
  const availH = monitorStageHeight.value
  const baseScale = canvasZoom.value === 'fit'
    ? Math.max(0.05, Math.min(availW / w, availH / h))
    : Math.max(0.05, canvasZoom.value)
  // Quality selector (mock #2) scales the monitor box; no re-encoding —
  // the video still decodes at full resolution, we only scale the CSS box.
  const scale = baseScale * qualityFactor.value
  // Canvas background (roadmap Phase 4): color paints the box, an image
  // covers it (core exports the same way: bg under the clips); the web
  // blob object-URL passes through the engine resolver untouched.
  const bg = canvas?.background
  const bgStyle: Record<string, string> = {}
  if (bg?.type === 'color') bgStyle.backgroundColor = bg.value || '#000000'
  else if (bg?.type === 'image' && bg.value) {
    bgStyle.backgroundImage = `url("${previewEngine.resolveSrc(bg.value)}")`
    bgStyle.backgroundSize = 'cover'
    bgStyle.backgroundPosition = 'center'
  }
  return {
    width: `${Math.floor(w * scale)}px`,
    height: `${Math.floor(h * scale)}px`,
    ...bgStyle
  }
})

// Current media URL for active video clip (with proxy preview and video stabilizer support, roadmap F-4/E-5).
// When proxy preview is enabled and an asset proxy exists, resolveMediaSrc
// serves the lightweight 540p proxy. When video stabilization is enabled, the
// footage is loaded seamlessly. (Engine seam: resolveSrc is proxy-aware on
// the electron engine; the web engine has neither pipeline, so those clip
// fields never exist there — roadmap Phase 5, R90.)
//
// Slice F2b put the URL question in one function of a CLIP, because the
// monitor now points as many elements at as many clips as core stacks: three
// copies of the stabilize/proxy ladder (main, crossfade, stacked) was a drift
// waiting to happen.
function playableSrc(clip: TmcutTimelineItem | null | undefined): string {
  if (!clip) return ''
  if (clip.stabilize && clip.stabilizedPath) {
    return previewEngine.resolveSrc(clip.stabilizedPath)
  }
  const src = clip.src
  if (!src) return ''
  return previewEngine.resolveSrc(src)
}

const currentMediaSrc = computed(() => playableSrc(activeVideoClip.value?.clip))

// Media URL for the OUTGOING crossfade layer (roadmap B3).
const outgoingMediaSrc = computed(() => playableSrc(crossfadeSurface.value?.clip))

// Whether the active clip currently renders via proxy
const isCurrentClipProxy = computed(() => {
  if (!proxyPreview.value) return false
  const src = activeVideoClip.value?.clip?.src
  if (!src) return false
  const asset = findAssetBySrc(src)
  return !!(asset?.proxyPath && asset.proxyStatus === 'ready')
})

// Whether the active clip currently renders via stabilized footage (roadmap E-5)
const isCurrentClipStabilized = computed(() => {
  const clip = activeVideoClip.value?.clip
  return !!(clip?.stabilize && clip?.stabilizedPath)
})

// Still-image clips (png/jpg/svg/…) cannot decode in the <video> element — pointing
// a video at an image renders an empty black frame. They get their own <img>
// layer with the same fit/transform so the canvas shows the actual picture.
// The asset library is authoritative when the clip src matches one; the file
// extension is the fallback for clips whose asset entry moved or was replaced.
// The fallback asks tmcut-core — the SAME question `toRenderClip` asks for the
// export. It used to ask the app's legacy `isImageFile` list, which was a
// second opinion carrying extensions core never heard of (`ico`, `img`,
// `jfif`, `svg`); a clip named by one of those was painted here while the
// compiler treated it as ordinary footage, and unlooped footage decodes to
// one frame.
const isCurrentClipImage = computed(() => isImageClip(activeVideoClip.value?.clip))

// The same question for any surface, so a stacked row picks its element on the
// law the export uses, not on a rule the main element happens to have.
function isImageClip(clip: TmcutTimelineItem | null | undefined): boolean {
  const src = clip?.src
  if (!src) return false
  const asset = findAssetBySrc(src)
  if (asset) return asset.kind === 'image'
  return classifyAssetKind(src) === 'image'
}

// Seek the outgoing layer to its frame once its metadata lands (the rAF
// loop self-corrects afterwards, but the first paint should be right).
function onOutgoingLoadedMetadata() {
  const el = internalOutgoingRef.value
  const cf = transitionCrossfade.value
  if (el && cf) {
    try {
      el.currentTime = cf.outgoingMediaTime
    } catch {
      // ignore seeks on unloaded metadata
    }
  }
}

// Sync video position to the clip in-point once metadata is loaded
function onLoadedMetadata() {
  const el = internalVideoRef.value
  if (el && activeVideoClip.value) {
    el.currentTime = activeVideoClip.value.mediaCurrentTime
  }
}

// Load-error overlay (missing file / unsupported codec)
const mediaLoadError = ref(false)

// Playback buffering: a stalled decode used to look like a frozen frame with
// no feedback (the playhead keeps running on its own clock). The video
// element's own events are the only honest source for this state.
const isBuffering = ref(false)
function onVideoWaiting() {
  if (isPlaying.value && activeVideoClip.value) isBuffering.value = true
}
function onVideoPlaying() {
  isBuffering.value = false
}

watch(currentMediaSrc, () => {
  mediaLoadError.value = false
  isBuffering.value = false
})
function onMediaError(source: 'video' | 'image' = 'video') {
  // Ignore when there is no media to load (initial state or clip just
  // removed): the empty placeholder owns that state, not the error overlay.
  if (!currentMediaSrc.value) return
  // An image clip never decodes in <video> — its still src always fires an
  // error event there, so only the <img> layer is allowed to report failure.
  if (source === 'video' && isCurrentClipImage.value) return
  // Symmetric case: a video src can never decode in <img>, so the still layer
  // must not report that guaranteed failure either.
  if (source === 'image' && !isCurrentClipImage.value) return
  const el = internalVideoRef.value
  // Ignore stale failures: async error events from a previous src can arrive
  // after the playhead already moved on to another clip.
  if (source === 'video' && el && el.currentSrc && el.currentSrc !== currentMediaSrc.value) return
  mediaLoadError.value = true
}

// "Media Offline" (roadmap Q6(a), slice C2): the library already knows a clip's
// bytes are not on this machine, so the canvas says so up front instead of
// waiting for a decode to fail and showing one black frame. The plate is a
// statement, never a dialog — relinking only happens when the user presses the
// button — and it leaves the asset reference, the trims and the effects alone.
const currentAsset = computed(() => {
  const src = activeVideoClip.value?.clip?.src
  if (!src) return null
  return findAssetBySrc(src) ?? null
})

const mediaOffline = computed(() => {
  const clip = activeVideoClip.value?.clip
  if (!clip || !clip.src) return false
  return !currentAsset.value || isMediaOffline(currentAsset.value)
})

// Without an asset record there is nothing to relink (no id), so the plate is
// text-only; the view still comes from the shared table, not a local guess.
const offlineView = computed(() => assetStateView(currentAsset.value ?? { status: 'missing' }))

// Track holding the active video clip (for the hide flag)
const activeVideoTrack = computed(() => {
  const clipId = activeVideoClip.value?.clip?.id
  if (!clipId) return null
  return currentProject.value?.timeline?.tracks.find(
    tr => tr.type === 'video' && tr.items?.some(i => i.id === clipId)
  ) || null
})

const isTrackHidden = computed(() => !!activeVideoTrack.value?.hidden)

// Preview audio: the video element plays the active clip's
// own audio track. Muted only when the video track itself is
// muted (timeline header toggle). Timeline audio clips still
// have no preview engine — their mute state is persisted for
// the future audio engine.
//
// Keyframes (roadmap B1): `t` values are CLIP-LOCAL ticks — 0 is the
// clip's own start on the timeline, so keyframes travel with the clip
// when it is moved. Evaluation clamps outside the range (core C3).
// PREVIEW ONLY: the export pipeline does not render keyframes yet
// (Phase K roadmap item) — never expose them as exported behavior.
function localTicks(clip: { offset?: number }): number {
  // C16-R3: the render position is SECONDS, the store offset is TICKS — snap
  // into tick space first, then subtract. renderSeconds (ADR-018) is the
  // position the canvas actually draws from, so keyframes and text animation
  // resolve on the same frame the layers were picked for.
  return Math.round(secToTicks(renderSeconds.value) - (clip.offset || 0))
}

const isVideoMuted = computed(() => !!activeVideoTrack.value?.muted)
const videoVolume = computed(() => {
  const clip = activeVideoClip.value?.clip
  const track = activeVideoTrack.value
  if (!clip) return 1
  const v = evalKeyframe(clip, 'volume', localTicks(clip)) ?? clip.volume
  // R124 A1: track-level volume (0..100) multiplies the clip volume.
  const trackVol = Number(track?.volume ?? 100)
  // Fade envelope (roadmap C12 / core audio.mjs): gainAt multiplies the
  // (keyframed) volume by the fade ramp, each edge clamped to half the
  // clip. C16-R3: core's legacy flat branch reads in/out as SECONDS, so
  // the store item (ticks) is handed over in the v3 shape instead.
  // Preview only until the compiler round (R5) — the same gap
  // family as the volume slider itself.
  const shaped = {
    fade: clip.fade,
    volume: (typeof v === 'number' ? v : clip.volume ?? 100) * (trackVol / 100),
    timeline: { duration: clipDurationTicks(clip) }
  }
  return gainAt(shaped, localTicks(clip))
})

// Re-sync preview after ANY timeline mutation (trim/move/split/add often
// keep the same src URL, so the src watcher alone would leave a stale
// frame when paused — no rAF loop runs to correct the drift).
function syncPreviewToPlayhead() {
  const el = internalVideoRef.value
  if (!el || !currentMediaSrc.value) return
  if (activeVideoClip.value) {
    try {
      el.currentTime = activeVideoClip.value.mediaCurrentTime
    } catch {
      // ignore seeks on unloaded metadata; loop corrects while playing
    }
    // Reverse clips stay paused: their frames are seek-driven (the
    // playback step loop owns them — see useTmcutPlayback).
    if (isPlaying.value && !activeVideoClip.value.clip.reverse) {
      el.play().catch(() => { })
    }
  } else {
    // Playhead sits in a gap: stop the element so a clip that is no longer
    // under the playhead never keeps playing through the gap.
    el.pause()
  }
}

watch(() => currentProject.value?.timeline, () => {
  syncPreviewToPlayhead()
}, { deep: true })

// Synchronize video element playback and seeking
watch(currentMediaSrc, (newSrc) => {
  if (internalVideoRef.value && newSrc) {
    syncPreviewToPlayhead()
  }
})

// ===== Audio-track playback engine (roadmap R124) =====
// Audio clips used to have NO preview engine at all — dropping a (WebM)
// audio file onto an audio track produced silence, which is what "webm
// audio không phát được" actually meant (the routing at R122 only moved
// the clip to the right row). Each active audio clip now owns a hidden
// <audio> element keyed by clip id. While playing, the elements run on
// their own media clocks and only drift-correct (>=0.35s); while paused
// they follow the playhead like the video layer (scrub = seek). Reverse
// audio clips are not seek-looped (documented gap, mirrors the video
// reverse handling being a step-loop feature).
const audioEls = new Map<string, HTMLAudioElement>()
function setAudioEl(clipId: string, el: unknown) {
  if (el instanceof HTMLAudioElement) audioEls.set(clipId, el)
  else audioEls.delete(clipId)
}

const activeAudioClips = computed(() => {
  const tracks = currentProject.value?.timeline?.tracks || []
  const out: { clip: TmcutTimelineItem, track: TmcutTrack }[] = []
  for (const track of tracks) {
    if (track.type !== 'audio') continue
    for (const clip of track.items || []) {
      // Reverse clips are skipped: HTMLMediaElement has no backward
      // playback, and starting one at the wrong end is worse than silence.
      if (clip.reverse) continue
      if (renderSeconds.value >= clipStartSec(clip) && renderSeconds.value < clipEndSec(clip)) {
        out.push({ clip, track })
      }
    }
  }
  return out
})

const activeAudioSrcs = computed(() => activeAudioClips.value.map(({ clip, track }) => {
  // R124 A1: track-level volume (0..100) multiplies the clip volume, so a
  // track dimmer is a global gain on that row. Track pan (-100..100) is a
  // documented preview gap (mirrors video reverse): HTMLMediaElement has no
  // stereo field control without a WebAudio graph, so the pan is honored
  // at EXPORT only (core panFilter) and the preview stays centred.
  const trackVol = Number(track?.volume ?? 100)
  return {
    id: clip.id,
    src: clip.src ? previewEngine.resolveSrc(clip.src) : '',
    mediaTime: clipMediaTimeSec(clip, renderSeconds.value),
    muted: !!track.muted || !!previewMuted.value,
    // Store volume is PERCENT 0..100 (v1 heritage, core audio.mjs) while
    // HTMLMediaElement.volume speaks 0..1 — normalize + clamp before the
    // DOM binding. The old `clip.volume ?? 1` wrote e.g. HTTP 100 straight
    // into el.volume ("Failed setting prop volume: value 100 is invalid").
    volume: Math.min(1, Math.max(0, ((clip.volume ?? 100) * trackVol / 10000) * previewVolume.value)),
    rate: clip.speed && clip.speed >= 0.25 && clip.speed <= 4 ? clip.speed : 1
  }
}))

function seekAudioElement(el: HTMLAudioElement, time: number) {
  try {
    el.currentTime = time
  } catch { /* metadata not ready */ }
}

function syncAudioElements() {
  const activeIds = new Set(activeAudioSrcs.value.map(a => a.id))
  for (const [id, el] of audioEls) {
    if (!activeIds.has(id)) el.pause()
  }
  for (const a of activeAudioSrcs.value) {
    const el = audioEls.get(a.id)
    if (!el || !a.src) continue
    el.playbackRate = a.rate
    if (!isPlaying.value) {
      // Paused / scrubbing: mirror the playhead exactly, stay paused.
      seekAudioElement(el, a.mediaTime)
      el.pause()
      continue
    }
    if (Math.abs(el.currentTime - a.mediaTime) > 0.35) {
      seekAudioElement(el, a.mediaTime)
    }
    if (el.paused) el.play().catch(() => { })
  }
}

function onAudioLoaded(a: { id: string, mediaTime: number }) {
  const el = audioEls.get(a.id)
  if (!el) return
  seekAudioElement(el, a.mediaTime)
}

// Identity string: element mount/unmount (clip enters/leaves the
// playhead or its src changes) resyncs after Vue has rendered the refs.
watch(
  () => activeAudioSrcs.value.map(a => `${a.id}:${a.src}`).join('|'),
  () => { nextTick(syncAudioElements) }
)
watch(isPlaying, () => {
  syncAudioElements()
})
// Scrub while paused: follow immediately (playing runs on media clocks).
watch(playhead, () => {
  if (!isPlaying.value) syncAudioElements()
})
// Committed timeline edits (trim/move/add/remove) resync the elements.
watch(
  () => currentProject.value?.timeline,
  () => { syncAudioElements() },
  { deep: true }
)

let audioDriftTimer: ReturnType<typeof setInterval> | null = null

// --- Canvas Crop & Mask (Roadmap F-3) ---
const isCropActive = computed(() => {
  return !!(isCropEditing.value && activeVideoClip.value && activeVideoClip.value.clip.id === selectedClipId.value)
})

const currentCropRect = computed(() => {
  const clip = activeVideoClip.value?.clip
  return clampCropRect(clip?.cropRect || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
})

const activeCropRatio = ref<string>('free')
const cropRatioPresets = computed(() => CROP_RATIO_PRESETS)

function setCropRatioPreset(presetId: string) {
  activeCropRatio.value = presetId
  const clip = activeVideoClip.value?.clip
  if (!clip) return
  const preset = CROP_RATIO_PRESETS.find(p => p.id === presetId)
  const sourceW = internalVideoRef.value?.videoWidth || 1920
  const sourceH = internalVideoRef.value?.videoHeight || 1080
  const adjusted = applyCropRatio(currentCropRect.value, preset?.ratio ?? null, sourceW, sourceH)
  pushHistory()
  updateClip(clip.id, { cropRect: adjusted })
}

function resetCropRect() {
  const clip = activeVideoClip.value?.clip
  if (!clip) return
  pushHistory()
  activeCropRatio.value = 'free'
  updateClip(clip.id, { cropRect: { x: 0, y: 0, w: 1, h: 1 } })
}

function triggerCropTool() {
  const clip = activeVideoClip.value?.clip
  if (!clip) return
  if (selectedClipId.value !== clip.id) {
    selectClip(clip.id)
  }
  if (clip.fit !== 'crop') {
    pushHistory()
    updateClip(clip.id, { fit: 'crop', cropRect: clip.cropRect || { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } })
  }
  toggleCropEditing()
}

// Media fitting styles (Phase 2): fit/fill/crop/stretch/smart.
// Zero-FFmpeg slice F4b: the layout arrives on core's layer, resolved once by
// the same evaluator `toRenderClip` feeds the compiler. This file used to call
// the resolver a second time for the same clip — a third consumer writing its
// own answer instead of reading the plan's.
function fitStyle(layout: CoreEvaluatedLayout): Record<string, string> {
  return computeFitObjectStyle(layout.fit, layout.focusX, layout.focusY, layout.cropRect) as Record<string, string>
}

// The fit a surface is painted with. The crop editor is the one exception, and
// it belongs to the element the user is actually dragging on — the main
// picture — because the crop rect it draws is measured in that letterboxed
// box. A stacked row keeps its real fit even while the crop tool is open.
function fitForSurface(surface: PaintSurface | null | undefined): Record<string, string> {
  if (!surface) return {}
  if (isCropActive.value && surface.clip.id === activeVideoClip.value?.clip?.id) {
    return { objectFit: 'contain', objectPosition: '50% 50%' }
  }
  return fitStyle(surface.layer.layout)
}

// Text overlays scale with the rendered canvas size (docs §65.2):
// overlay units are canvas pixels, so multiply by the preview scale instead
// of the old hardcoded 0.7 factor. The monitor wrapper enforces the canvas
// aspect ratio, so the width-axis scale applies uniformly.
const monitorRef = ref<HTMLDivElement | null>(null)
const containerWidth = ref(0)
let resizeObserver: ResizeObserver | null = null
let viewportObserver: ResizeObserver | null = null

const textScale = computed(() =>
  previewScale(containerWidth.value, currentProject.value?.canvas?.width || 0)
)

// The footage group's own transform + opacity, read straight off core's layer
// for this tick. Slice F4b retired the local re-computation: this file used to
// run the evaluator a second time on the authored clip and get an answer that
// could disagree with the one the plan already carried.
//
// It is the GROUP's style, not the element's: the export bakes a layer's
// effects into that layer and only then transforms, fades and masks it
// (`render/video.ts` — trim, setpts, fit, the effect chain, then overlay), so
// the plates added below have to ride inside the same group or they escape the
// transform they belong to.
function layerGroupBase(layer: CoreEvaluatedLayer): { transform: string, opacity: number } {
  const preview = textScale.value || 1
  const { x, y, scaleX, rotation } = layer.transform
  return {
    transform: `translate(${x * preview}px, ${y * preview}px) scale(${scaleX}) rotate(${rotation}deg)`,
    opacity: layer.opacity
  }
}

// The overlay face of each effect this layer carries, in the order the export
// chains them. Which effects may plate a LIVE picture is the registry's answer
// (`fxPreview.effectOverlay`), not a table here — a thumbnail mnemonic (a
// keying band, a pixel grid) never tinted a monitor, and a real plate never sat
// above the whole frame as it did before F4b.
function surfacePlates(surface: PaintSurface | null | undefined): CSSProperties[] {
  if (!surface) return []
  return layerOverlayPlates(surface.layer.effects)
}

// The element-facing half of that face: the filter/transform an effect applies
// to the picture it sits on. No local type table here, so a tile, the inspector
// and this element cannot disagree about what `blur=80` or `lut=warm` looks
// like. An overlay-only definition reports an empty filter — it is painted by
// `surfacePlates` instead, and the tile badges its fidelity either way.
function effectsCss(effects: Array<{ type: string, params?: Record<string, unknown> }>): { filter: string, transform: string } {
  const filter: string[] = []
  const transform: string[] = []
  for (const eff of effects || []) {
    const parts = effectCssParts(eff.type, eff.params || {})
    if (parts.filter) filter.push(parts.filter)
    if (parts.transform) transform.push(parts.transform)
  }
  return { filter: filter.join(' '), transform: transform.join(' ') }
}

// R124 A3: preview CSS twin of the export mask (core mask.mjs renders the
// SAME normalized geometry as an SVG alpha mask). Applied to the media
// element itself; mask-size 100% stretches the canvas-aspect SVG onto the
// element, so the box lands where the export's canvas-box lands.
function maskPreviewStyle(mask: unknown): Record<string, string> {
  const css = maskCssMaskImage(mask as never, currentProject.value?.canvas?.width || 100, currentProject.value?.canvas?.height || 100)
  if (!css) return {}
  return {
    maskImage: css,
    webkitMaskImage: css,
    maskSize: '100% 100%',
    webkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    webkitMaskRepeat: 'no-repeat'
  }
}

// ONE visual law for every footage layer (Zero-FFmpeg slice F2b). The main
// picture, the crossfade partner and each stacked row are styled by this one
// function of a surface, so a row painted above another cannot arrive with a
// cheaper look than the row it covers — the asymmetry the exporter had already
// resolved in the file and the monitor had kept for itself.
//
// The numbers are core's own layer for this tick — `layer.transform` and
// `layer.opacity` (keyframes resolved by the evaluator the export also reads),
// `layer.mask` and `layer.effects` painted by the registry — plus the crossfade
// ramp from `previewTransitionRamp`, whose shape,
// travel law and CSS are measured against the bundled FFmpeg in
// `tmcut-core/transitions.mjs` (V4 G16) — so the monitor and the export
// describe the same cut. Fade and dissolve stay a complementary opacity ramp
// over the outgoing layer — only ONE layer ramps, because source-over with two
// partial alphas would bleed the black background through (0.5·in + 0.25·out).
// The reveal families paint on the INCOMING layer (it sits on top, so clipping
// the outgoing would only uncover the canvas behind it); `slide` moves both
// layers, and the `*crop` keys clip the outgoing too because the uncovered
// canvas IS the black the file paints there.
//
// The ramp applies to a surface whose partner is on screen: `crossfades` is
// core's plan adjacency, so a layer carrying a transition whose partner was
// trimmed away paints as the plain cut `compositePlan` decided.
function surfaceStyle(surface: PaintSurface | null | undefined): Record<string, string | number> {
  if (!surface) return {}
  const layer = surface.layer
  // This is the GROUP's style: it positions the media element and that
  // element's plates together, which is what the export composites before it
  // transforms. The fit therefore stays on the element (`fitForSurface` in the
  // template) — an `object-fit` on a div would silently do nothing.
  const base = layerGroupBase(layer)
  const style: Record<string, string | number> = {
    ...base,
    ...maskPreviewStyle(layer.mask)
  }
  const effectStyle = effectsCss(layer.effects)
  if (effectStyle.filter) {
    style.filter = effectStyle.filter
  }
  if (effectStyle.transform) {
    style.transform = `${style.transform} ${effectStyle.transform}`
  }
  // Blend mode (R116): CSS mix-blend-mode is the preview counterpart of
  // the FFmpeg `blend` filter the export uses — same mode names, and since F6d
  // the same core law. In the DOM it blends against the layer below, which is
  // exactly the row order core gives.
  if (layer.blend !== 'normal') {
    style.mixBlendMode = layer.blend
  }
  const spec = surface.layer.transition
  if (surface.crossfades && spec?.type) {
    const ramp = previewTransitionRamp(spec.type, spec.progress)
    const side = spec.role === 'outgoing' ? ramp.outgoing : ramp.incoming
    style.opacity = base.opacity * side.opacity
    if (side.clipPath) style.clipPath = side.clipPath
    // A transition that reveals with a gradient wins over the clip's own
    // mask for the length of the overlap; both cannot share one mask-image.
    if (side.maskImage) {
      style.maskImage = side.maskImage
      style.webkitMaskImage = side.webkitMaskImage || side.maskImage
      style.maskSize = side.maskSize || '100% 100%'
      style.webkitMaskSize = side.webkitMaskSize || '100% 100%'
      style.maskRepeat = side.maskRepeat || 'no-repeat'
      style.webkitMaskRepeat = side.webkitMaskRepeat || 'no-repeat'
    }
    if (side.transform) style.transform = `${style.transform} ${side.transform}`
  }
  return style
}

// First paint of a stacked element should already be the right frame; the rAF
// loop drift-corrects after it.
function onStackedLoadedMetadata(surface: PaintSurface, event: Event) {
  const el = event.target as HTMLVideoElement | null
  if (!el) return
  try {
    el.currentTime = surface.mediaTimeSec
  } catch {
    // ignore seeks on unloaded metadata
  }
}

// Element fullscreen for the monitor frame (browser F11 stays available
// too — this only expands the canvas itself)
function toggleFullscreen() {
  const el = monitorRef.value
  if (!el) return
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => { })
  } else {
    el.requestFullscreen().catch(() => { })
  }
}

// ONE visual law for a text overlay (Zero-FFmpeg slice F7). Every painted number
// comes from the layer core evaluated at this tick — position, scale, opacity and
// the in/out curve are core's, the same reading the export compiles from. The
// authored clip rides along on the surface for the edit affordances (drag, the
// selection ring, the Inspector); nothing here reads it, because a second
// `evalKeyframe` / `textAnimationAt` pass in the DOM is a third answer to where a
// caption sits and the file has only ever had two.
function textOverlayStyle(surface: TextSurface): Record<string, string | number> {
  const layer = surface.layer
  const text = layer.text
  if (!text) return {}
  const scale = textScale.value
  const transform = layer.transform
  // Core's own guard: an animation curve with nothing to animate is identity.
  const animation = text.animation
  const fontSize = text.fontSize || DEFAULT_TEXT_FONT_SIZE

  // Anchor (roadmap C-2) mirrors the export x expression exactly:
  // left = 0+x, center = (w−tw)/2+x, right = w−tw+x — the block's EDGE
  // lands at that point; vertical anchoring is always centered (export
  // y is always (h−th)/2+y).
  const align = text.align || 'center'
  const anchorX = align === 'left' ? '0%' : align === 'right' ? '100%' : '50%'
  return {
    // Font family (roadmap C-1): the CSS twin of the export's fontfile=,
    // quoted via JSON.stringify so multi-word families ("Segoe UI") stay one
    // valid family token.
    ...(text.fontFamily ? { fontFamily: `${JSON.stringify(text.fontFamily)}, sans-serif` } : {}),
    // Style flags (roadmap C-2): the CSS twin of the export's face file +
    // drawtext shadow/border options — the pixel numbers come from tmcut-core
    // (textStyle.mjs), the same source the export compiler reads.
    ...(text.bold ? { fontWeight: '700' } : {}),
    ...(text.italic ? { fontStyle: 'italic' } : {}),
    // The effect colours arrive on the layer (F7). An unauthored colour is
    // null, and the legacy black/85% stays its twin in the export filter.
    ...(text.shadow ? { textShadow: `${textShadowOffset(fontSize) * scale}px ${textShadowOffset(fontSize) * scale}px 0 ${text.shadowColor || 'rgba(0, 0, 0, 0.85)'}` } : {}),
    ...(text.stroke
      ? {
          paintOrder: 'stroke fill',
          WebkitTextStroke: `${textStrokeWidth(fontSize) * scale}px ${text.strokeColor || 'rgba(0, 0, 0, 0.85)'}`
        }
      : {}),
    // Background plate: the CSS twin of drawtext `box=1:boxborderw=`, using
    // the SAME padding number the export compiler uses (textBoxPadding).
    ...(text.bgColor
      ? {
          backgroundColor: text.bgColor,
          padding: `${textBoxPadding(fontSize) * scale}px`,
          borderRadius: `${Math.max(2, Math.round(fontSize * 0.08)) * scale}px`
        }
      : {}),
    color: text.color || DEFAULT_TEXT_COLOR,
    fontSize: `${fontSize * scale}px`,
    left: align === 'left' ? '0' : align === 'right' ? '100%' : '50%',
    top: '50%',
    transform: `translate(${(transform.x + animation.deltaX) * scale}px, ${(transform.y + animation.deltaY) * scale}px) translate(${anchorX}, -50%) scale(${transform.scaleX * animation.scale}, ${transform.scaleY * animation.scale}) rotate(${transform.rotation}deg)`,
    // Two factors, each applied once: the clip's own (possibly keyframed)
    // opacity, and the in/out reveal sitting on top of it.
    opacity: layer.opacity * animation.opacity,
    // R124 A3: masked text fades through the same SVG mask as video. The
    // overlay is text-sized, not canvas-sized, so mask units are the
    // box itself here — a small, documented WYSIWYG gap vs the canvas-frame
    // export box (export masks the full-frame text layer).
    ...maskPreviewStyle(layer.mask)
  }
}

// Drag text overlays directly in preview (CapCut-style). Overlay units are
// canvas pixels, so pointer deltas divide by the preview scale.
let suppressCanvasClickUntil = 0

// Element refs for the overlays, so a grab-time AABB seeds the resize/rotate
// math (same contract as the video transform box).
const textElRefs = new Map<string, HTMLElement>()
function setTextEl(id: string, el: unknown) {
  if (el instanceof HTMLElement) textElRefs.set(id, el)
  else textElRefs.delete(id)
}

// Keep the handles a constant on-screen size: the overlay's own transform
// scales everything inside it, so each handle counter-scales by the clip's
// scale (10–300, the Inspector bound).
function textHandleInverse(textClip: { scale?: number }): number {
  return 1 / Math.max(0.1, (textClip.scale ?? 100) / 100)
}

// Corner drag = uniform scale around the overlay center (the exact math the
// video transform box uses): rotation-invariant, and it writes the same
// `scale` field the Inspector exposes, so both stay in step.
function onTextResizeMouseDown(e: MouseEvent, textClip: { id: string, scale?: number }) {
  if (e.button !== 0) return
  e.stopPropagation()
  const el = textElRefs.get(textClip.id)
  if (!el) return
  selectClip(textClip.id)
  pushHistory()
  const rect = el.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1
  const initialScale = textClip.scale ?? 100
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.abs(moveEvent.clientX - e.clientX) + Math.abs(moveEvent.clientY - e.clientY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY)
    const next = Math.min(300, Math.max(10, Math.round(initialScale * (dist / startDist))))
    updateClip(textClip.id, { scale: next })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// Rotate knob above the overlay: pointer angle around the center minus the
// grab angle, added to the initial rotation (CSS/export agree on direction).
function onTextRotateMouseDown(e: MouseEvent, textClip: { id: string, rotation?: number }) {
  if (e.button !== 0) return
  e.stopPropagation()
  const el = textElRefs.get(textClip.id)
  if (!el) return
  selectClip(textClip.id)
  pushHistory()
  const rect = el.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
  const initialRotation = textClip.rotation || 0
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.hypot(moveEvent.clientX - e.clientX, moveEvent.clientY - e.clientY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX)
    const deg = initialRotation + (angle - startAngle) * 180 / Math.PI
    const normalized = Math.round(((deg + 180) % 360 + 360) % 360 - 180)
    updateClip(textClip.id, { rotation: normalized })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onTextMouseDown(e: MouseEvent, textClip: { id: string, x?: number, y?: number }) {
  if (e.button !== 0) return
  e.stopPropagation()
  selectClip(textClip.id)
  pushHistory()
  const startX = e.clientX
  const startY = e.clientY
  const initialX = textClip.x || 0
  const initialY = textClip.y || 0
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const scale = textScale.value || 1
    updateClip(textClip.id, {
      x: Math.round((initialX + (moveEvent.clientX - startX) / scale) * 10) / 10,
      y: Math.round((initialY + (moveEvent.clientY - startY) / scale) * 10) / 10
    })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// --- Video transform selection box (Roadmap A3) ---
// Shown only when the SELECTED clip is the video actually rendered at
// the playhead — no box floats over an empty canvas or a hidden track.
const selectionBoxClip = computed(() => {
  const clip = activeVideoClip.value?.clip
  if (!clip || clip.id !== selectedClipId.value) return null
  if (isTrackHidden.value || mediaLoadError.value) return null
  return clip
})

const selectionBoxRef = ref<HTMLDivElement | null>(null)

// Same transform as the rendered video, plus a constant 2px border:
// the transform scales CSS lengths, so the width is pre-divided.
const selectionBoxStyle = computed(() => {
  const clip = selectionBoxClip.value
  if (!clip) return null
  const scale = (clip.scale || 100) / 100
  const preview = textScale.value || 1
  return {
    transform: `translate(${(clip.x || 0) * preview}px, ${(clip.y || 0) * preview}px) scale(${scale}) rotate(${clip.rotation || 0}deg)`,
    borderWidth: `${2 / scale}px`
  }
})

// Corner handles: cosmetic cursor per corner; all four resize identically
// (uniform scale around the clip center).
const selectionCorners = [
  { key: 'nw', pos: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
  { key: 'ne', pos: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
  { key: 'sw', pos: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
  { key: 'se', pos: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' }
]

// Keep handles a constant size on screen regardless of clip scale.
const handleInverseScale = computed(() => 1 / ((selectionBoxClip.value?.scale || 100) / 100))

// Move the selected video clip in the preview: canvas-px deltas divided
// by the preview scale (same math as onTextMouseDown).
function onSelectionBodyMouseDown(e: MouseEvent) {
  const clip = selectionBoxClip.value
  if (!clip || e.button !== 0) return
  e.stopPropagation()
  pushHistory()
  const clipId = clip.id
  const startX = e.clientX
  const startY = e.clientY
  const initialX = clip.x || 0
  const initialY = clip.y || 0
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.abs(moveEvent.clientX - startX) + Math.abs(moveEvent.clientY - startY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const scale = textScale.value || 1
    updateClip(clipId, {
      x: Math.round((initialX + (moveEvent.clientX - startX) / scale) * 10) / 10,
      y: Math.round((initialY + (moveEvent.clientY - startY) / scale) * 10) / 10
    })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// Corner resize: new scale = initial scale × (pointer distance from the
// clip center / distance at grab). The screen-px ratio equals the scale
// ratio (transform origin is the center) and distance is rotation
// invariant, so rotated clips resize correctly too. Clamp matches the
// Inspector scale input (10–300). Rotation has no handle on purpose —
// the export has no rotate filter yet (C7; same honesty rule that keeps
// the Inspector rotation slider hidden).
function onSelectionResizeMouseDown(e: MouseEvent) {
  const clip = selectionBoxClip.value
  if (!clip || e.button !== 0 || !selectionBoxRef.value) return
  e.stopPropagation()
  pushHistory()
  const clipId = clip.id
  const rect = selectionBoxRef.value.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const startDist = Math.hypot(e.clientX - centerX, e.clientY - centerY) || 1
  const initialScale = clip.scale || 100
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.abs(moveEvent.clientX - e.clientX) + Math.abs(moveEvent.clientY - e.clientY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY)
    const next = Math.min(300, Math.max(10, Math.round(initialScale * (dist / startDist))))
    updateClip(clipId, { scale: next })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// Rotate handle: angle of the pointer around the clip center (screen
// space, y-down => atan2 grows clockwise) minus the angle at grab, added
// to the initial rotation. Matches CSS rotate(deg) direction — which
// matches the export filter since R21 verified rotate == transpose CW.
function onSelectionRotateMouseDown(e: MouseEvent) {
  const clip = selectionBoxClip.value
  if (!clip || e.button !== 0 || !selectionBoxRef.value) return
  e.stopPropagation()
  pushHistory()
  const clipId = clip.id
  // getBoundingClientRect of the rotated box: its AABB center is the
  // element center regardless of rotation.
  const rect = selectionBoxRef.value.getBoundingClientRect()
  const centerX = rect.left + rect.width / 2
  const centerY = rect.top + rect.height / 2
  const startAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX)
  const initialRotation = clip.rotation || 0
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.hypot(moveEvent.clientX - e.clientX, moveEvent.clientY - e.clientY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX)
    const deg = initialRotation + (angle - startAngle) * 180 / Math.PI
    const normalized = Math.round(((deg + 180) % 360 + 360) % 360 - 180)
    updateClip(clipId, { rotation: normalized })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// 8 crop resize handles: 4 corners + 4 edges
const cropHandles = [
  { key: 'nw', pos: '-top-1.5 -left-1.5', cursor: 'cursor-nwse-resize' },
  { key: 'ne', pos: '-top-1.5 -right-1.5', cursor: 'cursor-nesw-resize' },
  { key: 'sw', pos: '-bottom-1.5 -left-1.5', cursor: 'cursor-nesw-resize' },
  { key: 'se', pos: '-bottom-1.5 -right-1.5', cursor: 'cursor-nwse-resize' },
  { key: 'n', pos: '-top-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { key: 's', pos: '-bottom-1.5 left-1/2 -translate-x-1/2', cursor: 'cursor-ns-resize' },
  { key: 'w', pos: '-left-1.5 top-1/2 -translate-y-1/2', cursor: 'cursor-ew-resize' },
  { key: 'e', pos: '-right-1.5 top-1/2 -translate-y-1/2', cursor: 'cursor-ew-resize' }
]

function onCropBodyMouseDown(e: MouseEvent) {
  const clip = activeVideoClip.value?.clip
  if (!clip || e.button !== 0 || !monitorRef.value) return
  e.stopPropagation()
  pushHistory()
  const clipId = clip.id
  const startX = e.clientX
  const startY = e.clientY
  const init = { ...currentCropRect.value }
  const monitorRect = monitorRef.value.getBoundingClientRect()
  const monW = Math.max(1, monitorRect.width)
  const monH = Math.max(1, monitorRect.height)
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const dx = (moveEvent.clientX - startX) / monW
    const dy = (moveEvent.clientY - startY) / monH
    const nextX = Math.max(0, Math.min(1 - init.w, init.x + dx))
    const nextY = Math.max(0, Math.min(1 - init.h, init.y + dy))
    updateClip(clipId, {
      cropRect: clampCropRect({ x: nextX, y: nextY, w: init.w, h: init.h })
    })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

function onCropHandleMouseDown(e: MouseEvent, handleKey: string) {
  const clip = activeVideoClip.value?.clip
  if (!clip || e.button !== 0 || !monitorRef.value) return
  e.stopPropagation()
  pushHistory()
  const clipId = clip.id
  const startX = e.clientX
  const startY = e.clientY
  const init = { ...currentCropRect.value }
  const monitorRect = monitorRef.value.getBoundingClientRect()
  const monW = Math.max(1, monitorRect.width)
  const monH = Math.max(1, monitorRect.height)
  let moved = false

  function onMouseMove(moveEvent: MouseEvent) {
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3) return
    moved = true
    suppressCanvasClickUntil = Date.now() + 250
    const dx = (moveEvent.clientX - startX) / monW
    const dy = (moveEvent.clientY - startY) / monH

    let newX = init.x
    let newY = init.y
    let newW = init.w
    let newH = init.h

    if (handleKey === 'nw') {
      newX = init.x + dx
      newY = init.y + dy
      newW = init.w - dx
      newH = init.h - dy
    } else if (handleKey === 'ne') {
      newY = init.y + dy
      newW = init.w + dx
      newH = init.h - dy
    } else if (handleKey === 'sw') {
      newX = init.x + dx
      newW = init.w - dx
      newH = init.h + dy
    } else if (handleKey === 'se') {
      newW = init.w + dx
      newH = init.h + dy
    } else if (handleKey === 'n') {
      newY = init.y + dy
      newH = init.h - dy
    } else if (handleKey === 's') {
      newH = init.h + dy
    } else if (handleKey === 'w') {
      newX = init.x + dx
      newW = init.w - dx
    } else if (handleKey === 'e') {
      newW = init.w + dx
    }

    const clamped = clampCropRect({ x: newX, y: newY, w: newW, h: newH })
    updateClip(clipId, { cropRect: clamped })
  }

  function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove)
    window.removeEventListener('mouseup', onMouseUp)
  }

  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}

// Clicking the canvas is play/pause, but a click that lands on a draggable
// overlay (text layer, transform box, error card) is an EDIT gesture. It used
// to bubble here and start playback, so selecting a text clip also toggled
// the video — the overlays now tag themselves with data-canvas-hit.
function onCanvasClick(e: MouseEvent) {
  if (isCropActive.value || Date.now() < suppressCanvasClickUntil) return
  const target = e.target
  if (target instanceof Element && target.closest('[data-canvas-hit]')) return
  togglePlayPause()
}

// Playback shortcuts: Space play/pause, arrow step (Alt = one frame),
// J-K-L shuttle (no-op when the timeline is empty)
function handleKeydown(e: KeyboardEvent) {
  if (e.code === 'Escape' && isCropActive.value) {
    e.preventDefault()
    toggleCropEditing(false)
    return
  }
  if (!hasTimelineClips.value) return
  const target = e.target as HTMLElement
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
    return
  }
  if (e.code === 'Space') {
    e.preventDefault()
    togglePlayPause()
  } else if (e.code === 'ArrowLeft') {
    e.preventDefault()
    if (e.altKey) stepFrame(-1)
    else stepBackward(e.shiftKey ? 5 : 1)
  } else if (e.code === 'ArrowRight') {
    e.preventDefault()
    if (e.altKey) stepFrame(1)
    else stepForward(e.shiftKey ? 5 : 1)
  } else if (e.code === 'KeyJ' && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    shuttleBackward()
  } else if (e.code === 'KeyK' && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    shuttleStop()
  } else if (e.code === 'KeyL' && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    shuttleForward()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('resize', measureViewport)
  measureViewport()
  if (monitorRef.value) {
    containerWidth.value = monitorRef.value.clientWidth
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) containerWidth.value = width
    })
    resizeObserver.observe(monitorRef.value)
  }
  if (stageRef.value) {
    measureViewport()
    // Any resize that reaches the stage — window, panel split, timeline
    // height — re-measures the video box only. HUD and deck are fixed
    // rows, so their height is never part of the fit budget.
    viewportObserver = new ResizeObserver(() => measureViewport())
    viewportObserver.observe(stageRef.value)
  }
  // Audio-layer drift correction (R124): media clocks run independently
  // of the playhead rAF loop; a light 500ms tick keeps them within the
  // 0.35s tolerance without seeking on every frame.
  audioDriftTimer = setInterval(() => {
    if (isPlaying.value) syncAudioElements()
  }, 500)
})

onUnmounted(() => {
  // The playhead loop re-arms itself through requestAnimationFrame, so a
  // component that leaves while the timeline is running would keep pacing a
  // playhead nobody can see (slice F10, requirement 8).
  pause()
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('resize', measureViewport)
  resizeObserver?.disconnect()
  resizeObserver = null
  viewportObserver?.disconnect()
  viewportObserver = null
  if (audioDriftTimer) clearInterval(audioDriftTimer)
  audioDriftTimer = null
  for (const el of audioEls.values()) el.pause()
  audioEls.clear()
})
</script>

<template>
  <div ref="viewportRef" class="flex flex-col h-full w-full max-w-full">
    <!-- HUD header (R124 rework): exactly TWO rows so nothing can ever
         overlap — row 1 is text labels only (canvas state on the left,
         PROXY / STAB status pills right-aligned), row 2 is icon action
         buttons only. Pinned to the top of the viewport so resizing the
         monitor never pushes it off-screen. -->
    <div
      class="w-full shrink-0 sticky top-0 z-30 bg-muted/95 backdrop-blur-sm flex flex-col gap-1.5 text-[11px] border-b border-default"
      data-tmcut-hud
    >
      <!-- Row 1: labels -->
      <div
        class="flex items-center gap-2 min-w-0 text-muted flex-wrap px-3 pt-1.5"
        data-hud-row="labels"
      >
        <span
          class="w-1.5 h-1.5 rounded-full shrink-0"
          :class="isPlaying ? 'bg-primary animate-pulse' : 'bg-emerald-400'"
        />
        <span class="font-medium text-toned truncate">
          {{ t('tmcut.player.hudCanvas') }}
        </span>
        <span v-if="currentProject?.canvas" class="font-mono shrink-0">
          {{ currentProject.canvas.width }}x{{ currentProject.canvas.height }}
        </span>
        <span v-if="aspectLabel" class="font-mono shrink-0">
          ({{ aspectLabel }})
        </span>
        <span v-if="currentProject?.canvas" class="font-mono shrink-0">
          {{ canvasFpsValue(currentProject.canvas) }} FPS
        </span>
        <span
          class="px-1.5 py-0.5 rounded bg-primary/10 border border-primary/25 text-primary text-[10px] font-medium shrink-0"
        >
          {{ t('tmcut.player.engineBadge') }}
        </span>
        <span
          v-if="isCurrentClipProxy"
          class="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning-500/15 border border-warning-500/30 text-warning-400 font-medium text-[10px] leading-none shrink-0"
          :title="t('tmcut.proxy.activeDesc')"
        >
          <UIcon name="i-lucide-zap" class="size-3 text-warning-400" />
          {{ t('tmcut.proxy.active') }}
        </span>
        <span
          v-if="isCurrentClipStabilized"
          class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-medium text-[10px] leading-none shrink-0"
          :class="isCurrentClipProxy ? '' : 'ml-auto'"
          :title="t('tmcut.stabilize.activeDesc')"
        >
          <UIcon name="i-lucide-activity" class="size-3 text-emerald-400" />
          {{ t('tmcut.stabilize.badge') }}
        </span>
      </div>
      <!-- Row 2: actions. Each group is its own flex child, so
           `justify-between` spreads them evenly across the full tray width
           (it used to be one cluster jammed against the right edge) and the
           row still wraps cleanly on narrow panels. -->
      <div
        class="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 pb-1.5"
        data-hud-row="actions"
      >
        <span class="inline-flex min-w-0 max-w-[45%] items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-film" class="size-3 shrink-0" />
          <span class="truncate">
            {{ activeVideoClip?.clip?.name ? t('tmcut.player.hudActiveClip', { name: activeVideoClip.clip.name })
              : t('tmcut.player.hudNoClip') }}
          </span>
        </span>

        <!-- Preview quality (mock #2): Full Res / 1/2 Res / 1/4 Res / Proxy
             720p. Plain Nuxt UI USelect defaults so the trigger and the menu
             follow the theme in light and dark exactly like every other
             control; it resizes the monitor only — the trays never move. -->
        <USelect
          id="tmcut-preview-quality"
          :model-value="previewQuality"
          :items="qualityItems"
          value-key="value"
          size="xs"
          variant="soft"
          color="neutral"
          leading-icon="i-lucide-gauge"
          class="shrink-0"
          :title="t('tmcut.player.quality')"
          :aria-label="t('tmcut.player.quality')"
          @update:model-value="onQualityChange"
        />

        <div v-if="activeVideoClip || previewEngine.capabilities.proxyPreview" class="flex items-center gap-1">
          <UButton
            v-if="activeVideoClip"
            icon="i-lucide-crop"
            size="xs"
            variant="soft"
            :color="isCropActive ? 'primary' : 'neutral'"
            :aria-label="t('tmcut.crop.tool')"
            :title="t('tmcut.crop.tool')"
            @click="triggerCropTool"
          />
          <UButton
            v-if="previewEngine.capabilities.proxyPreview"
            :icon="proxyPreview ? 'i-lucide-zap' : 'i-lucide-zap-off'"
            size="xs"
            variant="soft"
            :color="proxyPreview ? (isCurrentClipProxy ? 'warning' : 'primary') : 'neutral'"
            :aria-label="proxyPreview ? t('tmcut.proxy.disable') : t('tmcut.proxy.enable')"
            :title="proxyPreview ? t('tmcut.proxy.disable') : t('tmcut.proxy.enable')"
            @click="proxyPreview = !proxyPreview"
          />
        </div>

        <div class="flex items-center gap-1">
          <UButton
            v-for="toggle in overlayToggles"
            :key="toggle.key"
            :icon="toggle.icon"
            size="xs"
            variant="soft"
            :color="toggle.active ? 'primary' : 'neutral'"
            :aria-label="toggle.label"
            :title="toggle.label"
            @click="toggle.onSelect()"
          />
        </div>

        <div class="flex items-center gap-1">
          <UDropdownMenu :items="canvasZoomItems" :content="{ align: 'end' }">
            <UButton
              icon="i-lucide-zoom-in"
              size="xs"
              variant="soft"
              :color="canvasZoom !== 'fit' ? 'primary' : 'neutral'"
              :aria-label="t('tmcut.player.zoom')"
              :title="t('tmcut.player.zoom')"
            />
          </UDropdownMenu>
          <UDropdownMenu :items="ratioGuideItems" :content="{ align: 'end' }">
            <UButton
              icon="i-lucide-rectangle-horizontal"
              size="xs"
              variant="soft"
              :color="ratioGuideId ? 'primary' : 'neutral'"
              :aria-label="t('tmcut.safeArea.ratioGuide')"
              :title="t('tmcut.safeArea.ratioGuide')"
            />
          </UDropdownMenu>
          <UButton
            v-if="canExtractFrames && activeVideoClip"
            :icon="snapshotBusy ? 'i-lucide-loader-circle' : 'i-lucide-camera'"
            size="xs"
            variant="soft"
            color="neutral"
            :loading="snapshotBusy"
            :aria-label="t('tmcut.player.snapshot')"
            :title="t('tmcut.player.snapshot')"
            @click="snapshotFrame"
          />
          <UButton
            icon="i-lucide-maximize"
            size="xs"
            variant="soft"
            color="neutral"
            :aria-label="t('tmcut.player.fullscreen')"
            :title="t('tmcut.player.fullscreen')"
            @click="toggleFullscreen"
          />
        </div>
      </div>
    </div>

    <!-- Monitor stage: the ONLY element that resizes when the viewport
         changes — the HUD header above and the transport deck below are
         fixed-height flex rows, so the leftover height belongs to this box
         and a window/panel resize only ever scales the video. Its own
         measured box (stageRef) drives the fit, which is why the fit never
         needs window.innerHeight and can no longer push the deck out.
         The stage centers the monitor so an intentionally zoomed frame
         overflows into its own scroll instead of releasing to the top-left.
         `m-3` is the breathing room between the monitor and the two trays:
         a fully fitted monitor used to sit flush against the HUD border. It
         is a MARGIN, not padding, so `clientHeight` (the fit budget) stays
         the real picture area and the monitor cannot grow into the gap. -->
    <div ref="stageRef" class="flex-1 min-h-0 overflow-auto m-3 flex items-center justify-center">
      <div
        ref="monitorRef"
        class="tmcut-monitor relative bg-black rounded-lg border border-default shadow-2xl overflow-hidden select-none"
        :style="monitorBoxStyle"
        :title="isPlaying ? t('tmcut.player.pause') : t('tmcut.player.play')"
        @click="onCanvasClick"
      >
        <!-- OUTGOING crossfade layer (roadmap B3): the neighbor under the
           incoming clip during a transition window. Muted — preview audio
           follows the incoming clip (documented simplification, §102).
           Tree order puts it below the (positioned) main element above.
           Zero-FFmpeg slice F4b: each footage layer is a GROUP — the element
           plus the overlay plates its own core layer carries. The exporter
           bakes a layer's effects into it and only then transforms, fades and
           masks it, so `surfaceStyle` is the group's and the fit the element's.
           A plate outside this group would be a monitor-wide tint wearing none
           of its layer's numbers, which is what the frame-wide vignette was. -->
        <div
          v-if="transitionCrossfade && outgoingMediaSrc"
          v-show="!isTrackHidden"
          class="absolute inset-0 pointer-events-none"
          :style="surfaceStyle(crossfadeSurface)"
        >
          <video
            ref="internalOutgoingRef"
            :src="outgoingMediaSrc"
            class="w-full h-full"
            :style="fitForSurface(crossfadeSurface)"
            :muted="true"
            preload="auto"
            playsinline
            @loadedmetadata="onOutgoingLoadedMetadata"
          />
          <div
            v-for="(plate, plateIndex) in surfacePlates(crossfadeSurface)"
            :key="plateIndex"
            class="absolute inset-0 pointer-events-none"
            :style="plate"
          />
        </div>

        <!-- HTML5 Video Element (served via media://local protocol,
           same as ToolsVideoFramePreview in tools/video.vue).
           `relative` keeps it in the stacking tree ABOVE the outgoing
           crossfade layer (both positioned z-auto → tree order wins). -->
        <div
          v-show="currentMediaSrc && !isTrackHidden && !isCurrentClipImage"
          class="relative w-full h-full pointer-events-none transition-transform duration-75"
          :style="surfaceStyle(mainSurface)"
        >
          <video
            ref="internalVideoRef"
            :src="isCurrentClipImage ? undefined : currentMediaSrc"
            class="w-full h-full"
            :style="fitForSurface(mainSurface)"
            :muted="isVideoMuted || previewMuted"
            :volume="videoVolume * previewVolume"
            preload="auto"
            playsinline
            @loadedmetadata="onLoadedMetadata"
            @waiting="onVideoWaiting"
            @playing="onVideoPlaying"
            @canplay="onVideoPlaying"
            @error="onMediaError('video')"
          />
          <div
            v-for="(plate, plateIndex) in surfacePlates(mainSurface)"
            :key="plateIndex"
            class="absolute inset-0 pointer-events-none"
            :style="plate"
          />
        </div>

        <!-- Still-image layer: same group/fit contract as the video, painted
             by <img> because a still cannot decode in the video element. -->
        <div
          v-show="isCurrentClipImage && currentMediaSrc && !isTrackHidden"
          class="relative w-full h-full pointer-events-none"
          :style="surfaceStyle(mainSurface)"
        >
          <img
            :src="isCurrentClipImage ? currentMediaSrc : undefined"
            class="w-full h-full object-contain select-none"
            :style="fitForSurface(mainSurface)"
            alt=""
            draggable="false"
            decoding="async"
            @error="onMediaError('image')"
          >
          <div
            v-for="(plate, plateIndex) in surfacePlates(mainSurface)"
            :key="plateIndex"
            class="absolute inset-0 pointer-events-none"
            :style="plate"
          />
        </div>

        <!-- Stacked footage rows (Zero-FFmpeg slice F2b): every surface core
             paints ABOVE the main picture gets its own group, in plan order,
             so the monitor shows the same stack the file writes. Muted — the
             preview's audio is the bottom row's, the same simplification the
             export makes with its one audio concat, and the plan already put
             that row under this one.
             Tree order IS the paint order here: these sit after the main layer,
             so a row the plan stacked on top covers it. The still branch exists
             for the same reason the main one does — a still cannot decode in a
             <video>. F4b closed the gap this comment used to carry: a row's
             plates come from its OWN layer now, so a vignette on the top row
             tints the top row, which is what the file bakes into that row. -->
        <template
          v-for="surface in stackedSurfaces"
          :key="surface.key"
        >
          <div
            class="absolute inset-0 pointer-events-none"
            :style="surfaceStyle(surface)"
          >
            <video
              v-if="!isImageClip(surface.clip)"
              :ref="(el) => setStackedVideoEl(surface.key, el)"
              :src="playableSrc(surface.clip)"
              class="w-full h-full"
              :style="fitForSurface(surface)"
              :muted="true"
              preload="auto"
              playsinline
              @loadedmetadata="onStackedLoadedMetadata(surface, $event)"
            />
            <img
              v-else
              :src="playableSrc(surface.clip)"
              class="w-full h-full object-contain select-none"
              :style="fitForSurface(surface)"
              alt=""
              draggable="false"
              decoding="async"
            >
            <div
              v-for="(plate, plateIndex) in surfacePlates(surface)"
              :key="plateIndex"
              class="absolute inset-0 pointer-events-none"
              :style="plate"
            />
          </div>
        </template>

        <!-- Audio-track playback layer (roadmap R124): one hidden <audio>
             per clip under the playhead, keyed by clip id so the element
             (and its media clock) survives unrelated re-renders. WebM
             audio and any other audio clip on an audio track now plays in
             the preview — previously these had no engine at all. -->
        <audio
          v-for="a in activeAudioSrcs"
          :key="a.id"
          :ref="(el) => setAudioEl(a.id, el)"
          :src="a.src"
          :muted="a.muted"
          :volume="a.volume"
          preload="auto"
          hidden
          @loadedmetadata="onAudioLoaded(a)"
        />

        <!-- Buffering indicator: the playhead keeps running on its own clock,
             so a stalled decoder needs an explicit state or the frame just
             looks frozen. -->
        <div
          v-if="isBuffering && !mediaLoadError"
          class="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
          role="status"
        >
          <span
            class="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur-sm"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            {{ t('tmcut.player.buffering') }}
          </span>
        </div>

        <!-- Hidden-track badge (CapCut eye-off state) -->
        <div
          v-if="isTrackHidden && currentMediaSrc"
          class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted select-none"
          data-canvas-hit
        >
          <UIcon name="i-lucide-eye-off" class="size-10 opacity-40" />
          <span class="text-xs">{{ t('tmcut.player.trackHidden') }}</span>
        </div>

        <!-- Media Offline plate (roadmap Q6(a), slice C2): owned by the asset
             record, so it is up before a decode is even attempted, and it
             offers relink without opening anything by itself. -->
        <div
          v-if="mediaOffline && !isTrackHidden"
          class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-black/75 p-4 text-center select-none"
          style="background-image: repeating-linear-gradient(45deg, rgba(251,191,36,0.12) 0 8px, transparent 8px 16px)"
          data-canvas-hit
          :title="t('tmcut.media.mediaOfflineHint')"
        >
          <UIcon :name="offlineView.icon" class="size-9 text-warning-400" />
          <p class="text-xs font-semibold text-warning-200">
            {{ t('tmcut.media.mediaOffline') }}
          </p>
          <p class="text-[10px] text-muted max-w-[46ch]">
            {{ t('tmcut.media.mediaOfflineHint') }}
          </p>
          <UButton
            v-if="currentAsset"
            icon="i-lucide-folder-search"
            size="xs"
            variant="subtle"
            color="warning"
            :label="t('tmcut.media.relink')"
            :aria-label="t('tmcut.media.relink')"
            :title="t('tmcut.media.relink')"
            @click.stop="relinkWithPicker(currentAsset)"
          />
          <p class="text-[10px] font-mono text-warning-300/70 break-all max-w-full">
            {{ activeVideoClip?.clip?.src }}
          </p>
        </div>

        <!-- Media load error overlay (only when a src was actually attempted) -->
        <div
          v-if="mediaLoadError && currentMediaSrc && !mediaOffline"
          class="absolute inset-0 z-40 flex flex-col items-center justify-center gap-2 bg-error-950/70 backdrop-blur-xs p-4 text-center select-none"
          data-canvas-hit
        >
          <UIcon name="i-lucide-alert-triangle" class="size-8 text-error-400" />
          <p class="text-xs font-semibold text-error-200">
            {{ t('tmcut.player.loadError') }}
          </p>
          <p class="text-[10px] font-mono text-error-300/80 break-all max-w-full">
            {{ activeVideoClip?.clip?.src }}
          </p>
        </div>

        <!-- Safe Area / Guides / Grid / Center Overlays (Phase 2) -->
        <div
          v-if="showSafeArea"
          class="absolute pointer-events-none border border-dashed border-emerald-400/60"
          :style="{
            left: pct(safeArea.actionSafe.x),
            top: pct(safeArea.actionSafe.y),
            width: pct(safeArea.actionSafe.w),
            height: pct(safeArea.actionSafe.h)
          }"
        />
        <div
          v-if="showSafeArea"
          class="absolute pointer-events-none border border-dashed border-warning-400/60"
          :style="{
            left: pct(safeArea.titleSafe.x),
            top: pct(safeArea.titleSafe.y),
            width: pct(safeArea.titleSafe.w),
            height: pct(safeArea.titleSafe.h)
          }"
        />
        <!-- Ratio frame guide (roadmap C13): centered box of the picked
           target ratio — a composition aid, not a crop. -->
        <div
          v-if="ratioGuideStyle"
          class="absolute pointer-events-none border border-dashed border-primary/60"
          :style="ratioGuideStyle"
        />
        <div v-if="showGuides" class="absolute inset-0 pointer-events-none">
          <div class="absolute top-0 bottom-0 left-1/3 w-px bg-primary/40" />
          <div class="absolute top-0 bottom-0 left-2/3 w-px bg-primary/40" />
          <div class="absolute left-0 right-0 top-1/3 h-px bg-primary/40" />
          <div class="absolute left-0 right-0 top-2/3 h-px bg-primary/40" />
        </div>
        <div
          v-if="showGrid"
          class="absolute inset-0 pointer-events-none opacity-30"
          style="background-image: linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px); background-size: 10% 10%;"
        />
        <div v-if="showCenter" class="absolute inset-0 pointer-events-none flex items-center justify-center">
          <UIcon name="i-lucide-crosshair" class="size-6 text-error-400/70" />
        </div>

        <!-- Empty / Standby Canvas Placeholder -->
        <div
          v-if="!currentMediaSrc"
          class="absolute inset-0 flex flex-col items-center justify-center text-muted gap-2 p-6 text-center"
        >
          <UIcon name="i-lucide-clapperboard" class="size-12 opacity-30 text-primary" />
          <span class="text-xs font-medium text-muted">
            {{ t('tmcut.player.noVideoAtPlayhead', { time: formatTimecode(playhead, previewFps) }) }}
          </span>
          <span class="text-[10px] text-muted font-mono">
            {{ currentProject?.canvas?.width }} x {{ currentProject?.canvas?.height }}
          </span>
        </div>

        <!-- Selected video transform box (Roadmap A3): drag the body to
           move, drag a corner to scale. Sits BELOW the text overlays so
           text stays clickable on top of it. -->
        <div
          v-if="!isCropActive && selectionBoxClip && selectionBoxStyle"
          ref="selectionBoxRef"
          class="absolute left-0 top-0 w-full h-full border-primary cursor-move"
          :style="selectionBoxStyle"
          data-canvas-hit
          @mousedown="onSelectionBodyMouseDown"
        >
          <span
            v-for="corner in selectionCorners"
            :key="corner.key"
            class="absolute w-2.5 h-2.5 -m-1 bg-white border-2 border-primary rounded-[2px]"
            :class="[corner.pos, corner.cursor]"
            :style="{ transform: `scale(${handleInverseScale})` }"
            @mousedown.stop="onSelectionResizeMouseDown"
          />
          <!-- Rotate stem + knob (R22): above the top edge, orbits with the
             box rotation; the knob is counter-scaled to stay constant size -->
          <div class="absolute left-1/2 -top-5 w-px h-4 -translate-x-1/2 bg-primary/70 pointer-events-none" />
          <span
            class="absolute left-1/2 -top-6 w-3 h-3 -translate-x-1/2 rounded-full bg-white border-2 border-primary cursor-grab active:cursor-grabbing pointer-events-auto"
            :style="{ transform: `scale(${handleInverseScale})` }"
            @mousedown.stop="onSelectionRotateMouseDown"
          />
        </div>

        <!-- Interactive Crop & Mask Overlay (Roadmap F-3) -->
        <template v-if="isCropActive">
          <!-- 4 Darkened Mask regions outside the crop rect -->
          <div
            class="absolute bg-black/65 pointer-events-none"
            :style="{
              top: 0,
              left: 0,
              right: 0,
              height: `${currentCropRect.y * 100}%`
            }"
          />
          <div
            class="absolute bg-black/65 pointer-events-none"
            :style="{
              bottom: 0,
              left: 0,
              right: 0,
              top: `${(currentCropRect.y + currentCropRect.h) * 100}%`
            }"
          />
          <div
            class="absolute bg-black/65 pointer-events-none"
            :style="{
              left: 0,
              top: `${currentCropRect.y * 100}%`,
              width: `${currentCropRect.x * 100}%`,
              height: `${currentCropRect.h * 100}%`
            }"
          />
          <div
            class="absolute bg-black/65 pointer-events-none"
            :style="{
              right: 0,
              top: `${currentCropRect.y * 100}%`,
              left: `${(currentCropRect.x + currentCropRect.w) * 100}%`,
              height: `${currentCropRect.h * 100}%`
            }"
          />

          <!-- Interactive Crop Bounding Box -->
          <div
            ref="cropBoxRef"
            class="absolute border-2 border-primary shadow-2xl cursor-move pointer-events-auto"
            :style="{
              left: `${currentCropRect.x * 100}%`,
              top: `${currentCropRect.y * 100}%`,
              width: `${currentCropRect.w * 100}%`,
              height: `${currentCropRect.h * 100}%`
            }"
            @mousedown="onCropBodyMouseDown"
          >
            <!-- 3x3 Rule-of-Thirds Grid -->
            <div class="absolute inset-0 pointer-events-none">
              <div class="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
              <div class="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
              <div class="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
              <div class="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
            </div>

            <!-- 8 Handles (Corners + Edges) -->
            <span
              v-for="h in cropHandles"
              :key="h.key"
              class="absolute w-2.5 h-2.5 bg-white border-2 border-primary rounded-[2px]"
              :class="[h.pos, h.cursor]"
              @mousedown.stop="onCropHandleMouseDown($event, h.key)"
            />
          </div>

          <!-- Crop Mode Floating Controls Banner -->
          <div
            class="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/95 border border-accented/80 shadow-2xl backdrop-blur-md select-none max-w-[95%] overflow-x-auto"
            @click.stop
          >
            <span class="text-[10px] font-semibold text-primary uppercase tracking-wider pl-1 shrink-0">
              {{ t('tmcut.crop.tool') }}
            </span>
            <div class="w-px h-3.5 bg-accented mx-1 shrink-0" />
            <UButton
              v-for="preset in cropRatioPresets"
              :key="preset.id"
              size="xs"
              :variant="activeCropRatio === preset.id ? 'solid' : 'ghost'"
              :color="activeCropRatio === preset.id ? 'primary' : 'neutral'"
              class="shrink-0 text-[10px] px-1.5 py-0.5"
              @click.stop="setCropRatioPreset(preset.id)"
            >
              {{ preset.label }}
            </UButton>
            <div class="w-px h-3.5 bg-accented mx-1 shrink-0" />
            <UButton
              icon="i-lucide-rotate-ccw"
              size="xs"
              variant="ghost"
              color="neutral"
              class="shrink-0"
              :aria-label="t('tmcut.crop.reset')"
              :title="t('tmcut.crop.reset')"
              @click.stop="resetCropRect"
            />
            <UButton
              icon="i-lucide-check"
              size="xs"
              variant="solid"
              color="primary"
              class="font-medium shrink-0"
              @click.stop="toggleCropEditing(false)"
            >
              {{ t('tmcut.crop.done') }}
            </UButton>
          </div>
        </template>

        <!-- Text Overlays (draggable in preview; anchor + style flags
             mirror the export math — roadmap C-2; whitespace-pre-line
             honors the same \\n line breaks drawtext renders) -->
        <div
          v-for="surface in activeTextSurfaces"
          :key="surface.clip.id"
          :ref="(el) => setTextEl(surface.clip.id, el)"
          class="absolute leading-tight whitespace-pre-line select-none cursor-move rounded"
          :class="surface.clip.id === selectedClipId
            ? 'ring-1 ring-primary/80'
            : 'hover:ring-1 hover:ring-primary/60'"
          :style="textOverlayStyle(surface)"
          data-canvas-hit
          @mousedown="onTextMouseDown($event, surface.clip)"
        >
          {{ surface.layer.text?.content }}

          <!-- Transform box for the SELECTED label (CapCut-style): corner
               handles scale the text (writes `scale`, the field the Inspector
               owns), the knob rotates it. Handles are counter-scaled so they
               stay legible at any text size. -->
          <template v-if="surface.clip.id === selectedClipId && !isCropActive">
            <span
              v-for="corner in selectionCorners"
              :key="corner.key"
              class="absolute w-2.5 h-2.5 bg-white border-2 border-primary rounded-[2px]"
              :class="corner.cursor"
              :style="{
                top: corner.key.startsWith('n') ? '0' : '100%',
                left: corner.key.endsWith('w') ? '0' : '100%',
                transform: `translate(-50%, -50%) scale(${textHandleInverse(surface.clip)})`
              }"
              @mousedown.stop="onTextResizeMouseDown($event, surface.clip)"
            />
            <div
              class="absolute left-1/2 w-px h-4 bg-primary/70 pointer-events-none"
              :style="{
                top: '0',
                transform: `translate(-50%, -100%) scale(${textHandleInverse(surface.clip)})`,
                transformOrigin: 'bottom center'
              }"
            />
            <span
              class="absolute left-1/2 w-3 h-3 rounded-full bg-white border-2 border-primary cursor-grab active:cursor-grabbing"
              :style="{
                top: '0',
                transform: `translate(-50%, -50%) translateY(-16px) scale(${textHandleInverse(surface.clip)})`
              }"
              :title="t('tmcut.player.rotateLabel')"
              @mousedown.stop="onTextRotateMouseDown($event, surface.clip)"
            />
          </template>
        </div>
      </div>
    </div><!-- /monitor stage (F-2) -->

    <!-- Scrub bar + Transport deck (design #2): pinned to the bottom of the
         viewport so resizing the monitor never pushes it off-screen. The deck
         sits on its own elevated surface instead of a 50% tint that vanished
         into the panel background in both themes. -->
    <div
      class="w-full shrink-0 mt-3 border border-default bg-white/80 px-3 py-2.5 shadow-sm dark:border-default dark:bg-default/80"
    >
      <!-- Mini scrub bar: click/drag to seek -->
      <div class="flex items-center gap-3 select-none">
        <span class="font-mono text-[11px] text-primary font-semibold w-20 shrink-0 tabular-nums">
          {{ formatTimecode(playhead, previewFps) }}
        </span>
        <!-- Scrubber (R154): taller high-contrast track + a visible handle.
             Click or drag anywhere on the strip to seek. -->
        <div
          class="relative flex-1 h-4 flex items-center select-none touch-none"
          :class="hasTimelineClips ? 'cursor-pointer' : 'cursor-not-allowed'"
          :title="t('tmcut.player.scrub')"
          @pointerdown="onScrubPointerDown"
          @pointermove="onScrubPointerMove"
        >
          <div ref="scrubTrackRef" class="absolute inset-x-0 h-1.5 rounded-full bg-accented" />
          <div
            class="absolute h-1.5 rounded-full bg-primary pointer-events-none"
            :style="{ width: scrubProgress + '%' }"
          />
          <div
            class="absolute w-3.5 h-3.5 rounded-full bg-primary ring-2 ring-white dark:ring-default shadow-md pointer-events-none"
            :style="{ left: 'calc(' + scrubProgress + '% - 7px)' }"
          />
        </div>
        <span
          class="font-mono text-[11px] text-muted w-20 shrink-0 text-right tabular-nums"
        >
          {{ formatTimecode(contentDuration, previewFps) }}
        </span>
      </div>

      <!-- Transport controls. `minmax(0, 1fr)` side tracks keep the play
           button dead-centre even when one cluster has a wider min-content. -->
      <div
        class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 mt-2.5 pt-2.5 border-t border-default/80"
      >
        <!-- Left: Loop, In/Out marks, jumps -->
        <div class="flex items-center gap-1 min-w-0">
          <UButton
            icon="i-lucide-repeat"
            size="xs"
            :variant="loopPlayback ? 'solid' : 'soft'"
            :color="loopPlayback ? 'primary' : 'neutral'"
            :disabled="!hasTimelineClips"
            :aria-label="t('tmcut.player.loop')"
            :title="t('tmcut.player.loop')"
            @click="loopPlayback = !loopPlayback"
          />
          <UButton
            size="xs"
            :variant="renderIn !== null ? 'solid' : 'soft'"
            :color="renderIn !== null ? 'primary' : 'neutral'"
            :disabled="!hasTimelineClips"
            :title="t('tmcut.player.markIn')"
            @click="setRenderMark('in')"
          >
            IN
          </UButton>
          <UButton
            size="xs"
            :variant="renderOut !== null ? 'solid' : 'soft'"
            :color="renderOut !== null ? 'primary' : 'neutral'"
            :disabled="!hasTimelineClips"
            :title="t('tmcut.player.markOut')"
            @click="setRenderMark('out')"
          >
            OUT
          </UButton>
          <div class="w-px h-4 shrink-0 bg-accented mx-0.5" />
          <UButton
            icon="i-lucide-skip-back"
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="!hasTimelineClips"
            :aria-label="t('tmcut.player.jumpToStart')"
            :title="t('tmcut.player.jumpToStart')"
            @click="seek(0)"
          />
          <UButton
            icon="i-lucide-chevron-left"
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="!hasTimelineClips"
            :aria-label="t('tmcut.player.stepBackward')"
            :title="t('tmcut.player.stepBackward')"
            @click="stepBackward(1)"
          />
        </div>

        <!-- Center: Play/Pause -->
        <UButton
          :icon="isPlaying ? 'i-lucide-pause' : 'i-lucide-play'"
          size="sm"
          color="primary"
          variant="solid"
          class="justify-self-center rounded-full w-9 h-9 p-0 flex items-center justify-center shadow-lg shadow-primary/20"
          :disabled="!hasTimelineClips"
          :aria-label="isPlaying ? t('tmcut.player.pause') : t('tmcut.player.play')"
          :title="isPlaying ? t('tmcut.player.pause') : t('tmcut.player.play')"
          @click="togglePlayPause"
        />

        <!-- Right: Steps, jumps & master volume -->
        <div class="flex items-center gap-1 justify-self-end min-w-0">
          <UButton
            icon="i-lucide-chevron-right"
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="!hasTimelineClips"
            :aria-label="t('tmcut.player.stepForward')"
            :title="t('tmcut.player.stepForward')"
            @click="stepForward(1)"
          />
          <UButton
            icon="i-lucide-skip-forward"
            size="xs"
            variant="soft"
            color="neutral"
            :disabled="!hasTimelineClips"
            :aria-label="t('tmcut.player.jumpToEnd')"
            :title="t('tmcut.player.jumpToEnd')"
            @click="seek(contentDuration)"
          />
          <div class="w-px h-4 shrink-0 bg-accented mx-0.5" />
          <UButton
            :icon="previewMuted || previewVolume === 0 ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
            size="xs"
            variant="soft"
            color="neutral"
            :aria-label="t('tmcut.player.mute')"
            :title="t('tmcut.player.mute')"
            @click="previewMuted = !previewMuted"
          />
          <!-- USlider instead of a native range: same track/thumb language as
               the rest of Nuxt UI, and it follows the theme in dark mode. -->
          <USlider
            :model-value="previewVolume"
            :min="0"
            :max="1"
            :step="0.05"
            size="xs"
            color="primary"
            class="w-20 shrink-0"
            :title="t('tmcut.player.volume')"
            :aria-label="t('tmcut.player.volume')"
            @update:model-value="onVolumeChange"
          />
          <!-- dB readout (mock transport): gain 1.0 = 0 dB, the slider is
               a linear 0..1 gain so dB = 20·log10(v); silence shows -∞. -->
          <span
            class="font-mono text-[10px] text-muted w-11 text-right shrink-0 tabular-nums"
          >
            {{ previewVolume <= 0 ? '-\u221E dB' : `${(20 * Math.log10(previewVolume)).toFixed(1)} dB` }} </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Element fullscreen: the monitor keeps inline pixel sizes from
   monitorBoxStyle, and author !important beats inline styles, so the
   frame can expand to the full screen without a re-measure. */
.tmcut-monitor:fullscreen {
  width: 100vw !important;
  height: 100vh !important;
  border-radius: 0 !important;
  border: none !important;
}
</style>
