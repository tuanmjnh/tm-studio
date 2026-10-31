/**
 * Ripple delete (acrossTracks), snapshot restore, canvas background and
 * the init() boot scan (R109) — the last untested store seams.
 *
 * Contracts pinned:
 *  - rippleDeleteSelected (default) removes the clip and shifts only
 *    LATER clips on the SAME track; other tracks stay put; the
 *    selection clears; one undo entry restores everything;
 *  - acrossTracks=true also shifts later clips on every OTHER unlocked
 *    track (A/V sync); locked tracks never shift and a locked selected
 *    clip is refused WITHOUT a history entry (R99/R103 refusal rule);
 *  - restoreSnapshot reads the project snapshot over IPC, applies
 *    migration + index sync + mirror, and — unlike openProject paths —
 *    KEEPS the history stack (same project id, R94 rule) so a following
 *    undo walks back pre-restore state; without IPC it is a no-op;
 *  - setCanvasBackground normalizes through normalizeCanvas and
 *    persists to the mirror;
 *  - init() (run on every store access, idempotent) boot-scans
 *    localStorage tmcut_project_* keys into the index, silently
 *    skipping corrupt payloads.
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
  readSnapshot: (payload: { id: string, ts: number }) => Promise<unknown>
  listProjectFiles: () => Promise<unknown[]>
  writeProject: (payload: { id: string, data: unknown }) => Promise<void>
}

interface MockHandle {
  snapshotData: unknown
  reads: Array<{ id: string, ts: number }>
  writes: Array<{ id: string, data: unknown }>
  cleanup: () => void
}

function installIpc(): MockHandle {
  const s: MockHandle = {
    snapshotData: null,
    reads: [],
    writes: [],
    cleanup: () => {
      delete (globalThis.window as Record<string, unknown>).electronAPI
    }
  }
  const ipc: IpcMock = {
    readSnapshot: async (payload) => {
      s.reads.push(payload)
      return s.snapshotData
    },
    listProjectFiles: async () => [],
    writeProject: async (p) => { s.writes.push(p) }
  }
  const w = (globalThis.window ??= {}) as Record<string, unknown>
  w.electronAPI = { tmcut: ipc }
  return s
}

async function main() {
  await check('ripple delete (default) shifts only the SAME track', async () => {
    const s = await freshStore()
    const c1 = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const c2 = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(2), offset: tk(4) })!
    s.addClipToTrack('audio', { src: 'c.wav', in: 0, out: tk(2), offset: tk(4) })
    const v = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    const a = s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!
    s.selectClip(c1.id)
    if (!s.rippleDeleteSelected()) throw new Error('ripple delete failed')
    if (s.selectedClipId.value !== null) throw new Error('selection must clear')
    const c2After = v.items!.find(i => i.id === c2.id)!
    if (c2After.offset !== 0) throw new Error(`same-track later clip must shift: ${c2After.offset}`)
    const a1 = a.items![0]!
    if (a1.offset !== tk(4)) throw new Error('other track must stay put by default')
    s.undo()
    // Re-read after undo: the store swaps containers (JSON snapshot),
    // pre-undo track references are stale.
    const vBack = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    if (vBack.items!.length !== 2) throw new Error(`undo must restore the clip, got ${vBack.items!.length}`)
    if (vBack.items!.find(i => i.id === c2.id)!.offset !== tk(4)) throw new Error('undo must restore positions')
  })

  await check('ripple delete acrossTracks shifts every UNLOCKED track, never locked ones', async () => {
    const s = await freshStore()
    const c1 = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const c2 = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(2), offset: tk(4) })!
    const a1 = s.addClipToTrack('audio', { src: 'c.wav', in: 0, out: tk(2), offset: tk(4) })!
    const tracks = () => s.currentProject.value!.timeline.tracks
    const vOf = () => tracks().find(t => t.type === 'video')!
    const aOf = () => tracks().find(t => t.type === 'audio')!
    s.selectClip(c1.id)
    if (!s.rippleDeleteSelected(true)) throw new Error('across-tracks ripple failed')
    if (vOf().items!.find(i => i.id === c2.id)!.offset !== 0) throw new Error('video later clip must shift')
    if (aOf().items!.find(i => i.id === a1.id)!.offset !== 0) throw new Error('audio later clip must shift too')
    s.undo()
    if (vOf().items!.find(i => i.id === c1.id) === undefined) throw new Error('undo must restore the deleted clip')
  })

  await check('ripple delete acrossTracks leaves a LOCKED track untouched', async () => {
    const s = await freshStore()
    const c1 = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const c2 = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(2), offset: tk(4) })!
    const a1 = s.addClipToTrack('audio', { src: 'c.wav', in: 0, out: tk(2), offset: tk(4) })!
    const tracks = () => s.currentProject.value!.timeline.tracks
    const vOf = () => tracks().find(t => t.type === 'video')!
    const aOf = () => tracks().find(t => t.type === 'audio')!
    aOf().locked = true
    s.selectClip(c1.id)
    if (!s.rippleDeleteSelected(true)) throw new Error('delete itself must still succeed')
    if (vOf().items!.find(i => i.id === c2.id)!.offset !== 0) throw new Error('same track shifts')
    if (aOf().items!.find(i => i.id === a1.id)!.offset !== tk(4)) throw new Error('locked track must NOT shift')
  })

  await check('ripple delete of a LOCKED clip is refused with no history entry', async () => {
    const s = await freshStore()
    const c1 = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const tracks = () => s.currentProject.value!.timeline.tracks
    const vOf = () => tracks().find(t => t.type === 'video')!
    vOf().locked = true
    s.selectClip(c1.id)
    if (s.rippleDeleteSelected()) throw new Error('locked clip must be refused')
    if (vOf().items!.length !== 1) throw new Error('timeline must be untouched')
    // Refusal rule: the clip's own add pushed the only entry, so one
    // undo empties the timeline. A phantom push from the refused delete
    // would instead leave the clip behind.
    s.undo()
    if (vOf().items!.length !== 0) throw new Error('refused delete pushed history')
  })

  await check('restoreSnapshot swaps state via IPC, KEEPS history (same project), mirrors', async () => {
    const s = await freshStore()
    const m = installIpc()
    try {
      const id = s.currentProject.value!.id
      s.addClipToTrack('video', { src: 'first.mp4', in: 0, out: tk(2), offset: 0 })
      s.addClipToTrack('video', { src: 'second.mp4', in: 0, out: tk(2), offset: tk(2) })
      // Snapshot = the same project with an EMPTY timeline (a saved
      // earlier state). Restoring it must not reset the history stacks
      // (R94: reset is for openProject paths; a restore is the same
      // project id).
      const base = JSON.parse(JSON.stringify(s.currentProject.value)) as { timeline: { tracks: Array<{ items?: unknown[] }> } }
      for (const t of base.timeline.tracks) t.items = []
      m.snapshotData = base
      await s.restoreSnapshot(1234)
      if (!m.reads.some(r => r.id === id && r.ts === 1234)) throw new Error('snapshot not read by project id + ts')
      const vAfter = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
      if (vAfter.items!.length !== 0) throw new Error('snapshot state not applied')
      // Same project id: the stack KEPT. canUndo is still true, and one
      // undo reaches the pre-clip2 state (1 clip) — a reset stack would
      // be empty and undo a no-op.
      if (!s.canUndo.value) throw new Error('history must survive a restore')
      s.undo()
      const vUndo = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
      if (vUndo.items!.length !== 1) throw new Error(`undo after restore must reach the pre-clip2 state (1 clip), got ${vUndo.items!.length}`)
      // saveProject inside restoreSnapshot mirrors synchronously.
      const mirror = JSON.parse(localStorage.getItem(`tmcut_project_${id}`) || 'null')
      if (!mirror || !Array.isArray(mirror.timeline?.tracks)) throw new Error('restore must mirror the restored state')
    } finally { m.cleanup() }
  })

  await check('restoreSnapshot without IPC (web) is a clean no-op', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    await s.restoreSnapshot(999) // no IPC -> nothing happens
    if (s.currentProject.value!.id !== id) throw new Error('web restore must not swap projects')
  })

  await check('setCanvasBackground normalizes and mirrors', async () => {
    const s = await freshStore()
    s.setCanvasBackground('color', '#ff0000')
    const canvas = s.currentProject.value!.canvas!
    if (canvas.background.type !== 'color' || canvas.background.value !== '#ff0000') throw new Error('color background not applied')
    s.setCanvasBackground('transparent')
    const after = s.currentProject.value!.canvas!
    if (after.background.type !== 'transparent') throw new Error('transparent background not applied')
    const mirror = JSON.parse(localStorage.getItem(`tmcut_project_${s.currentProject.value!.id}`) || 'null')
    if (!mirror || mirror.canvas.background.type !== 'transparent') throw new Error('background not mirrored')
  })

  await check('init() boot-scans localStorage mirrors into the index (corrupt skipped)', async () => {
    // Seed mirrors BEFORE this store instance: init() runs on every
    // useTmcutProject() call and dedupes by id.
    const seeded = {
      id: 'seeded-1', name: 'Seeded project', schemaVersion: 3,
      canvas: { width: 1920, height: 1080, fps: { numerator: 30, denominator: 1 } },
      settings: { resolution: '1920x1080', fps: { numerator: 30, denominator: 1 }, format: 'mp4', bitrate: 5000 },
      timeline: { version: 1, tracks: [], durationMs: 0, markers: [] },
      updated_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:00.000Z'
    }
    localStorage.setItem('tmcut_project_seeded-1', JSON.stringify(seeded))
    localStorage.setItem('tmcut_project_corrupt-1', '{ not valid json')
    const s = await freshStore()
    const found = s.projects.value.find(p => p.id === 'seeded-1')
    if (!found || found.name !== 'Seeded project') throw new Error('seeded mirror must appear in the index')
    if (s.projects.value.some(p => p.id === 'corrupt-1')) throw new Error('corrupt mirror must be skipped silently')
    localStorage.removeItem('tmcut_project_seeded-1')
    localStorage.removeItem('tmcut_project_corrupt-1')
  })

  console.log(`\n=== All ${passed} ripple-2 / snapshot / init checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
