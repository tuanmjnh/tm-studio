/**
 * FX preview resolution (Roadmap v1 §5.1 / §6.2 / §6.5 / §6.6).
 *
 * The single bridge between the shared registries and the preview renderers:
 * `TmcutFxThumb` owns *how* a preview is painted (its keyframes), this module
 * owns *which* preview a definition gets and *what it claims*. Both the tiles
 * and the live player take their CSS face from here, so a clip and its tile can
 * never show two different strengths for one effect.
 *
 * Nothing is invented: fidelity + export support come from `fxCapabilities`,
 * parameter bounds from the descriptor (`clampEffectParam`), filter grades are
 * derived from the very chain the export runs (`lut3dChain`) and transition
 * geometry is keyed by `fxCatalog`. A definition without an adapter reports
 * `known: false` — the UI then says so instead of playing a generic animation.
 *
 * Pure + store-free so the node spec runner can exercise every definition.
 */
import type { CSSProperties } from 'vue'
import { EFFECT_REGISTRY, clampEffectParam, fxCapabilities, lut3dChain } from '@tmcut-core'
import { TRANSITION_CATALOG } from './fxCatalog'

export type FxPreviewKind = 'effect' | 'transition' | 'filter'
export type FxFidelity = 'exact' | 'approximate' | 'illustrative'

/** What the registry says a preview is worth (never decided here). */
export interface FxPreviewStatus {
  /** False when no definition/adapter matches — the UI must say so. */
  known: boolean
  fidelity: FxFidelity
  exportSupported: boolean
}

export interface FxPreview {
  status: FxPreviewStatus
  /** Ordered paint layers; `animation` is present only when `animate` was asked for. */
  layers: CSSProperties[]
  /** True when the motion IS the effect (grain drift, shake, a transition): keep playing while visible. */
  loops: boolean
}

export interface FxPreviewScenes {
  /** "Before" plate (also the outgoing frame of a transition). */
  a: string
  /** Incoming frame of a transition. */
  b: string
}

export interface FxPreviewOptions {
  scenes?: FxPreviewScenes
  /** Paint the animated reveal. False = the motion-free rest frame (§6.3/§6.4). */
  animate?: boolean
}

const NO_SCENES: FxPreviewScenes = { a: '', b: '' }
const BASE_Z = 1
const MID_Z = 2
const TOP_Z = 3

/** The on/off reveal that shows a static grade's delta against the plate. */
const COMPARE = 'tmfx-compare var(--tmfx-dur) ease-in-out infinite'

function plate(image: string, extra: CSSProperties = {}): CSSProperties {
  return { backgroundImage: image, backgroundSize: 'cover', backgroundPosition: 'center', ...extra }
}

const r3 = (value: number): number => Number(value.toFixed(3))
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

// =============================================================================
//  Registry param access — bounds come from the descriptor, never from here.
// =============================================================================

function descriptor(type: string) {
  return EFFECT_REGISTRY[type as keyof typeof EFFECT_REGISTRY]
}

/** One param, coerced + clamped by the core, falling back to its default. */
function rawParam(type: string, name: string, raw: unknown): number | string | boolean {
  const desc = descriptor(type)
  const spec = desc?.params.find(candidate => candidate.name === name)
  const value = clampEffectParam(type, name, raw === undefined ? spec?.default : raw)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' || typeof value === 'boolean') return value
  return typeof spec?.default === 'number' || typeof spec?.default === 'string' || typeof spec?.default === 'boolean'
    ? spec.default
    : 0
}

function numParam(type: string, name: string, raw: unknown): number {
  const value = rawParam(type, name, raw)
  return typeof value === 'number' ? value : Number(value) || 0
}

function textParam(type: string, name: string, raw: unknown, fallback: string): string {
  const value = rawParam(type, name, raw)
  return typeof value === 'string' && value ? value : fallback
}

/** Normalised to 0..1 across the param's documented range. */
function unit(type: string, name: string, raw: unknown): number {
  const spec = descriptor(type)?.params.find(candidate => candidate.name === name)
  const min = typeof spec?.min === 'number' ? spec.min : 0
  const max = typeof spec?.max === 'number' ? spec.max : 100
  if (!(max > min)) return 0
  return clamp01((numParam(type, name, raw) - min) / (max - min))
}

/** Normalised to -1..1 — the driver for symmetric params (temp, hue, vibrance). */
function signed(type: string, name: string, raw: unknown): number {
  return unit(type, name, raw) * 2 - 1
}

// =============================================================================
//  Effects — the CSS face of one EFFECT_REGISTRY entry, scaled by its params.
//
//  A builder returns the layers the effect needs. `effectCss` /
//  `effectCssParts` expose the single-element face for the live video preview,
//  which composites one media layer and so cannot paint overlays or ghosts.
// =============================================================================

interface EffectPaint {
  filter?: string
  transform?: string
  /** Self-running motion: the effect itself, not a before/after reveal. */
  animation?: string
  overlay?: CSSProperties
  overlayAnimation?: string
  ghost?: CSSProperties
  ghostAnimation?: string
}

type EffectBuilder = (params: Record<string, unknown>) => EffectPaint

const EFFECT_BUILDERS: Record<string, EffectBuilder> = {
  'blur': p => ({ filter: `blur(${r3(unit('blur', 'amount', p.amount) * 12)}px)` }),
  'sharpen': (p) => {
    const a = unit('sharpen', 'amount', p.amount)
    return { filter: `contrast(${r3(1 + a * 0.25)}) brightness(${r3(1 + a * 0.05)})` }
  },
  'vignette': p => ({
    overlay: {
      background: `radial-gradient(ellipse at 50% 50%, transparent 52%, rgba(0,0,0,${r3(unit('vignette', 'intensity', p.intensity) * 0.82)}) 100%)`
    }
  }),
  'grain': (p) => {
    const size = textParam('grain', 'size', p.size, 'fine')
    const cell = size === 'coarse' ? 6 : size === 'medium' ? 4 : 3
    return {
      overlay: {
        backgroundImage: `radial-gradient(rgba(0,0,0,.6) 1px, transparent ${r3(cell * 0.35)}px)`,
        backgroundSize: `${cell}px ${cell}px`,
        opacity: r3(0.15 + unit('grain', 'amount', p.amount) * 0.75)
      },
      overlayAnimation: `${COMPARE}, tmfx-grain 1.1s linear infinite`
    }
  },
  // Illustrative: an export keys OUT the matched color; a thumbnail cannot
  // fake transparency over a still plate, so it shows the key band instead.
  'chromakey': (p) => {
    const color = textParam('chromakey', 'color', p.color, '#00ff00')
    const edge = r3(unit('chromakey', 'similarity', p.similarity) * 40)
    return {
      overlay: {
        background: `linear-gradient(to right, transparent ${edge}%, ${color} ${edge}%)`,
        opacity: r3(0.55 + unit('chromakey', 'blend', p.blend) * 0.45)
      },
      overlayAnimation: 'tmfx-chroma-wipe var(--tmfx-dur) ease-in-out infinite'
    }
  },
  'stabilize': (p) => {
    const inset = r3(1.02 + unit('stabilize', 'strength', p.strength) * 0.06)
    return { transform: `scale(${inset})`, animation: 'tmfx-shake 2.6s ease-in-out infinite' }
  },
  'eq-grade': (p) => {
    const b = signed('eq-grade', 'brightness', p.brightness)
    const c = unit('eq-grade', 'contrast', p.contrast) * 2
    const s = unit('eq-grade', 'saturation', p.saturation) * 2
    const t = signed('eq-grade', 'temp', p.temp)
    const h = signed('eq-grade', 'hue', p.hue)
    // Registry gamma is 10..300 (100 = 1.0, the same scale `eq=gamma=` uses).
    const gamma = Math.max(0.1, Math.min(3, numParam('eq-grade', 'gamma', p.gamma) / 100))
    const fade = unit('eq-grade', 'fade', p.fade)
    const vib = signed('eq-grade', 'vibrance', p.vibrance)
    const parts = [`brightness(${r3(1 + b * 0.5)})`, `contrast(${r3(c)})`, `saturate(${r3(s)})`]
    // CSS has no colorbalance: warm reads as an amber cast, cool as the known
    // sepia + hue-rotate(180deg) trick — the same mapping the player uses.
    if (t > 0) parts.push(`sepia(${r3(Math.min(0.3, t * 0.3))})`)
    else if (t < 0) parts.push(`sepia(${r3(Math.min(0.35, -t * 0.35))}) hue-rotate(180deg)`)
    if (h !== 0) parts.push(`hue-rotate(${Math.round(h * 180)}deg)`)
    // CSS has no gamma; a mid-tone lift is the closest single-function face.
    if (Math.abs(gamma - 1) > 0.01) parts.push(`brightness(${r3(Math.pow(gamma, 0.45))})`)
    if (vib !== 0) parts.push(`saturate(${r3(1 + vib * 0.35)})`)
    if (fade > 0) parts.push(`contrast(${r3(1 - fade * 0.4)}) brightness(${r3(1 + fade * 0.2)})`)
    return { filter: parts.join(' ') }
  },
  'pixelate': (p) => {
    const blocks = Math.max(1, Math.min(64, Math.round(numParam('pixelate', 'size', p.size))))
    const cell = r3(100 / blocks)
    return {
      filter: `blur(${r3(0.3 + unit('pixelate', 'size', p.size) * 1.2)}px)`,
      overlay: {
        backgroundImage: 'linear-gradient(rgba(0,0,0,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.25) 1px, transparent 1px)',
        backgroundSize: `${cell}% ${cell}%`
      }
    }
  },
  'emboss': (p) => {
    const a = unit('emboss', 'amount', p.amount)
    return { filter: `grayscale(${r3(0.6 + a * 0.3)}) contrast(${r3(1 + a * 0.8)}) brightness(1.06)` }
  },
  'edge-detect': (p) => {
    const mode = textParam('edge-detect', 'mode', p.mode, 'wires')
    if (mode === 'colormix') return { filter: 'invert(1) contrast(1.8) saturate(1.6)' }
    if (mode === 'canny') return { filter: 'grayscale(1) invert(1) contrast(3) brightness(1.05)' }
    return { filter: 'grayscale(1) invert(1) contrast(2.2) brightness(1.05)' }
  },
  'letterbox': (p) => {
    // Export draws bars of `size`% of frame height each (drawbox h=ih*size/100).
    const bar = Math.max(0, Math.min(45, Math.round(numParam('letterbox', 'size', p.size))))
    return {
      overlay: {
        background: `linear-gradient(to bottom, #000 0 ${bar}%, transparent ${bar}% ${100 - bar}%, #000 ${100 - bar}%)`
      }
    }
  },
  'negate': () => ({ filter: 'invert(1)' }),
  'vivid': (p) => {
    const a = unit('vivid', 'amount', p.amount)
    return { filter: `saturate(${r3(1 + a * 0.6)}) contrast(${r3(1 + a * 0.15)})` }
  },
  'bleach-bypass': (p) => {
    const a = unit('bleach-bypass', 'amount', p.amount)
    return { filter: `contrast(${r3(1 + a * 0.3)}) saturate(${r3(1 - a * 0.65)})` }
  },
  'teal-orange': (p) => {
    const k = unit('teal-orange', 'amount', p.amount)
    return {
      filter: `saturate(${r3(1 + k * 0.08)}) contrast(${r3(1 + k * 0.1)})`,
      overlay: {
        background: `linear-gradient(135deg, rgba(13,148,136,${r3(k * 0.75)}), rgba(234,88,12,${r3(k * 0.75)}))`,
        mixBlendMode: 'multiply'
      }
    }
  },
  'vibrance': (p) => {
    const i = signed('vibrance', 'intensity', p.intensity)
    return { filter: `saturate(${r3(1 + i * 0.6)}) brightness(${r3(1 + Math.max(0, i) * 0.04)})` }
  },
  'mirror-h': p => ({ transform: mirrorAxis(textParam('mirror-h', 'axis', p.axis, 'horizontal')) }),
  'mirror-v': p => ({ transform: mirrorAxis(textParam('mirror-v', 'axis', p.axis, 'vertical')) }),
  'rotate-90': (p) => {
    const turns = Math.max(1, Math.min(3, Math.round(numParam('rotate-90', 'turns', p.turns))))
    // A quarter turn needs the frame letterboxed inside the same box.
    return { transform: `rotate(${turns * 90}deg) scale(${turns % 2 === 1 ? 0.5625 : 1})` }
  },
  'chromatic': (p) => {
    const shift = r3(unit('chromatic', 'shift', p.shift) * 6)
    return {
      ghost: { filter: 'sepia(1) hue-rotate(-40deg) saturate(4)', opacity: 0.45, transform: `translateX(${shift}px)` },
      ghostAnimation: 'tmfx-rgb 1.6s ease-in-out infinite'
    }
  },
  'fisheye': (p) => {
    const k = unit('fisheye', 'strength', p.strength)
    return {
      overlay: {
        background: `radial-gradient(circle at 50% 50%, rgba(255,255,255,${r3(0.1 + k * 0.1)}) ${Math.round(30 - k * 12)}%, rgba(0,0,0,${r3(0.2 + k * 0.5)}) 100%)`
      }
    }
  },
  'motion-blur': (p) => {
    const a = unit('motion-blur', 'frames', p.frames)
    return {
      filter: `blur(${r3(0.4 + a * 2.6)}px)`,
      ghost: { filter: 'blur(2px)', opacity: r3(0.25 + a * 0.35) },
      ghostAnimation: 'tmfx-slide-ghost 1.4s ease-in-out infinite'
    }
  },
  'afterimage': p => ({
    ghost: { opacity: r3(0.15 + unit('afterimage', 'decay', p.decay) * 0.45) },
    ghostAnimation: 'tmfx-after 1.8s ease-in-out infinite'
  }),
  'denoise': p => ({
    // The overlay is the noise the filter removes: stronger denoise = less left.
    overlay: {
      backgroundImage: 'radial-gradient(rgba(0,0,0,.6) 1px, transparent 1.4px)',
      backgroundSize: '4px 4px',
      opacity: r3(0.8 - unit('denoise', 'strength', p.strength) * 0.8)
    }
  }),
  'deband': (p) => {
    const band = Math.max(3, Math.round(12 - unit('deband', 'range', p.range) * 8))
    return {
      overlay: {
        background: `repeating-linear-gradient(to bottom, rgba(0,0,0,.3) 0 ${band - 1}px, transparent ${band - 1}px ${band + 4}px)`,
        opacity: r3(0.15 + unit('deband', 'threshold', p.threshold) * 0.6)
      }
    }
  },
  'sepia': (p) => {
    const t = unit('sepia', 'intensity', p.intensity)
    return { filter: `sepia(${r3(t)}) saturate(${r3(1 + t * 0.25)})` }
  },
  'mono': (p) => {
    const t = unit('mono', 'intensity', p.intensity)
    return { filter: `grayscale(${r3(t)}) contrast(${r3(1 + t * 0.08)})` }
  },
  'vhs': (p) => {
    const a = unit('vhs', 'amount', p.amount)
    return {
      filter: `saturate(${r3(1 + a * 0.35)}) contrast(${r3(1 + a * 0.1)})`,
      overlay: {
        background: `repeating-linear-gradient(to bottom, rgba(0,0,0,${r3(0.18 + a * 0.18)}) 0 1.5px, transparent 1.5px 3.5px)`,
        opacity: r3(0.4 + a * 0.6)
      },
      // Export noise is temporal (`allf=t`), so the tracking drift is part of the look.
      overlayAnimation: `${COMPARE}, tmfx-grain 1.1s linear infinite`
    }
  }
  // `lut3d` is presented through the filters tab (kind 'filter'), never as an
  // effect tile — so it deliberately has no effect builder here.
}

/** Registry `axis`/`turns` vocabulary -> CSS transform (both mirror entries share it). */
function mirrorAxis(axis: string): string {
  if (axis === 'vertical') return 'scaleY(-1)'
  if (axis === 'both') return 'scale(-1, -1)'
  return 'scaleX(-1)'
}

const TIME_VARYING = new Set(['grain', 'chromakey', 'stabilize', 'chromatic', 'motion-blur', 'afterimage', 'vhs'])

/** Does this effect's own preview loop, or is it a still grade revealed on demand? */
export function effectLoops(type: string): boolean {
  return TIME_VARYING.has(type)
}

// =============================================================================
//  Filters — CSS derived from the export chain, so preset looks cannot drift.
// =============================================================================

const CURVES_PRESETS: Record<string, string> = {
  lighter: 'brightness(1.1) contrast(.95)',
  medium_contrast: 'contrast(1.18)',
  strong_contrast: 'contrast(1.45) brightness(.96)',
  cross_process: 'contrast(1.25) saturate(1.2) hue-rotate(-10deg)'
}

/** One `filter=k=v:k=v` token split into its name and its `k=v` arguments. */
function splitToken(token: string): { name: string, args: string[] } {
  const eq = token.indexOf('=')
  const rest = eq === -1 ? '' : token.slice(eq + 1)
  return { name: token.slice(0, eq === -1 ? token.length : eq).trim(), args: rest ? rest.split(':') : [] }
}

function argValue(args: string[], key: string): number | null {
  const hit = args.find(argument => argument.startsWith(`${key}=`))
  if (hit === undefined) return null
  const value = Number(hit.slice(key.length + 1))
  return Number.isFinite(value) ? value : null
}

function eqCss(args: string[]): string[] {
  const out: string[] = []
  const saturation = argValue(args, 'saturation')
  const contrast = argValue(args, 'contrast')
  const brightness = argValue(args, 'brightness')
  if (brightness !== null) out.push(`brightness(${r3(1 + brightness)})`)
  if (contrast !== null) out.push(`contrast(${r3(contrast)})`)
  if (saturation !== null) out.push(`saturate(${r3(saturation)})`)
  return out
}

/**
 * Map one export chain to CSS. Unknown filters are skipped, never guessed, so a
 * new chain token degrades to "less of the look" instead of a wrong colour.
 * `colorbalance` has no CSS twin, so only its shadow split (rs/bs) drives the
 * warm/cool cast — the same sepia / sepia+hue-rotate(180deg) trick the
 * eq-grade `temp` param uses, which keeps both panels consistent.
 */
function cssFromChain(chain: string | null): { filter: string, grain: number } {
  const parts: string[] = []
  let warmth = 0
  let green = 0
  let grain = 0
  for (const token of String(chain ?? '').split(',')) {
    const { name, args } = splitToken(token)
    if (!name) continue
    if (name === 'eq') parts.push(...eqCss(args))
    else if (name === 'hue') parts.push('grayscale(1)')
    else if (name === 'curves') {
      const preset = token.match(/preset=([a-z_]+)/)?.[1]
      if (preset && CURVES_PRESETS[preset]) parts.push(CURVES_PRESETS[preset])
    } else if (name === 'colorchannelmixer') parts.push('sepia(1)')
    else if (name === 'colorbalance') {
      warmth += (argValue(args, 'rs') ?? 0) - (argValue(args, 'bs') ?? 0)
      green += argValue(args, 'gs') ?? 0
    } else if (name === 'noise') grain += (argValue(args, 'alls') ?? 0) / 25
  }
  if (Math.abs(warmth) > 0.02) {
    const t = Math.min(0.35, clamp01(Math.abs(warmth) * 1.6))
    parts.push(warmth > 0
      ? `sepia(${r3(t)}) saturate(${r3(1 + t * 0.5)})`
      : `sepia(${r3(t)}) hue-rotate(180deg) saturate(${r3(1 + t * 0.4)})`)
  }
  // `gs` lifts the green shadow band; a small hue rotation toward green is the
  // only single-function face CSS has for it.
  if (Math.abs(green) > 0.02) parts.push(`hue-rotate(${Math.round(Math.max(-45, Math.min(45, green * 90)))}deg)`)
  return { filter: parts.join(' '), grain: clamp01(grain) }
}

/** Preset ids the registry actually ships (single source: the lut3d enum). */
export function lutPresetIds(): string[] {
  const spec = descriptor('lut3d')?.params.find(candidate => candidate.name === 'lut')
  return Array.isArray(spec?.options) ? [...(spec.options as string[])] : []
}

function filterPaint(preset: string): { filter: string, overlay?: CSSProperties } {
  const chain = lut3dChain(preset)
  if (chain === null) {
    // A registered preset with no chain is the documented no-op ('neutral'):
    // identity is the honest picture, so there is nothing to paint over the
    // plate. An unregistered id never reaches here — it reports `known: false`.
    return { filter: '' }
  }
  const { filter, grain } = cssFromChain(chain)
  const overlay = grain > 0.02
    ? {
        backgroundImage: 'radial-gradient(rgba(0,0,0,.55) 1px, transparent 1.4px)',
        backgroundSize: '4px 4px',
        opacity: r3(grain)
      }
    : undefined
  return { filter, overlay }
}

// =============================================================================
//  Transitions — geometry declared by fxCatalog, painted here.
// =============================================================================

type TransitionPrimitive
  = 'fade' | 'dissolve' | 'tint' | 'wipe' | 'diag' | 'slide' | 'zoom' | 'distance'
    | 'circle' | 'rect' | 'smooth' | 'slice' | 'squeeze' | 'band' | 'blur-in' | 'pixelize'

export interface FxTransitionPreview {
  primitive: TransitionPrimitive
  /** Axis for wipe/slide/band/slice/squeeze. */
  axis?: 'x' | 'y'
  /** Reversed direction (mirror) for the same primitive. */
  reverse?: boolean
  /** Corner for diagonal wipes. */
  corner?: 'tl' | 'tr' | 'bl' | 'br'
  /** Circle origin override. */
  origin?: 'top'
  /** `true` = the shape CLOSES over scene B instead of opening over A. */
  close?: boolean
  /** Fade-through color for the tint family. */
  tint?: string
  /** Grain overlay for `dissolve`. */
  grain?: boolean
}

/**
 * Preview geometry per transition key. Keys the catalog does not declare have
 * no entry — `resolveFxPreview` then reports `known: false` rather than
 * inventing a wipe (finding D8 in the Phase-0 audit).
 */
const TRANSITION_PREVIEW: Record<string, FxTransitionPreview> = {
  'fade': { primitive: 'fade' },
  'dissolve': { primitive: 'dissolve', grain: true },
  'fadeblack': { primitive: 'tint', tint: '#000' },
  'fadegrays': { primitive: 'tint', tint: '#a1a1aa' },
  'fadewhite': { primitive: 'tint', tint: '#fff' },
  'wipe-left': { primitive: 'wipe', axis: 'x' },
  'wipe-right': { primitive: 'wipe', axis: 'x', reverse: true },
  'wipeup': { primitive: 'wipe', axis: 'y' },
  'wipedown': { primitive: 'wipe', axis: 'y', reverse: true },
  'wipebl': { primitive: 'diag', corner: 'bl' },
  'wipebr': { primitive: 'diag', corner: 'br' },
  'wipetl': { primitive: 'diag', corner: 'tl' },
  'wipetr': { primitive: 'diag', corner: 'tr' },
  'diagbl': { primitive: 'diag', corner: 'bl' },
  'diagbr': { primitive: 'diag', corner: 'br' },
  'diagtl': { primitive: 'diag', corner: 'tl' },
  'diagtr': { primitive: 'diag', corner: 'tr' },
  'slide-left': { primitive: 'slide', axis: 'x' },
  'slide-right': { primitive: 'slide', axis: 'x', reverse: true },
  'slideright': { primitive: 'slide', axis: 'x', reverse: true },
  'slideup': { primitive: 'slide', axis: 'y' },
  'slidedown': { primitive: 'slide', axis: 'y', reverse: true },
  'zoom-in': { primitive: 'zoom' },
  'zoomin': { primitive: 'zoom' },
  'distance': { primitive: 'distance' },
  'circleopen': { primitive: 'circle' },
  'circleclose': { primitive: 'circle', close: true },
  'circlecrop': { primitive: 'circle', close: true },
  'radial': { primitive: 'circle', origin: 'top' },
  'rectcrop': { primitive: 'rect' },
  'smoothleft': { primitive: 'smooth', axis: 'x' },
  'smoothright': { primitive: 'smooth', axis: 'x', reverse: true },
  'smoothup': { primitive: 'smooth', axis: 'y' },
  'smoothdown': { primitive: 'smooth', axis: 'y', reverse: true },
  'hlslice': { primitive: 'slice', axis: 'y' },
  'hrslice': { primitive: 'slice', axis: 'y', reverse: true },
  'vdslice': { primitive: 'slice', axis: 'x' },
  'vuslice': { primitive: 'slice', axis: 'x', reverse: true },
  'squeezeh': { primitive: 'squeeze', axis: 'x' },
  'squeezev': { primitive: 'squeeze', axis: 'y' },
  'horzopen': { primitive: 'band', axis: 'x' },
  'horzclose': { primitive: 'band', axis: 'x', close: true },
  'vertopen': { primitive: 'band', axis: 'y' },
  'vertclose': { primitive: 'band', axis: 'y', close: true },
  'hblur': { primitive: 'blur-in' },
  'pixelize': { primitive: 'pixelize' }
}

const mirrorX = (style: CSSProperties): CSSProperties => ({ ...style, transform: 'scaleX(-1)' })
const mirrorY = (style: CSSProperties): CSSProperties => ({ ...style, transform: 'scaleY(-1)' })

/** The reveal animation for a shape primitive, mirrored on the right axis. */
function reveal(spec: FxTransitionPreview): CSSProperties {
  const anim = (name: string): CSSProperties => ({ animation: `${name} var(--tmfx-dur) ease-in-out infinite` })
  const withMask = (direction: 'x' | 'y', travel: string, bands = false): CSSProperties => {
    const image = bands
      ? (direction === 'x'
          ? 'repeating-linear-gradient(to right, #000 0 12%, transparent 12% 24%)'
          : 'repeating-linear-gradient(to bottom, #000 0 12%, transparent 12% 24%)')
      : (direction === 'x'
          ? 'linear-gradient(to right, #000 0 40%, transparent 60%)'
          : 'linear-gradient(to bottom, #000 0 40%, transparent 60%)')
    const size = direction === 'x' ? '200% 100%' : '100% 200%'
    return {
      maskImage: image,
      WebkitMaskImage: image,
      maskSize: size,
      WebkitMaskSize: size,
      maskRepeat: 'no-repeat',
      WebkitMaskRepeat: 'no-repeat',
      ...anim(travel)
    }
  }

  switch (spec.primitive) {
    case 'fade':
    case 'dissolve':
      return anim('tmfxt-fade')
    case 'wipe':
      return anim(spec.axis === 'y' ? 'tmfxt-wipe-y' : 'tmfxt-wipe-x')
    case 'diag':
      return anim(`tmfxt-diag-${spec.corner ?? 'bl'}`)
    case 'slide':
      // A slide moves BOTH plates, so the mirrored keyframes are the only
      // correct face: an animated `transform` would override a static mirror.
      return anim(spec.axis === 'y'
        ? (spec.reverse ? 'tmfxt-slide-b-yd' : 'tmfxt-slide-b-y')
        : (spec.reverse ? 'tmfxt-slide-b-xr' : 'tmfxt-slide-b-x'))
    case 'zoom':
      return anim('tmfxt-zoom-b')
    case 'distance':
      return anim('tmfxt-dist-b')
    case 'circle':
      return anim(spec.origin === 'top' ? 'tmfxt-circle-top' : spec.close ? 'tmfxt-circle-close' : 'tmfxt-circle-open')
    case 'rect':
      return anim('tmfxt-rect-open')
    case 'smooth':
      return withMask(spec.axis === 'y' ? 'y' : 'x', spec.axis === 'y' ? 'tmfxt-smooth-y' : 'tmfxt-smooth-x')
    case 'slice':
      return withMask(spec.axis === 'y' ? 'y' : 'x', spec.axis === 'y' ? 'tmfxt-slice-y' : 'tmfxt-slice-x', true)
    case 'squeeze':
      return anim(spec.axis === 'y' ? 'tmfxt-sq-b-y' : 'tmfxt-sq-b-x')
    case 'band':
      return anim(spec.axis === 'y' ? 'tmfxt-band-y' : 'tmfxt-band-x')
    case 'blur-in':
      return anim('tmfxt-hblur')
    case 'pixelize':
      return { ...anim('tmfxt-fade'), animationTimingFunction: 'steps(5, end)' }
    default:
      return {}
  }
}

/** Slide needs BOTH plates to travel; every other reveal moves only scene B. */
function sceneAStyle(spec: FxTransitionPreview): CSSProperties {
  if (spec.primitive === 'slide') {
    const name = spec.axis === 'y'
      ? (spec.reverse ? 'tmfxt-slide-a-yd' : 'tmfxt-slide-a-y')
      : (spec.reverse ? 'tmfxt-slide-a-xr' : 'tmfxt-slide-a-x')
    return { animation: `${name} var(--tmfx-dur) ease-in-out infinite` }
  }
  if (spec.primitive === 'zoom') return { animation: 'tmfxt-zoom-a var(--tmfx-dur) ease-in-out infinite' }
  if (spec.primitive === 'distance') return { animation: 'tmfxt-dist-a var(--tmfx-dur) ease-in-out infinite' }
  if (spec.primitive === 'squeeze') {
    const name = spec.axis === 'y' ? 'tmfxt-sq-a-y' : 'tmfxt-sq-a-x'
    return { animation: `${name} var(--tmfx-dur) ease-in-out infinite` }
  }
  if (spec.primitive === 'band' && spec.close) {
    return { animation: `tmfxt-clip-${spec.axis === 'y' ? 'y' : 'x'}-close var(--tmfx-dur) ease-in-out infinite` }
  }
  return {}
}

/**
 * Motion-free rest frame for a `between` transition: both plates in one image,
 * split along the axis the transition travels on. A frozen mid-wipe would hide
 * one side, and reduced-motion users still have to see what the cut does.
 */
function splitFrame(spec: FxTransitionPreview, scenes: FxPreviewScenes): CSSProperties[] {
  // B keeps the half it has already covered at the start of the reveal — the
  // `wipe-x` keyframe enters from the left edge, `wipe-y` from the bottom, and
  // a reversed variant mirrors that entry. So the frozen tile reads as a
  // mid-transition freeze frame rather than an arbitrary split.
  const half = spec.axis === 'y'
    ? (spec.reverse ? 'inset(0 0 50% 0)' : 'inset(50% 0 0 0)')
    : (spec.reverse ? 'inset(0 0 0 50%)' : 'inset(0 50% 0 0)')
  return [
    plate(scenes.a, { zIndex: BASE_Z }),
    plate(scenes.b, { zIndex: MID_Z, clipPath: half })
  ]
}

// =============================================================================
//  Public resolution
// =============================================================================

export function effectPreviewStatus(type: string): FxPreviewStatus {
  const caps = fxCapabilities(type)
  if (!caps) return { known: false, fidelity: 'illustrative', exportSupported: false }
  return { known: Boolean(EFFECT_BUILDERS[type]), fidelity: caps.fidelity, exportSupported: caps.exportSupported }
}

/** Fidelity of the transition family: only the fade/tint morphs are a true match. */
function transitionStatus(spec: FxTransitionPreview | undefined): FxPreviewStatus {
  if (!spec) return { known: false, fidelity: 'illustrative', exportSupported: false }
  const exact = spec.primitive === 'fade' || spec.primitive === 'tint'
  return { known: true, fidelity: exact ? 'exact' : 'approximate', exportSupported: true }
}

function filterStatus(preset: string): FxPreviewStatus {
  const caps = fxCapabilities('lut3d')
  const known = lutPresetIds().includes(preset)
  return {
    known,
    // An id outside the enum reports `known: false` and paints nothing.
    fidelity: !known || !caps ? 'illustrative' : lut3dChain(preset) === null ? 'exact' : caps.fidelity,
    exportSupported: caps?.exportSupported ?? false
  }
}

/**
 * Resolve the preview for one registry definition.
 *
 * @param kind which library tab asked
 * @param type effect `type` / lut3d preset id / transition key
 * @param params raw effect params; clamped here through the core descriptor, so
 *   a dirty project JSON can never drive an out-of-range tile (§5.3)
 * @param options demo scenes + whether motion is allowed right now
 */
export function resolveFxPreview(
  kind: FxPreviewKind,
  type: string,
  params: Record<string, unknown> = {},
  options: FxPreviewOptions = {}
): FxPreview {
  const scenes = options.scenes ?? NO_SCENES
  const animate = options.animate !== false

  if (kind === 'transition') {
    const spec = TRANSITION_PREVIEW[type]
    const status = transitionStatus(spec)
    if (!spec) return { status, layers: [], loops: false }
    if (!animate) return { status, layers: splitFrame(spec, scenes), loops: false }

    const layers: CSSProperties[] = []
    if (spec.primitive === 'tint') {
      // Fade-through-a-colour family: A disappears, the tint peaks at the
      // middle, B arrives — so B sits at the bottom and A is the layer that
      // animates OUT.
      layers.push(plate(scenes.b, { zIndex: BASE_Z }))
      layers.push(plate(scenes.a, { zIndex: MID_Z, animation: 'tmfxt-out var(--tmfx-dur) ease-in-out infinite' }))
      layers.push({ background: spec.tint ?? '#000', zIndex: TOP_Z, animation: 'tmfxt-flash var(--tmfx-dur) ease-in-out infinite' })
      return { status, layers, loops: true }
    }

    if (spec.close) {
      layers.push(plate(scenes.b, { zIndex: BASE_Z, ...reveal(spec) }))
      layers.push(plate(scenes.a, { zIndex: TOP_Z, ...sceneAStyle(spec) }))
    } else {
      layers.push(plate(scenes.a, { zIndex: BASE_Z, ...sceneAStyle(spec) }))
      let bStyle = plate(scenes.b, { zIndex: MID_Z, ...reveal(spec) })
      // Only the clip-path / mask family can be mirrored with a static
      // transform; slide and squeeze keyframes animate `transform` themselves
      // and already carry their reverse names.
      if (spec.reverse && (spec.primitive === 'wipe' || spec.primitive === 'smooth' || spec.primitive === 'slice')) {
        bStyle = spec.axis === 'y' ? mirrorY(bStyle) : mirrorX(bStyle)
      }
      layers.push(bStyle)
    }
    if (spec.primitive === 'dissolve' && spec.grain) {
      layers.push({
        zIndex: TOP_Z,
        backgroundImage: 'radial-gradient(rgba(0,0,0,.55) 1px, transparent 1.4px)',
        backgroundSize: '4px 4px',
        animation: 'tmfxt-fade var(--tmfx-dur) ease-in-out infinite'
      })
    }
    if (spec.primitive === 'pixelize') {
      layers.push({
        zIndex: TOP_Z,
        backgroundImage: 'linear-gradient(rgba(0,0,0,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,.25) 1px, transparent 1px)',
        backgroundSize: '7px 7px',
        animation: 'tmfxt-fade var(--tmfx-dur) ease-in-out infinite'
      })
    }
    return { status, layers, loops: true }
  }

  if (kind === 'filter') {
    const status = filterStatus(type)
    if (!status.known) return { status, layers: [], loops: false }
    const paint = filterPaint(type)
    const layers: CSSProperties[] = [plate(scenes.a, { zIndex: BASE_Z })]
    if (paint.filter) {
      layers.push(plate(scenes.a, { zIndex: MID_Z, filter: paint.filter, animation: animate ? COMPARE : undefined }))
    }
    if (paint.overlay) {
      layers.push({ ...paint.overlay, zIndex: TOP_Z, animation: animate ? COMPARE : undefined })
    }
    return { status, layers, loops: false }
  }

  const builder = EFFECT_BUILDERS[type]
  const status = effectPreviewStatus(type)
  // An unregistered type paints nothing rather than inventing a look.
  if (!builder) return { status, layers: [], loops: false }
  const layers: CSSProperties[] = [plate(scenes.a, { zIndex: BASE_Z })]

  const built = builder(params)
  // With motion off, only the effect's own rest state is painted: the
  // before/after reveal disappears, so a static grade simply shows the grade.
  const revealAnimation = animate ? COMPARE : undefined
  const layerAnimation = (own: string | undefined): string | undefined => (animate ? own : undefined) ?? revealAnimation

  if (built.ghost) {
    layers.push(plate(scenes.a, { ...built.ghost, zIndex: MID_Z, animation: layerAnimation(built.ghostAnimation) }))
  }
  layers.push(plate(scenes.a, {
    ...(built.filter ? { filter: built.filter } : {}),
    ...(built.transform ? { transform: built.transform } : {}),
    zIndex: built.overlay ? MID_Z : TOP_Z,
    animation: layerAnimation(built.animation)
  }))
  if (built.overlay) {
    layers.push({ ...built.overlay, zIndex: TOP_Z, animation: layerAnimation(built.overlayAnimation) })
  }
  return { status, layers, loops: effectLoops(type) }
}

/**
 * CSS grade for one lut3d preset. `''` means identity — the registered no-op
 * (`neutral`) or an id outside the enum, both of which must show the raw plate.
 */
export function lutCss(preset: string): string {
  if (!lutPresetIds().includes(preset)) return ''
  return filterPaint(preset).filter
}

/**
 * The two CSS properties ONE effect instance can drive on a single element.
 * `filter` and `transform` are separate properties, so they are returned apart;
 * overlays and ghosts need extra DOM, which a lone <video> element has not got
 * — the effects reporting a `filter` are the ones parity-tested here.
 */
export interface FxCssParts {
  filter: string
  transform: string
}

export function effectCssParts(type: string, params: Record<string, unknown> = {}): FxCssParts {
  // A clip's `lut3d` entry is a grade, and the grade lives in the preset table
  // rather than in an effect builder (the library shows it on the filters tab).
  if (type === 'lut3d') return { filter: lutCss(String(params.lut ?? '')), transform: '' }
  const built = EFFECT_BUILDERS[type]?.(params)
  return { filter: built?.filter ?? '', transform: built?.transform ?? '' }
}

/** The `filter` property alone — what most callers of `effectCssParts` want. */
export function effectCss(type: string, params: Record<string, unknown> = {}): string {
  return effectCssParts(type, params).filter
}

/** Every effect type this module can paint (coverage spec + marketplace guard). */
export function effectAdapterKeys(): string[] {
  return Object.keys(EFFECT_BUILDERS)
}

export function transitionAdapterKeys(): string[] {
  return Object.keys(TRANSITION_PREVIEW)
}

/** Transition keys the catalog advertises but no preview implements. */
export function missingTransitionPreviews(): string[] {
  return TRANSITION_CATALOG.map(entry => entry.key).filter(key => !TRANSITION_PREVIEW[key])
}

/**
 * Every CSS animation name this module can emit, resolved from the adapters
 * themselves. `TmcutFxThumb.vue` must carry a `@keyframes` for each one — the
 * coverage spec reads both sides and fails on drift, which is the only way to
 * catch a resolver that names a frame nobody paints.
 */
export function usedAnimationNames(): string[] {
  const names = new Set<string>()
  const collect = (layers: CSSProperties[]) => {
    for (const layer of layers) {
      // csstype allows the shorthand's numeric faces; only string forms name a frame.
      const shorthand = typeof layer.animation === 'string' ? layer.animation : undefined
      if (!shorthand || shorthand === 'none') continue
      for (const part of shorthand.split(',')) {
        const first = part.trim().split(/\s+/)[0]
        if (first && first !== 'none' && !first.includes('(')) names.add(first)
      }
    }
  }
  const options: FxPreviewOptions = { scenes: NO_SCENES, animate: true }
  for (const type of effectAdapterKeys()) collect(resolveFxPreview('effect', type, {}, options).layers)
  for (const key of transitionAdapterKeys()) collect(resolveFxPreview('transition', key, {}, options).layers)
  for (const preset of lutPresetIds()) collect(resolveFxPreview('filter', preset, {}, options).layers)
  return [...names].sort()
}

/** Registry effect types with no CSS face at all (must stay empty). */
export function missingEffectPreviews(): string[] {
  return Object.keys(EFFECT_REGISTRY).filter(type => !EFFECT_BUILDERS[type] && type !== 'lut3d')
}

/**
 * lut3d presets whose export chain produces no CSS at all. A chain of filters
 * this module does not understand yet is a gap worth failing on, because the
 * tile would otherwise look like a no-op while the export changes the picture.
 */
export function missingFilterPreviews(): string[] {
  return lutPresetIds().filter((preset) => {
    const chain = lut3dChain(preset)
    if (chain === null) return false // no chain = identity = nothing to paint
    const { filter, grain } = cssFromChain(chain)
    return filter === '' && grain <= 0.02
  })
}
