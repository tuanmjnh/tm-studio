// tmcut-core — decoder-side detection laws (zero-FFmpeg slice E1). Run:
// node --test "test/*.test.mjs"
//
// Slice B/C/D proved a container can be read and a frame can be drawn on both
// hosts. Slice E asks what those pixels and samples MEAN: where the camera
// cuts, and where the track is quiet. Both laws must be pure numbers in here —
// the app is only allowed to hand over a luma grid and a PCM window, never to
// decide a threshold — because AutoCut's EDL must come out the same in a
// browser and in Electron.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  TMCUT_SCENE_THRESHOLD,
  TMCUT_SILENCE_NOISE_DB,
  TMCUT_SILENCE_MIN_DURATION_SEC,
  TMCUT_SILENCE_WINDOW_SEC,
  TMCUT_SILENCE_FLOOR_DBFS,
  sceneSampleTimes,
  sceneScore,
  cutsToShots,
  dbfsOf,
  peakLevelSeries,
  silenceSpans
} from '../src/detection.mjs'
import { filmstripTimes, secToTicks, ticksToSec } from '../src/index.mjs'

describe('detection (slice E)', () => {
  it('sceneSampleTimes is the C14 strip law at the scene rate, not a new sampling maths', () => {
    const start = secToTicks(2)
    const duration = secToTicks(10)
    const times = sceneSampleTimes(start, duration, 5)
    // 10 s at 5 looks per second = 50 samples, planned by the same function a
    // filmstrip uses, so a scene scan and a filmstrip never disagree about
    // which instants exist.
    assert.equal(times.length, 50)
    assert.deepEqual(times, filmstripTimes(start, duration, 50))
    // Uniform spacing (the scan is a rate, not a hunt for keyframes).
    const step = times[1] - times[0]
    for (let index = 2; index < times.length; index++) {
      assert.equal(times[index] - times[index - 1], step)
    }
    // Under one interval there is nothing to compare, so the scan says so.
    assert.deepEqual(sceneSampleTimes(0, secToTicks(0.1), 5), [])
    assert.deepEqual(sceneSampleTimes(0, 0, 5), [])
    assert.deepEqual(sceneSampleTimes(0, secToTicks(10), 0), [])
  })

  it('sceneScore is the mean luma change of two grids, normalised to 0..1 (not FFmpeg scene scale)', () => {
    const flat = new Uint8Array(64).fill(128)
    assert.equal(sceneScore(flat, flat), 0)
    const black = new Uint8Array(64).fill(0)
    const white = new Uint8Array(64).fill(255)
    assert.equal(sceneScore(black, white), 1)
    // Half the cells flip across the whole range → 0.5 * 1.
    const first = new Uint8Array(4).fill(0)
    const second = new Uint8Array([255, 255, 0, 0])
    assert.equal(sceneScore(first, second), 0.5)
    // Order does not matter: a cut is a change, not a direction.
    assert.equal(sceneScore(second, first), 0.5)
  })

  it('sceneScore refuses to invent a number for grids that are not comparable', () => {
    const grid = new Uint8Array(4).fill(10)
    assert.equal(sceneScore(grid, new Uint8Array(17).fill(10)), null, 'different cell counts')
    assert.equal(sceneScore(grid, []), null, 'an empty grid')
    assert.equal(sceneScore(grid, [10, 10, 10, Number.NaN]), null, 'a hole in the pixels')
  })

  it('cutsToShots turns cut instants into the shot list the scorer eats', () => {
    const shots = cutsToShots([2.5, 6], 10)
    assert.deepEqual(shots, [
      { start: 0, end: 2.5 },
      { start: 2.5, end: 6 },
      { start: 6, end: 10 }
    ])
    // Unsorted input still walks the timeline in order, and a cut at or past
    // the end is not a shot boundary.
    assert.deepEqual(cutsToShots([6, 2.5, 10, 12], 10), shots)
    // A shot shorter than the floor is dropped rather than kept as a flash.
    assert.deepEqual(cutsToShots([0.1, 4], 10), [{ start: 0.1, end: 4 }, { start: 4, end: 10 }])
    // Two cuts inside the debounce window are ONE cut — a hard cut decoded at
    // 5 Hz shows up on neighbouring samples, and AutoCut must not gain a shot.
    assert.deepEqual(cutsToShots([3, 3.02, 7], 10), [
      { start: 0, end: 3 },
      { start: 3, end: 7 },
      { start: 7, end: 10 }
    ])
    // No duration known: the tail closes on the last cut, never on a guess.
    assert.deepEqual(cutsToShots([4], 0), [{ start: 0, end: 4 }])
    assert.deepEqual(cutsToShots([], 8), [{ start: 0, end: 8 }])
    assert.deepEqual(cutsToShots([], 0), [])
  })

  it('dbfsOf reports level the way the silencedetect defaults are worded', () => {
    assert.equal(dbfsOf(1), 0)
    assert.equal(dbfsOf(0.5), -6.02)
    // Digital silence has no log; it gets the floor, not -Infinity, so a span
    // can still be compared to a threshold in dB.
    assert.equal(dbfsOf(0), TMCUT_SILENCE_FLOOR_DBFS)
    assert.equal(dbfsOf(-0.25), TMCUT_SILENCE_FLOOR_DBFS)
    assert.equal(dbfsOf(Number.NaN), TMCUT_SILENCE_FLOOR_DBFS)
  })

  it('peakLevelSeries measures one level per window, including the short last one', () => {
    const rate = 100
    const loud = new Float32Array(rate).fill(1)
    const quiet = new Float32Array(rate).fill(0)
    const tail = new Float32Array(25).fill(0)
    // 1 s loud, 1 s quiet, 0.25 s quiet: five 0.5 s windows, the last one short.
    const series = peakLevelSeries([...loud, ...quiet, ...tail], rate, 0.5)
    assert.equal(series.length, 5)
    assert.deepEqual(series, [0, 0, TMCUT_SILENCE_FLOOR_DBFS, TMCUT_SILENCE_FLOOR_DBFS, TMCUT_SILENCE_FLOOR_DBFS])
    // Nothing to measure answers with nothing, not a zero level.
    assert.deepEqual(peakLevelSeries([], rate, 0.5), [])
    assert.deepEqual(peakLevelSeries(loud, 0, 0.5), [])
  })

  it('silenceSpans keeps runs that are long enough and drops ones that are not', () => {
    const windowSec = 0.5
    // 2 s of speech, 1.5 s quiet, speech, then quiet to the end.
    const levels = [0, 0, 0, 0, -50, -50, -50, 0, 0, -60, -60]
    const spans = silenceSpans(levels, { windowSec, noiseDb: -30, minDurationSec: 0.5, durationSec: 5.5 })
    assert.deepEqual(spans, [
      { start: 2, end: 3.5 },
      { start: 4.5, end: 5.5 }
    ])
    // A dip shorter than the floor is not silence.
    assert.deepEqual(
      silenceSpans([0, -50, 0], { windowSec, noiseDb: -30, minDurationSec: 1.5, durationSec: 1.5 }),
      []
    )
    // At or below the threshold counts as quiet — the threshold is inclusive,
    // which is what "-30dB" means to the pipeline that scored every AutoCut so far.
    assert.deepEqual(
      silenceSpans([-30], { windowSec, noiseDb: -30, minDurationSec: 0.5, durationSec: 0.5 }),
      [{ start: 0, end: 0.5 }]
    )
    // A level we could not compute is not silence either.
    assert.deepEqual(
      silenceSpans([Number.NaN, -60, -60], { windowSec, noiseDb: -30, minDurationSec: 0.5, durationSec: 1.5 }),
      [{ start: 0.5, end: 1.5 }]
    )
  })

  it('the calibrated numbers are one number for both hosts', () => {
    // Both of these are MEASURED, not inherited — docs/audit/zero-ffmpeg-audit.md
    // carries the scene band and the real-voice silence table. They are pinned
    // here because a drift of a few hundredths re-cuts every EDL in silence.
    // The FFmpeg argv builder that carried its own 0.4 on its own scale was
    // deleted with the engine (slice I), so this is the only threshold left.
    assert.equal(TMCUT_SCENE_THRESHOLD, 0.18)
    assert.equal(TMCUT_SILENCE_NOISE_DB, -30)
    assert.equal(TMCUT_SILENCE_MIN_DURATION_SEC, 0.5)
    assert.equal(TMCUT_SILENCE_WINDOW_SEC, 0.02)
    assert.ok(TMCUT_SILENCE_FLOOR_DBFS < TMCUT_SILENCE_NOISE_DB,
      'the floor has to be quieter than the quietest thing we call silence')
  })

  it('levels and spans survive the tick/second boundary they cross in the app', () => {
    // The scan is planned in ticks and the EDL is written in seconds, so the
    // law is fed seconds; a round-trip must not move a span by a millisecond.
    const durationSec = 3
    const levels = [-60, -60, -60, -60, -60, -60]
    const spans = silenceSpans(levels, {
      windowSec: 0.5, noiseDb: -30, minDurationSec: 0.5, durationSec
    })
    assert.deepEqual(spans, [{ start: 0, end: 3 }])
    assert.equal(ticksToSec(secToTicks(spans[0].end)), 3)
  })
})
