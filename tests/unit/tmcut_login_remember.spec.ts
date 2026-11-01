import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = readFileSync(join(ROOT, 'app/pages/login.vue'), 'utf8')

function bodyOf(name: string) {
  const start = src.indexOf(`function ${name}(`)
  assert.ok(start >= 0, `${name} must exist`)
  const end = src.indexOf('\n}', start)
  return src.slice(start, end)
}

describe('remembered login never stores the password', () => {
  // The page used to persist { username, password } in localStorage in the
  // clear, so any XSS or a shared browser profile exposed the account. The
  // checkbox now remembers the account name only, and old entries are purged.
  it('saving keeps the account name and drops the secret', () => {
    const save = bodyOf('saveCredentials')
    assert.match(save, /localStorage\.setItem\('remembered_login'/, 'the choice still pre-fills the account')
    assert.match(save, /username: state\.email/, 'only the account name is persisted')
    assert.doesNotMatch(save, /state\.password|\bpassword\s*:/, 'no secret may reach localStorage')
  })

  it('loading never restores a password from storage', () => {
    const load = bodyOf('loadSaved')
    assert.doesNotMatch(load, /state\.password\s*=/, 'a stored password must not be restored into the form')
    assert.doesNotMatch(load, /data\.password/, 'the legacy password field must not be read')
  })

  it('legacy entries are rewritten without the password', () => {
    const load = bodyOf('loadSaved')
    assert.match(load, /'password' in data/, 'legacy payloads are detected')
    assert.match(
      load,
      /localStorage\.setItem\('remembered_login',\s*JSON\.stringify\(\{\s*username:/,
      'the rewritten entry carries only the account name'
    )
    assert.match(load, /localStorage\.removeItem\('remembered_login'\)/, 'corrupt entries are discarded')
  })

  it('the login form still submits the typed password', () => {
    // The password must stay in memory long enough to authenticate; only
    // persistence is forbidden.
    assert.match(src, /password: state\.password/)
  })
})
