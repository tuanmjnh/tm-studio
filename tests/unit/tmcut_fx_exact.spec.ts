// =============================================================================
//  Slice F9 (Roadmap v1 §5.6, zero-FFmpeg brief req 4) — an `exact` preview
//  claim is measured, never hand-written.
//
//  `preview.fidelity` is not decoration. `TmcutFxThumb` turns it into a badge,
//  and `exact` is the badge that tells a creator "what you see is the effect".
//  The original spec put the CSS face side by side with the FFmpeg filter the
//  export ran. Slice J retired that export face: the WebCodecs exporter refuses
//  effect clips outright (planEncodeContent), so there is no filter string to
//  compare against. The living half of the contract survives and is re-anchored
//  on the EFFECT DEFINITION: the registry's param bounds and the core clamp law
//  (`clampEffectParam`) derive every expected number independently of the CSS
//  builder, and the param is swept rather than sampled once. A builder that
//  drifts from the registry — a private saturation lift, a wrong clamp — fails
//  here, which is the drift being policed.
// =============================================================================
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECT_REGISTRY, clampEffectParam, fxCapabilities } from 'tmcut-core'
import {
  effectAdapterKeys,
  effectCss,
  effectCssParts,
  effectOverlay,
  resolveFxPreview
} from '../../app/utils/tmcut/fxPreview'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCENES = { a: 'url("A")', b: 'url("B")' }

let passed = 0
function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/**
 * The registry's own answer for one param: the core clamp law applied to the
 * raw value (undefined falls back to the descriptor default). This is the
 * independent anchor — a different module from the CSS builder under test.
 */
function registryParam(type: string, name: string, raw?: unknown): number {
  const spec = EFFECT_REGISTRY[type].params.find(p => p.name === name)
  assert.ok(spec, `${type} lost its ${name} param`)
  const value = clampEffectParam(type, name, raw === undefined ? spec.default : raw)
  assert.equal(typeof value, 'number', `${type}.${name} did not clamp to a number`)
  return value as number
}

/** The param normalised to 0..1 across its documented registry range. */
function registryUnit(type: string, name: string, raw?: unknown): number {
  const spec = EFFECT_REGISTRY[type].params.find(p => p.name === name)
  const min = typeof spec?.min === 'number' ? spec.min : 0
  const max = typeof spec?.max === 'number' ? spec.max : 100
  const t = (registryParam(type, name, raw) - min) / (max - min)
  return Math.max(0, Math.min(1, t))
}

/**
 * The complete set of types allowed to advertise "what you see is the effect",
 * each with the reason its CSS face IS the definition. Anything missing from
 * this table has to be argued for here before it can claim `exact` in the
 * registry — and a claim that stops being true gets named here, not silently
 * dropped.
 */
const EXACT_RULES: Record<string, string> = {
  'sepia': 'CSS sepia(t) is the W3C identity -> sepia-matrix interpolation; the face emits exactly that one function at the registry-clamped strength',
  'mirror-h': 'the axis vocabulary maps one-to-one onto scaleX(-1)/scaleY(-1)/scale(-1,-1)',
  'mirror-v': 'the same axis vocabulary as mirror-h, only a different registry default',
  'letterbox': 'bars of size% of frame height are exactly the four gradient stops'
}

/** Types the registry may NOT claim exact, with the reason, so a re-claim fails. */
const NOT_EXACT: Record<string, string> = {
  negate: '`alpha` is a real registry param with no CSS face — invert() cannot invert alpha'
}

console.log('=== [Slice F9/J: an exact FX claim is measured against the effect definition] Starting ===\n')

// 1. THE CLAIM SET ------------------------------------------------------------
check('the registry\'s `exact` claims are exactly the rules proven below', () => {
  const claimed = Object.keys(EFFECT_REGISTRY)
    .filter(type => fxCapabilities(type)?.fidelity === 'exact')
    .sort()
  assert.deepEqual(claimed, Object.keys(EXACT_RULES).sort(), 'an exact claim moved without a rule here')
  // A rule list that could be satisfied by one entry would police nothing.
  assert.ok(claimed.length >= 4, `only ${claimed.length} exact claims — the set is too small to guard`)
  for (const type of claimed) {
    assert.ok(effectAdapterKeys().includes(type), `${type} claims exact but has no CSS face to compare`)
    assert.equal(resolveFxPreview('effect', type, {}, { scenes: SCENES }).status.fidelity, 'exact')
  }
  for (const [type, reason] of Object.entries(NOT_EXACT)) {
    const caps = fxCapabilities(type)
    assert.ok(caps, `${type} left the registry`)
    assert.notEqual(caps.fidelity, 'exact', `${type} claims exact again — ${reason}`)
  }
})

// 2. SEPIA --------------------------------------------------------------------
check('sepia: one function at the registry-clamped strength, across the sweep', () => {
  const intensities = [undefined, 0, 10, 25, 60, 100, -20, 140]
  for (const raw of intensities) {
    const at = `intensity ${raw === undefined ? '(default)' : raw}`
    // The strength is solved from the core clamp law + registry bounds, not
    // from the builder: out-of-range values must land on the documented edge.
    const t = registryUnit('sepia', 'intensity', raw)
    const css = effectCss('sepia', raw === undefined ? {} : { intensity: raw })
    assert.equal(css, `sepia(${Number(t.toFixed(3))})`, `${at}: CSS face vs the registry law`)
    assert.equal(css.split('(').length - 1, 1, `${at}: ${css} grades more than sepia`)
  }
})

// 3. NEGATE -------------------------------------------------------------------
check('negate: invert(1) is the black-and-white face and alpha is not pretended', () => {
  // The reason the claim cannot survive: one param is real in the registry
  // and CSS has no way to say it. Prove the param exists before grading the label.
  const alpha = EFFECT_REGISTRY.negate.params.find(p => p.name === 'alpha')
  assert.ok(alpha, 'negate lost its alpha param — the NOT_EXACT reason would be stale')
  assert.equal(effectCss('negate'), 'invert(1)', 'CSS stopped matching plain negate')
  assert.equal(effectCss('negate', { alpha: true }), 'invert(1)', 'the CSS face pretends to read alpha')
})

// 4. MIRROR -------------------------------------------------------------------
const AXIS_CSS: Record<string, string> = {
  horizontal: 'scaleX(-1)',
  vertical: 'scaleY(-1)',
  both: 'scale(-1, -1)'
}

check('mirror-h / mirror-v: the axis vocabulary maps one-to-one, default included', () => {
  for (const type of ['mirror-h', 'mirror-v']) {
    const spec = EFFECT_REGISTRY[type].params.find(p => p.name === 'axis')
    assert.ok(spec?.options, `${type} lost its axis options`)
    for (const axis of [...spec.options, 'diagonal', undefined]) {
      // An axis outside the enum falls back to the param default, which differs
      // per type — so the fallback is read from the registry, never from here.
      const wanted = axis === undefined || !(spec.options as string[]).includes(axis)
        ? String(spec.default)
        : String(axis)
      assert.equal(effectCssParts(type, { axis }).transform, AXIS_CSS[wanted], `${type} axis ${axis}: CSS`)
      assert.equal(effectCss(type, { axis }), '', `${type} must not grade the picture it flips`)
    }
    // The tile and the monitor read one face: the transform layer carries it.
    const layer = resolveFxPreview('effect', type, { axis: 'both' }, { scenes: SCENES, animate: false }).layers[1]
    assert.equal(layer.transform, AXIS_CSS.both)
  }
})

// 5. LETTERBOX ----------------------------------------------------------------
check('letterbox: the CSS bar is the registry-clamped size, across the whole range', () => {
  for (const raw of [undefined, 1, 5, 12, 27, 40, 0, 45, 120]) {
    const params = raw === undefined ? {} : { size: raw }
    // Bar height solved from the core clamp law, then the documented 0..45
    // paint cap — independent of the builder that formats the gradient.
    const bar = Math.max(0, Math.min(45, Math.round(registryParam('letterbox', 'size', raw))))

    const overlay = effectOverlay('letterbox', params)
    assert.ok(overlay, 'letterbox lost its plate — the bars would only live on the tile')
    // `#000 0 B%, transparent B% (100-B)%, #000 (100-B)%` — four stops, two bars.
    const stops = [...String(overlay.background).matchAll(/([\d.]+)%/g)].map(m => Number(m[1]))
    assert.deepEqual(stops, [bar, bar, 100 - bar, 100 - bar], `bars at ${stops}% vs registry size ${bar}%`)

    // Same face on both hosts: the tile's plate is the plate the monitor gets.
    const layers = resolveFxPreview('effect', 'letterbox', params, { scenes: SCENES, animate: false }).layers
    assert.ok(layers.some(layer => layer.background === overlay.background), 'tile and player paint different bars')
  }
})

// 6. ONE BRIDGE ---------------------------------------------------------------
/** CSS that grades or flips a picture. Written anywhere but the bridge, it is a
 *  private look the definition has never heard of — the thing req 4 forbids. */
const FX_CSS = ['saturate(', 'grayscale(', 'invert(', 'hue-rotate(', 'brightness(', 'sepia(', 'scaleX(-1)', 'scaleY(-1)']

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) sourceFiles(rel, out)
    else if (/\.(ts|vue)$/.test(entry.name)) out.push(rel)
  }
  return out
}

check('fxPreview.ts is the only file in the app that writes an effect face', () => {
  const bridge = 'app/utils/tmcut/fxPreview.ts'
  const scanned = ['app/components/tmcut', 'app/utils/tmcut', 'app/composables'].flatMap(dir => sourceFiles(dir))
  assert.ok(scanned.length >= 40, `only ${scanned.length} files scanned — the sweep is not real`)
  const offenders = scanned
    .filter(rel => rel !== bridge)
    .filter(rel => FX_CSS.some(token => readFileSync(join(ROOT, rel), 'utf8').includes(token)))
  assert.deepEqual(offenders, [], 'a second place invented a CSS look; both hosts must read the bridge')

  const source = readFileSync(join(ROOT, bridge), 'utf8')
  assert.ok(source.includes('fxCapabilities'), 'the bridge stopped reading the registry claims')
})

check('TmcutFxThumb invents no effect look of its own', () => {
  const source = readFileSync(join(ROOT, 'app/components/tmcut/TmcutFxThumb.vue'), 'utf8')
  const script = source.slice(0, source.indexOf('</script>'))
  // Every visual decision must come back from `resolveFxPreview`. A quoted
  // effect type inside the component means a switch crept back in, and then a
  // registry entry and a tile can disagree without either file looking wrong.
  for (const type of Object.keys(EFFECT_REGISTRY)) {
    assert.ok(!script.includes(`'${type}'`), `TmcutFxThumb.vue branches on '${type}' locally`)
  }
  assert.ok(script.includes('resolveFxPreview'), 'the tile stopped delegating to the resolver')
  assert.ok(!/filter:\s*[a-z(]/m.test(script), 'the tile declares a CSS filter itself')
})

console.log(`\n=== FX exact-claims: ${passed}/${passed} checks PASSED ===`)
