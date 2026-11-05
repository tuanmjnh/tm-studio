/**
 * Playback reads its bytes from the client cache (zero-FFmpeg slice G4b, ADR-033).
 *
 * ADR-033 has two halves. C2b closed the first: the browser keeps a second copy of
 * every imported revision. This closes the second — playback must RUN off that copy
 * instead of asking the server for the file again. The audit measured the gap: a
 * route sweep recorded `GET /uploads/… [206]` on every play, three times, while the
 * same bytes already sat in OPFS (slice D2 reads them for frames, G2 for waveforms,
 * E4 for silence — everything except the thing the user actually hears).
 *
 * The decision itself is core's (`planPlaybackByteSource`, `planBlobUrlLifecycle` in
 * byteCache.mjs — both pinned in packages/core/test/byte-cache-playback.test.mjs).
 * What this file pins is the host seam: the one object that turns that answer into a
 * real `blob:` URL and hands it back when no surface wants it. Four facts the
 * browser forces make that worth a test rather than a line of code:
 *
 *  * A revision is mounted by SEVERAL surfaces at once — the footage plate and the
 *    `<audio>` element of one clip, or two clips over one file. A `createObjectURL`
 *    per mount leaks one file per render pass, and revoking on the first unmount
 *    silences a clip another element is still playing. So the ledger is keyed by
 *    revision and one url serves every mount.
 *  * Reading is async and playback is not. A surface cannot wait for OPFS, so the
 *    stream url answers first and the blob replaces it when the bytes land — and the
 *    swap has to be visible to a reactive host, or every computed keeps the src it
 *    first read and the slice silently does nothing. Hence the ledger is the host's
 *    (`ledger`/`setLedger`), written as a whole new record so a `shallowRef` fires.
 *  * The index can name bytes the store no longer has (a browser reclaim). A read
 *    that returns nothing is a stream, not a broken clip.
 *  * A read is slower than a scrub. A url made for a revision that left the screen
 *    while its bytes were in flight is named by nothing and revoked by nobody.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_playback_bytes.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPlaybackBytes } from '../../app/utils/tmcut/playbackBytes'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const FP_A = 'a1b2c3d4'
const FP_B = 'deadbeef'

type Deferred = { promise: Promise<Blob | null>, resolve: (value: Blob | null) => void }

function deferred(): Deferred {
  let resolve = () => {}
  const promise = new Promise<Blob | null>((res) => {
    resolve = res as (value: Blob | null) => void
  })
  return { promise, resolve: resolve as (value: Blob | null) => void }
}

/**
 * A fake host: counts every browser call the seam makes, and holds the ledger the
 * way a Vue component would — one record, replaced whole on every write.
 */
function fakeHost(options: {
  fingerprints?: Record<string, string | null>
  cached?: string[]
  read?: (key: string) => Promise<Blob | null>
} = {}) {
  const calls = { reads: [] as string[], created: [] as string[], revoked: [] as string[], writes: 0 }
  let state: Record<string, string> = {}
  let seq = 0
  return {
    calls,
    fingerprintFor: (src: string) => (options.fingerprints ?? {})[src] ?? null,
    cachedKeys: () => new Set(options.cached ?? []),
    readBytes: options.read ?? (async (key: string) => {
      calls.reads.push(key)
      return new Blob([key])
    }),
    createUrl: () => {
      seq++
      calls.created.push(`blob:host/${seq}`)
      return `blob:host/${seq}`
    },
    revokeUrl: (url: string) => { calls.revoked.push(url) },
    ledger: () => state,
    setLedger: (next: Record<string, string>) => {
      calls.writes++
      // Replaced whole, exactly as the `shallowRef` host does: the seam's contract
      // is a new record, never a mutation the holder could not see.
      state = next
    }
  }
}

async function main() {
  await check('a revision the cache holds plays from its blob url', async () => {
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A }, cached: [FP_A] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4'])
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), 'blob:host/1')
  })

  await check('the stream url answers while bytes are read, and the blob replaces it', async () => {
    const gate = deferred()
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A }, cached: [FP_A], read: () => gate.promise })
    const bytes = createPlaybackBytes(host)
    const pending = bytes.sync(['a.mp4'])
    // A surface that asks before the read lands is not blocked, and not left on cache.
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
    gate.resolve(new Blob(['bytes']))
    await pending
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), 'blob:host/1')
    assert.equal(host.calls.writes, 1, 'the ledger was handed a new record, so a reactive host re-reads it')
  })

  await check('one revision mounted by two surfaces is read and created once', async () => {
    const host = fakeHost({
      fingerprints: { 'video.mp4': FP_A, 'audio.mp4': FP_A, 'other.mp4': FP_B },
      cached: [FP_A, FP_B]
    })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['video.mp4', 'audio.mp4'])
    assert.deepEqual(host.calls.reads, [FP_A], 'the same file must not be read per mount')
    assert.equal(host.calls.created.length, 1)
    assert.equal(bytes.srcFor('video.mp4', '/uploads/v.mp4'), bytes.srcFor('audio.mp4', '/uploads/a.mp4'))
  })

  await check('a sync while a read is in flight does not start a second read', async () => {
    const gate = deferred()
    const reads: string[] = []
    const host = fakeHost({
      fingerprints: { 'a.mp4': FP_A },
      cached: [FP_A],
      read: async (key) => {
        reads.push(key)
        return gate.promise
      }
    })
    const bytes = createPlaybackBytes(host)
    const first = bytes.sync(['a.mp4'])
    const second = bytes.sync(['a.mp4'])
    gate.resolve(new Blob(['bytes']))
    await Promise.all([first, second])
    assert.deepEqual(reads, [FP_A], 'the second pass joined the read already running')
    assert.equal(host.calls.created.length, 1)
  })

  await check('a revision no surface wants any more gives its url back', async () => {
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A, 'b.mp4': FP_B }, cached: [FP_A, FP_B] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4', 'b.mp4'])
    const urlOfB = bytes.srcFor('b.mp4', '/uploads/b.mp4')
    assert.match(urlOfB, /^blob:host\//)
    await bytes.sync(['a.mp4'])
    assert.deepEqual(host.calls.revoked, [urlOfB], 'only the revision that left the screen is freed')
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), 'blob:host/1', 'the kept one is untouched')
    assert.deepEqual(host.calls.reads, [FP_A, FP_B], 'nothing was re-read for the second pass')
  })

  await check('the same wanted set twice creates nothing and revokes nothing', async () => {
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A }, cached: [FP_A] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4'])
    await bytes.sync(['a.mp4'])
    assert.equal(host.calls.created.length, 1)
    assert.deepEqual(host.calls.revoked, [])
    assert.equal(host.calls.writes, 1, 'a pass with nothing to say does not wake the host')
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), 'blob:host/1')
  })

  await check('leaving the preview revokes every url held', async () => {
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A, 'b.mp4': FP_B }, cached: [FP_A, FP_B] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4', 'b.mp4'])
    // One write per url that landed: the reads finish whenever OPFS finishes, so a
    // host is woken once per arrival rather than once per pass.
    assert.equal(host.calls.writes, 2)
    const before = host.calls.writes
    bytes.releaseAll()
    assert.deepEqual(host.calls.revoked.sort(), ['blob:host/1', 'blob:host/2'])
    assert.equal(host.calls.writes, before + 1, 'the emptied ledger is written too')
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4', 'nothing is held any more')
  })

  await check('bytes the index names but the store cannot return do not break playback', async () => {
    const host = fakeHost({
      fingerprints: { 'a.mp4': FP_A },
      cached: [FP_A],
      read: async () => null
    })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4'])
    assert.deepEqual(host.calls.created, [], 'no url for bytes that are not there')
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
    await bytes.sync(['a.mp4'])
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
  })

  await check('a revision that leaves the screen before its bytes land is not mounted', async () => {
    // The read is async and a scrub is faster than OPFS. A url made for a revision
    // nobody is showing is a leak nothing will revoke, because the ledger already
    // stopped naming its key.
    const gate = deferred()
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A }, cached: [FP_A], read: () => gate.promise })
    const bytes = createPlaybackBytes(host)
    const pending = bytes.sync(['a.mp4'])
    await bytes.sync([])
    gate.resolve(new Blob(['bytes']))
    await pending
    assert.deepEqual(host.calls.created, [], 'no url for a revision no surface wants')
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
    assert.deepEqual(host.calls.revoked, [], 'and nothing was revoked that was never made')
  })

  await check('a clip whose src names no revision never asks the cache', async () => {
    const host = fakeHost({ fingerprints: {}, cached: [] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['mystery.mp4'])
    assert.deepEqual(host.calls.reads, [])
    assert.equal(bytes.srcFor('mystery.mp4', '/uploads/mystery.mp4'), '/uploads/mystery.mp4')
  })

  await check('a derived key is never treated as a media revision', async () => {
    // A mis-wired caller handing back a waveform key must not put peaks in a <video>.
    const host = fakeHost({ fingerprints: { 'a.mp4': 'a1b2c3d4-wave-v1' }, cached: ['a1b2c3d4-wave-v1'] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4'])
    assert.deepEqual(host.calls.reads, [])
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
  })

  await check('nothing cached means no reads at all', async () => {
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A }, cached: [] })
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4'])
    assert.deepEqual(host.calls.reads, [], 'a revision the store does not have is not worth a promise')
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
  })

  await check('a cache that cannot answer is not an error', async () => {
    const host = fakeHost({ fingerprints: { 'a.mp4': FP_A } })
    host.cachedKeys = () => {
      throw new Error('storage blocked by the browser')
    }
    const bytes = createPlaybackBytes(host)
    await bytes.sync(['a.mp4'])
    assert.equal(bytes.srcFor('a.mp4', '/uploads/a.mp4'), '/uploads/a.mp4')
  })

  await check('an unresolved clip gets no src at all — never an empty attribute', async () => {
    const host = fakeHost({ fingerprints: {} })
    const bytes = createPlaybackBytes(host)
    assert.equal(bytes.srcFor('gone.mp4', ''), '', 'the caller must skip the surface, not point it at nothing')
  })

  await check('both preview legs ask the seam, and only one module reads playback bytes', async () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    // The audio leg (G4a reads mediaTicks + rate from the plan) and the footage leg
    // (`playableSrc`, F2b) both have to run through the same source answer, or one
    // leg streams while the other reads OPFS and the two clocks drift apart again.
    assert.match(player, /playbackBytes/, 'the player holds the byte-source seam')
    assert.match(player, /srcFor/, 'and resolves every surface through it')
    const seam = read('app/composables/useTmcutPlaybackBytes.ts')
    assert.match(seam, /createPlaybackBytes/, 'the seam is built once per preview')
    assert.match(seam, /shallowRef/, 'the ledger lives in a reactive holder, so the swap re-renders')
    const law = read('app/utils/tmcut/playbackBytes.ts')
    assert.match(law, /planPlaybackByteSource/, 'the decision is core\'s')
    assert.match(law, /planBlobUrlLifecycle/, 'the retirement is core\'s')
    assert.match(law, /readCachedBytes/, 'and this is where the bytes are read')
    const readers = ['app/components/tmcut/TmcutPreviewPlayer.vue', 'app/composables/useTmcutPlayback.ts']
    for (const file of readers) {
      assert.doesNotMatch(read(file), /readCachedBytes/, `${file} must not read bytes on its own`)
    }
  })

  console.log(`\n=== All ${passed} playback-byte-source checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
