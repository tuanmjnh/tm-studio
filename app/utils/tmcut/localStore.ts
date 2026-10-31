// localStorage access that never throws.
//
// The whole store can be unavailable (Safari private mode, cookies blocked for
// a file:// Electron window, storage disabled by policy) and writes throw on
// quota. Several TMCut callers read a preference or mirror a project outside a
// try block, so a denied store used to take the feature down rather than
// degrading to in-memory state.
//
// Reads go through globalThis rather than window: the unit-test harness installs
// a storage shim on globalThis, and a window-only guard would silently disable
// persistence there.

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    // Some browsers throw on the property access itself when storage is blocked.
    return null
  }
}

export function readStored(key: string): string | null {
  return store()?.getItem(key) ?? null
}

export function writeStored(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Persistence is best-effort: the in-memory value is already applied.
  }
}

export function removeStored(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // Nothing to clean up when the store is unreachable.
  }
}

/** Boolean flag persisted as '1'/'0'; falls back when unset or unreadable. */
export function readStoredFlag(key: string, fallback: boolean): boolean {
  const raw = readStored(key)
  return raw === null ? fallback : raw === '1'
}
