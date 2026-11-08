// Strangler (roadmap Phase 1): canonical implementations live in tmcut-core
// (pure, unit-tested, 32 tests). This module preserves existing import paths.
export {
  normalizeMediaPath,
  mediaFileKey,
  mediaFileName,
  extensionOf,
  classifyAssetKind,
  formatDurationSec,
  formatFileSize
} from 'tmcut-core'

/**
 * A stored locator as a URL a surface can paint or play.
 *
 * Already-addressable inputs pass through untouched (`media:`, `http(s):`,
 * `data:`, `blob:` and the web runtime's `/uploads/…`). A `file://` URL or a
 * bare absolute path becomes `media://local?file=…`, the privileged Electron
 * scheme that serves local bytes with CORS for the app's own origins.
 */
export function toURL(path: string | null | undefined): string {
  if (!path) return ''
  if (/^(media:|https?:|data:|blob:|\/uploads\/)/.test(path)) return path
  if (/^file:\/\//.test(path)) {
    const raw = path.replace(/^file:\/\//, '')
    try {
      const decoded = decodeURIComponent(raw)
      const normalized = decoded.replace(/^\/+([a-zA-Z]:)/, '$1')
      return `media://local?file=${encodeURIComponent(normalized)}`
    } catch {
      return path
    }
  }
  const normalized = path.replace(/\\/g, '/')
  return `media://local?file=${encodeURIComponent(normalized)}`
}
