// R141 (§205): the config.env parser, extracted from main.cjs so the
// vault-status handler and the probe share ONE implementation. The
// distinction that matters: a missing file (fresh install, panel never
// saved) must NOT look like a parsed file with zero secret slots —
// both previously reported 0 encrypted / 0 plaintext and the banner
// lied about the OS keychain.
//
// Shape: { exists: boolean, values: Record<string,string> }
//   - `exists` is true only when the file was actually read. A missing
//     file, a permission error, or any other read failure leaves it
//     false with an empty values map — the caller must treat those as
//     "no config yet", not "config with nothing in it".
//   - Lines are `KEY=VALUE` (or `KEY = VALUE`); blank lines and lines
//     starting with `#` are skipped; surrounding double/single quotes on
//     the value are stripped. This matches what set-config writes.
'use strict'

const fs = require('fs')
const crypto = require('node:crypto')
const { SECRET_SLOT_RE } = require('./secret-slots.cjs')
const { encrypt, magicPrefix } = require('./ai-secure.cjs')

const MASTER_KEY = 'AI_CONFIG_SECRET'

function readConfigFile(file) {
  const result = { exists: false, values: {} }
  try {
    const content = fs.readFileSync(file, 'utf8')
    result.exists = true
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      let value = trimmed.slice(eqIdx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        value = value.slice(1, -1)
      }
      result.values[key] = value
    }
  } catch {
    // no config yet — exists stays false
  }
  return result
}

/**
 * Rewrite the whole file from `values`. Secret slots go to disk as keychain
 * tokens; every other value is verbatim. A masked placeholder echoed back from
 * get-config ('********') means "keep what is stored", so the caller must merge
 * first and never pass the mask as a real value.
 */
function writeConfigValues(file, values) {
  const lines = Object.entries(values)
    .filter(([key, value]) => !(SECRET_SLOT_RE.test(key) && String(value) === '********'))
    .map(([key, value]) => `${key}=${SECRET_SLOT_RE.test(key) ? encrypt(String(value)) : String(value)}`)
  fs.writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
}

/**
 * Append a single `KEY=VALUE` line instead of rewriting the file. This exists
 * because `writeConfigValues` rewrites every line — comments and `********`
 * masks echoed from get-config would be lost — and `readConfigFile` yields the
 * keychain tokens, not the plaintext, so neither can seed a generated value.
 * Secret slots are encrypted exactly like the rewrite path; the separator is
 * added only when the file does not already end with a newline. A write
 * failure throws to the caller.
 */
function appendConfigValue(file, key, value) {
  let prefix = ''
  try {
    const { size } = fs.statSync(file)
    if (size > 0) {
      const fd = fs.openSync(file, 'r')
      try {
        const last = Buffer.alloc(1)
        fs.readSync(fd, last, 0, 1, size - 1)
        if (last[0] !== 0x0a) prefix = '\n'
      } finally {
        fs.closeSync(fd)
      }
    }
  } catch {
    // no config file yet — the new line starts the file
  }
  fs.appendFileSync(file, `${prefix}${key}=${SECRET_SLOT_RE.test(key) ? encrypt(String(value)) : String(value)}\n`, 'utf8')
}

/**
 * Startup decision for the AI master key (the secret that seals every
 * app-local provider key). Returns one of:
 *
 *  - 'keep'             — the env value or a readable stored slot is in use.
 *  - 'generate'         — no slot yet: generating one is the only safe act.
 *  - 'skip-unreadable'  — a slot exists but decrypt() returned null (profile
 *    copied to another machine, keychain reset). Generating a replacement
 *    would win last-line-wins on every later start and orphan every row
 *    sealed with the old key, so the state must surface instead.
 *  - 'skip-unavailable' — the OS keychain cannot protect a new key; writing
 *    one in plaintext would leave every Mongo cipher recoverable from
 *    `config.env` alone, and an unreadable token cannot be verified.
 *
 * Pure: the caller supplies the parsed values, the decrypt function, the
 * keychain availability and the current env value. `main.cjs` needs Electron,
 * so this is the part of `loadUserConfig()` that can be tested directly.
 */
function decideMasterKey({ values, currentEnv, decrypt, encryptionAvailable }) {
  if (String(currentEnv || '').trim()) return 'keep'
  const stored = String((values || {})[MASTER_KEY] || '').trim()
  if (!stored) return encryptionAvailable ? 'generate' : 'skip-unavailable'
  const opened = decrypt(stored)
  if (opened === null || opened === undefined || !String(opened).trim()) return 'skip-unreadable'
  // With no keychain, decrypt() hands the token back unchanged, so a magic
  // prefix here means "cannot be verified" rather than "plaintext legacy".
  if (!encryptionAvailable && stored.startsWith(magicPrefix())) return 'skip-unavailable'
  return 'keep'
}

/**
 * Apply the decision: only 'generate' writes, and only by appending one line.
 * A write failure is returned rather than thrown so the caller can log it and
 * leave the env unset — setting the value anyway would let the next start
 * generate a different key and orphan the rows sealed with this one.
 */
function ensureMasterKey(file, options) {
  const decision = decideMasterKey(options)
  if (decision !== 'generate') return { decision, value: null, error: null }
  const generated = crypto.randomBytes(32).toString('base64')
  try {
    appendConfigValue(file, MASTER_KEY, generated)
    return { decision, value: generated, error: null }
  } catch (error) {
    return { decision, value: null, error }
  }
}

module.exports = { readConfigFile, writeConfigValues, appendConfigValue, decideMasterKey, ensureMasterKey }
