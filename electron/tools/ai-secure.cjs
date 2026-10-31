/**
 * At-rest encryption for API keys (docs §203, R139).
 *
 * The app's `config.env` is a plaintext file in userData. Anyone who can
 * read that file — a crashed-dump, a disk image, a `process.env` dump from
 * a misconfigured tool — gets every API key. Electron's `safeStorage`
 * wraps the OS keychain (DPAPI on Windows, keychain on macOS, the freedesktop
 * secret service on Linux), which is exactly the right primitive for a
 * local desktop app: the key is encrypted with the user's OS login, not
 * with a password nobody would remember to type.
 *
 * This module is the ONLY thing that touches safeStorage. It is pure
 * (no app, no ipcMain, no file I/O): the main process calls encrypt/decrypt
 * and decides what to do with the result. That keeps the crypto testable
 * without spinning up Electron.
 *
 * Design decisions, pinned by spec:
 * - encrypt() is IDEMPOTENT: a token already starting with the magic
 *   prefix is returned unchanged. Encrypting twice must never double-wrap
 *   a key (that is how "my key stopped working" bugs are born).
 * - decrypt() is TOLERANT: an unknown prefix means "this was stored
 *   before encryption existed" — return it as-is. Never throw on a
 *   plaintext token; the app must keep working if safeStorage was
 *   unavailable when the key was saved.
 * - safeStorage itself can fail (no backend on the current OS, or the
 *   session is locked). Those failures are caught and degrade to
 *   plaintext — the app still runs, the user just loses the at-rest
 *   protection. A hard failure is worse than a soft one.
 */

const MAGIC = 'tmcut:enc:v1:'

/** @type {import('electron').safeStorage | null} */
let storage = null
let storageAvailable = null

function getStorage() {
  if (storageAvailable !== null) return storage
  try {
    const { safeStorage } = require('electron')
    if (safeStorage && typeof safeStorage.encryptString === 'function') {
      storage = safeStorage
      storageAvailable = safeStorage.isEncryptionAvailable()
    } else {
      storageAvailable = false
    }
  } catch {
    storageAvailable = false
  }
  return storageAvailable ? storage : null
}

/**
 * Encrypt a plaintext token. Idempotent: already-encrypted tokens pass
 * through unchanged. Returns the plaintext when safeStorage is unavailable.
 */
function encrypt(text) {
  if (text === undefined || text === null) return text
  const s = String(text)
  if (!s) return s
  if (s.startsWith(MAGIC)) return s
  const store = getStorage()
  if (!store) return s
  try {
    // encryptString returns a BUFFER. Raw bytes must never ride inside a
    // JS string: string→native marshalling re-encodes as UTF-8 and
    // corrupts the ciphertext (caught by the real-keychain probe).
    // base64 is the ASCII-safe carrier.
    const buf = store.encryptString(s)
    const b64 = Buffer.isBuffer(buf) ? buf.toString('base64') : Buffer.from(buf).toString('base64')
    return MAGIC + b64
  } catch {
    return s
  }
}

/**
 * Decrypt an encrypted token. Tolerant: unknown prefixes are returned
 * as-is (legacy plaintext tokens). Never throws.
 *
 * Returns `null` ONLY when a token claims the encrypted prefix but
 * cannot be decrypted (corrupt / tampered / wrong OS). Callers treat
 * null as "key lost — the user must re-enter it" and blank the field.
 */
function decrypt(text) {
  if (text === undefined || text === null) return text
  const s = String(text)
  if (!s) return s
  if (!s.startsWith(MAGIC)) return s
  const store = getStorage()
  if (!store) return s
  try {
    // Mirror of encrypt(): base64 carrier back to the raw bytes the
    // native decryptString expects.
    return store.decryptString(Buffer.from(s.slice(MAGIC.length), 'base64'))
  } catch {
    // Corrupt token (bad magic, tampered bytes, wrong OS): degrade
    // honestly instead of crashing the whole startup.
    return null
  }
}

/** True when the OS keychain is usable this session. */
function isEncryptionAvailable() {
  return getStorage() !== null
}

/** The magic prefix a token must start with to be considered encrypted. */
function magicPrefix() {
  return MAGIC
}

/**
 * Test hook ONLY: swap the safeStorage backend for a fake. Plain Node
 * cannot `require('electron')`, so the crypto path is untestable without
 * this. Callers MUST delete the handle after use (it is a singleton).
 *
 * Pass `null` to force the "no backend available" path.
 */
function __setSafeStorage(fake) {
  storage = fake
  storageAvailable = fake !== null
}

module.exports = { encrypt, decrypt, isEncryptionAvailable, magicPrefix, __setSafeStorage }
