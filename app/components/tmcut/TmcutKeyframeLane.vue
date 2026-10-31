<script setup lang="ts">
/**
 * R124 A2 — Keyframe animation lane (CapCut §5.5).
 *
 * A fixed strip between the timeline toolbar and the track rows that shows
 * the interpolation CURVE of the selected clip's active keyframe property.
 * The track rows themselves stay h-14 (pixel-aligned with the headers), so
 * the lane is a SEPARATE band — expanding a row would desync the two
 * scroll containers (R124 header-alignment lesson).
 *
 * Editing model (mirrors the inspector's keyframe toggles, core C3):
 *  - property picker: opacity / scale / x / y / volume (the same KfProp set
 *    the inspector animates — nothing new in the data model)
 *  - "keyframe at playhead": adds/removes a keyframe at the clip-local
 *    playhead tick; the stored value is the CURRENT evaluated value (the
 *    inspector's kfCurrentValue semantics), so a keyframe pins what the
 *    user sees at the playhead
 *  - easing select: applied to the segment leaving the active keyframe
 *  - click the lane to seek the playhead (the lane is a time ruler first)
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import {
  evalKeyframe,
  keyframeAt,
  keyframeTimes,
  setKeyframe,
  removeKeyframe,
  propsWithKeyframes,
  TICKS_PER_SECOND,
  secToTicks,
  KEYFRAME_EASINGS
} from '@tmcut-core'
import type { TmcutTimelineItem } from '~/composables/useTmcutProject'
import { clipDurationSec, clipStartSec } from '~/utils/tmcut/clipTime'

type KfProp = 'opacity' | 'scale' | 'x' | 'y' | 'volume'

const { t } = useI18n()
const { selectedClip, updateClip, pushHistory } = useTmcutProject()
const { playhead, seek } = useTmcutPlayback()

const clip = computed<TmcutTimelineItem | null>(() => selectedClip.value?.item ?? null)
const trackType = computed(() => selectedClip.value?.track ?? 'video')

// Every property this clip CAN animate (audio clips: volume/scale only
// make sense as the store allows them — the inspector's KfProp set is the
// single source of truth; text/audio skip x/y/opacity where irrelevant).
const availableProps = computed<KfProp[]>(() => {
  if (trackType.value === 'audio') return ['volume']
  if (trackType.value === 'text') return ['opacity', 'scale', 'x', 'y']
  return ['opacity', 'scale', 'x', 'y', 'volume']
})

const activeProp = ref<KfProp>('opacity')
// Follow the selection: when the user selects a different clip, default
// the property to whatever that clip animates (first stored keyframe
// property wins — the curve the user was most recently looking at).
watch(clip, (c) => {
  if (!c) return
  const stored = propsWithKeyframes(c)
  const first = stored.find(p => availableProps.value.includes(p as KfProp))
  activeProp.value = (first as KfProp) || availableProps.value[0]!
})

const duration = computed(() => (clip.value ? Math.max(0.1, clipDurationSec(clip.value)) : 1))

// Clip-local playhead tick (the inspector's localTicks math).
const localTicks = computed(() => clip.value
  ? Math.round(secToTicks(playhead.value) - (clip.value.offset || 0))
  : 0)

// Base (non-keyframed) value per property — the same fallbacks the
// inspector's kfCurrentValue uses, so "pin at playhead" stores what the
// preview shows.
function baseValue(prop: KfProp): number {
  const c = clip.value
  if (!c) return 0
  if (prop === 'volume') return c.volume ?? 100
  // opacity/scale/x/y are required numbers STORED per clip; volume is the
  // only optional one, so it is the lone `??`.
  if (prop === 'opacity') return c.opacity
  if (prop === 'scale') return c.scale
  if (prop === 'x') return c.x
  return c.y
}

function currentValue(prop: KfProp): number {
  const ev = evalKeyframe(clip.value, prop, localTicks.value)
  return typeof ev === 'number' ? ev : baseValue(prop)
}

const hasKeyframes = computed(() => kfTimes.value.length > 0)

const clipHasAnyKf = computed(() => !!clip.value && propsWithKeyframes(clip.value).length > 0)

const kfTimes = computed<number[]>(() => (clip.value ? keyframeTimes(clip.value, activeProp.value) : []))

// The keyframe nearest the playhead (the easing select edits ITS
// outgoing segment) — null when the prop has no keyframes.
const activeKf = computed(() => {
  const times = kfTimes.value
  if (!times.length) return null
  let best = times[0]!
  let bestDist = Infinity
  for (const t of times) {
    const d = Math.abs(t - localTicks.value)
    if (d < bestDist) {
      bestDist = d
      best = t
    }
  }
  return keyframeAt(clip.value!, activeProp.value, best)
})

// ---- Curve geometry ------------------------------------------------------
const W = 640
const H = 72
const PAD = 6
const SAMPLES = 64

interface CurvePoint { x: number, y: number }

function valueRange(prop: KfProp): [number, number] {
  if (prop === 'opacity' || prop === 'scale' || prop === 'volume') return [0, 150]
  // x / y are canvas-relative: ±40% of the canvas reads naturally.
  return [-40, 40]
}

const curvePoints = computed<CurvePoint[]>(() => {
  const c = clip.value
  if (!c) return []
  const durTicks = Math.max(1, Math.round(duration.value * TICKS_PER_SECOND))
  const [lo, hi] = valueRange(activeProp.value)
  const span = Math.max(1, hi - lo)
  const pts: CurvePoint[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const at = (i / SAMPLES) * durTicks
    const v = evalKeyframe(c, activeProp.value, at) ?? baseValue(activeProp.value)
    const x = (i / SAMPLES) * W
    const y = H - PAD - ((v - lo) / span) * (H - PAD * 2)
    pts.push({ x, y })
  }
  return pts
})

const curvePath = computed(() => curvePoints.value
  .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
  .join(' '))

// Keyframe diamond positions (prop-local time -> % of clip width).
const kfMarks = computed(() => {
  const durTicks = Math.max(1, Math.round(duration.value * TICKS_PER_SECOND))
  return kfTimes.value.map(t => ({
    t,
    x: Math.min(100, Math.max(0, (t / durTicks) * 100))
  }))
})

// Playhead position inside the lane (0..100), clamped; -1 when the
// playhead is outside the clip (no marker).
const playheadPct = computed(() => {
  const durTicks = Math.max(1, Math.round(duration.value * TICKS_PER_SECOND))
  const p = (localTicks.value / durTicks) * 100
  return p >= 0 && p <= 100 ? p : -1
})

// ---- Editing -------------------------------------------------------------
function handleToggleKeyframe() {
  const c = clip.value
  if (!c) return
  pushHistory() // discrete op — its own undo entry (roadmap B8)
  const draft = { ...c, keyframes: [...(c.keyframes || [])] }
  const t = localTicks.value
  if (keyframeAt(draft, activeProp.value, t)) {
    removeKeyframe(draft, activeProp.value, t)
  } else {
    setKeyframe(draft, activeProp.value, t, currentValue(activeProp.value))
  }
  updateClip(c.id, { keyframes: draft.keyframes })
}

function handleEasingChange(easing: string) {
  const c = clip.value
  const kf = activeKf.value
  if (!c || !kf) return
  pushHistory() // discrete op
  const draft = { ...c, keyframes: [...(c.keyframes || [])] }
  const hit = keyframeAt(draft, activeProp.value, kf.t)
  if (hit) hit.easing = easing as typeof hit.easing
  updateClip(c.id, { keyframes: draft.keyframes })
}

function handleLaneClick(event: MouseEvent) {
  // The lane is a time ruler: a click seeks the playhead to that time so
  // "pin keyframe at playhead" lands exactly where the user pointed.
  const c = clip.value
  if (!c) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const frac = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
  seek(clipStartSec(c) + frac * duration.value)
}

// Value readout: a raw number with a per-property unit hint, so the lane
// stays honest about what the curve's vertical axis means.
function formatValue(v: number): string {
  const rounded = Math.round(v * 10) / 10
  switch (activeProp.value) {
    case 'opacity':
    case 'volume':
    case 'scale':
      return `${rounded}%`
    default:
      return `${rounded}px`
  }
}

const propLabel = (p: KfProp) => t(`tmcut.keyframeLane.prop_${p}`)
const easingLabel = (e: string) => t(`tmcut.keyframeLane.easing_${e}`)
</script>

<template>
  <div
    class="h-[92px] shrink-0 border-t border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-900/60 pr-1 py-1.5 select-none">
    <div class="flex items-center gap-2 h-6 px-2">
      <UIcon name="i-lucide-spline" class="size-3.5 text-primary shrink-0" />
      <span class="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {{ t('tmcut.keyframeLane.title') }}
      </span>

      <template v-if="clip">
        <span class="text-[10px] text-neutral-600 dark:text-neutral-300 truncate max-w-[180px]">
          {{ clip.text || clip.name || 'Clip' }}
        </span>

        <div class="flex items-center gap-1 ml-1">
          <USelect :aria-label="t('tmcut.keyframeLane.propertyLabel')"
            :items="availableProps.map(p => ({ label: propLabel(p), value: p }))" :model-value="activeProp" size="xs"
            class="w-28" @update:model-value="activeProp = ($event as KfProp)" />
          <UButton color="primary" variant="soft" size="xs" icon="i-lucide-diamond" :label="hasKeyframes
            ? t('tmcut.keyframeLane.removeAtPlayhead')
            : t('tmcut.keyframeLane.addAtPlayhead')" @click="handleToggleKeyframe" />
          <USelect v-if="activeKf" :aria-label="t('tmcut.keyframeLane.easingLabel')"
            :items="KEYFRAME_EASINGS.map(e => ({ label: easingLabel(e), value: e }))"
            :model-value="activeKf.easing || 'linear'" size="xs" class="w-32"
            @update:model-value="handleEasingChange(String($event))" />
          <span class="text-[10px] font-mono text-neutral-500 ml-1">
            {{ formatValue(currentValue(activeProp)) }}
          </span>
        </div>
      </template>

      <span v-else class="text-[10px] text-neutral-400 dark:text-neutral-500">
        {{ t('tmcut.keyframeLane.selectClipHint') }}
      </span>
    </div>

    <!-- Curve band. Fixed viewBox (640x72) scales to any lane width, so
         the curve never distorts with the timeline zoom. -->
    <div v-if="clip" class="relative h-[58px] mt-1 bg-neutral-50 dark:bg-neutral-950 overflow-hidden cursor-crosshair"
      @click="handleLaneClick">
      <!-- Center gridline (the y=0 / baseline for x-y offsets) -->
      <div
        class="absolute inset-x-0 top-1/2 border-t border-dashed border-neutral-300 dark:border-neutral-700 pointer-events-none" />

      <svg v-if="curvePoints.length > 1" class="absolute inset-0 w-full h-full" :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="none">
        <path :d="curvePath" fill="none" stroke="currentColor" stroke-width="1.5" class="text-primary" />
      </svg>

      <!-- Keyframe diamonds (prop times, % positions) -->
      <span v-for="m in kfMarks" :key="`kf-${m.t}`"
        class="absolute top-1/2 w-2 h-2 -translate-x-1/2 -translate-y-1/2 bg-white/90 rotate-45 border border-primary z-10 pointer-events-none"
        :style="{ left: `${m.x}%` }" />

      <!-- Playhead marker inside the lane -->
      <div v-if="playheadPct >= 0" class="absolute top-0 bottom-0 w-px bg-primary z-20 pointer-events-none"
        :style="{ left: `${playheadPct}%` }" />

      <!-- Empty state: clip selected, prop has no keyframes yet -->
      <div v-if="!clipHasAnyKf" class="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span class="text-[10px] text-neutral-400 dark:text-neutral-500">
          {{ t('tmcut.keyframeLane.noKeyframes') }}
        </span>
      </div>
    </div>
  </div>
</template>
