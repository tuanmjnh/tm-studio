import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { EXPORT_BAKED_EFFECTS, exportBakesEffect, exportBakesEffectInstance, lutGrade } from 'tmcut-core'
import { EXPORT_EFFECT_TYPES, exportEffectFilter } from '~/utils/tmcut/exportEffectPaint'
import { effectCss, lutCss } from '~/utils/tmcut/fxPreview'

describe('the export painter and the refusal list name the same effects', () => {
  // core's refusal list is the only thing that decides whether a project
  // reaches the painter. An effect the list names as baked but the painter
  // cannot draw produces a file that silently lacks the look; an effect the
  // painter draws but the list refuses rejects a project for no reason.
  it('core publishes the baked list as data, not as a private Set', () => {
    assert.ok(Array.isArray(EXPORT_BAKED_EFFECTS), 'the baked list must be exported so a painter can be held to it')
    assert.ok(EXPORT_BAKED_EFFECTS.length > 0, 'this slice exists to bake at least one effect')
  })

  it('every published type is baked, and nothing else is', () => {
    for (const type of EXPORT_BAKED_EFFECTS) assert.equal(exportBakesEffect(type), true, type)
    assert.equal(exportBakesEffect('chromakey'), false, 'an effect with no painter leg must stay refused')
    assert.equal(exportBakesEffect('definitely-not-an-effect'), false)
  })

  it('the painter registry matches core exactly — no drift either way', () => {
    assert.deepEqual([...EXPORT_EFFECT_TYPES].sort(), [...EXPORT_BAKED_EFFECTS].sort(),
      'the painter and the refusal list disagree — an effect is either drawn or refused, never both')
    // Every type the painter names must be baked for EVERY instance of it; a
    // type-level claim that only holds for some params is a per-instance law.
    for (const type of EXPORT_EFFECT_TYPES) {
      assert.equal(exportBakesEffectInstance({ type, params: {} }), true, `${type} must bake for any instance`)
    }
  })

  it('the painter emits the same filter text the preview does', () => {
    // One formula, two renderers: a second copy of these numbers in the painter
    // is how an export drifts from the monitor while both look "fine" alone.
    const cases: Array<[string, Record<string, unknown>]> = [
      ['mono', { intensity: 100 }],
      ['mono', { intensity: 40 }],
      ['sepia', { intensity: 100 }],
      ['negate', {}],
      ['vivid', { amount: 60 }],
      ['blur', { amount: 50 }],
      ['sharpen', { amount: 50 }],
      ['vibrance', { intensity: 30 }],
      ['mono', {}]
    ]
    for (const [type, params] of cases) {
      const fromPreview = effectCss(type, params)
      assert.ok(fromPreview, `${type} ${JSON.stringify(params)} has no preview filter — the case is stale`)
      assert.equal(exportEffectFilter([{ type, params }]), fromPreview,
        `${type} ${JSON.stringify(params)} would export a different picture than the monitor shows`)
    }
  })

  it('an effect outside the baked list contributes nothing', () => {
    assert.equal(exportEffectFilter([{ type: 'chromakey', params: {} }]), '',
      'a refused effect must never be half-applied')
  })

  it('several effects compose in the order the clip stores them', () => {
    const both = exportEffectFilter([
      { type: 'negate', params: {} },
      { type: 'sepia', params: { intensity: 100 } }
    ])
    assert.equal(both, 'invert(1) sepia(1)')
  })

  it('a null effect list asks for no filter at all', () => {
    assert.equal(exportEffectFilter(null), '')
    assert.equal(exportEffectFilter([]), '')
  })
})

describe('a lut3d preset is baked per instance, by the same rule the printer uses', () => {
  // The reported bug: a project whose only effect was the Filter preset "Cool"
  // was refused, although its whole look is a CSS filter the painter already
  // emits. The decision cannot live in a type list — `film` needs a grain plate
  // and an unknown id is not identity — so it is per instance, in core.
  it('core bakes a plate-free preset and refuses the one that needs a plate', () => {
    assert.equal(exportBakesEffectInstance({ type: 'lut3d', params: { lut: 'cool' } }), true)
    assert.equal(exportBakesEffectInstance({ type: 'lut3d', params: { lut: 'film' } }), false,
      'film carries grain — a plate the canvas painter does not draw')
    assert.equal(exportBakesEffectInstance({ type: 'lut3d', params: { lut: 'no-such-lut' } }), false,
      'an unregistered id is not identity')
  })

  it('every registered preset agrees with its grade shape', () => {
    // The list is derived, not typed: a preset is plate-free exactly when its
    // grade has no grain op. That keeps the answer and the look in one place.
    for (const lut of ['neutral', 'warm', 'cool', 'cinematic', 'vintage', 'vivid', 'fade', 'mono', 'sepia', 'noir', 'bleach', 'teal-orange', 'sunset', 'moonlight', 'forest', 'rose', 'cyberpunk', 'film', 'honey', 'arctic']) {
      const grade = lutGrade(lut)
      const plateFree = grade === null || grade.every(op => op.op !== 'grain')
      assert.equal(exportBakesEffectInstance({ type: 'lut3d', params: { lut } }), plateFree, lut)
    }
  })

  it('the painter emits the preview\'s own words for a baked preset', () => {
    for (const lut of ['warm', 'cool', 'cinematic', 'vintage', 'noir', 'arctic']) {
      const fromPreview = lutCss(lut)
      assert.ok(fromPreview, `${lut} has no preview filter — the case is stale`)
      assert.equal(exportEffectFilter([{ type: 'lut3d', params: { lut } }]), fromPreview,
        `${lut} would export a different picture than the monitor shows`)
    }
  })

  it('a refused preset contributes nothing rather than a half-look', () => {
    assert.equal(exportEffectFilter([{ type: 'lut3d', params: { lut: 'film' } }]), '',
      'film must never be baked by its filter alone — the grain is part of the look')
    assert.equal(exportEffectFilter([{ type: 'lut3d', params: { lut: 'no-such-lut' } }]), '')
  })

  it('a preset composes with a plain effect in the clip\'s authored order', () => {
    const both = exportEffectFilter([
      { type: 'negate', params: {} },
      { type: 'lut3d', params: { lut: 'sepia' } }
    ])
    assert.equal(both, `invert(1) ${lutCss('sepia')}`)
  })
})
