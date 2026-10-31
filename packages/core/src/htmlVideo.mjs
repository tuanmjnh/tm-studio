// =============================================================================
//  HTML/CSS video — spec validation, frame math and authoring lint.
//
//  The authoring model follows the HyperFrames contract (heygen-com/hyperframes,
//  Apache-2.0): a composition is a plain HTML document with a
//  `data-composition-id` root, and the animation is a pure function of time
//  exposed on `__hf.seek(t)`. Rendering never plays the animation — it asks for
//  one frame at a time, so the same input produces the same video.
//
//  This module is the pure half: no browser, no fs. The frame capture and the
//  ffmpeg encode live in the host app (tm-tools/server).
// =============================================================================

export const HTML_VIDEO_SPEC_VERSION = 1

export const HTML_VIDEO_LIMITS = Object.freeze({
  minWidth: 64,
  maxWidth: 3840,
  minHeight: 64,
  maxHeight: 3840,
  minFps: 1,
  maxFps: 60,
  minDurationSec: 0.5,
  maxDurationSec: 120,
  /** Hard ceiling on captured frames: duration × fps. */
  maxFrames: 3600,
  maxHtmlBytes: 512 * 1024
})

/** Aspect presets shared by the studio UI and the render endpoint. */
export const HTML_VIDEO_PRESETS = Object.freeze([
  { id: '9:16', width: 1080, height: 1920 },
  { id: '16:9', width: 1920, height: 1080 },
  { id: '1:1', width: 1080, height: 1080 },
  { id: '4:5', width: 1080, height: 1350 }
])

export function htmlVideoPreset(id) {
  return HTML_VIDEO_PRESETS.find(preset => preset.id === id) || null
}

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
const isInteger = value => Number.isInteger(value)

/**
 * Frames captured for a given duration. The last frame is at
 * (frames − 1) / fps, so the encoded length is exactly frames / fps.
 */
export function frameCountFor(durationSec, fps) {
  if (!isFiniteNumber(durationSec) || !isFiniteNumber(fps) || durationSec <= 0 || fps <= 0) return 0
  return Math.max(1, Math.round(durationSec * fps))
}

export function frameTimeSec(frame, fps) {
  if (!isInteger(frame) || frame < 0 || !isFiniteNumber(fps) || fps <= 0) return 0
  return frame / fps
}

export function frameTimes(durationSec, fps) {
  const count = frameCountFor(durationSec, fps)
  const out = new Array(count)
  for (let i = 0; i < count; i += 1) out[i] = frameTimeSec(i, fps)
  return out
}

// --- Tokens ---------------------------------------------------------------
// Templates may declare `{{name}}` slots; the studio fills them per render.
// Unknown tokens are left untouched (visible) rather than silently blanked.

const TOKEN_RE = /\{\{([A-Za-z0-9_]+)\}\}/g

export function collectHtmlTokens(html) {
  const source = String(html || '')
  const seen = new Set()
  let match
  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(source)) !== null) seen.add(match[1])
  return [...seen].sort()
}

export function htmlVideoEscape(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Replaces `{{name}}` slots with escaped text. Values are coerced to strings;
 * a missing key leaves the token in place, which the lint step reports so a
 * half-filled template is loud, not blank.
 */
export function replaceHtmlTokens(html, values = {}) {
  const source = String(html || '')
  const vars = values && typeof values === 'object' ? values : {}
  return source.replace(TOKEN_RE, (whole, name) => {
    if (!Object.prototype.hasOwnProperty.call(vars, name)) return whole
    return htmlVideoEscape(vars[name])
  })
}

export function unresolvedHtmlTokens(html, values = {}) {
  const vars = values && typeof values === 'object' ? values : {}
  return collectHtmlTokens(html).filter(name => !Object.prototype.hasOwnProperty.call(vars, name))
}

// --- Lint -----------------------------------------------------------------

const LINT_RULES = [
  {
    code: 'missing-composition-root',
    level: 'error',
    test: html => !/<[^>]+data-composition-id\s*=/i.test(html),
    message: 'The document needs a root element with data-composition-id — the renderer uses it to size and identify the composition.'
  },
  {
    code: 'missing-seek-contract',
    level: 'error',
    test: html => !/__hf/.test(html) && !/hf-seek/.test(html),
    message: 'Expose the __hf seek contract — { duration, seek(t) } — or listen for the hf-seek event so frames can be requested one at a time.'
  },
  {
    code: 'wall-clock-animation',
    level: 'warn',
    test: html => /requestAnimationFrame\s*\(/.test(html) && !/hf-seek/.test(html),
    message: 'requestAnimationFrame makes motion depend on wall-clock time; renders will not be deterministic. Drive every property from the seek time instead.'
  },
  {
    code: 'unseeded-random',
    level: 'warn',
    test: html => /Math\.random\s*\(/.test(html),
    message: 'Math.random() is not reproducible across renders. Use a seeded PRNG so frame N is always the same frame.'
  },
  {
    code: 'remote-script',
    level: 'warn',
    test: html => /<script[^>]+src\s*=\s*["']https?:/i.test(html),
    message: 'Remote scripts need network access; the renderer blocks it by default. Inline the library or enable remote assets for this render.'
  },
  {
    code: 'unresolved-token',
    level: 'warn',
    test: html => /\{\{[A-Za-z0-9_]+\}\}/.test(html),
    message: 'Unfilled {{token}} slots are rendered verbatim. Fill them in the studio before exporting.'
  }
]

/**
 * Static authoring checks. These are honest heuristics on the source text —
 * they catch the failure modes that produce blank or non-deterministic
 * renders, not every possible bug.
 */
export function lintHtmlVideo(html) {
  const source = String(html || '')
  return LINT_RULES
    .filter(rule => rule.test(source))
    .map(rule => ({ code: rule.code, level: rule.level, message: rule.message }))
}

// --- Spec validation ------------------------------------------------------

/**
 * Validates a render request. Returns the effective frame count so the caller
 * and the client agree on the job length before a browser is launched.
 */
export function validateHtmlVideoSpec(spec = {}) {
  const errors = []
  const warnings = []
  const source = spec && typeof spec === 'object' ? spec : {}

  const html = typeof source.html === 'string' ? source.html : ''
  if (!html.trim()) {
    errors.push('html: a non-empty HTML document is required')
  } else {
    const bytes = BufferByteLength(html)
    if (bytes > HTML_VIDEO_LIMITS.maxHtmlBytes) {
      errors.push(`html: ${bytes} bytes exceeds the ${HTML_VIDEO_LIMITS.maxHtmlBytes}-byte limit`)
    }
  }

  const width = source.width
  const height = source.height
  if (!isInteger(width) || width < HTML_VIDEO_LIMITS.minWidth || width > HTML_VIDEO_LIMITS.maxWidth) {
    errors.push(`width: must be an integer in ${HTML_VIDEO_LIMITS.minWidth}..${HTML_VIDEO_LIMITS.maxWidth}`)
  }
  if (!isInteger(height) || height < HTML_VIDEO_LIMITS.minHeight || height > HTML_VIDEO_LIMITS.maxHeight) {
    errors.push(`height: must be an integer in ${HTML_VIDEO_LIMITS.minHeight}..${HTML_VIDEO_LIMITS.maxHeight}`)
  }

  const fps = source.fps
  if (!isFiniteNumber(fps) || fps < HTML_VIDEO_LIMITS.minFps || fps > HTML_VIDEO_LIMITS.maxFps) {
    errors.push(`fps: must be a number in ${HTML_VIDEO_LIMITS.minFps}..${HTML_VIDEO_LIMITS.maxFps}`)
  }

  const durationSec = source.durationSec
  if (
    !isFiniteNumber(durationSec)
    || durationSec < HTML_VIDEO_LIMITS.minDurationSec
    || durationSec > HTML_VIDEO_LIMITS.maxDurationSec
  ) {
    errors.push(`durationSec: must be a number in ${HTML_VIDEO_LIMITS.minDurationSec}..${HTML_VIDEO_LIMITS.maxDurationSec}`)
  }

  let frames = 0
  if (errors.length === 0) {
    frames = frameCountFor(durationSec, fps)
    if (frames > HTML_VIDEO_LIMITS.maxFrames) {
      errors.push(`durationSec × fps = ${frames} frames exceeds the ${HTML_VIDEO_LIMITS.maxFrames}-frame limit`)
    }
  }

  const variables = source.variables
  if (variables !== undefined) {
    if (!variables || typeof variables !== 'object' || Array.isArray(variables)) {
      errors.push('variables: must be a plain object')
    } else {
      for (const [key, value] of Object.entries(variables)) {
        if (!/^[A-Za-z0-9_]+$/.test(key)) {
          errors.push(`variables.${key}: names may contain only letters, digits and underscore`)
        } else if (value !== null && typeof value === 'object') {
          errors.push(`variables.${key}: must be a string, number or boolean`)
        }
      }
    }
  }

  const lint = lintHtmlVideo(html)
  for (const issue of lint) {
    if (issue.level === 'error') errors.push(`${issue.code}: ${issue.message}`)
    else warnings.push(`${issue.code}: ${issue.message}`)
  }

  return { valid: errors.length === 0, errors, warnings, frames, durationSec: errors.length === 0 ? durationSec : 0 }
}

/** UTF-8 byte length without depending on Buffer (core stays platform-free). */
function BufferByteLength(text) {
  let bytes = 0
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4
      i += 1
    } else bytes += 3
  }
  return bytes
}

// --- Remote-asset policy --------------------------------------------------

const PRIVATE_V4 = [
  [/^0\./, 'this-network'],
  [/^10\./, 'private'],
  [/^127\./, 'loopback'],
  [/^169\.254\./, 'link-local'],
  [/^172\.(1[6-9]|2\d|3[01])\./, 'private'],
  [/^192\.168\./, 'private']
]

/**
 * True for hosts a render must never reach: loopback, RFC1918, link-local and
 * the common cloud metadata endpoints. Used when a render opts into remote
 * assets, so a composition cannot use the renderer as an SSRF pivot.
 */
export function isBlockedRenderHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (host === '::1' || host === '::' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  if (host === 'metadata.google.internal' || host === 'metadata') return true
  return PRIVATE_V4.some(([pattern]) => pattern.test(host))
}

/**
 * Decides whether a render may load a URL. `allowRemote` is opt-in; even then
 * private/loopback targets stay blocked.
 */
export function isAllowedRenderUrl(rawUrl, allowRemote = false) {
  let url
  try {
    url = new URL(String(rawUrl))
  } catch {
    return false
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return true
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  if (!allowRemote) return false
  return !isBlockedRenderHost(url.hostname)
}
