import assert from 'node:assert/strict'
import {
  TMUTCANVAS_PRESETS,
  aspectValue,
  computeFitObjectStyle,
  findCanvasPreset,
  findCanvasPresetByDimensions,
  normalizeCanvas,
  orientationOf,
  ratioIdOf,
  ratioLabel,
  reframeTransform
} from '../../app/utils/tmcut/canvas'

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function main() {
  console.log('=== [TMCut Phase 2 Test Suite] Starting tests ===\n')

  check('canvas presets cover 6 required ratios', () => {
    const ids = TMUTCANVAS_PRESETS.map(p => p.id)
    for (const id of ['16:9', '9:16', '1:1', '4:5', '4:3', '21:9']) {
      assert.ok(ids.includes(id), `preset ${id} missing`)
    }
    assert.equal(TMUTCANVAS_PRESETS.length, 6)
  })

  check('aspectValue reduces ratio with gcd', () => {
    assert.ok(Math.abs(aspectValue(1920, 1080) - 16 / 9) < 1e-9)
    assert.ok(Math.abs(aspectValue(1440, 1080) - 4 / 3) < 1e-9)
    assert.ok(Math.abs(aspectValue(1080, 1350) - 4 / 5) < 1e-9)
    assert.equal(aspectValue(1080, 1080), 1)
    assert.equal(aspectValue(0, 1080), 0)
  })

  check('orientationOf classifies width vs height', () => {
    assert.equal(orientationOf(1920, 1080), 'landscape')
    assert.equal(orientationOf(1080, 1920), 'portrait')
    assert.equal(orientationOf(1080, 1080), 'square')
    assert.equal(orientationOf(0, 0), 'landscape')
  })

  check('ratioIdOf matches preset or falls back to WxH', () => {
    assert.equal(ratioIdOf(1920, 1080), '16:9')
    assert.equal(ratioIdOf(1440, 1080), '4:3')
    assert.equal(ratioIdOf(2560, 1080), '21:9')
    assert.equal(ratioIdOf(999, 777), '999x777')
    assert.equal(ratioLabel(1920, 1080), '16:9')
  })

  check('findCanvasPreset resolves by id and dimensions', () => {
    assert.equal(findCanvasPreset('9:16')?.width, 1080)
    assert.equal(findCanvasPreset('nope'), null)
    assert.equal(findCanvasPresetByDimensions(1080, 1920)?.id, '9:16')
    assert.equal(findCanvasPresetByDimensions(500, 500), null)
  })

  check('normalizeCanvas migrates legacy canvas without aspectRatio/background', () => {
    const canvas = normalizeCanvas({ width: 1080, height: 1920, fps: 30 })
    assert.equal(canvas.width, 1080)
    assert.equal(canvas.height, 1920)
    // C16: fps is always a rational FrameRate after normalization; legacy
    // bare numbers (30) migrate to { numerator: 30, denominator: 1 }.
    assert.deepEqual(canvas.fps, { numerator: 30, denominator: 1 })
    assert.equal(canvas.aspectRatio.id, '9:16')
    assert.equal(canvas.aspectRatio.orientation, 'portrait')
    assert.deepEqual(canvas.background, { type: 'color', value: '#000000' })
  })

  check('normalizeCanvas keeps existing aspectRatio/background and fills defaults', () => {
    const canvas = normalizeCanvas({
      aspectRatio: { id: 'custom-tag', value: 2.35, orientation: 'landscape' },
      background: { type: 'transparent' }
    })
    assert.equal(canvas.aspectRatio.id, 'custom-tag')
    assert.equal(canvas.aspectRatio.value, 2.35)
    assert.deepEqual(canvas.background, { type: 'transparent' })
    assert.equal(canvas.width, 1920)
    assert.deepEqual(canvas.fps, { numerator: 30, denominator: 1 })
  })

  check('computeFitObjectStyle maps modes to CSS objectFit', () => {
    assert.deepEqual(computeFitObjectStyle('fit'), { objectFit: 'contain', objectPosition: '50% 50%' })
    assert.deepEqual(computeFitObjectStyle('fill'), { objectFit: 'cover', objectPosition: '50% 50%' })
    assert.deepEqual(computeFitObjectStyle('stretch'), { objectFit: 'fill', objectPosition: '50% 50%' })
    assert.deepEqual(computeFitObjectStyle('smart', 0, 0), { objectFit: 'cover', objectPosition: '0% 0%' })
    assert.deepEqual(computeFitObjectStyle('smart', 1.4, 0.5), { objectFit: 'cover', objectPosition: '100% 50%' })
    assert.deepEqual(
      computeFitObjectStyle('crop', 0.5, 0.5, { x: 0.1, y: 0.2, w: 0.4, h: 0.4 }),
      { objectFit: 'cover', objectPosition: '30% 40%' }
    )
  })

  check('reframeTransform scales manual offsets proportionally', () => {
    const t = reframeTransform(10, 20, 1920, 1080, 1080, 1920)
    assert.equal(t.x, 6)
    assert.equal(t.y, 36)
    const same = reframeTransform(10, 20, 1920, 1080, 1920, 1080)
    assert.equal(same.x, 10)
    assert.equal(same.y, 20)
    const safe = reframeTransform(5, 5, 0, 0, 1080, 1080)
    assert.deepEqual(safe, { x: 5, y: 5 })
  })

  console.log(`\n=== [TMCut Phase 2 Test Suite] ${passed} checks passed ===`)
}

main()
