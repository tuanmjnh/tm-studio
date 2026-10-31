/**
 * R141 specs — the shared config.env parser (docs §205).
 * The parser was extracted from main.cjs because FOUR readers (startup
 * load, get-config, ai-key-status, set-config) touched the same file and
 * each handled errors differently. The contract this pins:
 *  - `exists` distinguishes a fresh install from a parsed-but-empty file
 *    (the vault banner lies about the keychain without it);
 *  - values survive the same round-trip set-config writes;
 *  - anything the parser cannot read is "no config yet", never "empty
 *    config" — callers must be able to trust that mapping.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { readConfigFile } = require('../../electron/tools/config-file.cjs')

// node:test defers it() bodies until after the module evaluates, so the
// temp dir must be created per test (a module-scope dir would be deleted
// by the teardown before any test ran).
const dir = mkdtempSync(join(tmpdir(), 'tmcut-cfg-'))
after(() => rmSync(dir, { recursive: true, force: true }))

let n = 0
function file(content) {
  const p = join(dir, `cfg-${n++}.env`)
  writeFileSync(p, content, 'utf8')
  return p
}

describe('config-file parser — exists flag (R141)', () => {
  it('a missing file is exists:false with NO values (fresh install)', () => {
    const r = readConfigFile(join(dir, 'does-not-exist.env'))
    assert.equal(r.exists, false)
    assert.deepEqual(r.values, {})
  })

  it('an empty existing file is exists:true (panel saved once, wiped later)', () => {
    const r = readConfigFile(file(''))
    assert.equal(r.exists, true)
    assert.deepEqual(r.values, {})
  })

  it('a comments-only file still exists (a wiped config is NOT a missing one)', () => {
    const r = readConfigFile(file('# written by TMCut\n'))
    assert.equal(r.exists, true)
    assert.deepEqual(r.values, {})
  })
})

describe('config-file parser — value contract (unchanged from R139)', () => {
  it('parses KEY=VALUE with blank-line + comment skipping', () => {
    const r = readConfigFile(file('AI_PROVIDER=openrouter\n\n# comment\nAI_MODEL=x/y\n'))
    assert.deepEqual(r.values, { AI_PROVIDER: 'openrouter', AI_MODEL: 'x/y' })
  })

  it('strips surrounding quotes and spaces (legacy files quote values)', () => {
    const r = readConfigFile(file('A="dq"\nB=\'sq\'\nC=  spaced  \n'))
    assert.deepEqual(r.values, { A: 'dq', B: 'sq', C: 'spaced' })
  })

  it('duplicate keys keep the LAST value, like Object spread on merge', () => {
    const r = readConfigFile(file('A=1\nA=2\n'))
    assert.equal(r.values.A, '2')
  })

  it('a value with = inside splits on the FIRST = (base64 tokens are safe)', () => {
    // ai-secure tokens are base64 → full of '=' padding; the parser
    // MUST NOT chop the token at the first trailing '='.
    const r = readConfigFile(file('AI_API_KEY=tmcut:enc:v1:YWJj===\n'))
    assert.equal(r.values.AI_API_KEY, 'tmcut:enc:v1:YWJj===')
  })
})
