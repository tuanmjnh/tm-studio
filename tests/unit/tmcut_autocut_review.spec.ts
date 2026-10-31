/**
 * R138 specs — AutoCut step-3 keyboard review (docs §202).
 * The pure next-index decision (app/utils/tmcut/autocutReview.ts);
 * the page wiring is covered live by tmcut_r136_ui.mts.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { nextActiveIndex } from '../../app/utils/tmcut/autocutReview'

describe('TMCut AutoCut review — nextActiveIndex (R138)', () => {
  it('steps through the middle and clamps HARD at both ends (no wrap)', () => {
    assert.equal(nextActiveIndex(0, 5, 1), 1)
    assert.equal(nextActiveIndex(3, 5, -1), 2)
    assert.equal(nextActiveIndex(4, 5, 1), 4, 'last row must NOT wrap to 0')
    assert.equal(nextActiveIndex(0, 5, -1), 0, 'first row must NOT wrap to last')
  })

  it('from nothing selected: down picks the FIRST, up picks the LAST', () => {
    assert.equal(nextActiveIndex(null, 5, 1), 0)
    assert.equal(nextActiveIndex(null, 5, -1), 4)
  })

  it('a stale selection (re-score shrank the list) clamps from the travel direction', () => {
    assert.equal(nextActiveIndex(9, 3, 1), 0)
    assert.equal(nextActiveIndex(9, 3, -1), 2)
  })

  it('degrades honestly: empty/invalid count or zero delta returns current unchanged', () => {
    assert.equal(nextActiveIndex(null, 0, 1), null)
    assert.equal(nextActiveIndex(2, 0, -1), 2, 'no segments: selection untouched')
    assert.equal(nextActiveIndex(1, Number.NaN, 1), 1)
    assert.equal(nextActiveIndex(1, 2.5, 1), 1)
    assert.equal(nextActiveIndex(1, 5, 0), 1)
  })

  it('one-row list: every direction stays on row 0', () => {
    assert.equal(nextActiveIndex(0, 1, 1), 0)
    assert.equal(nextActiveIndex(0, 1, -1), 0)
    assert.equal(nextActiveIndex(null, 1, -1), 0)
  })
})
