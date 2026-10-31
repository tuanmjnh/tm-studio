// =============================================================================
//  Pure helpers for the effects/transitions library panel (roadmap R112) and
//  the media animation presets in the inspector. Deliberately store-free so
//  they run in the node spec runner; components own history + IPC concerns.
// =============================================================================

import { TICKS_PER_SECOND } from '@tmcut-core'
import type { EFFECT_REGISTRY } from '@tmcut-core'

type EffectDescriptor = (typeof EFFECT_REGISTRY)[keyof typeof EFFECT_REGISTRY]
type EffectItem = { type: string, params: Record<string, unknown> }
type KeyframeItem = { t: number, prop: string, value: number, easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'step' }

/** Default `params` object for a fresh effect instance (registry defaults). */
export function effectDefaultParams(desc: EffectDescriptor): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const p of desc.params) params[p.name] = p.default
  return params
}

/**
 * Toggle a registry effect on a clip's effect list. Returns a NEW array;
 * the effect is added with registry defaults or removed when already there.
 */
export function toggleEffectOnClip(effects: EffectItem[], desc: EffectDescriptor): EffectItem[] {
  const exists = effects.some(e => e.type === desc.type)
  if (exists) return effects.filter(e => e.type !== desc.type)
  return [...effects, { type: desc.type, params: effectDefaultParams(desc) }]
}

/**
 * Set (or clear) the LUT preset used by the Filters library tab.
 * Returns null when `preset` is ALREADY the active lut3d preset — the
 * caller treats that as the remove-toggle. Otherwise a new list with the
 * lut3d entry added or replaced, everything else untouched.
 */
export function setLutPresetOnClip(effects: EffectItem[], preset: string): EffectItem[] | null {
  const current = effects.find(e => e.type === 'lut3d')
  if (current && current.params.lut === preset) return null
  const rest = effects.filter(e => e.type !== 'lut3d')
  return [...rest, { type: 'lut3d', params: { lut: preset } }]
}

/** The LUT preset currently active on a clip, or null. */
export function activeLutPreset(effects: EffectItem[]): string | null {
  const lut = effects.find(e => e.type === 'lut3d')
  return typeof lut?.params.lut === 'string' ? lut.params.lut : null
}

// ===== Media animation presets (inspector "Animation" tab, video/image) ====
// CapCut-style: a whole-clip entrance/exit written as OPACITY/SCALE keyframe
// pairs — the same engine the ⏱ buttons use, so keyframes stay visible and
// editable afterwards. Fade edges clamp to half the clip (core fade rule).

export type MediaAnimPreset = 'fade' | 'fade-in' | 'fade-out' | 'zoom-in' | 'zoom-out' | 'reset'

export function applyMediaAnimPreset(
  existing: KeyframeItem[],
  preset: MediaAnimPreset,
  durTicks: number,
  opacity: number,
  scale: number
): KeyframeItem[] {
  // Presets own the opacity/scale channels; other props (x/y/volume) survive.
  const kept = existing.filter(k => k.prop !== 'opacity' && k.prop !== 'scale')
  if (preset === 'reset' || durTicks <= 0) return kept

  const edge = Math.max(1, Math.min(Math.round(TICKS_PER_SECOND / 2), Math.floor(durTicks / 2)))
  const added: KeyframeItem[] = []
  switch (preset) {
    case 'fade':
      added.push({ t: 0, prop: 'opacity', value: 0, easing: 'ease-out' })
      added.push({ t: edge, prop: 'opacity', value: opacity })
      added.push({ t: durTicks - edge, prop: 'opacity', value: opacity })
      added.push({ t: durTicks, prop: 'opacity', value: 0, easing: 'ease-in' })
      break
    case 'fade-in':
      added.push({ t: 0, prop: 'opacity', value: 0, easing: 'ease-out' })
      added.push({ t: edge, prop: 'opacity', value: opacity })
      break
    case 'fade-out':
      added.push({ t: durTicks - edge, prop: 'opacity', value: opacity })
      added.push({ t: durTicks, prop: 'opacity', value: 0, easing: 'ease-in' })
      break
    case 'zoom-in':
      added.push({ t: 0, prop: 'scale', value: scale * 0.92, easing: 'linear' })
      added.push({ t: durTicks, prop: 'scale', value: scale * 1.08, easing: 'linear' })
      break
    case 'zoom-out':
      added.push({ t: 0, prop: 'scale', value: scale * 1.08, easing: 'linear' })
      added.push({ t: durTicks, prop: 'scale', value: scale * 0.92, easing: 'linear' })
      break
  }
  return [...kept, ...added].sort((a, b) => a.t - b.t)
}

/** Map a core transition refusal reason to its i18n key suffix (tmcut.fxLib.*). */
export function transitionReasonKey(reason: string | undefined): string {
  switch (reason) {
    case 'gap': return 'reasonGap'
    case 'too-long': return 'reasonTooLong'
    case 'unknown-type': return 'reasonUnknown'
    default: return 'reasonNoNeighbor'
  }
}

// =============================================================================
//  R128 — registry browsing helpers for the FX library + inspector.
//  Everything here is DATA-DRIVEN from the core registries: adding an effect,
//  a LUT preset or a transition in @tmcut/core shows up in both panels
//  without touching this file (the option lists are never hard-coded).
//  Store-free and pure so the node spec runner can exercise them.
// =============================================================================

/** Structural view of a registry descriptor (core adds an optional `category`). */
export interface FxRegistryEntry {
  type: string
  label?: string
  category?: string
  renderReady?: boolean
  params?: ReadonlyArray<{ name: string, options?: string[] }>
}

/** Bucket id for entries whose `category` is missing or not a known id. */
export const FX_OTHER_CATEGORY = 'other'

/** Display order of the frozen core effect category ids (unknown ids follow). */
export const EFFECT_CATEGORY_ORDER: readonly string[] = [
  'blur', 'sharpen', 'light', 'color', 'stylize', 'distort', 'keying', 'motion', 'retro', 'texture', FX_OTHER_CATEGORY
]

/** Display order of the fxCatalog transition category ids (unknown ids follow). */
export const TRANSITION_CATEGORY_ORDER: readonly string[] = [
  'basic', 'slide', 'wipe', 'shape', 'smooth', 'zoom', 'slice', 'diagonal', FX_OTHER_CATEGORY
]

/** A themed bucket of items — the shape both libraries render. */
export interface FxGroup<T> { category: string, items: T[] }

/** 'teal-orange' -> 'Teal Orange'. Fallback label when i18n has no key. */
export function humanizeKey(key: string): string {
  return String(key || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** Registry -> descriptor list (insertion order preserved, junk skipped). */
export function registryEntries(registry: Record<string, unknown> | null | undefined): FxRegistryEntry[] {
  const out: FxRegistryEntry[] = []
  for (const value of Object.values(registry || {})) {
    if (!value || typeof value !== 'object') continue
    const desc = value as FxRegistryEntry
    if (typeof desc.type === 'string' && desc.type) out.push(desc)
  }
  return out
}

/** Case-insensitive search on `type` OR `label`; an empty query returns all. */
export function searchEffects(entries: FxRegistryEntry[], query: string): FxRegistryEntry[] {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return entries.slice()
  return entries.filter(entry =>
    entry.type.toLowerCase().includes(q)
    || String(entry.label ?? '').toLowerCase().includes(q)
  )
}

/** Sort bucket ids: known ids in preferred order, unknown ids, then 'other'. */
function orderCategories(categories: string[], preferred: readonly string[]): string[] {
  const rank = (category: string) => {
    // The catch-all bucket always renders last.
    if (category === FX_OTHER_CATEGORY) return preferred.length + 1
    const i = preferred.indexOf(category)
    return i === -1 ? preferred.length : i
  }
  return categories.slice().sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return a.localeCompare(b)
  })
}

/** Normalized bucket id for one entry (missing/blank category -> 'other'). */
export function effectCategoryOf(entry: FxRegistryEntry | null | undefined): string {
  const raw = typeof entry?.category === 'string' ? entry.category.trim() : ''
  return raw || FX_OTHER_CATEGORY
}

/** Every entry lands in exactly ONE bucket; missing/unknown category -> 'other'. */
export function groupEffectsByCategory(
  entries: FxRegistryEntry[],
  preferred: readonly string[] = EFFECT_CATEGORY_ORDER
): FxGroup<FxRegistryEntry>[] {
  const buckets = new Map<string, FxRegistryEntry[]>()
  for (const entry of entries) {
    const key = effectCategoryOf(entry)
    const list = buckets.get(key)
    if (list) list.push(entry)
    else buckets.set(key, [entry])
  }
  return orderCategories([...buckets.keys()], preferred)
    .map(category => ({ category, items: buckets.get(category) as FxRegistryEntry[] }))
}

/**
 * LUT preset ids straight from the lut3d registry descriptor (single source).
 * Returns [] when the registry carries no such enum — callers show an honest
 * empty state instead of a hard-coded fallback list.
 */
export function filterPresets(
  registry: Record<string, unknown> | null | undefined,
  type = 'lut3d',
  paramNames: readonly string[] = ['lut']
): string[] {
  const desc = (registry?.[type] ?? null) as FxRegistryEntry | null
  if (!desc || !Array.isArray(desc.params)) return []
  for (const param of desc.params) {
    if (paramNames.includes(param.name) && Array.isArray(param.options)) return param.options.slice()
  }
  // The core may rename the param — take the first enum with options.
  for (const param of desc.params) {
    if (Array.isArray(param.options) && param.options.length) return param.options.slice()
  }
  return []
}

// Two-stop swatches for the filter tiles (presentation only). Unknown preset
// ids get a stable hashed pair so a new core preset still looks distinct.
const LUT_SWATCHES: Record<string, readonly [string, string]> = {
  'neutral': ['#3f3f46', '#71717a'],
  'warm': ['#b45309', '#f59e0b'],
  'cool': ['#1e3a8a', '#38bdf8'],
  'cinematic': ['#0f172a', '#334155'],
  'vintage': ['#92400e', '#d6d3d1'],
  'vivid': ['#be123c', '#fb923c'],
  'fade': ['#a8a29e', '#e7e5e4'],
  'mono': ['#18181b', '#d4d4d8'],
  'sepia': ['#78350f', '#d97706'],
  'noir': ['#09090b', '#52525b'],
  'bleach': ['#1f2937', '#f5f5f4'],
  'teal-orange': ['#0f766e', '#ea580c'],
  'sunset': ['#7c2d12', '#fbbf24'],
  'moonlight': ['#1e1b4b', '#93c5fd'],
  'forest': ['#14532d', '#4ade80'],
  'rose': ['#881337', '#fda4af'],
  'cyberpunk': ['#6d28d9', '#22d3ee'],
  'film': ['#292524', '#a8a29e'],
  'honey': ['#a16207', '#fde047'],
  'arctic': ['#0c4a6e', '#e0f2fe']
}

function hashedSwatch(key: string): readonly [string, string] {
  let hash = 0
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 360
  return [`hsl(${hash} 55% 26%)`, `hsl(${(hash + 40) % 360} 70% 62%)`]
}

/** Background gradient for a filter tile (stable for unknown preset ids). */
export function lutSwatch(preset: string): string {
  const pair = LUT_SWATCHES[preset] || hashedSwatch(preset)
  return `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`
}

/** fxCatalog row shape (branch B) — structural, so this module stays register-free. */
export interface FxTransitionEntry { key: string, xfade?: string, category?: string, label?: string }

export interface FxTransitionItem { key: string, label: string }

/**
 * Bucket transition keys by the catalog's `category`, keeping every key in
 * exactly ONE bucket and appending keys the catalog misses to 'other' — so a
 * partially-landed catalog can never hide a transition the core accepts.
 * Without a catalog every key still renders, with a humanized fallback label.
 */
export function groupTransitions(
  keys: readonly string[],
  catalog?: readonly FxTransitionEntry[] | null,
  preferred: readonly string[] = TRANSITION_CATEGORY_ORDER
): FxGroup<FxTransitionItem>[] {
  const byKey = new Map<string, FxTransitionEntry>()
  for (const entry of catalog || []) {
    if (entry && typeof entry.key === 'string') byKey.set(entry.key, entry)
  }
  const buckets = new Map<string, FxTransitionItem[]>()
  const seen = new Set<string>()
  for (const key of keys) {
    if (typeof key !== 'string' || !key || seen.has(key)) continue
    seen.add(key)
    const entry = byKey.get(key)
    const raw = typeof entry?.category === 'string' ? entry.category.trim() : ''
    const category = raw || FX_OTHER_CATEGORY
    const item: FxTransitionItem = { key, label: entry?.label || humanizeKey(key) }
    const list = buckets.get(category)
    if (list) list.push(item)
    else buckets.set(category, [item])
  }
  return orderCategories([...buckets.keys()], preferred)
    .map(category => ({ category, items: buckets.get(category) as FxTransitionItem[] }))
}

/** Readable label for one transition key (catalog label, else humanized). */
export function transitionLabelFor(key: string, catalog?: readonly FxTransitionEntry[] | null): string {
  const entry = (catalog || []).find(candidate => candidate && candidate.key === key)
  return entry?.label || humanizeKey(key)
}

/**
 * Normalize fxCatalog's `transitionsByCategory()` Record into ordered groups.
 * Keeps only keys the caller considers current, and appends any of those the
 * catalog does not mention yet to 'other' (never hides an accepted transition).
 */
export function groupsFromCatalog(
  keys: readonly string[],
  byCategory: Record<string, readonly FxTransitionEntry[]> | null | undefined,
  preferred: readonly string[] = TRANSITION_CATEGORY_ORDER
): FxGroup<FxTransitionItem>[] {
  const flat: FxTransitionEntry[] = []
  for (const entries of Object.values(byCategory || {})) {
    for (const entry of entries || []) if (entry && typeof entry.key === 'string') flat.push(entry)
  }
  return groupTransitions(keys, flat, preferred)
}
