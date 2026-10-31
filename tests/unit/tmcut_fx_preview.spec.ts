// =============================================================================
//  Roadmap v1 §5.1/§5.6 + §6 + §10.2 — the FX preview contract.
//
//  These specs are the guard rails that keep a thumbnail honest:
//   1. COVERAGE   — every registry effect, lut3d preset and catalog transition
//                   has a preview adapter, so a new definition cannot ship as a
//                   generic animation.
//   2. HONESTY    — fidelity + export support are read from @tmcut-core, and an
//                   unknown id reports known:false instead of a guess.
//   3. PARAMS     — the preview visibly responds to the clip's params, clamped
//                   through the registry descriptor.
//   4. MOTION     — with motion off no layer carries an animation at all, and a
//                   transition still shows both frames (split rest state).
//   5. CSS KEYS   — every animation name the resolver emits has a @keyframes in
//                   TmcutFxThumb.vue, and every i18n key the tile renders exists
//                   in BOTH locales (AGENTS.md: no inline fallback strings).
//  Run: pnpm test:fxpreview (or through run-all).
// =============================================================================
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EFFECT_REGISTRY, KNOWN_TRANSITIONS, fxCapabilities, lut3dChain } from '@tmcut-core'
import {
  resolveFxPreview,
  effectAdapterKeys,
  effectCss,
  effectCssParts,
  lutCss,
  effectLoops,
  missingEffectPreviews,
  missingFilterPreviews,
  missingTransitionPreviews,
  lutPresetIds,
  usedAnimationNames
} from '../../app/utils/tmcut/fxPreview'
import type { FxPreviewKind } from '../../app/utils/tmcut/fxPreview'
import { TRANSITION_CATALOG } from '../../app/utils/tmcut/fxCatalog'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const thumbSource = readFileSync(join(root, 'app', 'components', 'tmcut', 'TmcutFxThumb.vue'), 'utf8')
const playerSource = readFileSync(join(root, 'app', 'components', 'tmcut', 'TmcutPreviewPlayer.vue'), 'utf8')
const enLocale = JSON.parse(readFileSync(join(root, 'i18n', 'locales', 'en.json'), 'utf8'))
const viLocale = JSON.parse(readFileSync(join(root, 'i18n', 'locales', 'vi.json'), 'utf8'))

const SCENES = { a: 'url("A")', b: 'url("B")' }
const anim = (type: string, animate = true, params: Record<string, unknown> = {}, kind: FxPreviewKind = 'effect') =>
  resolveFxPreview(kind, type, params, { scenes: SCENES, animate })

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

console.log('=== [TMCut roadmap §5-6 Fx preview contract] Starting ===\n')

// 1. COVERAGE ----------------------------------------------------------------
check('every registry effect except the filters-tab lut3d has an effect adapter', () => {
  assert.deepEqual(missingEffectPreviews(), [])
  assert.ok(effectAdapterKeys().length >= 27, `adapters: ${effectAdapterKeys().length}`)
  // lut3d is a filter, not an effect tile: it must have no effect face.
  assert.equal(resolveFxPreview('effect', 'lut3d', {}, { scenes: SCENES }).status.known, false)
})

check('every catalog transition key has a preview', () => {
  assert.deepEqual(missingTransitionPreviews(), [])
  const unmapped = KNOWN_TRANSITIONS.filter(key => !anim(key, true, {}, 'transition').status.known)
  assert.deepEqual(unmapped, [], `core keys without preview: ${unmapped.join(', ')}`)
  assert.equal(TRANSITION_CATALOG.length, 45)
})

check('every lut3d preset resolves to a grade (or is a documented no-op)', () => {
  assert.deepEqual(missingFilterPreviews(), [])
  const presets = lutPresetIds()
  assert.equal(presets.length, 20)
  assert.equal(presets.includes('neutral'), true)
})

// 2. HONESTY -----------------------------------------------------------------
check('fidelity comes from the core descriptor, never from a UI table', () => {
  for (const type of Object.keys(EFFECT_REGISTRY)) {
    const caps = fxCapabilities(type)
    assert.ok(caps, type)
    const status = anim(type).status
    assert.equal(status.fidelity, caps!.fidelity, `${type} fidelity`)
    assert.equal(status.exportSupported, caps!.exportSupported, `${type} export support`)
  }
})

check('an unknown definition says so instead of inventing a wipe', () => {
  for (const kind of ['effect', 'transition', 'filter'] as const) {
    const preview = resolveFxPreview(kind, 'definitely-not-registered', {}, { scenes: SCENES })
    assert.equal(preview.status.known, false, kind)
    assert.equal(preview.status.fidelity, 'illustrative', kind)
    // No scene-compositing layers are painted for something we do not know.
    assert.equal(preview.layers.filter(layer => layer.backgroundImage).length, 0, kind)
  }
})

check('the fade family is exact, geometry is approximate, keying is illustrative', () => {
  assert.equal(anim('fade', true, {}, 'transition').status.fidelity, 'exact')
  assert.equal(anim('fadeblack', true, {}, 'transition').status.fidelity, 'exact')
  assert.equal(anim('wipe-left', true, {}, 'transition').status.fidelity, 'approximate')
  assert.equal(anim('circleopen', true, {}, 'transition').status.fidelity, 'approximate')
  assert.equal(anim('chromakey').status.fidelity, 'illustrative')
  assert.equal(anim('stabilize').status.fidelity, 'illustrative')
  assert.equal(anim('negate').status.fidelity, 'exact')
})

// 3. PARAMS ------------------------------------------------------------------
check('previews visibly respond to changed params', () => {
  const seen = (type: string, params: Record<string, unknown>) =>
    JSON.stringify(anim(type, true, params).layers)
  assert.notEqual(seen('blur', { amount: 0 }), seen('blur', { amount: 100 }))
  assert.notEqual(seen('vignette', { intensity: 0 }), seen('vignette', { intensity: 100 }))
  assert.notEqual(seen('letterbox', { size: 1 }), seen('letterbox', { size: 40 }))
  assert.notEqual(seen('pixelate', { size: 1 }), seen('pixelate', { size: 64 }))
  assert.notEqual(seen('chromatic', { shift: 1 }), seen('chromatic', { shift: 64 }))
  assert.notEqual(seen('rotate-90', { turns: 1 }), seen('rotate-90', { turns: 3 }))
  assert.notEqual(seen('grain', { amount: 0 }), seen('grain', { amount: 100 }))
  assert.notEqual(seen('eq-grade', { temp: -100 }), seen('eq-grade', { temp: 100 }))
  assert.notEqual(seen('vhs', { amount: 0 }), seen('vhs', { amount: 100 }))
})

check('the letterbox bar fraction follows the export unit (size = % of height)', () => {
  const overlay = anim('letterbox', true, { size: 25 }).layers.find(l => l.background)?.background || ''
  assert.ok(overlay.includes('25%'), overlay)
  assert.ok(overlay.includes('75%'), overlay)
})

check('params are clamped by the registry, so dirty JSON cannot overdrive a tile', () => {
  assert.equal(effectCss('blur', { amount: 9999 }), 'blur(12px)')
  assert.equal(effectCss('blur', { amount: -400 }), 'blur(0px)')
  // Garbage falls back to the descriptor default (50 -> 6px).
  assert.equal(effectCss('blur', { amount: 'lots' }), 'blur(6px)')
  const wild = anim('eq-grade', true, { contrast: -500, saturation: 'x', hue: 9999 }).layers[1]?.filter || ''
  assert.ok(wild.includes('contrast(0)'), wild)
  assert.ok(wild.includes('saturate(1)'), wild)
  assert.ok(/hue-rotate\(180deg\)/.test(wild), wild)
})

check('effectCss is the live-preview face and matches the documented scale', () => {
  assert.equal(effectCss('blur', { amount: 50 }), 'blur(6px)')
  assert.ok(effectCss('sharpen', { amount: 100 }).startsWith('contrast(1.25) brightness(1.05)'))
  assert.equal(effectCss('negate', {}), 'invert(1)')
  // transform-facing effects arrive on the OTHER property: `scaleX(-1)` is not
  // a CSS filter function, so a caller that pasted both into `filter` would
  // silently drop the mirror.
  assert.deepEqual(effectCssParts('mirror-v', { axis: 'vertical' }), { filter: '', transform: 'scaleY(-1)' })
  assert.deepEqual(effectCssParts('mirror-h', { axis: 'both' }), { filter: '', transform: 'scale(-1, -1)' })
  // Overlay-only effects have no single-element filter face: the live player
  // cannot fake them, and the spec must not pretend otherwise.
  assert.equal(effectCss('vignette', {}), '')
  assert.equal(effectCss('nope', {}), '')
})

check('a clip lut3d entry grades the live preview from the export chain', () => {
  const warm = effectCssParts('lut3d', { lut: 'warm' })
  assert.ok(warm.filter.includes('brightness') || warm.filter.includes('sepia'), warm.filter)
  assert.equal(warm.filter, lutCss('warm'))
  // The documented no-op and any id outside the enum must emit nothing.
  assert.equal(lutCss('neutral'), '')
  assert.equal(lutCss('not-a-preset'), '')
  assert.deepEqual(effectCssParts('lut3d', { lut: 'not-a-preset' }), { filter: '', transform: '' })
})

check('eq-grade maps every registered param it can express', () => {
  const grade = effectCss('eq-grade', {
    brightness: 100, contrast: 200, saturation: 0, temp: 100, hue: 180, gamma: 300, fade: 100, vibrance: 100
  })
  for (const token of ['brightness(1.5)', 'contrast(2)', 'saturate(0)', 'sepia(0.3)', 'hue-rotate(180deg)', 'saturate(1.35)']) {
    assert.ok(grade.includes(token), `${grade} missing ${token}`)
  }
})

// 4. MOTION ------------------------------------------------------------------
check('static effects loop by nature only where the definition is time-based', () => {
  const looping = Object.keys(EFFECT_REGISTRY).filter(effectLoops)
  assert.deepEqual(looping, ['grain', 'chromakey', 'stabilize', 'chromatic', 'motion-blur', 'afterimage', 'vhs'])
  assert.equal(effectLoops('blur'), false)
  assert.equal(effectLoops('nope'), false)
})

check('motion off => no layer animates anywhere', () => {
  for (const type of effectAdapterKeys()) {
    const still = anim(type, false)
    assert.equal(still.layers.some(layer => layer.animation), false, `effect ${type} still animates`)
    assert.equal(still.layers.length, resolveFxPreview('effect', type, {}, { scenes: SCENES, animate: true }).layers.length,
      `effect ${type} changed layer count without motion`)
  }
  for (const preset of lutPresetIds()) {
    const still = anim(preset, false, {}, 'filter')
    assert.equal(still.layers.some(layer => layer.animation), false, `filter ${preset} still animates`)
  }
  for (const entry of TRANSITION_CATALOG) {
    const still = anim(entry.key, false, {}, 'transition')
    assert.equal(still.layers.some(layer => layer.animation), false, `transition ${entry.key} still animates`)
  }
})

check('a motionless transition still shows both frames', () => {
  const x = anim('wipe-left', false, {}, 'transition').layers
  assert.equal(x.length, 2)
  // the reveal enters from the left edge, so the still frame keeps B's left half
  assert.equal(x[1]?.clipPath, 'inset(0 50% 0 0)')
  const y = anim('wipeup', false, {}, 'transition').layers
  assert.equal(y[1]?.clipPath, 'inset(50% 0 0 0)')
  const back = anim('wipe-right', false, {}, 'transition').layers
  assert.equal(back[1]?.clipPath, 'inset(0 0 0 50%)')
  const down = anim('wipedown', false, {}, 'transition').layers
  assert.equal(down[1]?.clipPath, 'inset(0 0 50% 0)')
})

check('a transition reveal is a two-scene morph, never a single-plate filter', () => {
  const wipe = anim('wipe-left', true, {}, 'transition').layers
  assert.ok(wipe.some(l => l.backgroundImage === SCENES.a))
  assert.ok(wipe.some(l => l.backgroundImage === SCENES.b))
  const grade = anim('blur', true, { amount: 60 }).layers
  assert.equal(grade.filter(l => l.backgroundImage === SCENES.b).length, 0)
})

check('layer z-order is always defined (nothing paints by accident)', () => {
  for (const type of effectAdapterKeys()) {
    for (const layer of anim(type).layers) assert.equal(typeof layer.zIndex, 'number', `${type} layer`)
  }
  for (const entry of TRANSITION_CATALOG) {
    for (const layer of anim(entry.key, true, {}, 'transition').layers) {
      assert.equal(typeof layer.zIndex, 'number', `${entry.key} layer`)
    }
  }
})

// 5. FILTERS DERIVED FROM THE EXPORT CHAIN -----------------------------------
check('filter grades come from the lut3d chain, not a hand-copied table', () => {
  // 'neutral' is the documented no-op: identity, exact, one plate.
  const neutral = anim('neutral', true, {}, 'filter')
  assert.equal(neutral.layers.length, 1)
  assert.equal(neutral.status.fidelity, 'exact')
  assert.equal(lut3dChain('neutral'), null)
  assert.equal(lut3dChain('not-a-preset'), null)

  const mono = anim('mono', true, {}, 'filter').layers[1]
  assert.ok(mono?.filter?.includes('grayscale(1)'), mono?.filter)
  // eq=saturation survives as a CSS saturate with the same number.
  const vivid = anim('vivid', true, {}, 'filter').layers[1]
  assert.ok(vivid?.filter?.includes('saturate(1.45)'), vivid?.filter)
  // noise in a chain becomes the grain overlay (film is the only one).
  const film = anim('film', true, {}, 'filter').layers
  assert.equal(film.length, 3)
  assert.ok(typeof film[2]?.opacity === 'number')
  // An unregistered preset id is honest about being a placeholder.
  assert.equal(anim('made-up-lut', true, {}, 'filter').status.known, false)
})

// 6. CSS + i18n CONTRACTS ----------------------------------------------------
check('every emitted animation name has @keyframes in the tile', () => {
  const declared = new Set([...thumbSource.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map(m => m[1] as string))
  const used = usedAnimationNames()
  assert.ok(used.length >= 30, `resolver emitted only ${used.length} names`)
  const missing = used.filter(name => !declared.has(name))
  assert.deepEqual(missing, [], `no @keyframes for: ${missing.join(', ')}`)
})

check('the tile carries no hard-coded definition tables of its own', () => {
  // The whole point of §5.1: no parallel EFFECT_SPEC / FILTER_SPEC / switch.
  for (const needle of ['EFFECT_SPEC', 'FILTER_SPEC', 'transitionLayers(', 'hashedGrade']) {
    assert.equal(thumbSource.includes(needle), false, `TmcutFxThumb.vue still contains ${needle}`
    )
  }
  assert.ok(thumbSource.includes('resolveFxPreview'), 'tile must resolve from the registry')
  // …and the live player may not keep a second per-type table either.
  assert.equal(/eff\.type === '/.test(playerSource), false, 'player still branches on effect types')
  assert.ok(playerSource.includes('effectCssParts'), 'player must paint effects from the registry face')
})

check('every tmcut.fxThumb key the tile renders exists in both locales', () => {
  const keys = [...thumbSource.matchAll(/tmcut\.fxThumb\.([A-Za-z0-9_]+)/g)].map(m => m[1] as string)
  assert.ok(keys.length >= 4, `tile references ${keys.length} keys`)
  for (const key of new Set(keys)) {
    assert.equal(typeof enLocale.tmcut?.fxThumb?.[key], 'string', `en.json missing fxThumb.${key}`)
    assert.equal(typeof viLocale.tmcut?.fxThumb?.[key], 'string', `vi.json missing fxThumb.${key}`)
  }
})

check('the tile gates motion on visibility, reduced motion and hover', () => {
  for (const needle of ['IntersectionObserver', 'prefers-reduced-motion', 'animationPlayState', 'onBeforeUnmount']) {
    assert.ok(thumbSource.includes(needle), `TmcutFxThumb.vue lost ${needle}`)
  }
})

console.log(`\n=== FX preview: ${passed}/${passed} checks PASSED ===`)
