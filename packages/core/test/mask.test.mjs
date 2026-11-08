// tmcut-core — mask tests (R124 A3). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMask, maskCssMaskImage, TMUTCUT_MASK_SHAPES } from '../src/mask.mjs'

function rect(overrides = {}) {
  return { shape: 'rectangle', x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 10, ...overrides }
}

describe('masks normalize (R124 A3)', () => {
  it('accepts the three shapes and fills every field', () => {
    assert.deepEqual(TMUTCUT_MASK_SHAPES, ['rectangle', 'circle', 'linear'])
    const m = normalizeMask(rect())
    assert.equal(m.shape, 'rectangle')
    assert.equal(m.feather, 10)
    assert.equal(m.rotation, 0)
    assert.equal(m.invert, false)
    assert.equal(m.axis, 'x')
  })

  it('returns null for absent or unknown shapes', () => {
    assert.equal(normalizeMask(null), null)
    assert.equal(normalizeMask(undefined), null)
    assert.equal(normalizeMask({ shape: 'hexagon' }), null)
    assert.equal(normalizeMask({}), null)
  })

  it('clamps every field into range', () => {
    const m = normalizeMask(rect({ x: -5, y: 2, w: 9, h: 0, feather: 500, rotation: 999 }))
    assert.equal(m.x, 0)
    assert.equal(m.y, 1)
    assert.equal(m.w, 1)
    assert.equal(m.h, 0.001) // minimum half-safe size
    assert.equal(m.feather, 100)
    assert.equal(m.rotation, 180)
  })
})

describe('mask CSS preview mask (R124 A3)', () => {
  it('returns null without a mask', () => {
    assert.equal(maskCssMaskImage(null), null)
  })

  it('returns an SVG data-URI url() for each shape', () => {
    for (const shape of TMUTCUT_MASK_SHAPES) {
      const css = maskCssMaskImage(rect({ shape }), 1280, 720)
      assert.ok(css.startsWith('url("data:image/svg+xml,'), shape)
      const svg = decodeURIComponent(css.slice('url("data:image/svg+xml,'.length, -2))
      assert.ok(svg.includes('width="1280"'), shape)
      assert.ok(svg.includes('height="720"'), shape)
    }
  })

  it('draws the expected SVG primitive per shape', () => {
    assert.ok(decodeURIComponent(maskCssMaskImage(rect(), 100, 100)).includes('<rect'))
    assert.ok(decodeURIComponent(maskCssMaskImage(rect({ shape: 'circle' }), 100, 100)).includes('<ellipse'))
    assert.ok(decodeURIComponent(maskCssMaskImage(rect({ shape: 'linear' }), 100, 100)).includes('linearGradient'))
  })

  it('feather adds gaussian blur, rotation adds a transform, invert inverts', () => {
    assert.ok(decodeURIComponent(maskCssMaskImage(rect({ feather: 40 }), 100, 100)).includes('feGaussianBlur'))
    assert.ok(!decodeURIComponent(maskCssMaskImage(rect({ feather: 0 }), 100, 100)).includes('feGaussianBlur'))
    assert.ok(decodeURIComponent(maskCssMaskImage(rect({ rotation: 45 }), 100, 100)).includes('rotate(45'))
    const inv = decodeURIComponent(maskCssMaskImage(rect({ shape: 'circle', invert: true }), 100, 100))
    assert.ok(inv.includes('mask="url(#m)"'))
  })
})
