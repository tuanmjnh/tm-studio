// Slice G4b — playback reads its bytes from the client cache, and the URLs that
// proves are retired by the same law.
//
// The cache has held a second copy of every imported revision since C2b, and the
// frame service has been reading it since D2 — but playback still asked the server
// for the file, one HTTP range request per seek (ADR-033's open half: the audit
// measured `GET /uploads/… [206]` on every play). The decision "this clip plays
// from bytes we already own, or from the stream" was never written down anywhere,
// so it could only be made by an app file that knows both `readCachedBytes` and
// the asset record — and a decision that lives in the IO layer cannot be tested
// without the IO layer.
//
// Two hazards shape the shape of the answer:
//
//  * A DERIVED key (`a1b2c3d4-wave-v1`) names bytes that exist in the cache and are
//    NOT a media file. `isStoredByteCacheKey` accepts it because the storage layer
//    legitimately stores it, so a playback law that reuses the union would happily
//    hand a waveform to a `<video>` element. The playback answer reads
//    `isByteCacheKey`, the source-only predicate — the same reason `frames.mjs:165`
//    does.
//  * One revision is mounted by several surfaces at once (the footage plate and the
//    audio element of the same clip, or two clips over one file). A blob URL made
//    per SURFACE leaks one file per mount and revokes a URL another element is
//    still holding, which shows up as a clip that goes silent mid-play. The ledger
//    is keyed by revision, so a URL is created once, kept while ANY surface wants
//    it, and revoked only when none does.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planBlobUrlLifecycle, planPlaybackByteSource } from '../src/byteCache.mjs'

const FP = 'a1b2c3d4'
const OTHER = 'deadbeef'
const STREAM = '/uploads/clip.mp4'

describe('planPlaybackByteSource', () => {
  it('a revision the cache holds plays from the cache, named by its key', () => {
    assert.deepEqual(
      planPlaybackByteSource({ fingerprint: FP, cached: true, streamUrl: STREAM }),
      { kind: 'cache', key: FP }
    )
  })

  it('a legal fingerprint the cache does not hold falls back to the stream', () => {
    // Not a failure: the file was imported before the cache existed, or was pruned.
    // The clip still plays, and the caller may start a cache fill for next time.
    assert.deepEqual(
      planPlaybackByteSource({ fingerprint: FP, cached: false, streamUrl: STREAM }),
      { kind: 'stream', url: STREAM, reason: 'not-cached' }
    )
  })

  it('a clip that never had a fingerprint streams, and says so', () => {
    for (const missing of [undefined, null, '']) {
      assert.deepEqual(
        planPlaybackByteSource({ fingerprint: missing, cached: false, streamUrl: STREAM }),
        { kind: 'stream', url: STREAM, reason: 'no-revision' }
      )
    }
  })

  it('a fingerprint that is not a source key is never a cache read', () => {
    // The load-bearing case. A waveform row IS in the cache, so a law that asked
    // "is this a stored key" would answer `cache` and hand the caller bytes that
    // are a Float32Array of peaks.
    for (const bad of ['a1b2c3d4-wave-v1', 'a1b2c3d4-thumb-v2', '../evil', 'A1B2C3D4', 'deadbeef0']) {
      const plan = planPlaybackByteSource({ fingerprint: bad, cached: true, streamUrl: STREAM })
      assert.equal(plan.kind, 'stream', `${bad} is not a media revision`)
      assert.equal(plan.reason, 'no-revision')
    }
  })

  it('nothing cached and nothing to stream is unresolved — never an empty src', () => {
    // `src=""` on a media element resolves against the document URL and fires an
    // error event; the caller has to be able to tell "no material" from "material".
    assert.deepEqual(planPlaybackByteSource({ fingerprint: FP, cached: false }), {
      kind: 'unresolved', reason: 'not-cached'
    })
    assert.deepEqual(planPlaybackByteSource({}), { kind: 'unresolved', reason: 'no-revision' })
    assert.deepEqual(planPlaybackByteSource(null), { kind: 'unresolved', reason: 'no-revision' })
  })

  it('the cache answer is reported by the caller, never guessed here', () => {
    // A pure law cannot know what OPFS holds; it takes `cached` as a fact. Anything
    // other than a literal true — including a truthy blob — means "not in the cache".
    for (const notCached of [undefined, null, 0, 'yes', {}, () => true]) {
      assert.equal(
        planPlaybackByteSource({ fingerprint: FP, cached: notCached, streamUrl: STREAM }).kind,
        'stream'
      )
    }
  })

  it('a cached revision ignores a stream url that is still lying around', () => {
    const plan = planPlaybackByteSource({ fingerprint: FP, cached: true, streamUrl: STREAM })
    assert.equal('url' in plan, false, 'the cache answer must not carry a second source')
  })
})

describe('planBlobUrlLifecycle', () => {
  it('one url per revision, whatever number of surfaces want it', () => {
    const held = { [FP]: 'blob:app/1' }
    const plan = planBlobUrlLifecycle(held, [FP, FP, FP])
    assert.deepEqual(plan.keep, [{ key: FP, url: 'blob:app/1' }])
    assert.deepEqual(plan.create, [])
    assert.deepEqual(plan.revoke, [])
  })

  it('a revision no surface wants any more is revoked, with the url to revoke', () => {
    const plan = planBlobUrlLifecycle({ [FP]: 'blob:app/1', [OTHER]: 'blob:app/2' }, [FP])
    assert.deepEqual(plan.keep, [{ key: FP, url: 'blob:app/1' }])
    assert.deepEqual(plan.revoke, [{ key: OTHER, url: 'blob:app/2' }])
  })

  it('a revision nobody held yet is created once, not once per surface', () => {
    assert.deepEqual(planBlobUrlLifecycle({}, [OTHER, OTHER, FP]).create, [FP, OTHER])
  })

  it('leaving the preview revokes everything still held', () => {
    const plan = planBlobUrlLifecycle({ [FP]: 'blob:app/1', [OTHER]: 'blob:app/2' }, [])
    assert.deepEqual(plan.keep, [])
    assert.deepEqual(plan.revoke, [
      { key: FP, url: 'blob:app/1' },
      { key: OTHER, url: 'blob:app/2' }
    ])
  })

  it('the answer is ordered and idempotent — a re-run cannot thrash the host', () => {
    const held = { [OTHER]: 'blob:app/2', [FP]: 'blob:app/1' }
    const wanted = [OTHER, FP]
    const first = planBlobUrlLifecycle(held, wanted)
    const second = planBlobUrlLifecycle(held, wanted)
    assert.deepEqual(first, second, 'same inputs, same plan')
    assert.deepEqual(first.keep.map(row => row.key), [FP, OTHER], 'sorted by key, not by insertion')
    // Re-applying a plan that created its urls changes nothing at all.
    const after = planBlobUrlLifecycle(
      { ...held, ffffffff: 'blob:app/3' },
      [FP, OTHER, 'ffffffff']
    )
    assert.deepEqual(after.create, [])
    assert.deepEqual(after.revoke, [])
  })

  it('a row with no url in it is dropped, not revoked', () => {
    // An entry the host wrote before a failed create can hold null; there is
    // nothing to hand to URL.revokeObjectURL, and inventing one is a crash.
    const plan = planBlobUrlLifecycle({ [FP]: null, [OTHER]: 'blob:app/2' }, [])
    assert.deepEqual(plan.revoke, [{ key: OTHER, url: 'blob:app/2' }])
  })

  it('a wanted key that is not a legal cache key names nothing and is not created', () => {
    const plan = planBlobUrlLifecycle({}, [FP, 'a1b2c3d4-wave-v1', 'evil'])
    assert.deepEqual(plan.create, [FP])
  })
})
