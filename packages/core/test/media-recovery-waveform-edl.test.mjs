// @tmcut/core — media / recovery / waveform / edl tests. Run: node --test test/
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMediaPath,
  mediaFileKey,
  mediaFileName,
  extensionOf,
  classifyAssetKind,
  formatDurationSec,
  formatFileSize
} from '../src/media.mjs'
import { decideRecovery } from '../src/recovery.mjs'
import { int16ToPeaks, clampWaveformPoints } from '../src/waveform.mjs'
import { validateEdl, selectSegments, segmentsToClips } from '../src/edl.mjs'
import { addClip } from '../src/timeline.mjs'
import { defaultTimeline } from '../src/project.mjs'
import { secToTicks } from '../src/time.mjs'

describe('media', () => {
  it('normalizes windows paths', () => {
    assert.equal(normalizeMediaPath('D:\\Videos\\A.MP4'), 'D:/Videos/A.MP4')
    assert.equal(mediaFileKey('D:\\Videos\\A.MP4'), 'd:/videos/a.mp4')
    assert.equal(mediaFileName('D:/Videos/a.mp4'), 'a.mp4')
    assert.equal(extensionOf('archive.tar.gz'), 'gz')
    assert.equal(extensionOf('noext'), '')
  })

  it('classifies asset kinds', () => {
    assert.equal(classifyAssetKind('a.mp4'), 'video')
    assert.equal(classifyAssetKind('a.mkv'), 'video')
    assert.equal(classifyAssetKind('a.mp3'), 'audio')
    assert.equal(classifyAssetKind('a.png'), 'image')
    assert.equal(classifyAssetKind('a.txt'), null)
  })

  it('formats durations and sizes like the app', () => {
    assert.equal(formatDurationSec(76), '1:16')
    assert.equal(formatDurationSec(0), '0:00')
    assert.equal(formatFileSize(0), '0 B')
    assert.equal(formatFileSize(1536), '1.5 KB')
    assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB')
  })
})

describe('recovery', () => {
  it('decides recovery exactly like the app', () => {
    assert.equal(decideRecovery({ hasRecovery: false, recoveryUpdatedAtMs: 5, hasProject: true, projectMtimeMs: 1 }), 'none')
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: null, hasProject: true, projectMtimeMs: 1 }), 'none')
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: NaN, hasProject: true, projectMtimeMs: 1 }), 'none')
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 5, hasProject: false, projectMtimeMs: 0 }), 'force')
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 5, hasProject: true, projectMtimeMs: NaN }), 'suggest')
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 5, hasProject: true, projectMtimeMs: 3 }), 'suggest')
    assert.equal(decideRecovery({ hasRecovery: true, recoveryUpdatedAtMs: 3, hasProject: true, projectMtimeMs: 5 }), 'none')
  })
})

describe('waveform', () => {
  it('reduces samples to normalized peaks', () => {
    const peaks = int16ToPeaks([0, 16384, -32768, 8192], 2)
    assert.equal(peaks.length, 2)
    assert.ok(peaks.every(p => p >= 0 && p <= 1))
    assert.deepEqual(int16ToPeaks([], 4), [0, 0, 0, 0])
  })

  it('clamps arbitrary input', () => {
    assert.deepEqual(clampWaveformPoints([2, -1, NaN, 0.5]), [1, 0, 0, 0.5])
    assert.deepEqual(clampWaveformPoints(null), [])
  })
})

describe('edl', () => {
  function validEdl() {
    return {
      version: 1,
      assetId: 'asset_1',
      profile: 'viral-shorts',
      segments: [
        { start: 0, end: 5, score: 0.9, reason: 'speech' },
        { start: 5, end: 8, score: 0.2, reason: 'silence' }
      ],
      createdAt: new Date().toISOString(),
      analyzerVersion: 'scene-1'
    }
  }

  it('accepts a well-formed EDL', () => {
    assert.deepEqual(validateEdl(validEdl()), [])
  })

  it('rejects malformed EDLs', () => {
    assert.ok(validateEdl(null).length > 0)
    assert.ok(validateEdl({ ...validEdl(), version: 2 }).length > 0)
    assert.ok(validateEdl({ ...validEdl(), profile: 'nope' }).length > 0)
    assert.ok(validateEdl({ ...validEdl(), segments: [{ start: 5, end: 5, score: 2, reason: '' }] }).length >= 3)
    assert.ok(validateEdl({ ...validEdl(), segments: 'x' }).length > 0)
  })

  it('selects segments above threshold, sorted', () => {
    const selected = selectSegments(validEdl(), 0.5)
    assert.equal(selected.length, 1)
    assert.equal(selected[0].reason, 'speech')
  })
})

describe('segmentsToClips (C10)', () => {
  function edlWith(segments) {
    return {
      version: 1,
      assetId: 'asset_1',
      profile: 'viral-shorts',
      segments,
      createdAt: new Date().toISOString(),
      analyzerVersion: 'scene-1'
    }
  }
  const speech = (start, end) => ({ start, end, score: 0.9, reason: 'speech' })

  it('converts seconds to tick clip inputs (addClip round-trip)', () => {
    const edl = edlWith([speech(1, 3)])
    const clips = segmentsToClips(edl, edl.segments)
    assert.deepEqual(clips, [{ in: secToTicks(1), out: secToTicks(3), offset: 0 }])
    // Spec contract: source range + timeline placement survive as ticks.
    const clip = addClip(defaultTimeline(), 'video', clips[0])
    assert.equal(clip.source.in, secToTicks(1))
    assert.equal(clip.source.out, secToTicks(3))
    assert.equal(clip.timeline.start, 0)
    assert.equal(clip.timeline.duration, secToTicks(2))
  })

  it('sorts by start and drops segments without a positive span', () => {
    const edl = edlWith([speech(0, 1), speech(0, 2)])
    const clips = segmentsToClips(edl, [
      speech(5, 7),
      speech(1, 3),
      speech(4, 4),
      { start: 'x', end: 2, score: 0.9, reason: 'speech' },
      null
    ])
    assert.equal(clips.length, 2)
    assert.equal(clips[0].in, secToTicks(1))
    assert.equal(clips[1].in, secToTicks(5))
  })

  it('concatenates kept segments by default (dead air removed)', () => {
    const edl = edlWith([speech(0, 1), speech(0, 2)])
    const clips = segmentsToClips(edl, [speech(0, 2), speech(5, 7)])
    assert.equal(clips.length, 2)
    assert.equal(clips[0].offset, 0)
    // Second clip butts against the first — the 3s source gap is gone.
    assert.equal(clips[1].offset, secToTicks(2))
  })

  it('preserves gaps >= minGapTicks and still closes smaller ones', () => {
    const edl = edlWith([speech(0, 1), speech(0, 2)])
    const kept = [speech(0, 2), speech(5, 7), speech(7.5, 8), speech(14, 15)]
    // 3s, 0.5s and 6s gaps: with a 1s threshold the 0.5s micro gap closes.
    const clips = segmentsToClips(edl, kept, { minGapTicks: secToTicks(1) })
    assert.equal(clips[1].offset, secToTicks(5))
    assert.equal(clips[2].offset, secToTicks(7))
    // 7 + 0.5 (closed micro gap shifts everything 0.5s earlier) + 6s gap.
    assert.equal(clips[3].offset, secToTicks(13.5))
    // Above every gap: everything concatenates like the default.
    const tight = segmentsToClips(edl, kept, { minGapTicks: secToTicks(10) })
    assert.deepEqual(tight.map(clip => clip.offset), [0, secToTicks(2), secToTicks(4), secToTicks(4.5)])
  })

  it('refuses invalid EDLs, bad track types and non-array segments', () => {
    assert.deepEqual(segmentsToClips(null, []), [])
    assert.deepEqual(segmentsToClips({ ...edlWith([]), version: 2 }, []), [])
    const edl = edlWith([speech(0, 1)])
    assert.deepEqual(segmentsToClips(edl, [], { trackType: 'text' }), [])
    assert.deepEqual(segmentsToClips(edl, 'nope'), [])
    assert.deepEqual(segmentsToClips(edl, []), [])
  })
})
