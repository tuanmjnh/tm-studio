/**
 * Time-domain contract guard (roadmap C16).
 *
 * C16-R3 landed: the app store keeps clip time geometry in INTEGER
 * TICKS — the same domain the DSL/core works in. The dangerous seams
 * are now the DECODE points: helper accessors and `toRenderClip`
 * must return SECONDS (the UI/FFmpeg contract), while the store feeds
 * core through the TICKS bridge unchanged. A half-done flip (or a second
 * conversion somewhere) shows up here instead of as
 * `trim=start=240000` inside an FFmpeg graph.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_time_domain.spec.ts
 */
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND, secToTicks, ticksToSec, ticksClipToV3, v3ClipToTicks, v1ClipToV3 } from '@tmcut-core'
import { clipDurationSec, clipEndSec, clipStartSec, clipMediaTimeSec, clipSourceRange, clipDurationTicks, clipStartTicks, clipEndTicks } from '../../app/utils/tmcut/clipTime'
import { toRenderClip } from '../../app/utils/tmcut/render/clip'
import type { TmcutTimelineItem } from '../../app/composables/useTmcutProject'

let passed = 0

function check(label: string, fn: () => void) {
  fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** A store-shaped clip: TICKS domain, exactly what C16-R3 holds. */
function clip(patch: Partial<TmcutTimelineItem> = {}): TmcutTimelineItem {
  return {
    id: 'c1',
    src: 'a.mp4',
    in: 1 * TICKS_PER_SECOND,
    out: 5 * TICKS_PER_SECOND,
    offset: 2 * TICKS_PER_SECOND,
    speed: 1,
    opacity: 100,
    scale: 100,
    x: 0,
    y: 0,
    rotation: 0,
    ...patch
  } as TmcutTimelineItem
}

function main() {
  console.log('=== [TMCut Time-Domain Contract] Starting ===\n')

  check('store fields are TICKS — seconds accessors decode, never rescale raw values', () => {
    const c = clip()
    assert.equal(clipStartSec(c), 2)
    assert.equal(clipSourceRange(c), 4)
    assert.equal(clipDurationSec(c), 4)
    assert.equal(clipEndSec(c), 6)
    // The exact failure mode of a half-done flip: values scaled by 120000.
    assert.ok(clipDurationSec(c) < 1000, 'duration looks like ticks, not seconds')
    // …and the ticks API stays exact integers (no float seconds noise).
    assert.equal(clipStartTicks(c), 2 * TICKS_PER_SECOND)
    assert.equal(clipDurationTicks(c), 4 * TICKS_PER_SECOND)
    assert.equal(clipEndTicks(c), 6 * TICKS_PER_SECOND)
  })

  check('accessors match the tick math exactly, speed included', () => {
    for (const c of [clip(), clip({ speed: 2 }), clip({ speed: 0.5 }), clip({ in: 3.25 * TICKS_PER_SECOND, out: 9.75 * TICKS_PER_SECOND, offset: 1.5 * TICKS_PER_SECOND, speed: 1.5 })]) {
      const speed = c.speed || 1
      const expectedTicks = Math.max(1, Math.round((c.out - c.in) / speed))
      assert.equal(clipDurationTicks(c), expectedTicks)
      assert.equal(clipDurationSec(c), ticksToSec(expectedTicks))
      assert.equal(clipStartSec(c), ticksToSec(c.offset || 0))
      assert.equal(clipEndSec(c), ticksToSec(c.offset || 0) + ticksToSec(expectedTicks))
    }
  })

  check('media time stays in the seconds domain (playback seeks by seconds)', () => {
    assert.equal(clipMediaTimeSec(clip(), 2), 1) // start of clip -> source in
    assert.equal(clipMediaTimeSec(clip(), 4), 3) // +2s timeline -> +2s source
    // Reverse runs backwards from the source end (core C4 semantics).
    assert.equal(clipMediaTimeSec(clip({ reverse: true }), 2), 5)
    assert.equal(clipMediaTimeSec(clip({ reverse: true }), 3), 4)
  })

  check('toRenderClip DECODES ticks to SECONDS — export trim must not receive ticks', () => {
    const r = toRenderClip(clip({ in: TICKS_PER_SECOND, out: 5 * TICKS_PER_SECOND, offset: 2 * TICKS_PER_SECOND }))
    assert.equal(r.inSec, 1)
    assert.equal(r.outSec, 5)
    assert.equal(r.offsetSec, 2)
    assert.ok(r.inSec < 1000 && r.outSec < 1000, 'render clip looks like ticks')
    // durationTicks is the EXACT store-unit span (core audio takes it
    // through the v3 shape — never the flat legacy seconds branch).
    assert.equal(r.durationTicks, 4 * TICKS_PER_SECOND)
  })

  check('ticks bridge is an identity on the store unit and round-trips exactly', () => {
    const c = clip({ in: TICKS_PER_SECOND, out: 5 * TICKS_PER_SECOND, offset: 2 * TICKS_PER_SECOND })
    const v3 = ticksClipToV3(c, 'video')
    assert.equal(v3.source.in, TICKS_PER_SECOND)
    assert.equal(v3.source.out, 5 * TICKS_PER_SECOND)
    assert.equal(v3.timeline.start, 2 * TICKS_PER_SECOND)
    assert.equal(v3.timeline.duration, TICKS_PER_SECOND * 4)
    // Back through the ticks bridge gives the SAME integers — a core op
    // round-trip can never drift the untouched store (syncTicksResult
    // skips identical clips).
    const back = v3ClipToTicks(v3)
    assert.equal(back.in, TICKS_PER_SECOND)
    assert.equal(back.out, 5 * TICKS_PER_SECOND)
    assert.equal(back.offset, 2 * TICKS_PER_SECOND)
  })

  check('seconds bridge stays for file migration only — scales legacy values', () => {
    // A pre-C16-R3 file item: SECONDS in, ticks out (the migrate path).
    const legacy = { id: 'old', in: 1, out: 5, offset: 2, speed: 1 }
    const v3 = v1ClipToV3(legacy as never, 'video')
    assert.equal(v3.source.in, TICKS_PER_SECOND)
    assert.equal(v3.source.out, 5 * TICKS_PER_SECOND)
    assert.equal(v3.timeline.start, 2 * TICKS_PER_SECOND)
    // The same object through the TICKS bridge would stay raw integers —
    // pinning the two flavors apart (they must never be swapped).
    assert.equal(ticksClipToV3(legacy as never, 'video').source.in, 1)
  })

  check('seconds↔ticks helpers are exact inverses at frame boundaries', () => {
    for (const sec of [0, 0.5, 1, 2.5, 10, 59.94]) {
      assert.equal(ticksToSec(secToTicks(sec)), sec)
    }
    assert.equal(TICKS_PER_SECOND, 120000)
  })

  console.log(`\n=== All ${passed} time-domain checks passed ===`)
}

main()
