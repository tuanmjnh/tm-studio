/**
 * Track flags, track add/remove, canvas switch and reframe-duplicate
 * (R103, roadmap A5 + J-2 family).
 *
 * Contracts pinned:
 *  - updateTrack/toggle* are view-state writes: saved (mirror) but NOT an
 *    undo entry — flags are not timeline edits;
 *  - locked tracks refuse every structural op routed through the store:
 *    ripple delete, track removal — and a refusal pushes NO history;
 *  - addTrackToProject / removeTrackFromProject go through applyV3Edit,
 *    so undo restores the previous track list (removal takes its clips,
 *    the store rule — core's default), and the selection is cleared when
 *    it pointed at a removed clip;
 *  - switchCanvas keeps the timeline, reframes manual x/y offsets
 *    proportionally, and saves;
 *  - duplicateAsProject clones to a new id with the preset canvas, the
 *    source untouched, mirror persisted, history reset for the clone.
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)
type S = Awaited<ReturnType<typeof freshStore>>
const mirror = (id: string) => JSON.parse(localStorage.getItem(`tmcut_project_${id}`) || 'null')
const trackById = (s: S, id: string) => s.currentProject.value!.timeline.tracks.find(t => t.id === id)
const videoTrack = (s: S) => s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!

async function main() {
  await check('track flag toggles save to the mirror and push NO undo entry', async () => {
    const s = await freshStore()
    const id = videoTrack(s).id
    if (s.canUndo.value) throw new Error('fresh store must start with empty history (R94)')
    s.toggleTrackMute(id)
    s.toggleTrackHidden(id)
    s.toggleTrackLock(id)
    const m = mirror(s.currentProject.value!.id)
    const mt = m.timeline.tracks.find((t: { id: string }) => t.id === id)
    if (!(mt.muted && mt.hidden && mt.locked)) throw new Error('flags not mirrored')
    if (s.canUndo.value) throw new Error('view flags must not create undo entries')
    s.toggleTrackLock(id) // unlock again for later checks
  })

  await check('locked track refuses ripple delete WITHOUT a history entry', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    s.selectClip(clip.id)
    videoTrack(s).locked = true
    if (s.rippleDeleteSelected()) throw new Error('locked track must refuse ripple delete')
    // the add pushed one entry; the refusal must not push a second:
    s.undo()
    if (videoTrack(s).items!.length !== 0) throw new Error('expected the refusal not to pollute history')
  })

  await check('addTrackToProject appends a track of the type and is undoable', async () => {
    const s = await freshStore()
    const before = s.currentProject.value!.timeline.tracks.length
    if (!s.addTrackToProject('video')) throw new Error('add failed')
    if (s.currentProject.value!.timeline.tracks.length !== before + 1) throw new Error('track count not up')
    const after = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video').length
    if (after !== 2) throw new Error(`expected 2 video tracks, got ${after}`)
    s.undo()
    const back = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video').length
    if (back !== 1) throw new Error('undo must remove the added track')
  })

  await check('removeTrackFromProject takes its clips, clears the selection, undo restores', async () => {
    const s = await freshStore()
    if (!s.addTrackToProject('audio')) throw new Error('add audio track failed')
    const extra = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'audio').at(-1)!
    const clip = s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(2), offset: 0 }, extra.id)!
    if (!clip) throw new Error('clip did not land on the target track')
    s.selectClip(clip.id)
    const total = s.currentProject.value!.timeline.tracks.length
    if (!s.removeTrackFromProject(extra.id)) throw new Error('remove failed')
    if (s.currentProject.value!.timeline.tracks.length !== total - 1) throw new Error('track not removed')
    if (s.selectedClipId.value !== null) throw new Error('selection must clear with its clip')
    s.undo()
    if (s.currentProject.value!.timeline.tracks.length !== total) throw new Error('undo must restore the track')
    const restored = trackById(s, extra.id)
    if (!restored || (restored.items || []).length !== 1) throw new Error('undo must restore the clips too')
  })

  await check('removeTrackFromProject refuses a locked track with no history touch', async () => {
    const s = await freshStore()
    videoTrack(s).locked = true
    const total = s.currentProject.value!.timeline.tracks.length
    if (s.removeTrackFromProject(videoTrack(s).id)) throw new Error('locked removal must be refused')
    if (s.currentProject.value!.timeline.tracks.length !== total) throw new Error('track count changed')
    if (s.canUndo.value) throw new Error('refusal pushed history')
  })

  await check('switchCanvas keeps the timeline and reframes manual offsets', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    s.updateClip(clip.id, { x: 100, y: 100 }) // no push by itself (R94)
    s.switchCanvas(1080, 1920) // 1920x1080 -> 9:16
    const canvas = s.currentProject.value!.canvas!
    if (canvas.width !== 1080 || canvas.height !== 1920) throw new Error('canvas not switched')
    const item = videoTrack(s).items!.find(i => i.id === clip.id)!
    // reframeTransform: x scales by 1080/1920, y by 1920/1080
    if (item.x !== 56 || item.y !== 178) throw new Error(`reframe x=${item.x} y=${item.y}, expected 56/178`)
    const m = mirror(s.currentProject.value!.id)
    if (m.canvas.width !== 1080) throw new Error('canvas switch not mirrored')
    // Strong undo proof: the add pushed the ONLY entry (its snapshot is
    // the pre-add, clip-less state). updateClip and switchCanvas must not
    // push, so ONE undo removes the clip entirely and ONE redo returns to
    // the post-reframe state. Had switchCanvas pushed a second entry, the
    // undo would stop mid-change with the clip still there at x=100.
    s.undo()
    if (videoTrack(s).items!.length !== 0) throw new Error('one undo must revert the whole burst (clip gone)')
    s.redo()
    const redone = videoTrack(s).items!.find(i => i.id === clip.id)!
    if (!redone || redone.x !== 56 || redone.y !== 178) throw new Error('redo must restore the post-reframe state')
  })

  await check('duplicateAsProject clones to the preset ratio, source untouched, history reset', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    s.updateClip(clip.id, { x: 10, y: 20 })
    const sourceId = s.currentProject.value!.id
    const clone = s.duplicateAsProject('9:16')
    if (!clone) throw new Error('duplicate failed')
    if (clone.id === sourceId) throw new Error('clone reuses the source id')
    if (clone.canvas.width !== 1080 || clone.canvas.height !== 1920) throw new Error('clone keeps old ratio')
    // The clone is the open project now; the source file keeps its state.
    const source = mirror(sourceId)
    if (source.canvas.width !== 1920) throw new Error('source canvas mutated')
    if (!mirror(clone.id)) throw new Error('clone not mirrored')
    if (s.canUndo.value) throw new Error('clone history must start empty (R94 rule)')
    const item = clone.timeline.tracks.find(t => t.type === 'video')!.items![0]!
    if (item.x !== 6 || item.y !== 36) throw new Error(`clone reframe x=${item.x} y=${item.y}`)
  })

  console.log(`\n=== All ${passed} track/canvas checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
