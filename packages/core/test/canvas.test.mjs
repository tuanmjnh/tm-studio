// @tmcut/core — canvas tests. Run: node --test "test/*.test.mjs"
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
  buildFfmpegFitFilters,
  buildFfmpegTransform,
  reframeTransform,
  previewScale,
  safeAreaRects,
  SAFE_AREA_PRESETS,
  clampCropRect,
  applyCropRatio,
  buildBackgroundSource
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

  it('builds ffmpeg fit filters', () => {
    const fit = buildFfmpegFitFilters('fit', 1920, 1080)
    assert.equal(fit.length, 1)
    assert.ok(fit[0].includes('pad=1920:1080'))
    assert.ok(buildFfmpegFitFilters('fill', 1920, 1080)[0].includes('crop=1920:1080'))
    assert.ok(buildFfmpegFitFilters('stretch', 1920, 1080)[0] === 'scale=1920:1080')
    assert.ok(buildFfmpegFitFilters('smart', 1920, 1080, { focusX: 0.2 })[0].includes('0.2000'))
    const cropped = buildFfmpegFitFilters('crop', 1920, 1080, { cropRect: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } })
    assert.equal(cropped.length, 2)
  })

  it('appends rotation after the fit filters (roadmap C7)', () => {
    const rot = buildFfmpegFitFilters('fit', 1920, 1080, { rotation: 90, padColor: '#101010' })
    assert.equal(rot.length, 2)
    assert.equal(rot[1], 'rotate=90*PI/180:ow=iw:oh=ih:fillcolor=#101010')
    // Order: rotate comes AFTER every fit filter (fill = single chain string).
    const fillRot = buildFfmpegFitFilters('fill', 1920, 1080, { rotation: -45 })
    assert.equal(fillRot.length, 2)
    assert.ok(fillRot[1].startsWith('rotate=-45*PI/180'))
    // Identity rotations append nothing (byte-identical legacy output).
    assert.equal(buildFfmpegFitFilters('fit', 1920, 1080, { rotation: 0 }).length, 1)
    assert.equal(buildFfmpegFitFilters('fit', 1920, 1080, { rotation: 360 }).length, 1)
    assert.equal(buildFfmpegFitFilters('fit', 1920, 1080, {}).length, 1)
    // Default fill color for the uncovered corners.
    assert.ok(buildFfmpegFitFilters('stretch', 640, 360, { rotation: 30 })[1].endsWith('fillcolor=black'))
  })

  it('returns null for the identity transform', () => {
    assert.equal(buildFfmpegTransform({ canvasW: 1920, canvasH: 1080 }), null)
    assert.equal(buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: 100, x: 0, y: 0 }), null)
    assert.equal(buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: undefined, x: undefined, y: undefined }), null)
  })

  it('builds a centered scale transform with background overlay', () => {
    const t = buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: 50, fps: 30, duration: 4, bgColor: '#000000' })
    assert.equal(t.tail, 'scale=960:540')
    assert.equal(t.overlay, 'overlay=x=480:y=270:shortest=1')
    assert.ok(t.bg.startsWith('color=c=#000000:s=1920x1080:r=30:d=6.000')) // duration + 2s headroom
  })

  it('applies offsets and rounds to whole pixels', () => {
    const t = buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: 100, x: -100.4, y: 50.6 })
    assert.equal(t.overlay, 'overlay=x=-100:y=51:shortest=1')
    assert.equal(t.tail, 'scale=1920:1080')
    const up = buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: 150, x: 20, y: -30 })
    assert.equal(up.tail, 'scale=2880:1620')
    assert.equal(up.overlay, 'overlay=x=-460:y=-300:shortest=1') // (1920-2880)/2+20, (1080-1620)/2-30
  })

  it('evenizes odd canvases and clamps degenerate scales', () => {
    const t = buildFfmpegTransform({ canvasW: 1919, canvasH: 1079, scale: 100.0001, x: 1 })
    assert.ok(t.bg.includes('s=1918x1078'))
    const tiny = buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: 0 })
    assert.equal(tiny.tail, 'scale=20:10') // clamped to 1% of the evenized canvas
    const neg = buildFfmpegTransform({ canvasW: 1920, canvasH: 1080, scale: -50, x: 1 })
    assert.equal(neg.tail, 'scale=20:10')
  })

  it('applies default fps and duration when omitted', () => {
    const t = buildFfmpegTransform({ canvasW: 1000, canvasH: 500, scale: 200 })
    assert.ok(t.bg.includes(':r=30:d=3.000')) // default duration 1 + 2s headroom
    assert.equal(t.overlay, 'overlay=x=-500:y=-250:shortest=1')
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

describe('buildBackgroundSource (Phase 4)', () => {
  const baseOpts = { canvasW: 1920, canvasH: 1080, fps: 30, duration: 10 }

  it('returns color source descriptor with 0x hex for color background', () => {
    const desc = buildBackgroundSource({
      ...baseOpts,
      background: { type: 'color', value: '#ff0000' }
    })
    assert.equal(desc.type, 'color')
    assert.equal(desc.kind, 'source')
    assert.ok(typeof desc.chain === 'string')
    assert.ok(desc.chain.includes('color=c=0xff0000'))
    assert.ok(desc.chain.includes('s=1920x1080'))
    assert.ok(desc.chain.includes('r=30'))
    assert.ok(desc.chain.includes('d=10.000'))
  })

  it('defaults to black (0x000000) when color value missing', () => {
    const desc = buildBackgroundSource({
      ...baseOpts,
      background: { type: 'color' }
    })
    assert.ok(desc.chain.includes('color=c=0x000000'))
  })

  it('returns transparent source descriptor (0x00000000) for transparent background', () => {
    const desc = buildBackgroundSource({
      ...baseOpts,
      background: { type: 'transparent' }
    })
    assert.equal(desc.type, 'transparent')
    assert.equal(desc.kind, 'source')
    assert.ok(desc.chain.includes('color=c=0x00000000'))
  })

  it('returns image input descriptor for image background', () => {
    const desc = buildBackgroundSource({
      ...baseOpts,
      background: { type: 'image', value: '/path/to/bg.png' }
    })
    assert.equal(desc.type, 'image')
    assert.equal(desc.kind, 'input')
    assert.equal(desc.file, '/path/to/bg.png')
    // No -t here: each consumer trims its own window, so the input is a
    // single looping still for the whole timeline.
    assert.deepEqual(desc.inputFlags, ['-framerate', '30', '-loop', '1'])
    assert.ok(desc.tail.includes('scale=1920:1080'))
    assert.ok(desc.tail.includes('crop=1920:1080'))
    assert.ok(desc.tail.includes('setsar=1'))
  })

  it('falls back to black color source when image path is empty', () => {
    const desc = buildBackgroundSource({
      ...baseOpts,
      background: { type: 'image', value: '' }
    })
    assert.equal(desc.type, 'color')
    assert.ok(desc.chain.includes('color=c=0x000000'))
  })

  it('evenizes canvas dimensions and clamps minimum 2px', () => {
    const desc = buildBackgroundSource({
      canvasW: 1921,
      canvasH: 1081,
      fps: 30,
      duration: 5,
      background: { type: 'color', value: '#00ff00' }
    })
    assert.ok(desc.chain.includes('s=1920x1080'))
  })

  it('handles fractional fps and duration', () => {
    const desc = buildBackgroundSource({
      canvasW: 1280,
      canvasH: 720,
      fps: 29.97,
      duration: 7.5,
      background: { type: 'color', value: '#ffffff' }
    })
    assert.ok(desc.chain.includes('r=29.97'))
    assert.ok(desc.chain.includes('d=7.500'))
  })
})
