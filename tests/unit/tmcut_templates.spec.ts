/**
 * Template flow + migration guard (`useTmcutTemplates`).
 *
 * C16-R3 rewrote this composable twice over: it now stores tick geometry
 * (save/instantiate round-trip against a ticks store) AND gained a
 * one-time `_v1`(seconds) → `_v2`(ticks) localStorage migration driven by
 * the key name as the version stamp. Both are exactly the R82 defect
 * class (a partial or repeated re-scale silently corrupting every saved
 * template) and neither had a test. This spec runs the composable in the
 * Node store harness (window/localStorage shimmed) and pins:
 *   - legacy seconds templates scale to ticks EXACTLY once, then the
 *     v2 key holds ticks and the legacy key is dropped,
 *   - a ticks store → template → new project keeps integer tick geometry
 *     with the right durationMs (no second ×120000 anywhere),
 *   - delete persists.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_templates.spec.ts
 */
import assert from 'node:assert/strict'
import { TICKS, freshStore } from './helpers/tmcut_store_env' // side effects: Vue + localStorage shims
// The composable gates SSR on `typeof window`, then reads the GLOBAL
// localStorage that tmcut_store_env installed. Seed BEFORE the template
// module import (its top-level auto-load + migration runs at import time),
// so the legacy payload must already be in storage when main() seeds it.

const storage = globalThis.localStorage
;(globalThis as Record<string, unknown>).window = {}

function tk(sec: number): number {
  return Math.round(sec * TICKS)
}

let passed = 0
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed++
    console.log(`   ${label} PASSED`)
  })
}

async function main() {
  console.log('=== [TMCut Templates] Starting ===\n')

  // ---- Seed a seconds-era (v1) user template BEFORE the first import ----
  const legacy = [{
    id: 'usr_tpl_old',
    name: 'Legacy Vlog',
    category: 'intro',
    aspectRatio: '16:9',
    canvas: { width: 1920, height: 1080, fps: 30 },
    durationTicks: 6 * TICKS,
    tracks: [{
      id: 'tr-1',
      type: 'video',
      name: 'Video',
      items: [{ id: 'c1', src: 'a.mp4', in: 1.5, out: 6, offset: 0.5, speed: 1 }]
    }],
    placeholders: [],
    isBuiltin: false
  }]
  storage.setItem('tmcut_user_templates_v1', JSON.stringify(legacy))
  storage.removeItem('tmcut_user_templates_v2')

  // Nuxt auto-imports `useTmcutProject`; the harness only shims Vue
  // globals, so expose the real composable (same singleton the harness
  // uses) before the templates composable calls it.
  const storeMod = await import('../../app/composables/useTmcutProject')
  ;(globalThis as Record<string, unknown>).useTmcutProject = storeMod.useTmcutProject

  // Import triggers the module-level auto-load → legacy migration.
  const { useTmcutTemplates } = await import('../../app/composables/useTmcutTemplates')
  const api = useTmcutTemplates()

  await check('legacy seconds templates migrate to ticks once at load', () => {
    const tpl = api.userTemplates.value.find(t => t.id === 'usr_tpl_old')
    assert.ok(tpl, 'the legacy template survived the migration')
    const item = tpl!.tracks.find(t => t.type === 'video')!.items!.find(i => i.id === 'c1')!
    assert.equal(item.in, tk(1.5), 'in scales ×120000')
    assert.equal(item.out, tk(6))
    assert.equal(item.offset, tk(0.5))
    assert.equal(storage.getItem('tmcut_user_templates_v1'), null, 'legacy key removed')
    const persisted = JSON.parse(storage.getItem('tmcut_user_templates_v2')!)
    assert.equal(persisted[0].tracks[0].items[0].in, tk(1.5), 'ticks persisted under v2')
    // Single scale: 1.5s → 180000, NOT 1.5 × 120000² .
    assert.ok((item.in as number) < TICKS * 3, 'value is single-scaled, not squared')
  })

  await check('save ticks store as template preserves integer geometry', async () => {
    const store = await freshStore()
    store.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(3), offset: 0 })
    store.addClipToTrack('video', { src: 'b.mp4', in: tk(1), out: tk(4), offset: tk(3) })
    const before = api.userTemplates.value.length
    const tpl = api.saveCurrentProjectAsTemplate({ name: 'Ticks Tpl', category: 'custom', aspectRatio: '16:9' })
    assert.ok(tpl, 'template created from the ticks store')
    assert.equal(api.userTemplates.value.length, before + 1, 'template listed')
    // Last clip ends at offset tk(3) + (out-in)/speed = tk(3)+tk(3) = tk(6).
    assert.equal(tpl!.durationTicks, tk(6), 'duration derives from tick geometry')
    const items = tpl!.tracks.find(t => t.type === 'video')!.items!
    assert.ok(items.every(i => Number.isInteger(i.in) && Number.isInteger(i.out) && Number.isInteger(i.offset)), 'items stay integer ticks')
    assert.equal(items.find(i => i.src === 'b.mp4')!.in, tk(1))
  })

  await check('instantiating a template lands ticks back into a project', async () => {
    const tpl = api.userTemplates.value.find(t => t.name === 'Ticks Tpl')
    assert.ok(tpl, 'the saved template is instantiable')
    const proj = await api.createProjectFromTemplate(tpl!, { projectName: 'From Tpl' })
    const items = proj.timeline.tracks.find(t => t.type === 'video')!.items!
    assert.equal(items.length, 2, 'both clips carried over')
    assert.ok(items.every(i => Number.isInteger(i.in) && Number.isInteger(i.out) && Number.isInteger(i.offset)), 'instantiated items remain ticks')
    assert.equal(proj.durationMs, 6000, 'durationMs = durationTicks decoded to ms')
  })

  await check('deleteUserTemplate removes and persists', () => {
    const id = api.userTemplates.value.find(t => t.name === 'Ticks Tpl')!.id
    assert.equal(api.deleteUserTemplate(id), true)
    const persisted = JSON.parse(storage.getItem('tmcut_user_templates_v2')!)
    assert.equal(persisted.some((t: { id: string }) => t.id === id), false, 'removed from storage too')
  })

  console.log(`\n=== All ${passed} template checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
