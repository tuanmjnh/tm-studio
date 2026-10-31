// @tmcut/core — mask tests (R124 A3). Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMask, maskAlphaExpr, maskCssMaskImage, TMUTCUT_MASK_SHAPES } from '../src/mask.mjs'

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

describe('mask FFmpeg alpha expr (R124 A3)', () => {
  it('is empty without a mask', () => {
    assert.equal(maskAlphaExpr(null), '')
    assert.equal(maskAlphaExpr({ shape: 'blob' }), '')
  })

  it('produces a 0..255 alpha expression for each shape', () => {
    for (const shape of TMUTCUT_MASK_SHAPES) {
      const expr = maskAlphaExpr(rect({ shape }))
      assert.ok(expr.startsWith('255*'), `${shape}: ${expr}`)
      // Commas must exist escaped-free inside the (caller-quoted) expr ONLY
      // as function separators of min/max/hypot — never a bare separator at
      // the top level (quoting is the caller's job, same as keyframeExpr).
      assert.ok(!/,$/.test(expr))
    }
  })

  it('rectangle uses max/abs distance, circle uses hypot', () => {
    assert.match(maskAlphaExpr(rect({ shape: 'rectangle' })), /max\(abs\(/)
    assert.match(maskAlphaExpr(rect({ shape: 'circle' })), /hypot\(abs\(/)
  })

  it('invert mirrors the coverage term', () => {
    const plain = maskAlphaExpr(rect())
    const inv = maskAlphaExpr(rect({ invert: true }))
    assert.ok(plain.startsWith('255*(1-('))
    assert.ok(inv.startsWith('255*(min(') || inv.startsWith('255*('))
    assert.notEqual(plain, inv)
  })

  it('rotation embeds cos/sin coefficients', () => {
    const expr = maskAlphaExpr(rect({ rotation: 90 }))
    // cos(90°) ≈ 0, sin ≈ 1 — the coefficients must be inlined numbers.
    assert.match(expr, /0\*\(\(X\/W\)-0\.5\)-1\*\(\(Y\/H\)-0\.5\)/)
  })

  it('evaluates to plausible alpha when sampled numerically', () => {
    // Port the expression to JS: X/W -> u, Y/H -> v (center sample u=v=0.5
    // must sit deep INSIDE a centered 0.5-box => alpha 255 for plain,
    // 0 for invert; a far corner must flip). FFmpeg geq math functions get
    // their Math. prefix — plain JS has no bare hypot/min/max/abs globals.
    const build = m => maskAlphaExpr(m)
      .replace(/X\/W/g, 'u')
      .replace(/Y\/H/g, 'v')
      .replace(/\b(hypot|min|max|abs)\(/g, 'Math.$1(')
    for (const shape of ['rectangle', 'circle']) {
      const fn = new Function('u', 'v', `return (${build(rect({ shape, feather: 20 }))})`)
      const center = fn(0.5, 0.5)
      const outside = fn(0.02, 0.5)
      assert.ok(center > 250, `${shape} center=${center}`)
      assert.ok(outside < 5, `${shape} outside=${outside}`)
      const fnInv = new Function('u', 'v', `return (${build(rect({ shape, feather: 20, invert: true }))})`)
      assert.ok(fnInv(0.5, 0.5) < 5, `${shape} inverted center`)
      assert.ok(fnInv(0.02, 0.5) > 250, `${shape} inverted outside`)
    }
    // Linear-x: opaque left of the box, clear right of it.
    const lin = new Function('u', 'v', `return (${build(rect({ shape: 'linear', feather: 60 }))})`)
    assert.ok(lin(0.05, 0.5) > 250, `linear left=${lin(0.05, 0.5)}`)
    assert.ok(lin(0.95, 0.5) < 5, `linear right=${lin(0.95, 0.5)}`)
  })

  it('feather=0 stays a hard edge (band collapses to 2% minimum)', () => {
    const expr = maskAlphaExpr(rect({ feather: 0 }))
      .replace(/X\/W/g, 'u').replace(/Y\/H/g, 'v')
      .replace(/\b(hypot|min|max|abs)\(/g, 'Math.$1(')
    const fn = new Function('u', 'v', `return (${expr})`)
    // Just inside the rect edge (x=0.25..0.75 box): 0.27 is inside.
    assert.ok(fn(0.27, 0.5) > 250)
    // Just outside: 0.23 is outside and should be cleared.
    assert.ok(fn(0.23, 0.5) < 5)
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
