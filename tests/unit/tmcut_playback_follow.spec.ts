/**
 * The preview may only correct the element while it can present, and the
 * playhead must follow the picture when it cannot (playback stall slice A1/A2).
 *
 * Measured before the law existed: with the 1080p30 fixture served slower than
 * real time, the old loop wrote `currentTime` on essentially every tick (40
 * seeks in 12 s), `readyState` stayed at 1, and the buffered end froze at 0.8 s
 * while the wall-clock playhead ran on to 12 s. Removing the seek law let the
 * same source grow its buffer 3.0 → 6.7 s and recover by itself. The file,
 * codec and Range serving were proven healthy in the same session (a bare
 * element decoded it at 30 fps with 0 drops).
 *
 * So the two rules pinned here are the ones that were missing:
 *  * no `currentTime` write unless the element is presenting and not seeking;
 *  * while it is not, the playhead sits on the picture instead of the clock;
 *  * and a picture frozen past the budget is a stall, not "buffering".
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_playback_follow.spec.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  planPlaybackFollow,
  TMCUT_PLAYBACK_DRIFT_TOLERANCE_SEC,
  TMCUT_PLAYBACK_PRESENTING_READY_STATE,
  TMCUT_PLAYBACK_STALL_LIMIT_MS
} from 'tmcut-core'

const HAVE_METADATA = 1
const HAVE_CURRENT_DATA = 2
const HAVE_FUTURE_DATA = TMCUT_PLAYBACK_PRESENTING_READY_STATE

describe('planPlaybackFollow — the corrective seek', () => {
  it('seeks when a presenting element has fallen outside the tolerance', () => {
    const plan = planPlaybackFollow({ targetSec: 5, elementSec: 4.5, readyState: HAVE_FUTURE_DATA })
    assert.equal(plan.action, 'seek')
    assert.equal(plan.playheadSec, 5, 'a legal seek lands on the timeline position')
  })

  it('leaves a presenting element inside the tolerance alone', () => {
    const plan = planPlaybackFollow({ targetSec: 5, elementSec: 5.1, readyState: HAVE_FUTURE_DATA })
    assert.equal(plan.action, 'follow')
    assert.equal(plan.playheadSec, 5)
  })

  it('never seeks an element that cannot present, however far it trails', () => {
    for (const readyState of [0, HAVE_METADATA, HAVE_CURRENT_DATA]) {
      const plan = planPlaybackFollow({ targetSec: 12, elementSec: 0.8, readyState })
      assert.equal(plan.action, 'hold',
        `readyState ${readyState} has no future frame — a seek here aborts the load that would fill the buffer`)
      assert.equal(plan.playheadSec, 0.8,
        `readyState ${readyState}: the playhead must sit on the picture, not run ahead of it`)
      assert.equal(plan.reason, 'no-future-data')
    }
  })

  it('never writes during a seek that is already running', () => {
    const plan = planPlaybackFollow({ targetSec: 9, elementSec: 3, readyState: HAVE_FUTURE_DATA, seeking: true })
    assert.equal(plan.action, 'hold', 'a second write aborts the seek in flight')
    assert.equal(plan.playheadSec, 3)
    assert.equal(plan.reason, 'seeking')
  })

  it('is not distracted by the tolerance while a seek is running', () => {
    const plan = planPlaybackFollow({ targetSec: 9, elementSec: 8.99, readyState: HAVE_FUTURE_DATA, seeking: true })
    assert.equal(plan.action, 'hold', 'in-sync or not, the element is busy')
  })
})

describe('planPlaybackFollow — the frozen picture', () => {
  it('reports a stall once the picture has been frozen for the whole budget', () => {
    const plan = planPlaybackFollow({
      targetSec: 20, elementSec: 0.8, readyState: HAVE_METADATA, frozenMs: TMCUT_PLAYBACK_STALL_LIMIT_MS
    })
    assert.equal(plan.action, 'stalled')
    assert.equal(plan.reason, 'frozen-past-budget')
    assert.equal(plan.playheadSec, 0.8, 'a stalled preview must not claim to have advanced')
  })

  it('still says hold, not stalled, before the budget is spent', () => {
    const plan = planPlaybackFollow({
      targetSec: 20, elementSec: 0.8, readyState: HAVE_METADATA, frozenMs: TMCUT_PLAYBACK_STALL_LIMIT_MS - 1
    })
    assert.equal(plan.action, 'hold', 'a slow fetch is not a failure yet')
  })

  it('a frozen element that is still presenting is still a stall', () => {
    // A decoder that stopped delivering keeps `readyState` at 4 in some cases;
    // the movement of the picture, not the state enum, is the honest signal.
    const plan = planPlaybackFollow({
      targetSec: 20, elementSec: 9, readyState: HAVE_FUTURE_DATA, frozenMs: TMCUT_PLAYBACK_STALL_LIMIT_MS
    })
    assert.equal(plan.action, 'stalled')
  })
})

describe('planPlaybackFollow — defaults and hostile input', () => {
  it('publishes the tolerance the old law used, so this is a fix and not a retune', () => {
    assert.equal(TMCUT_PLAYBACK_DRIFT_TOLERANCE_SEC, 0.3)
  })

  it('treats a missing element reading as zero, never as NaN', () => {
    const plan = planPlaybackFollow({ targetSec: 3, readyState: HAVE_FUTURE_DATA })
    assert.equal(plan.action, 'seek')
    assert.equal(plan.playheadSec, 3)
    assert.ok(Number.isFinite(plan.playheadSec))
  })

  it('an unknown readyState is treated as unable to present', () => {
    const plan = planPlaybackFollow({ targetSec: 3, elementSec: 0, readyState: undefined })
    assert.equal(plan.action, 'hold')
  })

  it('a negative element position is clamped to the start', () => {
    const plan = planPlaybackFollow({ targetSec: 0, elementSec: -2, readyState: HAVE_FUTURE_DATA })
    assert.equal(plan.playheadSec, 0)
  })
})
