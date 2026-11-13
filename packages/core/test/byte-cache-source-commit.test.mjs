// Slice G4b follow-up — when a source swap may land on a live media element.
//
// `playableSrc()` answers WHICH url a clip should play: the stream until the
// client cache read lands, the cache's `blob:` after. Vue writes that answer
// straight into `<video :src>`. Measured in Chromium: assigning `src` on an
// element that is playing PAUSES it and RESETS currentTime to 0 — and a large
// file reloads from readyState 0, firing `waiting`, which is the preview's
// "Buffering…" pill. Pressing Play right after an import is exactly the window
// where the read is still in flight, so the user sees the pill and a reset
// playhead on the first play.
//
// The swap itself is still worth making — the cache is the point of slice G4b —
// it just must not land while the element is playing. This law decides that:
// same media, mid-play, different url => keep the mounted url and report the
// new one as pending; adopt it the moment playback is paused.
//
// A DIFFERENT clip is not deferred. Swapping to another file is a real content
// change (a cut, a seek into the next clip); holding the old picture would show
// the wrong footage.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planPlaybackSourceCommit } from '../src/byteCache.mjs'

const STREAM = '/uploads/clip.mp4'
const BLOB = 'blob:app/1'

describe('planPlaybackSourceCommit', () => {
  it('the first bind adopts the url, playing or not', () => {
    // Nothing mounted yet: there is no element to disturb.
    assert.deepEqual(
      planPlaybackSourceCommit({ current: '', desired: STREAM, playing: true, sameMedia: true }),
      { src: STREAM, pending: null }
    )
    assert.deepEqual(
      planPlaybackSourceCommit({ current: '', desired: STREAM, playing: false, sameMedia: true }),
      { src: STREAM, pending: null }
    )
  })

  it('the cache landing mid-play is held back, not mounted', () => {
    // The reported defect: stream -> blob while playing must not reach the element.
    assert.deepEqual(
      planPlaybackSourceCommit({ current: STREAM, desired: BLOB, playing: true, sameMedia: true }),
      { src: STREAM, pending: BLOB }
    )
  })

  it('the held-back url is adopted as soon as playback stops', () => {
    assert.deepEqual(
      planPlaybackSourceCommit({ current: STREAM, desired: BLOB, playing: false, sameMedia: true }),
      { src: BLOB, pending: null }
    )
  })

  it('a different clip is adopted at once, even mid-play', () => {
    // Same-media deferral must not freeze the picture on the previous clip.
    assert.deepEqual(
      planPlaybackSourceCommit({ current: STREAM, desired: '/uploads/next.mp4', playing: true, sameMedia: false }),
      { src: '/uploads/next.mp4', pending: null }
    )
  })

  it('an unchanged url is left alone and clears any pending swap', () => {
    assert.deepEqual(
      planPlaybackSourceCommit({ current: STREAM, desired: STREAM, playing: true, sameMedia: true }),
      { src: STREAM, pending: null }
    )
    assert.deepEqual(
      planPlaybackSourceCommit({ current: '', desired: '', playing: false, sameMedia: true }),
      { src: '', pending: null }
    )
  })

  it('a clip that went away clears the mounted url instead of keeping the old picture', () => {
    for (const gone of [null, undefined, '']) {
      assert.deepEqual(
        planPlaybackSourceCommit({ current: STREAM, desired: gone, playing: true, sameMedia: true }),
        { src: '', pending: null }
      )
    }
  })

  it('a truthy-but-not-true playing flag never defers', () => {
    // Same reading as planPlaybackByteSource's `cached`: only literal true is a fact.
    for (const notPlaying of [undefined, null, 0, 'yes', {}]) {
      assert.equal(
        planPlaybackSourceCommit({ current: STREAM, desired: BLOB, playing: notPlaying, sameMedia: true }).src,
        BLOB
      )
    }
  })

  it('the plan is idempotent — re-running it on its own answer changes nothing', () => {
    const first = planPlaybackSourceCommit({ current: STREAM, desired: BLOB, playing: true, sameMedia: true })
    const second = planPlaybackSourceCommit({ current: first.src, desired: first.pending, playing: true, sameMedia: true })
    assert.deepEqual(second, { src: STREAM, pending: BLOB })
  })
})
