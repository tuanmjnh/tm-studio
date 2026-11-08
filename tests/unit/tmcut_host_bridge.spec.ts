/**
 * Host bridge + adapter consumption (V4 Phase 1, gap G3 second half).
 *
 * `useTmcutPlatform()` made the host answer available; this spec makes it
 * stay available. Before this slice 30+ renderer modules each reached for
 * `window.electronAPI` themselves — five of them re-declaring an identical
 * private `tmcutIpc()` helper — so "which runtime am I in" had ~60 answers,
 * and one of them (`useToolTaskManager`) threw `ReferenceError: window is not
 * defined` outside a browser. Now the global is read in exactly one module,
 * feature UI branches read the negotiated adapter, and this file fails the
 * build if either rule drifts back.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_host_bridge.spec.ts
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

function sourceOf(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

function appSources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(rel)
      else if (/\.(ts|vue)$/.test(entry.name)) out.push(rel)
    }
  }
  walk('app')
  return out
}

/** Code lines only — a comment may still name the old global to explain history. */
function codeOccurrences(source: string, needle: string): string[] {
  return source.split(/\r?\n/).filter((line) => {
    const trimmed = line.trimStart()
    return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
      ? false
      : line.includes(needle)
  })
}

const BRIDGE_MODULE = 'app/utils/tmcut/hostBridge.ts'
const files = appSources()
const failures: string[] = []

for (const rel of files) {
  if (rel === BRIDGE_MODULE) continue
  const hits = codeOccurrences(sourceOf(rel), 'window.electronAPI')
  if (hits.length > 0) failures.push(`${rel}: ${hits.length} raw read(s)`)
}

let checks = 0
function check(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    await fn()
    checks++
    console.log(`ok ${checks}. ${name}`)
  })()
}

async function main() {
  // 1. The one-reader rule: only the bridge module touches the global.
  await check('only hostBridge.ts reads window.electronAPI in app code', () => {
    assert.deepEqual(failures, [], `raw preload sniffs came back:\n${failures.join('\n')}`)
  })

  // 2. No module re-declares its own IPC accessor.
  await check('no local tmcutIpc() helpers are left', () => {
    const owners = files.filter(rel => sourceOf(rel).includes('function tmcutIpc('))
    assert.deepEqual(owners, [], `duplicate IPC helpers: ${owners.join(', ')}`)
  })

  // 3. The inline SSR-guard pattern is gone, not just moved.
  await check('no inline "typeof window guard + electronAPI" probes remain', () => {
    const owners = files.filter(rel => /typeof window !== 'undefined'.{0,40}window\.electronAPI/.test(sourceOf(rel)))
    assert.deepEqual(owners, [], `inline probes: ${owners.join(', ')}`)
  })

  // 4. Whoever calls the accessor imports it (Nuxt auto-import is not a contract).
  await check('every accessor caller imports it from the bridge module', () => {
    const unimported = files.filter((rel) => {
      if (rel === BRIDGE_MODULE) return false
      const src = sourceOf(rel)
      const uses = /\btmcutHost(?:Bridge|Ipc)\(/.test(src)
      return uses && !src.includes('from \'~/utils/tmcut/hostBridge\'')
    })
    assert.deepEqual(unimported, [], `missing import in: ${unimported.join(', ')}`)
  })

  // 5. Functional: the accessor is safe with no window, and returns the slice with one.
  await check('the accessor is Node-safe and returns the tmcut slice', async () => {
    const savedWindow = (globalThis as Record<string, unknown>).window
    delete (globalThis as Record<string, unknown>).window
    try {
      const { tmcutHostBridge, tmcutHostIpc } = await import('../../app/utils/tmcut/hostBridge')
      assert.equal(tmcutHostBridge(), undefined, 'no window must mean no bridge, not a throw')
      assert.equal(tmcutHostIpc(), undefined)

      const ipc = { extractAudio: () => 'audio' }
      ;(globalThis as Record<string, unknown>).window = { electronAPI: { isElectron: true, tmcut: ipc } }
      assert.equal(tmcutHostIpc(), ipc, 'the tmcut slice must come from the bridge')
      assert.equal(tmcutHostBridge()?.isElectron, true)
    } finally {
      ;(globalThis as Record<string, unknown>).window = savedWindow
    }
  })

  // 6. Host identity for feature UI comes from the adapter, not the bridge.
  await check('the migrated desktop gates read the negotiated adapter', () => {
    const gated: Record<string, string> = {
      'app/components/tmcut/TmcutMarketplace.vue': 'platform.info.capabilities.filesystem === true',
      'app/components/tmcut/TmcutVoiceStudioBody.vue': 'platform.info.name === \'electron\'',
      'app/components/tools/VideoPreviewModal.vue': 'platform.info.name === \'electron\'',
      'app/components/tmcut/TmcutExportModal.vue': 'platform.info.name === \'electron\''
    }
    for (const [rel, needle] of Object.entries(gated)) {
      const src = sourceOf(rel)
      assert.ok(src.includes('useTmcutPlatform'), `${rel} must build the adapter`)
      assert.ok(src.includes(needle), `${rel} must gate on ${needle}`)
      // A gate that also sniffs the bridge would be two answers again.
      assert.doesNotMatch(src, /isDesktop = computed\([^)]*tmcutHost(Bridge|Ipc)/, `${rel} re-sniffs the host`)
    }
  })

  // 7. The task-manager composable was the FFmpeg queue’s window reader; slice I
  //    deleted it with the engine, so the guard it needed is no longer a file.
  await check('the desktop-only window readers left with the engine', () => {
    assert.equal(existsSync(join(root, 'app/composables/useToolTaskManager.ts')), false)
    assert.equal(existsSync(join(root, 'app/composables/useTmcutExportQueue.ts')), false)
  })

  // 8. The adapter factory negotiates the host from the accessor, and it does
  //    not instantiate the media composable just to answer a capability.
  await check('the adapter derives the host split from the accessor, not from media', () => {
    const platform = sourceOf('app/composables/useTmcutPlatform.ts')
    assert.ok(platform.includes('tmcutHostIpc() !== undefined'), 'host split must come from the accessor')
    assert.doesNotMatch(platform, /desktop = .*mediaOf\(\)/, 'capabilities must not pull in the media composable')
    const media = sourceOf('app/composables/useTmcutMedia.ts')
    assert.ok(media.includes('tmcutHostIpc()'), 'media resolves through the accessor')
  })

  console.log(`=== All ${checks} host bridge checks passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
