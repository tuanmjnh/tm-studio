/**
 * Storage-shim specs — app/utils/tmcut/localStore.ts.
 *
 * The util exists because a denied or full localStorage used to throw out of
 * module scope and take the whole page with it (Safari private mode, blocked
 * storage in a file:// Electron window, quota on a project mirror). These
 * checks pin the degradation contract: an unreachable store reads as "nothing
 * stored" and writes as a no-op, never as an exception.
 */
import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readStored, writeStored, removeStored, readStoredFlag } from '../../app/utils/tmcut/localStore'

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

function withStore(getter: () => unknown) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: getter
  })
}

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    storage: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => { map.set(key, value) },
      removeItem: (key: string) => { map.delete(key) }
    } as unknown as Storage
  }
}

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
  else delete (globalThis as Record<string, unknown>).localStorage
})

describe('TMCut localStore — never-throw storage access', () => {
  it('round-trips a value through the store', () => {
    const { map, storage } = memoryStore()
    withStore(() => storage)
    writeStored('tmcut.magnet', '0')
    assert.equal(map.get('tmcut.magnet'), '0')
    assert.equal(readStored('tmcut.magnet'), '0')
    removeStored('tmcut.magnet')
    assert.equal(readStored('tmcut.magnet'), null)
  })

  it('reads as null when the store is absent, like an empty key', () => {
    withStore(() => undefined)
    assert.equal(readStored('tmcut.magnet'), null)
    assert.equal(readStoredFlag('tmcut.magnet', true), true)
    assert.equal(readStoredFlag('tmcut.magnet', false), false)
    writeStored('tmcut.magnet', '1')
    removeStored('tmcut.magnet')
  })

  it('swallows a getter that throws when storage is blocked', () => {
    withStore(() => {
      throw new Error('SecurityError: storage is disabled')
    })
    assert.equal(readStored('tmcut.shortcutTips'), null)
    assert.equal(readStoredFlag('tmcut.shortcutTips', true), true)
    writeStored('tmcut.shortcutTips', '0')
    removeStored('tmcut.shortcutTips')
  })

  it('swallows a quota error on write and a throw on remove', () => {
    const storage = {
      getItem: (key: string) => (key === 'k' ? '1' : null),
      setItem: () => { throw new Error('QuotaExceededError') },
      removeItem: () => { throw new Error('QuotaExceededError') }
    } as unknown as Storage
    withStore(() => storage)
    assert.equal(readStored('k'), '1')
    assert.equal(readStoredFlag('k', false), true)
    writeStored('big', 'x')
    removeStored('k')
  })

  it('treats only "1" as true, everything else as false', () => {
    const { storage } = memoryStore({ on: '1', off: '0', junk: 'true' })
    withStore(() => storage)
    assert.equal(readStoredFlag('on', false), true)
    assert.equal(readStoredFlag('off', true), false)
    assert.equal(readStoredFlag('junk', true), false)
  })
})
