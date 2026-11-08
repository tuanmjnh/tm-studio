// =============================================================================
//  tmcut-core — cache
//  Portable cache-key builder (docs Phase 3: cache, section 27).
//  Zero dependencies: FNV-1a instead of node:crypto so keys compute
//  identically in Electron, Web workers and plain node. Slice J retired the
//  FFmpeg proxy-argument planner: the preview decodes the source directly.
// =============================================================================

import { mediaFileKey } from './media.mjs'

/** FNV-1a 32-bit hash rendered as 8 hex chars. */
export function fnv1aHex(text) {
  const input = String(text ?? '')
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Portable cache key for a media file revision.
 * Same file + same mtime + same size always yields the same key.
 * The `v2:` prefix marks the filmstrip thumbnail format
 * (8 frames spread across the source): bump it whenever the
 * derived-artifact format changes so stale caches regenerate.
 */
export function cacheKeyForPath(path, revision = {}) {
  const normalized = mediaFileKey(path)
  const mtime = Number.isFinite(revision.mtimeMs) ? revision.mtimeMs : 0
  const size = Number.isFinite(revision.size) ? revision.size : 0
  return `${fnv1aHex(`v2:${normalized}:${mtime}:${size}`)}`
}

/** Cache file path for a derived artifact (thumbnail/waveform). */
export function cachePathFor(cacheDir, kind, key, extension) {
  const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${String(cacheDir).replace(/\/+$/, '')}/${kind}-${safeKey}.${extension}`
}
