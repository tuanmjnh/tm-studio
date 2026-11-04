// Slice E2 — which pair of grids is a cut, and where the cut lands.
//
// The scan walks a clip with a decoder that can fail on individual instants.
// "Skip the hole", "attribute the change to the later sample" and "strictly
// greater than the threshold" are decisions, and two hosts that decide them
// differently ship two different EDLs from one file. So they live in core.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TMCUT_SCENE_THRESHOLD, lumaCells, sceneCuts } from '../src/detection.mjs'

/** One uniform grid, `cells` wide. */
function solid(level, cells = 8) {
  const rgba = new Array(cells * cells * 4)
  for (let index = 0; index < rgba.length; index++) rgba[index] = index % 4 === 3 ? 255 : level
  return lumaCells(rgba, cells, cells, cells)
}

/** A grid written directly, so a score can be aimed at an exact number. */
const flat = value => Array.from({ length: 64 }, () => value)

describe('sceneCuts', () => {
  it('names the later sample of the pair that changed', () => {
    const times = [0, 1, 2, 3]
    const grids = [solid(10), solid(10), solid(240), solid(240)]
    assert.deepEqual(sceneCuts(times, grids), [2])
  })

  it('needs two usable grids: a hole is skipped, not scored as no change', () => {
    const times = [0, 1, 2, 3]
    const grids = [solid(10), null, solid(240), solid(240)]
    // 0->1 unusable, 1->2 unusable, 2->3 identical: nothing is known, nothing is claimed.
    assert.deepEqual(sceneCuts(times, grids), [])
  })

  it('breaks the chain at a hole instead of bridging it', () => {
    const times = [0, 1, 2]
    const grids = [solid(0), null, solid(255)]
    // Bridging would claim the cut happened at t=2 when it happened somewhere in
    // between: a sample that failed is missing information, not a wide transition.
    assert.deepEqual(sceneCuts(times, grids), [])
    assert.deepEqual(sceneCuts(times, [solid(0), solid(0), solid(255)]), [2])
  })

  it('is strictly greater than the threshold, like the filter it replaces', () => {
    const times = [0, 1]
    // 51/255 scores exactly 0.2, so a caller aimed at 0.2 sees the same tie the
    // old 0.4 default used to: `select='gt(scene,X)'` calls an equal score "not a cut".
    assert.equal(sceneScoreOf(flat(0), flat(51)), 0.2)
    assert.deepEqual(sceneCuts(times, [flat(0), flat(51)], { threshold: 0.2 }), [])
    assert.deepEqual(sceneCuts(times, [flat(0), flat(51)], { threshold: 0.19 }), [1])
    // The calibrated default falls between two reachable scores: 64 cells of 45
    // are 0.1765 (quiet) and of 46 are 0.1804 (a cut). Straddling it proves the
    // default is wired in, not just a number in a comment.
    assert.ok(sceneScoreOf(flat(0), flat(45)) < TMCUT_SCENE_THRESHOLD,
      '45 must sit below the default the scan actually uses')
    assert.ok(TMCUT_SCENE_THRESHOLD < sceneScoreOf(flat(0), flat(46)),
      '46 must sit above it')
    assert.equal(sceneScoreOf(flat(0), flat(45)), 0.1765)
    assert.deepEqual(sceneCuts(times, [flat(0), flat(45)]), [])
    assert.equal(sceneScoreOf(flat(0), flat(46)), 0.1804)
    assert.deepEqual(sceneCuts(times, [flat(0), flat(46)]), [1])
    assert.deepEqual(sceneCuts(times, [flat(0), flat(255)]), [1])
    assert.deepEqual(sceneCuts(times, [flat(120), flat(120)]), [])
  })

  it('takes its own threshold when the caller is tuning a clip', () => {
    const times = [0, 1]
    const grids = [flat(0), flat(40)]
    assert.deepEqual(sceneCuts(times, grids, { threshold: 0.05 }), [1])
    assert.deepEqual(sceneCuts(times, grids, { threshold: 0.9 }), [])
    assert.deepEqual(sceneCuts(times, grids), [])
  })

  it('answers nothing when there is no pair to compare', () => {
    assert.deepEqual(sceneCuts([], []), [])
    assert.deepEqual(sceneCuts([0], [solid(10)]), [])
    assert.deepEqual(sceneCuts([0, 1], [solid(10)]), [])
    assert.deepEqual(sceneCuts([0, 1], null), [])
    assert.deepEqual(sceneCuts(null, [solid(10)]), [])
  })

  it('walks a whole clip: many cuts, in sample order', () => {
    const times = [0, 0.5, 1, 1.5, 2, 2.5]
    const grids = [solid(0), solid(0), solid(255), solid(255), solid(0), solid(0)]
    assert.deepEqual(sceneCuts(times, grids), [1, 2])
  })

  it('rounds the instant it reports, so two hosts agree on the same cut', () => {
    const times = [0.2, 0.6000000000000001, 1.0000000000000002]
    const grids = [solid(0), solid(200), solid(200)]
    assert.deepEqual(sceneCuts(times, grids), [0.6])
  })
})

function sceneScoreOf(previous, next) {
  let total = 0
  for (let index = 0; index < previous.length; index++) total += Math.abs(previous[index] - next[index])
  return Math.round((total / previous.length / 255) * 10000) / 10000
}
