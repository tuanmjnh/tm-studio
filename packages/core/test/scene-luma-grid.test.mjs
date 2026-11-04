// Slice E2 — the grid a shot score is computed on.
//
// `sceneScore` (E1) compares two luma grids, but nobody had said what a grid IS.
// Two hosts that answer that question differently get two different cut lists
// from identical pixels, and no screen shows the difference. So the weights, the
// cell count and the block-average are written down here, once.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TMCUT_SCENE_GRID_CELLS,
  TMCUT_SCENE_THRESHOLD,
  lumaCells,
  lumaOf,
  sceneScore
} from '../src/detection.mjs'

/** RGBA bytes for one pixel. */
const px = (r, g, b) => [r, g, b, 255]

function grid(width, height, pixelAt) {
  const out = []
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out.push(...pixelAt(x, y))
  }
  return out
}

describe('lumaOf: one pixel to one number, on the weights a shot detector uses', () => {
  it('lands on the BT.601 values for the primaries and greys', () => {
    assert.equal(lumaOf(0, 0, 0), 0)
    assert.equal(lumaOf(255, 255, 255), 255)
    assert.equal(lumaOf(255, 0, 0), 76)
    assert.equal(lumaOf(0, 255, 0), 150)
    assert.equal(lumaOf(0, 0, 255), 29)
    assert.equal(lumaOf(128, 128, 128), 128)
  })

  it('clamps a channel the byte range cannot hold, and propagates a hole', () => {
    assert.equal(lumaOf(255, 0, 0), 76)
    assert.equal(lumaOf(-40, -40, -40), 0)
    // Out-of-range channels are clamped before the weights, never scaled by them.
    assert.equal(lumaOf(-40, 900, 300), lumaOf(0, 255, 255))
    assert.ok(Number.isNaN(lumaOf(Number.NaN, 10, 10)), 'a hole must stay a hole, not become a dark pixel')
  })
})

describe('lumaCells: pixels to the grid sceneScore compares', () => {
  it('is one row of cells, cells*cells long, in reading order', () => {
    const cells = lumaCells(grid(2, 2, (x, y) => px(x ? 255 : 0, y ? 255 : 0, 0)), 2, 2, 2)
    assert.equal(cells.length, 4)
    assert.deepEqual(cells, [lumaOf(0, 0, 0), lumaOf(255, 0, 0), lumaOf(0, 255, 0), lumaOf(255, 255, 0)])
  })

  it('averages a block, so a grid is coarser than the frame and not another picture of it', () => {
    const bright = lumaOf(200, 200, 200)
    const dark = lumaOf(20, 20, 20)
    const cells = lumaCells(grid(8, 8, x => (x < 4 ? px(dark, dark, dark) : px(bright, bright, bright))), 8, 8, 4)
    assert.equal(cells.length, 16)
    for (let index = 0; index < 16; index++) {
      const expected = (index % 4) < 2 ? dark : bright
      assert.equal(cells[index], expected, `cell ${index} is not the block it covers`)
    }
  })

  it('does not need a square frame or a square image', () => {
    const cells = lumaCells(grid(4, 2, () => px(64, 64, 64)), 4, 2, 2)
    assert.equal(cells.length, 4)
    assert.deepEqual(cells, Array(4).fill(lumaOf(64, 64, 64)))
  })

  it('answers nothing for pixels that are not there', () => {
    const short = grid(4, 4, () => px(10, 10, 10)).slice(0, 30)
    assert.deepEqual(lumaCells(short, 4, 4, 2), [], 'a truncated buffer is a grid')
    assert.deepEqual(lumaCells([], 0, 0, 2), [])
    assert.deepEqual(lumaCells(grid(4, 4, () => px(10, 10, 10)), 4, 4, 0), [])
    assert.deepEqual(lumaCells(grid(4, 4, () => px(10, 10, 10)), 4, 4, -3), [])
    assert.deepEqual(lumaCells(grid(4, 4, () => px(10, 10, 10)), 0, 4, 2), [])
  })

  it('drops the whole grid when a pixel is not a number', () => {
    const broken = grid(2, 2, () => px(10, 10, 10))
    broken[5] = Number.NaN
    assert.deepEqual(lumaCells(broken, 2, 2, 2), [], 'a hole must not become a dark cell')
  })
})

describe('the grid and the score are one chain', () => {
  it('is 8 cells wide, which is what both hosts must sample down to', () => {
    assert.equal(TMCUT_SCENE_GRID_CELLS, 8)
  })

  it('reads a hard cut as a cut and a brightness lift as not', () => {
    const black = lumaCells(grid(8, 8, () => px(0, 0, 0)), 8, 8, TMCUT_SCENE_GRID_CELLS)
    const white = lumaCells(grid(8, 8, () => px(255, 255, 255)), 8, 8, TMCUT_SCENE_GRID_CELLS)
    const lifted = lumaCells(grid(8, 8, () => px(12, 12, 12)), 8, 8, TMCUT_SCENE_GRID_CELLS)

    assert.equal(sceneScore(black, black), 0)
    assert.equal(sceneScore(black, white), 1)
    assert.ok(sceneScore(black, white) > TMCUT_SCENE_THRESHOLD)
    const mild = sceneScore(black, lifted)
    assert.ok(mild !== null && mild < TMCUT_SCENE_THRESHOLD, `a 12/255 lift scored ${mild}`)
  })
})
