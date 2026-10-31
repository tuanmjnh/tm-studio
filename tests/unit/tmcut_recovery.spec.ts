/**
 * Recovery + snapshots at the store/IPC seam (R105, docs section 50).
 *
 * detectRecovery runs inside loadProject (desktop only) and maps the
 * core decideRecovery verdict onto store behaviour:
 *  - 'none'     -> nothing offered, currentProject is the disk/screen file;
 *  - 'suggest'  -> currentProject stays, pendingRecovery carries id/name;
 *    applyRecovery then swaps it in and CLEARS pendingRecovery;
 *    dismissRecovery deletes the recovery file and clears the prompt;
 *  - 'force'    -> recovery is applied immediately (project file missing),
 *    legacy seconds payloads migrate through the normal schema path, and
 *    pendingRecovery STILL surfaces so the banner text is honest; the
 *    applied state is scheduled to disk immediately (delay 0).
 * Snapshots are desktop-only: the web session gets an empty list; the
 * IPC payload must be a PLAIN copy (reactive proxies do not survive the
 * structured clone), and delete/list refresh the UI state.
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)

interface IpcMock {
  readProject: (id: string) => Promise<unknown>
  readProjectMeta: (id: string) => Promise<unknown>
  readRecovery: (id: string) => Promise<unknown>
  writeProject: (payload: { id: string, data: unknown }) => Promise<void>
  writeRecovery: (payload: { id: string, data: unknown }) => Promise<void>
  deleteRecovery: (id: string) => Promise<void>
  listSnapshots: (id: string) => Promise<unknown[]>
  saveSnapshot: (payload: { id: string, data: unknown, name?: string }) => Promise<void>
  readSnapshot: (payload: { id: string, ts: number }) => Promise<unknown>
  deleteSnapshot: (payload: { id: string, ts: number }) => Promise<void>
  listProjectFiles: () => Promise<unknown[]>
}

interface MockState {
  project: unknown | null
  meta: Record<string, unknown> | null
  recovery: unknown | null
  snapshotList: Array<{ ts: number, name: string, updatedAt: string }>
  snapshotData: unknown | null
  writtenProjects: Array<{ id: string, data: unknown }>
  writtenRecoveries: unknown[]
  savedSnapshots: Array<{ name?: string, data: unknown }>
  deletedRecoveries: string[]
  deletedSnapshots: number[]
}

type MockHandle = MockState & { cleanup: () => void, drain: () => Promise<void> }

function installIpc(overrides: Partial<MockState> = {}): MockHandle {
  // The handle IS the state object: tests may assign project/meta/
  // recovery AFTER install (before loadProject), and the ipc closures
  // must observe those writes.
  const s = {
    project: null,
    meta: null,
    recovery: null,
    snapshotList: [],
    snapshotData: null,
    writtenProjects: [],
    writtenRecoveries: [],
    savedSnapshots: [],
    deletedRecoveries: [],
    deletedSnapshots: [],
    ...overrides
  } as MockHandle
  const ipc: IpcMock = {
    readProject: async () => s.project,
    readProjectMeta: async () => s.meta,
    readRecovery: async () => s.recovery,
    writeProject: async (payload) => { s.writtenProjects.push(payload) },
    writeRecovery: async (payload) => { s.writtenRecoveries.push(payload.data) },
    deleteRecovery: async (id) => { s.deletedRecoveries.push(id) },
    listSnapshots: async () => s.snapshotList,
    saveSnapshot: async (payload) => {
      // structured clone approximation: proxies/JSON round-trip must pass
      JSON.parse(JSON.stringify(payload.data))
      s.savedSnapshots.push({ name: payload.name, data: payload.data })
    },
    readSnapshot: async () => s.snapshotData,
    deleteSnapshot: async (payload) => { s.deletedSnapshots.push(payload.ts) },
    listProjectFiles: async () => []
  }
  // The store reads window.electronAPI?.tmcut; provide just that.
  const w = (globalThis.window ??= {}) as unknown as Record<string, unknown>
  w.electronAPI = { tmcut: ipc }
  s.cleanup = () => {
    delete w.electronAPI
  }
  s.drain = () => new Promise<void>(resolve => setTimeout(resolve, 30))
  return s
}

async function main() {
  await check('web session (no IPC): detectRecovery/snapshots are clean no-ops', async () => {
    const s = await freshStore()
    await s.loadSnapshots()
    if (s.snapshots.value.length !== 0) throw new Error('web snapshots must be empty')
    if (s.pendingRecovery.value !== null) throw new Error('no recovery prompt without IPC')
    await s.createSnapshot('x') // must not throw
    if (s.snapshots.value.length !== 0) throw new Error('createSnapshot leaked state on web')
  })

  await check(`decide='none': no prompt, screen state untouched`, async () => {
    const s = await freshStore()
    const m = installIpc({
      meta: { hasRecovery: false, recoveryUpdatedAtMs: null, hasProject: true, projectMtimeMs: 1 }
    })
    try {
      const proj = s.createProject('plain')
      m.project = JSON.parse(JSON.stringify(proj)) // disk copy
      await s.loadProject(proj.id)
      if (s.pendingRecovery.value !== null) throw new Error('none must not prompt')
    } finally { m.cleanup() }
  })

  await check(`decide='suggest': currentProject stays, banner names the recovery`, async () => {
    const s = await freshStore()
    const m = installIpc()
    try {
      const proj = s.createProject('disk-project')
      m.project = JSON.parse(JSON.stringify(proj))
      // No updated_at on the recovery: the stamp must come from meta.
      m.recovery = { ...m.project as object, id: proj.id, name: 'Recovered', updated_at: undefined }
      m.meta = { hasRecovery: true, recoveryUpdatedAtMs: 2000, hasProject: true, projectMtimeMs: 1000 }
      await s.loadProject(proj.id)
      const pending = s.pendingRecovery.value
      // The recovery file is keyed by PROJECT id — that is the identity
      // applyRecovery/readRecovery round-trips on.
      if (!pending || pending.id !== proj.id) throw new Error(`suggest must expose project id, got ${pending?.id}`)
      if (pending.updatedAt !== new Date(2000).toISOString()) throw new Error('updatedAt must come from the recovery stamp')
      if (s.currentProject.value!.name !== 'disk-project') throw new Error('suggest must NOT apply the recovery')
    } finally { m.cleanup() }
  })

  await check('applyRecovery swaps the project and clears the prompt', async () => {
    const s = await freshStore()
    const recoveryProject = JSON.parse(JSON.stringify(s.createProject('from-recovery')))
    recoveryProject.name = 'FROM RECOVERY'
    const m = installIpc({
      meta: { hasRecovery: true, recoveryUpdatedAtMs: 2000, hasProject: true, projectMtimeMs: 1000 },
      recovery: recoveryProject
    })
    try {
      const proj = s.createProject('disk-project')
      m.project = JSON.parse(JSON.stringify(proj))
      await s.loadProject(proj.id)
      const writesAfterOpen = m.writtenProjects.length
      await s.applyRecovery()
      if (s.currentProject.value!.name !== 'FROM RECOVERY') throw new Error('recovery not applied')
      if (s.pendingRecovery.value !== null) throw new Error('apply must clear the prompt')
      await m.drain() // flushDiskSave inside applyRecovery
      if (m.writtenProjects.length <= writesAfterOpen) throw new Error('apply must persist the recovered state')
      const last = m.writtenProjects.at(-1)!.data as { name: string }
      if (last.name !== 'FROM RECOVERY') throw new Error('the persisted write must carry the RECOVERED data')
    } finally { m.cleanup() }
  })

  await check('dismissRecovery deletes the recovery file and clears the prompt', async () => {
    const s = await freshStore()
    const m = installIpc({
      meta: { hasRecovery: true, recoveryUpdatedAtMs: 2000, hasProject: true, projectMtimeMs: 1000 },
      recovery: { id: 'anything', name: 'Nope', schemaVersion: 3 }
    })
    try {
      const proj = s.createProject('keep-disk')
      m.project = JSON.parse(JSON.stringify(proj))
      m.recovery = { id: proj.id, name: 'Nope', schemaVersion: 3 }
      await s.loadProject(proj.id)
      if (!s.pendingRecovery.value) throw new Error('precondition: prompt shown')
      await s.dismissRecovery()
      if (s.pendingRecovery.value !== null) throw new Error('dismiss must clear the prompt')
      if (!m.deletedRecoveries.includes(proj.id)) throw new Error('recovery file must be deleted by project id')
      if (s.currentProject.value!.name !== 'keep-disk') throw new Error('dismiss must keep the disk project')
    } finally { m.cleanup() }
  })

  await check(`decide='force': missing project file applies recovery immediately, prompt stays honest`, async () => {
    const s = await freshStore()
    // Legacy seconds payload under a NEW id whose project file is gone —
    // exactly the crash case: recovery is all that is left.
    const legacy = {
      id: 'orphan', schemaVersion: 2, name: 'Orphan',
      canvas: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 } },
      timeline: {
        tracks: [
          { id: 'v', type: 'video', name: 'V', items: [{ id: 'old1', src: 'a.mp4', in: 1.5, out: 6, offset: 0.5, speed: 1, opacity: 100, scale: 100, x: 0, y: 0, rotation: 0 }] }
        ]
      }
    }
    const m = installIpc({
      meta: { hasRecovery: true, recoveryUpdatedAtMs: 1000, hasProject: false, projectMtimeMs: null },
      recovery: legacy
    })
    try {
      await s.loadProject('orphan') // disk missing -> falls to the orphan path
      if (s.currentProject.value!.id !== 'orphan') throw new Error('orphan project not opened')
      const item = s.currentProject.value!.timeline.tracks
        .find(t => t.type === 'video')!.items!.find(i => i.id === 'old1')!
      // Force path runs applyProjectMigration: seconds -> ticks once.
      if (item.in !== tk(1.5) || item.out !== tk(6)) throw new Error(`legacy recovery not migrated: ${item.in}/${item.out}`)
      if (s.currentProject.value!.schemaVersion !== 3) throw new Error('recovery must be stamped schema 3')
      // Honest banner: the user must KNOW their session was recovered.
      if (!s.pendingRecovery.value) throw new Error('force must still surface the recovery banner')
      await m.drain() // scheduleDiskSave(0) in the force path
      if (!m.writtenProjects.some(w => w.id === 'orphan')) throw new Error('force must persist the recovered state')
    } finally { m.cleanup() }
  })

  await check('snapshots: list/save/delete round-trip, payload is a plain copy', async () => {
    const s = await freshStore()
    const m = installIpc({
      snapshotList: [{ ts: 111, name: 'Before re-cut', updatedAt: '2026-01-01T00:00:00.000Z' }]
    })
    try {
      s.createProject('snap')
      s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
      await s.createSnapshot('Named shot')
      if (m.savedSnapshots.length !== 1) throw new Error('snapshot not saved')
      if (m.savedSnapshots[0]!.name !== 'Named shot') throw new Error('name not forwarded')
      // Reactive state reached the mock as JSON-safe data (structured clone).
      const sent = JSON.parse(JSON.stringify(m.savedSnapshots[0]!.data)) as { timeline: { tracks: Array<{ items?: unknown[] }> } }
      if (!sent.timeline.tracks.some(t => (t.items || []).length > 0)) throw new Error('snapshot missed the timeline')
      await s.loadSnapshots()
      if (s.snapshots.value.length !== 1 || s.snapshots.value[0]!.name !== 'Before re-cut') throw new Error('list not reflected')
      await s.deleteSnapshot(111)
      if (!m.deletedSnapshots.includes(111)) throw new Error('delete not forwarded')
    } finally { m.cleanup() }
  })

  console.log(`\n=== All ${passed} recovery/snapshot checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
