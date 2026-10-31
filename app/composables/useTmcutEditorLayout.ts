import { computed, ref, type ComputedRef } from 'vue'

export type TmcutLayoutPanel = 'media' | 'inspector' | 'timeline'

const LAYOUT_DEFAULTS: Record<TmcutLayoutPanel, number> = { media: 384, inspector: 288, timeline: 288 }
const LAYOUT_LIMITS: Record<TmcutLayoutPanel, readonly [number, number]> = {
  media: [264, 560],
  inspector: [264, 480],
  timeline: [200, 560]
}

const mediaWidth = ref(LAYOUT_DEFAULTS.media)
const inspectorWidth = ref(LAYOUT_DEFAULTS.inspector)
const timelineHeight = ref(LAYOUT_DEFAULTS.timeline)

function layoutValue(panel: TmcutLayoutPanel) {
  if (panel === 'media') return mediaWidth.value
  if (panel === 'inspector') return inspectorWidth.value
  return timelineHeight.value
}

function setLayout(panel: TmcutLayoutPanel, value: number) {
  const [min, max] = LAYOUT_LIMITS[panel]
  const upper = panel === 'timeline' ? Math.min(max, Math.round(window.innerHeight * 0.55)) : max
  const next = Math.round(Math.min(upper, Math.max(min, value)))
  if (panel === 'media') mediaWidth.value = next
  else if (panel === 'inspector') inspectorWidth.value = next
  else timelineHeight.value = next
}

function persistLayout(panel: TmcutLayoutPanel) {
  localStorage.setItem(`tmcut:layout:${panel}`, String(layoutValue(panel)))
}

function startResize(panel: TmcutLayoutPanel, event: PointerEvent) {
  event.preventDefault()
  const startX = event.clientX
  const startY = event.clientY
  const startValue = layoutValue(panel)
  const move = (e: PointerEvent) => {
    const delta = panel === 'timeline' ? startY - e.clientY : panel === 'inspector' ? startX - e.clientX : e.clientX - startX
    setLayout(panel, startValue + delta)
  }
  const finish = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', finish)
    persistLayout(panel)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', finish, { once: true })
}

function nudgeResize(panel: TmcutLayoutPanel, event: KeyboardEvent) {
  const step = event.shiftKey ? 40 : 16
  const grow = panel === 'timeline'
    ? event.key === 'ArrowUp'
    : event.key === (panel === 'inspector' ? 'ArrowLeft' : 'ArrowRight')
  const shrink = panel === 'timeline'
    ? event.key === 'ArrowDown'
    : event.key === (panel === 'inspector' ? 'ArrowRight' : 'ArrowLeft')
  if (!grow && !shrink) return
  event.preventDefault()
  event.stopPropagation()
  setLayout(panel, layoutValue(panel) + (grow ? step : -step))
  persistLayout(panel)
}

function resetLayout(panel: TmcutLayoutPanel) {
  setLayout(panel, LAYOUT_DEFAULTS[panel])
  persistLayout(panel)
}

/** Restores dock sizes saved by a previous session (call from onMounted). */
function hydrateLayout() {
  if (typeof window === 'undefined') return
  for (const panel of ['media', 'inspector', 'timeline'] as const) {
    const stored = Number(localStorage.getItem(`tmcut:layout:${panel}`))
    if (Number.isFinite(stored) && stored > 0) setLayout(panel, stored)
  }
}

const layoutVars: ComputedRef<Record<string, string>> = computed(() => ({
  '--tmcut-media-w': `${mediaWidth.value}px`,
  '--tmcut-inspector-w': `${inspectorWidth.value}px`
}))

export function useTmcutEditorLayout() {
  return {
    mediaWidth,
    inspectorWidth,
    timelineHeight,
    layoutVars,
    layoutValue,
    setLayout,
    persistLayout,
    startResize,
    nudgeResize,
    resetLayout,
    hydrateLayout
  }
}
