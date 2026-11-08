// tmcut-core — effects registry tests (Roadmap C6). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EFFECT_REGISTRY, validateEffect, normalizeEffects, fxCapabilities, clampEffectParam, lutGrade } from '../src/effects.mjs'
import { exportBakesEffect, planEncodeContent } from '../src/exportContent.mjs'
import { TICKS_PER_SECOND } from '../src/time.mjs'

const FIRST_WAVE = [
  'blur', 'sharpen', 'vignette', 'grain', 'chromakey', 'lut3d', 'stabilize', 'eq-grade'
]

// R128: the registry grew from 8 to a CapCut-scale library, so the pin is
// structural (shape + honesty) instead of an exact key list — plus a guard
// that the original 8 keys never disappear (stored projects depend on them).
const CATEGORIES = ['blur', 'sharpen', 'light', 'color', 'stylize', 'distort', 'keying', 'motion', 'retro', 'texture']

describe('effects (C6)', () => {
  it('registry keeps the first wave and stays structurally sound', () => {
    for (const legacy of FIRST_WAVE) {
      assert.ok(EFFECT_REGISTRY[legacy], `lost legacy effect: ${legacy}`)
    }
    assert.ok(Object.keys(EFFECT_REGISTRY).length > FIRST_WAVE.length, 'R128 expansion missing')
    for (const [key, desc] of Object.entries(EFFECT_REGISTRY)) {
      assert.ok(key.length > 0)
      assert.equal(desc.type, key)
      assert.ok(desc.label.length > 0)
      assert.ok(CATEGORIES.includes(desc.category), `${key}: bad category ${desc.category}`)
      assert.ok(Array.isArray(desc.params) && desc.params.length > 0)
      for (const param of desc.params) {
        assert.ok(param.name.length > 0)
        assert.ok(['number', 'color', 'enum', 'bool'].includes(param.kind))
        // Numbers need a range, enums need options — normalize relies on both.
        if (param.kind === 'number') {
          assert.ok(Number.isFinite(param.min) && Number.isFinite(param.max))
          assert.ok(param.min < param.max)
        }
        if (param.kind === 'enum') assert.ok(Array.isArray(param.options) && param.options.length > 0)
        assert.ok('default' in param)
      }
      // Definition-completeness flag: every shipped effect carries a full
      // semantic face (params + preview descriptor; grade ops for lut3d).
      assert.equal(desc.renderReady, true)
    }
  })

  it('lut3d ships the R128 preset grid (>= 18 grades)', () => {
    const lut = EFFECT_REGISTRY.lut3d.params.find(p => p.name === 'lut')
    assert.ok(lut.options.length >= 18)
    // Ambient presets were the original five presets, minus the R128 neutral
    // no-op prepended — stored projects resolve 'warm'/'cool'/… byte-identically.
    assert.deepEqual(lut.options.slice(0, 5), ['neutral', 'warm', 'cool', 'cinematic', 'vintage'])
    assert.ok(lut.options.includes('teal-orange'))
    assert.ok(lut.options.includes('cyberpunk'))
    // An unknown preset must still validate-reject (options list is the whitelist).
    assert.ok(validateEffect({ type: 'lut3d', params: { lut: 'nope' } }).length > 0)
  })

  it('eq-grade carries the R128 grading params', () => {
    const names = EFFECT_REGISTRY['eq-grade'].params.map(p => p.name)
    for (const n of ['brightness', 'contrast', 'saturation', 'temp', 'hue', 'gamma', 'fade', 'vibrance']) {
      assert.ok(names.includes(n), `eq-grade missing ${n}`)
    }
  })

  it('validates shape and rejects unknown types', () => {
    assert.ok(validateEffect(null).length > 0)
    assert.ok(validateEffect('blur').length > 0)
    assert.deepEqual(validateEffect({ type: 'sparkle', params: {} }), ['unknown effect type: sparkle'])
    assert.deepEqual(validateEffect({ type: 'blur', params: { amount: 50 } }), [])
    // Missing params are legal (normalize fills the defaults later).
    assert.deepEqual(validateEffect({ type: 'blur' }), [])
    assert.ok(validateEffect({ type: 'blur', params: 'nope' }).length > 0)
  })

  it('reports out-of-range, wrong-typed and unknown params', () => {
    assert.match(
      validateEffect({ type: 'blur', params: { amount: 200 } })[0],
      /out of range \[0, 100\]/
    )
    assert.match(
      validateEffect({ type: 'eq-grade', params: { brightness: -150 } })[0],
      /out of range \[-100, 100\]/
    )
    assert.match(
      validateEffect({ type: 'blur', params: { amount: 'high' } })[0],
      /must be a number/
    )
    assert.match(
      validateEffect({ type: 'blur', params: { bogus: 1 } })[0],
      /unknown param: bogus/
    )
    assert.match(
      validateEffect({ type: 'chromakey', params: { color: 'green' } })[0],
      /hex color/
    )
    assert.match(
      validateEffect({ type: 'chromakey', params: { spill: 'yes' } })[0],
      /must be a boolean/
    )
    assert.match(
      validateEffect({ type: 'lut3d', params: { lut: 'not-a-preset' } })[0],
      /not in options/
    )
  })

  it('normalize drops unknown entries and unknown fields', () => {
    const list = normalizeEffects([
      { type: 'blur', params: { amount: 80, bogus: 1 }, extra: true },
      { type: 'sparkle', params: {} },
      'garbage',
      { type: 'chromakey', params: { color: '#ff0000' } },
      null
    ])
    assert.equal(list.length, 2)
    // Registry whitelist: `bogus` gone, entry-level `extra` never copied.
    assert.deepEqual(list[0], { type: 'blur', params: { amount: 80 } })
    assert.deepEqual(list[1], {
      type: 'chromakey',
      params: { color: '#ff0000', similarity: 30, blend: 10, spill: true }
    })
    for (const effect of list) assert.deepEqual(validateEffect(effect), [])
    assert.deepEqual(normalizeEffects('nope'), [])
  })

  it('normalize clamps numbers and repairs invalid values to defaults', () => {
    const [blurred] = normalizeEffects([{ type: 'blur', params: { amount: 999 } }])
    assert.equal(blurred.params.amount, 100)
    const [graded] = normalizeEffects([{ type: 'eq-grade', params: { brightness: 'x', contrast: 150 } }])
    // R128 added hue/gamma/fade/vibrance — normalize fills every default.
    assert.deepEqual(graded.params, { brightness: 0, contrast: 150, saturation: 100, temp: 0, hue: 0, gamma: 100, fade: 0, vibrance: 0 })
    const [keyed] = normalizeEffects([{ type: 'chromakey', params: { color: 'green' } }])
    assert.equal(keyed.params.color, '#00ff00')
    const [loose] = normalizeEffects([{ type: 'blur' }])
    assert.equal(loose.params.amount, 50)
  })
})

// Roadmap v1 §5.6 / §6.5 — the registry is the only source the preview surface may
// read from: fidelity, export support and bounds all come from here, so a tile
// can never claim more than the renderer delivers.
describe('fx capabilities contract (roadmap v1 §5-6)', () => {
  const FIDELITY = ['exact', 'approximate', 'illustrative']

  it('every descriptor declares a preview strategy and honest fidelity', () => {
    for (const [key, desc] of Object.entries(EFFECT_REGISTRY)) {
      assert.ok(desc.preview, `${key} has no preview descriptor`)
      assert.equal(desc.preview.strategy, 'css', `${key} preview strategy`)
      assert.ok(FIDELITY.includes(desc.preview.fidelity), `${key} fidelity ${desc.preview.fidelity}`)
    }
  })

  it('fxCapabilities mirrors the descriptor and rejects unknown types', () => {
    assert.equal(fxCapabilities('no-such-effect'), null)
    for (const [key, desc] of Object.entries(EFFECT_REGISTRY)) {
      const caps = fxCapabilities(key)
      assert.equal(caps.fidelity, desc.preview.fidelity)
      assert.equal(caps.previewReady, desc.renderReady === true)
      assert.equal(caps.label, desc.label)
      assert.equal(caps.category, desc.category)
      // Preview readiness is not export support. The registry cannot answer the
      // second question, and a boolean here would be read as if it had.
      assert.equal('exportSupported' in caps, false, `${key} still publishes one boolean for two capabilities`)
    }
  })

  // A complete definition is not an exportable one. `planEncodeContent` names
  // 'effects' for every clip that carries one, so a tile claiming "exportable"
  // sends the user to a button that then refuses their project.
  it('the exporter answers export support itself, and today it bakes no effect', () => {
    const project = {
      version: 3,
      canvas: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 } },
      markers: [],
      tracks: [{
        id: 'row-a',
        type: 'video',
        items: [{
          id: 'a',
          type: 'video',
          source: { in: 0, out: 4 * TICKS_PER_SECOND },
          timeline: { start: 0, duration: 4 * TICKS_PER_SECOND },
          speed: 1,
          transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
          effects: [{ type: 'blur', params: {} }],
          keyframes: []
        }]
      }]
    }
    assert.deepEqual(planEncodeContent(project).reasons, ['effects'], 'the painter still refuses a clip with effects')

    for (const key of Object.keys(EFFECT_REGISTRY)) {
      assert.equal(fxCapabilities(key).previewReady, true, `${key} ships a preview face`)
      assert.equal(exportBakesEffect(key), false, `${key} claims an export the painter refuses`)
    }
    assert.equal(exportBakesEffect('no-such-effect'), false)
  })

  it('fidelity is a documented stance, not a default', () => {
    // Only where CSS runs the identical maths may a tile claim exact: mirror /
    // letterbox / sepia. negate's `alpha` param bakes a channel CSS invert()
    // cannot touch, blur's sigma, colorbalance and the temporal families are
    // approximations and must say so (roadmap v1 §5.6, F9).
    assert.equal(fxCapabilities('negate').fidelity, 'approximate')
    assert.equal(fxCapabilities('letterbox').fidelity, 'exact')
    assert.equal(fxCapabilities('blur').fidelity, 'approximate')
    assert.equal(fxCapabilities('eq-grade').fidelity, 'approximate')
    assert.equal(fxCapabilities('chromakey').fidelity, 'illustrative')
    assert.equal(fxCapabilities('stabilize').fidelity, 'illustrative')
    const illustrative = Object.keys(EFFECT_REGISTRY).filter(k => fxCapabilities(k).fidelity === 'illustrative')
    assert.ok(illustrative.length > 0, 'nothing admitted to being an approximation')
  })

  it('clampEffectParam enforces the documented bounds', () => {
    assert.equal(clampEffectParam('blur', 'amount', 9999), 100)
    assert.equal(clampEffectParam('blur', 'amount', -400), 0)
    assert.equal(clampEffectParam('blur', 'amount', 'lots'), 50)
    // an out-of-enum choice repairs to the documented default, never to a
    // random preset — and the repaired value always passes validation.
    const lutParam = EFFECT_REGISTRY.lut3d.params.find(p => p.name === 'lut')
    assert.equal(clampEffectParam('lut3d', 'lut', 'not-a-preset'), lutParam.default)
    assert.equal(clampEffectParam('blur', 'nope', 1), undefined)
    assert.equal(clampEffectParam('no-such-effect', 'amount', 1), undefined)
    assert.deepEqual(validateEffect({ type: 'blur', params: { amount: clampEffectParam('blur', 'amount', 500) } }), [])
  })
})

// Slice J — the grade is a semantic instruction list, not FFmpeg filter text.
// Each op is a typed object a GPU/canvas/Web Audio renderer can consume; the UI
// maps the same ops to CSS. Order is preserved so the preview does not drift.
describe('lutGrade — semantic grade ops (slice J)', () => {
  const OPS = ['balance', 'eq', 'curves', 'desaturate', 'sepia', 'grain']
  const presets = EFFECT_REGISTRY.lut3d.params.find(p => p.name === 'lut').options

  it('neutral and unknown ids are the documented no-op (null)', () => {
    assert.equal(lutGrade('neutral'), null)
    assert.equal(lutGrade('nope'), null)
    assert.equal(lutGrade(''), null)
  })

  it('every registered non-neutral preset ships a non-empty op list', () => {
    for (const preset of presets) {
      if (preset === 'neutral') continue
      const grade = lutGrade(preset)
      assert.ok(Array.isArray(grade) && grade.length > 0, `${preset} has no grade`)
      for (const op of grade) {
        assert.ok(OPS.includes(op.op), `${preset}: unknown op ${op.op}`)
        assert.equal(typeof op, 'object')
      }
      // No FFmpeg syntax survives: an op is never a filter string.
      assert.ok(grade.every(op => typeof op !== 'string'), `${preset} grade carries a string`)
    }
  })

  it('carries the exact grade values, in chain order', () => {
    assert.deepEqual(lutGrade('warm'), [{ op: 'balance', rs: 0.12, gs: 0.02, bs: -0.1 }])
    assert.deepEqual(lutGrade('cinematic'), [
      { op: 'curves', preset: 'cross_process' },
      { op: 'eq', contrast: 1.1, saturation: 1.15 }
    ])
    assert.deepEqual(lutGrade('vivid'), [{ op: 'eq', saturation: 1.45, contrast: 1.12, brightness: 0.02 }])
    assert.deepEqual(lutGrade('sepia'), [{ op: 'sepia' }])
    assert.deepEqual(lutGrade('film'), [
      { op: 'curves', preset: 'medium_contrast' },
      { op: 'eq', saturation: 0.92, brightness: 0.01 },
      { op: 'grain', amount: 4 }
    ])
  })

  it('mono and noir desaturate; balance keeps midtone/highlight offsets', () => {
    assert.ok(lutGrade('mono').some(op => op.op === 'desaturate'))
    assert.ok(lutGrade('noir').some(op => op.op === 'desaturate'))
    // teal-orange carries rh/rm the CSS preview cannot show but a GPU grade can.
    const teal = lutGrade('teal-orange').find(op => op.op === 'balance')
    assert.equal(teal.rh, 0.14)
    assert.equal(teal.rm, 0.1)
    assert.equal(teal.bs, 0.18)
  })

  it('eq ops only carry the fields the preset actually sets', () => {
    // warm has no eq op at all; vintage eq has no brightness.
    assert.ok(lutGrade('warm').every(op => op.op !== 'eq'))
    const vintageEq = lutGrade('vintage').find(op => op.op === 'eq')
    assert.deepEqual(vintageEq, { op: 'eq', contrast: 0.95, saturation: 0.85 })
  })
})
