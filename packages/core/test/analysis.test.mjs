// @tmcut/core — analysis tests. Run: node --test "test/*.test.mjs"
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseSceneOutput,
  parseSilenceOutput,
  overlapDuration,
  scoreSegments,
  blendSceneInterest,
  detectFillerWords,
  analyzeTranscriptSegment
} from '../src/analysis.mjs'

const SHOWINFO = `
[Parsed_showinfo_1 @ 0x123] n:  10 pts:  240 pts_time:2.000 s:1920x1080 fmt:yuv420p
[Parsed_showinfo_1 @ 0x123] n:  25 pts:  600 pts_time:5.000 s:1920x1080 fmt:yuv420p
[Parsed_showinfo_1 @ 0x123] n:  40 pts:  960 pts_time:8.000 s:1920x1080 fmt:yuv420p
`

const SILENCE = `
[silencedetect @ 0xabc] silence_start: 1.000
[silencedetect @ 0xabc] silence_end: 3.000 | silence_duration: 2.000
[silencedetect @ 0xabc] silence_start: 9.500
`

describe('analysis', () => {
  it('parses showinfo cuts into shot segments', () => {
    const segments = parseSceneOutput(SHOWINFO, 10)
    assert.deepEqual(segments, [
      { start: 0, end: 2 },
      { start: 2, end: 5 },
      { start: 5, end: 8 },
      { start: 8, end: 10 }
    ])
  })

  it('handles empty scene output', () => {
    assert.deepEqual(parseSceneOutput('', 0), [])
    assert.deepEqual(parseSceneOutput('no cuts here', 6), [{ start: 0, end: 6 }])
  })

  it('parses silencedetect ranges and closes dangling starts', () => {
    assert.deepEqual(parseSilenceOutput(SILENCE, 12), [
      { start: 1, end: 3 },
      { start: 9.5, end: 12 }
    ])
    assert.deepEqual(parseSilenceOutput('', 5), [])
  })

  it('measures range overlap', () => {
    assert.equal(overlapDuration(0, 10, [{ start: 2, end: 5 }]), 3)
    assert.equal(overlapDuration(0, 10, []), 0)
    assert.equal(overlapDuration(4, 6, [{ start: 0, end: 10 }]), 2)
  })

  it('scores viral-shorts EDL with speech boosts', () => {
    const edl = scoreSegments({
      assetId: 'a1',
      profile: 'viral-shorts',
      scenes: [{ start: 0, end: 5 }, { start: 5, end: 30 }, { start: 30, end: 31 }],
      silences: [],
      speech: [{ start: 0, end: 5 }]
    })
    assert.equal(edl.version, 1)
    assert.equal(edl.profile, 'viral-shorts')
    assert.equal(edl.segments.length, 3)
    assert.ok(edl.segments[0].score > edl.segments[2].score)
    assert.equal(edl.segments[1].reason, 'too-long')
    assert.ok(edl.segments.every(s => s.score >= 0 && s.score <= 1))
  })

  it('penalizes silence for podcasts', () => {
    const edl = scoreSegments({
      assetId: 'a1',
      profile: 'podcast-summary',
      scenes: [{ start: 0, end: 10 }],
      silences: [{ start: 0, end: 9.5 }],
      speech: []
    })
    assert.equal(edl.segments[0].reason, 'silence')
    assert.ok(edl.segments[0].score < 0.1)
  })

  it('prefers stable shots for vlogs and degrades without speech', () => {
    const edl = scoreSegments({
      assetId: 'a1',
      profile: 'cinematic-vlog',
      scenes: [{ start: 0, end: 8 }, { start: 8, end: 8.5 }]
    })
    assert.equal(edl.segments[0].reason, 'stable-shot')
    assert.ok(edl.segments[0].score > edl.segments[1].score)
  })

  it('falls back to viral-shorts on unknown profiles', () => {
    const edl = scoreSegments({ assetId: 'a1', profile: 'nope', scenes: [{ start: 0, end: 5 }] })
    assert.equal(edl.profile, 'viral-shorts')
  })

  it('detects filler words in Vietnamese and English', () => {
    const viRes = detectFillerWords('Xin chào các bạn, ừm, hôm nay mình kiểu như là chia sẻ mẹo này nhé')
    assert.ok(viRes.count >= 2)
    assert.ok(viRes.words.includes('ừm') || viRes.words.includes('kiểu như'))
    assert.ok(viRes.fillerRatio > 0.1)

    const enRes = detectFillerWords('So basically, um, you know, we should test this actually')
    assert.ok(enRes.count >= 3)
    assert.ok(enRes.words.includes('um'))
    assert.ok(enRes.words.includes('you know'))
    assert.ok(enRes.fillerRatio > 0.25)
  })

  it('analyzes transcript segment and tags filler vs highlight', () => {
    const fillerSeg = analyzeTranscriptSegment('ừm ờ thì là...', { filterFillerWords: true })
    assert.equal(fillerSeg.isFiller, true)
    assert.ok(fillerSeg.scoreModifier < 0)

    const highlightSeg = analyzeTranscriptSegment('Đây là bí quyết quan trọng nhất để thành công', {
      keywords: ['bí quyết', 'quan trọng']
    })
    assert.equal(highlightSeg.isHighlight, true)
    assert.ok(highlightSeg.matchedKeywords.includes('bí quyết'))
    assert.ok(highlightSeg.scoreModifier > 0)
  })

  it('penalizes filler words and boosts highlight keywords in EDL scoring', () => {
    const edl = scoreSegments({
      assetId: 'a1',
      profile: 'podcast-summary',
      scenes: [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
        { start: 10, end: 15 }
      ],
      silences: [],
      transcript: [
        { start: 0, end: 5, text: 'ừm ờ thì kiểu như là...' },
        { start: 5, end: 10, text: 'Bí quyết quan trọng nhất trong lập trình là...' },
        { start: 10, end: 15, text: 'Chúng ta chuyển sang phần tiếp theo nhé' }
      ],
      keywords: ['bí quyết', 'quan trọng']
    })

    assert.equal(edl.segments.length, 3)
    // Segment 0: filler words -> penalized
    assert.equal(edl.segments[0].reason, 'filler-word')
    assert.equal(edl.segments[0].hasFillerWords, true)
    assert.ok(edl.segments[0].score < 0.5)

    // Segment 1: highlight keywords -> boosted
    assert.equal(edl.segments[1].reason, 'highlight')
    assert.equal(edl.segments[1].isHighlight, true)
    assert.ok(edl.segments[1].score > 0.7)
    assert.deepEqual(edl.segments[1].matchedKeywords, ['bí quyết', 'quan trọng'])

    // Segment 2: regular speech
    assert.equal(edl.segments[2].reason, 'speech')
  })

  // ===== AI content-triage blend (docs §194) ================================

  it('blendSceneInterest weights by overlap and returns null without data', () => {
    const half = blendSceneInterest({ start: 0, end: 10 }, [{ start: 0, end: 5, interest: 1 }])
    // Interest counted ONLY over the 5s overlap → mean 1 there, but the
    // beat weight is overlap-based, so full-scene mean over beats covered:
    assert.equal(half, 1)
    const mid = blendSceneInterest({ start: 0, end: 10 }, [
      { start: 0, end: 5, interest: 0 },
      { start: 5, end: 10, interest: 1 }
    ])
    assert.equal(mid, 0.5)
    assert.equal(blendSceneInterest({ start: 0, end: 10 }, []), null)
    assert.equal(blendSceneInterest({ start: 0, end: 10 }, [{ start: 20, end: 30, interest: 1 }]), null)
    // malformed items are skipped, never NaN
    assert.equal(blendSceneInterest({ start: 0, end: 10 }, [{ start: 0, end: 5, interest: 'x' }]), null)
  })

  it('aiScores pull the score toward AI interest by aiWeight', () => {
    // Partial speech coverage keeps the LOCAL score below 1 (a fully
    // covered scene already maxes out — nothing to pull toward).
    const base = scoreSegments({
      assetId: 'a1', profile: 'podcast-summary',
      scenes: [{ start: 0, end: 10 }], silences: [], speech: [{ start: 0, end: 8 }]
    })
    const boosted = scoreSegments({
      assetId: 'a1', profile: 'podcast-summary',
      scenes: [{ start: 0, end: 10 }], silences: [], speech: [{ start: 0, end: 8 }],
      aiScores: [{ start: 0, end: 10, interest: 1 }]
    })
    const local = base.segments[0].score
    const mixed = boosted.segments[0].score
    // Contract: blended = max(0.05, score + (1 - score) * 0.25), rounded
    // from the UNROUNDED local score, so compare against that formula.
    const rawLocal = 0.15 + 0.8 * 0.85
    assert.equal(mixed, Math.max(0.05, Math.round((rawLocal + (1 - rawLocal) * 0.25) * 1000) / 1000))
    assert.equal(boosted.segments[0].aiInterest, 1)
    assert.ok(mixed > local && mixed <= 1)
    // Without aiScores the segment has NO aiInterest field (honesty rule).
    assert.equal('aiInterest' in base.segments[0], false)
  })

  it('aiWeight 0 disables the blend and no-overlap segments keep local scores', () => {
    const plain = scoreSegments({
      assetId: 'a1', profile: 'viral-shorts',
      scenes: [{ start: 0, end: 5 }, { start: 20, end: 25 }],
      aiScores: [{ start: 0, end: 5, interest: 1 }], aiWeight: 0
    })
    assert.equal('aiInterest' in plain.segments[0], false)
    const partial = scoreSegments({
      assetId: 'a1', profile: 'viral-shorts',
      scenes: [{ start: 0, end: 5 }, { start: 20, end: 25 }],
      aiScores: [{ start: 0, end: 5, interest: 1 }]
    })
    assert.equal(partial.segments[0].aiInterest, 1)
    assert.equal('aiInterest' in partial.segments[1], false)
  })

  it('AI interest softens toward 0 but never undoes a filler penalty upward', () => {
    const edl = scoreSegments({
      assetId: 'a1', profile: 'podcast-summary',
      scenes: [{ start: 0, end: 5 }], silences: [],
      transcript: [{ start: 0, end: 5, text: 'ừm ờ thì kiểu như là ừm ờ' }],
      aiScores: [{ start: 0, end: 5, interest: 1 }]
    })
    assert.equal(edl.segments[0].reason, 'filler-word')
    // min() guard: an AI "interesting!" opinion must not lift a filler seg.
    assert.ok(edl.segments[0].score < 0.5)
    assert.equal(edl.segments[0].aiInterest, 1)
  })
})
