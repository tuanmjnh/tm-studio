<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTmcutProject, TMCUT_DEFAULT_FADE_SEC } from '~/composables/useTmcutProject'
import { useTmcutPlayback } from '~/composables/useTmcutPlayback'
import { useTmcutMedia } from '~/composables/useTmcutMedia'
import { keyframeAt, setKeyframe, removeKeyframe, propsWithKeyframes, TICKS_PER_SECOND, secToTicks, ticksToSec, withSpeed, isRamped, buildRampPreset, SPEED_RAMP_PRESETS, EFFECT_REGISTRY, normalizeEffects, clampEffectParam } from '@tmcut-core'
import type { TmcutTextAnimationType, TmcutStabilizeLevel } from '@tmcut-core'
import { canvasFpsValue } from '~/utils/tmcut/canvas'
import { clipDurationSec, clipDurationTicks, clipStartTicks } from '~/utils/tmcut/clipTime'
import { applyMediaAnimPreset, effectDefaultParams, groupEffectsByCategory, registryEntries, humanizeKey, filterPresets, setLutPresetOnClip, activeLutPreset } from '~/utils/tmcut/fxLibrary'
import type { MediaAnimPreset } from '~/utils/tmcut/fxLibrary'

const { t } = useI18n()
const toast = useToast()
const { isDesktop } = useTmcutMedia()
const { selectedClip, selectedClipId, selectClip, updateClip, removeClip, pushHistory, pushHistoryCoalesced, isCropEditing, toggleCropEditing } = useTmcutProject()
const { currentProject, contentDuration, saveStatus, lastSavedAt } = useTmcutProject()
const { choices: fontChoices, ensureFonts, resolveFace } = useTmcutFonts()
const { formatTimecode, playhead } = useTmcutPlayback()

const clip = computed(() => selectedClip.value?.item)
const trackType = computed(() => selectedClip.value?.track)

// Clip property tabs (design #2 + R112): every clip type gets its full
// editor — video: Visual / Audio / Speed / Animation / Effects; the tab list
// follows the clip type so no dead (always-empty) tab ever shows.
type TabKey = 'visual' | 'audio' | 'speed' | 'effects' | 'filters' | 'animation'
const activeTab = ref<TabKey>('visual')

const availableTabs = computed<TabKey[]>(() => {
  // Audio clips get the animation tab too: their motion property is the
  // volume envelope, which the export evaluates through `keyframeExpr`.
  if (trackType.value === 'audio') return ['audio', 'animation', 'speed']
  if (trackType.value === 'text') return ['visual', 'effects', 'animation', 'speed']
  return ['visual', 'audio', 'speed', 'animation', 'effects', 'filters']
})

const currentTab = computed(() => (
  availableTabs.value.includes(activeTab.value) ? activeTab.value : availableTabs.value[0]
))

const tabItems = computed(() => availableTabs.value.map(key => ({
  key,
  label: key === 'visual'
    ? t('tmcut.inspectorProps.tabVisual')
    : key === 'audio'
      ? t('tmcut.inspectorProps.tabAudio')
      : key === 'speed'
        ? t('tmcut.inspectorProps.tabSpeed')
        : key === 'effects'
          ? t('tmcut.inspectorProps.tabEffects')
          : key === 'filters'
            ? t('tmcut.inspectorProps.tabFilters')
            : t('tmcut.animation.tab'),
  icon: key === 'visual'
    ? (trackType.value === 'text' ? 'i-lucide-type' : 'i-lucide-image')
    : key === 'audio'
      ? 'i-lucide-volume-2'
      : key === 'speed'
        ? 'i-lucide-gauge'
        : key === 'effects'
          ? 'i-lucide-sparkles'
          : key === 'filters'
            ? 'i-lucide-palette'
            : 'i-lucide-wand-sparkles'
})))

// Speed options
const speedOptions = computed(() => [
  { label: '0.5x', value: 0.5 },
  { label: '0.75x', value: 0.75 },
  { label: `1.0x (${t('tmcut.inspectorProps.normalSpeed')})`, value: 1.0 },
  { label: '1.25x', value: 1.25 },
  { label: '1.5x', value: 1.5 },
  { label: '2.0x', value: 2.0 },
  { label: '3.0x', value: 3.0 },
  { label: '4.0x', value: 4.0 }
])

// Media fitting options (Phase 2)
const fitOptions = computed(() => [
  { label: t('tmcut.fit.fit'), value: 'fit' },
  { label: t('tmcut.fit.fill'), value: 'fill' },
  { label: t('tmcut.fit.crop'), value: 'crop' },
  { label: t('tmcut.fit.stretch'), value: 'stretch' },
  { label: t('tmcut.fit.smart'), value: 'smart' }
])

const isSmartFit = computed(() => (clip.value?.fit || 'fit') === 'smart' && trackType.value === 'video')
const isCropFit = computed(() => (clip.value?.fit || 'fit') === 'crop' && trackType.value === 'video')

function handleUpdate<K extends keyof NonNullable<typeof clip.value>>(field: K, value: NonNullable<typeof clip.value>[K]) {
  if (!selectedClipId.value) return
  // Roadmap B8: bursts of the same field (typing a text, dragging a
  // slider) record ONE undo entry through the coalescing history.
  pushHistoryCoalesced(`${selectedClipId.value}:${String(field)}`)
  updateClip(selectedClipId.value, { [field]: value })
}

// Timing fields (C16-R3): the store keeps in/out/offset as TICKS; the
// number inputs speak SECONDS (what the labels mean to the user), so
// this pair is the component's decode/encode seam.
const inPointSec = computed(() => Number(ticksToSec(clip.value?.in ?? 0).toFixed(3)))
const outPointSec = computed(() => Number(ticksToSec(clip.value?.out ?? 0).toFixed(3)))
const offsetSec = computed(() => Number(ticksToSec(clip.value?.offset ?? 0).toFixed(3)))

function handleTimeUpdate(field: 'in' | 'out' | 'offset', valueSec: number) {
  const ticks = Math.max(0, Math.round(secToTicks(Number(valueSec) || 0)))
  handleUpdate(field, ticks)
}

// R124 A3 — Mask (CapCut §5.7): shape picker + normalized box + feather/
// rotation/invert. Geometry semantics live in core mask.mjs (shared by
// preview SVG and export geq); this panel only stores parameters. Enabling
// a shape writes a centered default box; picking "none" clears the mask.
// reka-ui rejects empty-string SelectItem values (crashes the whole
// select), so "no mask" travels as a sentinel and maps backstage.
const MASK_SHAPE_ITEMS = computed(() => [
  { label: t('tmcut.mask.shape_none'), value: 'none' },
  { label: t('tmcut.mask.shape_rectangle'), value: 'rectangle' },
  { label: t('tmcut.mask.shape_circle'), value: 'circle' },
  { label: t('tmcut.mask.shape_linear'), value: 'linear' }
])

function maskPatch(patch: Record<string, unknown>) {
  if (!selectedClipId.value) return
  const base = clip.value?.mask ?? {
    shape: 'rectangle' as const, x: 0.25, y: 0.25, w: 0.5, h: 0.5,
    feather: 0, rotation: 0, invert: false, axis: 'x' as const
  }
  handleUpdate('mask', { ...base, ...patch } as never)
}

function handleMaskShapeChange(shape: string) {
  if (!shape || shape === 'none') {
    handleUpdate('mask', null as never)
    return
  }
  // Keep the current box when switching shapes; shape-only switches are
  // the norm (the box is shape-agnostic normalized geometry).
  maskPatch({ shape })
}

// Font family (roadmap C-1): family (CSS preview) and file (drawtext
// fontfile= export) always travel together, so ONE coalesced history
// entry covers the pair — preview and export can never drift onto
// different faces. C-2: the file respects the CURRENT bold/italic flags
// (drawtext rasterizes one real face — no faux bold).
function handleFontUpdate(family: string) {
  if (!selectedClipId.value || !family || family === 'null') return
  const choice = fontChoices.value.find(c => c.family === family)
  if (!choice) return
  pushHistoryCoalesced(`${selectedClipId.value}:font`)
  updateClip(selectedClipId.value, {
    fontFamily: choice.family,
    fontFile: faceFileFor(choice, clip.value?.bold, clip.value?.italic)
  })
}

// Text style toggles (roadmap C-2): discrete switches record ONE undo
// entry each (B8). Bold/italic re-resolve fontFile in the SAME patch so
// export picks the real bold/italic face — desktop only; web has no
// faces and keeps the preview CSS flag (web cannot export anyway).
// Background plate (roadmap đợt 2): drawtext `box=1:boxborderw=`. Stored as
// `bgColor`; undefined = no plate, so the legacy filter string is untouched.
function toggleTextPlate() {
  if (!selectedClipId.value || !clip.value) return
  pushHistory()
  updateClip(selectedClipId.value, { bgColor: clip.value.bgColor ? undefined : '#000000' })
}

async function handleStyleToggle(field: 'bold' | 'italic' | 'shadow' | 'stroke') {
  if (!selectedClipId.value || !clip.value) return
  const next = !clip.value[field]
  pushHistory()
  const patch: Partial<NonNullable<typeof clip.value>> = { [field]: next }
  if (field === 'bold' || field === 'italic') {
    const bold = field === 'bold' ? next : !!clip.value.bold
    const italic = field === 'italic' ? next : !!clip.value.italic
    const face = await resolveFace(bold, italic, clip.value.fontFamily)
    if (face) {
      patch.fontFamily = face.family
      patch.fontFile = face.file
    }
  }
  updateClip(selectedClipId.value, patch)
}

// Align (roadmap C-2): block anchor — default center matches the legacy
// export x expression byte-for-byte.
function handleAlign(align: 'left' | 'center' | 'right') {
  if (!selectedClipId.value || (clip.value?.align || 'center') === align) return
  pushHistory()
  updateClip(selectedClipId.value, { align })
}

// Text animations in/out (Roadmap C-5)
const animInOptions = computed(() => [
  { label: t('tmcut.animation.none'), value: 'none' },
  { label: t('tmcut.animation.fade'), value: 'fade' },
  { label: t('tmcut.animation.slideUp'), value: 'slide-up' },
  { label: t('tmcut.animation.slideDown'), value: 'slide-down' },
  { label: t('tmcut.animation.slideLeft'), value: 'slide-left' },
  { label: t('tmcut.animation.slideRight'), value: 'slide-right' },
  { label: t('tmcut.animation.zoomIn'), value: 'zoom-in' },
  { label: t('tmcut.animation.zoomOut'), value: 'zoom-out' }
])

const animOutOptions = computed(() => [
  { label: t('tmcut.animation.none'), value: 'none' },
  { label: t('tmcut.animation.fade'), value: 'fade' },
  { label: t('tmcut.animation.slideUp'), value: 'slide-up' },
  { label: t('tmcut.animation.slideDown'), value: 'slide-down' },
  { label: t('tmcut.animation.slideLeft'), value: 'slide-left' },
  { label: t('tmcut.animation.slideRight'), value: 'slide-right' },
  { label: t('tmcut.animation.zoomIn'), value: 'zoom-in' },
  { label: t('tmcut.animation.zoomOut'), value: 'zoom-out' }
])

function applyAnimPreset(preset: 'fade' | 'slide' | 'pop' | 'reset') {
  if (!selectedClipId.value) return
  pushHistory()
  if (preset === 'fade') {
    updateClip(selectedClipId.value, {
      animIn: 'fade',
      animInDuration: 0.5,
      animOut: 'fade',
      animOutDuration: 0.5
    })
  } else if (preset === 'slide') {
    updateClip(selectedClipId.value, {
      animIn: 'slide-up',
      animInDuration: 0.5,
      animOut: 'slide-down',
      animOutDuration: 0.5
    })
  } else if (preset === 'pop') {
    updateClip(selectedClipId.value, {
      animIn: 'zoom-in',
      animInDuration: 0.5,
      animOut: 'zoom-out',
      animOutDuration: 0.5
    })
  } else {
    updateClip(selectedClipId.value, {
      animIn: 'none',
      animOut: 'none'
    })
  }
}

// ===== Media animation presets (R112, video clips) =========================
// CapCut-style whole-clip entrances/exits. They write the SAME opacity/scale
// keyframes the ⏱ buttons produce (fxLibrary.applyMediaAnimPreset), so the
// result stays visible in the keyframe lanes and editable afterwards.
// Preview-only — the same honesty label as every other keyframe.
const mediaAnimOptions = computed(() => [
  { label: t('tmcut.fxLib.anim.fade'), value: 'fade' as MediaAnimPreset },
  { label: t('tmcut.fxLib.anim.fadeIn'), value: 'fade-in' as MediaAnimPreset },
  { label: t('tmcut.fxLib.anim.fadeOut'), value: 'fade-out' as MediaAnimPreset },
  { label: t('tmcut.fxLib.anim.zoomIn'), value: 'zoom-in' as MediaAnimPreset },
  { label: t('tmcut.fxLib.anim.zoomOut'), value: 'zoom-out' as MediaAnimPreset },
  { label: t('tmcut.animation.reset'), value: 'reset' as MediaAnimPreset }
])

// A preset is "active" when it currently owns both fade edges (fade) or the
// whole scale channel (zoom) — a cheap truthy signal for the button state.
const mediaAnimActive = computed<MediaAnimPreset | null>(() => {
  const c = clip.value
  if (!c || trackType.value !== 'video') return null
  const props = propsWithKeyframes(c)
  const hasOpacity = props.includes('opacity')
  const hasScale = props.includes('scale')
  if (!hasOpacity && !hasScale) return null
  if (hasOpacity && !hasScale) {
    const kf = c.keyframes || []
    const inEdge = kf.find(k => k.prop === 'opacity' && k.t === 0 && k.value === 0)
    const outEdge = kf.find(k => k.prop === 'opacity' && k.value === 0 && k.t === clipDurationTicks(c))
    if (inEdge && outEdge) return 'fade'
    if (inEdge) return 'fade-in'
    if (outEdge) return 'fade-out'
    return 'fade'
  }
  if (!hasOpacity) return (c.keyframes || []).some(k => k.prop === 'scale') ? 'zoom-in' : null
  return null
})

function applyMediaAnimChoice(preset: MediaAnimPreset) {
  const c = clip.value
  const clipId = selectedClipId.value
  if (!c || !clipId) return
  const dur = clipDurationTicks(c)
  const opacity = c.opacity ?? 100
  const scale = c.scale ?? 100
  const next = applyMediaAnimPreset(c.keyframes || [], preset, dur, opacity, scale)
  pushHistory()
  updateClip(clipId, { keyframes: next })
}

const alignOptions = [
  { key: 'left', icon: 'i-lucide-align-left', title: 'alignLeft' },
  { key: 'center', icon: 'i-lucide-align-center', title: 'alignCenter' },
  { key: 'right', icon: 'i-lucide-align-right', title: 'alignRight' }
] as const

// Video Stabilizer (Roadmap E-5)
const stabilizeLevelOptions = computed(() => [
  { label: t('tmcut.stabilize.mild'), value: 'mild' },
  { label: t('tmcut.stabilize.medium'), value: 'medium' },
  { label: t('tmcut.stabilize.aggressive'), value: 'aggressive' }
])

async function handleStabilizeToggle(enabled: boolean) {
  if (!selectedClipId.value || !clip.value) return
  pushHistory()
  if (!enabled) {
    updateClip(selectedClipId.value, {
      stabilize: false
    })
    return
  }
  const currentLevel = clip.value.stabilizeLevel || 'medium'
  updateClip(selectedClipId.value, {
    stabilize: true,
    stabilizeLevel: currentLevel
  })
  if (!clip.value.stabilizedPath || clip.value.stabilizeStatus !== 'ready') {
    await runStabilization(currentLevel)
  }
}

async function handleStabilizeLevelChange(level: TmcutStabilizeLevel) {
  if (!selectedClipId.value || !clip.value) return
  pushHistory()
  updateClip(selectedClipId.value, {
    stabilizeLevel: level,
    stabilizeStatus: 'none',
    stabilizedPath: null
  })
  await runStabilization(level)
}

async function runStabilization(forcedLevel?: TmcutStabilizeLevel) {
  if (!selectedClipId.value || !clip.value || !clip.value.src) return
  if (!isDesktop.value) return
  const clipId = selectedClipId.value
  const src = clip.value.src
  const level = forcedLevel || clip.value.stabilizeLevel || 'medium'

  if (!window.electronAPI?.tmcut) return
  updateClip(clipId, {
    stabilizeStatus: 'processing'
  })

  try {
    const res = await window.electronAPI.tmcut.stabilizeVideo({
      filePath: src,
      options: { level }
    })
    if (res.ok && res.path) {
      updateClip(clipId, {
        stabilizedPath: res.path,
        stabilizeStatus: 'ready'
      })
      toast.add({
        title: t('tmcut.stabilize.ready'),
        description: t('tmcut.stabilize.readyDesc'),
        color: 'success'
      })
    } else {
      updateClip(clipId, {
        stabilizeStatus: 'error'
      })
      toast.add({
        title: t('tmcut.stabilize.error'),
        description: res.error || 'Stabilization failed',
        color: 'error'
      })
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Stabilization failed'
    updateClip(clipId, {
      stabilizeStatus: 'error'
    })
    toast.add({
      title: t('tmcut.stabilize.error'),
      description: msg,
      color: 'error'
    })
  }
}

// Keyframes (roadmap B1): the ⏱ buttons toggle a keyframe of the
// CURRENT field value at the playhead. Times are clip-local ticks
// (0 = clip start), so keyframes travel with the clip when it moves.
// The array is copied before mutation so updateClip receives one field
// patch, and pushHistory() below records exactly one discrete undo
// entry (roadmap B8). Keyframes are PREVIEW ONLY until the render
// pipeline supports them (Phase K roadmap item); the chip in the
// section headers says so.
type KfProp = 'scale' | 'x' | 'y' | 'opacity' | 'volume'

const clipLocalTicks = computed(() => {
  const c = clip.value
  if (!c) return 0
  // C16-R3: playhead is SECONDS, clip.offset is store TICKS — snap the
  // playhead into tick space first, then subtract (both integers).
  return Math.round(secToTicks(playhead.value) - clipStartTicks(c))
})

const clipHasKeyframes = computed(() => propsWithKeyframes(clip.value).length > 0)

const eqGradeEffect = computed(() => {
  const c = clip.value
  if (!c?.effects) return null
  return c.effects.find(e => e.type === 'eq-grade') || null
})

// Typed accessors for the Color Grade sliders (params values are
// `unknown` at the type level — normalize guarantees numbers at runtime).
const eqGradeDesc = EFFECT_REGISTRY['eq-grade']
function eqParam(name: string, dflt: number): number {
  const raw = eqGradeEffect.value?.params[name]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : dflt
}
const eqBrightness = computed(() => eqParam('brightness', 0))
const eqContrast = computed(() => eqParam('contrast', 100))
const eqSaturation = computed(() => eqParam('saturation', 100))
const tempValue = computed(() => eqParam('temp', 0))
// R128 grading params (core eq-grade grew hue/gamma/fade/vibrance).
const eqHue = computed(() => eqParam('hue', 0))
const eqGamma = computed(() => eqParam('gamma', 100))
const eqFade = computed(() => eqParam('fade', 0))
const eqVibrance = computed(() => eqParam('vibrance', 0))

const blendMode = computed(() => clip.value?.blend || 'normal')

const BLEND_OPTIONS = [
  { label: t('tmcut.inspectorProps.blendNormal'), value: 'normal' },
  { label: t('tmcut.inspectorProps.blendScreen'), value: 'screen' },
  { label: t('tmcut.inspectorProps.blendOverlay'), value: 'overlay' },
  { label: t('tmcut.inspectorProps.blendMultiply'), value: 'multiply' }
]

function handleBlendUpdate(value: string) {
  const id = selectedClipId.value
  if (!id) return
  pushHistory() // discrete blend change → its own undo entry (B8)
  updateClip(id, { blend: value as 'normal' | 'screen' | 'overlay' | 'multiply' })
}

// Desktop export renders keyframes (keyframeExpr in the render builders);
// the tooltip spells out which channels so users can trust the label.
const keyframesExportedHint = computed(() =>
  isDesktop.value
    ? t('tmcut.inspectorProps.keyframesExportedHintDesktop')
    : t('tmcut.inspectorProps.keyframesExportedHintWeb')
)

function hasKfAtPlayhead(prop: KfProp): boolean {
  return !!keyframeAt(clip.value, prop, clipLocalTicks.value)
}

function kfTitle(prop: KfProp): string {
  return hasKfAtPlayhead(prop)
    ? t('tmcut.inspectorProps.removeKeyframe')
    : t('tmcut.inspectorProps.addKeyframe')
}

function kfCurrentValue(c: NonNullable<typeof clip.value>, prop: KfProp): number {
  if (prop === 'volume') return c.volume ?? 100
  if (prop === 'opacity') return c.opacity ?? 100
  if (prop === 'scale') return c.scale ?? 100
  if (prop === 'x') return c.x ?? 0
  return c.y ?? 0
}

function toggleKeyframe(prop: KfProp) {
  const c = clip.value
  if (!c || !selectedClipId.value) return
  const draft = { keyframes: [...(c.keyframes || [])] }
  if (keyframeAt(draft, prop, clipLocalTicks.value)) {
    removeKeyframe(draft, prop, clipLocalTicks.value)
  } else {
    setKeyframe(draft, prop, clipLocalTicks.value, kfCurrentValue(c, prop))
  }
  pushHistory() // discrete op → its own undo entry (roadmap B8)
  updateClip(selectedClipId.value, { keyframes: draft.keyframes })
}

// Fade in/out (roadmap C12 / core audio.mjs): the audio tab toggles a
// 0.5s default envelope per edge, with a slider while active. Values are
// TICKS on the v1 item (same passthrough heritage as keyframes and
// transitionIn); the preview ramps video.volume through core gainAt.
const DEFAULT_FADE_SEC = TMCUT_DEFAULT_FADE_SEC

const fadeInTicks = computed(() => clip.value?.fade?.in || 0)
const fadeOutTicks = computed(() => clip.value?.fade?.out || 0)

// Core clamps each edge to half the clip — the slider mirrors that cap.
const maxFadeSec = computed(() => {
  const c = clip.value
  if (!c) return 0
  return Math.max(0, Math.min(5, clipDurationSec(c) / 2))
})

function fadePatch(edge: 'in' | 'out', ticks: number) {
  const c = clip.value
  if (!c) return { in: 0, out: 0 }
  return {
    in: edge === 'in' ? ticks : (c.fade?.in || 0),
    out: edge === 'out' ? ticks : (c.fade?.out || 0)
  }
}

function toggleFade(edge: 'in' | 'out') {
  const c = clip.value
  if (!c || !selectedClipId.value) return
  const current = edge === 'in' ? fadeInTicks.value : fadeOutTicks.value
  const ticks = current > 0 ? 0 : Math.round(DEFAULT_FADE_SEC * TICKS_PER_SECOND)
  pushHistory() // discrete toggle → its own undo entry (roadmap B8)
  updateClip(selectedClipId.value, { fade: fadePatch(edge, ticks) })
}

function handleFadeUpdate(edge: 'in' | 'out', seconds: number) {
  if (!selectedClipId.value) return
  const ticks = Math.max(0, Math.round(seconds * TICKS_PER_SECOND))
  // Slider bursts coalesce into one undo entry (roadmap B8/C15).
  pushHistoryCoalesced(`${selectedClipId.value}:fade-${edge}`)
  updateClip(selectedClipId.value, { fade: fadePatch(edge, ticks) })
}

// Speed changes go through core C4 (roadmap B2): the speed is validated
// and the source span keeps the 0.2 s floor — only the touched fields are
// sent so undo history stays one clean entry. The timeline duration
// derives from (out - in) / speed everywhere (editor + export R25).
function handleSpeedUpdate(value: number) {
  const c = clip.value
  if (!c || !selectedClipId.value) return
  const next = withSpeed(c, Number(value))
  pushHistory() // discrete preset change → its own undo entry (B8)
  // R124 A4: an active curve is anchored to the OLD base speed — rebuild
  // it at the new base over the new duration so mean-anchoring holds.
  const kind = isRamped(c) ? activeRampKind.value : 'none'
  if (kind !== 'none') {
    updateClip(selectedClipId.value, {
      speed: next.speed,
      out: next.out,
      speedPoints: buildRampPreset(kind, clipDurationTicks(next), next.speed)
    })
  } else {
    updateClip(selectedClipId.value, { speed: next.speed, out: next.out })
  }
}

// Speed curve (R124 A4, CapCut §5.4): preset menu writing core
// buildRampPreset points. Presets are mean-anchored, so the timeline
// length survives picking a curve; the export runs the closed-form
// non-linear setpts, the preview rides instantaneous playbackRate.
const RAMP_KINDS = ['none', ...SPEED_RAMP_PRESETS]

const rampItems = computed(() => RAMP_KINDS.map(kind => ({
  label: t(kind === 'none' ? 'tmcut.ramp.none' : `tmcut.ramp.${kind}`),
  value: kind
})))

const activeRampKind = computed(() => {
  const c = clip.value
  if (!c || !isRamped(c)) return 'none'
  const pts = c.speedPoints!
  const dur = clipDurationTicks(c)
  for (const kind of SPEED_RAMP_PRESETS) {
    const ref = buildRampPreset(kind, dur, c.speed || 1)
    if (ref.length === pts.length
      && ref.every((p, i) => Math.abs(p.t - pts[i]!.t) <= 2 && Math.abs(p.speed - pts[i]!.speed) <= 0.011)) {
      return kind
    }
  }
  return 'none'
})

function handleRampChange(kind: string) {
  const c = clip.value
  if (!c || !selectedClipId.value) return
  pushHistory()
  if (kind === 'none') {
    updateClip(selectedClipId.value, { speedPoints: null })
    return
  }
  updateClip(selectedClipId.value, { speedPoints: buildRampPreset(kind, clipDurationTicks(c), c.speed || 1) })
}

function handleFitUpdate(value: string) {
  if (!selectedClipId.value) return
  pushHistory() // discrete fit change → its own undo entry (B8)
  const fit = value as 'fit' | 'fill' | 'crop' | 'stretch' | 'smart'
  if (fit === 'smart' && (clip.value?.focusX === undefined || clip.value?.focusY === undefined)) {
    updateClip(selectedClipId.value, { fit, focusX: 0.5, focusY: 0.5 })
    return
  }
  if (fit === 'crop' && !clip.value?.cropRect) {
    updateClip(selectedClipId.value, { fit, cropRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } })
    return
  }
  updateClip(selectedClipId.value, { fit })
}

function ensureEqGradeAndUpdate(param: string, value: number) {
  const id = selectedClipId.value
  const c = clip.value
  if (!id || !c) return
  const effects = [...(c.effects || [])]
  let eq = effects.find(e => e.type === 'eq-grade')
  if (!eq) {
    // Defaults come from the registry (single source of truth) — never
    // hand-coded here, newest core params show up automatically.
    if (!eqGradeDesc) return
    eq = { type: 'eq-grade', params: effectDefaultParams(eqGradeDesc) }
    effects.push(eq)
  }
  const clean = clampEffectParam('eq-grade', param, value)
  if (clean === undefined) return
  eq.params = { ...eq.params, [param]: clean }
  pushHistoryCoalesced(`${id}:eqgrade-${param}`)
  updateClip(id, { effects })
}

// Effects management (Roadmap Phase E, C6 registry)
const clipEffects = computed(() => {
  return normalizeEffects(clip.value?.effects || [])
})

function effectIcon(type: string): string {
  switch (type) {
    case 'blur': return 'i-lucide-droplets'
    case 'sharpen': return 'i-lucide-wand-sparkles'
    case 'vignette': return 'i-lucide-circle'
    case 'grain': return 'i-lucide-film'
    case 'chromakey': return 'i-lucide-scissors'
    case 'lut3d': return 'i-lucide-palette'
    case 'stabilize': return 'i-lucide-shield-check'
    case 'eq-grade': return 'i-lucide-sliders'
    default: return 'i-lucide-sparkles'
  }
}

function effectLabel(type: string): string {
  return t('tmcut.effects.' + (type === 'eq-grade' ? 'eqGrade' : type))
}

function paramLabel(paramName: string): string {
  return t('tmcut.effects.' + paramName)
}

function getEffectParams(type: string) {
  return EFFECT_REGISTRY[type]?.params || []
}

// R128: 29 registry effects would be an unreadable flat wall in the narrow
// panel — group them by registry category (same helper the FX Library uses),
// in the library's category order. Unknown categories land under 'other'.
const effectMenuItems = computed(() => {
  const groups = groupEffectsByCategory(registryEntries(EFFECT_REGISTRY))
  const items: Array<Record<string, unknown>> = []
  for (const group of groups) {
    items.push({ label: t('tmcut.fxLib.effectCategories.' + group.category, humanizeKey(group.category)), type: 'label' })
    for (const entry of group.items) {
      items.push({
        label: effectLabel(entry.type),
        icon: effectIcon(entry.type),
        onSelect: () => handleAddEffect(entry.type)
      })
    }
    items.push({ type: 'separator' })
  }
  items.pop() // no trailing separator
  return items
})

function handleAddEffect(type: string) {
  if (!selectedClipId.value) return
  const desc = EFFECT_REGISTRY[type]
  if (!desc) return
  const params: Record<string, unknown> = {}
  for (const p of desc.params) {
    params[p.name] = p.default
  }
  const current = [...(clip.value?.effects || [])]
  current.push({ type, params })
  pushHistory()
  updateClip(selectedClipId.value, { effects: current })
}

function handleRemoveEffect(index: number) {
  if (!selectedClipId.value) return
  const current = [...(clip.value?.effects || [])]
  current.splice(index, 1)
  pushHistory()
  updateClip(selectedClipId.value, { effects: current })
}

function handleResetEffect(index: number) {
  if (!selectedClipId.value) return
  const current = [...(clip.value?.effects || [])]
  const item = current[index]
  if (!item) return
  const desc = EFFECT_REGISTRY[item.type]
  if (!desc) return
  const params: Record<string, unknown> = {}
  for (const p of desc.params) {
    params[p.name] = p.default
  }
  current[index] = { type: item.type, params }
  pushHistory()
  updateClip(selectedClipId.value, { effects: current })
}

function handleUpdateEffectParam(effectIndex: number, paramName: string, value: unknown) {
  if (!selectedClipId.value) return
  // Normalise first so the index matches the list the panel renders, then let
  // the registry schema be the only writer (§5.3): an out-of-range value is
  // repaired to its documented bounds and a param the schema does not declare
  // never enters the project.
  const current = normalizeEffects(clip.value?.effects || [])
  const entry = current[effectIndex]
  if (!entry) return
  const clean = clampEffectParam(entry.type, paramName, value)
  if (clean === undefined) return
  entry.params[paramName] = clean
  pushHistoryCoalesced(`${selectedClipId.value}:effect:${effectIndex}:${paramName}`)
  updateClip(selectedClipId.value, { effects: current })
}

// --- Filters tab (LUT presets, right panel) --------------------------------
// Same registry enum the Filters library tab renders, surfaced next to the
// clip's other properties so a look can be picked without leaving the panel.
// Clicking the active preset removes it (toggle), matching the library.
const lutPresets = computed(() => filterPresets(EFFECT_REGISTRY))
const activeFilter = computed(() => activeLutPreset(clip.value?.effects || []))

function filterLabel(preset: string): string {
  return t(`tmcut.fxLib.lut.${preset}`, humanizeKey(preset))
}

function applyFilter(preset: string) {
  const id = selectedClipId.value
  if (!id) return
  const effects = clip.value?.effects || []
  const next = setLutPresetOnClip(effects, preset)
  pushHistory() // discrete grade change → its own undo entry
  if (next === null) updateClip(id, { effects: effects.filter(e => e.type !== 'lut3d') })
  else updateClip(id, { effects: next })
}

function clearFilter() {
  const id = selectedClipId.value
  if (!id || !activeFilter.value) return
  pushHistory()
  updateClip(id, { effects: (clip.value?.effects || []).filter(e => e.type !== 'lut3d') })
}

function handleDelete() {
  if (selectedClipId.value) {
    removeClip(selectedClipId.value)
  }
}

// Project details (CapCut-style "Details" panel when no clip is selected)
const storagePath = ref('')
onMounted(async () => {
  void ensureFonts()
  try {
    const dirs = await window.electronAPI?.tmcut?.getPaths()
    storagePath.value = dirs?.projects || ''
  } catch {
    storagePath.value = ''
  }
})

const detailRows = computed(() => {
  const project = currentProject.value
  const tracks = project?.timeline?.tracks || []
  const clipCount = tracks.reduce((n, tr) => n + (tr.items?.length || 0), 0)
  return [
    { label: t('tmcut.details.name'), value: project?.name || '—' },
    {
      label: t('tmcut.details.resolution'),
      value: project?.canvas ? `${project.canvas.width}x${project.canvas.height}` : '—'
    },
    {
      label: t('tmcut.details.fps'),
      value: project?.canvas ? `${canvasFpsValue(project.canvas)}fps` : '—'
    },
    { label: t('tmcut.details.duration'), value: formatTimecode(contentDuration.value) },
    { label: t('tmcut.details.tracks'), value: String(tracks.length) },
    { label: t('tmcut.details.clips'), value: String(clipCount) },
    {
      label: t('tmcut.details.lastSaved'),
      value: lastSavedAt.value ? new Date(lastSavedAt.value).toLocaleString() : '—'
    }
  ]
})

const saveStateLabel = computed(() => {
  if (saveStatus.value === 'saving') return t('tmcut.save.saving')
  if (saveStatus.value === 'saved') return t('tmcut.save.saved')
  if (saveStatus.value === 'error') return t('tmcut.save.error')
  return '—'
})
</script>

<template>
  <div v-if="clip" class="space-y-4 text-xs select-none">
    <!-- Header with Name & Deselect -->
    <div class="flex items-center justify-between pb-3 border-b border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center gap-2 min-w-0">
        <UIcon
          :name="trackType === 'video' ? 'i-lucide-film' : trackType === 'text' ? 'i-lucide-type' : 'i-lucide-music'"
          class="size-4 shrink-0"
          :class="trackType === 'video' ? 'text-blue-400' : trackType === 'text' ? 'text-amber-400' : 'text-emerald-400'"
        />
        <span class="font-medium text-neutral-800 dark:text-neutral-100 truncate text-sm">
          {{ clip.name || clip.text || t('tmcut.project') }}
        </span>
      </div>
      <UButton
        icon="i-lucide-x"
        size="xs"
        variant="soft"
        color="neutral"
        @click="selectClip(null)"
      />
    </div>

    <!-- Clip property tabs (design #2 + R112): a GRID, not a flex row —
         five Vietnamese labels (Hình ảnh/Âm thanh/Tốc độ/Hoạt ảnh/Hiệu ứng)
         overflow a single row inside the 288 px panel. 3 columns wrap to a
         second line for video clips; 2-3 tab sets stay on one line. -->
    <div class="grid gap-1 bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300 dark:border-neutral-800 rounded-lg p-1" :class="tabItems.length === 2 ? 'grid-cols-2' : 'grid-cols-3'">
      <button
        v-for="tab in tabItems"
        :key="tab.key"
        type="button"
        class="min-w-0 flex items-center justify-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer"
        :class="currentTab === tab.key ? 'bg-primary/15 text-primary' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
        @click="activeTab = tab.key"
      >
        <UIcon :name="tab.icon" class="size-3 shrink-0" />
        <span class="truncate">{{ tab.label }}</span>
      </button>
    </div>

    <!-- Text Content Editor (If Text Track) -->
    <div v-if="currentTab === 'visual' && trackType === 'text'" class="space-y-2">
      <label for="tmcut-insp-text-content" class="font-medium text-neutral-500 dark:text-neutral-400">{{ t('tmcut.inspectorProps.textContent') }}</label>
      <UTextarea
        id="tmcut-insp-text-content"
        :model-value="clip.text || ''"
        :placeholder="t('tmcut.inspectorProps.textPlaceholder')"
        :rows="3"
        class="w-full text-xs font-sans"
        @update:model-value="handleUpdate('text', $event)"
      />

      <div class="grid grid-cols-2 gap-2 pt-1">
        <div>
          <label for="tmcut-insp-font-size" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.fontSize') }}</label>
          <UInput
            id="tmcut-insp-font-size"
            type="number"
            :model-value="clip.fontSize || 36"
            :min="12"
            :max="120"
            size="xs"
            @update:model-value="handleUpdate('fontSize', Number($event))"
          />
        </div>
        <div>
          <label for="tmcut-insp-text-color" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.textColor') }}</label>
          <div class="flex items-center gap-1.5 mt-0.5">
            <input
              id="tmcut-insp-text-color"
              type="color"
              :value="clip.color || '#ffffff'"
              class="w-6 h-6 rounded border border-neutral-400 dark:border-neutral-700 bg-transparent cursor-pointer"
              @input="handleUpdate('color', ($event.target as HTMLInputElement).value)"
            >
            <span class="font-mono text-[10px] text-neutral-500 dark:text-neutral-400">{{ clip.color || '#ffffff' }}</span>
          </div>
        </div>
      </div>

      <!-- Font family (roadmap C-1): one choice per family from the
           main-process font scanner. Empty on web (no IPC) or when the
           addon fails — hidden rather than a fake or dead list. -->
      <div v-if="fontChoices.length" class="pt-1">
        <label class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.font') }}</label>
        <USelectMenu
          :items="fontChoices"
          value-key="family"
          label-key="family"
          class="w-full"
          :model-value="clip.fontFamily ?? undefined"
          :placeholder="t('tmcut.inspectorProps.fontDefault')"
          size="xs"
          :search-input="{ icon: 'i-lucide-search', placeholder: t('global.search') }"
          @update:model-value="handleFontUpdate(String($event))"
        />
      </div>

      <!-- Text style (roadmap C-2): every toggle maps 1:1 to export —
           bold/italic switch the REAL face file (drawtext has no faux
           bold), align anchors the block, shadow/stroke toggle drawtext
           shadow/border options. -->
      <div class="flex items-center gap-1 pt-1 flex-wrap">
        <UButton
          icon="i-lucide-bold"
          size="xs"
          :color="clip.bold ? 'primary' : 'neutral'"
          :variant="clip.bold ? 'soft' : 'ghost'"
          :title="t('tmcut.inspectorProps.bold')"
          @click="handleStyleToggle('bold')"
        />
        <UButton
          icon="i-lucide-italic"
          size="xs"
          :color="clip.italic ? 'primary' : 'neutral'"
          :variant="clip.italic ? 'soft' : 'ghost'"
          :title="t('tmcut.inspectorProps.italic')"
          @click="handleStyleToggle('italic')"
        />
        <div class="flex items-center gap-0.5 bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300 dark:border-neutral-800 rounded-md p-0.5">
          <button
            v-for="option in alignOptions"
            :key="option.key"
            type="button"
            class="px-1.5 py-1 rounded cursor-pointer transition-colors"
            :class="(clip.align || 'center') === option.key ? 'bg-primary/15 text-primary' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200'"
            :title="t(`tmcut.inspectorProps.${option.title}`)"
            @click="handleAlign(option.key)"
          >
            <UIcon :name="option.icon" class="size-3" />
          </button>
        </div>
        <div class="w-px h-4 bg-neutral-200 dark:bg-neutral-800 mx-0.5" />
        <UButton
          icon="i-lucide-moon"
          size="xs"
          :color="clip.shadow ? 'primary' : 'neutral'"
          :variant="clip.shadow ? 'soft' : 'ghost'"
          :title="t('tmcut.inspectorProps.shadow')"
          @click="handleStyleToggle('shadow')"
        />
        <UButton
          icon="i-lucide-blend"
          size="xs"
          :color="clip.stroke ? 'primary' : 'neutral'"
          :variant="clip.stroke ? 'soft' : 'ghost'"
          :title="t('tmcut.inspectorProps.stroke')"
          @click="handleStyleToggle('stroke')"
        />
      </div>
    </div>

    <!-- Audio motion: the volume envelope the export already renders
         (render/audio.ts -> keyframeExpr(clip,'volume')). -->
    <div v-if="currentTab === 'animation' && trackType === 'audio'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <TmcutKeyframeEditor :allowed="['volume']" />
    </div>

    <!-- Tab: Text Animation (Roadmap C-5) -->
    <div v-if="currentTab === 'animation' && trackType === 'text'" class="space-y-4 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <!-- Quick Presets -->
      <div class="space-y-1.5">
        <label class="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
          {{ t('tmcut.animation.presets') }}
        </label>
        <div class="grid grid-cols-4 gap-1.5">
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            class="justify-center text-[11px]"
            @click="applyAnimPreset('fade')"
          >
            {{ t('tmcut.animation.fade') }}
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            class="justify-center text-[11px]"
            @click="applyAnimPreset('slide')"
          >
            {{ t('tmcut.animation.slide') }}
          </UButton>
          <UButton
            size="xs"
            variant="soft"
            color="neutral"
            class="justify-center text-[11px]"
            @click="applyAnimPreset('pop')"
          >
            {{ t('tmcut.animation.pop') }}
          </UButton>
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            class="justify-center text-[11px]"
            @click="applyAnimPreset('reset')"
          >
            {{ t('tmcut.animation.reset') }}
          </UButton>
        </div>
      </div>

      <!-- Animation In -->
      <div class="space-y-2 p-2.5 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-log-in" class="size-3.5 text-primary" />
            <span class="text-xs font-medium text-neutral-700 dark:text-neutral-200">
              {{ t('tmcut.animation.animIn') }}
            </span>
          </div>
          <span v-if="clip.animIn && clip.animIn !== 'none'" class="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
            {{ clip.animInDuration ?? 0.5 }}s
          </span>
        </div>
        <USelect
          :aria-label="t('tmcut.animation.animIn')"
          :model-value="clip.animIn || 'none'"
          :items="animInOptions"
          size="xs"
          class="w-full"
          @update:model-value="handleUpdate('animIn', $event as TmcutTextAnimationType)"
        />
        <div v-if="clip.animIn && clip.animIn !== 'none'" class="space-y-1 pt-1">
          <div class="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>{{ t('tmcut.animation.duration') }}</span>
            <span class="font-mono text-neutral-600 dark:text-neutral-300">{{ clip.animInDuration ?? 0.5 }}s</span>
          </div>
          <input
            id="tmcut-insp-anim-in-duration"
            :aria-label="t('tmcut.animation.duration')"
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            :value="clip.animInDuration ?? 0.5"
            class="w-full accent-primary cursor-pointer"
            @input="handleUpdate('animInDuration', Number(($event.target as HTMLInputElement).value))"
          >
        </div>
      </div>

      <!-- Animation Out -->
      <div class="space-y-2 p-2.5 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-log-out" class="size-3.5 text-primary" />
            <span class="text-xs font-medium text-neutral-700 dark:text-neutral-200">
              {{ t('tmcut.animation.animOut') }}
            </span>
          </div>
          <span v-if="clip.animOut && clip.animOut !== 'none'" class="text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
            {{ clip.animOutDuration ?? 0.5 }}s
          </span>
        </div>
        <USelect
          :aria-label="t('tmcut.animation.animOut')"
          :model-value="clip.animOut || 'none'"
          :items="animOutOptions"
          size="xs"
          class="w-full"
          @update:model-value="handleUpdate('animOut', $event as TmcutTextAnimationType)"
        />
        <div v-if="clip.animOut && clip.animOut !== 'none'" class="space-y-1 pt-1">
          <div class="flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
            <span>{{ t('tmcut.animation.duration') }}</span>
            <span class="font-mono text-neutral-600 dark:text-neutral-300">{{ clip.animOutDuration ?? 0.5 }}s</span>
          </div>
          <input
            id="tmcut-insp-anim-out-duration"
            :aria-label="t('tmcut.animation.duration')"
            type="range"
            min="0.1"
            max="2.0"
            step="0.1"
            :value="clip.animOutDuration ?? 0.5"
            class="w-full accent-primary cursor-pointer"
            @input="handleUpdate('animOutDuration', Number(($event.target as HTMLInputElement).value))"
          >
        </div>
      </div>

      <!-- Motion keyframes for text: the three channels the drawtext
           chain evaluates (x, y, opacity). Scale is a static field for text,
           so it is deliberately not offered here. -->
      <TmcutKeyframeEditor :allowed="['opacity', 'x', 'y']" />
    </div>

    <!-- Animation presets (R112, video only). The keyframe list below is the
         shared motion editor; presets are the one-click shortcut into it. -->
    <div v-if="currentTab === 'animation' && trackType === 'video'" class="space-y-4 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
          {{ t('tmcut.fxLib.animPresets') }}
        </span>
        <span
          v-if="clipHasKeyframes"
          class="text-[9px] leading-none rounded bg-primary/15 text-primary px-1.5 py-0.5 flex items-center gap-1"
          :title="keyframesExportedHint"
        >
          <UIcon name="i-lucide-sparkles" class="w-3 h-3" />
          {{ t('tmcut.inspectorProps.keyframesExported') }}
        </span>
      </div>
      <div class="grid grid-cols-3 gap-1.5">
        <UButton
          v-for="p in mediaAnimOptions"
          :key="p.value"
          size="xs"
          :variant="mediaAnimActive === p.value ? 'soft' : 'ghost'"
          :color="p.value === 'reset' ? 'neutral' : mediaAnimActive === p.value ? 'primary' : 'neutral'"
          class="justify-center text-[11px]"
          @click="applyMediaAnimChoice(p.value)"
        >
          {{ p.label }}
        </UButton>
      </div>
      <p class="text-[10px] text-neutral-500 dark:text-neutral-500 leading-snug">
        {{ t('tmcut.fxLib.animPresetsHint') }}
      </p>

      <!-- Motion keyframes: every channel the renderer evaluates, editable
           (time / value / easing / delete) instead of write-only ⏱ buttons. -->
      <TmcutKeyframeEditor :allowed="['opacity', 'scale', 'x', 'y']" />
    </div>

    <!-- Timing & Speed Settings -->
    <div v-if="currentTab === 'speed'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">{{
        t('tmcut.inspectorProps.timingAndSpeed') }}</span>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label for="tmcut-insp-in-point" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.inPoint') }}</label>
          <UInput
            id="tmcut-insp-in-point"
            type="number"
            step="0.1"
            :model-value="inPointSec"
            size="xs"
            @update:model-value="handleTimeUpdate('in', Number($event))"
          />
        </div>
        <div>
          <label for="tmcut-insp-out-point" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.outPoint') }}</label>
          <UInput
            id="tmcut-insp-out-point"
            type="number"
            step="0.1"
            :model-value="outPointSec"
            size="xs"
            @update:model-value="handleTimeUpdate('out', Number($event))"
          />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label for="tmcut-insp-offset" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.offset') }}</label>
          <UInput
            id="tmcut-insp-offset"
            type="number"
            step="0.1"
            :model-value="offsetSec"
            size="xs"
            @update:model-value="handleTimeUpdate('offset', Number($event))"
          />
        </div>
        <div>
          <span class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.speed') }}</span>
          <USelect
            :aria-label="t('tmcut.inspectorProps.speed')"
            :items="speedOptions"
            :model-value="clip.speed || 1"
            size="xs"
            @update:model-value="handleSpeedUpdate(Number($event))"
          />
        </div>
      </div>

      <!-- Reverse playback (roadmap B2): preview seeks backwards
           (seek-driven like the J shuttle — the element cannot play
           native) and export applies reverse/areverse (R25). Hidden for
           TEXT clips: a text overlay has no directional playback, so the
           toggle would change nothing anywhere (dead control). -->
      <div v-if="trackType !== 'text'" class="flex items-center justify-between">
        <span class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.reverse') }}</span>
        <USwitch
          :model-value="!!clip.reverse"
          :aria-label="t('tmcut.inspectorProps.reverse')"
          @update:model-value="handleUpdate('reverse', !!$event)"
        />
      </div>

      <!-- Speed curve (R124 A4, CapCut §5.4): preset curves replace the
           constant speed with a piecewise-linear ramp. Core owns the math;
           every preset is mean-anchored so the timeline length survives.
           Video only — audio follows the base speed (documented v1 gap),
           text has no playback rate. -->
      <div v-if="trackType === 'video'" class="space-y-2 pt-2 border-t border-neutral-300 dark:border-neutral-800">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <UIcon name="i-lucide-trending-up" class="size-3.5 text-primary" />
            <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
              {{ t('tmcut.ramp.title') }}
            </span>
          </div>
          <USelect
            :aria-label="t('tmcut.ramp.title')"
            :items="rampItems"
            :model-value="activeRampKind"
            size="xs"
            class="w-36"
            @update:model-value="handleRampChange(String($event))"
          />
        </div>
        <p v-if="clip.speedPoints?.length" class="text-[10px] text-neutral-500">
          {{ t('tmcut.ramp.hint') }}
        </p>
      </div>
    </div>

    <!-- Media Fitting (Phase 2, video track only) -->
    <div v-if="currentTab === 'visual' && trackType === 'video'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">{{ t('tmcut.fit.label')
      }}</span>

      <div>
        <USelect
          :aria-label="t('tmcut.fit.label')"
          :items="fitOptions"
          :model-value="clip.fit || 'fit'"
          size="xs"
          @update:model-value="handleFitUpdate(String($event))"
        />
      </div>

      <div v-if="isSmartFit" class="grid grid-cols-2 gap-2">
        <div>
          <label for="tmcut-insp-focus-x" class="text-[10px] text-neutral-500">{{ t('tmcut.fit.focusX') }}</label>
          <UInput
            id="tmcut-insp-focus-x"
            type="number"
            step="0.05"
            :min="0"
            :max="1"
            :model-value="clip.focusX ?? 0.5"
            size="xs"
            @update:model-value="handleUpdate('focusX', Number($event))"
          />
        </div>
        <div>
          <label for="tmcut-insp-focus-y" class="text-[10px] text-neutral-500">{{ t('tmcut.fit.focusY') }}</label>
          <UInput
            id="tmcut-insp-focus-y"
            type="number"
            step="0.05"
            :min="0"
            :max="1"
            :model-value="clip.focusY ?? 0.5"
            size="xs"
            @update:model-value="handleUpdate('focusY', Number($event))"
          />
        </div>
      </div>

      <div v-if="isCropFit" class="space-y-2">
        <div class="flex items-center gap-1.5">
          <UButton
            :icon="isCropEditing ? 'i-lucide-check' : 'i-lucide-crop'"
            size="xs"
            :variant="isCropEditing ? 'solid' : 'soft'"
            :color="isCropEditing ? 'primary' : 'neutral'"
            class="flex-1 justify-center"
            @click="toggleCropEditing()"
          >
            {{ isCropEditing ? t('tmcut.crop.done') : t('tmcut.crop.editOnCanvas') }}
          </UButton>
          <UButton
            icon="i-lucide-rotate-ccw"
            size="xs"
            variant="soft"
            color="neutral"
            :title="t('tmcut.crop.reset')"
            @click="handleUpdate('cropRect', { x: 0, y: 0, w: 1, h: 1 })"
          />
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="tmcut-insp-crop-x" class="text-[10px] text-neutral-500">{{ t('tmcut.fit.cropX') }}</label>
            <UInput
              id="tmcut-insp-crop-x"
              type="number"
              step="0.05"
              :min="0"
              :max="1"
              :model-value="clip.cropRect?.x ?? 0.1"
              size="xs"
              @update:model-value="handleUpdate('cropRect', { ...(clip.cropRect || { x: 0, y: 0, w: 1, h: 1 }), x: Number($event) })"
            />
          </div>
          <div>
            <label for="tmcut-insp-crop-y" class="text-[10px] text-neutral-500">{{ t('tmcut.fit.cropY') }}</label>
            <UInput
              id="tmcut-insp-crop-y"
              type="number"
              step="0.05"
              :min="0"
              :max="1"
              :model-value="clip.cropRect?.y ?? 0.1"
              size="xs"
              @update:model-value="handleUpdate('cropRect', { ...(clip.cropRect || { x: 0, y: 0, w: 1, h: 1 }), y: Number($event) })"
            />
          </div>
          <div>
            <label for="tmcut-insp-crop-w" class="text-[10px] text-neutral-500">{{ t('tmcut.fit.cropW') }}</label>
            <UInput
              id="tmcut-insp-crop-w"
              type="number"
              step="0.05"
              :min="0.05"
              :max="1"
              :model-value="clip.cropRect?.w ?? 0.8"
              size="xs"
              @update:model-value="handleUpdate('cropRect', { ...(clip.cropRect || { x: 0, y: 0, w: 1, h: 1 }), w: Number($event) })"
            />
          </div>
          <div>
            <label for="tmcut-insp-crop-h" class="text-[10px] text-neutral-500">{{ t('tmcut.fit.cropH') }}</label>
            <UInput
              id="tmcut-insp-crop-h"
              type="number"
              step="0.05"
              :min="0.05"
              :max="1"
              :model-value="clip.cropRect?.h ?? 0.8"
              size="xs"
              @update:model-value="handleUpdate('cropRect', { ...(clip.cropRect || { x: 0, y: 0, w: 1, h: 1 }), h: Number($event) })"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Mask (R124 A3, CapCut §5.7): geometric shapes with feather,
         rotation and invert. Parameters only — the geometry math is shared in
         core mask.mjs (SVG mask in preview, geq chain on export), so the
         two paths can never disagree on the shape. -->
    <div v-if="currentTab === 'visual' && (trackType === 'video' || trackType === 'text')" class="space-y-2 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-shapes" class="size-3.5 text-primary" />
          <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
            {{ t('tmcut.mask.title') }}
          </span>
        </div>
        <USelect
          :aria-label="t('tmcut.mask.title')"
          :items="MASK_SHAPE_ITEMS"
          :model-value="clip.mask?.shape ?? 'none'"
          size="xs"
          class="w-32"
          @update:model-value="handleMaskShapeChange(String($event))"
        />
      </div>

      <template v-if="clip.mask">
        <div class="grid grid-cols-4 gap-2">
          <div>
            <label for="tmcut-insp-x" class="text-[10px] text-neutral-500">{{ t('tmcut.mask.x') }}</label>
            <UInput
              id="tmcut-insp-x"
              type="number"
              step="0.05"
              :min="0"
              :max="1"
              size="xs"
              :model-value="clip.mask.x"
              @update:model-value="maskPatch({ x: Number($event) })"
            />
          </div>
          <div>
            <label for="tmcut-insp-y" class="text-[10px] text-neutral-500">{{ t('tmcut.mask.y') }}</label>
            <UInput
              id="tmcut-insp-y"
              type="number"
              step="0.05"
              :min="0"
              :max="1"
              size="xs"
              :model-value="clip.mask.y"
              @update:model-value="maskPatch({ y: Number($event) })"
            />
          </div>
          <div>
            <label for="tmcut-insp-w" class="text-[10px] text-neutral-500">{{ t('tmcut.mask.w') }}</label>
            <UInput
              id="tmcut-insp-w"
              type="number"
              step="0.05"
              :min="0.05"
              :max="1"
              size="xs"
              :model-value="clip.mask.w"
              @update:model-value="maskPatch({ w: Number($event) })"
            />
          </div>
          <div>
            <label for="tmcut-insp-h" class="text-[10px] text-neutral-500">{{ t('tmcut.mask.h') }}</label>
            <UInput
              id="tmcut-insp-h"
              type="number"
              step="0.05"
              :min="0.05"
              :max="1"
              size="xs"
              :model-value="clip.mask.h"
              @update:model-value="maskPatch({ h: Number($event) })"
            />
          </div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <span class="text-[10px] text-neutral-500">{{ t('tmcut.mask.feather') }}</span>
            <USlider
              :aria-label="t('tmcut.mask.feather')"
              :model-value="clip.mask.feather"
              :min="0"
              :max="100"
              :step="1"
              @update:model-value="maskPatch({ feather: Number($event) })"
            />
          </div>
          <div>
            <span class="text-[10px] text-neutral-500">{{ t('tmcut.mask.rotation') }}</span>
            <USlider
              :aria-label="t('tmcut.mask.rotation')"
              :model-value="clip.mask.rotation"
              :min="-180"
              :max="180"
              :step="1"
              @update:model-value="maskPatch({ rotation: Number($event) })"
            />
          </div>
        </div>
        <div class="flex items-center justify-between">
          <!-- UCheckbox/USwitch render role on a button, which <label> cannot
               bind; the row is the click target and the switch stops
               propagation so a direct click toggles once. -->
          <div
            class="flex items-center gap-1.5 text-[10px] text-neutral-500 cursor-pointer select-none"
            @click="maskPatch({ invert: !clip.mask.invert })"
          >
            <USwitch
              :model-value="clip.mask.invert"
              :aria-label="t('tmcut.mask.invert')"
              size="sm"
              @click.stop
              @update:model-value="maskPatch({ invert: Boolean($event) })"
            />
            {{ t('tmcut.mask.invert') }}
          </div>
          <!-- Linear wipe direction — only meaningful for the linear shape -->
          <div v-if="clip.mask.shape === 'linear'" class="flex items-center gap-1.5">
            <span class="text-[10px] text-neutral-500">{{ t('tmcut.mask.axis') }}</span>
            <USelect
              :aria-label="t('tmcut.mask.axis')"
              :items="[
                { label: t('tmcut.mask.axis_x'), value: 'x' },
                { label: t('tmcut.mask.axis_y'), value: 'y' }
              ]"
              :model-value="clip.mask.axis || 'x'"
              size="xs"
              class="w-16"
              @update:model-value="maskPatch({ axis: String($event) })"
            />
          </div>
        </div>
      </template>
    </div>

    <!-- Video Stabilizer (Roadmap E-5, desktop only) -->
    <div v-if="currentTab === 'visual' && trackType === 'video' && isDesktop" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-activity" class="size-3.5 text-primary" />
          <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
            {{ t('tmcut.stabilize.title') }}
          </span>
        </div>
        <USwitch
          :model-value="!!clip.stabilize"
          :aria-label="t('tmcut.stabilize.title')"
          size="sm"
          @update:model-value="handleStabilizeToggle"
        />
      </div>

      <div v-if="clip.stabilize" class="space-y-2.5 p-2.5 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
        <div class="flex items-center justify-between text-[11px]">
          <span class="text-neutral-500 dark:text-neutral-400">{{ t('tmcut.stabilize.level') }}</span>
          <span v-if="clip.stabilizeStatus === 'ready'" class="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
            <UIcon name="i-lucide-check-circle" class="size-3" />
            {{ t('tmcut.stabilize.ready') }}
          </span>
          <span v-else-if="clip.stabilizeStatus === 'processing'" class="inline-flex items-center gap-1 text-[10px] text-amber-400 font-medium">
            <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" />
            {{ t('tmcut.stabilize.processing') }}
          </span>
          <span v-else-if="clip.stabilizeStatus === 'error'" class="inline-flex items-center gap-1 text-[10px] text-red-400 font-medium">
            <UIcon name="i-lucide-alert-circle" class="size-3" />
            {{ t('tmcut.stabilize.error') }}
          </span>
        </div>

        <USelect
          :aria-label="t('tmcut.stabilize.level')"
          :model-value="clip.stabilizeLevel || 'medium'"
          :items="stabilizeLevelOptions"
          :disabled="clip.stabilizeStatus === 'processing'"
          size="xs"
          class="w-full"
          @update:model-value="handleStabilizeLevelChange($event as TmcutStabilizeLevel)"
        />

        <UButton
          v-if="clip.stabilizeStatus !== 'ready' || !clip.stabilizedPath"
          icon="i-lucide-play"
          size="xs"
          variant="soft"
          color="primary"
          block
          :loading="clip.stabilizeStatus === 'processing'"
          :disabled="clip.stabilizeStatus === 'processing'"
          @click="runStabilization()"
        >
          {{ t('tmcut.stabilize.apply') }}
        </UButton>
      </div>
    </div>

    <!-- Transform Settings (Video & Text) -->
    <div v-if="currentTab === 'visual' && trackType !== 'audio'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between mb-1">
        <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
          {{ t('tmcut.inspectorProps.transform') }}
        </span>
        <span
          v-if="clipHasKeyframes"
          class="text-[9px] leading-none rounded bg-primary/15 text-primary px-1.5 py-0.5 flex items-center gap-1"
          :title="keyframesExportedHint"
        >
          <UIcon name="i-lucide-sparkles" class="w-3 h-3" />
          {{ t('tmcut.inspectorProps.keyframesExported') }}
        </span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="flex items-center justify-between">
            <label for="tmcut-insp-scale" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.scale') }}</label>
            <button
              type="button"
              class="rounded p-0.5 transition-colors"
              :class="hasKfAtPlayhead('scale') ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'"
              :title="kfTitle('scale')"
              @click="toggleKeyframe('scale')"
            >
              <UIcon name="i-lucide-diamond" class="size-3" />
            </button>
          </div>
          <UInput
            id="tmcut-insp-scale"
            type="number"
            :min="10"
            :max="300"
            :model-value="clip.scale || 100"
            size="xs"
            @update:model-value="handleUpdate('scale', Number($event))"
          />
        </div>
        <div>
          <div class="flex items-center justify-between">
            <label for="tmcut-insp-opacity" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.opacity') }}</label>
            <button
              type="button"
              class="rounded p-0.5 transition-colors"
              :class="hasKfAtPlayhead('opacity') ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'"
              :title="kfTitle('opacity')"
              @click="toggleKeyframe('opacity')"
            >
              <UIcon name="i-lucide-diamond" class="size-3" />
            </button>
          </div>
          <UInput
            id="tmcut-insp-opacity"
            type="number"
            :min="0"
            :max="100"
            :model-value="clip.opacity ?? 100"
            size="xs"
            @update:model-value="handleUpdate('opacity', Number($event))"
          />
        </div>
      </div>

      <!-- Rotation (A8 unlock by R12): exported for both tracks — video
           via the fit chain, text via the rotate+overlay pipeline. The
           export REQUIRES center align for rotated text (compiler guard
           + modal toast). -->
      <div>
        <div class="flex items-center justify-between">
          <span class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.rotation') }}</span>
          <span class="text-[10px] font-mono text-neutral-500 dark:text-neutral-400">{{ clip.rotation || 0 }}°</span>
        </div>
        <USlider
          :aria-label="t('tmcut.inspectorProps.rotation')"
          :model-value="clip.rotation || 0"
          :min="-180"
          :max="180"
          :step="1"
          :tooltip="true"
          class="mt-1.5"
          @update:model-value="handleUpdate('rotation', Number($event))"
        />
      </div>

      <!-- Blend mode (mock #2 "Hòa trộn"): how a clip composites over the
           track below it — the render pipeline maps it to FFmpeg blend
           (R116); 'normal' keeps the classic overlay. Video clips only:
           a text clip already composites via drawtext/overlay. -->
      <div v-if="trackType === 'video'">
        <span class="text-[10px] text-neutral-500 block mb-1">
          {{ t('tmcut.inspectorProps.blendMode') }}
        </span>
        <USelect
          :aria-label="t('tmcut.inspectorProps.blendMode')"
          :items="BLEND_OPTIONS"
          :model-value="blendMode"
          size="xs"
          @update:model-value="handleBlendUpdate(String($event))"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <div class="flex items-center justify-between">
            <label for="tmcut-insp-position-x" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.positionX') }}</label>
            <button
              type="button"
              class="rounded p-0.5 transition-colors"
              :class="hasKfAtPlayhead('x') ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'"
              :title="kfTitle('x')"
              @click="toggleKeyframe('x')"
            >
              <UIcon name="i-lucide-diamond" class="size-3" />
            </button>
          </div>
          <UInput
            id="tmcut-insp-position-x"
            type="number"
            :model-value="clip.x || 0"
            size="xs"
            @update:model-value="handleUpdate('x', Number($event))"
          />
        </div>
        <div>
          <div class="flex items-center justify-between">
            <label for="tmcut-insp-position-y" class="text-[10px] text-neutral-500">{{ t('tmcut.inspectorProps.positionY') }}</label>
            <button
              type="button"
              class="rounded p-0.5 transition-colors"
              :class="hasKfAtPlayhead('y') ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'"
              :title="kfTitle('y')"
              @click="toggleKeyframe('y')"
            >
              <UIcon name="i-lucide-diamond" class="size-3" />
            </button>
          </div>
          <UInput
            id="tmcut-insp-position-y"
            type="number"
            :model-value="clip.y || 0"
            size="xs"
            @update:model-value="handleUpdate('y', Number($event))"
          />
        </div>
      </div>
    </div>

    <!-- Color Grade (EQ / Grade) -->
    <div v-if="currentTab === 'visual' && trackType !== 'audio'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between mb-1">
        <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">{{ t('tmcut.inspectorProps.colorGrade') }}</span>
      </div>
      <div class="space-y-2">
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-brightness">{{ t('tmcut.inspectorProps.brightness') }}</label>
            <span class="font-mono text-[10px]">{{ eqBrightness }}</span>
          </div>
          <input
            id="tmcut-eq-brightness"
            type="range"
            min="-100"
            max="100"
            :value="eqBrightness"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('brightness', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-contrast">{{ t('tmcut.inspectorProps.contrast') }}</label>
            <span class="font-mono text-[10px]">{{ eqContrast }}</span>
          </div>
          <input
            id="tmcut-eq-contrast"
            type="range"
            min="0"
            max="200"
            :value="eqContrast"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('contrast', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-saturation">{{ t('tmcut.inspectorProps.saturation') }}</label>
            <span class="font-mono text-[10px]">{{ eqSaturation }}</span>
          </div>
          <input
            id="tmcut-eq-saturation"
            type="range"
            min="0"
            max="200"
            :value="eqSaturation"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('saturation', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <!-- Color Temp (mock #2: "-12 (Lạnh)"): negative = cooler (blue),
             positive = warmer (amber); export maps it to FFmpeg
             colorbalance (core), preview approximates with sepia/hue. -->
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-colorTemp">{{ t('tmcut.inspectorProps.colorTemp') }}</label>
            <span class="font-mono text-[10px]">
              {{ tempValue }}
              {{ tempValue < 0 ? t('tmcut.inspectorProps.tempCool') : tempValue > 0 ? t('tmcut.inspectorProps.tempWarm') : '' }}
            </span>
          </div>
          <input
            id="tmcut-eq-colorTemp"
            type="range"
            min="-100"
            max="100"
            :value="tempValue"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('temp', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <!-- R128 grading sliders: same lazy-create + coalesced-history path
             as the sliders above (ensureEqGradeAndUpdate). -->
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-hue">{{ t('tmcut.inspectorProps.hue') }}</label>
            <span class="font-mono text-[10px]">{{ eqHue }}°</span>
          </div>
          <input
            id="tmcut-eq-hue"
            type="range"
            min="-180"
            max="180"
            :value="eqHue"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('hue', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-gamma">{{ t('tmcut.inspectorProps.gamma') }}</label>
            <span class="font-mono text-[10px]">{{ eqGamma }}</span>
          </div>
          <input
            id="tmcut-eq-gamma"
            type="range"
            min="10"
            max="300"
            :value="eqGamma"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('gamma', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-fade">{{ t('tmcut.inspectorProps.fade') }}</label>
            <span class="font-mono text-[10px]">{{ eqFade }}</span>
          </div>
          <input
            id="tmcut-eq-fade"
            type="range"
            min="0"
            max="100"
            :value="eqFade"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('fade', Number((e.target as HTMLInputElement).value))"
          >
        </div>
        <div>
          <div class="flex justify-between text-[10px] text-neutral-500 mb-1">
            <label for="tmcut-eq-vibrance">{{ t('tmcut.inspectorProps.vibrance') }}</label>
            <span class="font-mono text-[10px]">{{ eqVibrance }}</span>
          </div>
          <input
            id="tmcut-eq-vibrance"
            type="range"
            min="-100"
            max="100"
            :value="eqVibrance"
            class="w-full accent-primary"
            @input="e => ensureEqGradeAndUpdate('vibrance', Number((e.target as HTMLInputElement).value))"
          >
        </div>
      </div>
    </div>

    <!-- Audio / Volume Settings -->
    <div v-if="currentTab === 'audio'" class="space-y-2 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">{{
          t('tmcut.inspectorProps.volume') }}</span>
        <div class="flex items-center gap-1.5">
          <span
            v-if="clipHasKeyframes"
            class="text-[9px] leading-none rounded bg-primary/15 text-primary px-1.5 py-0.5 flex items-center gap-1"
            :title="keyframesExportedHint"
          >
            <UIcon name="i-lucide-sparkles" class="w-3 h-3" />
            {{ t('tmcut.inspectorProps.keyframesExported') }}
          </span>
          <span
            v-if="!isDesktop"
            class="text-[9px] leading-none rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 px-1.5 py-0.5"
          >
            {{ t('tmcut.inspectorProps.webPreviewOnly') }}
          </span>
          <!-- Keyframe toggle: only for VIDEO clips — a timeline audio
               clip has no preview engine yet, so a keyframe there would
               change nothing visible (dead control, roadmap B1). -->
          <button
            v-if="trackType === 'video'"
            type="button"
            class="rounded p-0.5 transition-colors"
            :class="hasKfAtPlayhead('volume') ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300'"
            :title="kfTitle('volume')"
            @click="toggleKeyframe('volume')"
          >
            <UIcon name="i-lucide-diamond" class="size-3" />
          </button>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-volume-2" class="size-4 text-neutral-500 dark:text-neutral-400 shrink-0" />
        <input
          id="tmcut-insp-volume"
          :aria-label="t('tmcut.inspectorProps.volume')"
          type="range"
          min="0"
          max="150"
          :value="clip.volume ?? 100"
          class="w-full accent-primary cursor-pointer"
          @input="handleUpdate('volume', Number(($event.target as HTMLInputElement).value))"
        >
        <span class="font-mono text-xs w-10 text-right">{{ clip.volume ?? 100 }}%</span>
      </div>

      <!-- Fade in/out (roadmap C12): toggle a 0.5s envelope per edge, the
           slider appears while active. The preview ramps through core
           gainAt; export follows with the compiler round (R5), the same
           gap family as the volume slider above. -->
      <div class="space-y-1.5 pt-1">
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded px-2 py-1 text-[11px] transition-colors shrink-0"
            :class="fadeInTicks > 0 ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-400 bg-neutral-200/60 dark:bg-neutral-800/60 hover:text-neutral-700 dark:hover:text-neutral-200'"
            :title="t('tmcut.inspectorProps.fadeIn')"
            @click="toggleFade('in')"
          >
            {{ t('tmcut.inspectorProps.fadeIn') }}
          </button>
          <template v-if="fadeInTicks > 0">
            <input
              id="tmcut-insp-fade-in"
              :aria-label="t('tmcut.inspectorProps.fadeIn')"
              type="range"
              min="0"
              :max="maxFadeSec"
              step="0.1"
              :value="fadeInTicks / TICKS_PER_SECOND"
              class="w-full accent-primary cursor-pointer"
              @input="handleFadeUpdate('in', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="font-mono text-xs w-10 text-right">{{ (fadeInTicks / TICKS_PER_SECOND).toFixed(1) }}s</span>
          </template>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded px-2 py-1 text-[11px] transition-colors shrink-0"
            :class="fadeOutTicks > 0 ? 'text-primary bg-primary/15' : 'text-neutral-500 dark:text-neutral-400 bg-neutral-200/60 dark:bg-neutral-800/60 hover:text-neutral-700 dark:hover:text-neutral-200'"
            :title="t('tmcut.inspectorProps.fadeOut')"
            @click="toggleFade('out')"
          >
            {{ t('tmcut.inspectorProps.fadeOut') }}
          </button>
          <template v-if="fadeOutTicks > 0">
            <input
              id="tmcut-insp-fade-out"
              :aria-label="t('tmcut.inspectorProps.fadeOut')"
              type="range"
              min="0"
              :max="maxFadeSec"
              step="0.1"
              :value="fadeOutTicks / TICKS_PER_SECOND"
              class="w-full accent-primary cursor-pointer"
              @input="handleFadeUpdate('out', Number(($event.target as HTMLInputElement).value))"
            >
            <span class="font-mono text-xs w-10 text-right">{{ (fadeOutTicks / TICKS_PER_SECOND).toFixed(1) }}s</span>
          </template>
        </div>
      </div>
    </div>

    <!-- Text effects tab (roadmap đợt 2): exactly the three looks the drawtext
         export renders — shadow, outline, background plate. Colours are
         optional fields, so an untouched text keeps the legacy black look. -->
    <div v-if="currentTab === 'effects' && trackType === 'text'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
        {{ t('tmcut.textFx.title') }}
      </span>

      <div class="space-y-2">
        <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
          <div class="flex items-center gap-1.5 min-w-0">
            <UIcon name="i-lucide-copy" class="size-3.5 shrink-0" :class="clip.shadow ? 'text-primary' : 'text-neutral-500'" />
            <span class="text-[11px] truncate">{{ t('tmcut.textFx.shadow') }}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <input
              v-if="clip.shadow"
              id="tmcut-text-shadow-color"
              type="color"
              :value="clip.shadowColor || '#000000'"
              class="w-6 h-6 rounded border border-neutral-400 dark:border-neutral-700 bg-transparent cursor-pointer"
              :aria-label="t('tmcut.textFx.color')"
              @input="handleUpdate('shadowColor', ($event.target as HTMLInputElement).value)"
            >
            <USwitch
              :model-value="!!clip.shadow"
              size="sm"
              :aria-label="t('tmcut.textFx.shadow')"
              @update:model-value="handleStyleToggle('shadow')"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
          <div class="flex items-center gap-1.5 min-w-0">
            <UIcon name="i-lucide-type-outline" class="size-3.5 shrink-0" :class="clip.stroke ? 'text-primary' : 'text-neutral-500'" />
            <span class="text-[11px] truncate">{{ t('tmcut.textFx.stroke') }}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <input
              v-if="clip.stroke"
              id="tmcut-text-stroke-color"
              type="color"
              :value="clip.strokeColor || '#000000'"
              class="w-6 h-6 rounded border border-neutral-400 dark:border-neutral-700 bg-transparent cursor-pointer"
              :aria-label="t('tmcut.textFx.color')"
              @input="handleUpdate('strokeColor', ($event.target as HTMLInputElement).value)"
            >
            <USwitch
              :model-value="!!clip.stroke"
              size="sm"
              :aria-label="t('tmcut.textFx.stroke')"
              @update:model-value="handleStyleToggle('stroke')"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 p-2 rounded-lg bg-neutral-100/60 dark:bg-neutral-900/60 border border-neutral-300/80 dark:border-neutral-800/80">
          <div class="flex items-center gap-1.5 min-w-0">
            <UIcon name="i-lucide-square" class="size-3.5 shrink-0" :class="clip.bgColor ? 'text-primary' : 'text-neutral-500'" />
            <span class="text-[11px] truncate">{{ t('tmcut.textFx.plate') }}</span>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <input
              v-if="clip.bgColor"
              id="tmcut-text-plate-color"
              type="color"
              :value="clip.bgColor"
              class="w-6 h-6 rounded border border-neutral-400 dark:border-neutral-700 bg-transparent cursor-pointer"
              :aria-label="t('tmcut.textFx.plateColor')"
              @input="handleUpdate('bgColor', ($event.target as HTMLInputElement).value)"
            >
            <USwitch
              :model-value="!!clip.bgColor"
              size="sm"
              :aria-label="t('tmcut.textFx.plate')"
              @update:model-value="toggleTextPlate"
            />
          </div>
        </div>
      </div>

      <p class="text-[10px] text-neutral-500 leading-snug">
        {{ t('tmcut.textFx.hint') }}
      </p>
    </div>

    <!-- Effects Tab (Roadmap Phase E, C6 registry). Video only: these are
         IMAGE effects (FFmpeg filter chains on the footage). Text has its own
         export-true effect panel below instead of pretending a LUT can grade
         drawtext glyphs. -->
    <div v-if="currentTab === 'effects' && trackType === 'video'" class="space-y-4 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
          {{ t('tmcut.effects.title') }}
        </span>
        <UDropdownMenu :items="effectMenuItems" :content="{ side: 'bottom', align: 'end' }">
          <UButton
            icon="i-lucide-plus"
            size="xs"
            color="primary"
            variant="soft"
            :label="t('tmcut.effects.addEffect')"
          />
        </UDropdownMenu>
      </div>

      <!-- Empty State -->
      <div
        v-if="clipEffects.length === 0"
        class="py-8 text-center text-neutral-500 space-y-2 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-lg p-4"
      >
        <UIcon name="i-lucide-sparkles" class="size-6 mx-auto text-neutral-500 dark:text-neutral-600" />
        <p class="text-xs text-neutral-600 dark:text-neutral-300 font-medium">
          {{ t('tmcut.effects.noEffects') }}
        </p>
        <p class="text-[11px] text-neutral-500 leading-relaxed">
          {{ t('tmcut.effects.noEffectsHint') }}
        </p>
      </div>

      <!-- Effects Cards List -->
      <div v-else class="space-y-3">
        <div
          v-for="(eff, idx) in clipEffects"
          :key="`${eff.type}-${idx}`"
          class="rounded-lg border border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-900/60 p-3 space-y-3"
        >
          <!-- Card Header -->
          <div class="flex items-center justify-between gap-2 border-b border-neutral-300/80 dark:border-neutral-800/80 pb-2">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon :name="effectIcon(eff.type)" class="size-4 text-primary shrink-0" />
              <span class="font-medium text-xs text-neutral-800 dark:text-neutral-100 truncate">
                {{ effectLabel(eff.type) }}
              </span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                icon="i-lucide-rotate-ccw"
                size="xs"
                color="neutral"
                variant="ghost"
                :title="t('tmcut.effects.reset')"
                @click="handleResetEffect(idx)"
              />
              <UButton
                icon="i-lucide-trash"
                size="xs"
                color="error"
                variant="ghost"
                :title="t('tmcut.effects.remove')"
                @click="handleRemoveEffect(idx)"
              />
            </div>
          </div>

          <!-- Live look preview (the same registry-driven tile the library
               grid uses, so the applied parameters drive the animation). An
               effect with no adapter says "no preview" instead of animating
               something the export will not produce. -->
          <TmcutFxThumb
            kind="effect"
            :type="eff.type"
            :params="eff.params"
            active
          />

          <!-- Parameter Controls based on EFFECT_REGISTRY[eff.type].params -->
          <div class="space-y-2.5">
            <div
              v-for="param in getEffectParams(eff.type)"
              :key="param.name"
              class="space-y-1"
            >
              <div class="flex items-center justify-between text-[11px]">
                <!-- number/color params own a labelable native control, so the
                     caption can be a real <label>. enum/bool render Reka button
                     roots (role=combobox / role=switch), which <label for>
                     cannot bind — those get a plain caption plus aria-label. -->
                <label
                  v-if="param.kind === 'number' || param.kind === 'color'"
                  :for="`tmcut-fx-${idx}-${param.name}`"
                  class="text-neutral-500 dark:text-neutral-400"
                >
                  {{ paramLabel(param.name) }}
                </label>
                <span v-else class="text-neutral-500 dark:text-neutral-400">
                  {{ paramLabel(param.name) }}
                </span>
                <span class="font-mono text-neutral-600 dark:text-neutral-300">
                  {{ eff.params[param.name] }}
                </span>
              </div>

              <!-- Number Param Slider -->
              <div v-if="param.kind === 'number'" class="flex items-center gap-2">
                <input
                  :id="`tmcut-fx-${idx}-${param.name}`"
                  type="range"
                  :min="param.min ?? 0"
                  :max="param.max ?? 100"
                  :step="1"
                  :value="eff.params[param.name] ?? param.default"
                  class="w-full accent-primary cursor-pointer"
                  @input="handleUpdateEffectParam(idx, param.name, Number(($event.target as HTMLInputElement).value))"
                >
              </div>

              <!-- Enum Param Select -->
              <div v-else-if="param.kind === 'enum'" class="pt-0.5">
                <USelect
                  :model-value="String(eff.params[param.name] ?? param.default)"
                  :aria-label="paramLabel(param.name)"
                  :items="param.options?.map(opt => ({ label: opt, value: opt })) || []"
                  size="xs"
                  class="w-full"
                  @update:model-value="handleUpdateEffectParam(idx, param.name, $event)"
                />
              </div>

              <!-- Color Param Input -->
              <div v-else-if="param.kind === 'color'" class="flex items-center gap-2 pt-0.5">
                <input
                  :id="`tmcut-fx-${idx}-${param.name}`"
                  type="color"
                  :value="String(eff.params[param.name] ?? param.default ?? '#00ff00')"
                  class="size-6 rounded border border-neutral-400 dark:border-neutral-700 bg-transparent cursor-pointer p-0 shrink-0"
                  @input="handleUpdateEffectParam(idx, param.name, ($event.target as HTMLInputElement).value)"
                >
                <UInput
                  :id="`tmcut-fx-${idx}-${param.name}-hex`"
                  :aria-label="paramLabel(param.name)"
                  :model-value="String(eff.params[param.name] ?? param.default ?? '#00ff00')"
                  size="xs"
                  class="flex-1 font-mono"
                  @update:model-value="handleUpdateEffectParam(idx, param.name, $event)"
                />
              </div>

              <!-- Bool Param Switch -->
              <div v-else-if="param.kind === 'bool'" class="flex items-center justify-between pt-0.5">
                <USwitch
                  :model-value="Boolean(eff.params[param.name] ?? param.default)"
                  :aria-label="paramLabel(param.name)"
                  size="sm"
                  @update:model-value="handleUpdateEffectParam(idx, param.name, $event)"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Filters Tab: LUT grades for the selected media clip (right panel) -->
    <div v-if="currentTab === 'filters' && trackType === 'video'" class="space-y-3 pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <div class="flex items-center justify-between">
        <span class="font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider text-[10px]">
          {{ t('tmcut.inspectorProps.filtersTitle') }}
        </span>
        <UButton
          v-if="activeFilter"
          icon="i-lucide-rotate-ccw"
          size="xs"
          color="neutral"
          variant="ghost"
          :title="t('tmcut.inspectorProps.filtersClear')"
          @click="clearFilter"
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button
          v-for="preset in lutPresets"
          :key="preset"
          type="button"
          class="flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer"
          :class="activeFilter === preset
            ? 'border-primary bg-primary/10'
            : 'border-neutral-300 dark:border-neutral-800 bg-neutral-100/60 dark:bg-neutral-950/60 hover:border-primary/60'"
          @click="applyFilter(preset)"
        >
          <TmcutFxThumb kind="filter" :type="preset" :active="activeFilter === preset" />
          <span class="flex items-center gap-1 px-0.5 w-full">
            <span class="text-[10px] font-medium text-neutral-700 dark:text-neutral-200 truncate flex-1">
              {{ filterLabel(preset) }}
            </span>
            <UIcon v-if="activeFilter === preset" name="i-lucide-check" class="size-3 text-primary shrink-0" />
          </span>
        </button>
      </div>
      <p class="text-[10px] text-neutral-500 leading-snug">
        {{ t('tmcut.inspectorProps.filtersHint') }}
      </p>
    </div>

    <!-- Actions -->
    <div class="pt-4 border-t border-neutral-300 dark:border-neutral-800">
      <UButton
        icon="i-lucide-trash"
        color="error"
        variant="soft"
        block
        size="xs"
        @click="handleDelete"
      >
        {{ t('tmcut.inspectorProps.deleteClip') }}
      </UButton>
    </div>
  </div>

  <div v-else class="text-xs select-none">
    <!-- Project details header -->
    <div class="flex items-center gap-2 pb-3 border-b border-neutral-300 dark:border-neutral-800">
      <UIcon name="i-lucide-clapperboard" class="size-4 shrink-0 text-primary" />
      <span class="font-medium text-neutral-800 dark:text-neutral-100 truncate text-sm">
        {{ currentProject?.name || t('tmcut.project') }}
      </span>
    </div>

    <!-- Detail rows (CapCut-style details panel) -->
    <div class="py-2 divide-y divide-neutral-200/60 dark:divide-neutral-800/60">
      <div v-for="row in detailRows" :key="row.label" class="flex items-start justify-between gap-3 py-1.5">
        <span class="text-neutral-500 shrink-0">{{ row.label }}</span>
        <span class="text-neutral-700 dark:text-neutral-200 text-right break-all font-mono text-[11px]">{{ row.value }}</span>
      </div>
      <div class="flex items-start justify-between gap-3 py-1.5">
        <span class="text-neutral-500 shrink-0">{{ t('tmcut.details.saveState') }}</span>
        <span class="text-right text-[11px]" :class="saveStatus === 'error' ? 'text-red-400' : 'text-emerald-400'">
          {{ saveStateLabel }}
        </span>
      </div>
    </div>

    <!-- Storage path -->
    <div v-if="storagePath" class="pt-2 border-t border-neutral-300 dark:border-neutral-800">
      <p class="text-[10px] text-neutral-500 mb-1">
        {{ t('tmcut.details.storage') }}
      </p>
      <p class="font-mono text-[10px] text-neutral-500 dark:text-neutral-400 break-all leading-relaxed">
        {{ storagePath }}
      </p>
    </div>

    <p class="text-neutral-500 text-[11px] text-center pt-4">
      {{ t('tmcut.inspectorProps.noClipSelected') }}
    </p>
  </div>
</template>
