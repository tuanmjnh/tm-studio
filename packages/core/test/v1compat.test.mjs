// @tmcut/core — v1compat tests. Run: node --test "test/*.test.mjs"
// v1 fixtures mirror the app TmcutTimelineItem shape structurally
// (no app imports — the core stays dependency-free).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  v1ClipToV3, v3ClipToV1, v1TracksToV3, v1MatchesV3, syncV3Result,
  ticksClipToV3, v3ClipToTicks, ticksTracksToV3, ticksMatchesV3, syncTicksResult
} from '../src/v1compat.mjs'
import { duplicateClips, rippleDelete } from '../src/editing.mjs'
import { splitClip } from '../src/timeline.mjs'
import { secToTicks, TICKS_PER_SECOND } from '../src/time.mjs'

function v1Clip(partial = {}) {
  return {
    id: 'clip_1',
    name: 'a.mp4',
    src: 'D:/Videos/a.mp4',
    in: 2,
    out: 12,
    offset: 0,
    speed: 1,
    opacity: 80,
    scale: 100,
    x: 10,
    y: 20,
    rotation: 0,
    volume: 100,
    effects: [],
    keyframes: [],
    ...partial
  }
}

function v1Tracks() {
  return [{ id: 't-video-1', type: 'video', name: 'Video 1', items: [v1Clip()] }]
}

describe('v1compat', () => {
  it('converts v1 clips to v3 ticks losslessly', () => {
    const v3 = v1ClipToV3(v1Clip(), 'video')
    assert.equal(v3.source.in, secToTicks(2))
    assert.equal(v3.source.out, secToTicks(12))
    assert.equal(v3.timeline.start, 0)
    assert.equal(v3.transform.opacity, 0.8)
    assert.deepEqual(v3.locator, { runtime: 'electron', path: 'D:/Videos/a.mp4' })
  })

  it('round-trips untouched clips without rewrites', () => {
    const tracks = v1Tracks()
    const v3 = v1TracksToV3(tracks)
    assert.ok(v1MatchesV3(tracks[0].items[0], v3.tracks[0].items[0]))
    const stats = syncV3Result(tracks, v3)
    assert.deepEqual(stats, { added: 0, updated: 0, removed: 0 })
    assert.equal(tracks[0].items[0].in, 2)
  })

  it('detects relation-only changes (groupId/linkId)', () => {
    const tracks = v1Tracks()
    const v3 = v1TracksToV3(tracks)
    // Group/link-only mutations must not be mistaken for "untouched" —
    // syncV3Result would silently drop them (C9).
    v3.tracks[0].items[0].groupId = 'grp_new'
    assert.equal(v1MatchesV3(tracks[0].items[0], v3.tracks[0].items[0]), false)
    const stats = syncV3Result(tracks, v3)
    assert.deepEqual(stats, { added: 0, updated: 1, removed: 0 })
    assert.equal(tracks[0].items[0].groupId, 'grp_new')
  })

  it('detects transition-only changes (transitionIn)', () => {
    const tracks = v1Tracks()
    tracks[0].items[0].transitionIn = { type: 'fade', duration: secToTicks(0.5) }
    const clip = v1TracksToV3(tracks).tracks[0].items[0]
    assert.ok(v1MatchesV3(tracks[0].items[0], clip))
    // Clearing must be detected even though the restored offset
    // round-trips equal — otherwise syncV3Result keeps the stale
    // transition forever (R34/B3).
    const cleared = { ...clip }
    delete cleared.transitionIn
    assert.equal(v1MatchesV3(tracks[0].items[0], cleared), false)
    const retyped = { ...clip, transitionIn: { type: 'wipe-left', duration: secToTicks(0.5) } }
    assert.equal(v1MatchesV3(tracks[0].items[0], retyped), false)
  })

  it('detects fade-only changes (fade envelope)', () => {
    const tracks = v1Tracks()
    tracks[0].items[0].fade = { in: secToTicks(0.5), out: 0 }
    const clip = v1TracksToV3(tracks).tracks[0].items[0]
    assert.ok(v1MatchesV3(tracks[0].items[0], clip))
    // Clearing must sync back even though no numeric field changed,
    // otherwise syncV3Result keeps the stale fade forever (R38/C12).
    const cleared = { ...clip }
    delete cleared.fade
    assert.equal(v1MatchesV3(tracks[0].items[0], cleared), false)
    const resized = { ...clip, fade: { in: secToTicks(1), out: 0 } }
    assert.equal(v1MatchesV3(tracks[0].items[0], resized), false)
  })

  it('carries fontFamily/fontFile across the bridge (C-1)', () => {
    const v1 = v1Clip({ text: 'Hello', fontFamily: 'Be Vietnam Pro', fontFile: 'C:/Fonts/be.woff2' })
    const v3 = v1ClipToV3(v1, 'text')
    assert.equal(v3.fontFamily, 'Be Vietnam Pro')
    assert.equal(v3.fontFile, 'C:/Fonts/be.woff2')
    const back = v3ClipToV1(v3)
    assert.equal(back.fontFamily, 'Be Vietnam Pro')
    assert.equal(back.fontFile, 'C:/Fonts/be.woff2')
  })

  it('keeps the picked font on split and duplicate clones (C-1)', () => {
    // Clone-based core ops copy the v3 clip verbatim — the font must
    // survive the v1→v3→v1 round trip or the second half silently
    // reverts to the default face on export.
    const tracks = [{
      id: 't-text-1',
      type: 'text',
      name: 'Text 1',
      items: [v1Clip({ id: 'txt_1', text: 'Hello', fontFamily: 'Be Vietnam Pro', fontFile: 'C:/Fonts/be.woff2', in: 0, out: 10, offset: 0 })]
    }]
    const v3 = v1TracksToV3(tracks)
    assert.ok(splitClip(v3, 'txt_1', secToTicks(5)))
    assert.equal(duplicateClips(v3, ['txt_1'], secToTicks(20)).length, 1)
    const stats = syncV3Result(tracks, v3)
    // The first half is updated in place (split shortened its out/duration);
    // the split tail and the duplicate arrive as new v1 items.
    assert.deepEqual(stats, { added: 2, updated: 1, removed: 0 })
    assert.equal(tracks[0].items.length, 3)
    assert.equal(tracks[0].items[0].out, 5)
    for (const item of tracks[0].items) {
      assert.equal(item.fontFamily, 'Be Vietnam Pro')
      assert.equal(item.fontFile, 'C:/Fonts/be.woff2')
    }
  })

  it('detects font-only changes (fontFamily/fontFile)', () => {
    const tracks = v1Tracks()
    tracks[0].items[0].fontFamily = 'Arial'
    tracks[0].items[0].fontFile = 'C:/Windows/Fonts/arial.ttf'
    const clip = v1TracksToV3(tracks).tracks[0].items[0]
    assert.ok(v1MatchesV3(tracks[0].items[0], clip))
    // A font swap must sync back even though no numeric field changed —
    // otherwise syncV3Result keeps the stale face forever (C-1).
    const swapped = { ...clip, fontFamily: 'Tahoma' }
    assert.equal(v1MatchesV3(tracks[0].items[0], swapped), false)
    tracks[0].items[0].fontFamily = 'Tahoma'
    assert.ok(v1MatchesV3(tracks[0].items[0], swapped))
  })

  it('carries text style flags and align across the bridge (C-2)', () => {
    const v1 = v1Clip({ text: 'Hi', bold: true, italic: true, align: 'right', shadow: true, stroke: true })
    const back = v3ClipToV1(v1ClipToV3(v1, 'text'))
    assert.equal(back.bold, true)
    assert.equal(back.italic, true)
    assert.equal(back.align, 'right')
    assert.equal(back.shadow, true)
    assert.equal(back.stroke, true)
  })

  it('syncs flag-only and align-only text style changes (C-2)', () => {
    const tracks = [{ id: 't-text-1', type: 'text', name: 'Text 1', items: [v1Clip({ id: 'txt_1', text: 'Hi' })] }]
    const v3 = v1TracksToV3(tracks)
    assert.ok(v1MatchesV3(tracks[0].items[0], v3.tracks[0].items[0]))
    // Absent flags compare equal to false — only a real toggle syncs.
    v3.tracks[0].items[0].bold = true
    v3.tracks[0].items[0].align = 'left'
    assert.equal(v1MatchesV3(tracks[0].items[0], v3.tracks[0].items[0]), false)
    const stats = syncV3Result(tracks, v3)
    assert.deepEqual(stats, { added: 0, updated: 1, removed: 0 })
    assert.equal(tracks[0].items[0].bold, true)
    assert.equal(tracks[0].items[0].align, 'left')
    // The synced-back item matches a fresh conversion (no update loop).
    assert.ok(v1MatchesV3(tracks[0].items[0], v1TracksToV3(tracks).tracks[0].items[0]))
  })

  it('merges core op results back by id', () => {
    const tracks = v1Tracks()
    const v3 = v1TracksToV3(tracks)
    const copies = duplicateClips(v3, ['clip_1'], secToTicks(20))
    assert.equal(copies.length, 1)
    const stats = syncV3Result(tracks, v3)
    assert.deepEqual(stats, { added: 1, updated: 0, removed: 0 })
    assert.equal(tracks[0].items.length, 2)
    assert.equal(tracks[0].items[1].offset, 20)
  })

  it('applies ripple removals back to v1', () => {
    const tracks = [{ id: 't-video-1', type: 'video', name: 'V', items: [v1Clip({ id: 'a', offset: 0 }), v1Clip({ id: 'b', offset: 10, src: 'D:/b.mp4', name: 'b.mp4' })] }]
    const v3 = v1TracksToV3(tracks)
    assert.equal(rippleDelete(v3, 'a'), 1)
    const stats = syncV3Result(tracks, v3)
    assert.deepEqual(stats, { added: 0, updated: 1, removed: 1 })
    assert.equal(tracks[0].items.length, 1)
    assert.equal(tracks[0].items[0].id, 'b')
    assert.equal(tracks[0].items[0].offset, 0)
  })

  it('syncs track add/remove at the track level', () => {
    const tracks = [
      { id: 't-video-1', type: 'video', name: 'Video 1', items: [v1Clip()] },
      { id: 't-audio-1', type: 'audio', name: 'Audio 1', items: [] }
    ]
    const v3 = v1TracksToV3(tracks)

    // A v3-only track is created back as a v1 track...
    v3.tracks.push({ id: 't-video-2', type: 'video', name: 'Video 2', items: [] })
    syncV3Result(tracks, v3)
    assert.equal(tracks.length, 3)
    assert.equal(tracks[2].id, 't-video-2')
    assert.equal(tracks[2].name, 'Video 2')

    // ...and a v1 track missing from v3 is dropped with its clips.
    v3.tracks = v3.tracks.filter(track => track.id !== 't-video-1')
    const stats = syncV3Result(tracks, v3)
    assert.equal(stats.removed, 1)
    assert.deepEqual(tracks.map(track => track.id), ['t-audio-1', 't-video-2'])
  })

  it('carries text animation in/out across the bridge (C-5)', () => {
    const textClip = {
      ...v1Clip({ id: 'c-text-1' }),
      text: 'Title',
      animIn: 'slide-up',
      animInDuration: 0.6,
      animOut: 'fade',
      animOutDuration: 0.4
    }
    const v3 = v1ClipToV3(textClip, 'text')
    assert.equal(v3.animIn, 'slide-up')
    assert.equal(v3.animInDuration, 0.6)
    assert.equal(v3.animOut, 'fade')
    assert.equal(v3.animOutDuration, 0.4)

    const v1Back = v3ClipToV1(v3)
    assert.equal(v1Back.animIn, 'slide-up')
    assert.equal(v1Back.animInDuration, 0.6)
    assert.equal(v1Back.animOut, 'fade')
    assert.equal(v1Back.animOutDuration, 0.4)
  })

  it('carries video stabilize configuration across the bridge (E-5)', () => {
    const videoClip = {
      ...v1Clip({ id: 'c-video-1' }),
      stabilize: true,
      stabilizeLevel: 'aggressive',
      stabilizedPath: 'D:/cache/stabilized/vid-abc.mp4',
      stabilizeStatus: 'ready'
    }
    const v3 = v1ClipToV3(videoClip, 'video')
    assert.equal(v3.stabilize, true)
    assert.equal(v3.stabilizeLevel, 'aggressive')
    assert.equal(v3.stabilizedPath, 'D:/cache/stabilized/vid-abc.mp4')
    assert.equal(v3.stabilizeStatus, 'ready')

    const v1Back = v3ClipToV1(v3)
    assert.equal(v1Back.stabilize, true)
    assert.equal(v1Back.stabilizeLevel, 'aggressive')
    assert.equal(v1Back.stabilizedPath, 'D:/cache/stabilized/vid-abc.mp4')
    assert.equal(v1Back.stabilizeStatus, 'ready')
  })

  it('detects cropRect changes and syncs across the bridge (F-3)', () => {
    const videoClip = {
      ...v1Clip({ id: 'c-video-1' }),
      fit: 'crop',
      cropRect: { x: 0.1, y: 0.15, w: 0.8, h: 0.7 }
    }
    const v3 = v1ClipToV3(videoClip, 'video')
    assert.deepEqual(v3.cropRect, { x: 0.1, y: 0.15, w: 0.8, h: 0.7 })

    const v1Back = v3ClipToV1(v3)
    assert.deepEqual(v1Back.cropRect, { x: 0.1, y: 0.15, w: 0.8, h: 0.7 })

    assert.ok(v1MatchesV3(videoClip, v3))

    const v3Edited = { ...v3, cropRect: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } }
    assert.ok(!v1MatchesV3(videoClip, v3Edited))
  })

  it('syncs reverse-only changes across the bridge (R74)', () => {
    const tracks = [{ id: 't-video-1', type: 'video', name: 'V', items: [v1Clip({ id: 'c-rev-1', reverse: true })] }]
    const v3 = v1TracksToV3(tracks)
    const clip = v3.tracks[0].items[0]
    assert.equal(clip.reverse, true)
    assert.ok(v1MatchesV3(tracks[0].items[0], clip))

    // A reverse toggle made in v3 must sync back — previously silently
    // dropped because `reverse` was excluded from COMPARE_FLAGS (R74).
    const toggledClip = { ...clip, reverse: false }
    assert.equal(v1MatchesV3(tracks[0].items[0], toggledClip), false)
    const stats = syncV3Result(tracks, { version: 3, tracks: [{ ...v3.tracks[0], items: [toggledClip] }], markers: [] })
    assert.deepEqual(stats, { added: 0, updated: 1, removed: 0 })
    assert.equal(tracks[0].items[0].reverse, false)
  })

  it('syncs effects-only changes across the bridge (R74)', () => {
    const tracks = [{
      id: 't-video-1', type: 'video', name: 'V',
      items: [v1Clip({ id: 'c-eff-1', effects: [{ type: 'blur', params: { amount: 5 } }] })]
    }]
    const v3 = v1TracksToV3(tracks)
    const clip = v3.tracks[0].items[0]
    assert.equal(clip.effects.length, 1)
    assert.ok(v1MatchesV3(tracks[0].items[0], clip))

    // An effects-only edit must sync back — previously silently dropped
    // because `effects` was not compared at all (R74).
    const editedClip = {
      ...clip,
      effects: [
        { type: 'blur', params: { amount: 5 } },
        { type: 'vignette', params: { intensity: 0.3 } }
      ]
    }
    assert.equal(v1MatchesV3(tracks[0].items[0], editedClip), false)
    const stats = syncV3Result(tracks, { version: 3, tracks: [{ ...v3.tracks[0], items: [editedClip] }], markers: [] })
    assert.deepEqual(stats, { added: 0, updated: 1, removed: 0 })
    assert.equal(tracks[0].items[0].effects.length, 2)
    assert.equal(tracks[0].items[0].effects[1].type, 'vignette')
  })

  it('syncs keyframe-only changes across the bridge (R74)', () => {
    const tracks = [{
      id: 't-video-1', type: 'video', name: 'V',
      items: [v1Clip({ id: 'c-kf-1', keyframes: [{ t: secToTicks(1), prop: 'scale', value: 1.5 }] })]
    }]
    const v3 = v1TracksToV3(tracks)
    const clip = v3.tracks[0].items[0]
    assert.equal(clip.keyframes.length, 1)
    assert.ok(v1MatchesV3(tracks[0].items[0], clip))

    // A keyframe-only edit must sync back — previously silently dropped
    // because `keyframes` was not compared at all (R74).
    const editedClip = {
      ...clip,
      keyframes: [
        { t: secToTicks(1), prop: 'scale', value: 1.5 },
        { t: secToTicks(3), prop: 'opacity', value: 0.5 }
      ]
    }
    assert.equal(v1MatchesV3(tracks[0].items[0], editedClip), false)
    const stats = syncV3Result(tracks, { version: 3, tracks: [{ ...v3.tracks[0], items: [editedClip] }], markers: [] })
    assert.deepEqual(stats, { added: 0, updated: 1, removed: 0 })
    assert.equal(tracks[0].items[0].keyframes.length, 2)
    assert.equal(tracks[0].items[0].keyframes[1].prop, 'opacity')
  })

  it('syncs track-level muted/locked/hidden across the bridge (R74)', () => {
    const tracks = [
      { id: 't-video-1', type: 'video', name: 'V', items: [v1Clip()] },
      { id: 't-audio-1', type: 'audio', name: 'A', items: [], muted: true, locked: false, hidden: false }
    ]
    const v3 = v1TracksToV3(tracks)
    // Mute the audio track in v3 — must sync back to v1 (R74).
    v3.tracks[1].muted = false
    v3.tracks[1].locked = true
    v3.tracks[1].hidden = true
    const stats = syncV3Result(tracks, v3)
    assert.deepEqual(stats, { added: 0, updated: 0, removed: 0 })
    assert.equal(tracks[1].muted, false)
    assert.equal(tracks[1].locked, true)
    assert.equal(tracks[1].hidden, true)
  })

  // ---- C16-R3: ticks-native bridge (live store). in/out/offset are ----
  // ---- integer TICKS; the round-trip must be an exact identity.     ----
  describe('ticks bridge (C16-R3)', () => {
    function tickClip(partial = {}) {
      return {
        id: 'clip_t',
        name: 'a.mp4',
        src: 'D:/Videos/a.mp4',
        in: 2 * TICKS_PER_SECOND,
        out: 12 * TICKS_PER_SECOND,
        offset: 0,
        speed: 1,
        opacity: 80,
        scale: 100,
        x: 10,
        y: 20,
        rotation: 0,
        volume: 100,
        effects: [],
        keyframes: [],
        ...partial
      }
    }
    function tickTracks() {
      return [{ id: 't-video-1', type: 'video', name: 'Video 1', items: [tickClip()] }]
    }

    it('maps ticks fields to v3 without a second scaling', () => {
      const v3 = ticksClipToV3(tickClip(), 'video')
      assert.equal(v3.source.in, 2 * TICKS_PER_SECOND)
      assert.equal(v3.source.out, 12 * TICKS_PER_SECOND)
      assert.equal(v3.timeline.duration, 10 * TICKS_PER_SECOND)
      assert.equal(v3.transform.opacity, 0.8)
    })

    it('round-trips ticks losslessly (integer identity)', () => {
      const tracks = tickTracks()
      const v3 = ticksTracksToV3(tracks)
      const back = v3ClipToTicks(v3.tracks[0].items[0])
      assert.equal(back.in, 2 * TICKS_PER_SECOND)
      assert.equal(back.out, 12 * TICKS_PER_SECOND)
      assert.ok(ticksMatchesV3(tracks[0].items[0], v3.tracks[0].items[0]))
      const stats = syncTicksResult(tracks, v3)
      assert.deepEqual(stats, { added: 0, updated: 0, removed: 0 })
    })

    it('sub-tick source maps to whole ticks (identity of the store unit)', () => {
      // The live store never holds sub-tick values, but the bridge must
      // still produce integers, never a fractional tick.
      const v3 = ticksClipToV3(tickClip({ in: 0, out: 1.4 }), 'video')
      assert.equal(v3.source.in, 0)
      assert.equal(v3.source.out, 1)
    })

    it('splits/duplicates/ripples then syncs ticks back to the store', () => {
      const tracks = [{ id: 't-video-1', type: 'video', name: 'V', items: [tickClip({ id: 'x' })] }]
      const v3 = ticksTracksToV3(tracks)
      // Split at TIMELINE offset 4 ticks: the source cut lands at
      // in(2 ticks) + 4 = 6 ticks (speed 1).
      assert.ok(splitClip(v3, 'x', 4 * TICKS_PER_SECOND))
      syncTicksResult(tracks, v3)
      const [first, tail] = tracks[0].items
      assert.equal(first.out, 6 * TICKS_PER_SECOND)
      assert.equal(tail.in, 6 * TICKS_PER_SECOND)
      assert.equal(tail.out, 12 * TICKS_PER_SECOND)
    })

    it('seconds bridge stays for migration (never used on the ticks store)', () => {
      // A legacy SECONDS item fed to the seconds bridge scales by TICKS;
      // feeding the SAME object to the ticks bridge would misread it —
      // pinning the two flavors apart so they are never swapped.
      const legacy = { id: 'c', in: 2, out: 12, offset: 1, speed: 1 }
      assert.equal(v1ClipToV3(legacy, 'video').source.in, 2 * TICKS_PER_SECOND)
      assert.equal(ticksClipToV3(legacy, 'video').source.in, 2) // raw tick, wrong for legacy — documented hazard
    })
  })
})
