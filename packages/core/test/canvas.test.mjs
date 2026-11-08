// tmcut-core — canvas tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  aspectValue,
  orientationOf,
  ratioIdOf,
  findCanvasPreset,
  findCanvasPresetByDimensions,
  normalizeCanvas,
  computeFitObjectStyle,
  reframeTransform,
  previewScale,
  safeAreaRects,
  SAFE_AREA_PRESETS,
  clampCropRect,
  applyCropRatio
} from '../src/canvas.mjs'

describe('canvas', () => {
  it('computes aspect values and orientations', () => {
    assert.equal(aspectValue(1920, 1080), 16 / 9)
    assert.equal(aspectValue(0, 1080), 0)
    assert.equal(orientationOf(1080, 1920), 'portrait')
    assert.equal(orientationOf(1080, 1080), 'square')
    assert.equal(orientationOf(0, 0), 'landscape')
  })

  it('resolves presets and ratio labels', () => {
    assert.equal(findCanvasPreset('9:16').width, 1080)
    assert.equal(findCanvasPreset('nope'), null)
    assert.equal(findCanvasPresetByDimensions(1080, 1920).id, '9:16')
    assert.equal(ratioIdOf(1920, 1080), '16:9')
    assert.equal(ratioIdOf(100, 100), '100x100')
  })

  it('normalizes partial canvas input to v3 with rational fps', () => {
    const canvas = normalizeCanvas({ width: 1080, height: 1920, fps: 30 })
    assert.equal(canvas.width, 1080)
    assert.deepEqual(canvas.fps, { numerator: 30, denominator: 1 })
    assert.equal(canvas.aspectRatio.id, '9:16')
    const defaults = normalizeCanvas(undefined)
    assert.equal(defaults.width, 1920)
    assert.deepEqual(defaults.background, { type: 'color', value: '#000000' })
    const kept = normalizeCanvas({ width: 0, height: -5, fps: 0 })
    assert.equal(kept.width, 1920)
    assert.deepEqual(kept.fps, { numerator: 30, denominator: 1 })
  })

  it('computes preview fit styles per mode', () => {
    assert.deepEqual(computeFitObjectStyle('fit'), { objectFit: 'contain', objectPosition: '50% 50%' })
    assert.deepEqual(computeFitObjectStyle('fill'), { objectFit: 'cover', objectPosition: '50% 50%' })
    assert.deepEqual(computeFitObjectStyle('stretch'), { objectFit: 'fill', objectPosition: '50% 50%' })
    assert.deepEqual(computeFitObjectStyle('smart', 0.25, 0.75), { objectFit: 'cover', objectPosition: '25% 75%' })
    const cropped = computeFitObjectStyle('crop', 0.5, 0.5, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    assert.equal(cropped.objectFit, 'cover')
    assert.deepEqual(computeFitObjectStyle('crop'), { objectFit: 'contain', objectPosition: '50% 50%' })
  })

  it('reframes offsets proportionally', () => {
    assert.deepEqual(reframeTransform(100, 50, 1920, 1080, 1080, 1920), { x: 56, y: 89 })
    assert.deepEqual(reframeTransform(10, 20, 0, 0, 5, 5), { x: 10, y: 20 })
  })

  it('computes preview scale factors', () => {
    assert.equal(previewScale(960, 1920), 0.5)
    assert.equal(previewScale(1920, 1920), 1)
    assert.equal(previewScale(0, 1920), 1)
    assert.equal(previewScale(960, 0), 1)
  })
})

describe('safe areas (C13)', () => {
  it('centers action safe 0.9 and title safe 0.8 on any canvas', () => {
    for (const canvas of [{ width: 1920, height: 1080 }, { width: 1080, height: 1920 }, { width: 1000, height: 1000 }]) {
      const { actionSafe, titleSafe } = safeAreaRects(canvas)
      assert.deepEqual(actionSafe, { x: 0.05, y: 0.05, w: 0.9, h: 0.9 })
      assert.deepEqual(titleSafe, { x: 0.1, y: 0.1, w: 0.8, h: 0.8 })
    }
  })

  it('yields zero rects for invalid canvases', () => {
    for (const canvas of [null, undefined, {}, { width: 0, height: 1080 }, { width: 1920, height: NaN }]) {
      assert.deepEqual(safeAreaRects(canvas), {
        actionSafe: { x: 0, y: 0, w: 0, h: 0 },
        titleSafe: { x: 0, y: 0, w: 0, h: 0 }
      })
    }
  })

  it('ships unique ratio presets with real numbers', () => {
    const ids = SAFE_AREA_PRESETS.map(preset => preset.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const preset of SAFE_AREA_PRESETS) {
      assert.ok(preset.label.length > 0)
      assert.ok(Number.isFinite(preset.ratio) && preset.ratio > 0)
    }
    assert.ok(ids.includes('16-9') && ids.includes('9-16') && ids.includes('1-1'))
  })

  it('clamps crop rect inside [0, 1] bounds with min size', () => {
    // Normal input
    const clamped = clampCropRect({ x: 0.1, y: 0.2, w: 0.5, h: 0.6 })
    assert.deepEqual(clamped, { x: 0.1, y: 0.2, w: 0.5, h: 0.6 })

    // Out of bounds input
    const clampedOob = clampCropRect({ x: 0.8, y: 0.7, w: 0.5, h: 0.5 })
    assert.equal(clampedOob.w, 0.5)
    assert.equal(clampedOob.h, 0.5)
    assert.equal(clampedOob.x, 0.5) // 1 - 0.5
    assert.equal(clampedOob.y, 0.5) // 1 - 0.5

    // Degenerate / zero input
    const clampedZero = clampCropRect({ x: -1, y: -1, w: 0.001, h: 0.001 }, 0.05)
    assert.equal(clampedZero.x, 0)
    assert.equal(clampedZero.y, 0)
    assert.equal(clampedZero.w, 0.05)
    assert.equal(clampedZero.h, 0.05)

    // Null/undefined fallback
    assert.deepEqual(clampCropRect(null), { x: 0, y: 0, w: 1, h: 1 })
  })

  it('applies crop aspect ratios centered within source', () => {
    // 16:9 source (1920x1080), applying 1:1 ratio
    // Target normalized ratio = 1 / (16/9) = 9/16 = 0.5625
    const initial = { x: 0, y: 0, w: 1, h: 1 }
    const square = applyCropRatio(initial, 1, 1920, 1080)
    assert.equal(square.h, 1)
    assert.equal(square.w, 0.5625)
    assert.equal(square.x, 0.2188) // (1 - 0.5625) / 2
    assert.equal(square.y, 0)

    // Free / null ratio returns clamped rect unchanged
    assert.deepEqual(applyCropRatio(initial, null), initial)
  })
})
