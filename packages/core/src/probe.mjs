// =============================================================================
//  @tmcut/core — probe
//  Pure ffprobe output normalization (docs Phase 3: FFprobe adapter,
//  metadata). Execution (spawning ffprobe) stays in the runtime adapter;
//  this module turns raw JSON into MediaMetadata deterministically.
// =============================================================================

function toPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** Parse an ffprobe avg_frame_rate string ("30000/1001", "25", "0/0"). */
export function parseFrameRate(raw) {
  if (typeof raw !== 'string') return 0
  const text = raw.trim()
  if (text.includes('/')) {
    const [numerator, denominator] = text.split('/')
    const num = Number(numerator)
    const den = Number(denominator)
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0 && num > 0) return num / den
    return 0
  }
  return toPositiveNumber(text)
}

/**
 * Normalize `ffprobe -print_format json -show_format -show_streams` output
 * to { durationSec, width, height, fps, hasAudio }. Returns null when the
 * payload carries no usable stream or format info.
 */
export function normalizeProbe(payload) {
  if (!payload || typeof payload !== 'object') return null
  const streams = Array.isArray(payload.streams) ? payload.streams : []
  const video = streams.find(stream => stream?.codec_type === 'video')
  const audio = streams.find(stream => stream?.codec_type === 'audio')
  const duration = toPositiveNumber(payload.format?.duration)
  if (!video && !audio && duration === 0) return null
  return {
    durationSec: duration,
    width: toPositiveNumber(video?.width),
    height: toPositiveNumber(video?.height),
    fps: parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    hasAudio: !!audio
  }
}
