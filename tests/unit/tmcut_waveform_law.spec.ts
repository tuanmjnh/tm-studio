/**
 * Waveform law + derived cache key reach the app through core (zero-FFmpeg slice G1).
 *
 * Slice G's exit criterion is a waveform that is generated AND re-read from the
 * client cache, so the two halves have to exist as one law before the app wires
 * them: a reducer that reads the scale the decoder actually returns, and an
 * envelope that says which algorithm produced the bars. Both live in core for the
 * same reason the byte-cache law does — the web host and the desktop host must not
 * grow two answers.
 *
 * The second thing this file guards is a widening that would have been a bug:
 * `frames.mjs` asks `isByteCacheKey(fingerprint)` before it will name a frame, and a
 * derived key (`a1b2c3d4-wave-v1`) CONTAINS a legal fingerprint. If the byte-cache
 * predicate had been broadened to accept derived keys, a waveform key would have
 * been accepted as a media revision. It was not, and check 5 proves it by calling
 * the real functions.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_waveform_law.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const core = await import('tmcut-core')
const { floatPeakBuckets, buildWaveformPayload, readWaveformPayload, TMCUT_WAVEFORM_ALGORITHM } = core

async function main() {
  console.log('=== [TMCut waveform law] Starting ===\n')

  await check('the float law is exported through the alias the app imports', () => {
    for (const name of ['floatPeakBuckets', 'buildWaveformPayload', 'readWaveformPayload', 'TMCUT_WAVEFORM_ALGORITHM', 'TMCUT_WAVEFORM_PEAK_PRECISION']) {
      assert.ok(name in core, `tmcut-core does not provide ${name}`)
    }
    // app/utils/tmcut/waveform.ts is the strangler module that keeps old import
    // paths alive; a law that stops there is a law the app cannot use.
    const source = read('app/utils/tmcut/waveform.ts')
    for (const name of ['floatPeakBuckets', 'buildWaveformPayload', 'readWaveformPayload']) {
      assert.ok(source.includes(name), `${name} is not re-exported to the app`)
    }
    assert.match(source, /from 'tmcut-core'/, 'the app module stopped delegating to core')
  })

  await check('core declares the waveform law, not only exports it', () => {
    // The app types tmcut-core from hand-written declarations, so a runtime
    // export nobody declared is invisible to the caller that must use it.
    const dts = read('packages/core/src/index.d.ts')
    for (const name of [
      'TMCUT_WAVEFORM_ALGORITHM', 'TMCUT_WAVEFORM_PEAK_PRECISION', 'floatPeakBuckets',
      'buildWaveformPayload', 'readWaveformPayload'
    ]) {
      assert.ok(dts.includes(name), `${name} is not declared in index.d.ts`)
    }
    assert.match(dts, /TmcutWaveformPayload/, 'the cached record has a named shape')
  })

  await check('the app-facing reducer answers on the scale the decoder returns', () => {
    // decodePcm hands back Float32 in −1..1. Measured through the alias, because
    // the scale mistake is exactly the thing a port to the app would repeat.
    const pcm = Float32Array.from([0, 0.5, -0.25, 0.1])
    assert.deepEqual(floatPeakBuckets([pcm], 2), [0.5, 0.25])
    assert.ok(core.int16ToPeaks(pcm, 2)[0] < 1e-4,
      'and the int16 reducer really is the wrong tool here, not a second opinion')
  })

  await check('a cached waveform round-trips and a stale stamp is refused', () => {
    const payload = buildWaveformPayload({ peaks: [0.5, 0.25], sampleRate: 8000, channelCount: 1, durationSec: 4 })
    assert.equal(payload.algorithm, TMCUT_WAVEFORM_ALGORITHM)
    assert.deepEqual(readWaveformPayload(JSON.parse(JSON.stringify(payload))), payload,
      'OPFS and IndexedDB both hand back a structured clone, so the read is a round trip')
    assert.equal(readWaveformPayload({ ...payload, algorithm: 'rms-v9' }), null,
      'bars measured another way are not these bars')
    assert.equal(buildWaveformPayload({ peaks: [], sampleRate: 8000, channelCount: 1, durationSec: 4 }), null,
      'a failed decode stores nothing, so it cannot come back as silence')
  })

  await check('a derived key is never taken for a media revision', () => {
    // The hazard check 1's law creates: derived keys live in the same store, and a
    // predicate that accepted both would let frameRequestKey name a waveform.
    const derived = core.derivedByteCacheKey('a1b2c3d4', 'wave', 1)
    assert.equal(derived, 'a1b2c3d4-wave-v1')
    assert.equal(core.isByteCacheKey(derived), false, 'isByteCacheKey stayed the source-only answer')
    assert.equal(core.isStoredByteCacheKey(derived), true, 'the store takes the union explicitly')
    assert.equal(core.frameRequestKey(derived, 1.5, 320), null, 'a frame cannot be keyed by an artifact')
    assert.equal(core.frameRequestKey('a1b2c3d4', 1.5, 320), 'a1b2c3d4-f1500-w320', 'the real revision still keys')
    const frames = read('packages/core/src/frames.mjs')
    assert.ok(frames.includes('isByteCacheKey(fingerprint)'), 'frames.mjs asks the source-only predicate')
    assert.doesNotMatch(frames, /isStoredByteCacheKey/, 'frames.mjs never asks the union')
  })

  await check('an artifact is kept by its source, not by its own name', () => {
    // The library names revisions. If eviction asked for the artifact key in
    // `liveKeys`, every waveform would be deleted on the next import of a project.
    const plan = core.planByteCacheEviction(
      [{ key: 'a1b2c3d4-wave-v1', bytes: 4, accessedAt: 1 }, { key: 'ffffffff-wave-v1', bytes: 4, accessedAt: 2 }],
      100,
      ['a1b2c3d4']
    )
    assert.deepEqual(plan.drop, ['ffffffff-wave-v1'], 'the artifact of a gone revision goes with it')
    assert.deepEqual(plan.invalid, [], 'a legal key with a dead source is not a corrupt index row')
    assert.equal(core.byteCacheFingerprint('a1b2c3d4-wave-v2'), 'a1b2c3d4')
  })

  console.log(`\n=== Waveform law: ${passed}/${passed} checks PASSED ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
