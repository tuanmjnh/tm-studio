/** "Name <email>" | "email" → { name, email } */
export function parseAddress(raw: string): { name: string, email: string } {
  const value = (raw || '').trim()
  const match = value.match(/^(.*?)(?:<([^>]+)>)\s*$/)
  if (match && match[2]) {
    return { name: (match[1] || '').trim().replace(/^"|"$/g, ''), email: match[2].trim() }
  }
  return { name: value, email: value }
}

const DROPPED_ELEMENTS = 'script|style|iframe|object|embed|link|meta|form|base|svg|math'

// Named entities that can appear inside a URL scheme. Every other named entity
// decodes to a non-ASCII letter, which cannot complete `javascript:` anyway.
const NAMED_ENTITIES: Record<string, string> = {
  colon: ':',
  tab: '\t',
  newline: '\n',
  sol: '/',
  num: '#',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\''
}

function codePointToString(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return ''
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

/** Resolve the entities a browser would resolve before it reads a URL. */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => codePointToString(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec: string) => codePointToString(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
}

/** Drop what a browser drops from a URL before reading it: C0 controls and space. */
function stripUrlNoise(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x20 || code === 0x7f) continue
    out += ch
  }
  return out
}

/**
 * Whether a URL is safe to keep, decided on the value the browser will act on
 * rather than the bytes in the mail body.
 *
 * The browser decodes entities and drops C0 controls and whitespace anywhere in
 * the URL before it reads the scheme, so `jav&#x61;script:`, `jav\tascript:` and
 * `java\nscript:` all resolve to `javascript:`. Matching the raw attribute text
 * is why those three executed. Allowlist, not blocklist: an unknown scheme is
 * unsafe by default.
 */
function isSafeUrl(raw: string, kind: 'href' | 'src'): boolean {
  const value = stripUrlNoise(decodeEntities(raw))
  if (!value) return true
  if (value.startsWith('#') || value.startsWith('?')) return true
  if (value.startsWith('./') || value.startsWith('../')) return true
  if (value.startsWith('/') && !value.startsWith('//')) return true
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase()
  if (!scheme) return true
  if (scheme === 'http' || scheme === 'https' || scheme === 'mailto' || scheme === 'tel' || scheme === 'cid') {
    return true
  }
  return scheme === 'data' && kind === 'src' && /^data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,/i.test(value)
}

// Built per call: these carry the `g` flag, and a shared `lastIndex` across
// invocations is exactly the kind of state a security filter must not keep.
const TAG_SOURCE = '<([a-zA-Z][^\\s/>]*)((?:\\s+(?:[^>"\']|"[^"]*"|\'[^\']*\')*)?)\\s*\\/?>'
const ATTRIBUTE_SOURCE = '([^\\s/>=]+)(?:\\s*=\\s*("[^"]*"|\'[^\']*\'|[^\\s>]*))?'

function cleanTag(name: string, attrs: string): string {
  let out = `<${name}`
  const attribute = new RegExp(ATTRIBUTE_SOURCE, 'g')
  let match: RegExpExecArray | null
  while ((match = attribute.exec(attrs))) {
    const attr = match[1] ?? ''
    if (!attr) continue
    const lower = attr.toLowerCase()
    // Handler attributes are removed whatever precedes them, so an unquoted
    // neighbour (`<img/src=x/onerror=…>`) cannot smuggle one through.
    if (lower.startsWith('on') || lower === 'srcdoc') continue
    const raw = match[2]
    if (raw === undefined) {
      out += ` ${attr}`
      continue
    }
    const quote = raw[0] === '"' || raw[0] === '\'' ? raw[0] : ''
    const value = quote ? raw.slice(1, -1) : raw
    if (lower === 'href' || lower === 'src' || lower === 'xlink:href') {
      if (!isSafeUrl(value, lower === 'src' ? 'src' : 'href')) continue
    }
    out += quote ? ` ${attr}=${quote}${value}${quote}` : ` ${attr}=${value}`
  }
  return `${out}>`
}

/**
 * Sanitize untrusted HTML mail: drop active elements and handler attributes,
 * and keep only URLs whose resolved scheme is known-safe.
 *
 * Inline `style` is deliberately kept — email formatting depends on it, and CSS
 * cannot execute script in a modern browser.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return ''
  let out = html
  out = out.replace(new RegExp(`<(${DROPPED_ELEMENTS})\\b[\\s\\S]*?<\\/\\1\\s*>`, 'gi'), '')
  out = out.replace(new RegExp(`</?(?:${DROPPED_ELEMENTS})\\b[^>]*>`, 'gi'), '')
  out = out.replace(new RegExp(TAG_SOURCE, 'g'), (_, name: string, attrs: string) => cleanTag(name, attrs))
  return out
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function getInitials(name: string): string {
  if (!name) return '?'
  const clean = name.replace(/['"]/g, '').trim()
  const parts = clean.split(/\s+/)
  const first = parts[0]
  const last = parts[parts.length - 1]
  if (parts.length >= 2 && first && last && first[0] && last[0]) {
    return (first[0] + last[0]).toUpperCase()
  }
  return clean.slice(0, 2).toUpperCase() || '?'
}

export function getAttachmentIcon(mimeType: string, filename: string): { icon: string, color: string } {
  const mime = (mimeType || '').toLowerCase()
  const ext = (filename || '').split('.').pop()?.toLowerCase() || ''

  if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
    return { icon: 'i-lucide-file-image', color: 'text-emerald-500' }
  }
  if (mime === 'application/pdf' || ext === 'pdf') {
    return { icon: 'i-lucide-file-text', color: 'text-rose-500' }
  }
  if (mime.includes('zip') || mime.includes('compressed') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) {
    return { icon: 'i-lucide-file-archive', color: 'text-amber-500' }
  }
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) {
    return { icon: 'i-lucide-file-spreadsheet', color: 'text-green-600' }
  }
  if (mime.includes('word') || ['doc', 'docx'].includes(ext)) {
    return { icon: 'i-lucide-file-text', color: 'text-blue-500' }
  }
  if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv'].includes(ext)) {
    return { icon: 'i-lucide-file-video', color: 'text-purple-500' }
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) {
    return { icon: 'i-lucide-file-audio', color: 'text-cyan-500' }
  }
  if (mime.includes('json') || mime.includes('javascript') || ['json', 'js', 'ts', 'html', 'css', 'py'].includes(ext)) {
    return { icon: 'i-lucide-file-code', color: 'text-orange-500' }
  }
  return { icon: 'i-lucide-paperclip', color: 'text-muted' }
}
