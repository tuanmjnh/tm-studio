import { resolve, sep } from 'node:path'

/**
 * Web-runtime media upload helpers (shared by the upload endpoint and the
 * /uploads/** static route).
 *
 * The web runtime cannot reference local files like the Electron renderer
 * does (media:// protocol), so browser imports are POSTed to the Nitro
 * server and the stored copy is streamed back under /uploads/*. Asset
 * paths look like "/uploads/<id>-<name>.<ext>" and stay relative on
 * purpose — an absolute origin URL would break whenever the dev port or
 * host changes, while a relative path keeps working (toURL passes it
 * through unchanged, see app/utils/ffmpegHelper.ts).
 */

export type UploadKind = 'video' | 'audio' | 'image'

/** Mirrors the extension whitelist of @tmcut-core classifyAssetKind. */
export const UPLOAD_KIND_BY_EXT: Record<string, UploadKind> = {
  mp4: 'video', mov: 'video', mkv: 'video', webm: 'video', avi: 'video', m4v: 'video',
  mpg: 'video', mpeg: 'video', ts: 'video', wmv: 'video', flv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio', wma: 'audio', opus: 'audio',
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', bmp: 'image', tiff: 'image', tif: 'image', gif: 'image'
}

export function uploadKindForName(name: string): UploadKind | null {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  return UPLOAD_KIND_BY_EXT[ext] || null
}

export function uploadsContentTypeForName(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
  const map: Record<string, string> = {
    mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm',
    avi: 'video/x-msvideo', m4v: 'video/mp4', mpg: 'video/mpeg', mpeg: 'video/mpeg',
    ts: 'video/mp2t', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
    mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac',
    ogg: 'audio/ogg', flac: 'audio/flac', wma: 'audio/x-ms-wma', opus: 'audio/ogg',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    bmp: 'image/bmp', tiff: 'image/tiff', tif: 'image/tiff', gif: 'image/gif'
  }
  return map[ext] || 'application/octet-stream'
}

/**
 * Resolve the request path of the /uploads/** route against the uploads dir.
 * Returns null for anything that escapes the directory (traversal guard) or
 * names an extension we never uploaded — the server only ever serves
 * media it produced itself.
 */
export function resolveUploadFilePath(dir: string, segments: string[]): string | null {
  if (segments.length === 0) return null
  const decoded: string[] = []
  let kind: unknown = null
  for (const segment of segments) {
    let value: string
    try {
      value = decodeURIComponent(String(segment))
    } catch {
      return null
    }
    if (!value || value === '.' || value === '..' || value.startsWith('.') || value.includes('\\') || value.split('/').length > 1) {
      return null
    }
    kind = uploadKindForName(value) || kind
    decoded.push(value)
  }
  if (!kind) return null
  // Uploads are stored flat in the dir root — a single discriminated file
  // name with no sublevel. Nested segment lists never occur.
  if (decoded.length > 1) return null
  const root = resolve(dir)
  const target = resolve(root, ...decoded)
  if (!target.startsWith(root + sep)) return null
  return target
}

export interface UploadRange {
  start: number
  end: number
  /** True when the request carried a satisfiable Range header (HTTP 206). */
  partial: boolean
}

/**
 * Parse an HTTP `Range` header against `size`. Returns the full range when
 * no header is present, and null for a malformed/unsatisfiable header (the
 * route answers 416 in that case).
 */
export function parseUploadRange(header: string | undefined, size: number): UploadRange | null {
  const full: UploadRange = { start: 0, end: Math.max(0, size - 1), partial: false }
  if (size <= 0) return full
  if (!header) return full
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim())
  if (!match) return null
  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return null
  // suffix range: "bytes=-N" → last N bytes
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    const start = Math.max(0, size - suffix)
    return { start, end: size - 1, partial: true }
  }
  const start = Number(rawStart)
  if (!Number.isFinite(start) || start >= size) return null
  const end = rawEnd ? Number(rawEnd) : size - 1
  if (!Number.isFinite(end) || end < start) return null
  // RFC 7233: a byte-range ending past the file edge clamps, not 416.
  return { start, end: Math.min(end, size - 1), partial: true }
}
