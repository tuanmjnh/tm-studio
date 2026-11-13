// =============================================================================
//  tmcut-core — client byte cache law (zero-FFmpeg slice C2b, ADR-033)
//  Pure decisions about a second copy of a media file kept in the browser:
//  keys, budget, eviction — and since G4b, whether PLAYBACK runs off that copy
//  instead of asking the server for the file again, plus which blob URLs the
//  host still needs and which it must hand back.
//  The storage side (OPFS / IndexedDB) lives in app/utils/tmcut/byteStore.ts;
//  nothing here touches a browser API, so both hosts and plain node can run
//  the same budget, key and eviction rules.
// =============================================================================

/** Hard ceiling: a big disk never buys an unbounded cache. */
export const TMCUT_BYTE_CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Share of the device quota the cache may claim. */
export const TMCUT_BYTE_CACHE_QUOTA_SHARE = 0.4

const KEY_PATTERN = /^[0-9a-f]{8}$/

/**
 * A derived artifact — the waveform of a revision, a future filmstrip of it — is
 * not the revision. Its key carries the fingerprint it was cut from, what kind of
 * answer it is, and the version of the law that measured it:
 * `a1b2c3d4-wave-v1`. Kind is a name segment, never a path: no separator, no dot,
 * no character a filesystem or a URL could re-read as one.
 */
const DERIVED_KEY_PATTERN = /^([0-9a-f]{8})-([a-z][a-z0-9]{0,15})-v([1-9][0-9]*)$/

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
 *
 * This is the SOURCE-only answer, and callers that ask "is this a media revision"
 * (frame requests do) must use it, not the union below: a waveform key contains a
 * legal fingerprint and would otherwise be accepted as one.
 */
export function isByteCacheKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key)
}

/** The name segment of a derived key: a lowercase word, digits allowed inside. */
function isByteCacheKind(kind) {
  return typeof kind === 'string' && /^[a-z][a-z0-9]{0,15}$/.test(kind)
}

/**
 * The cache key for one derived artifact of one revision, or null when any part of
 * it is not something the store may name.
 */
export function derivedByteCacheKey(fingerprint, kind, version) {
  if (!isByteCacheKey(fingerprint)) return null
  if (!isByteCacheKind(kind)) return null
  if (!Number.isInteger(version) || version < 1) return null
  return `${fingerprint}-${kind}-v${version}`
}

/** The parts of a derived key, or null when the key names no artifact. */
export function parseDerivedByteCacheKey(key) {
  if (typeof key !== 'string') return null
  const match = DERIVED_KEY_PATTERN.exec(key)
  if (!match) return null
  return { fingerprint: match[1], kind: match[2], version: Number(match[3]) }
}

/** Whether this key names an artifact computed FROM a revision, not the revision. */
export function isDerivedByteCacheKey(key) {
  return parseDerivedByteCacheKey(key) !== null
}

/** Whether this key may name a file in the store at all: a source or an artifact. */
export function isStoredByteCacheKey(key) {
  return isByteCacheKey(key) || isDerivedByteCacheKey(key)
}

/**
 * The revision an entry came from — itself for a source row, the embedded
 * fingerprint for a derived one, null for anything that names nothing.
 * Liveness of an artifact is the liveness of this.
 */
export function byteCacheFingerprint(key) {
  if (isByteCacheKey(key)) return key
  const parsed = parseDerivedByteCacheKey(key)
  return parsed === null ? null : parsed.fingerprint
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
 * An entry whose key is not a legal cache key is reported as `invalid` and removed:
 * it can name no file, so it is only noise in the index.
 *
 * A derived row (a waveform, a filmstrip) is live when its SOURCE is live — the
 * library names revisions, not artifacts, so asking only "is this key in the
 * library" would delete every waveform on the next import. When a revision leaves
 * the library its artifacts leave with it; they are never kept by their own name.
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
    if (!entry || !isStoredByteCacheKey(entry.key)) {
      if (entry && typeof entry.key === 'string') invalid.push(entry.key)
      continue
    }
    if (candidates.some(candidate => candidate.key === entry.key)) continue
    candidates.push({ key: entry.key, bytes: positiveNumber(entry.bytes), accessedAt: positiveNumber(entry.accessedAt) })
  }

  const isLive = key => live.has(key) || live.has(byteCacheFingerprint(key))

  const drop = [...invalid]
  const keep = []
  const doomed = []
  for (const entry of candidates) {
    if (!usableBudget || !isLive(entry.key) || entry.bytes > usableBudget) doomed.push(entry)
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

/**
 * Where one clip's playback bytes come from: the second copy the browser already
 * holds, the server's copy, or neither.
 *
 * The cache holds a waveform under a derived key, and `cached` can be true for it.
 * Only a SOURCE fingerprint may name media bytes to play, so this reads
 * `isByteCacheKey` and not the storage union — the same reason `frames.mjs` refuses
 * to name a frame from a waveform key.
 *
 * `cached` is a fact the caller measured, never something inferred here: this law
 * cannot see OPFS. Anything other than a literal `true` means "not in the cache".
 *
 * @param {{fingerprint?: string|null, cached?: boolean, streamUrl?: string|null}} revision
 * @returns {{kind: 'cache', key: string}
 *   | {kind: 'stream', url: string, reason: string}
 *   | {kind: 'unresolved', reason: string}}
 */
export function planPlaybackByteSource(revision) {
  const { fingerprint, cached, streamUrl } = revision || {}
  const hasRevision = isByteCacheKey(fingerprint)
  if (hasRevision && cached === true) return { kind: 'cache', key: fingerprint }
  const reason = hasRevision ? 'not-cached' : 'no-revision'
  const hasStream = typeof streamUrl === 'string' && streamUrl !== ''
  if (!hasStream) return { kind: 'unresolved', reason }
  return { kind: 'stream', url: streamUrl, reason }
}

/**
 * Which url a media element should be mounting right now.
 *
 * `planPlaybackByteSource` answers WHICH source a clip plays from. This answers
 * WHEN that answer may reach the element. Measured in Chromium: assigning `src`
 * on an element that is playing pauses it and resets `currentTime` to 0, and a
 * file large enough to still be loading reloads from readyState 0 — which fires
 * `waiting` and is the preview's "Buffering…" pill. Slice G4b creates exactly
 * that window on purpose: the stream is mounted first and the client cache's
 * `blob:` arrives when the OPFS read finishes, which after a fresh import is
 * often several seconds later, i.e. after the user pressed Play.
 *
 * So the cache landing mid-play is HELD BACK and reported as `pending`; the
 * caller adopts it the moment playback pauses. `sameMedia` is the caller's fact
 * that the old and new url name the same file — a different clip is a real
 * content change and must never be deferred, or a cut would freeze on the
 * previous picture.
 *
 * An empty answer clears the element instead of keeping the stale url: a clip
 * that went away has no picture, and leaving the old source mounted would show
 * footage the timeline no longer contains.
 *
 * @param {{current?: string|null, desired?: string|null, playing?: boolean, sameMedia?: boolean}} input
 * @returns {{src: string, pending: string|null}}
 */
export function planPlaybackSourceCommit(input) {
  const { current, desired, playing, sameMedia } = input || {}
  const mounted = hasUrl(current) ? current : ''
  const wanted = hasUrl(desired) ? desired : ''

  if (!wanted) return { src: '', pending: null }
  if (wanted === mounted) return { src: mounted, pending: null }
  if (playing === true && sameMedia === true && mounted) return { src: mounted, pending: wanted }
  return { src: wanted, pending: null }
}

function byKey(a, b) {
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

function hasUrl(url) {
  return typeof url === 'string' && url !== ''
}

/**
 * What the host must do to its blob URLs when the set of live revisions changes.
 *
 * `held` maps a revision key to the URL created for it; `wanted` is every revision
 * a surface is mounting right now — the footage plate and the audio element of one
 * clip name the same revision, so the same key arrives many times and still gets
 * one URL. A URL is revoked only when NO surface wants its revision, which is what
 * keeps a shared file from going silent while another element is still playing it.
 *
 * Rows with no URL in them are dropped rather than revoked: a failed create leaves
 * nothing to hand back, and inventing a URL to revoke is a crash.
 *
 * @param {Record<string, string|null>} held
 * @param {Iterable<string>} wanted
 * @returns {{keep: Array<{key: string, url: string}>, create: string[], revoke: Array<{key: string, url: string}>}}
 */
export function planBlobUrlLifecycle(held, wanted) {
  const rows = Object.entries(held || {}).filter(([, url]) => hasUrl(url))
  const need = new Set(Array.from(wanted || []).filter(isByteCacheKey))

  const keep = rows.filter(([key]) => need.has(key)).map(([key, url]) => ({ key, url })).sort(byKey)
  const revoke = rows.filter(([key]) => !need.has(key)).map(([key, url]) => ({ key, url })).sort(byKey)
  const create = [...need].filter(key => !(key in (held || {}))).sort()

  return { keep, create, revoke }
}
