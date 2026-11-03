// =============================================================================
//  tmcut-core — media
//  Ported from app/utils/tmcut/media.ts. Pure path/classify/format helpers.
// =============================================================================

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'wmv', 'flv']
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus']
// `svg` is here because the render binary really does decode it: the vendored
// FFmpeg is built `--enable-librsvg`, and `ffprobe x.svg` reports
// codec=svg / 1 frame / duration N/A — the same still shape a PNG has. It is
// the ONE still whose decoder takes a raster size, which is what
// `isVectorStillImage` exists to say.
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif', 'svg']
// Extensions whose decoder accepts `-width`/`-height` to choose the raster.
// Any other decoder handed those options refuses the input outright.
const VECTOR_STILL_EXTS = ['svg']

export function normalizeMediaPath(input) {
  return String(input ?? '').trim().replace(/\\/g, '/')
}

export function mediaFileKey(input) {
  return normalizeMediaPath(input).toLowerCase()
}

export function mediaFileName(input) {
  const normalized = normalizeMediaPath(input)
  const parts = normalized.split('/')
  return parts[parts.length - 1] || normalized
}

export function extensionOf(input) {
  const base = mediaFileName(input)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 'video' | 'audio' | 'image' | null */
export function classifyAssetKind(input) {
  const ext = extensionOf(input)
  if (VIDEO_EXTS.includes(ext)) return 'video'
  if (AUDIO_EXTS.includes(ext)) return 'audio'
  if (IMAGE_EXTS.includes(ext)) return 'image'
  return null
}

/**
 * True when the path is a still the decoder draws from geometry rather than
 * pixels. Callers use it for one decision only: whether a raster size may be
 * handed to FFmpeg for this input.
 */
export function isVectorStillImage(input) {
  return VECTOR_STILL_EXTS.includes(extensionOf(input))
}

export function formatDurationSec(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1)
  return `${text} ${units[i]}`
}
