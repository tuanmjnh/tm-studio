/**
 * Undo/redo behaviour, including the B8 coalescing rule and history
 * isolation across project switches (R94).
 *
 * The history is a stack of full {timeline, canvas} JSON snapshots taken
 * BEFORE each mutation. Two flavours:
 *  - discrete ops (add/remove/split) push their own entry (pushHistory);
 *  - Inspector burst edits call pushHistoryCoalesced(key) + updateClip —
 *    updateClip never pushes itself, so the burst's FIRST push (the state
 *    before the burst) is the only entry, and one undo walks back all of it.
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)

function videoItemCount(store: Awaited<ReturnType<typeof freshStore>>): number {
  return store.currentProject.value!.timeline.tracks
    .find(t => t.type === 'video')!.items!.length
}

async function main() {
  await check('undo restores the pre-mutation state, redo re-applies', async () => {
    const s = await freshStore()
    const b = s.currentProject.value!.id
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    if (videoItemCount(s) !== 1) throw new Error('clip not added')
    s.undo()
    if (videoItemCount(s) !== 0) throw new Error('undo must restore the empty timeline')
    if (s.canRedo.value !== true) throw new Error('redo must be available after undo')
    s.redo()
    if (videoItemCount(s) !== 1) throw new Error('redo must re-apply the add')
    if (s.currentProject.value!.id !== b) throw new Error('undo/redo must not switch project')
  })

  await check('B8: same-key slider burst is ONE undo entry (Inspector pattern)', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const clipId = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!.id
    // Drag the opacity slider: coalesced push + updateClip per input event.
    s.selectClip(clipId)
    s.pushHistoryCoalesced(`${clipId}:opacity`) // pushes the pre-burst state
    for (const opacity of [40, 45, 50, 55]) s.updateClip(clipId, { opacity })
    s.undo() // ONE undo walks back the WHOLE burst
    const back = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!
    if (back.opacity !== 100) throw new Error(`burst undid partially: opacity=${back.opacity}`)
  })

  await check('B8: a different key starts a NEW undo entry', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const clipId = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!.id
    s.pushHistoryCoalesced(`${clipId}:opacity`) // entry A (opacity 100)
    s.updateClip(clipId, { opacity: 60 })
    s.pushHistoryCoalesced(`${clipId}:scale`) // different key -> entry B (opacity 60)
    s.updateClip(clipId, { scale: 130 })
    s.undo()
    let clip = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!
    if (clip.scale !== 100 || clip.opacity !== 60) throw new Error(`undo A wrong: scale=${clip.scale} opacity=${clip.opacity}`)
    s.undo()
    clip = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!
    if (clip.opacity !== 100) throw new Error(`undo B wrong: opacity=${clip.opacity}`)
  })

  await check('undo breaks the burst; the next coalesced push is fresh', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const clipId = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items![0]!.id
    // Stack now [S0 = no clips]; burst pushes S1 = opacity 100.
    s.pushHistoryCoalesced('k')
    s.updateClip(clipId, { opacity: 30 })
    s.undo() // restores opacity 100 AND resets lastCoalesce
    // Same key, same instant — if the reset were missing this push would
    // merge into the old burst, and the NEXT undo would pop S0 and delete
    // the clip entirely instead of landing on the restored state.
    s.pushHistoryCoalesced('k')
    s.updateClip(clipId, { opacity: 80 })
    s.undo()
    const items = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!
    if (items.length !== 1) throw new Error(`post-undo push merged into old burst (clip deleted)`)
    if (items[0]!.opacity !== 100) throw new Error(`expected the restored pre-push state, got opacity=${items[0]!.opacity}`)
  })

  await check('a fresh edit after undo clears the redo stack', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    s.undo()
    if (s.canRedo.value !== true) throw new Error('redo available right after undo')
    s.pushHistoryCoalesced('x:y')
    s.addClipToTrack('video', { name: 'c9', src: 'z.mp4', in: 0, out: tk(2), offset: 0 })
    if (s.canRedo.value !== false) throw new Error('new edit must invalidate redo')
  })

  // R94: the stacks are module-level state; switching projects without a
  // reset let Ctrl+Z pour the PREVIOUS project's timeline/canvas into the
  // newly opened one (snapshots never carry the project id).
  await check('createProject clears the undo history (no cross-project leak)', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { name: 'leak', src: 'leak.mp4', in: 0, out: tk(4), offset: 0 })
    if (s.canUndo.value !== true) throw new Error('history armed')
    const b = s.createProject('switch-target')
    if (s.canUndo.value !== false || s.canRedo.value !== false) {
      throw new Error('createProject must reset history')
    }
    s.undo() // must be a no-op now, NOT a timeline transplant
    if (videoItemCount(s) !== 0) throw new Error('undo leaked the previous project timeline into the new one')
    if (s.currentProject.value!.id !== b.id) throw new Error('undo must not switch project')
  })

  await check('loadProject clears the undo history too', async () => {
    const s = await freshStore()
    const aId = s.currentProject.value!.id
    s.addClipToTrack('video', { name: 'c1', src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    s.saveProject()
    s.createProject('other') // resets history, switches current
    s.addClipToTrack('video', { name: 'c2', src: 'b.mp4', in: 0, out: tk(4), offset: 0 })
    await s.loadProject(aId) // open the FIRST project from its mirror
    if (s.canUndo.value !== false) throw new Error('loadProject must reset history')
    if (videoItemCount(s) !== 1) throw new Error('loaded project must show its own timeline')
    if (s.currentProject.value!.id !== aId) throw new Error('sanity: wrong project loaded')
  })

  console.log(`\n=== All ${passed} history checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
