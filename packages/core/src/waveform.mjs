// =============================================================================
//  tmcut-core — waveform
//  Ported from app/utils/tmcut/waveform.ts. Reduces raw PCM magnitudes to
//  normalized 0..1 peak buckets for timeline rendering.
// =============================================================================

/** Reduce a sample array to `buckets` normalized peaks. */
export function int16ToPeaks(samples, buckets = 200) {
  const count = Math.max(1, Math.floor(buckets))
  const out = new Array(count).fill(0)
  const total = samples?.length ?? 0
  if (total === 0) return out
  const per = total / count
  for (let b = 0; b < count; b += 1) {
    const start = Math.floor(b * per)
    const end = Math.min(total, Math.floor((b + 1) * per))
    let max = 0
    for (let i = start; i < end; i += 1) {
      const v = Math.abs(samples[i] || 0)
      if (v > max) max = v
    }
    out[b] = Math.min(1, max / 32768)
  }
  return out
}

/** Clamp arbitrary bucket input to finite 0..1 points. */
export function clampWaveformPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return []
  return points.map((p) => {
    if (!Number.isFinite(p)) return 0
    return Math.min(1, Math.max(0, p))
  })
}

/**
 * What the bars in a stored waveform MEAN. A cached artifact has to outlive the
 * version that wrote it, so the metric travels with the numbers and a reader that
 * does not recognise the stamp re-decodes instead of drawing the wrong bars.
 * `peak-v1` = the loudest sample of each bucket, on the 0..1 full-scale range.
 */
export const TMCUT_WAVEFORM_ALGORITHM = 'peak-v1'

/** How fine the stored bars are — enough for a timeline, small enough to cache. */
export const TMCUT_WAVEFORM_PEAK_PRECISION = 3

const PEAK_FACTOR = 10 ** TMCUT_WAVEFORM_PEAK_PRECISION

function roundPeak(value) {
  const magnitude = value < 0 ? -value : value
  return Math.round(Math.min(1, magnitude) * PEAK_FACTOR) / PEAK_FACTOR
}

/**
 * One bucket of full-scale peaks per channel-list, measured on the scale
 * `decodePcm` returns (Float32, −1..1).
 *
 * `int16ToPeaks` divides by 32768 because FFmpeg's `-f s16le` pipe fed it; the
 * decoder path that replaced the pipe hands it −1..1 and that reducer draws a flat
 * line. Same bucketing law, different scale.
 *
 * Channels fold by the LOUDEST one — the timeline shows how loud the file gets, so
 * averaging or taking the energy of a hot-left / silent-right pair would understate
 * it. That is the same fold `loudestPeakSeries` applies to dBFS levels. A channel
 * that was not delivered or is empty is skipped rather than scored as silence; a
 * channel that was delivered and measurable nothing gets 0, which is what a
 * decoder that returned zeros owes.
 */
export function floatPeakBuckets(channels, buckets = 200) {
  const requested = Math.floor(Number(buckets))
  const count = Number.isFinite(requested) && requested >= 1 ? requested : 1
  const out = new Array(count).fill(0)
  const list = Array.isArray(channels) ? channels : Array.from(channels ?? [])
  for (const channel of list) {
    const total = channel?.length ?? 0
    if (total === 0) continue
    const per = total / count
    for (let b = 0; b < count; b += 1) {
      const start = Math.floor(b * per)
      const end = Math.min(total, Math.floor((b + 1) * per))
      let peak = 0
      for (let i = start; i < end; i += 1) {
        const sample = Number(channel[i])
        if (!Number.isFinite(sample)) continue
        const magnitude = sample < 0 ? -sample : sample
        if (magnitude > peak) peak = magnitude
      }
      if (peak > out[b]) out[b] = peak > 1 ? 1 : peak
    }
  }
  return out.map(roundPeak)
}

function peaksOf(value) {
  if (Array.isArray(value)) return value
  if (ArrayBuffer.isView(value)) return Array.from(value)
  return null
}

function wholeNumber(value) {
  return Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The compact record a waveform is cached as.
 *
 * Returns null for input that is not a waveform, which is how a failed decode
 * stays out of the cache: `ok:true` with zero bars (what the FFmpeg controller
 * wrote when its extract died) is indistinguishable from a silent file on re-read,
 * so the panel drew silence for a file it never opened. Three states survive here —
 * silent bars at 0 with a channel count, no audio track as `channelCount: 0`, and
 * nothing stored at all when the decoder said no.
 */
export function buildWaveformPayload(input) {
  if (!input || typeof input !== 'object') return null
  const bars = peaksOf(input.peaks)
  if (bars === null || bars.length === 0) return null
  const peaks = bars.map(Number)
  if (peaks.some(p => !Number.isFinite(p))) return null
  const durationSec = Number(input.durationSec)
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null
  const channelCount = wholeNumber(Number(input.channelCount))
  const sampleRate = wholeNumber(Number(input.sampleRate))
  if (channelCount === null || sampleRate === null) return null
  return Object.freeze({
    algorithm: TMCUT_WAVEFORM_ALGORITHM,
    durationSec,
    sampleRate,
    channelCount,
    bucketCount: peaks.length,
    peaks: Object.freeze(peaks.map(roundPeak))
  })
}

/**
 * Read a cached waveform back, or say it is not one.
 *
 * An unknown `algorithm` is null, not a guess: bars measured by a different metric
 * are not these bars. A finite bar outside 0..1 is clamped rather than thrown away,
 * because one corrupted number is not a reason to re-decode the whole file.
 */
export function readWaveformPayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.algorithm !== TMCUT_WAVEFORM_ALGORITHM) return null
  const payload = buildWaveformPayload(value)
  if (payload === null) return null
  if (Number(value.bucketCount) !== payload.bucketCount) return null
  return payload
}
