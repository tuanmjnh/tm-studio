// =============================================================================
//  @tmcut/core — waveform
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
