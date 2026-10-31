// R139 probe (docs §203): prove the REAL Electron runtime (and the real
// OS keychain — DPAPI on Windows) backs the at-rest key encryption that
// plain Node tests can only model with a fake backend:
//  1) safeStorage reports an available backend in this session;
//  2) ai-secure round-trips a key through the REAL keychain;
//  3) the stored token never contains the plaintext;
//  4) encrypt() stays idempotent against a real token (no double-wrap);
//  5) a corrupt token decrypts to null (the "ask the user again" path).
//
//   node_modules\electron\dist\electron.exe tests/e2e/electron_secure_probe.cjs
//
// Prints PROBE lines to stdout; exits 0 on all pass, 1 on any failure.
const { app } = require('electron')
const { encrypt, decrypt, isEncryptionAvailable, magicPrefix } = require('../../electron/tools/ai-secure.cjs')

app.disableHardwareAcceleration()

let failures = 0
function check(name, ok, detail) {
  console.log(`PROBE ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`)
  if (!ok) failures++
}

app.whenReady().then(() => {
  try {
    const available = isEncryptionAvailable()
    check('safeStorage backend available in this session', available, `available=${available}`)

    const secret = 'sk-r139-' + 'Xq9Zk' // recognizable probe value
    const token = encrypt(secret)
    check('token carries the magic prefix', token.startsWith(magicPrefix()), token.slice(0, 24) + '…')
    check('token does NOT contain the plaintext', !token.includes(secret))
    check('round-trip recovers the key through the real keychain', decrypt(token) === secret)
    check('encrypt is idempotent on a real token', encrypt(token) === token)
    check('legacy plaintext passes through decrypt untouched', decrypt('plain-legacy-key') === 'plain-legacy-key')
    check('corrupt token yields null (re-enter-key path)', decrypt(magicPrefix() + 'AAAAcorrupt') === null)

    // R143 (§206): the EXACT line transform migrateStoredKeysToSecureStorage
    // runs — startup and the vault page's "Encrypt now" share key-migrate.cjs
    // — proved against the REAL keychain: plaintext line -> token, non-secret
    // lines untouched, second pass a no-op (idempotent = safe to double-click).
    const { migrateKeyContent, SECRET_SLOT_RE } = require('../../electron/tools/key-migrate.cjs')
    const before = [
      'AI_API_KEY=sk-plain-r143',
      'AI_API_KEY_TRIGGE=sk-surface-plain',
      'AI_PROVIDER=openrouter',
      'AI_MODEL=gpt-4o-mini'
    ].join('\n')
    const first = migrateKeyContent(before)
    check('migration marks the file changed', first.changed === true)
    const lines = first.content.split('\n')
    check('global key line became a keychain token', lines[0].startsWith('AI_API_KEY=' + magicPrefix()), lines[0].slice(0, 30) + '…')
    check('surface key line became a keychain token', lines[1].startsWith('AI_API_KEY_TRIGGE=' + magicPrefix()), lines[1].slice(0, 30) + '…')
    check('non-secret lines pass through untouched', lines[2] === 'AI_PROVIDER=openrouter' && lines[3] === 'AI_MODEL=gpt-4o-mini')
    check('migrated global token has no plaintext', !lines[0].includes('sk-plain-r143'))
    check('migrated token round-trips through the real keychain', decrypt(lines[0].slice('AI_API_KEY='.length)) === 'sk-plain-r143')
    const second = migrateKeyContent(first.content)
    check('second pass is a no-op (idempotent)', second.changed === false && second.content === first.content)
    check('key-migrate regex closed to the slot shape', SECRET_SLOT_RE.test('AI_API_KEY') && SECRET_SLOT_RE.test('AI_API_KEY_PLAN') && !SECRET_SLOT_RE.test('AI_API_URL') && !SECRET_SLOT_RE.test('SOMETHING_ELSE'))
  } catch (err) {
    check(`probe crashed: ${err && err.message}`, false)
  } finally {
    console.log(`PROBE result: ${failures === 0 ? 'ALL PASS' : failures + ' FAILED'}`)
    app.exit(failures === 0 ? 0 : 1)
  }
})
