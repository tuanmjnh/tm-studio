// =============================================================================
//  tmcut-core — detection
//  What decoded media MEANS, as pure numbers (zero-FFmpeg slice E). AutoCut has
//  always asked FFmpeg two questions — where does the camera cut, and where is
//  the track quiet — then parsed the answer out of stderr text. Slices B/C/D
//  proved both hosts can read a container and draw a frame of it, so the same
//  two questions can now be asked of the samples themselves. This module owns
//  the threshold, the sampling rate, the shot floor and the dB scale; the app
//  hands over a luma grid and a PCM window and never decides anything.
//
//  Seconds in, seconds out, exactly like the stderr readers this replaces,
//  because the EDL is written in seconds and only becomes ticks at the store
//  boundary (edl.mjs).
// =============================================================================

import { filmstripTimes } from './frames.mjs'
import { ticksToSec } from './time.mjs'

/** AutoCut's cut score, unchanged from the FFmpeg pass this replaces. */
export const TMCUT_SCENE_THRESHOLD = 0.4
/** Looks per second a shot can be found at. A cut is missed between samples. */
export const TMCUT_SCENE_SAMPLE_HZ = 5
/** Quiet, in dBFS — the same number `silencedetect=noise=` was fed. */
export const TMCUT_SILENCE_NOISE_DB = -30
/** How long quiet has to last to count, and how wide one level window is. */
export const TMCUT_SILENCE_MIN_DURATION_SEC = 0.5
/** Digital silence has no logarithm; it gets this instead of -Infinity. */
export const TMCUT_SILENCE_FLOOR_DBFS = -120

/** Two cuts closer than this are one cut (decode jitter, not a new shot). */
const SHOT_MIN_GAP_SEC = 0.04
/** A shot shorter than this is dropped rather than offered as a flash. */
const SHOT_MIN_LENGTH_SEC = 0.2

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function round2(value) {
  return Math.round(value * 100) / 100
}

function round3(value) {
  return Math.round(value * 1000) / 1000
}

function round4(value) {
  return Math.round(value * 10000) / 10000
}

function optionNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * The instants a scene scan looks at, in timeline ticks: `sampleHz` evenly
 * spaced samples across the span, planned by the same C14 strip law a
 * filmstrip uses (edge guard included). Deliberately not its own maths — two
 * samplers would put the desktop's cuts and the browser's cuts at different
 * instants, and nobody would see the difference on screen.
 */
export function sceneSampleTimes(startTicks, durationTicks, sampleHz = TMCUT_SCENE_SAMPLE_HZ) {
  if (!isFiniteNumber(sampleHz) || sampleHz <= 0) return []
  if (!isFiniteNumber(startTicks) || !isFiniteNumber(durationTicks) || durationTicks <= 0) return []
  const count = Math.floor(ticksToSec(durationTicks) * sampleHz)
  return filmstripTimes(startTicks, durationTicks, count)
}

/**
 * How much two frames of the same span differ, as a 0..1 score: the mean
 * absolute change over the luma cells. Comparable grids only — a different
 * cell count or a hole in either answer is not a small change, it is no
 * information, so it comes back null and the caller drops the pair instead of
 * recording a cut at 0.
 */
export function sceneScore(previous, next) {
  const a = previous
  const b = next
  const length = a?.length ?? 0
  if (length === 0 || b?.length !== length) return null
  let total = 0
  for (let index = 0; index < length; index++) {
    const left = Number(a[index])
    const right = Number(b[index])
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null
    total += Math.abs(left - right)
  }
  return round4(total / length / 255)
}

/**
 * Cut instants (seconds) to the shot list the scorer eats: sorted, debounced
 * by `minGapSec`, ending at `durationSec` — or at the last cut when no
 * duration is known, which is the honest answer rather than a guessed one.
 * Shots under `minShotSec` are dropped.
 */
export function cutsToShots(cutSeconds, durationSec, options = {}) {
  const minGap = optionNumber(options.minGapSec, SHOT_MIN_GAP_SEC)
  const minShot = optionNumber(options.minShotSec, SHOT_MIN_LENGTH_SEC)
  const duration = isFiniteNumber(durationSec) && durationSec > 0 ? durationSec : 0
  const raw = Array.isArray(cutSeconds) ? cutSeconds.slice() : []
  raw.sort((left, right) => Number(left) - Number(right))
  const cuts = [0]
  for (const value of raw) {
    const time = Number(value)
    if (!Number.isFinite(time) || time <= 0) continue
    if (duration > 0 && time >= duration) continue
    if (time > cuts[cuts.length - 1] + minGap) cuts.push(time)
  }
  const end = duration > 0 ? duration : cuts[cuts.length - 1]
  const shots = []
  for (let index = 0; index < cuts.length; index++) {
    const start = cuts[index]
    const stop = index + 1 < cuts.length ? cuts[index + 1] : end
    if (stop - start >= minShot) shots.push({ start: round3(start), end: round3(stop) })
  }
  return shots
}

/** Root-mean-square of one window of PCM, as dBFS. */
export function dbfsOf(rms) {
  const value = Number(rms)
  if (!Number.isFinite(value) || value <= 0) return TMCUT_SILENCE_FLOOR_DBFS
  return round2(20 * Math.log10(value))
}

/**
 * One dBFS level per `windowSec` of PCM, the tail window included even when
 * short. Non-numeric samples are ignored rather than counted as silence.
 */
export function levelSeries(samples, sampleRate, windowSec = TMCUT_SILENCE_MIN_DURATION_SEC) {
  const rate = Number(sampleRate)
  const window = Number(windowSec)
  const length = samples?.length ?? 0
  if (!Number.isFinite(rate) || rate <= 0 || !Number.isFinite(window) || window <= 0) return []
  if (length === 0) return []
  const size = Math.max(1, Math.round(rate * window))
  const levels = []
  for (let start = 0; start < length; start += size) {
    const stop = Math.min(start + size, length)
    let sum = 0
    let counted = 0
    for (let index = start; index < stop; index++) {
      const sample = Number(samples[index])
      if (!Number.isFinite(sample)) continue
      sum += sample * sample
      counted += 1
    }
    levels.push(counted > 0 ? dbfsOf(Math.sqrt(sum / counted)) : TMCUT_SILENCE_FLOOR_DBFS)
  }
  return levels
}

/**
 * Quiet runs from a level series: consecutive windows at or below `noiseDb`,
 * kept only when they last `minDurationSec` or longer, closed at `durationSec`.
 * The same shape the stderr reader produced, so nothing downstream has to
 * learn a new one.
 */
export function silenceSpans(levels, options = {}) {
  const windowSec = optionNumber(options.windowSec, TMCUT_SILENCE_MIN_DURATION_SEC)
  const noiseDb = optionNumber(options.noiseDb, TMCUT_SILENCE_NOISE_DB)
  const minDuration = optionNumber(options.minDurationSec, TMCUT_SILENCE_MIN_DURATION_SEC)
  const durationSec = Number(options.durationSec)
  const list = Array.isArray(levels) ? levels : Array.from(levels ?? [])
  if (windowSec <= 0 || minDuration <= 0 || list.length === 0) return []
  const limit = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : list.length * windowSec
  const spans = []
  let open = -1
  for (let index = 0; index <= list.length; index++) {
    const level = index < list.length ? Number(list[index]) : Number.POSITIVE_INFINITY
    const quiet = Number.isFinite(level) && level <= noiseDb
    if (quiet && open < 0) open = index
    if (!quiet && open >= 0) {
      const start = open * windowSec
      const stop = Math.min(index * windowSec, limit)
      if (stop - start >= minDuration) spans.push({ start: round3(start), end: round3(stop) })
      open = -1
    }
  }
  return spans
}
