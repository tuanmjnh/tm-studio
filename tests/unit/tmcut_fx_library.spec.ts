// =============================================================================
//  R112 — fxLibrary pure helpers spec: effect/filters toggle math on clip
//  effect lists, media animation preset keyframe math, and the transition
//  reason mapping the Fx library panel surfaces as toasts.
//  R128 — registry browsing helpers (search / category grouping / preset
//  list / transition grouping) that the FX library + inspector render from.
//  Run: pnpm test:fxlibrary (or through run-all).
// =============================================================================
import assert from 'node:assert/strict'
import { EFFECT_REGISTRY, KNOWN_TRANSITIONS, TICKS_PER_SECOND } from '@tmcut-core'
import {
  effectDefaultParams,
  toggleEffectOnClip,
  setLutPresetOnClip,
  activeLutPreset,
  applyMediaAnimPreset,
  transitionReasonKey,
  registryEntries,
  searchEffects,
  groupEffectsByCategory,
  filterPresets,
  lutSwatch,
  humanizeKey,
  groupTransitions,
  transitionLabelFor,
  groupsFromCatalog,
  EFFECT_CATEGORY_ORDER,
  FX_OTHER_CATEGORY
} from '../../app/utils/tmcut/fxLibrary'
import type { FxRegistryEntry, FxTransitionEntry } from '../../app/utils/tmcut/fxLibrary'

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

console.log('=== [TMCut R112 Fx Library helpers] Starting ===\n')

// 1. Defaults come straight from the registry descriptors.
check('effectDefaultParams mirrors registry defaults', () => {
  const p = effectDefaultParams(EFFECT_REGISTRY.blur)
  assert.deepEqual(p, { amount: 50 })
  const ck = effectDefaultParams(EFFECT_REGISTRY.chromakey)
  assert.deepEqual(ck, { color: '#00ff00', similarity: 30, blend: 10, spill: true })
})

// 2. Toggle adds with defaults, removes on second click, never mutates input.
check('toggleEffectOnClip add/remove is pure and idempotent', () => {
  const before: Array<{ type: string, params: Record<string, unknown> }> = []
  const once = toggleEffectOnClip(before, EFFECT_REGISTRY.vignette)
  assert.equal(once.length, 1)
  assert.deepEqual(once[0], { type: 'vignette', params: { intensity: 50 } })
  assert.equal(before.length, 0, 'input list must not be mutated')
  const twice = toggleEffectOnClip(once, EFFECT_REGISTRY.vignette)
  assert.equal(twice.length, 0)
  // A second effect coexists.
  const withBlur = toggleEffectOnClip(once, EFFECT_REGISTRY.blur)
  assert.deepEqual(withBlur.map(e => e.type).sort(), ['blur', 'vignette'])
})

// 3. LUT toggle: replace, remove-on-same-preset signal, untouched siblings.
check('setLutPresetOnClip replace/toggle semantics', () => {
  const start = [{ type: 'blur', params: { amount: 20 } }]
  const warm = setLutPresetOnClip(start, 'warm')
  assert.ok(warm)
  assert.deepEqual(warm.map(e => e.type), ['blur', 'lut3d'])
  assert.equal(activeLutPreset(warm), 'warm')
  // Same preset again -> null = caller removes the lut entry.
  assert.equal(setLutPresetOnClip(warm, 'warm'), null)
  assert.equal(activeLutPreset(start), null)
  // A different preset REPLACES (never stacks two lut3d entries).
  const cool = setLutPresetOnClip(warm, 'cool')
  assert.ok(cool)
  assert.equal(cool.filter(e => e.type === 'lut3d').length, 1)
  assert.equal(activeLutPreset(cool), 'cool')
})

// 4. Media animation presets write clean keyframe pairs, clamped edges.
check('applyMediaAnimPreset fade writes 4 sorted opacity keyframes', () => {
  const dur = 10 * TICKS_PER_SECOND
  const kfs = applyMediaAnimPreset([], 'fade', dur, 100, 100)
  assert.equal(kfs.length, 4)
  assert.deepEqual(kfs.map(k => [k.t, k.prop, k.value]), [
    [0, 'opacity', 0],
    [TICKS_PER_SECOND / 2, 'opacity', 100],
    [dur - TICKS_PER_SECOND / 2, 'opacity', 100],
    [dur, 'opacity', 0]
  ])
  // Sorted output invariant.
  for (let i = 1; i < kfs.length; i++) assert.ok(kfs[i].t >= kfs[i - 1].t)
})

check('applyMediaAnimPreset clamps edges to half a short clip', () => {
  const dur = TICKS_PER_SECOND / 4 // 0.25 s clip
  const kfs = applyMediaAnimPreset([], 'fade-in', dur, 100, 100)
  const maxEdge = Math.floor(dur / 2)
  assert.deepEqual(kfs.map(k => k.t), [0, maxEdge])
})

check('applyMediaAnimPreset zoom owns scale only; presets replace each other', () => {
  const dur = 4 * TICKS_PER_SECOND
  const zoom = applyMediaAnimPreset(
    [{ t: 123, prop: 'opacity', value: 40 }, { t: 55, prop: 'x', value: 10 }],
    'zoom-in',
    dur,
    80,
    100
  )
  // Previous opacity wiped (preset owns the channel) but x survives.
  assert.ok(!zoom.some(k => k.prop === 'opacity'))
  assert.ok(zoom.some(k => k.prop === 'x' && k.t === 55))
  assert.deepEqual(
    zoom.filter(k => k.prop === 'scale').map(k => Math.round(k.value)),
    [92, 108] // 100 * 0.92 / 1.08 (rounded: float-safe)
  )
  // Switching to fade-out keeps only the fade edge pair, replaces scale set.
  const faded = applyMediaAnimPreset(zoom, 'fade-out', dur, 80, 100)
  assert.ok(!faded.some(k => k.prop === 'scale'))
  assert.equal(faded.filter(k => k.prop === 'opacity').length, 2)
  // Reset clears both channels, keeps the unrelated x keyframe.
  const reset = applyMediaAnimPreset(faded, 'reset', dur, 80, 100)
  assert.deepEqual(reset.map(k => k.prop), ['x'])
})

// 5. Transition refusal reasons map to existing i18n key suffixes.
check('transitionReasonKey covers every core reason', () => {
  assert.equal(transitionReasonKey('gap'), 'reasonGap')
  assert.equal(transitionReasonKey('too-long'), 'reasonTooLong')
  assert.equal(transitionReasonKey('unknown-type'), 'reasonUnknown')
  assert.equal(transitionReasonKey('no-neighbor'), 'reasonNoNeighbor')
  assert.equal(transitionReasonKey(undefined), 'reasonNoNeighbor')
})

// =============================================================================
//  R128 — registry browsing helpers
// =============================================================================

const REGISTRY_ENTRIES = registryEntries(EFFECT_REGISTRY)

// 6. Search matches type AND label, case-insensitively, never mutating input.
check('searchEffects matches type + label case-insensitively', () => {
  assert.ok(REGISTRY_ENTRIES.length >= 8, 'registry snapshot should carry the legacy effects')
  const byType = searchEffects(REGISTRY_ENTRIES, 'CHROMAKEY')
  assert.deepEqual(byType.map(e => e.type), ['chromakey'])
  // Label match: the descriptor label ('Chroma Key') is searched too.
  const byLabel = searchEffects(REGISTRY_ENTRIES, 'chroma key')
  assert.deepEqual(byLabel.map(e => e.type), ['chromakey'])
  // Partial + case-insensitive substring.
  const partial = searchEffects(REGISTRY_ENTRIES, 'grad')
  assert.deepEqual(partial.map(e => e.type), ['eq-grade'])
  // Empty query = everything (copy, not the caller's array).
  assert.equal(searchEffects(REGISTRY_ENTRIES, '  ').length, REGISTRY_ENTRIES.length)
  const all = searchEffects(REGISTRY_ENTRIES, '')
  assert.notEqual(all, REGISTRY_ENTRIES, 'must return a copy')
  // No match = honest empty list.
  assert.deepEqual(searchEffects(REGISTRY_ENTRIES, 'no-such-effect-xyz'), [])
})

// 7. Grouping: exactly one bucket per entry, 'other' fallback, known order.
check('groupEffectsByCategory puts every entry in exactly one bucket', () => {
  const synthetic: FxRegistryEntry[] = [
    { type: 'a', label: 'A', category: 'blur' },
    { type: 'b', label: 'B', category: 'color' },
    { type: 'c', label: 'C' }, // no category -> 'other'
    { type: 'd', label: 'D', category: '  ' }, // blank -> 'other'
    { type: 'e', label: 'E', category: 'custom-new' } // unknown id -> own bucket
  ]
  const groups = groupEffectsByCategory(synthetic, EFFECT_CATEGORY_ORDER)
  const flat = groups.flatMap(g => g.items.map(i => i.type))
  assert.deepEqual(flat.slice().sort(), ['a', 'b', 'c', 'd', 'e'])
  // No entry appears twice, no bucket is empty.
  assert.equal(new Set(flat).size, flat.length)
  assert.ok(groups.every(g => g.items.length > 0))
  const other = groups.find(g => g.category === FX_OTHER_CATEGORY)
  assert.deepEqual(other?.items.map(i => i.type).sort(), ['c', 'd'])
  // Preferred order wins (blur, then color, then unknown ids, 'other' last).
  assert.deepEqual(groups.map(g => g.category), ['blur', 'color', 'custom-new', FX_OTHER_CATEGORY])

  // Live registry: every descriptor lands in exactly one bucket.
  const live = groupEffectsByCategory(REGISTRY_ENTRIES)
  const liveFlat = live.flatMap(g => g.items.map(i => i.type))
  assert.equal(liveFlat.length, REGISTRY_ENTRIES.length)
  assert.deepEqual(liveFlat.slice().sort(), REGISTRY_ENTRIES.map(e => e.type).sort())
  // Anti-drift: a declared category must be one of the frozen ids (missing
  // categories are contract-legal and land in the 'other' bucket).
  const frozen = new Set(EFFECT_CATEGORY_ORDER.filter(id => id !== FX_OTHER_CATEGORY))
  for (const entry of REGISTRY_ENTRIES) {
    const category = typeof entry.category === 'string' ? entry.category.trim() : ''
    if (category) assert.ok(frozen.has(category), `${entry.type}: category ${category} is not a frozen id`)
  }
})

// 8. Filter preset list is read from the lut3d registry enum (>= 18 after R128).
check('filterPresets mirrors the lut3d registry enum', () => {
  const presets = filterPresets(EFFECT_REGISTRY)
  const lut = EFFECT_REGISTRY.lut3d as FxRegistryEntry
  const enumParam = (lut.params || []).find(p => p.name === 'lut')
  assert.ok(enumParam?.options, 'lut3d must expose the `lut` enum')
  assert.deepEqual(presets, enumParam.options, 'preset list must come from the registry')
  // Legacy compatibility: the first five presets keep their order.
  assert.deepEqual(presets.slice(0, 5), ['neutral', 'warm', 'cool', 'cinematic', 'vintage'])
  // R128 gate: core ships >= 18 distinct filter presets.
  assert.ok(presets.length >= 18, `expected >= 18 LUT presets, got ${presets.length}`)
  assert.equal(new Set(presets).size, presets.length, 'preset ids must be unique')
  // A registry without the descriptor yields an honest empty list.
  assert.deepEqual(filterPresets({}), [])
})

// 9. Filter tile swatches are stable strings for known and unknown presets.
check('lutSwatch is a deterministic CSS gradient', () => {
  const warm = lutSwatch('warm')
  assert.ok(warm.startsWith('linear-gradient(135deg,'))
  assert.equal(warm, lutSwatch('warm'), 'same preset -> same swatch')
  const unknown = lutSwatch('not-a-preset')
  assert.ok(unknown.startsWith('linear-gradient(135deg,'))
  assert.equal(unknown, lutSwatch('not-a-preset'))
  assert.notEqual(unknown, lutSwatch('another-unknown'), 'distinct unknown ids get distinct swatches')
})

// 10. Transition grouping: every core key once, catalog labels win.
check('groupTransitions covers every KNOWN_TRANSITIONS key exactly once', () => {
  assert.ok(KNOWN_TRANSITIONS.length >= 6, 'core exposes its transition keys')
  const catalog: FxTransitionEntry[] = KNOWN_TRANSITIONS.map((key, i) => ({
    key,
    xfade: key,
    category: i < 2 ? 'basic' : 'shape',
    label: `Catalog ${key}`
  }))
  const groups = groupTransitions(KNOWN_TRANSITIONS, catalog)
  const flat = groups.flatMap(g => g.items.map(i => i.key))
  assert.equal(flat.length, KNOWN_TRANSITIONS.length)
  assert.deepEqual(flat.slice().sort(), KNOWN_TRANSITIONS.slice().sort())
  assert.deepEqual(groups.map(g => g.category), ['basic', 'shape'])
  assert.equal(groups[0].items[0].label, `Catalog ${KNOWN_TRANSITIONS[0]}`)
  // Keys missing from the catalog are still shown, under 'other'.
  const partial = groupTransitions(KNOWN_TRANSITIONS, catalog.slice(0, 1))
  const partialFlat = partial.flatMap(g => g.items.map(i => i.key))
  assert.equal(partialFlat.length, KNOWN_TRANSITIONS.length)
  assert.deepEqual(partial.find(g => g.category === FX_OTHER_CATEGORY)?.items.length, KNOWN_TRANSITIONS.length - 1)
  assert.equal(partial.find(g => g.category === FX_OTHER_CATEGORY)?.items[0].label, humanizeKey(KNOWN_TRANSITIONS[1]))
  // No catalog at all: everything still renders (humanized labels).
  const bare = groupTransitions(KNOWN_TRANSITIONS)
  assert.deepEqual(bare.map(g => g.category), [FX_OTHER_CATEGORY])
  assert.equal(bare[0].items.length, KNOWN_TRANSITIONS.length)
  assert.equal(bare[0].items[0].label, humanizeKey(KNOWN_TRANSITIONS[0]))
  // Duplicate keys never create a second tile.
  assert.equal(groupTransitions([...KNOWN_TRANSITIONS, KNOWN_TRANSITIONS[0]]).flatMap(g => g.items).length, KNOWN_TRANSITIONS.length)
})

// 11. transitionsByCategory() Record + label lookup normalization.
check('groupsFromCatalog + transitionLabelFor normalize the fxCatalog surface', () => {
  const catalog: FxTransitionEntry[] = [
    { key: 'circleopen', xfade: 'circleopen', category: 'shape', label: 'Circle Open' },
    { key: 'fade', xfade: 'fade', category: 'basic', label: 'Fade' }
  ]
  const byCategory = { shape: [catalog[0]], basic: [catalog[1]] }
  const groups = groupsFromCatalog(['fade', 'circleopen', 'wipebl'], byCategory)
  assert.deepEqual(groups.map(g => g.category), ['basic', 'shape', FX_OTHER_CATEGORY])
  assert.deepEqual(groups.flatMap(g => g.items.map(i => i.key)), ['fade', 'circleopen', 'wipebl'])
  assert.equal(groups[2].items[0].label, 'Wipebl', 'ungrouped key falls back to a humanized label')
  assert.equal(transitionLabelFor('circleopen', catalog), 'Circle Open')
  assert.equal(transitionLabelFor('wipebl', catalog), 'Wipebl')
  assert.equal(transitionLabelFor('wipebl', null), 'Wipebl')
  assert.deepEqual(groupsFromCatalog(['fade'], null).flatMap(g => g.items.map(i => i.key)), ['fade'])
})

console.log(`\n=== All ${passed} fx-library checks passed ===`)
