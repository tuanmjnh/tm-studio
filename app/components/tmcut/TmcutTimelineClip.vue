<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import type { TmcutTimelineItem } from '~/composables/useTmcutProject'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { useTmcutUiPrefs } from '~/composables/useTmcutUiPrefs'
import { useTmcutFrames } from '~/composables/useTmcutFrames'
import { useI18n } from 'vue-i18n'
import { propsWithKeyframes, keyframeTimes, secToTicks, ticksToSec, KNOWN_TRANSITIONS, TICKS_PER_SECOND } from '@tmcut-core'
import { clipDurationSec, clipStartSec, clipEndSec, clipEndTicks } from '~/utils/tmcut/clipTime'
import { useTmcutContextMenu } from '~/composables/useTmcutContextMenu'

const props = withDefaults(defineProps<{
  trackType: 'video' | 'text' | 'audio'
  clip: TmcutTimelineItem
  locked?: boolean
}>(), {
  locked: false
})

const { t } = useI18n()
const { selectedClipId, selectClip, updateClip, pushHistory, snapTimeSec, relatedOffsetsFor, checkClipTransition, applyClipTransition, clearClipTransition, saveProject, gesturePreview, setGesturePreview, clearGesturePreview, currentProject, clipboard, splitClip, removeClip, copySelectedClips, pasteClipboardAt, duplicateSelectedClips, rippleDeleteSelected, toggleTrackLock } = useTmcutProject()
const { zoom, playhead } = useTmcutPlayback()
const { findAssetBySrc, loadWaveform, mediaUrl, isDesktop } = useTmcutMedia()
const { snapOn } = useTmcutUiPrefs()
const { available: canExtractFrames, clipFilmstrip } = useTmcutFrames()

const isSelected = computed(() => selectedClipId.value === props.clip.id)

// Live gesture geometry (R124): while a pointer gesture runs, the moving
// values live in the shared gesturePreview map instead of the store, so
// only clip layers repaint — no deep watchers, no localStorage, no
// per-frame media seeks. Geometry computeds read through the patch;
// every other consumer still sees the committed clip.
const liveClip = computed<TmcutTimelineItem>(() => {
  const patch = gesturePreview.value[props.clip.id]
  return patch ? { ...props.clip, ...patch } : props.clip
})

const duration = computed(() => Math.max(0.1, clipDurationSec(liveClip.value)))
const clipLeft = computed(() => clipStartSec(liveClip.value) * zoom.value)
const clipWidth = computed(() => Math.max(20, duration.value * zoom.value))

// Keyframe diamonds (Roadmap B1): unique keyframe times across every
// animated prop, as a percentage of the clip duration (times are
// clip-local ticks). Nothing renders when the clip has no keyframes —
// no empty layer. Desktop export renders them (keyframeExpr chains);
// the web build has no FFmpeg, so web export stays preview-only.
const keyframePercents = computed<number[]>(() => {
  if (!props.clip.keyframes?.length) return []
  const seen = new Set<number>()
  for (const prop of propsWithKeyframes(props.clip)) {
    for (const t of keyframeTimes(props.clip, prop)) seen.add(t)
  }
  return [...seen]
    .sort((a, b) => a - b)
    .map(t => Math.min(100, Math.max(0, (t / TICKS_PER_SECOND) / duration.value * 100)))
})

// Track color styling
const trackStyles = computed(() => {
  switch (props.trackType) {
    case 'video':
      return {
        bg: 'bg-blue-600/20 border-blue-500/60 text-blue-200 hover:bg-blue-600/30',
        activeBg: 'bg-blue-600/40 border-blue-400 ring-2 ring-blue-400',
        handle: 'bg-blue-400',
        icon: 'i-lucide-film'
      }
    case 'text':
      return {
        bg: 'bg-amber-600/20 border-amber-500/60 text-amber-200 hover:bg-amber-600/30',
        activeBg: 'bg-amber-600/40 border-amber-400 ring-2 ring-amber-400',
        handle: 'bg-amber-400',
        icon: 'i-lucide-type'
      }
    case 'audio':
      return {
        bg: 'bg-emerald-600/20 border-emerald-500/60 text-emerald-200 hover:bg-emerald-600/30',
        activeBg: 'bg-emerald-600/40 border-emerald-400 ring-2 ring-emerald-400',
        handle: 'bg-emerald-400',
        icon: 'i-lucide-music'
      }
    default:
      return {
        bg: 'bg-neutral-300/20 dark:bg-neutral-600/20 border-neutral-500/60 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300/30 dark:hover:bg-neutral-600/30',
        activeBg: 'bg-neutral-300/40 dark:bg-neutral-600/40 border-neutral-400 ring-2 ring-neutral-400',
        handle: 'bg-neutral-400',
        icon: 'i-lucide-film'
      }
  }
})

// Video filmstrip: the cached strip (8 frames spread evenly
// across the whole source, extracted once at import via the
// tmcut IPC) is aligned to source time so each clip window
// shows its own [in, out] slice instead of one repeated
// frame, CapCut-style. The strip width maps the full source
// duration to timeline pixels at the current zoom, so the
// background offset equals the clip's source position.
// Assets without a dedicated filmstrip (web session
// thumbs, legacy records) reuse their cover still.
const filmstripStyle = computed(() => {
  if (props.trackType !== 'video' || !props.clip.src) return {}
  const asset = findAssetBySrc(props.clip.src)
  const strip = asset?.filmstripPath || asset?.thumbPath
  if (!strip) return {}
  const duration = asset.meta.durationSec || 0
  if (duration <= 0) {
    // No duration probed (web session assets): tile the still.
    return {
      backgroundImage: `url('${mediaUrl(strip)}')`,
      backgroundRepeat: 'repeat-x',
      backgroundSize: 'auto 100%',
      backgroundPosition: 'left center'
    }
  }
  const stripWidth = Math.max(1, Math.round(duration * zoom.value))
  const offset = Math.round(ticksToSec(props.clip.in || 0) * zoom.value)
  return {
    backgroundImage: `url('${mediaUrl(strip)}')`,
    backgroundRepeat: 'no-repeat',
    backgroundSize: `${stripWidth}px 100%`,
    backgroundPosition: `-${offset}px center`
  }
})

// Per-clip filmstrip (roadmap G-1/R42): 8 frames sampled from THIS
// clip's own [in, out] source range (core C14 filmstripTimes through
// useTmcutFrames), drawn over the asset-level strip background above.
// Trims debounce 300ms so dragging never floods the frame cache, and
// stale resolutions drop via a request id. Failed slots stay empty so
// the asset-level fallback shows through; web sessions keep the
// fallback entirely (no extraction IPC there).
const STRIP_COUNT = 8
const stripFrames = ref<string[]>([])
let stripRequest = 0
let stripTimer: ReturnType<typeof setTimeout> | null = null

async function refreshClipStrip() {
  const request = ++stripRequest
  if (props.trackType !== 'video' || !props.clip.src || !canExtractFrames.value) {
    stripFrames.value = []
    return
  }
  // clipFilmstrip extracts at SECONDS — decode the ticks range.
  const frames = await clipFilmstrip(props.clip.src, ticksToSec(props.clip.in || 0), ticksToSec(props.clip.out), STRIP_COUNT)
  if (request !== stripRequest) return // superseded by a newer src/range
  stripFrames.value = frames
}

function scheduleClipStrip() {
  if (stripTimer) clearTimeout(stripTimer)
  stripTimer = setTimeout(() => {
    stripTimer = null
    void refreshClipStrip()
  }, 300)
}

watch(() => props.clip.src, () => {
  stripFrames.value = []
  scheduleClipStrip()
}, { immediate: true })
watch(() => [props.clip.in, props.clip.out], scheduleClipStrip, { immediate: true })
onUnmounted(() => {
  if (stripTimer) clearTimeout(stripTimer)
  stripTimer = null
  stripRequest += 1
})

// Audio waveform bars rendered inside the clip body.
const wavePoints = ref<number[]>([])
async function refreshWaveform() {
  wavePoints.value = []
  if (props.trackType !== 'audio' || !props.clip.src) return
  const asset = findAssetBySrc(props.clip.src)
  if (!asset?.waveformPath) return
  wavePoints.value = await loadWaveform(asset)
}
onMounted(() => {
  void refreshWaveform()
})
watch(() => props.clip.src, () => {
  void refreshWaveform()
})

// Magnetic snap (Roadmap C1/A6): delegates to the core engine through
// snapTimeSec — candidates are 0, the playhead, every other clip edge
// and markers, within an 8px radius at the current zoom. Controlled by
// the Magnet toolbar toggle / N key (snapOn in useTmcutUiPrefs).
// C16-R3/R124: drag math runs in STORE TICKS end to end; the seconds seam
// sits here (snapTimeSec speaks seconds) and px converts through zoom
// (px per second). NOTE: secToTicks() clamps negatives to 0 (it converts
// absolute times), so pointer DELTAS must be converted directly — the old
// secToTicks(px/zoom) swallowed every leftward drag into 0, which is what
// made "trim/drag left" do nothing (R124 field report).
function pxToTicks(px: number): number {
  return Math.round((px / zoom.value) * TICKS_PER_SECOND)
}

function applySnapTicks(targetTicks: number): number {
  if (!snapOn.value) return Math.max(0, Math.round(targetTicks))
  const thresholdSec = 8 / zoom.value // 8px magnetic radius
  const snapped = snapTimeSec(ticksToSec(targetTicks), playhead.value, {
    ignoreIds: [props.clip.id],
    thresholdSec
  })
  return Math.max(0, Math.round(secToTicks(snapped)))
}

// Trim floor: a source range never shrinks below 0.2s (store unit).
const MIN_SOURCE_TICKS = Math.round(0.2 * TICKS_PER_SECOND)

// Pointer-captured gesture plumbing (R124). This is the "triệt để" fix
// for drag/trim being laggy and "sometimes working":
//  - setPointerCapture keeps move/up events coming to the handle even
//    when the pointer leaves the element or the button is released
//    outside the window. The old window-listener shape lost mouseup,
//    leaving a STALE listener whose closed-over initial values wrote to
//    the clip during the NEXT gesture — the classic "trim jumps to a
//    random spot / does nothing" symptom.
//  - computePatch only paints the shared gesturePreview map (cheap,
//    clip layers only). The store is written exactly ONCE on release,
//    right before the single saveProject — never per frame.
//  - pushHistory runs on genuine movement only, so a click no longer
//    pollutes the undo stack, and a gesture with no movement commits
//    nothing.
type GesturePatch = Record<string, Partial<TmcutTimelineItem>>

// One gesture at a time, app-wide. A stray pointerdown while another
// clip's gesture is still running (lost pointerup) would otherwise leave
// two handlers painting the shared map.
let gestureInFlight = false

function startClipGesture(
  e: PointerEvent,
  computePatch: (pe: PointerEvent) => GesturePatch,
  options: { onFirstMove?: () => void } = {}
) {
  const target = e.currentTarget as HTMLElement
  if (!target || !('setPointerCapture' in target) || gestureInFlight) return
  try {
    target.setPointerCapture(e.pointerId)
  } catch {
    return
  }
  gestureInFlight = true
  let moved = false
  let done = false
  let last: GesturePatch = computePatch(e)
  const move = (pe: PointerEvent) => {
    if (!moved) {
      moved = true
      options.onFirstMove?.()
    }
    last = computePatch(pe)
    setGesturePreview(last)
  }
  const end = () => {
    if (done) return
    done = true
    gestureInFlight = false
    target.removeEventListener('pointermove', move)
    target.removeEventListener('pointerup', end)
    target.removeEventListener('pointercancel', end)
    clearGesturePreview()
    if (!moved) return
    for (const [id, patch] of Object.entries(last)) {
      updateClip(id, patch, false)
    }
    saveProject()
  }
  target.addEventListener('pointermove', move)
  target.addEventListener('pointerup', end)
  target.addEventListener('pointercancel', end)
}

// Drag to move clip along timeline
function onDragStart(e: PointerEvent) {
  if (e.button !== 0) return // Left click only
  selectClip(props.clip.id)
  if (props.locked) return // Locked track: select only, no move

  // Grouped/linked relatives travel with the drag (roadmap B4): their
  // offsets are captured now and shifted by the same adjusted delta.
  const relatives = relatedOffsetsFor(props.clip.id)
  const startX = e.clientX
  const initialOffset = props.clip.offset || 0

  startClipGesture(e, (pe) => {
    const deltaTicks = pxToTicks(pe.clientX - startX)
    const newOffset = applySnapTicks(Math.max(0, initialOffset + deltaTicks))
    const moved = newOffset - initialOffset
    const patch: GesturePatch = { [props.clip.id]: { offset: newOffset } }
    for (const [id, base] of Object.entries(relatives)) {
      patch[id] = { offset: Math.max(0, base + moved) }
    }
    return patch
  }, { onFirstMove: pushHistory })
}

// Left handle: trim 'in' point & offset
function onTrimLeftStart(e: PointerEvent) {
  e.stopPropagation()
  e.preventDefault()
  selectClip(props.clip.id)
  if (props.locked) return

  const startX = e.clientX
  const initialIn = props.clip.in
  const initialOffset = props.clip.offset || 0
  const speed = props.clip.speed || 1
  const out = props.clip.out

  startClipGesture(e, (pe) => {
    const deltaTicks = pxToTicks(pe.clientX - startX)

    // Sliding trim: the left edge ALWAYS follows the pointer. While the
    // source in-point has room it is consumed first (normal trim); once
    // `in` is clamped at 0 the remainder slides the whole clip left
    // (CapCut behavior). The old math derived the offset from the
    // (clamped) in-delta, so dragging left from in=0 did nothing —
    // that was the R122 "sometimes left trim doesn't work" report.
    let newOffset = Math.max(0, initialOffset + deltaTicks)
    if (snapOn.value) {
      newOffset = applySnapTicks(newOffset)
    }
    let newIn = Math.round(initialIn + (newOffset - initialOffset) * speed)
    newIn = Math.max(0, Math.min(out - MIN_SOURCE_TICKS, newIn))
    return { [props.clip.id]: { offset: newOffset, in: newIn } }
  }, { onFirstMove: pushHistory })
}

// Right handle: trim 'out' point
function onTrimRightStart(e: PointerEvent) {
  e.stopPropagation()
  e.preventDefault()
  selectClip(props.clip.id)
  if (props.locked) return

  const startX = e.clientX
  const initialOut = props.clip.out
  const speed = props.clip.speed || 1
  const initialEnd = clipEndTicks(props.clip)
  const inTick = props.clip.in
  const offset = props.clip.offset || 0

  startClipGesture(e, (pe) => {
    const deltaTicks = pxToTicks(pe.clientX - startX)
    const deltaSourceTicks = deltaTicks * speed

    let newOut = Math.max(inTick + MIN_SOURCE_TICKS, initialOut + deltaSourceTicks)
    if (snapOn.value) {
      // Snap the moving right edge (timeline end) to nearby candidates.
      const newEnd = applySnapTicks(Math.max(0, initialEnd + deltaTicks))
      newOut = Math.max(
        inTick + MIN_SOURCE_TICKS,
        Math.round(inTick + (newEnd - offset) * speed)
      )
    }
    return { [props.clip.id]: { out: Math.round(newOut) } }
  }, { onFirstMove: pushHistory })
}

// ===== Right-click clip menu =====
// One menu for every clip type: the editing actions every clip shares
// (split / copy / duplicate / paste / delete / ripple / track lock) plus the
// transition section, which stays video-only — the preview crossfades VIDEO
// layers and offering it elsewhere would be a dead control.
const DEFAULT_TRANSITION_SEC = 0.5
const DURATION_PRESETS = [0.2, 0.5, 1, 2]

const {
  open: menuOpen,
  ready: menuReady,
  pos: menuPos,
  el: menuEl,
  openAt: openMenuAt,
  close: closeMenu
} = useTmcutContextMenu()

// Pending selections — seeded from the clip's current transition on open.
const menuType = ref<string>(KNOWN_TRANSITIONS[0] ?? 'fade')
const menuDuration = ref(DEFAULT_TRANSITION_SEC)

const hasTransition = computed(() => (props.clip.transitionIn?.duration ?? 0) > 0)

// Menu header identity: text clips read their own line, media clips their
// name (a raw src path is unreadable in a 240px panel).
const clipMenuLabel = computed(() => {
  const raw = props.trackType === 'text'
    ? (props.clip.text || props.clip.name)
    : (props.clip.name || props.clip.src?.split(/[\\/]/).pop())
  return raw?.trim() || '—'
})

const clipMenuDuration = computed(() => `${clipDurationSec(props.clip).toFixed(1)}s`)

// Applied-state label in the menu header (truthful: what is saved).
const appliedLabel = computed(() => {
  const ti = props.clip.transitionIn
  if (!ti || !(ti.duration > 0)) return t('tmcut.clipMenu.none')
  const sec = Number(ticksToSec(ti.duration).toFixed(2))
  return `${t(`tmcut.clipMenu.types.${ti.type}`)} · ${sec}s`
})

// Live validation against the CURRENT menu selections — re-runs whenever
// the timeline changes (reactive through useTmcutProject).
function reasonFor(type: string, durSec: number): string | null {
  const check = checkClipTransition(props.clip.id, type, durSec)
  return check.ok ? null : (check.reason ?? 'no-neighbor')
}

const menuReason = computed<string | null>(() =>
  menuOpen.value ? reasonFor(menuType.value, menuDuration.value) : null)

function titleFor(type: string, durSec: number): string | undefined {
  const reason = reasonFor(type, durSec)
  return reason ? t(`tmcut.clipMenu.reason.${reason}`) : undefined
}

function pickType(type: string) {
  if (props.locked) return
  menuType.value = type
  // On refusal nothing changes — menuReason below explains why.
  applyClipTransition(props.clip.id, type, menuDuration.value)
}

function pickDuration(durSec: number) {
  if (props.locked) return
  menuDuration.value = durSec
  applyClipTransition(props.clip.id, menuType.value, durSec)
}

function clearTransitionPick() {
  if (props.locked) return
  clearClipTransition(props.clip.id)
}

function onClipContextMenu(e: MouseEvent) {
  // Select on right-click, then open the clip menu for EVERY clip type —
  // text/audio/locked clips used to swallow the event and show nothing.
  e.stopPropagation()
  selectClip(props.clip.id)
  if (props.trackType === 'video') {
    menuType.value = props.clip.transitionIn?.type ?? KNOWN_TRANSITIONS[0] ?? 'fade'
    menuDuration.value = props.clip.transitionIn
      ? ticksToSec(props.clip.transitionIn.duration)
      : DEFAULT_TRANSITION_SEC
  }
  openMenuAt(e)
}

// ---- Shared clip actions (same store calls the toolbar and hotkeys use) ----
const toast = useToast()
const canPaste = computed(() => (clipboard.value?.clips?.length ?? 0) > 0)

// Split needs the playhead strictly inside the clip with a 0.1s margin —
// the same rule splitClip enforces, surfaced here so the row can be disabled
// instead of silently doing nothing.
const canSplitHere = computed(() => {
  const at = playhead.value
  return at > clipStartSec(props.clip) + 0.1 && at < clipEndSec(props.clip) - 0.1
})

function runSplit() {
  if (!canSplitHere.value) return
  splitClip(props.clip.id, playhead.value)
  closeMenu()
}

function runCopy() {
  if (copySelectedClips()) toast.add({ title: t('tmcut.timelineActions.copied'), color: 'success' })
  closeMenu()
}

function runDuplicate() {
  if (duplicateSelectedClips().length > 0) {
    toast.add({ title: t('tmcut.timelineActions.duplicated'), color: 'success' })
  }
  closeMenu()
}

function runPaste() {
  if (pasteClipboardAt(playhead.value).length > 0) {
    toast.add({ title: t('tmcut.timelineActions.pasted'), color: 'success' })
  }
  closeMenu()
}

function runDelete() {
  removeClip(props.clip.id)
  closeMenu()
}

function runRippleDelete() {
  if (rippleDeleteSelected()) toast.add({ title: t('tmcut.timelineActions.clipDeleted'), color: 'success' })
  closeMenu()
}

// Lock lives on the TRACK (clips inherit it), so the menu resolves the
// owning track by clip id — the item carries no trackId of its own.
const owningTrack = computed(() =>
  currentProject.value?.timeline?.tracks?.find(track => track.items?.some(i => i.id === props.clip.id)) ?? null)

function runToggleLock() {
  if (owningTrack.value) toggleTrackLock(owningTrack.value.id)
  closeMenu()
}
</script>

<template>
  <div
    class="absolute top-1 bottom-1 rounded border cursor-move select-none flex items-center overflow-hidden transition-shadow text-xs group"
    data-tmcut-clip
    :class="[
      isSelected ? trackStyles.activeBg : trackStyles.bg,
      'border',
      locked ? 'cursor-not-allowed opacity-70' : ''
    ]"
    :style="{
      left: `${clipLeft}px`,
      width: `${clipWidth}px`,
      ...filmstripStyle
    }"
    @pointerdown="onDragStart"
    @contextmenu="onClipContextMenu"
  >
    <!-- Left Trim Handle (z-20: must win over the right handle when a
         narrow clip's handles overlap — that overlap is what made left
         trimming "sometimes not work". Visible whenever selected so the
         user can always find it, hover otherwise.) -->
    <div
      class="absolute left-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/40 flex items-center justify-center transition-opacity z-20"
      :class="[trackStyles.handle, isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
      @pointerdown="onTrimLeftStart"
    >
      <div class="w-0.5 h-3 bg-black/60 rounded" />
    </div>

    <!-- Per-clip filmstrip layer (roadmap G-1/R42): frames from this
         clip's own source range, over the asset-level strip behind.
         Empty slots stay transparent so the fallback shows through. -->
    <div v-if="trackType === 'video' && stripFrames.length > 0" class="absolute inset-0 flex pointer-events-none">
      <template v-for="(frame, index) in stripFrames" :key="index">
        <img
          v-if="frame"
          :src="mediaUrl(frame)"
          class="h-full flex-1 min-w-0 object-cover"
          draggable="false"
          alt=""
        >
        <div v-else class="h-full flex-1 min-w-0" />
      </template>
    </div>

    <!-- Clip Content Body (z-[1]: above the strip layers, below the
         keyframe diamonds z-5 and trim handles z-10) -->
    <div class="relative z-1 flex-1 px-2.5 flex items-center gap-1.5 min-w-0 overflow-hidden pointer-events-none">
      <UIcon :name="trackStyles.icon" class="size-3.5 shrink-0 opacity-80" />
      <span class="truncate font-medium text-[11px] leading-tight">
        {{ clip.text || clip.name || 'Clip' }}
      </span>
      <span
        v-if="clip.stabilize && clip.stabilizedPath"
        class="px-1 py-0.2 rounded text-[8px] font-semibold bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 shrink-0 uppercase tracking-wider"
        title="Stabilized"
      >
        STAB
      </span>
      <span class="ml-auto text-[9px] font-mono opacity-60 shrink-0">
        {{ duration.toFixed(1) }}s
      </span>
    </div>

    <!-- Audio waveform layer (behind content, CapCut-style) -->
    <div
      v-if="trackType === 'audio' && wavePoints.length > 0"
      class="absolute inset-0 flex items-center justify-center opacity-50 pointer-events-none px-1"
    >
      <TmcutWaveform
        :points="wavePoints"
        :width="Math.max(20, Math.floor(clipWidth) - 4)"
        :height="36"
        color="#6ee7b7"
      />
    </div>

    <!-- Keyframe diamonds (Roadmap B1): one per unique keyframe time -->
    <span
      v-for="(pct, i) in keyframePercents"
      :key="`kf-${i}`"
      class="absolute top-1/2 w-1.5 h-1.5 -translate-y-1/2 bg-white/90 rotate-45 z-5 pointer-events-none"
      :style="{ left: `calc(${pct}% - 3px)` }"
    />

    <!-- Right Trim Handle (z-10: intentionally below the left handle so
         the left edge stays grabbable on narrow clips.) -->
    <div
      class="absolute right-0 top-0 bottom-0 w-3 cursor-ew-resize hover:bg-white/40 flex items-center justify-center transition-opacity z-10"
      :class="[trackStyles.handle, isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100']"
      @pointerdown="onTrimRightStart"
    >
      <div class="w-0.5 h-3 bg-black/60 rounded" />
    </div>
  </div>

  <!-- Right-click clip menu: shared editing actions plus the video-only
       transition section. Teleported to the body and measured after mount
       (useTmcutContextMenu) so the timeline's overflow can never clip it and
       a panel opened near the bottom edge flips up instead of running off
       the screen — the old fixed 250px guess left ~500px unreachable. -->
  <Teleport to="body">
    <div
      v-if="menuOpen"
      ref="menuEl"
      data-tmcut-clip-menu
      class="fixed z-[120] w-60 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-neutral-400 bg-neutral-100/95 p-1.5 text-xs text-neutral-700 shadow-2xl backdrop-blur-sm select-none dark:border-neutral-700 dark:bg-neutral-900/95 dark:text-neutral-200"
      :class="menuReady ? 'opacity-100' : 'opacity-0'"
      :style="{ left: `${menuPos.x}px`, top: `${menuPos.y}px` }"
      @contextmenu.prevent
    >
      <div class="flex items-center justify-between gap-2 px-1.5 pb-1">
        <span class="min-w-0 truncate text-[11px] font-semibold">{{ clipMenuLabel }}</span>
        <span class="shrink-0 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">{{ clipMenuDuration }}</span>
      </div>

      <div class="flex flex-col gap-0.5">
        <UButton
          icon="i-lucide-scissors"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          :disabled="locked || !canSplitHere"
          data-menu-action="split"
          @click="runSplit"
        >
          {{ t('tmcut.clipMenu.actions.split') }}
          <span class="ml-auto font-mono text-[10px] text-neutral-500">S</span>
        </UButton>
        <UButton
          icon="i-lucide-copy"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          :disabled="locked"
          data-menu-action="copy"
          @click="runCopy"
        >
          {{ t('tmcut.clipMenu.actions.copy') }}
          <span class="ml-auto font-mono text-[10px] text-neutral-500">Ctrl+C</span>
        </UButton>
        <UButton
          icon="i-lucide-files"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          :disabled="locked"
          data-menu-action="duplicate"
          @click="runDuplicate"
        >
          {{ t('tmcut.clipMenu.actions.duplicate') }}
          <span class="ml-auto font-mono text-[10px] text-neutral-500">Ctrl+D</span>
        </UButton>
        <UButton
          icon="i-lucide-clipboard-paste"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          :disabled="locked || !canPaste"
          data-menu-action="paste"
          @click="runPaste"
        >
          {{ t('tmcut.clipMenu.actions.paste') }}
          <span class="ml-auto font-mono text-[10px] text-neutral-500">Ctrl+V</span>
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          :disabled="locked"
          data-menu-action="delete"
          @click="runDelete"
        >
          {{ t('tmcut.clipMenu.actions.delete') }}
          <span class="ml-auto font-mono text-[10px] text-neutral-500">Del</span>
        </UButton>
        <UButton
          icon="i-lucide-arrow-left-to-line"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          :disabled="locked"
          data-menu-action="ripple-delete"
          @click="runRippleDelete"
        >
          {{ t('tmcut.clipMenu.actions.ripple') }}
        </UButton>
      </div>

      <!-- Track section: clips inherit their track's lock, so this is the
           one place to release a locked clip without hunting the track head. -->
      <div class="mt-1 border-t border-neutral-300/80 pt-1 dark:border-neutral-700/80">
        <UButton
          :icon="locked ? 'i-lucide-lock-open' : 'i-lucide-lock'"
          variant="ghost"
          color="neutral"
          size="xs"
          block
          class="justify-start gap-2"
          data-menu-action="toggle-lock"
          @click="runToggleLock"
        >
          {{ locked ? t('tmcut.clipMenu.unlockTrack') : t('tmcut.clipMenu.lockTrack') }}
        </UButton>
        <p v-if="locked" class="px-1.5 pt-1 text-[10px] leading-tight text-amber-400">
          {{ t('tmcut.clipMenu.lockedHint') }}
        </p>
      </div>

      <!-- Transition section (video only): type + duration presets, live
           validated via core C5. The type grid scrolls inside a capped box so
           the whole panel stays inside the viewport. -->
      <template v-if="trackType === 'video'">
        <div class="mt-1 border-t border-neutral-300/80 pt-1 dark:border-neutral-700/80">
          <div class="flex items-center justify-between gap-2 px-1 pb-1">
            <span class="text-[10px] font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
              {{ t('tmcut.clipMenu.transition') }}
            </span>
            <span class="truncate font-mono text-[10px] text-neutral-500">{{ appliedLabel }}</span>
          </div>

          <div class="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto pr-0.5">
            <button
              v-for="type in KNOWN_TRANSITIONS"
              :key="type"
              type="button"
              class="rounded border px-1 py-1.5 text-[10px] leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :class="clip.transitionIn?.type === type
                ? 'bg-primary/30 border-primary/60 text-primary-100'
                : 'bg-neutral-200/70 dark:bg-neutral-800/70 border-neutral-400 dark:border-neutral-700 hover:bg-neutral-300/70 dark:hover:bg-neutral-700/70 text-neutral-600 dark:text-neutral-300'"
              :disabled="locked || !!reasonFor(type, menuDuration)"
              :title="titleFor(type, menuDuration)"
              @click="pickType(type)"
            >
              {{ t(`tmcut.clipMenu.types.${type}`) }}
            </button>
          </div>

          <div class="mt-1.5 px-1 text-[10px] tracking-wide text-neutral-500 uppercase">
            {{ t('tmcut.clipMenu.duration') }}
          </div>
          <div class="mt-1 grid grid-cols-4 gap-1">
            <button
              v-for="d in DURATION_PRESETS"
              :key="d"
              type="button"
              class="rounded border px-1 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              :class="Math.abs((ticksToSec(clip.transitionIn?.duration ?? 0)) - d) < 0.001
                ? 'bg-primary/30 border-primary/60 text-primary-100'
                : 'bg-neutral-200/70 dark:bg-neutral-800/70 border-neutral-400 dark:border-neutral-700 hover:bg-neutral-300/70 dark:hover:bg-neutral-700/70 text-neutral-600 dark:text-neutral-300'"
              :disabled="locked || !!reasonFor(menuType, d)"
              :title="titleFor(menuType, d)"
              @click="pickDuration(d)"
            >
              {{ d }}s
            </button>
          </div>

          <div class="mt-1.5 flex items-center justify-between gap-2">
            <button
              type="button"
              class="rounded border border-neutral-400 px-2 py-1 text-[10px] text-neutral-600 transition-colors hover:bg-neutral-300/70 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-700/70"
              :disabled="locked || !hasTransition"
              @click="clearTransitionPick"
            >
              {{ t('tmcut.clipMenu.none') }}
            </button>
            <span v-if="!isDesktop" class="text-right text-[9px] leading-tight text-neutral-500">
              {{ t('tmcut.clipMenu.previewOnly') }}
            </span>
          </div>

          <p
            v-if="menuReason"
            class="mt-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[10px] text-amber-300"
          >
            {{ t(`tmcut.clipMenu.reason.${menuReason}`) }}
          </p>
        </div>
      </template>
    </div>
  </Teleport>
</template>
