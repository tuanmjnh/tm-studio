/**
 * Resource lifecycle and stale-request cancellation (zero-FFmpeg slice F10,
 * roadmap requirement 8).
 *
 * Slices D1–D3 put a frame cache, a decoder pool and a slot ledger under one
 * law, and F5 gave the throwaway media elements their decoder and their
 * watchdog back. What was never owned was the END of a session: an object URL
 * that outlives the page that asked for it, a decode that publishes into a
 * cache nobody reads anymore, a slot that keeps being tracked after its batch
 * got its answer, a playhead loop that keeps re-arming itself for a component
 * that is gone, and an `ImageBitmap` that is only closed when the read of it
 * went well.
 *
 * The law this slice pins:
 *  - the ledger can hand back every slot at once (`clear`) and an owner may
 *    hand back only the slot it still holds (`release`), so a batch that lost
 *    its slot to a newer ask cannot evict the new owner;
 *  - the frame service can be disposed: every object URL it holds is revoked,
 *    every decode in flight is aborted, every slot is handed back — and a
 *    decode that finishes after disposal does not publish into the next
 *    session's cache;
 *  - the service survives disposal: a later ask decodes again instead of
 *    answering forever from an emptied cache;
 *  - a batch owns its slots only until its answers land, so the ledger cannot
 *    grow with the number of analyses a user runs;
 *  - the UI legs that hold resources leave them at the door: the editor gives
 *    back its frames, the preview player stops its loop, AutoCut cancels the
 *    decoder walk it is running, and a still image releases its bitmap even
 *    when measuring it is what failed.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_resource_lifecycle.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
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

/** The block a component runs when it leaves — the lifecycle is all here. */
function unmountBlock(source: string, file: string): string {
  const block = source.match(/onUnmounted\(\(\) => \{[\s\S]*?\n\}\)/)?.[0] ?? ''
  assert.ok(block, `${file} tears down in an onUnmounted hook`)
  return block
}

type Ask = { key: string, atSec: number, width: number, bytes: Blob | null, src: string | null, signal: AbortSignal }

async function main() {
  console.log('=== [TMCut resource lifecycle] Starting ===\n')
  const g = globalThis as Record<string, unknown>
  if (!g.window) g.window = {}
  const core = await import('tmcut-core')

  // -------------------------------------------------------------------------
  // Core: the two ledger powers an owner needs to give a slot back.
  // -------------------------------------------------------------------------

  await check('the slot ledger hands every slot back in one call', () => {
    assert.equal(typeof core.createFrameSlotLedger().clear, 'function',
      'a session that ends needs one call, not one per slot name it has to remember')
    const ledger = core.createFrameSlotLedger()
    const hud = ledger.begin('hud', 'deadbeef-f1000-w320')
    ledger.begin('strip:a#0', 'deadbeef-f2000-w320')
    ledger.begin('strip:a#1', 'deadbeef-f3000-w320')
    assert.equal(ledger.size(), 3, 'three owners are being tracked')
    assert.equal(ledger.clear(), 3, 'and the law reports how many it released')
    assert.equal(ledger.size(), 0, 'nothing is left owned')
    assert.equal(ledger.isCurrent('hud', hud.token), false, 'a cleared slot cannot paint')
    const again = ledger.begin('hud', 'deadbeef-f4000-w320')
    assert.equal(again.superseded, null, 'a fresh ask after a clear supersedes nothing')
    assert.equal(ledger.clear(), 1)
    assert.equal(ledger.clear(), 0, 'clearing an empty ledger is not an error')
  })

  await check('an owner hands back only the slot it still holds', () => {
    assert.equal(typeof core.createFrameSlotLedger().release, 'function',
      'a batch releases what it owns, and nothing a newer ask took over')
    const ledger = core.createFrameSlotLedger()
    const first = ledger.begin('hud', 'deadbeef-f1000-w320')
    assert.equal(ledger.release('hud', 999_999), false, 'a token nobody issued releases nothing')
    assert.equal(ledger.size(), 1, 'and the real owner is untouched')
    const second = ledger.begin('hud', 'deadbeef-f2000-w320')
    assert.equal(ledger.release('hud', first.token), false,
      'the ask that lost the slot may not evict the one that won it')
    assert.equal(ledger.isCurrent('hud', second.token), true)
    assert.equal(ledger.release('hud', second.token), true, 'the current owner gets its slot back')
    assert.equal(ledger.size(), 0)
    assert.equal(ledger.release('hud', second.token), false, 'releasing twice is not an error')
    assert.ok(read('packages/core/src/index.d.ts').includes('release('),
      'and the app can see the power through the types')
    assert.ok(read('packages/core/src/index.d.ts').includes('clear('),
      'both are declared, not just exported')
  })

  // -------------------------------------------------------------------------
  // The frame service: disposal is the end of a session, not the end of the law.
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
  const { createFrameService } = await import('../../app/utils/tmcut/frameStore')

  function freshCache() {
    clearByteIndex()
    installOpfs(10 * 1024 * 1024)
    store.resetByteStoreProbe()
  }

  /** Let the queues and the aborted promises settle. */
  function tick(ms = 10) {
    return new Promise<void>(resolve => setTimeout(resolve, ms))
  }

  function hold() {
    let release: () => void = () => undefined
    const waiting = new Promise<void>((resolve) => {
      release = resolve
    })
    return { release, wait: () => waiting }
  }

  const FP = 'deadbeef'
  const askAt = (slot: string, atSec: number) => ({
    slot, fingerprint: FP, atSec, width: 320, src: 'http://host/a.mp4'
  })

  await check('disposing the frame service revokes every object URL it holds', async () => {
    freshCache()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      return blobOf(64, 'p')
    })
    const urls: string[] = []
    for (let index = 0; index < 3; index += 1) {
      const url = await service.request(askAt(`s${index}`, index + 1))
      assert.ok(url, 'the frame was shown')
      urls.push(String(url))
    }
    assert.equal(service.cached().length, 3)
    created.length = 0
    revoked.length = 0

    assert.equal(typeof service.dispose, 'function', 'the session has one way to end')
    assert.equal(service.dispose(), 3, 'the count is the number of frames let go')
    assert.deepEqual(revoked.slice().sort(), urls.slice().sort(), 'every held URL is revoked, not orphaned')
    assert.deepEqual(service.cached(), [], 'and the cache is empty rather than full of dead locations')
    assert.equal(service.trackedSlots(), 0, 'no slot is still owned by the page that left')
    assert.equal(service.inFlight(), 0)
  })

  await check('a decode still running at disposal never publishes into the next session', async () => {
    freshCache()
    const gate = hold()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      await gate.wait()
      return blobOf(64, 'p')
    })
    const pending = service.request(askAt('hud', 2))
    await tick()
    assert.equal(asks.length, 1, 'the decode is open')
    created.length = 0
    revoked.length = 0

    service.dispose()
    assert.equal(asks[0]!.signal.aborted, true, 'the leaving page stops paying for the decode')
    assert.equal(service.inFlight(), 0, 'and it is no longer on the books')

    gate.release()
    const outcome = await pending
    assert.equal(outcome, null, 'a frame with no owner left is not painted')
    assert.equal(created.length, 0, 'and it is not published either: that URL would never be revoked')
    assert.deepEqual(service.cached(), [], 'the cache the next session starts from is empty')
  })

  await check('the service answers again after disposal', async () => {
    freshCache()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      return blobOf(64, 'p')
    })
    const first = await service.request(askAt('hud', 1))
    assert.ok(first)
    service.dispose()
    const after = await service.request(askAt('hud', 1))
    assert.ok(after, 'a new visit decodes again instead of showing nothing forever')
    assert.notEqual(String(after), String(first), 'and it is a fresh location, not the revoked one')
    assert.equal(asks.length, 2, 'one decode per session, which is the cost of leaving')
    service.dispose()
  })

  await check('a batch hands back the slots it asked for', async () => {
    freshCache()
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      return blobOf(64, 'p')
    })
    assert.equal(typeof service.requestBatch, 'function',
      'the batch leg needs its own entry point: only the service knows the tokens it issued')
    const jobs = Array.from({ length: 4 }, (_, index) => askAt(`batch:${index}`, index + 1))
    const urls = await service.requestBatch(jobs)
    assert.equal(urls.filter(url => url).length, 4, 'every instant was answered')
    assert.equal(asks.length, 4)
    assert.equal(service.trackedSlots(), 0,
      'a batch owns its slots only until its answers land — otherwise the ledger grows with every analysis')
    assert.equal(service.cached().length, 4, 'the frames themselves stay cached, so the next ask is free')

    // The single-ask path keeps its owner until that owner says otherwise.
    await service.request(askAt('hud', 9))
    assert.equal(service.trackedSlots(), 1, 'a HUD still holds its slot')
    assert.equal(service.forget('hud'), true)
    assert.equal(service.trackedSlots(), 0)
    service.dispose()
  })

  await check('a superseded batch does not steal the newer owner\'s slots', async () => {
    freshCache()
    const gates = [hold(), hold(), hold(), hold()]
    const asks: Ask[] = []
    const service = createFrameService(async (ask: Ask) => {
      asks.push(ask)
      await gates[asks.length - 1]!.wait()
      return blobOf(64, 'p')
    })
    // Re-analysing the same source re-asks the same slot names: the newer batch
    // owns them, and the older one must not take them out from under it.
    const older = service.requestBatch([askAt('thumb:a#0', 1), askAt('thumb:a#1', 2)])
    await tick()
    const newer = service.requestBatch([askAt('thumb:a#0', 3), askAt('thumb:a#1', 4)])
    await tick()
    assert.equal(asks[0]!.signal.aborted, true, 'the older batch lost its first decode')
    assert.equal(asks[1]!.signal.aborted, true, 'and its second')

    gates[0]!.release()
    gates[1]!.release()
    const oldUrls = await older
    assert.deepEqual(oldUrls, [null, null], 'the superseded batch paints nothing')
    assert.equal(service.trackedSlots(), 2,
      'handing back its own slots leaves the newer batch owners in place')

    gates.forEach(gate => gate.release())
    const newUrls = await newer
    assert.equal(newUrls.filter(url => url).length, 2, 'the batch still on screen is not disturbed')
    assert.equal(service.trackedSlots(), 0, 'and when it lands, its slots go too')
    service.dispose()
  })

  // -------------------------------------------------------------------------
  // Shape: the app legs that hold a resource give it back where they took it.
  // -------------------------------------------------------------------------

  await check('the app asks the batch leg for a batch, and the singleton can be disposed', () => {
    const frameStore = read('app/utils/tmcut/frameStore.ts')
    assert.match(frameStore, /from 'tmcut-core'/, 'the slot powers come from core')
    assert.ok(frameStore.includes('ledger.clear()'), 'disposal hands the whole ledger back')
    assert.ok(frameStore.includes('ledger.release('), 'and a batch releases token by token')
    const moduleExports = exportedNames(frameStore)
    for (const name of ['requestFrameBatch', 'disposeFrameService']) {
      assert.ok(moduleExports.includes(name), `${name} is the app-facing call`)
    }

    const composable = read('app/composables/useTmcutFrames.ts')
    assert.ok(composable.includes('requestFrameBatch'), 'the batch leg uses it')
    assert.doesNotMatch(composable, /\brequestFrame\(/,
      'and no longer asks frame by frame, which is what leaked a slot per job')

    const editor = read('app/pages/tmcut/editor.vue')
    assert.match(unmountBlock(editor, 'editor.vue'), /disposeFrameService\(\)/,
      'the editor gives its frames back when the workspace closes')
  })

  await check('leaving the preview stops the playhead loop', () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    const teardown = unmountBlock(player, 'TmcutPreviewPlayer.vue')
    assert.match(teardown, /(^|[^.\w])pause\(\)/,
      'the rAF loop is owned by core-backed playback: leaving the component must pause it, or it re-arms forever')
    assert.match(teardown, /clearInterval\(audioDriftTimer\)/, 'and the drift tick is already stopped')
  })

  await check('leaving AutoCut cancels the decoder walk it is running', () => {
    const page = read('app/pages/tmcut/autocut.vue')
    const teardown = unmountBlock(page, 'autocut.vue')
    assert.match(teardown, /cancelScan\(\)/,
      'a scene scan holds a demuxer open; a page nobody is looking at must not keep reading the file')
  })

  await check('a still that cannot be measured still gives its bitmap back', async () => {
    freshCache()
    const { probeMedia } = await import('../../app/utils/tmcut/mediaProbe')
    const previous = g.createImageBitmap
    let closed = 0
    g.createImageBitmap = async () => ({
      get width() { throw new Error('the raster is there but its size cannot be read') },
      height: 360,
      close: () => { closed += 1 }
    }) as unknown as (blob: Blob) => Promise<ImageBitmap>
    try {
      const png = new Uint8Array(400)
      const info = await probeMedia({
        name: 'poster.png', blob: new Blob([png]), size: png.byteLength, kind: 'image'
      })
      assert.deepEqual(info.still, { decodable: false }, 'an unreadable size is reported as no still')
      assert.equal(closed, 1, 'but the bitmap was allocated, so it is closed on the way out, not only on the way through')
    } finally {
      if (previous === undefined) delete g.createImageBitmap
      else g.createImageBitmap = previous
    }
  })

  await check('there is no worker for this slice to own', () => {
    const files = walkApp(join(root, 'app'))
    const withWorker = files.filter(file => /new (Shared)?Worker\s*\(/.test(read(file)))
    assert.deepEqual(withWorker, [],
      'the render path runs on the main thread plus WebCodecs: requirement 8\'s worker leg has no live resource here')
  })

  console.log(`\n=== All ${passed} resource lifecycle checks passed ===`)
}

/** The names a module exports at its top level. */
function exportedNames(source: string): string {
  return [...source.matchAll(/export (?:const|function|async function)\s+(\w+)/g)].map(m => m[1]).join(' ')
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
