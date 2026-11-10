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
const { SECRET_SLOT_RE } = require('./secret-slots.cjs')
const { encrypt } = require('./ai-secure.cjs')

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

module.exports = { readConfigFile, writeConfigValues }
