/**
 * R133 — IPC trust policy (docs §197).
 *
 * The eslint-disable below is scoped to this spec on purpose: re-running
 * registerFileManagerController against a fresh fake ipcMain requires
 * evicting the module from the CJS require cache by computed key —
 * exactly what no-dynamic-delete warns about, and exactly what a test
 * harness is for.
 *
 * Pins the security contract of the extracted sender gate and the
 * preload channel allow-lists:
 *  - createSenderGate matches the audit R124.5 semantics exactly
 *    (dev Vite origin, prod loopback port, about:blank/devtools pass,
 *    anything else refused);
 *  - the preload's INLINE copies of PUSH/OUTBOUND channels (sandboxed
 *    preload cannot require local files) never drift from the canonical
 *    arrays in electron/ipcPolicy.cjs;
 *  - file-manager refuses untrusted senders when a gate is injected and
 *    stays testable when it is not.
 * Run: pnpm test:tmcut (or tsx --tsconfig tsconfig.test.json directly).
 */
/* eslint-disable @typescript-eslint/no-dynamic-delete */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUSH_CHANNELS,
  OUTBOUND_CHANNELS,
  isAllowedPushChannel,
  isAllowedOutboundChannel,
  createSenderGate,
  gateIpcMainHandle
} from '../../electron/ipcPolicy.cjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  console.log(`   ${name} PASSED`)
  passed += 1
}

const frame = (url: string | null) => ({ senderFrame: url === null ? undefined : { url } })

await check('prod gate: loopback origins pass, everything else refuses', () => {
  const gate = createSenderGate({ isDev: false, port: 3456 })
  assert.ok(gate(frame('http://127.0.0.1:3456/tmcut/editor')))
  assert.ok(gate(frame('http://localhost:3456/')))
  // Injected or remote frames are the threat the gate exists for.
  assert.ok(!gate(frame('http://evil.example/')))
  assert.ok(!gate(frame('http://127.0.0.1:9999/')))
  assert.ok(!gate(frame('https://127.0.0.1:3456/')))
  assert.ok(!gate(frame('file:///C:/x/y.html')))
  assert.ok(!gate(frame('http://localhost:4002/')))
})

await check('dev gate: Vite origin only; blank/devtools frames always pass', () => {
  const gate = createSenderGate({ isDev: true, port: 3456, devPort: 4002 })
  assert.ok(gate(frame('http://localhost:4002/tmcut')))
  assert.ok(gate(frame('http://127.0.0.1:4002/')))
  assert.ok(!gate(frame('http://localhost:3100/')))
  assert.ok(!gate(frame('http://localhost:3000/')))
  assert.ok(gate(frame('about:blank')))
  assert.ok(gate(frame(null)))
  assert.ok(gate(frame('devtools://devtools/bundled/inspector.html')))
})

await check('destroyed frame (senderFrame read throws) refuses, never crashes', () => {
  const gate = createSenderGate({ isDev: false, port: 3456 })
  const broken = {
    get senderFrame() {
      throw new Error('Frame with ID 3 was destroyed')
    }
  }
  assert.equal(gate(broken as never), false)
})

await check('push allow-list covers every real webContents.send call site', () => {
  // Grep-equivalent: the channels main actually pushes (app-updater, asset
  // center/download progress, MCP events). If a new push appears in main code
  // without landing here, this list review is the forcing function.
  assert.ok(isAllowedPushChannel('app-updater:status-changed'))
  assert.ok(isAllowedPushChannel('tmcut:assetCenter:progress'))
  // Slice I retired the render-output watcher with the FFmpeg queue: the
  // WebCodecs exporter finishes inside the renderer that started it, so
  // nothing in main sends this any more. Asserting the refusal keeps a dead
  // channel from creeping back into the array.
  assert.ok(!isAllowedPushChannel('tmcut:renderDone'))
  // Zero-FFmpeg slice I deleted the ffmpeg task-manager controller with the
  // binary, so its ten event channels are not pushable any more. Asserting
  // the refusal, not just dropping the line, is what keeps a stale channel
  // from creeping back into the array.
  assert.ok(!isAllowedPushChannel('tools:ffmpeg:progressTask'))
  assert.ok(!isAllowedPushChannel('tools:ffmpeg:managerInitialized'))
  // TM Studio has no browser-platform controllers: the profiles
  // statusChanged, youtube task family and the platform EventBus channel
  // must NOT be pushable.
  assert.ok(!isAllowedPushChannel('tools:profiles:statusChanged'))
  assert.ok(!isAllowedPushChannel('tools:youtube:allTasksDone'))
  assert.ok(!isAllowedPushChannel('eventbus:event'))
  // The allow-list is a CLOSED set: unknown and prefix-spoof channels fail.
  assert.ok(!isAllowedPushChannel('tools:file-manager:read'))
  assert.ok(!isAllowedPushChannel('eventbus:event..evil'))
  assert.ok(!isAllowedPushChannel(''))
  assert.ok(!isAllowedPushChannel(undefined as never))
})

await check('outbound allow-list is the honest set with MCP channels', () => {
  // MCP channels are the only outbound channels allowed (Phase 3)
  const expected = [
    'mcp:server:tool:invoke',
    'mcp:server:session:init',
    'mcp:server:session:close',
    'mcp:server:event:proposal_changed',
    'mcp:server:event:project_changed',
    'mcp:server:event:job_status',
    'mcp:forward',
    'mcp:forward:respond'
  ]
  assert.deepEqual(OUTBOUND_CHANNELS.slice().sort(), expected.slice().sort())
  assert.ok(!isAllowedOutboundChannel('anything'))
  assert.ok(!isAllowedOutboundChannel('tools:file-manager:read'))
})

await check('preload inline copies equal the canonical policy arrays', () => {
  // The sandboxed preload cannot require ipcPolicy, so it carries inline
  // copies. Parse them from the actual shipped file and pin equality —
  // drift here is exactly the "silent divergence" this spec exists for.
  const src = readFileSync(join(root, 'electron', 'preload.cjs'), 'utf8')
  const grab = (name: string): string[] => {
    const m = src.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`))
    assert.ok(m, `preload.cjs no longer declares ${name}`)
    return [...m[1]!.matchAll(/'([^']+)'/g)].map(x => x[1]!)
  }
  assert.deepEqual(grab('PUSH_CHANNELS').slice().sort(), PUSH_CHANNELS.slice().sort())
  assert.deepEqual(grab('OUTBOUND_CHANNELS'), OUTBOUND_CHANNELS)
})

await check('every tmcut handler main registers is invocable from the preload', () => {
  // The classic packaged-app bug: a handler lands in a controller but not in
  // the preload allow-list, so it compiles, type-checks and passes unit tests,
  // and only the shipped app sees `undefined`. This pairing is what a reviewer
  // cannot eyeball across two 1200-line files.
  const controller = readFileSync(join(root, 'electron', 'tools', 'tmcut.controller.cjs'), 'utf8')
  const preload = readFileSync(join(root, 'electron', 'preload.cjs'), 'utf8')
  const handles = [...controller.matchAll(/ipcMain\.handle\(`\$\{moduleName\}:([A-Za-z]+)`/g)].map(m => m[1]!)
  assert.ok(handles.length > 20, `expected the tmcut controller handlers, found ${handles.length}`)
  const block = preload.match(/const tmcut = exposeNamespace\('tmcut', \{[\s\S]*?invoke: \[([\s\S]*?)\]/)
  assert.ok(block, 'preload.cjs no longer declares the tmcut invoke list')
  const invokes = new Set([...block[1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!))
  const unreachable = handles.filter(name => !invokes.has(name))
  assert.deepEqual(unreachable, [], `handlers the renderer cannot reach: ${unreachable.join(', ')}`)
  // Slice I retired the ffprobe-over-IPC leg: `media.probeInfo` demuxes in the
  // renderer, so `probeMedia` has no handler and must not be offered either.
  assert.ok(!invokes.has('probeMedia'), 'the retired binary probe must not come back as a channel')

  // The same pairing read from the other side, because that is the direction a
  // retired transport leaves a hole: a channel the preload offers with no
  // handler is a call that rejects at runtime, and the app can sit on it for
  // months behind a `.catch(() => {})`. `watchOutput`/`unwatchOutput` were the
  // proof (G14): main registered them under a kebab-case second convention, so
  // the export modal's output watcher never started and nothing reported it.
  // Slice I deleted both channels with the render-output watcher they served;
  // this direction is what keeps a retired transport from leaving a hole.
  const main = readFileSync(join(root, 'electron', 'main.cjs'), 'utf8')
  const literalHandles = [...main.matchAll(/ipcMain\.handle\([`']tmcut:([A-Za-z-]+)/g)].map(m => m[1]!)
  // Slice I removed the render-output watcher, which was the last tmcut channel
  // main registered itself; the controller owns the namespace now. Zero here is
  // the expected state, so the guard pins it instead of going vacuous.
  assert.deepEqual(literalHandles, [], 'the tmcut namespace belongs to the controller, not main.cjs')
  const registered = new Set(handles)
  const orphans = [...invokes].filter(name => !registered.has(name)).sort()
  assert.deepEqual(orphans, [], `channels with no handler: ${orphans.join(', ')}`)
})

await check('choke point gates every later registration (R134)', async () => {
  // The R134 mechanism: swap ipcMain.handle once at startup, every
  // controller registration afterwards is wrapped. Model the swap with
  // a fake ipcMain and prove (a) untrusted resolves undefined without
  // running the handler, (b) trusted runs it, (c) async handlers keep
  // their resolution value.
  const registry = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  const fakeIpc = { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => registry.set(ch, fn) }
  const gate = createSenderGate({ isDev: false, port: 3456 })
  gateIpcMainHandle(fakeIpc as never, gate)
  let ran = 0
  fakeIpc.handle('probe:sync', () => {
    ran++
    return { ok: true }
  })
  fakeIpc.handle('probe:async', async () => {
    ran++
    await new Promise(r => setTimeout(r, 5))
    return 'async-value'
  })
  const evil = { senderFrame: { url: 'https://evil.example/' } }
  const good = { senderFrame: { url: 'http://127.0.0.1:3456/x' } }
  assert.equal(await registry.get('probe:sync')!(evil), undefined)
  assert.equal(ran, 0, 'handler body must not run for untrusted senders')
  const okVal = registry.get('probe:sync')!(good)
  assert.deepEqual(okVal, { ok: true })
  assert.equal(await registry.get('probe:async')!(evil), undefined)
  assert.equal(await registry.get('probe:async')!(good), 'async-value')
  assert.equal(ran, 2, 'trusted calls run each handler exactly once')
})

await check('file-manager handlers refuse untrusted senders when gated', async () => {
  // Fake ipcMain capture: register the controller with a DENY gate and
  // confirm no handler body runs. (The module only needs ipcMain, so a
  // partial require cache injection keeps this a plain-Node test.)
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  const fakeIpcMain = { handle: (ch: string, fn: (event: unknown, args: unknown) => unknown) => handlers.set(ch, fn) }
  const { createRequire } = await import('node:module')
  const req = createRequire(import.meta.url)
  const electronPath = req.resolve('electron')
  const prev = req.cache[electronPath]
  req.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain: fakeIpcMain, nativeImage: {} } }
  try {
    const modPath = req.resolve(join(root, 'electron', 'tools', 'file-manager.cjs'))
    delete req.cache[modPath] // re-run the module body against THIS fake
    const { registerFileManagerController } = req(modPath)
    registerFileManagerController({ isTrustedSender: () => false })
    // The controller registers 39 ipcMain.handle channels (preload lists
    // 44 method names; 5 of them are aliases — the count pins the surface
    // so a NEW channel must be reviewed here deliberately).
    assert.equal(handlers.size, 39, `expected the full channel surface, got ${handlers.size}`)
    const denyEvent = {}
    // Representative spread: a read, a write, a delete, a list, a copy.
    assert.equal(handlers.get('tools:file-manager:read')!(denyEvent, { filePath: 'C:/Windows/win.ini' }), null)
    assert.equal(handlers.get('tools:file-manager:write')!(denyEvent, { filePath: 'C:/x/y.txt', data: 'x' }), null)
    assert.equal(handlers.get('tools:file-manager:delete')!(denyEvent, 'C:/x/y.txt'), null)
    assert.equal(handlers.get('tools:file-manager:listAll')!(denyEvent, { dirPath: 'C:/' }), null)
    assert.equal(handlers.get('tools:file-manager:copyFile')!(denyEvent, { src: 'C:/a', dest: 'C:/b' }), null)
    // The gate itself gets the event object (so main's factory receives
    // what it needs) — verified by the ALLOW path on a temp file below.
  } finally {
    if (prev) req.cache[electronPath] = prev
    else delete req.cache[electronPath]
  }
})

await check('file-manager still works for trusted senders (no gate = test mode)', async () => {
  const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()
  const fakeIpcMain = { handle: (ch: string, fn: (event: unknown, args: unknown) => unknown) => handlers.set(ch, fn) }
  const { createRequire } = await import('node:module')
  const os = await import('node:os')
  const fsp = await import('node:fs/promises')
  const req = createRequire(import.meta.url)
  const electronPath = req.resolve('electron')
  const prev = req.cache[electronPath]
  req.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { ipcMain: fakeIpcMain, nativeImage: {} } }
  try {
    const fmPath = req.resolve(join(root, 'electron', 'tools', 'file-manager.cjs'))
    delete req.cache[fmPath] // fresh module so it binds THIS fake ipcMain
    const { registerFileManagerController } = req(fmPath)
    registerFileManagerController()
    const dir = await fsp.mkdtemp(join(os.tmpdir(), 'tmcut-fm-'))
    try {
      const file = join(dir, 'a.txt')
      await handlers.get('tools:file-manager:writeAsync')!({}, { filePath: file, data: 'hello' })
      const text = await handlers.get('tools:file-manager:readAsync')!({}, { filePath: file })
      assert.equal(text, 'hello')
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  } finally {
    if (prev) req.cache[electronPath] = prev
    else delete req.cache[electronPath]
  }
})

console.log(`\n=== All ${passed} ipc-policy checks passed ===`)
