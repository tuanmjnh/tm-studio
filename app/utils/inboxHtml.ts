/** "Name <email>" | "email" → { name, email } */
export function parseAddress(raw: string): { name: string, email: string } {
  const value = (raw || '').trim()
  const match = value.match(/^(.*?)(?:<([^>]+)>)\s*$/)
  if (match && match[2]) {
    return { name: (match[1] || '').trim().replace(/^"|"$/g, ''), email: match[2].trim() }
  }
  return { name: value, email: value }
}

/**
 * Sanitize dangerous elements in HTML mail (untrusted content):
 * script/style/iframe..., on* handlers, javascript: URLs.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return ''
  let out = html
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|form|base|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
  out = out.replace(/<(script|style|iframe|object|embed|link|meta|form|base|svg|math)\b[^>]*\/?>/gi, '')
  out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/(href|src)\s*=\s*("|')?\s*(javascript|data:text\/html)[^"'>\s]*/gi, '$1="#"')
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
