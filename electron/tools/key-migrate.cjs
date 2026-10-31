// R143 (§206): the at-rest key migration as a PURE function so both
// main.cjs (startup + "Encrypt now") and the Electron probe run the
// EXACT same line transform. The handler wiring is what the vault spec
// pins; this file is what the probe proves with a REAL keychain:
// plaintext -> encrypted token, non-secret lines untouched, idempotent.
//
// Why a rewrite instead of a cut-and-paste: the R139 inline capture
// `AI_API(?:_URL)?(?:_[A-Z0-9_]+)?` matched the slots it should (node
// verified: plain AI_API_KEY DID migrate — behavior was correct) but also
// matched bare `AI_API` / `AI_API_URL_PLAN`, relying on the downstream
// SECRET_SLOT_RE filter to reject the extras. Correct today, one regex
// tweak away from encrypting the wrong lines tomorrow. The line-splitting
// loop has no clever capture: the closed SECRET_SLOT_RE (same shape
// main.cjs masks/decrypts with — the vault spec pins both literals
// byte-identical) is the single authority, and everything it rejects
// comes back byte-for-byte, comments and indentation included.
'use strict'

const { encrypt, magicPrefix } = require('./ai-secure.cjs')
// R145 (§207): one definition of the slot shape for every consumer —
// the byte-identical-copies era (and its grep-pin spec) is over.
const { SECRET_SLOT_RE } = require('./secret-slots.cjs')

/**
 * Encrypt every plaintext secret-slot line in a config.env body.
 * @param {string} content file content
 * @param {RegExp} secretRe slot filter (injectable for tests; default is
 *   the closed SECRET_SLOT_RE — callers have no reason to widen it)
 * @returns {{ content: string, changed: boolean }}
 */
function migrateKeyContent(content, secretRe = SECRET_SLOT_RE) {
  const magic = magicPrefix()
  let changed = false
  const out = content.split('\n').map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return line
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) return line
    const key = trimmed.slice(0, eqIdx).trim()
    if (!secretRe.test(key)) return line
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1)
    }
    if (!value || value.startsWith(magic)) return line
    const enc = encrypt(value)
    if (enc === value) return line // no backend mid-flight: leave as-is
    changed = true
    return `${key}=${enc}`
  })
  return { content: out.join('\n'), changed }
}

module.exports = { migrateKeyContent, SECRET_SLOT_RE }
