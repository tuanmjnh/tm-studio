// =============================================================================
//  Slice F9 (Roadmap v1 §5.6, zero-FFmpeg brief req 4) — an `exact` preview
//  claim is measured against the filter the export actually runs.
//
//  `preview.fidelity` is not decoration. `TmcutFxThumb` turns it into a badge,
//  and `exact` is the badge that tells a creator "what you see is what renders".
//  Until this spec it was a hand-written word with nothing behind it: the CSS
//  face lives in `fxPreview.ts`, the export face lives in
//  `buildFfmpegEffectFilters`, and no test ever put the two side by side. That
//  is precisely the failure a per-file review cannot catch, because each half
//  reads plausible alone — and two of the five claims were false when this was
//  written (`sepia` graded its own saturation, `negate` could not speak `alpha`).
//
//  So every rule below derives its expectation from the SHIPPED filter string
//  rather than from a description of it: a CSS number is checked against the
//  coefficient the file will run at the same param value, and the param is
//  swept rather than sampled once. A rule that only restated the builder would
//  keep passing after the two sides drifted, which is the drift being policed.
// =============================================================================
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EFFECT_REGISTRY, buildFfmpegEffectFilters, fxCapabilities } from 'tmcut-core'
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

/** The one filter the export puts on the chain for one instance of `type`. */
function exportFilter(type: string, params: Record<string, unknown> = {}): string {
  const filters = buildFfmpegEffectFilters([{ type, params }])
  assert.equal(filters.length, 1, `${type} emitted ${filters.length} filters for ${JSON.stringify(params)}`)
  return filters[0]
}

/** `k=v:k=v` after a filter's leading name, e.g. `colorchannelmixer=`. */
function filterArgs(filter: string, name: string): Record<string, string> {
  assert.ok(filter.startsWith(`${name}=`), `${filter} is not a ${name}`)
  const args: Record<string, string> = {}
  for (const pair of filter.slice(name.length + 1).split(':')) {
    const eq = pair.indexOf('=')
    if (eq > 0) args[pair.slice(0, eq)] = pair.slice(eq + 1)
  }
  return args
}

/**
 * The complete set of types allowed to advertise "what you see renders", each
 * with the reason its CSS face IS the export. Anything missing from this table
 * has to be argued for here before it can claim `exact` in the registry — and
 * a claim that stops being true gets named here, not silently dropped.
 */
const EXACT_RULES: Record<string, string> = {
  'sepia': 'colorchannelmixer interpolates identity -> the W3C sepia matrix; CSS sepia(t) is that interpolation',
  'mirror-h': 'hflip/vflip/hflip,vflip are exactly scaleX(-1)/scaleY(-1)/scale(-1,-1)',
  'mirror-v': 'the same axis vocabulary as mirror-h, only a different registry default',
  'letterbox': 'drawbox h=ih*bar paints bars of bar% of frame height, which is the gradient stop'
}

/** Types the registry may NOT claim exact, with the reason, so a re-claim fails. */
const NOT_EXACT: Record<string, string> = {
  negate: '`alpha` switches the file to negate=negate_alpha=1; CSS invert() has no alpha face'
}

console.log('=== [Slice F9: an exact FX claim is measured against the export filter] Starting ===\n')

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
/** CSS `sepia(t)`: each coefficient is identity + (target - identity) * t. */
const CSS_SEPIA: Record<string, [number, number]> = {
  rr: [1, 0.393], rg: [0, 0.769], rb: [0, 0.189],
  gr: [0, 0.349], gg: [1, 0.686], gb: [0, 0.168],
  br: [0, 0.272], bg: [0, 0.534], bb: [1, 0.131]
}

check('sepia: the matrix in the file IS the CSS interpolation, at every strength', () => {
  const intensities = [undefined, 0, 10, 25, 60, 100, -20, 140]
  for (const raw of intensities) {
    const at = `intensity ${raw === undefined ? '(default)' : raw}`
    const args = filterArgs(exportFilter('sepia', raw === undefined ? {} : { intensity: raw }), 'colorchannelmixer')
    assert.deepEqual(Object.keys(args).sort(), Object.keys(CSS_SEPIA).sort(), `${at}: coefficients ${JSON.stringify(args)}`)

    // Solve t independently from all nine coefficients. If the export's matrix
    // were any other family (a fixed sepia, a saturation twist) the nine
    // answers would not agree, and no CSS `sepia()` could match it.
    const solved = Object.entries(CSS_SEPIA).map(([key, [id, target]]) => {
      const value = Number(args[key])
      assert.ok(Number.isFinite(value), `${key}=${args[key]} is not a number`)
      return (value - id) / (target - id)
    })
    const worst = Math.max(...solved.map(t => Math.abs(t - solved[0])))
    assert.ok(worst < 0.002, `coefficients disagree on t by ${worst.toFixed(4)} at ${at}`)

    // Now the claim itself: one function, and the same strength the file runs.
    const css = effectCss('sepia', raw === undefined ? {} : { intensity: raw })
    assert.equal(css, `sepia(${Number(solved[0].toFixed(3))})`, `${at}: CSS face vs the shipped matrix`)
    assert.equal(css.split('(').length - 1, 1, `${at}: ${css} grades more than sepia`)
  }
})

// 3. NEGATE -------------------------------------------------------------------
check('negate: invert(1) matches the black-and-white case and alpha is not claimed', () => {
  assert.equal(exportFilter('negate'), 'negate')
  assert.equal(effectCss('negate'), 'invert(1)', 'CSS stopped matching plain negate')

  // The reason the claim cannot survive: one param changes what the file bakes
  // and CSS has no way to say it. Prove the param is real before grading the label.
  assert.equal(exportFilter('negate', { alpha: true }), 'negate=negate_alpha=1')
  assert.equal(effectCss('negate', { alpha: true }), 'invert(1)', 'the CSS face pretends to read alpha')
})

// 4. MIRROR -------------------------------------------------------------------
const AXIS_EXPORT: Record<string, string> = {
  horizontal: 'hflip',
  vertical: 'vflip',
  both: 'hflip,vflip'
}
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
      assert.equal(exportFilter(type, { axis }), AXIS_EXPORT[wanted], `${type} axis ${axis}: export`)
      assert.equal(effectCssParts(type, { axis }).transform, AXIS_CSS[wanted], `${type} axis ${axis}: CSS`)
      assert.equal(effectCss(type, { axis }), '', `${type} must not grade the picture it flips`)
    }
    // The tile and the monitor read one face: the transform layer carries it.
    const layer = resolveFxPreview('effect', type, { axis: 'both' }, { scenes: SCENES, animate: false }).layers[1]
    assert.equal(layer.transform, AXIS_CSS.both)
  }
})

// 5. LETTERBOX ----------------------------------------------------------------
check('letterbox: the CSS bar is the drawbox height, across the whole range', () => {
  for (const raw of [undefined, 1, 5, 12, 27, 40, 0, 45, 120]) {
    const params = raw === undefined ? {} : { size: raw }
    const filter = exportFilter('letterbox', params)
    const heights = [...filter.matchAll(/h=ih\*([\d.]+)/g)].map(m => Number(m[1]))
    assert.equal(heights.length, 2, `${filter} is not a pair of bars`)
    const [top, bottom] = heights
    const offsets = [...filter.matchAll(/y=ih\*([\d.]+)/g)].map(m => Number(m[1]))
    assert.deepEqual(offsets, [Number((1 - bottom).toFixed(2))], `${filter}: the lower bar is not symmetric`)

    const overlay = effectOverlay('letterbox', params)
    assert.ok(overlay, 'letterbox lost its plate — the bars would only live on the tile')
    // `#000 0 B%, transparent B% (100-B)%, #000 (100-B)%` — four stops, two bars.
    const pct = (value: number) => Number(value.toFixed(2))
    const stops = [...String(overlay.background).matchAll(/([\d.]+)%/g)].map(m => pct(Number(m[1])))
    const expected = [pct(top * 100), pct(top * 100), pct((1 - bottom) * 100), pct((1 - bottom) * 100)]
    assert.deepEqual(stops, expected, `bars at ${stops}% vs export ${filter}`)

    // Same face on both hosts: the tile's plate is the plate the monitor gets.
    const layers = resolveFxPreview('effect', 'letterbox', params, { scenes: SCENES, animate: false }).layers
    assert.ok(layers.some(layer => layer.background === overlay.background), 'tile and player paint different bars')
  }
})

// 6. ONE BRIDGE ---------------------------------------------------------------
/** CSS that grades or flips a picture. Written anywhere but the bridge, it is a
 *  private look the export has never heard of — the thing req 4 forbids. */
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
