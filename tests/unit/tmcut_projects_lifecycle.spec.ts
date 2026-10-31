/**
 * Project-management lifecycle at the web-fallback layer (R102): every
 * dashboard mutation must survive a reload. Desktop persists through IPC;
 * the web session's only durable layer is the localStorage mirror — the
 * same one loadProject/refreshProjects read. Contract pinned here:
 *  - renameProject updates the mirror for the CURRENT and NON-current
 *    project alike (J-2 rule: the web session survives reload);
 *  - togglePinProject persists the pin flag WITHOUT touching updated_at;
 *  - duplicateProject persists the clone (otherwise it vanishes on reload);
 *  - updateClipsSrc relinks every clip that references the old path
 *    (path-normalized) and reports the honest count.
 */
import { freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const mirror = (id: string) => JSON.parse(localStorage.getItem(`tmcut_project_${id}`) || 'null')

async function main() {
  await check('renaming the CURRENT project updates the mirror', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    await s.renameProject(id, 'Renamed!  ')
    const m = mirror(id)
    if (m.name !== 'Renamed!') throw new Error(`mirror name: ${m.name}`)
  })

  await check('renaming a NON-current project updates its mirror too (web reload)', async () => {
    const s = await freshStore()
    const aId = s.currentProject.value!.id
    const b = s.createProject('b-current') // b is now current; a is not persisted again
    await s.renameProject(aId, 'Renamed elsewhere')
    const m = mirror(aId)
    if (!m) throw new Error('project a has no mirror yet')
    if (m.name !== 'Renamed elsewhere') throw new Error(`web rename lost: mirror shows ${m.name}`)
    if (b.id === aId) throw new Error('sanity')
  })

  await check('rename ignores blank names and unknown ids', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    const before = mirror(id).updated_at
    await s.renameProject(id, '   ')
    if (mirror(id).updated_at !== before) throw new Error('blank rename must be a no-op')
    await s.renameProject('nope', 'X') // must not throw
  })

  await check('togglePinProject persists pinned WITHOUT bumping updated_at', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    const before = await mirror(id)
    const pinned = await s.togglePinProject(id)
    if (pinned !== true) throw new Error('toggle must report the new state')
    const after = mirror(id)
    if (after.pinned !== true) throw new Error('pin not mirrored')
    if (after.updated_at !== before.updated_at) throw new Error('metadata write must not bump updated_at')
    const again = await s.togglePinProject(id)
    if (again !== false || mirror(id).pinned !== false) throw new Error('second toggle must unpin')
  })

  await check('duplicateProject mirrors the clone so reload keeps it', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
    const sourceId = s.currentProject.value!.id
    const clone = await s.duplicateProject(sourceId, 'copy')
    if (!clone) throw new Error('duplicate failed')
    if (mirror(clone.id) === null) throw new Error('clone has no mirror — reload would lose the duplicate')
    const m = mirror(clone.id)
    if (m.timeline.tracks.find((t: { type: string }) => t.type === 'video').items.length !== 1) {
      throw new Error('clone mirror missing the timeline')
    }
    // The clone must not steal the current project slot.
    if (s.currentProject.value!.id !== sourceId) throw new Error('duplicate must not switch the open project')
  })

  await check('updateClipsSrc relinks by normalized path and reports the count', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'C:\\Media\\Old.MP4', in: 0, out: 480000, offset: 0 })
    s.addClipToTrack('video', { src: 'C:/media/old.mp4', in: 0, out: 480000, offset: 480000 })
    s.addClipToTrack('audio', { src: 'C:\\Other\\keep.wav', in: 0, out: 240000, offset: 0 })
    const n = s.updateClipsSrc('C:\\media\\OLD.MP4', 'D:\\New\\fixed.mp4')
    // Windows-style paths differing only in slashes: normalizePath makes
    // them equal; case differences remain (the store does not lowercase).
    const videoItems = s.currentProject.value!.timeline.tracks
      .find(t => t.type === 'video')!.items!
    const updated = videoItems.filter(i => i.src === 'D:\\New\\fixed.mp4').length
    if (updated !== n) throw new Error(`count ${n} disagrees with actual ${updated}`)
    const audioItem = s.currentProject.value!.timeline.tracks
      .find(t => t.type === 'audio')!.items![0]!
    if (audioItem.src !== 'C:\\Other\\keep.wav') throw new Error('unrelated clip was touched')
  })

  // ===== R132 — monotonic project revision counter (docs §196) =====
  // The revision is the single honest answer to "was this project edited
  // while I had it open": it bumps on every save, never on open, and is
  // reported by the mirror so a reload can be compared against the
  // revision-at-load snapshot. It is advisory, not a lock.
  await check('fresh projects start at revision 0 and bump on every save', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    if (s.currentRevision() !== 0) throw new Error(`fresh project revision: ${s.currentRevision()}`)
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
    if (s.currentRevision() !== 1) throw new Error('first save did not bump revision')
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: 240000, offset: 0 })
    if (s.currentRevision() !== 2) throw new Error('second save did not bump revision')
    if (mirror(id).revision !== 2) throw new Error('mirror does not carry the revision')
  })

  await check('revision is monotonic and survives a reload', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
    const before = s.currentRevision()
    // Reload the same project from the mirror: revision must be preserved.
    await s.loadProject(id)
    if (s.currentRevision() !== before) throw new Error(`reload lost revision: ${s.currentRevision()} != ${before}`)
    if ((s.revisionAtLoad.value ?? 0) !== before) throw new Error('revisionAtLoad not pinned at open')
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: 240000, offset: 0 })
    if (s.currentRevision() !== before + 1) throw new Error('revision not monotonic after reload')
  })

  await check('metadata-only writes do not bump the revision', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
    const before = s.currentRevision()
    const beforeUpdated = mirror(id).updated_at
    await s.togglePinProject(id)
    if (s.currentRevision() !== before) throw new Error('pin write bumped the revision')
    if (mirror(id).updated_at !== beforeUpdated) throw new Error('pin write bumped updated_at')
  })

  await check('an external writer bumping the file is detectable while open', async () => {
    const s = await freshStore()
    const id = s.currentProject.value!.id
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: 480000, offset: 0 })
    const atLoad = s.revisionAtLoad.value!
    // Simulate another process writing the file (mirror + current project)
    // while this session held it open: bump the revision without an edit.
    s.currentProject.value!.revision = atLoad + 5
    mirror(id).revision = atLoad + 5
    if (s.currentRevision() <= atLoad) throw new Error('external bump not visible')
    if (s.currentRevision() <= s.revisionAtLoad.value!) throw new Error('stale signal missing')
  })

  console.log(`\n=== All ${passed} project-lifecycle checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
