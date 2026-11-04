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

/**
 * The cut score AutoCut used with FFmpeg — a number on a DIFFERENT scale.
 * Measured on one hard cut (testsrc2 -> smptebars at 1.000 s): this grid score
 * tops out at 0.2626 while FFmpeg's `scene` reports 0.694299, and inside a shot
 * the two floors differ the same way (0.0261..0.0288 here, 0.0004..0.0112
 * there). Keeping the value keeps the name; it does not keep the behaviour, so
 * slice E4 calibrates it before this scan goes anywhere near a timeline.
 */
export const TMCUT_SCENE_THRESHOLD = 0.4
/**
 * Looks per second a shot can be found at. A cut is missed between samples, and
 * the error is half a period: on the same clip the 1.000 s cut was found at
 * 1.096 s at 5 Hz and 1.048 s at 10 Hz.
 */
export const TMCUT_SCENE_SAMPLE_HZ = 5
/** Quiet, in dBFS — the same number `silencedetect=noise=` was fed. */
export const TMCUT_SILENCE_NOISE_DB = -30
/** How long quiet has to last to count, and how wide one level window is. */
export const TMCUT_SILENCE_MIN_DURATION_SEC = 0.5
/** Digital silence has no logarithm; it gets this instead of -Infinity. */
export const TMCUT_SILENCE_FLOOR_DBFS = -120
/** Cells per side of the grid a shot score is computed on: 64 numbers per frame. */
export const TMCUT_SCENE_GRID_CELLS = 8

/** Two cuts closer than this are one cut (decode jitter, not a new shot). */
const SHOT_MIN_GAP_SEC = 0.04
/** A shot shorter than this is dropped rather than offered as a flash. */
const SHOT_MIN_LENGTH_SEC = 0.2
/** BT.601 luma, in channel order — the weights `lumaOf` is defined by. */
const LUMA_WEIGHTS = [0.299, 0.587, 0.114]

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
 * One pixel to one number. BT.601 weights, because that is the luma a shot
 * detector has always read (the FFmpeg `scene` filter works off Y too), and an
 * integer, because a grid of floats would make two hosts disagree in the last
 * decimal. A channel outside the byte range is clamped; a channel that is not a
 * number stays one, so a hole cannot quietly become a dark pixel.
 */
export function lumaOf(red, green, blue) {
  const channels = [red, green, blue]
  let total = 0
  for (let index = 0; index < 3; index++) {
    const raw = Number(channels[index])
    if (!Number.isFinite(raw)) return Number.NaN
    total += (raw < 0 ? 0 : raw > 255 ? 255 : raw) * LUMA_WEIGHTS[index]
  }
  return Math.round(total)
}

/**
 * The grid `sceneScore` compares: RGBA bytes of one frame, block-averaged to
 * `cells` per side, reading order, `cells * cells` long. The alpha channel is
 * not part of the question — a decoded video frame is what it is.
 *
 * Bad input answers `[]`, and so does a single non-numeric sample: a truncated
 * buffer or a hole is missing information, which the caller must drop rather
 * than read as a partial grid (that would be a cut score made up of zeros).
 */
export function lumaCells(rgba, width, height, cells = TMCUT_SCENE_GRID_CELLS) {
  const side = Number(cells)
  const columns = Number(width)
  const rows = Number(height)
  if (!Number.isInteger(side) || side <= 0) return []
  if (!Number.isInteger(columns) || columns <= 0) return []
  if (!Number.isInteger(rows) || rows <= 0) return []
  const length = rgba?.length ?? 0
  if (length < columns * rows * 4) return []

  const total = new Float64Array(side * side)
  const counted = new Float64Array(side * side)
  for (let y = 0; y < rows; y++) {
    const cellY = Math.floor((y * side) / rows)
    for (let x = 0; x < columns; x++) {
      const offset = (y * columns + x) * 4
      const luma = lumaOf(rgba[offset], rgba[offset + 1], rgba[offset + 2])
      if (!Number.isFinite(luma)) return []
      const slot = cellY * side + Math.floor((x * side) / columns)
      total[slot] += luma
      counted[slot] += 1
    }
  }
  const out = []
  for (let slot = 0; slot < total.length; slot++) out.push(round2(total[slot] / counted[slot]))
  return out
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
 * The pairs of a scan that are a cut, as the instants they happened at.
 *
 * Adjacent samples only. A sample the decoder lost breaks the chain rather than
 * bridging to the next usable one: bridging would report the change at the later
 * instant when it really happened somewhere in between, which is a cut placed on
 * a guess. Strictly greater than the threshold, because that is the comparison
 * the filter this replaces used (`select='gt(scene,X)'`).
 */
export function sceneCuts(times, grids, options = {}) {
  const threshold = optionNumber(options.threshold, TMCUT_SCENE_THRESHOLD)
  const instants = Array.isArray(times) ? times : []
  const series = Array.isArray(grids) ? grids : []
  if (instants.length < 2 || series.length < 2) return []
  const cuts = []
  for (let index = 1; index < instants.length; index++) {
    const at = Number(instants[index])
    if (!Number.isFinite(at)) continue
    const score = sceneScore(series[index - 1], series[index])
    if (score === null) continue
    if (score > threshold) cuts.push(round3(at))
  }
  return cuts
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
