// =============================================================================
//  @tmcut/core — cache
//  Portable cache-key builder + proxy plan helpers (docs Phase 3: cache,
//  proxy; sections 27-28). Zero dependencies: FNV-1a instead of node:crypto
//  so keys compute identically in Electron, Web workers and plain node.
//  The Electron controller mirrors this scheme
//  (electron/tools/tmcut.controller.cjs — keep in sync).
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

/** Cache file path for a derived artifact (thumbnail/waveform/proxy). */
export function cachePathFor(cacheDir, kind, key, extension) {
  const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${String(cacheDir).replace(/\/+$/, '')}/${kind}-${safeKey}.${extension}`
}

/**
 * Pure ffmpeg argument plan for a preview proxy (small, fast to decode).
 * The runtime adapter executes it; the core only describes it.
 *
 * @param {string} input - Path to source video
 * @param {string} output - Target proxy file path (.mp4)
 * @param {number|{width?: number, crf?: number, fps?: number}} [options=960] - Target width or options object
 * @returns {string[]} FFmpeg argument list
 */
export function buildProxyArgs(input, output, options = 960) {
  const opts = typeof options === 'number' ? { width: options } : (options || {})
  const target = Math.max(320, Math.floor(opts.width ?? 960))
  const crf = String(opts.crf ?? 28)
  const vfFilters = [`scale=${target}:-2`]
  if (Number.isFinite(opts.fps) && opts.fps > 0) {
    vfFilters.push(`fps=${opts.fps}`)
  }
  return [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    input,
    '-vf',
    vfFilters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    crf,
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    output
  ]
}
