// =============================================================================
//  tmcut-core — client byte cache law (zero-FFmpeg slice C2b, ADR-033)
//  Pure decisions about a second copy of a media file kept in the browser.
//  The storage side (OPFS / IndexedDB) lives in app/utils/tmcut/byteStore.ts;
//  nothing here touches a browser API, so both hosts and plain node can run
//  the same budget, key and eviction rules.
// =============================================================================

/** Hard ceiling: a big disk never buys an unbounded cache. */
export const TMCUT_BYTE_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Share of the device quota the cache may claim. */
export const TMCUT_BYTE_CACHE_QUOTA_SHARE = 0.4

const KEY_PATTERN = /^[0-9a-f]{8}$/

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * Bytes the cache may hold.
 * A quota nobody reported (NaN, zero, negative) is not a licence to store
 * without limit — the ceiling still applies.
 */
export function byteCacheBudgetBytes(quotaBytes) {
  const quota = positiveNumber(quotaBytes)
  if (!quota) return TMCUT_BYTE_CACHE_MAX_BYTES
  return Math.min(TMCUT_BYTE_CACHE_MAX_BYTES, Math.floor(quota * TMCUT_BYTE_CACHE_QUOTA_SHARE))
}

/**
 * A cache key is exactly one revision fingerprint (`cacheKeyForPath`).
 * Anything else — a path, an uppercase digest, a truncated or padded digest —
 * must never be allowed to name a file.
 */
export function isByteCacheKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/** Whether one file can live in the cache at all, before eviction is asked. */
export function byteCacheFits(sizeBytes, budgetBytes) {
  const size = positiveNumber(sizeBytes)
  const budget = positiveNumber(budgetBytes)
  if (!size || !budget) return false
  return size <= budget
}

function byAgeThenKey(a, b) {
  if (a.accessedAt !== b.accessedAt) return a.accessedAt - b.accessedAt
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/**
 * Which cached revisions to delete so the store fits `budgetBytes`.
 *
 * `liveKeys` is what the media library currently references. Dropping order is
 * the whole point: bytes no asset names are freed first (a relink or a delete
 * leaves them behind and nothing else cleans them), then an entry that cannot
 * fit the budget even alone, then the least recently used until the total fits.
 * An entry whose key is not a fingerprint is reported as `invalid` and removed:
 * it can name no file, so it is only noise in the index.
 *
 * @param {Array<{key: string, bytes: number, accessedAt: number}>} entries
 * @param {number} budgetBytes
 * @param {Iterable<string>} liveKeys
 */
export function planByteCacheEviction(entries, budgetBytes, liveKeys = []) {
  const rows = Array.isArray(entries) ? entries : []
  const live = new Set(liveKeys ?? [])
  const usableBudget = positiveNumber(budgetBytes)

  const invalid = []
  const candidates = []
  for (const entry of rows) {
    if (!entry || !isByteCacheKey(entry.key)) {
      if (entry && typeof entry.key === 'string') invalid.push(entry.key)
      continue
    }
    if (candidates.some(candidate => candidate.key === entry.key)) continue
    candidates.push({ key: entry.key, bytes: positiveNumber(entry.bytes), accessedAt: positiveNumber(entry.accessedAt) })
  }

  const drop = [...invalid]
  const keep = []
  const doomed = []
  for (const entry of candidates) {
    if (!usableBudget || !live.has(entry.key) || entry.bytes > usableBudget) doomed.push(entry)
    else keep.push(entry)
  }
  drop.push(...doomed.sort(byAgeThenKey).map(entry => entry.key))

  let keptBytes = keep.reduce((total, entry) => total + entry.bytes, 0)
  keep.sort(byAgeThenKey)
  while (keptBytes > usableBudget && keep.length > 0) {
    const oldest = keep.shift()
    keptBytes -= oldest.bytes
    drop.push(oldest.key)
  }

  return { drop, keep, keptBytes, invalid }
}
