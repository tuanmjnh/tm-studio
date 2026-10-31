'use strict'
// Pure helpers for the `tmcut:downloadMedia` IPC channel (P4 groundwork).
//
// Kept free of electron/fs imports so the decision logic — which URLs are
// allowed, what the file is called, what happens when the name is taken — is
// unit tested in plain Node (media-download.test.mjs). The controller owns the
// streaming; this module owns the rules.

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_FILENAME_LENGTH = 120
const MAX_SUFFIX_ATTEMPTS = 100
// Characters Windows forbids in a name, plus the path separators. Control
// characters are stripped separately (a char-code filter keeps this regex
// free of escape ranges that lint flags as control patterns).
const UNSAFE_NAME_CHARS = /[\\/:*?"<>|]/g

function stripControlChars(value) {
  let clean = ''
  for (const character of value) {
    if (character.codePointAt(0) >= 0x20) clean += character
  }
  return clean
}

/**
 * Only http(s) is accepted. `file:`, `data:` and `javascript:` are renderer
 * escapes, and a bare path is not a URL at all.
 */
function assertDownloadUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { ok: false, reason: 'bad-url' }
  }
  let parsed
  try {
    parsed = new URL(rawUrl.trim())
  } catch {
    return { ok: false, reason: 'bad-url' }
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return { ok: false, reason: 'bad-protocol' }
  return { ok: true, url: parsed.toString() }
}

/** Last path segment of a URL, decoded; empty when there is none. */
function nameFromUrl(url) {
  try {
    const parsed = new URL(url)
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || ''
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

/**
 * Turn an arbitrary name into a single safe filename component:
 * directories stripped, reserved characters replaced, dots/spaces trimmed,
 * length capped while keeping the extension.
 */
function sanitizeFilename(name, defaultExtension = 'mp4') {
  const base = String(name || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || ''
  let clean = stripControlChars(base).replace(UNSAFE_NAME_CHARS, '_').replace(/\s+/g, ' ').trim()
  clean = clean.replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
  if (!clean) clean = `download-${Date.now()}`
  if (!/\.[a-z0-9]{1,8}$/i.test(clean)) {
    clean = `${clean}.${String(defaultExtension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4'}`
  }
  if (clean.length > MAX_FILENAME_LENGTH) {
    const dot = clean.lastIndexOf('.')
    const extension = dot > 0 ? clean.slice(dot) : ''
    const stem = dot > 0 ? clean.slice(0, dot) : clean
    clean = `${stem.slice(0, Math.max(1, MAX_FILENAME_LENGTH - extension.length))}${extension}`
  }
  return clean
}

/**
 * Final path for a download: sanitized name, and a ` (n)` suffix when the
 * target already exists (`exists` is injected so the caller owns fs).
 */
function resolveDownloadTarget({ dir, url, filename, exists, defaultExtension = 'mp4' }) {
  const name = sanitizeFilename(filename || nameFromUrl(url) || 'download', defaultExtension)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  for (let attempt = 0; attempt < MAX_SUFFIX_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? name : `${stem} (${attempt})${extension}`
    const fullPath = `${dir.replace(/[\\/]+$/, '')}/${candidate}`
    if (!exists(fullPath)) return { name: candidate, path: fullPath }
  }
  const fallback = `${stem}-${Date.now()}${extension}`
  return { name: fallback, path: `${dir.replace(/[\\/]+$/, '')}/${fallback}` }
}

module.exports = {
  ALLOWED_PROTOCOLS,
  MAX_FILENAME_LENGTH,
  assertDownloadUrl,
  nameFromUrl,
  sanitizeFilename,
  resolveDownloadTarget
}
