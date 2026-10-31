// =============================================================================
//  @tmcut/core — media
//  Ported from app/utils/tmcut/media.ts. Pure path/classify/format helpers.
// =============================================================================

const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'ts', 'wmv', 'flv']
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'wma', 'opus']
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif']

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
