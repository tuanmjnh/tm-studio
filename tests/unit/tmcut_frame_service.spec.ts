/**
 * Frame service (zero-FFmpeg slice D2, ADR-029/030/033).
 *
 * Slice D1 put the identity of one thumbnail in core. This slice is the one
 * place in `app/` that turns such an identity into pixels, so both hosts get
 * their frames from the same code path and the web host gets thumbnails for
 * the first time. The decode itself is Mediabunny + WebCodecs and lives in
 * `frameDecode.ts`; everything around it is law and is testable in plain Node
 * against a fake decoder.
 *
 * What is pinned, in order:
 *  - the pool bound is core's, and it matches the desktop pool it replaces, so
 *    the two hosts cannot both decide to run five decoders at a player;
 *  - the bytes come from the client cache first: the copy slice C2b wrote is
 *    read back here, which is the reason that slice exists;
 *  - one frame is decoded once, whoever asks — a filmstrip and a player HUD
 *    wanting the same instant share;
 *  - only the newest ask for a slot paints, and the loser is aborted; its
 *    bytes stay cached, because a frame the user scrubbed past is exactly the
 *    frame they may scrub back to;
 *  - nothing throws at a UI: a bad fingerprint, a dead decoder or a browser
 *    with no storage answers null and the caller keeps its placeholder.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_frame_service.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import './helpers/tmcut_store_env'
import { blobOf, clearByteIndex, installNoStorage, installOpfs } from './helpers/tmcut_browser_storage'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const FP = 'deadbeef'
const WAV = '00000001'

function walkApp(dir: string, prefix = 'app'): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = `${prefix}/${entry}`
    if (statSync(full).isDirectory()) out.push(...walkApp(full, rel))
    else if (/\.(ts|vue)$/.test(entry)) out.push(rel)
  }
  return out
}

async function main() {
  console.log('=== [TMCut frame service] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  const core = await import('tmcut-core')

  await check('core owns the decoder pool bound, not the app', () => {
    assert.equal(typeof core.TMCUT_FRAME_MAX_CONCURRENT, 'number', 'the pool size answers from core')
    assert.ok(Number.isInteger(core.TMCUT_FRAME_MAX_CONCURRENT), 'a pool size is a whole number of decoders')
    assert.ok(core.TMCUT_FRAME_MAX_CONCURRENT > 0, 'at least one decode must be allowed to run')
    const dts = read('packages/core/src/index.d.ts')
    assert.ok(dts.includes('TMCUT_FRAME_MAX_CONCURRENT'), 'the app must be able to see the bound')
  })

  await check('both hosts run the same number of decoders', () => {
    // The desktop already bounds its `-ss` pool (useTmcutFrames.ts) because N
    // clips mounting at once must not spawn N × 3 processes. The shared service
    // inherits that bound, so parity is a test, not a hope.
    const composable = read('app/composables/useTmcutFrames.ts')
    const desktop = /const MAX_CONCURRENT_FRAMES = (\d+)/.exec(composable)
    assert.ok(desktop, 'the desktop still states its pool bound')
    assert.equal(Number(desktop![1]), core.TMCUT_FRAME_MAX_CONCURRENT,
      'one frame pipeline means one pool size')
  })

  // -------------------------------------------------------------------------
  // The service. The decoder is the one thing Node cannot run (no WebCodecs),
  // so it is injected; everything around it — which bytes, which ask, who may
  // paint, what is still held — is real code under test.
  // -------------------------------------------------------------------------

  const created: string[] = []
  const revoked: string[] = []
  const realCreate = URL.createObjectURL.bind(URL)
  const realRevoke = URL.revokeObjectURL.bind(URL)
  ;(URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (blob: Blob) => {
    const url = realCreate(blob)
    created.push(url)
    return url
  }
  ;(URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = (url: string) => {
    revoked.push(url)
    realRevoke(url)
  }

  const store = await import('../../app/utils/tmcut/byteStore')
  const frameStore = await import('../../app/utils/tmcut/frameStore')
  const { createFrameService } = frameStore

  /** One decoder call, as the service hands it to `frameDecode.ts`. */
  type Ask = { key: string, atSec: number, width: number, bytes: Blob | null, src: string | null, signal: AbortSignal }

  function recordingDecoder(asks: Ask[], wait?: (index: number) => Promise<void>) {
    return async (ask: Ask) => {
      asks.push(ask)
      if (wait) await wait(asks.length - 1)
      return blobOf(64, 'p')
    }
  }

  /** Let the queues drain, so what is in flight right now can be observed. */
  function tick(ms = 5) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  /** A hold the check releases by hand, so two asks can be raced on purpose. */
  function hold() {
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    return {
      release,
      async wait() {
        await waiting
      }
    }
  }

  function frameUrl(url: string | null) {
    assert.ok(url, 'the service answered with a location to show')
    assert.ok(String(url).startsWith('blob:'), `a frame is an object URL, not a path: ${url}`)
    return String(url)
  }

  await check('the frame cache is read before any decoder opens', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    assert.equal(await store.putCachedBytes(FP, blobOf(5000, 'm'), new Set([FP])), true, 'the C2b write leg stored it')

    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    const url = await service.request({ slot: 'hud', fingerprint: FP, atSec: 3, src: 'http://host/media/a.mp4' })
    assert.ok(frameUrl(url))
    assert.equal(asks.length, 1, 'one ask, one decode')
    assert.equal(asks[0]!.bytes?.size, 5000, 'the decoder is handed the browser copy, byte for byte')
    assert.equal(asks[0]!.src, null, 'and never reaches for the network when it has the file')
  })

  await check('no cached copy, the location is what the decoder reads', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()

    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    const url = await service.request({ slot: 'hud', fingerprint: WAV, atSec: 1, src: 'media://local/a.mp4' })
    assert.ok(frameUrl(url))
    assert.equal(asks[0]!.bytes, null, 'the cache said it had nothing')
    assert.equal(asks[0]!.src, 'media://local/a.mp4', 'so the desktop file scheme is the source')
  })

  await check('a frame with nothing to read is refused, not decoded', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    assert.equal(await service.request({ slot: 'hud', fingerprint: WAV, atSec: 1 }), null,
      'no cached bytes and no location: there is no frame to ask for')
    assert.deepEqual(asks, [], 'the decoder never opened')
  })

  await check('a browser with no byte store still gets its frames', async () => {
    clearByteIndex()
    installNoStorage()
    store.resetByteStoreProbe()
    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    const url = await service.request({ slot: 'hud', fingerprint: FP, atSec: 2, src: 'http://host/a.mp4' })
    assert.ok(frameUrl(url), 'the cache being off is not a reason to show nothing')
    assert.equal(asks[0]!.bytes, null)
    assert.equal(asks[0]!.src, 'http://host/a.mp4')
  })

  await check('a request with no legal fingerprint never reaches a decoder', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    for (const junk of [undefined, null, '', '/uploads/a.mp4', 'DEADBEEF', 'deadbee'] as Array<string | null | undefined>) {
      assert.equal(await service.request({ slot: 'hud', fingerprint: junk, atSec: 1, src: 'http://host/a.mp4' }),
        null, `${junk} names no revision`)
    }
    assert.equal(await service.request({ slot: 'hud', fingerprint: FP, atSec: -1, src: 'http://host/a.mp4' }), null,
      'a seek before the start is a caller bug, not a frame')
    assert.deepEqual(asks, [], 'and none of them opened a decoder')
    assert.deepEqual(heldKeys(service), [], 'nothing was cached either')
  })

  await check('the decoder is asked inside the media, at the width it can pay for', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    await service.request({ slot: 'hud', fingerprint: FP, atSec: 90, durationSec: 10, width: 6000, src: 'http://host/a.mp4' })
    assert.equal(asks[0]!.atSec, 9.95, 'past the end, the last real frame')
    assert.equal(asks[0]!.width, 1280, 'a 4K ask buys the ceiling')
    assert.equal(asks[0]!.key, 'deadbeef-f9950-w1280', 'and the key is the frame actually decoded')
    assert.equal(core.frameRequestKey(FP, 9.95, 1280), asks[0]!.key, 'core agrees on the name')
  })

  await check('two asks for one frame are one decode', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const gate = hold()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      await gate.wait()
      return blobOf(64, 'p')
    })
    const hud = service.request({ slot: 'hud', fingerprint: FP, atSec: 3, width: 320, src: 'http://host/a.mp4' })
    await tick()
    const strip = service.request({ slot: 'strip-1', fingerprint: FP, atSec: 3, width: 320, src: 'http://host/a.mp4' })
    assert.equal(service.inFlight(), 1, 'the second ask joined the first instead of opening a decoder')
    gate.release()
    const firstUrl = frameUrl(await hud)
    assert.equal(frameUrl(await strip), firstUrl, 'both callers are shown the same frame')
    assert.equal(asks.length, 1, 'one decode for two viewers')
  })

  await check('the same slot asking the same frame again keeps its decode', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const gate = hold()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      await gate.wait()
      return blobOf(64, 'p')
    })
    const stale = service.request({ slot: 'hud', fingerprint: FP, atSec: 3, width: 320, src: 'http://host/a.mp4' })
    await tick()
    const newest = service.request({ slot: 'hud', fingerprint: FP, atSec: 3, width: 320, src: 'http://host/a.mp4' })
    await tick()
    assert.equal(asks.length, 1, 'a player that asks the same instant twice does not decode it twice')
    assert.equal(asks[0]!.signal.aborted, false, 'and a repeat ask does not cancel the decode it is waiting on')
    gate.release()
    assert.equal(await stale, null, 'the older ask is still the one that lost')
    assert.ok(frameUrl(await newest))
  })

  await check('the frame cache answers a repeat ask without a decoder', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const asks: Ask[] = []
    const service = createFrameService(recordingDecoder(asks))
    const ask = { slot: 'hud', fingerprint: FP, atSec: 3, width: 320, src: 'http://host/a.mp4' }
    const url = frameUrl(await service.request(ask))
    assert.equal(asks.length, 1)
    const again = frameUrl(await service.request({ ...ask, slot: 'grid' }))
    assert.equal(again, url, 'a remount shows the frame it already has')
    assert.equal(asks.length, 1, 'and did not decode a second time')
  })

  await check('a newer ask for the same slot retires the older one', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const gates = [hold(), hold()]
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      await gates[asks.length - 1]!.wait()
      return blobOf(64, 'p')
    })
    const stale = service.request({ slot: 'hud', fingerprint: FP, atSec: 1, src: 'http://host/a.mp4' })
    await tick()
    assert.equal(asks.length, 1, 'the scrub started decoding')
    const fresh = service.request({ slot: 'hud', fingerprint: FP, atSec: 2, src: 'http://host/a.mp4' })
    await tick()
    assert.equal(asks.length, 2, 'the newest seek is its own decode')
    assert.equal(asks[0]!.signal.aborted, true, 'the frame that lost the race is cancelled, not left running')
    gates[0]!.release()
    assert.equal(await stale, null, 'and its bytes never paint')
    gates[1]!.release()
    assert.ok(frameUrl(await fresh))
    assert.ok(heldKeys(service).includes('deadbeef-f1000-w320'),
      'but the scrubbed-past frame stays cached — the user can scrub back')
  })

  await check('unmounting a slot stops its pending ask from painting', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const gate = hold()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      await gate.wait()
      return blobOf(64, 'p')
    })
    const pending = service.request({ slot: 'clip-7', fingerprint: FP, atSec: 4, src: 'http://host/a.mp4' })
    await tick()
    assert.equal(service.forget('clip-7'), true, 'the ledger drops the slot the component left')
    assert.equal(service.forget('clip-7'), false, 'and forgetting twice is not an error')
    gate.release()
    assert.equal(await pending, null, 'a frame with nobody to show it to is not painted')
    assert.equal(asks[0]!.signal.aborted, true, 'and the decode is stopped, not finished for nothing')
  })

  await check('at most the stated number of decoders run at once', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    let active = 0
    let peak = 0
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      active += 1
      peak = Math.max(peak, active)
      await tick()
      active -= 1
      return blobOf(64, 'p')
    })
    const eight = Array.from({ length: 8 }, (_, index) =>
      service.request({ slot: `strip-${index}`, fingerprint: FP, atSec: index + 1, src: 'http://host/a.mp4' }))
    await tick(30)
    assert.ok(peak <= core.TMCUT_FRAME_MAX_CONCURRENT, `a filmstrip row peaked at ${peak} decoders`)
    assert.equal(peak, core.TMCUT_FRAME_MAX_CONCURRENT, 'the pool is used, not idled')
    const urls = await Promise.all(eight)
    assert.equal(urls.filter(url => url).length, 8, 'every ask was answered')
    assert.equal(asks.length, 8)
  })

  await check('a decoder that fails answers null and caches nothing', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    let calls = 0
    const service = createFrameService(async (ask: Ask) => {
      calls += 1
      if (ask.atSec < 1) throw new Error('no keyframe at the head')
      return null
    })
    assert.equal(await service.request({ slot: 'a', fingerprint: FP, atSec: 0, src: 'http://host/a.mp4' }), null,
      'a thrown decoder is not an exception at the UI')
    assert.equal(await service.request({ slot: 'b', fingerprint: FP, atSec: 5, src: 'http://host/a.mp4' }), null,
      'a decoder that found no frame says so')
    assert.equal(calls, 2)
    assert.deepEqual(heldKeys(service), [], 'a frame nobody decoded is not in the cache')
    const again = await service.request({ slot: 'b', fingerprint: FP, atSec: 5, src: 'http://host/a.mp4' })
    assert.equal(again, null)
    assert.equal(calls, 3, 'and the next ask retries instead of trusting a failed entry')
  })

  await check('the frame cache is bounded and a released frame gives its URL back', async () => {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    const asked: Ask[] = []
    const service = createFrameService(recordingDecoder(asked), { maxEntries: 3 })
    const urls: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const url = await service.request({ slot: `s${index}`, fingerprint: FP, atSec: index + 1, src: 'http://host/a.mp4' })
      urls.push(frameUrl(url))
    }
    assert.deepEqual(heldKeys(service), ['deadbeef-f1000-w320', 'deadbeef-f2000-w320', 'deadbeef-f3000-w320'])
    const newest = frameUrl(await service.request({ slot: 's3', fingerprint: FP, atSec: 4, src: 'http://host/a.mp4' }))
    assert.deepEqual(heldKeys(service), ['deadbeef-f2000-w320', 'deadbeef-f3000-w320', 'deadbeef-f4000-w320'],
      'the least recently shown frame leaves')
    assert.ok(revoked.includes(urls[0]!), 'and its object URL is revoked, not leaked')
    assert.equal(asked.length, 4, 'three held frames plus the new one')
    const back = frameUrl(await service.request({ slot: 's3', fingerprint: FP, atSec: 4, src: 'http://host/a.mp4' }))
    assert.equal(back, newest, 'the frame still held answers from cache')
    assert.equal(asked.length, 4, 'and no decoder opened for it')
  })

  // -------------------------------------------------------------------------
  // Shape: who may decode, and where the law is asked from.
  // -------------------------------------------------------------------------

  await check('the app has one frame entry point, and a runtime without WebCodecs says null', async () => {
    assert.equal(typeof frameStore.requestFrame, 'function', 'one call the UI uses')
    assert.equal(typeof frameStore.forgetFrameSlot, 'function', 'and one way to leave a slot')
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
    assert.equal(await store.putCachedBytes(FP, blobOf(2048, 'm'), new Set([FP])), true, 'the bytes are there')
    assert.equal(typeof (globalThis as Record<string, unknown>).VideoDecoder, 'undefined',
      'this runtime has no hardware video decoder')
    const url = await frameStore.requestFrame({ slot: 'node-hud', fingerprint: FP, atSec: 1, src: 'http://host/a.mp4' })
    assert.equal(url, null, 'so the honest answer is no frame, not an exception and not a fake one')
    assert.equal(frameStore.forgetFrameSlot('node-hud'), true, 'the slot is tracked until its owner leaves')
    assert.equal(frameStore.forgetFrameSlot('node-hud'), false, 'and leaving twice is not an error')
  })

  await check('one module in the app opens a frame decoder', () => {
    const files = walkApp(join(root, 'app'))
    const withSink = files.filter(file => read(file).includes('CanvasSink')).sort()
    assert.deepEqual(withSink, ['app/utils/tmcut/frameDecode.ts'],
      'the pixels come from one place, so both hosts cannot diverge about them')
    const withDecodeImport = files.filter(file => /from '.\/frameDecode|utils\/tmcut\/frameDecode/.test(read(file)))
    assert.deepEqual(withDecodeImport, ['app/utils/tmcut/frameStore.ts'],
      'the service is the only caller of the decoder')
  })

  await check('the service asks core for every frame decision', () => {
    const source = read('app/utils/tmcut/frameStore.ts')
    assert.match(source, /from 'tmcut-core'/, 'identity, clamping, slots and eviction come from core')
    for (const name of ['frameRequestKey', 'frameTimeWithinMedia', 'createFrameSlotLedger',
      'planFrameCacheEviction', 'TMCUT_FRAME_MAX_CONCURRENT', 'TMCUT_FRAME_CACHE_MAX_ENTRIES']) {
      assert.ok(source.includes(name), `${name} is used, not re-implemented`)
    }
    assert.doesNotMatch(source, /Math\.round\((ask|atSec|at) \* 1000\)/, 'the millisecond is core rounding')
    assert.doesNotMatch(source, /mediabunny/, 'the service never touches the demuxer itself')
    const decoder = read('app/utils/tmcut/frameDecode.ts')
    assert.match(decoder, /from 'mediabunny'/, 'the decode leg is the one that does')
    assert.match(decoder, /VideoDecoder/, 'and it says so before trying to use one')
    assert.match(decoder, /dispose\(\)/, 'a cancelled decode releases its input')
  })

  console.log(`\n=== All ${passed} frame service checks passed ===`)
}

/** The keys the service is holding, read straight off the instance. */
function heldKeys(service: { cached: () => string[] }) {
  return service.cached().slice().sort()
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
