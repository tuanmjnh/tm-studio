/**
 * Disk-save lifecycle (R95): the 2s-debounced project write must follow
 * the project it was scheduled for — never the project that happens to be
 * open when the timer finally fires.
 *
 * The store cannot reach Electron IPC in Node, so `persistProjectToDisk`
 * is a no-op here; the specs pin everything the browser path depends on:
 * pending-timer neutralization, the saveStatus transitions, and the
 * no-resurrection guarantee around deleteProject.
 */
import { freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

function mirror(id: string) {
  return JSON.parse(localStorage.getItem(`tmcut_project_${id}`) || 'null')
}

// --- debounced-disk-save timer spy -------------------------------------
// scheduleDiskSave() is the only caller using the store's fixed default
// delay, so hooking the raw timer lets each check assert the PENDING save
// was flushed or cancelled — deterministic, no sleeping. Keys are the
// REAL handles (Node Timeout objects), since that is what the store hands
// back to clearTimeout.
const rawSetTimeout = globalThis.setTimeout
const rawClearTimeout = globalThis.clearTimeout
const diskTimers = new Map<unknown, { fired: boolean, cleared: boolean }>()
globalThis.setTimeout = ((fn: (...a: never[]) => void, delay?: number, ...rest: unknown[]) => {
  if (delay === 2000) {
    const state = { fired: false, cleared: false }
    const handle = rawSetTimeout(() => {
      if (!state.cleared) state.fired = true
      fn()
    }, delay, ...rest)
    diskTimers.set(handle, state)
    return handle as unknown as number
  }
  return rawSetTimeout(fn, delay, ...rest) as unknown as number
}) as typeof globalThis.setTimeout
globalThis.clearTimeout = ((handle?: unknown) => {
  const t = handle === undefined ? undefined : diskTimers.get(handle)
  if (t) t.cleared = true
  rawClearTimeout(handle as ReturnType<typeof globalThis.setTimeout> | undefined)
}) as typeof globalThis.clearTimeout

function pendingDiskSaves(): number {
  let n = 0
  for (const t of diskTimers.values()) if (!t.fired && !t.cleared) n++
  return n
}
async function drainDiskTimers() {
  await new Promise<void>(r => rawSetTimeout(r, 30))
}

async function main() {
  await check('saveProject writes the localStorage mirror synchronously, saveStatus moves to saving (no IPC)', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: 240000, offset: 0 })
    // Synchronous: no timer involved in the mirror write.
    const m = mirror(id)
    if (!m) throw new Error('mirror missing')
    if (m.timeline.tracks.find((t: { type: string }) => t.type === 'video').items.length !== 1) {
      throw new Error('mirror does not carry the new clip')
    }
    // Without IPC the disk write cannot even start, so the status never
    // lies "saving" forever...
    if (s.saveStatus.value === 'saving') throw new Error('saveStatus stuck in saving without an IPC layer')
  })

  await check('pending autosave of the OUTGOING project is flushed before the switch', async () => {
    const s = await freshStore()
    const aId = s.currentProject.value!.id
    s.addClipToTrack('video', { name: 'a-clip', src: 'a.mp4', in: 0, out: 240000, offset: 0 })
    // One save timer armed for A right now (from addClipToTrack).
    const armedBefore = pendingDiskSaves()
    // Switch: createProject must flush (clearing A's timer) before the
    // switch; only B's own new save may remain armed (R95).
    const b = s.createProject('b')
    if (armedBefore !== 1) throw new Error(`expected one pending save before the switch, got ${armedBefore}`)
    if (pendingDiskSaves() > 1) throw new Error(`A's save timer survived the switch: ${pendingDiskSaves()} armed`)
    await drainDiskTimers()
    const a = mirror(aId)
    const aItems = a.timeline.tracks.find((t: { type: string }) => t.type === 'video').items
    if (aItems.length !== 1 || aItems[0].name !== 'a-clip') {
      throw new Error('outgoing project lost its pending edit on switch')
    }
    const bMirror = mirror(b.id)
    if (bMirror.timeline.tracks.find((t: { type: string }) => t.type === 'video').items.length !== 0) {
      throw new Error('new project mirror must start empty')
    }
  })

  await check('loadProject persists a pending edit BEFORE replacing the project', async () => {
    const s = await freshStore()
    const aId = s.currentProject.value!.id
    s.addClipToTrack('video', { name: 'a-clip', src: 'a.mp4', in: 0, out: 240000, offset: 0 })
    const b = s.createProject('b-only-mirror')
    s.addClipToTrack('video', { name: 'b-clip', src: 'b.mp4', in: 0, out: 240000, offset: 0 })
    // loadProject(b) must flush B's pending clip first; then switching to
    // A, then back to b must show it.
    await s.loadProject(b.id)
    await s.loadProject(aId)
    await s.loadProject(b.id)
    const items = s.currentProject.value!.timeline.tracks
      .find(t => t.type === 'video')!.items!
    if (items.length !== 1 || items[0]!.name !== 'b-clip') {
      throw new Error(`pending edit lost across loadProject: ${JSON.stringify(items.map(i => i.name))}`)
    }
  })

  await check('deleting the current project cancels its pending disk save (no resurrection)', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: 240000, offset: 0 })
    await s.deleteProject(id)
    if (mirror(id) !== null) throw new Error('mirror survived the delete')
    if (s.saveStatus.value !== 'idle') throw new Error('saveStatus must reset for the removed project')
    if (pendingDiskSaves() !== 0) throw new Error(`delete left a disk-save timer armed: ${pendingDiskSaves()}`)
    await drainDiskTimers()
    if (s.currentProject.value !== null) throw new Error('a cancelled save must not restore the project')
    if (mirror(id) !== null) throw new Error('a late timer fire resurrected the deleted project')
  })

  await check('deleting a NON-current project keeps the current project state untouched', async () => {
    const s = await freshStore()
    const oldId = s.currentProject.value!.id
    const keep = s.createProject('keep-current')
    s.addClipToTrack('video', { name: 'keeper', src: 'k.mp4', in: 0, out: 240000, offset: 0 })
    await s.deleteProject(oldId) // delete the project we LEFT, not the open one
    if (s.currentProject.value!.id !== keep.id) throw new Error('current project switched unexpectedly')
    const items = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!
    if (items.length !== 1) throw new Error('current project timeline touched by the delete')
    if (s.saveStatus.value === 'saving') throw new Error('no disk work should be pending after deleting another project')
  })

  console.log(`\n=== All ${passed} save-lifecycle checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
