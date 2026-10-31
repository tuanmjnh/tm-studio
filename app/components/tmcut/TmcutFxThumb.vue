<script setup lang="ts">
// =============================================================================
//  FX preview tile (Roadmap v1 §6 — registry-driven, honest, cheap).
//
//  The component owns only PRESENTATION: the demo plates, the keyframes the
//  resolver names, and WHEN motion runs. Which preview a definition gets — and
//  what it is allowed to claim — comes from `fxPreview`/`@tmcut-core`, so a
//  tile can never advertise a look the export does not produce, and adding a
//  registry entry never means editing a switch here.
//
//  Motion policy (§6.3/§6.4):
//   - offscreen or reduced motion  -> the rest frame, no animation at all
//   - in view -> the reveal loops slowly: a transition / time-varying effect
//     IS motion, a static grade sweeps the before/after comparison and a
//     filter shows the graded plate against the original
//   - hover / focus / `active` -> keeps the fidelity badge on screen
//   - an unknown definition -> an explicit "no preview" state, not a guess
//
//  No external assets: both demo scenes are inline SVG data URIs, so there is
//  nothing to lazy-load and no layout shift.
// =============================================================================
import { computed, onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue'
import { useI18n } from 'vue-i18n'
import { resolveFxPreview, type FxPreviewKind } from '~/utils/tmcut/fxPreview'

const props = withDefaults(defineProps<{
  kind: FxPreviewKind
  /** Registry effect type / lut3d preset id / transition key (the stable id). */
  type: string
  /** Effect params; clamped through the core descriptor by the resolver. */
  params?: Record<string, unknown>
  /** The definition is selected/applied: keep its reveal visible without hover. */
  active?: boolean
  reducedMotion?: boolean
  showBadge?: boolean
}>(), {
  params: () => ({}),
  active: false,
  reducedMotion: false,
  showBadge: true
})

const { t } = useI18n()

// --- Demo plates -------------------------------------------------------------
// Scene A: bright day mountains. Scene B: purple night skyline — deliberately
// different silhouettes + palette so a transition's two sides never read alike.
const SCENE_A = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">'
  + '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#7dd3fc"/><stop offset=".55" stop-color="#e0f2fe"/><stop offset="1" stop-color="#fde68a"/>'
  + '</linearGradient></defs>'
  + '<rect width="160" height="90" fill="url(#s)"/>'
  + '<circle cx="118" cy="24" r="10" fill="#fbbf24"/>'
  + '<path d="M0 90 L42 40 L84 90 Z" fill="#334155"/>'
  + '<path d="M58 90 L106 46 L154 90 Z" fill="#1e293b"/>'
  + '<rect y="72" width="160" height="18" fill="#155e75"/>'
  + '<path d="M98 72 L98 60 L108 72 Z" fill="#f8fafc"/>'
  + '</svg>'
)}")`

const SCENE_B = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">'
  + '<defs><linearGradient id="b" x1="0" y1="0" x2="0" y2="1">'
  + '<stop offset="0" stop-color="#312e81"/><stop offset=".5" stop-color="#7c3aed"/><stop offset="1" stop-color="#f472b6"/>'
  + '</linearGradient></defs>'
  + '<rect width="160" height="90" fill="url(#b)"/>'
  + '<circle cx="34" cy="24" r="9" fill="#fde68a"/>'
  + '<rect x="10" y="46" width="18" height="44" fill="#1e1b4b"/>'
  + '<rect x="34" y="34" width="22" height="56" fill="#312e81"/>'
  + '<rect x="62" y="52" width="16" height="38" fill="#1e1b4b"/>'
  + '<rect x="84" y="40" width="24" height="50" fill="#4c1d95"/>'
  + '<rect x="114" y="56" width="18" height="34" fill="#1e1b4b"/>'
  + '<rect x="138" y="44" width="20" height="46" fill="#312e81"/>'
  + '<rect y="84" width="160" height="6" fill="#0f172a"/>'
  + '</svg>'
)}")`

const scenes = { a: SCENE_A, b: SCENE_B }

// --- Lifecycle ---------------------------------------------------------------
const root = ref<HTMLElement | null>(null)
const inView = ref(false)
const revealed = ref(false)
const systemReduced = ref(false)

let observer: IntersectionObserver | null = null
let reducedQuery: MediaQueryList | null = null
let reducedHandler: ((event: MediaQueryListEvent) => void) | null = null

const motionAllowed = computed(() => inView.value && !props.reducedMotion && !systemReduced.value)
// Library tiles are live previews: every visible definition plays its reveal
// on a slow loop (a static grade compares against the plate, a filter sweeps
// the before/after). Off-screen tiles are paused by the observer, and the OS
// reduced-motion preference still wins. `active`/`revealed` only decide when
// the fidelity badge shows now that motion is no longer hover-gated.
const animate = computed(() => motionAllowed.value)

const preview = computed(() => resolveFxPreview(props.kind, props.type, props.params, {
  scenes,
  animate: animate.value
}))

/** `paused` instead of removed when motion merely stopped: no repaint storm. */
const layerStyle = (layer: CSSProperties): CSSProperties => ({
  ...layer,
  ...(motionAllowed.value ? {} : { animationPlayState: 'paused' })
})

// --- Honest disclosure (§5.6 / §6.4: never colour-only) ----------------------
interface FxThumbBadge { icon: string, key: string, tone: 'neutral' | 'warning', urgent: boolean }

/**
 * `urgent` marks the caveats a user can be misled by — an illustrative demo or
 * an effect the export will drop — so those stay on screen. "Approximate" is
 * the ordinary case and only shows on hover/focus, to keep a 2-column grid
 * readable.
 */
const badge = computed<FxThumbBadge | null>(() => {
  if (!props.showBadge || !preview.value.status.known) return null
  const { fidelity, exportSupported } = preview.value.status
  let info: FxThumbBadge | null = null
  if (!exportSupported) info = { icon: 'i-lucide-triangle-alert', key: 'tmcut.fxThumb.exportUnsupported', tone: 'warning', urgent: true }
  else if (fidelity === 'illustrative') info = { icon: 'i-lucide-lightbulb', key: 'tmcut.fxThumb.fidelityIllustrative', tone: 'neutral', urgent: true }
  else if (fidelity === 'approximate') info = { icon: 'i-lucide-eye', key: 'tmcut.fxThumb.fidelityApproximate', tone: 'neutral', urgent: false }
  if (!info) return null
  return info.urgent || revealed.value || props.active ? info : null
})

onMounted(() => {
  const el = root.value
  // No observer (SSR fallback, old browser, jsdom) => treat as visible: the
  // tile behaves like it did before lazy motion existed.
  if (!el || typeof IntersectionObserver === 'undefined') {
    inView.value = true
  } else {
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) inView.value = entry.isIntersecting
    }, { threshold: 0.15 })
    observer.observe(el)
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    systemReduced.value = query.matches
    // Keep the handle: a library grid mounts dozens of tiles and each one used
    // to leave a change listener behind after unmount.
    reducedHandler = (event) => {
      systemReduced.value = event.matches
    }
    query.addEventListener?.('change', reducedHandler)
    reducedQuery = query
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  if (reducedQuery && reducedHandler) reducedQuery.removeEventListener?.('change', reducedHandler)
  reducedQuery = null
  reducedHandler = null
})
</script>

<template>
  <!-- Deterministic 16:9 box: the tile reserves its shape before paint, so a
       library grid never shifts when previews resolve. -->
  <div
    ref="root"
    class="tmcut-fxthumb relative w-full overflow-hidden rounded-md aspect-[16/9] bg-neutral-800 isolate ring-1 ring-black/10 dark:ring-white/10"
    style="--tmfx-dur: 3s"
    @pointerenter="revealed = true"
    @pointerleave="revealed = false"
  >
    <!-- Unknown definition: say so instead of inventing an animation. -->
    <div
      v-if="!preview.status.known"
      class="absolute inset-0 flex items-center justify-center gap-1 px-1 text-[9px] leading-tight text-neutral-400"
    >
      <UIcon name="i-lucide-circle-question-mark" class="size-3 shrink-0" />
      <span class="truncate">{{ t('tmcut.fxThumb.noPreview') }}</span>
    </div>

    <template v-else>
      <div
        v-for="(layer, i) in preview.layers"
        :key="`${type}-${i}`"
        class="absolute inset-0 pointer-events-none"
        :style="layerStyle(layer)"
      />
    </template>

    <span
      v-if="badge"
      class="absolute bottom-0.5 left-0.5 max-w-[calc(100%-4px)] inline-flex items-center gap-0.5 rounded px-1 py-px text-[8px] font-medium leading-none bg-black/60 text-neutral-100"
      :class="badge.tone === 'warning' ? 'text-amber-300' : ''"
      :title="t(badge.key)"
    >
      <UIcon :name="badge.icon" class="size-2.5 shrink-0" aria-hidden="true" />
      <span class="truncate">{{ t(badge.key) }}</span>
    </span>
  </div>
</template>

<style>
/* Keyframes are package-global (tmfx-prefixed) because the names arrive from
   inline :style, which scoped CSS cannot rewrite. The coverage spec fails if
   this list and `usedAnimationNames()` in fxPreview.ts drift apart. */

/* Transitions — scene B in/hold/out so the loop reads as a repeating cut. */
@keyframes tmfxt-fade { 0% { opacity: 0 } 55% { opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }
@keyframes tmfxt-out { 0% { opacity: 1 } 55% { opacity: 0 } 80% { opacity: 0 } 100% { opacity: 1 } }
@keyframes tmfxt-flash { 0% { opacity: 0 } 55% { opacity: 1 } 80% { opacity: 1 } 100% { opacity: 0 } }

@keyframes tmfxt-wipe-x { 0% { clip-path: inset(0 100% 0 0) } 55% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 100% { clip-path: inset(0 100% 0 0) } }
@keyframes tmfxt-wipe-y { 0% { clip-path: inset(100% 0 0 0) } 55% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 100% { clip-path: inset(100% 0 0 0) } }

@keyframes tmfxt-diag-tl { 0% { clip-path: polygon(0 0, 0 0, 0 0) } 55% { clip-path: polygon(0 0, 100% 0, 0 100%) } 80% { clip-path: polygon(0 0, 100% 0, 0 100%) } 100% { clip-path: polygon(0 0, 0 0, 0 0) } }
@keyframes tmfxt-diag-tr { 0% { clip-path: polygon(100% 0, 100% 0, 100% 0) } 55% { clip-path: polygon(100% 0, 0 0, 100% 100%) } 80% { clip-path: polygon(100% 0, 0 0, 100% 100%) } 100% { clip-path: polygon(100% 0, 100% 0, 100% 0) } }
@keyframes tmfxt-diag-bl { 0% { clip-path: polygon(0 100%, 0 100%, 0 100%) } 55% { clip-path: polygon(0 100%, 0 0, 100% 100%) } 80% { clip-path: polygon(0 100%, 0 0, 100% 100%) } 100% { clip-path: polygon(0 100%, 0 100%, 0 100%) } }
@keyframes tmfxt-diag-br { 0% { clip-path: polygon(100% 100%, 100% 100%, 100% 100%) } 55% { clip-path: polygon(100% 100%, 100% 0, 0 100%) } 80% { clip-path: polygon(100% 100%, 100% 0, 0 100%) } 100% { clip-path: polygon(100% 100%, 100% 100%, 100% 100%) } }

@keyframes tmfxt-slide-a-x { 0% { transform: translateX(0) } 55% { transform: translateX(-100%) } 80% { transform: translateX(-100%) } 100% { transform: translateX(0) } }
@keyframes tmfxt-slide-b-x { 0% { transform: translateX(100%) } 55% { transform: translateX(0) } 80% { transform: translateX(0) } 100% { transform: translateX(100%) } }
@keyframes tmfxt-slide-a-xr { 0% { transform: translateX(0) } 55% { transform: translateX(100%) } 80% { transform: translateX(100%) } 100% { transform: translateX(0) } }
@keyframes tmfxt-slide-b-xr { 0% { transform: translateX(-100%) } 55% { transform: translateX(0) } 80% { transform: translateX(0) } 100% { transform: translateX(-100%) } }
@keyframes tmfxt-slide-a-y { 0% { transform: translateY(0) } 55% { transform: translateY(-100%) } 80% { transform: translateY(-100%) } 100% { transform: translateY(0) } }
@keyframes tmfxt-slide-b-y { 0% { transform: translateY(100%) } 55% { transform: translateY(0) } 80% { transform: translateY(0) } 100% { transform: translateY(100%) } }
@keyframes tmfxt-slide-a-yd { 0% { transform: translateY(0) } 55% { transform: translateY(100%) } 80% { transform: translateY(100%) } 100% { transform: translateY(0) } }
@keyframes tmfxt-slide-b-yd { 0% { transform: translateY(-100%) } 55% { transform: translateY(0) } 80% { transform: translateY(0) } 100% { transform: translateY(-100%) } }

@keyframes tmfxt-zoom-a { 0% { transform: scale(1); opacity: 1 } 55% { transform: scale(1.3); opacity: .3 } 80% { transform: scale(1.3); opacity: .3 } 100% { transform: scale(1); opacity: 1 } }
@keyframes tmfxt-zoom-b { 0% { transform: scale(1.45); opacity: 0 } 55% { transform: scale(1); opacity: 1 } 80% { transform: scale(1); opacity: 1 } 100% { transform: scale(1.45); opacity: 0 } }
@keyframes tmfxt-dist-a { 0% { transform: translateX(0) scale(1) } 55% { transform: translateX(-16%) scale(.8) } 80% { transform: translateX(-16%) scale(.8) } 100% { transform: translateX(0) scale(1) } }
@keyframes tmfxt-dist-b { 0% { transform: translateX(16%) scale(.8) } 55% { transform: translateX(0) scale(1) } 80% { transform: translateX(0) scale(1) } 100% { transform: translateX(16%) scale(.8) } }

@keyframes tmfxt-circle-open { 0% { clip-path: circle(0% at 50% 50%) } 55% { clip-path: circle(75% at 50% 50%) } 80% { clip-path: circle(75% at 50% 50%) } 100% { clip-path: circle(0% at 50% 50%) } }
@keyframes tmfxt-circle-close { 0% { clip-path: circle(75% at 50% 50%) } 55% { clip-path: circle(0% at 50% 50%) } 80% { clip-path: circle(0% at 50% 50%) } 100% { clip-path: circle(75% at 50% 50%) } }
@keyframes tmfxt-circle-top { 0% { clip-path: circle(0% at 50% 0%) } 55% { clip-path: circle(95% at 50% 0%) } 80% { clip-path: circle(95% at 50% 0%) } 100% { clip-path: circle(0% at 50% 0%) } }
@keyframes tmfxt-rect-open { 0% { clip-path: inset(50% 50% 50% 50%) } 55% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 100% { clip-path: inset(50% 50% 50% 50%) } }

@keyframes tmfxt-band-x { 0% { clip-path: inset(0 50% 0 50%) } 55% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 100% { clip-path: inset(0 50% 0 50%) } }
@keyframes tmfxt-band-y { 0% { clip-path: inset(50% 0 50% 0) } 55% { clip-path: inset(0 0 0 0) } 80% { clip-path: inset(0 0 0 0) } 100% { clip-path: inset(50% 0 50% 0) } }
@keyframes tmfxt-clip-x-close { 0% { clip-path: inset(0 0 0 0) } 55% { clip-path: inset(0 50% 0 50%) } 80% { clip-path: inset(0 50% 0 50%) } 100% { clip-path: inset(0 0 0 0) } }
@keyframes tmfxt-clip-y-close { 0% { clip-path: inset(0 0 0 0) } 55% { clip-path: inset(50% 0 50% 0) } 80% { clip-path: inset(50% 0 50% 0) } 100% { clip-path: inset(0 0 0 0) } }

@keyframes tmfxt-sq-a-x { 0% { transform: scaleX(1) } 55% { transform: scaleX(.02) } 80% { transform: scaleX(.02) } 100% { transform: scaleX(1) } }
@keyframes tmfxt-sq-b-x { 0% { transform: scaleX(.02) } 55% { transform: scaleX(1) } 80% { transform: scaleX(1) } 100% { transform: scaleX(.02) } }
@keyframes tmfxt-sq-a-y { 0% { transform: scaleY(1) } 55% { transform: scaleY(.02) } 80% { transform: scaleY(.02) } 100% { transform: scaleY(1) } }
@keyframes tmfxt-sq-b-y { 0% { transform: scaleY(.02) } 55% { transform: scaleY(1) } 80% { transform: scaleY(1) } 100% { transform: scaleY(.02) } }

@keyframes tmfxt-hblur { 0% { filter: blur(6px); opacity: 0 } 40% { filter: blur(3px); opacity: .7 } 55% { filter: blur(0); opacity: 1 } 80% { filter: blur(0); opacity: 1 } 100% { filter: blur(6px); opacity: 0 } }

@keyframes tmfxt-smooth-x { 0% { -webkit-mask-position: 100% 0; mask-position: 100% 0 } 55% { -webkit-mask-position: 0 0; mask-position: 0 0 } 80% { -webkit-mask-position: 0 0; mask-position: 0 0 } 100% { -webkit-mask-position: 100% 0; mask-position: 100% 0 } }
@keyframes tmfxt-smooth-y { 0% { -webkit-mask-position: 0 100%; mask-position: 0 100% } 55% { -webkit-mask-position: 0 0; mask-position: 0 0 } 80% { -webkit-mask-position: 0 0; mask-position: 0 0 } 100% { -webkit-mask-position: 0 100%; mask-position: 0 100% } }
@keyframes tmfxt-slice-x { 0% { -webkit-mask-position: 100% 0; mask-position: 100% 0; opacity: 0 } 55% { -webkit-mask-position: 0 0; mask-position: 0 0; opacity: 1 } 80% { -webkit-mask-position: 0 0; mask-position: 0 0; opacity: 1 } 100% { -webkit-mask-position: 100% 0; mask-position: 100% 0; opacity: 0 } }
@keyframes tmfxt-slice-y { 0% { -webkit-mask-position: 0 100%; mask-position: 0 100%; opacity: 0 } 55% { -webkit-mask-position: 0 0; mask-position: 0 0; opacity: 1 } 80% { -webkit-mask-position: 0 0; mask-position: 0 0; opacity: 1 } 100% { -webkit-mask-position: 0 100%; mask-position: 0 100%; opacity: 0 } }

/* Effects — scene delta pulses in and out, plus the self-running motions. */
@keyframes tmfx-compare { 0% { opacity: 0 } 12% { opacity: 1 } 62% { opacity: 1 } 78% { opacity: 0 } 100% { opacity: 0 } }
@keyframes tmfx-grain { 0% { background-position: 0 0 } 100% { background-position: 6px -4px } }
@keyframes tmfx-shake { 0% { transform: translate(0,0) scale(1.06) } 10% { transform: translate(-2px,1px) scale(1.06) } 20% { transform: translate(2px,-1px) scale(1.06) } 30% { transform: translate(-1.5px,2px) scale(1.06) } 45% { transform: translate(1.2px,-1.6px) scale(1.06) } 65% { transform: translate(-.5px,1px) scale(1.06) } 85% { transform: translate(.4px,-.5px) scale(1.06) } 100% { transform: translate(0,0) scale(1.06) } }
@keyframes tmfx-rgb { 0% { transform: translateX(0) } 50% { transform: translateX(-3px) } 100% { transform: translateX(0) } }
@keyframes tmfx-slide-ghost { 0% { transform: translateX(0); opacity: .3 } 50% { transform: translateX(5px); opacity: .55 } 100% { transform: translateX(0); opacity: .3 } }
@keyframes tmfx-after { 0% { transform: translate(0,0); opacity: .45 } 50% { transform: translate(5px,-5px); opacity: .15 } 100% { transform: translate(0,0); opacity: .45 } }
@keyframes tmfx-chroma-wipe { 0% { clip-path: inset(0 0 0 100%) } 50% { clip-path: inset(0 0 0 0) } 100% { clip-path: inset(0 0 0 100%) } }
</style>
