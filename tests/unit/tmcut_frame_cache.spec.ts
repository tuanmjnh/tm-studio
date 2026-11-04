/**
 * Frame requests (zero-FFmpeg slice D, ADR-029/030/033).
 *
 * A thumbnail is one instant of one revision of one file, drawn small. Today
 * the desktop asks FFmpeg `-ss` for it and the web host has no thumbnails at
 * all. This slice makes one law both hosts answer to, and one service that
 * reads the bytes it is allowed to read — including the copy slice C2b kept in
 * the browser, which is the first consumer to read that cache back.
 *
 * What is pinned, in order:
 *  - the identity of a request is (fingerprint, millisecond, width), and the
 *    millisecond is the whole point: two asks for the same instant are one
 *    frame, two asks for different instants are never served from each other;
 *  - the instant is clamped inside the media, so a seek past the end returns
 *    the last real frame instead of asking a decoder for nothing;
 *  - only the newest request for a slot may paint; a scrub asks ten frames and
 *    the user sees one, so the nine that lost the race must be recognised as
 *    stale and released, not applied;
 *  - the frame cache is bounded, and an entry nobody can name is reported
 *    rather than obeyed.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_frame_cache.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** The desktop clamps against a float duration, so equality is a tolerance. */
function closeTo(actual: number | null, expected: number, label: string) {
  assert.notEqual(actual, null, `${label}: asked for a number, got a refusal`)
  assert.ok(Math.abs((actual as number) - expected) < 1e-9, `${label}: ${actual} is not ${expected}`)
}

/** The eight-hex revision fingerprint slice C1 made and C2b wrote bytes under. */
const FP = 'deadbeef'

async function main() {
  console.log('=== [TMCut frame requests] Starting ===\n')
  const core = await import('tmcut-core')

  await check('core owns the frame-request law, not the app', () => {
    for (const name of [
      'frameRequestMillis', 'frameRequestWidth', 'frameRequestKey', 'isFrameCacheKey',
      'frameTimeWithinMedia', 'createFrameSlotLedger', 'planFrameCacheEviction'
    ]) {
      assert.equal(typeof (core as Record<string, unknown>)[name], 'function', `${name} answers from core`)
    }
    assert.ok(Number.isInteger(core.TMCUT_FRAME_MAX_TIME_SEC), 'the ceiling on an unknown duration is a number')
    assert.ok(Number.isInteger(core.TMCUT_FRAME_CACHE_MAX_ENTRIES), 'the frame cache has a stated bound')
  })

  await check('a frame request is the instant it asks for, to the millisecond', () => {
    assert.equal(core.frameRequestMillis(1.2345), 1235, 'the ask rounds, it does not truncate')
    assert.equal(core.frameRequestMillis(1.2344), 1234)
    assert.equal(core.frameRequestMillis(0), 0, 'the first frame is a legal ask')
    assert.equal(core.frameRequestMillis(-0.0001), null, 'before the start there is no frame to ask for')
    assert.equal(core.frameRequestMillis(Number.NaN), null)
    assert.equal(core.frameRequestMillis(Number.POSITIVE_INFINITY), null)
    assert.equal(core.frameRequestMillis('1' as unknown as number), null, 'a string is not a timestamp')
  })

  await check('the width a frame asks for is clamped the same on both hosts', () => {
    assert.equal(core.frameRequestWidth(6400), 1280, 'a 4K ask buys the ceiling, not a 4K decode')
    assert.equal(core.frameRequestWidth(5), 16, 'a postage stamp has a floor too')
    assert.equal(core.frameRequestWidth(320.6), 321, 'whole pixels')
    assert.equal(core.frameRequestWidth(), 320, 'nobody asked for a size, so the library default')
    assert.equal(core.frameRequestWidth(Number.NaN), core.frameRequestWidth(), 'an unusable ask is the default')
  })

  await check('two hosts asking the same frame build the same key', () => {
    const key = core.frameRequestKey(FP, 3, 320)
    assert.equal(key, 'deadbeef-f3000-w320', 'the key is the instant and the size, nothing else')
    assert.equal(core.frameRequestKey(FP, 2.9996, 320), key, '2.9996s is the same millisecond as 3.000s')
    assert.notEqual(core.frameRequestKey(FP, 2.999, 320), key, 'one millisecond earlier is a different frame')
    assert.notEqual(core.frameRequestKey(FP, 3, 160), key, 'a different size is a different decode product')
    assert.notEqual(core.frameRequestKey('00000001', 3, 320), key, 'a different revision is a different file')

    // The desktop names its PNG exactly this way today (electron/tools/
    // tmcut.controller.cjs, extractFrameAt): `${cacheKeyFor()}-f${round(s*1000)}
    // -w${px}`. Parity is asserted against the file, so a desktop key drift is
    // a failing test rather than two caches that quietly stopped agreeing.
    const controller = read('electron/tools/tmcut.controller.cjs')
    assert.match(
      controller,
      /const key = `\$\{cacheKeyFor\(filePath, stat\)\}-f\$\{Math\.round\(wanted \* 1000\)\}-w\$\{px\}`/,
      'the desktop names a frame by fingerprint, millisecond and width'
    )
  })

  await check('a frame key never carries a path or a bad fingerprint', () => {
    assert.equal(core.frameRequestKey('/uploads/a.mp4', 3, 320), null, 'a path is not a revision')
    assert.equal(core.frameRequestKey('DEADBEEF', 3, 320), null, 'the fingerprint is lowercase hex')
    assert.equal(core.frameRequestKey('deadbee', 3, 320), null, 'a truncated digest names nothing')
    assert.equal(core.frameRequestKey('deadbeef0', 3, 320), null, 'a padded digest names nothing')
    assert.equal(core.frameRequestKey(null, 3, 320), null)
    assert.equal(core.frameRequestKey(FP, -1, 320), null, 'a refused instant is not a key')
    assert.equal(core.isFrameCacheKey('deadbeef-f3000-w320'), true)
    for (const junk of ['deadbeef', 'deadbeef-f3000', 'DEADBEEF-f1-w2', 'deadbeef-f-1-w320',
      'deadbeef-f3000-w320.png', '/uploads/a.mp4', '']) {
      assert.equal(core.isFrameCacheKey(junk), false, `${junk} cannot name a cached frame`)
    }
    assert.equal(core.isFrameCacheKey(null), false)
  })

  await check('the decoder is asked inside the media', () => {
    closeTo(core.frameTimeWithinMedia(5, 10), 5, 'an ask inside the file goes through untouched')
    closeTo(core.frameTimeWithinMedia(100, 10), 9.95, 'past the end, the last real frame instead of nothing')
    closeTo(core.frameTimeWithinMedia(0, 10), 0, 'the head is legal')
    closeTo(core.frameTimeWithinMedia(0.02, 0.01), 0, 'a media shorter than the guard still gives frame zero')
  })

  await check('an unknown duration caps instead of pretending', () => {
    const cap = core.TMCUT_FRAME_MAX_TIME_SEC
    assert.equal(cap, 24 * 3600, 'one day, so a bad duration cannot ask for a year')
    closeTo(core.frameTimeWithinMedia(7, 0), 7, 'duration 0 means not known, not empty')
    closeTo(core.frameTimeWithinMedia(7, null), 7, 'null means the same')
    closeTo(core.frameTimeWithinMedia(1e9, null), cap, 'and the cap holds')
    assert.equal(core.frameTimeWithinMedia(-3, 10), null, 'a negative seek is a caller bug, not a clamp')
    assert.equal(core.frameTimeWithinMedia(Number.NaN, 10), null)
  })

  await check('only the newest request for a slot may paint', () => {
    const ledger = core.createFrameSlotLedger()
    const first = ledger.begin('hud', 'deadbeef-f1000-w320')
    assert.equal(first.superseded, null, 'nothing came before the first ask')
    const second = ledger.begin('hud', 'deadbeef-f2000-w320')
    assert.notEqual(second.token, first.token, 'two asks are two tokens')
    assert.equal(second.superseded, first.token, 'and the law says which one just lost')
    assert.equal(ledger.isCurrent('hud', first.token), false, 'the frame that lost the race may not paint')
    assert.equal(ledger.isCurrent('hud', second.token), true)
    assert.equal(ledger.isCurrent('hud', 999_999), false, 'a token nobody issued is not current')
    assert.equal(ledger.isCurrent('nothing-here', second.token), false)
  })

  await check('a token does not travel between slots or across a forget', () => {
    const ledger = core.createFrameSlotLedger()
    const hud = ledger.begin('hud', 'deadbeef-f1000-w320')
    const strip = ledger.begin('strip', 'deadbeef-f2000-w320')
    assert.equal(ledger.isCurrent('hud', hud.token), true)
    assert.equal(ledger.isCurrent('strip', strip.token), true)
    assert.equal(ledger.isCurrent('strip', hud.token), false, 'one clip may not cancel another')
    assert.equal(ledger.size(), 2, 'the ledger counts slots, and forget() is required')
    assert.equal(ledger.forget('hud'), true)
    assert.equal(ledger.forget('hud'), false, 'a slot already gone is not an error')
    assert.equal(ledger.isCurrent('hud', hud.token), false)
    assert.equal(ledger.size(), 1)
    const again = ledger.begin('hud', 'deadbeef-f9000-w320')
    assert.notEqual(again.token, hud.token, 'a forgotten slot never reuses a token')
    assert.equal(again.superseded, null, 'and the fresh ask supersedes nothing')
  })

  await check('the frame cache is bounded and drops the least recently used', () => {
    const entries = [
      { key: 'deadbeef-f1000-w320', accessedAt: 30 },
      { key: 'deadbeef-f2000-w320', accessedAt: 10 },
      { key: 'deadbeef-f3000-w320', accessedAt: 20 }
    ]
    const plan = core.planFrameCacheEviction(entries, 2)
    assert.deepEqual(plan.drop, ['deadbeef-f2000-w320'], 'the oldest access goes first')
    assert.deepEqual(plan.keep.map(entry => entry.key), ['deadbeef-f3000-w320', 'deadbeef-f1000-w320'],
      'survivors stay oldest-first, so the next drop can take the front')
    assert.equal(plan.kept, 2)

    const all = core.planFrameCacheEviction(entries, core.TMCUT_FRAME_CACHE_MAX_ENTRIES)
    assert.deepEqual(all.drop, [], 'under the bound nothing is dropped')

    // A budget that is not a budget must not read as "keep forever".
    for (const bad of [0, -1, Number.NaN]) {
      const refused = core.planFrameCacheEviction(entries, bad)
      assert.equal(refused.keep.length, 0, `a bound of ${bad} keeps nothing`)
      assert.equal(refused.drop.length, 3)
    }

    const leaky = core.planFrameCacheEviction([
      { key: '/uploads/a.mp4', accessedAt: 1 },
      { key: 'deadbeef-f4000-w320', accessedAt: 5 },
      { key: 'deadbeef-f4000-w320', accessedAt: 9 }
    ], 5)
    assert.deepEqual(leaky.invalid, ['/uploads/a.mp4'], 'an entry that names no frame is reported')
    assert.ok(leaky.drop.includes('/uploads/a.mp4'), 'and dropped, not obeyed')
    assert.deepEqual(leaky.keep.map(entry => entry.key), ['deadbeef-f4000-w320'], 'the duplicate collapses')
    assert.equal(leaky.keep[0].accessedAt, 9, 'keeping the later touch, whichever order the rows came in')

    const shuffled = core.planFrameCacheEviction([...entries].reverse(), 2)
    assert.deepEqual(shuffled.drop, plan.drop, 'one messy array still gives one plan')
  })

  await check('core declares the frame-request law to the app', () => {
    // The app types tmcut-core from hand-written declarations, so a runtime
    // export nobody declared is invisible to the app that must call it.
    const dts = read('packages/core/src/index.d.ts')
    for (const name of [
      'frameRequestMillis', 'frameRequestWidth', 'frameRequestKey', 'isFrameCacheKey',
      'frameTimeWithinMedia', 'createFrameSlotLedger', 'planFrameCacheEviction',
      'TMCUT_FRAME_MAX_TIME_SEC', 'TMCUT_FRAME_CACHE_MAX_ENTRIES'
    ]) {
      assert.ok(dts.includes(name), `${name} is declared, not only exported`)
    }
    assert.match(dts, /TmcutFrameCachePlan/, 'the eviction answer has a named shape')
    assert.match(dts, /TmcutFrameSlotLedger/, 'the ledger answer has a named shape')
  })

  console.log(`\n=== All ${passed} frame request checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
