// Slice G1 — a derived artifact gets its own key axis, not a borrowed one.
//
// The byte cache keys a file by the revision fingerprint of the media it came from
// (`cacheKeyForPath`, and `isByteCacheKey` proves the shape). That is right for the
// second copy of the media and wrong for an artifact computed from it: a waveform
// changes when the algorithm changes, not when the file does, and two artifacts of
// one revision have to coexist. So a derived key carries the parent fingerprint,
// the kind and the version — `a1b2c3d4-wave-v1` — and the cache can answer the two
// questions it actually needs: is this row's source still in the library, and is
// this row the version we read.
//
// The hazard this file also pins: `frames.mjs:165` asks `isByteCacheKey(fingerprint)`
// before it will name a frame. Widening that predicate would let a waveform key be
// treated as a media revision, so `isByteCacheKey` keeps meaning "a source
// fingerprint" and the union used by the storage layer is a separate, named answer.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  byteCacheFingerprint,
  derivedByteCacheKey,
  isByteCacheKey,
  isDerivedByteCacheKey,
  isStoredByteCacheKey,
  parseDerivedByteCacheKey,
  planByteCacheEviction
} from '../src/byteCache.mjs'

const FP = 'a1b2c3d4'

describe('derivedByteCacheKey', () => {
  it('names an artifact by its source, its kind and its version', () => {
    assert.equal(derivedByteCacheKey(FP, 'wave', 1), 'a1b2c3d4-wave-v1')
    assert.equal(derivedByteCacheKey(FP, 'thumb', 3), 'a1b2c3d4-thumb-v3')
  })

  it('refuses a source that is not a revision fingerprint', () => {
    // A derived row inherits its safety from the fingerprint it was cut from: an
    // uppercase or truncated digest would name a file no asset can point back to.
    for (const bad of ['A1B2C3D4', 'deadbee', 'deadbeef0', '', '../evil', null, undefined, 42]) {
      assert.equal(derivedByteCacheKey(bad, 'wave', 1), null, `${String(bad)} is not a fingerprint`)
    }
    assert.equal(derivedByteCacheKey(FP, 'wave', 1), 'a1b2c3d4-wave-v1', 'the legal one still is')
  })

  it('refuses a kind that could not be a name segment', () => {
    for (const bad of ['Wave', 'wave_two', '12wave', '', 'a'.repeat(17), 'wave/v1', 'wave/../x', 'wave-x', 'wave v']) {
      assert.equal(derivedByteCacheKey(FP, bad, 1), null, `${bad} is not a kind`)
    }
    assert.equal(derivedByteCacheKey(FP, 'wave2', 1), 'a1b2c3d4-wave2-v1', 'digits inside are fine')
  })

  it('refuses a version that is not a counting number', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Infinity, 'v1', '1', undefined, null]) {
      assert.equal(derivedByteCacheKey(FP, 'wave', bad), null, `${String(bad)} is not a version`)
    }
    assert.equal(derivedByteCacheKey(FP, 'wave', 10), 'a1b2c3d4-wave-v10')
  })
})

describe('parseDerivedByteCacheKey / isDerivedByteCacheKey', () => {
  it('reads the parts back out', () => {
    assert.deepEqual(parseDerivedByteCacheKey('a1b2c3d4-wave-v1'), { fingerprint: FP, kind: 'wave', version: 1 })
    assert.deepEqual(parseDerivedByteCacheKey('a1b2c3d4-filmstrip-v12'), { fingerprint: FP, kind: 'filmstrip', version: 12 })
  })

  it('is not a source key, and that is the point', () => {
    const key = derivedByteCacheKey(FP, 'wave', 1)
    assert.equal(isByteCacheKey(key), false, 'a waveform is not a media revision')
    assert.equal(isDerivedByteCacheKey(key), true)
    assert.equal(parseDerivedByteCacheKey(FP), null, 'a bare fingerprint names no artifact')
  })

  it('rejects the shapes that only look like a derived key', () => {
    for (const bad of [
      'a1b2c3d4-wave', 'a1b2c3d4-wave-v0', 'a1b2c3d4-wave-v01', 'a1b2c3d4-WAVE-v1', 'a1b2c3d4--wave-v1',
      'a1b2c3d4-wave-vx', 'A1B2C3D4-wave-v1', 'a1b2c3d4-wave-v1-v2', 'a1b2c3d4wavev1', '', null, undefined, 7,
      '../a1b2-wave-v1'
    ]) {
      assert.equal(isDerivedByteCacheKey(bad), false, `${String(bad)} is not a derived key`)
      assert.equal(parseDerivedByteCacheKey(bad), null)
    }
  })
})

describe('isStoredByteCacheKey / byteCacheFingerprint', () => {
  it('accepts exactly the two shapes the store may name', () => {
    assert.equal(isStoredByteCacheKey(FP), true, 'the media itself')
    assert.equal(isStoredByteCacheKey('a1b2c3d4-wave-v1'), true, 'an artifact of it')
    for (const bad of ['a1b2c3d4-wave-v0', 'a1b2c3d4-WAVE-v1', 'deadbee', '../deadbe', '', 'a1b2c3d4-']) {
      assert.equal(isStoredByteCacheKey(bad), false, `${bad} names no file`)
    }
  })

  it('answers the source fingerprint for both, and nothing for junk', () => {
    assert.equal(byteCacheFingerprint(FP), FP, 'a source row is its own source')
    assert.equal(byteCacheFingerprint('a1b2c3d4-wave-v1'), FP)
    assert.equal(byteCacheFingerprint('a1b2c3d4-wave-v2'), FP)
    assert.equal(byteCacheFingerprint('a1b2c3d4-WAVE-v1'), null)
    assert.equal(byteCacheFingerprint('not-a-key'), null)
    assert.equal(byteCacheFingerprint(null), null)
    assert.equal(isByteCacheKey(byteCacheFingerprint('a1b2c3d4-wave-v1')), true,
      'what it returns is always a legal source key')
  })
})

describe('planByteCacheEviction with derived rows', () => {
  it('keeps an artifact whose source is still in the library', () => {
    const entries = [
      { key: FP, bytes: 10, accessedAt: 1 },
      { key: `${FP}-wave-v1`, bytes: 4, accessedAt: 2 }
    ]
    const plan = planByteCacheEviction(entries, 100, [FP])
    assert.deepEqual(plan.drop, [])
    assert.equal(plan.keptBytes, 14)
    assert.deepEqual(plan.invalid, [])
  })

  it('drops an artifact whose source has left the library, even though it is not itself a live key', () => {
    // The relink case: the asset was deleted or re-imported, so the library names a
    // different fingerprint. Nothing else ever cleans the waveform it left behind.
    const plan = planByteCacheEviction(
      [{ key: 'ffffffff-wave-v1', bytes: 4, accessedAt: 1 }],
      100,
      [FP]
    )
    assert.deepEqual(plan.drop, ['ffffffff-wave-v1'])
    assert.deepEqual(plan.keep, [])
    assert.deepEqual(plan.invalid, [], 'it is a legal key with a dead source, not noise')
  })

  it('honours a live key that names the artifact itself', () => {
    const plan = planByteCacheEviction(
      [{ key: `${FP}-wave-v1`, bytes: 4, accessedAt: 1 }],
      100,
      [`${FP}-wave-v1`]
    )
    assert.deepEqual(plan.drop, [])
  })

  it('does not let one artifact keep another artifact of a dead source alive', () => {
    const plan = planByteCacheEviction([
      { key: 'ffffffff-wave-v1', bytes: 4, accessedAt: 1 },
      { key: `${FP}-wave-v1`, bytes: 4, accessedAt: 1 }
    ], 100, [FP])
    assert.deepEqual(plan.drop, ['ffffffff-wave-v1'])
    assert.deepEqual(plan.keep, [{ key: `${FP}-wave-v1`, bytes: 4, accessedAt: 1 }])
  })

  it('still reports a key that names nothing as invalid, derived shapes included', () => {
    const plan = planByteCacheEviction([
      { key: 'a1b2c3-wave-v1', bytes: 4, accessedAt: 1 },
      { key: 'a1b2c3d4-WAVE-v1', bytes: 4, accessedAt: 2 },
      { key: FP, bytes: 4, accessedAt: 3 }
    ], 100, [FP])
    assert.deepEqual(plan.invalid, ['a1b2c3-wave-v1', 'a1b2c3d4-WAVE-v1'])
    assert.deepEqual(plan.drop, ['a1b2c3-wave-v1', 'a1b2c3d4-WAVE-v1'])
    assert.deepEqual(plan.keep, [{ key: FP, bytes: 4, accessedAt: 3 }])
  })

  it('evicts the least recently used across both kinds, source and artifact alike', () => {
    const entries = [
      { key: FP, bytes: 30, accessedAt: 3 },
      { key: `${FP}-wave-v1`, bytes: 20, accessedAt: 1 },
      { key: 'deadbeef', bytes: 20, accessedAt: 2 }
    ]
    const plan = planByteCacheEviction(entries, 50, [FP, 'deadbeef'])
    assert.deepEqual(plan.drop, [`${FP}-wave-v1`], 'the oldest row goes first whatever it holds')
    assert.equal(plan.keptBytes, 50)
  })

  it('drops an artifact that cannot fit the budget on its own', () => {
    const plan = planByteCacheEviction([
      { key: `${FP}-wave-v1`, bytes: 500, accessedAt: 1 },
      { key: FP, bytes: 10, accessedAt: 2 }
    ], 100, [FP])
    assert.deepEqual(plan.drop, [`${FP}-wave-v1`])
    assert.deepEqual(plan.keep, [{ key: FP, bytes: 10, accessedAt: 2 }])
  })

  it('is order-independent, as it already was for source rows', () => {
    const entries = [
      { key: FP, bytes: 30, accessedAt: 3 },
      { key: `${FP}-wave-v1`, bytes: 20, accessedAt: 1 },
      { key: 'deadbeef-film-v2', bytes: 20, accessedAt: 2 }
    ]
    const live = [FP, 'deadbeef']
    const a = planByteCacheEviction(entries, 100, live)
    const b = planByteCacheEviction([...entries].reverse(), 100, live)
    assert.deepEqual(a.drop, b.drop)
    assert.deepEqual(a.keep, b.keep)
  })

  it('keeps the source-only behaviour it shipped with', () => {
    // tmcut_byte_cache.spec.ts pins these; the union must not have moved them.
    const plan = planByteCacheEviction([{ key: 'not-a-key', bytes: 1, accessedAt: 1 }], 100, [])
    assert.deepEqual(plan.invalid, ['not-a-key'])
    const noBudget = planByteCacheEviction([{ key: FP, bytes: 5, accessedAt: 1 }], 0, [FP])
    assert.deepEqual(noBudget.drop, [FP])
  })
})
