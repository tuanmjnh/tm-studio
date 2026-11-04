/**
 * Filmstrip reader (zero-FFmpeg slice D3, ADR-029/030/033).
 *
 * Slice D2 made one place answer "give me the frame at this instant". Slice D3
 * answers the question the timeline actually asks: "give me eight frames across
 * THIS clip's own source range, and keep the positions when some of them fail".
 * That is a different piece of law, so it is a different module — and it is
 * law, not Vue, so plain Node can test it against a fake decoder.
 *
 * What is pinned, in order:
 *  - the sampled instants are core's (`filmstripTimes`), never a local
 *    `(in+out)/2`-style guess, so both hosts put thumbnails at the same seconds;
 *  - one sampled instant is one ask, and the slot it is asked under is named
 *    for the clip, not for the range — so a remount reuses the frame and a
 *    re-trim retires the older ask instead of racing it;
 *  - a strip that cannot fill every slot still returns every slot: a failed
 *    frame is a hole the asset-level fallback shows through, not a crash and
 *    not a shorter array that shifts the layout;
 *  - an owner that leaves takes its asks with it (`forget`), so a clip deleted
 *    mid-decode stops costing decoder time;
 *  - an unreal range or a junk fingerprint answers "nothing", never throws.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_frame_strip.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import './helpers/tmcut_store_env'
import { blobOf, clearByteIndex, installOpfs } from './helpers/tmcut_browser_storage'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const FP = 'deadbeef'

type Ask = { key: string, atSec: number, width: number, bytes: Blob | null, src: string | null, signal: AbortSignal }

async function main() {
  console.log('=== [TMCut frame strip] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  const core = await import('tmcut-core')

  await check('the strip reader exists as its own module', () => {
    // D2's service answers one frame per ask. Eight frames across a range is a
    // second law and lives in a second file, so the timeline never re-derives
    // sampling maths and the service never learns about clips.
    assert.ok(existsSync(join(root, 'app/utils/tmcut/frameStrip.ts')),
      'app/utils/tmcut/frameStrip.ts must own the per-clip strip')
  })

  const frameStore = await import('../../app/utils/tmcut/frameStore')
  const stripModule = await import('../../app/utils/tmcut/frameStrip')
  const { createStripReader } = stripModule
  const { createFrameService } = frameStore

  function tick(ms = 5) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  /** A hold the check releases by hand, so in-flight asks can be raced. */
  function hold() {
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    return { release: () => release(), waiting }
  }

  function decoder(asks: Ask[], gate?: () => Promise<void>) {
    return async (ask: Ask) => {
      asks.push(ask)
      if (gate) await gate()
      return blobOf(64, 's')
    }
  }

  function storage() {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
  }

  const SRC = 'http://host/clip.mp4'

  await check('one sampled instant is one ask, at core times and strip width', async () => {
    storage()
    const asks: Ask[] = []
    const service = createFrameService(decoder(asks))
    const reader = createStripReader(service)
    const strip = await reader.read({ clipKey: 'clip-1', fingerprint: FP, src: SRC, inSec: 4, outSec: 8, count: 4 })
    assert.equal(strip.length, 4, 'the caller asked for four and got four')
    assert.equal(asks.length, 4, 'no instant decoded twice')

    // The same times core would plan for this range — the strip may not invent
    // its own sampling, or the desktop and web filmstrips drift apart.
    const expected = core.filmstripTimes(core.secToTicks(4), core.secToTicks(4), 4)
    assert.deepEqual(asks.map(a => a.atSec).sort((a, b) => a - b),
      expected.map(t => core.ticksToSec(t)).sort((a, b) => a - b),
      'the instants are core C14 samples of the clip range')
    assert.deepEqual(asks.map(a => a.width).filter(w => w !== 160), [], 'a timeline strip buys 160px frames')
    assert.deepEqual(asks.map(a => a.key).sort(), expected.map(t =>
      core.frameRequestKey(FP, core.ticksToSec(t), 160)).sort(), 'and the key names the frame decoded')
    assert.deepEqual(strip.map(u => u === ''), [false, false, false, false], 'every slot has pixels to show')
  })

  await check('the slots belong to the clip, so a remount reuses the frames', async () => {
    storage()
    const asks: Ask[] = []
    const service = createFrameService(decoder(asks))
    const reader = createStripReader(service)
    const first = await reader.read({ clipKey: 'clip-2', fingerprint: FP, src: SRC, inSec: 0, outSec: 4, count: 4 })
    assert.equal(asks.length, 4, 'the first mount decoded')
    const again = await reader.read({ clipKey: 'clip-2', fingerprint: FP, src: SRC, inSec: 0, outSec: 4, count: 4 })
    assert.equal(asks.length, 4, 'a clip that mounts again does not pay for the same frames twice')
    assert.deepEqual(again, first, 'and is shown the same object URLs')
    assert.equal(service.cached().length, 4, 'the service holds one entry per instant')
  })

  await check('a re-trim retires the older strip instead of racing it', async () => {
    storage()
    const asks: Ask[] = []
    const gate = hold()
    const service = createFrameService(decoder(asks, () => gate.waiting))
    const reader = createStripReader(service)
    const stale = reader.read({ clipKey: 'clip-3', fingerprint: FP, src: SRC, inSec: 0, outSec: 4, count: 2 })
    await tick()
    assert.equal(asks.length, 2, 'the old range asked twice')

    const fresh = reader.read({ clipKey: 'clip-3', fingerprint: FP, src: SRC, inSec: 6, outSec: 10, count: 2 })
    await tick()
    assert.equal(asks.filter(a => a.signal.aborted).length, 2,
      'the asks the user trimmed away are cancelled, they do not paint')
    assert.equal(asks.length, 3, 'the pool is three decoders deep, so the newest strip waits its turn')
    gate.release()
    const oldStrip = await stale
    assert.deepEqual(oldStrip, ['', ''], 'the loser answers holes, never stale pixels')
    const newStrip = await fresh
    assert.deepEqual(newStrip.map(u => u === ''), [false, false], 'only the newest ask paints')
    assert.equal(asks.length, 4, 'and it paid for its own decode when a slot opened')
  })

  await check('a failed frame leaves its slot empty, not the strip shorter', async () => {
    storage()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      if (ask.atSec === core.ticksToSec(core.filmstripTimes(core.secToTicks(0), core.secToTicks(8), 4)[1]!)) {
        return null
      }
      return blobOf(64, 's')
    })
    const reader = createStripReader(service)
    const strip = await reader.read({ clipKey: 'clip-4', fingerprint: FP, src: SRC, inSec: 0, outSec: 8, count: 4 })
    assert.equal(strip.length, 4, 'a hole keeps its position so the layout does not shift')
    assert.equal(strip[1], '', 'the dead instant is the empty one')
    assert.deepEqual([strip[0], strip[2], strip[3]].map(u => String(u).startsWith('blob:')), [true, true, true],
      'and the live instants still show')
  })

  await check('an owner that leaves takes its asks with it', async () => {
    storage()
    const asks: Ask[] = []
    const gate = hold()
    const service = createFrameService(decoder(asks, () => gate.waiting))
    const reader = createStripReader(service)
    const pending = reader.read({ clipKey: 'clip-5', fingerprint: FP, src: SRC, inSec: 0, outSec: 8, count: 4 })
    await tick()
    assert.equal(asks.length, 3, 'one strip of four asks opens three decoders, the pool core names — the fourth waits')
    const released = reader.forget('clip-5')
    assert.equal(released, 4, 'every slot this strip owns is handed back')
    assert.equal(reader.forget('clip-5'), 0, 'forgetting a strip that already left is not an error')
    gate.release()
    const strip = await pending
    assert.deepEqual(strip, ['', '', '', ''], 'a deleted clip stops being painted')
    assert.equal(asks.length, 3, 'the ask that never got a slot never opened a decoder')
    assert.deepEqual(asks.map(a => a.signal.aborted), [true, true, true], 'and running decoders are cancelled')
  })

  await check('an unreal range asks for nothing', async () => {
    storage()
    const asks: Ask[] = []
    const service = createFrameService(decoder(asks))
    const reader = createStripReader(service)
    for (const [inSec, outSec] of [[4, 4], [5, 3], [Number.NaN, 8], [0, Number.POSITIVE_INFINITY]] as Array<[number, number]>) {
      assert.deepEqual(await reader.read({ clipKey: 'clip-6', fingerprint: FP, src: SRC, inSec, outSec }), [],
        `${inSec}..${outSec} holds no frames`)
    }
    assert.deepEqual(await reader.read({ clipKey: 'clip-6', fingerprint: FP, src: SRC, inSec: 0, outSec: 4, count: 0 }), [],
      'a zero-slot strip is not a strip')
    assert.deepEqual(asks, [], 'and none of them opened a decoder')
  })

  await check('a junk fingerprint is a strip of holes, not a throw', async () => {
    storage()
    const asks: Ask[] = []
    const service = createFrameService(decoder(asks))
    const reader = createStripReader(service)
    const strip = await reader.read({ clipKey: 'clip-7', fingerprint: '/uploads/a.mp4', src: SRC, inSec: 0, outSec: 8, count: 4 })
    assert.deepEqual(strip, ['', '', '', ''], 'the timeline keeps its asset-level fallback')
    assert.deepEqual(asks, [], 'a frame of no revision is not a seek')
  })

  // -------------------------------------------------------------------------
  // Wiring: the composable and the three consumers. The law is only shared
  // once the desktop IPC path stops being the only way to get a thumbnail.
  // -------------------------------------------------------------------------

  await check('the composable delegates the clip strip to the shared service', () => {
    const composable = read('app/composables/useTmcutFrames.ts')
    assert.ok(composable.includes('createStripReader'), 'clipFilmstrip is the reader, not a batch of IPC calls')
    assert.ok(composable.includes('frameStrip'), 'and it comes from the frame pipeline both hosts share')
    assert.ok(/return\s+\{\s*available,\s*extractFrame,\s*extractFrames,\s*clipFilmstrip,\s*forgetStrip\s*\}/.test(composable),
      'timeline callers keep the same method names and gain the one way to leave')
    assert.ok(!/MAX_CONCURRENT_FRAMES/.test(composable),
      'the renderer no longer keeps a second pool: core names the only bound')
  })

  await check('the timeline clip and the analysis grid show strips on web too', () => {
    const timeline = read('app/components/tmcut/TmcutTimelineClip.vue')
    const autocut = read('app/pages/tmcut/autocut.vue')
    for (const [name, source] of [['TmcutTimelineClip.vue', timeline], ['autocut.vue', autocut]] as const) {
      const gated = /canExtractFrames[\s\S]{0,120}(clipFilmstrip|extractFrames)/
      assert.ok(!gated.test(source), `${name} must not gate a display strip on the desktop IPC`)
    }
    assert.ok(timeline.includes('forgetStrip'), 'a leaving clip hands its slots back')
    assert.ok(/clipFilmstrip\(\{[\s\S]{0,300}clipKey: props\.clip\.id[\s\S]{0,300}fingerprint:/.test(timeline),
      'the ask names the clip and the revision, which is what makes a slot stable')
    assert.ok(autocut.includes('mediaUrl'), 'the analysis row still resolves what it is shown')
  })

  await check('the HUD snapshot keeps reporting a file, so it stays desktop-only', () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    assert.ok(/extractFrame\(/.test(player), 'the snapshot asks the IPC leg')
    assert.ok(/v-if="canExtractFrames[\s\S]{0,400}@click="snapshotFrame"/.test(player),
      'and the control hides itself where there is no IPC — it names a saved PNG path')
    assert.ok(!/clipFilmstrip|requestFrame/.test(player), 'the player does not grow a second frame path')
  })

  console.log(`\n=== [TMCut frame strip] ${passed}/${passed} specs passed ===`)
}

main().catch((err) => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
