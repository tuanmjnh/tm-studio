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

describe('remembered login stores the account and the password', () => {
  // The owner asked for "Remember my password", matching tm-tools
  // (app/pages/login.vue there persists { username, password }). The plaintext
  // password in localStorage is a known, accepted risk: any XSS or a shared
  // browser profile can read it. This spec pins the requested behaviour — it
  // does not claim the storage is safe.

  it('saving with remember ticked keeps both fields', () => {
    const save = bodyOf('saveCredentials')
    assert.match(save, /localStorage\.setItem\('remembered_login'/, 'the choice pre-fills the form')
    assert.match(
      save,
      /JSON\.stringify\(\{\s*username: state\.email,\s*password: state\.password\s*\}\)/,
      'both the account name and the password are persisted'
    )
    assert.match(save, /remember\.value/, 'the checkbox gates persistence')
  })

  it('saving with remember unticked clears the entry', () => {
    const save = bodyOf('saveCredentials')
    assert.match(save, /localStorage\.removeItem\('remembered_login'\)/, 'unticking forgets the entry')
  })

  it('loading restores both fields and re-ticks the box', () => {
    const load = bodyOf('loadSaved')
    assert.match(load, /state\.email = data\.username/, 'the account name is restored')
    assert.match(load, /state\.password = data\.password/, 'the password is restored')
    assert.match(load, /remember\.value = Boolean\(data\.username\)/, 'the checkbox reflects the saved entry')
  })

  it('loading no longer strips a previously saved password', () => {
    // The retired build rewrote every entry to { username } on load, which
    // would erase the password the user just chose to remember.
    const load = bodyOf('loadSaved')
    assert.doesNotMatch(load, /'password' in data/, 'the scrubbing branch must be gone')
    assert.doesNotMatch(load, /localStorage\.setItem\(/, 'loading must never write a different payload')
  })

  it('a corrupt entry is still discarded', () => {
    const load = bodyOf('loadSaved')
    assert.match(load, /catch\s*\{[\s\S]*localStorage\.removeItem\('remembered_login'\)/, 'unparsable JSON is dropped')
  })

  it('the password reaches localStorage from exactly one place', () => {
    const writers = [...src.matchAll(/localStorage\.setItem\([^)]*\)/g)].map(m => m[0])
    const withPassword = writers.filter(w => /password/.test(w))
    assert.equal(withPassword.length, 1, `expected one password-carrying write, found ${withPassword.length}`)
    assert.match(withPassword[0]!, /remembered_login/)
  })

  it('the login form still submits the typed password', () => {
    // The password must reach the auth call; only persistence is at stake here.
    assert.match(src, /password: state\.password/)
  })
})
