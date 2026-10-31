<script setup lang="ts">
// =============================================================================
//  Motion properties editor (thuộc tính chuyển động) — right panel.
//
//  Before this panel, a clip could only get a keyframe by clicking the ⏱
//  button next to a single field: once written, the keyframe could not be
//  inspected, moved, retimed, re-eased or deleted — the only way out was to
//  delete the whole clip. This is the missing list view.
//
//  It edits exactly the channels the render pipeline evaluates through
//  `keyframeExpr` (opacity/scale/x/y on visual clips, volume on audio), so a
//  row here is always a row the export honors. Times are clip-local ticks
//  (0 = clip start), the same convention the ⏱ buttons and the timeline
//  keyframe lane use, which is why keyframes travel with the clip.
//
//  Every discrete edit records ONE undo entry (pushHistory) and every slider
//  drag coalesces (pushHistoryCoalesced), matching the Inspector contract.
// =============================================================================
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutProject } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { KEYFRAME_EASINGS, TICKS_PER_SECOND, removeKeyframe, setKeyframe, ticksToSec, secToTicks } from '@tmcut-core'
import type { TmcutKeyframeEasing } from '@tmcut-core'
import { clipStartTicks } from '~/utils/tmcut/clipTime'

type KfProp = 'scale' | 'x' | 'y' | 'opacity' | 'volume'

const props = withDefaults(defineProps<{
  /** Channels offered for this clip type (audio passes ['volume']). */
  allowed?: KfProp[]
}>(), {
  allowed: () => ['opacity', 'scale', 'x', 'y']
})

const { t } = useI18n()
const { selectedClip, selectedClipId, updateClip, pushHistory, pushHistoryCoalesced } = useTmcutProject()
const { playhead } = useTmcutPlayback()

const clip = computed(() => selectedClip.value?.item)

const localTicks = computed(() => {
  const c = clip.value
  if (!c) return 0
  return Math.round(secToTicks(playhead.value) - clipStartTicks(c))
})

const propOptions = computed(() => props.allowed.map(value => ({
  value,
  label: t(`tmcut.motion.props.${value}`)
})))

interface KfRow {
  prop: KfProp
  index: number
  /** Original tick position — the identity of the row while editing. */
  at: number
  timeSec: number
  value: number
  easing: string
}

/** Flattened rows, grouped by channel, each channel sorted by time. */
const rows = computed<KfRow[]>(() => {
  const list = Array.isArray(clip.value?.keyframes) ? clip.value!.keyframes : []
  const out: KfRow[] = []
  for (const prop of props.allowed) {
    const group = list
      .filter(kf => kf && kf.prop === prop && Number.isFinite(kf.t) && Number.isFinite(kf.value))
      .slice()
      .sort((a, b) => a.t - b.t)
    group.forEach((kf, index) => {
      out.push({
        prop,
        index,
        at: kf.t,
        timeSec: Number(ticksToSec(kf.t).toFixed(3)),
        value: Number(kf.value),
        easing: String((kf as { easing?: string }).easing || 'linear')
      })
    })
  }
  return out
})

const hasRows = computed(() => rows.value.length > 0)

/** Live value of a channel at the playhead (what the ⏱ button would store). */
function liveValue(prop: KfProp): number {
  const c = clip.value
  if (!c) return 0
  if (prop === 'volume') return c.volume ?? 100
  if (prop === 'opacity') return c.opacity ?? 100
  if (prop === 'scale') return c.scale ?? 100
  if (prop === 'x') return c.x ?? 0
  return c.y ?? 0
}

/** Replace the whole keyframe list in one undoable patch. */
function commit(list: Array<Record<string, unknown>>, coalesceKey?: string) {
  const id = selectedClipId.value
  if (!id) return
  if (coalesceKey) pushHistoryCoalesced(coalesceKey)
  else pushHistory()
  updateClip(id, { keyframes: list as NonNullable<typeof clip.value>['keyframes'] })
}

function addKeyframe(prop: KfProp) {
  const c = clip.value
  if (!c) return
  const draft = { keyframes: [...(c.keyframes || [])] }
  // 0 and `max` ease out, `max/min` ease in… a plain linear write keeps the
  // intent predictable; the row's easing select is where the curve is chosen.
  setKeyframe(draft, prop, localTicks.value, liveValue(prop), 'linear')
  commit(draft.keyframes as Array<Record<string, unknown>>)
}

function removeRow(row: KfRow) {
  const c = clip.value
  if (!c) return
  const draft = { keyframes: [...(c.keyframes || [])] }
  removeKeyframe(draft, row.prop, row.at, 0)
  commit(draft.keyframes as Array<Record<string, unknown>>)
}

/**
 * Rewrite one keyframe: time and/or value and/or easing. Time changes move
 * the row, so the old entry is removed and the new one written at the new
 * tick — same as dragging a keyframe on the lane.
 */
function updateRow(row: KfRow, patch: Partial<Pick<KfRow, 'timeSec' | 'value' | 'easing'>>) {
  const c = clip.value
  if (!c) return
  const nextTicks = patch.timeSec === undefined
    ? row.at
    : Math.max(0, Math.round(secToTicks(Number(patch.timeSec) || 0)))
  const nextValue = patch.value === undefined ? row.value : Number(patch.value)
  if (!Number.isFinite(nextValue)) return
  const easing = (patch.easing === undefined ? row.easing : patch.easing) as TmcutKeyframeEasing
  if (nextTicks === row.at && nextValue === row.value && easing === row.easing) return

  const draft = { keyframes: [...(c.keyframes || [])] }
  removeKeyframe(draft, row.prop, row.at, 0)
  setKeyframe(draft, row.prop, nextTicks, nextValue, easing)
  // A drag along the time axis is continuous: coalesce per row so one gesture
  // is one undo entry, while a discrete value/curve pick stands alone.
  const coalesce = patch.timeSec !== undefined || patch.value !== undefined
    ? `${selectedClipId.value}:kf:${row.prop}:${row.at}`
    : undefined
  commit(draft.keyframes as Array<Record<string, unknown>>, coalesce)
}

function clearAll() {
  const c = clip.value
  if (!c) return
  const kept = (c.keyframes || []).filter(kf => !props.allowed.includes(kf.prop as KfProp))
  commit(kept as Array<Record<string, unknown>>)
}

const easingOptions = computed(() => (KEYFRAME_EASINGS as string[]).map(value => ({
  value,
  label: t(`tmcut.motion.easing.${value}`)
})))

const ticksPerSecond = TICKS_PER_SECOND
</script>

<template>
  <div v-if="clip" class="space-y-2">
    <div class="flex items-center justify-between gap-2">
      <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
        {{ t('tmcut.motion.title') }}
      </span>
      <div class="flex items-center gap-1">
        <span v-if="hasRows" class="text-[10px] font-mono text-neutral-500">
          {{ rows.length }}
        </span>
        <UButton v-if="hasRows" icon="i-lucide-trash-2" size="xs" color="neutral" variant="ghost"
          :title="t('tmcut.motion.clearAll')" :aria-label="t('tmcut.motion.clearAll')" @click="clearAll" />
      </div>
    </div>

    <!-- Add at playhead: one button per channel the renderer evaluates. -->
    <div class="flex flex-wrap gap-1">
      <UButton v-for="option in propOptions" :key="option.value" size="xs" variant="soft" color="neutral"
        icon="i-lucide-plus" class="text-[10px]" :title="t('tmcut.motion.addAtPlayhead', { prop: option.label })"
        @click="addKeyframe(option.value as KfProp)">
        {{ option.label }}
      </UButton>
    </div>

    <p v-if="!hasRows" class="text-[10px] text-neutral-500 leading-snug">
      {{ t('tmcut.motion.empty') }}
    </p>

    <!-- One block per channel: time / value / curve / delete per row. -->
    <div v-else class="space-y-2">
      <div v-for="option in propOptions.filter(o => rows.some(r => r.prop === o.value))" :key="option.value"
        class="space-y-1 p-2 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-diamond" class="size-3 text-primary shrink-0" />
          <span class="text-[11px] font-medium text-neutral-700 dark:text-neutral-200">{{ option.label }}</span>
        </div>
        <div v-for="row in rows.filter(r => r.prop === option.value)" :key="`${row.prop}-${row.at}`"
          class="grid grid-cols-[1fr_1fr_auto] gap-1 items-center">
          <UInput :model-value="row.timeSec" type="number" step="0.05" min="0" size="xs"
            :aria-label="t('tmcut.motion.time')" :title="t('tmcut.motion.time')"
            @update:model-value="updateRow(row, { timeSec: Number($event) })" />
          <UInput :model-value="row.value" type="number" step="1" size="xs" :aria-label="t('tmcut.motion.value')"
            :title="t('tmcut.motion.value')" @update:model-value="updateRow(row, { value: Number($event) })" />
          <UButton icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :title="t('tmcut.motion.remove')"
            :aria-label="t('tmcut.motion.remove')" @click="removeRow(row)" />
          <USelect :model-value="row.easing" :items="easingOptions" size="xs" class="col-span-2"
            :aria-label="t('tmcut.motion.easing')" :title="t('tmcut.motion.easing')"
            @update:model-value="updateRow(row, { easing: String($event) })" />
          <span class="text-[9px] font-mono text-neutral-500 text-right">
            {{ t('tmcut.motion.suffixTicks', { ticks: Math.round(row.timeSec * ticksPerSecond) }) }}
          </span>
        </div>
      </div>
      <p class="text-[10px] text-neutral-500 leading-snug">
        {{ t('tmcut.motion.hint') }}
      </p>
    </div>
  </div>
</template>
