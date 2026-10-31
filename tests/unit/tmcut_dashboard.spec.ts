/**
 * Project dashboard lifecycle over IPC (R106): deleteProject and
 * refreshProjects are the two index-maintenance paths the dashboard
 * relies on, and neither had store-level coverage.
 *
 * Contracts pinned:
 *  - deleteProject removes the mirror, the in-memory entry and the disk
 *    files (IPC); deleting the CURRENT project also neutralizes the
 *    pending disk save (R95 — no resurrection), clears the selection and
 *    the pending recovery, and idles the save status;
 *  - deleteProject of a NON-current project leaves the open project's
 *    timer/selection untouched;
 *  - refreshProjects is a no-op without IPC; with IPC it adds disk files
 *    the index does not know (unshift), replaces a known entry when the
 *    DISK is newer (another process wrote), leaves the known entry alone
 *    when the disk is older (memory is fresher), and never touches the
 *    CURRENT project (in-memory wins while open).
 */
import { freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

interface IpcMock {
  readProject: (id: string) => Promise<unknown>
  listProjectFiles: () => Promise<Array<{ id: string, updatedAt: string }>>
  deleteProject: (id: string) => Promise<void>
  readProjectMeta: (id: string) => Promise<unknown>
  readRecovery: (id: string) => Promise<unknown>
  writeProject: (payload: { id: string, data: unknown }) => Promise<void>
  writeRecovery: (payload: { id: string, data: unknown }) => Promise<void>
  deleteRecovery: (id: string) => Promise<void>
  listSnapshots: (id: string) => Promise<unknown[]>
  saveSnapshot: (payload: { id: string, data: unknown, name?: string }) => Promise<void>
  readSnapshot: (payload: { id: string, ts: number }) => Promise<unknown>
  deleteSnapshot: (payload: { id: string, ts: number }) => Promise<void>
}

interface MockHandle {
  files: Array<{ id: string, updatedAt: string }>
  diskData: Record<string, unknown>
  deleted: string[]
  writes: unknown[]
  cleanup: () => void
  drain: () => Promise<void>
}

function installIpc(): MockHandle {
  const s: MockHandle = {
    files: [],
    diskData: {},
    deleted: [],
    writes: [],
    cleanup: () => {
      delete (globalThis.window as Record<string, unknown>).electronAPI
    },
    drain: () => new Promise<void>(resolve => setTimeout(resolve, 30))
  }
  const ipc: IpcMock = {
    readProject: async id => s.diskData[id] ?? null,
    listProjectFiles: async () => s.files,
    deleteProject: async (id) => { s.deleted.push(id) },
    readProjectMeta: async () => ({ hasRecovery: false, recoveryUpdatedAtMs: null, hasProject: true, projectMtimeMs: 1 }),
    readRecovery: async () => null,
    writeProject: async (p) => { s.writes.push(p) },
    writeRecovery: async () => {},
    deleteRecovery: async () => {},
    listSnapshots: async () => [],
    saveSnapshot: async () => {},
    readSnapshot: async () => null,
    deleteSnapshot: async () => {}
  }
  const w = (globalThis.window ??= {}) as Record<string, unknown>
  w.electronAPI = { tmcut: ipc }
  return s
}

async function main() {
  await check('deleteProject of the CURRENT project clears everything (R95 neutralization)', async () => {
    const s = await freshStore()
    const m = installIpc()
    try {
      const id = s.currentProject.value!.id
      s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
      await s.deleteProject(id)
      if (localStorage.getItem(`tmcut_project_${id}`) !== null) throw new Error('mirror must be removed')
      if (s.projects.value.some(p => p.id === id)) throw new Error('index entry must be removed')
      if (s.currentProject.value !== null) throw new Error('current must be cleared')
      if (s.selectedClipId.value !== null) throw new Error('selection must be cleared')
      if (s.saveStatus.value !== 'idle') throw new Error('save status must idle out')
      if (!m.deleted.includes(id)) throw new Error('IPC delete not forwarded')
      // No resurrection: the pending save timer was neutralized.
      await m.drain()
      const resurrected = m.writes.some(w => (w as { id: string }).id === id)
      if (resurrected) throw new Error('a late timer write resurrected the deleted project')
    } finally { m.cleanup() }
  })

  await check('deleteProject of ANOTHER project leaves the open project untouched', async () => {
    const s = await freshStore()
    const m = installIpc()
    try {
      const keepId = s.currentProject.value!.id
      s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
      const other = s.createProject('other')
      s.createProject('current-project')
      const currentId = s.currentProject.value!.id
      const liveClip = s.addClipToTrack('video', { src: 'live.mp4', in: 0, out: 480000, offset: 0 })!
      s.selectClip(liveClip.id)
      await s.deleteProject(other.id)
      if (m.deleted.length !== 1 || m.deleted[0] !== other.id) throw new Error('IPC delete must target only the deleted id')
      if (s.currentProject.value!.id !== currentId) throw new Error('open project must survive')
      if (s.selectedClipId.value !== liveClip.id) throw new Error('open selection must survive')
      if (localStorage.getItem(`tmcut_project_${keepId}`) === null) throw new Error('keep project mirror untouched')
      if (localStorage.getItem(`tmcut_project_${other.id}`) !== null) throw new Error('deleted mirror must be removed')
    } finally { m.cleanup() }
  })

  await check('refreshProjects: unknown disk file is added, newer disk wins, older disk loses, current is untouched', async () => {
    const s = await freshStore()
    const m = installIpc()
    try {
      const now = new Date()
      const older = new Date(now.getTime() - 60000).toISOString()
      const newer = new Date(now.getTime() + 60000).toISOString()
      // 1) a file the index does not know
      const unknownId = 'from-disk'
      m.diskData[unknownId] = {
        id: unknownId, name: 'From disk', schemaVersion: 3,
        canvas: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 } },
        settings: { resolution: '1920x1080', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 5000 },
        timeline: { version: 1, tracks: [], durationMs: 0, markers: [] },
        updated_at: older, created_at: older
      }
      m.files.push({ id: unknownId, updatedAt: older })
      await s.refreshProjects()
      const added = s.projects.value.find(p => p.id === unknownId)
      if (!added) throw new Error('unknown disk file must join the index')
      // 2) a known file whose DISK copy is newer than the index
      const knownOld = s.createProject('stale-index')
      await s.createProject('return-current') // knownOld is no longer current
      const knownId = knownOld.id
      m.diskData[knownId] = { ...(knownOld as object), name: 'NEWER-ON-DISK', updated_at: newer }
      m.files.push({ id: knownId, updatedAt: newer })
      await s.refreshProjects()
      const after = s.projects.value.find(p => p.id === knownId)
      if (after?.name !== 'NEWER-ON-DISK') throw new Error('newer disk copy must replace the index entry')
      // 3) a known file whose disk copy is OLDER than the index
      const knownFresh = s.createProject('fresh-memory')
      await s.createProject('return-current-2')
      const freshId = knownFresh.id
      m.diskData[freshId] = { ...(knownFresh as object), name: 'OLDER-ON-DISK', updated_at: older }
      m.files.push({ id: freshId, updatedAt: older })
      await s.refreshProjects()
      if (s.projects.value.find(p => p.id === freshId)?.name !== 'fresh-memory') throw new Error('older disk copy must NOT overwrite')
      // 4) the CURRENT project is never touched by refresh (in-memory
      //    wins while open), even when disk looks newer.
      const liveId = s.currentProject.value!.id
      const liveName = s.currentProject.value!.name
      m.files.push({ id: liveId, updatedAt: newer })
      await s.refreshProjects()
      if (s.currentProject.value!.id !== liveId) throw new Error('current must survive a refresh')
      if (s.projects.value.find(p => p.id === liveId)?.name !== liveName) throw new Error('current was overwritten by refresh')
    } finally { m.cleanup() }
  })

  await check('refreshProjects without IPC is a clean no-op', async () => {
    const s = await freshStore()
    const before = s.projects.value.length
    await s.refreshProjects()
    if (s.projects.value.length !== before) throw new Error('web refresh must not change the index')
  })

  await check('createProject clears the OUTGOING selection (no cross-project leak)', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })!
    s.selectClip(clip.id)
    s.createProject('fresh')
    if (s.selectedClipId.value !== null) throw new Error('selection leaked into the new project')
  })

  console.log(`\n=== All ${passed} dashboard-lifecycle checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
