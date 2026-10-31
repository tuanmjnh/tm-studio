/**
 * Copy / paste / duplicate (R104, roadmap C15, core clipboard ops).
 *
 * Contracts pinned:
 *  - copySelectedClips copies the EXPANDED selection (linked relatives
 *    travel with it) into a portable v1 payload { version, baseStart,
 *    clips } — baseStart is the earliest start so offsets survive;
 *  - pasteClipboardAt takes SECONDS (UI contract), preserves relative
 *    offsets, is ONE undo entry, and selects the LAST pasted clip;
 *  - refusal rule holds (R99/R103 standard): a paste or duplicate where
 *    every target track is locked lands nothing, pushes NO history,
 *    saves nothing — the op runs on a throwaway v3 copy before any entry
 *    opens;
 *  - the clipboard is module-level on purpose: it deliberately survives
 *    a project switch (core documents the payload as portable, "later
 *    cross-project paste") — and a paste lands in the CURRENT project's
 *    history, so undo in the new project removes it cleanly;
 *  - empty clipboard pastes nothing and touches no history;
 *  - duplicateSelectedClips drops linkIds (copies never stay linked),
 *    remaps groupIds to one fresh group per source group, keeps
 *    relative offsets at an explicit atSec, and selects the FIRST copy.
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
const videoTrack = (s: S) => s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!

async function main() {
  await check('copySelectedClips copies the expanded selection with baseStart', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: tk(4) })!
    s.selectClip(v.id)
    const a = s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(2), offset: tk(4) })!
    s.selectClip(a.id)
    s.toggleLinkSelection() // link the pair across tracks
    s.selectClip(v.id)
    if (!s.copySelectedClips()) throw new Error('copy failed')
    const data = s.clipboard.value
    if (!data) throw new Error('clipboard empty')
    if (data.version !== 1 || data.clips.length !== 2) throw new Error('payload wrong: ' + JSON.stringify(data.clips?.length))
    // baseStart = min start = 4s (both clips start together)
    if (data.baseStart !== tk(4)) throw new Error(`baseStart ${data.baseStart} !== ${tk(4)}`)
  })

  await check('paste preserves relative offsets, one undo entry, selects the last clip', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    const a = s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(2), offset: tk(1) })!
    s.selectClip(v.id)
    s.toggleLinkSelection()
    s.copySelectedClips()
    const ids = s.pasteClipboardAt(5)
    if (ids.length !== 2) throw new Error(`expected 2 pasted, got ${ids.length}`)
    const vItems = videoTrack(s).items!
    const copyA = vItems.find(i => i.src === 'a.mp4' && i.id !== v.id)!
    const aItems = s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!.items!
    const copyB = aItems.find(i => i.src === 'b.wav' && i.id !== a.id)!
    if (copyA.offset !== tk(5)) throw new Error(`copyA at ${copyA.offset}, expected ${tk(5)}`)
    // relative offset preserved: audio was +1s vs video → 6s
    if (copyB.offset !== tk(6)) throw new Error(`copyB at ${copyB.offset}, expected ${tk(6)}`)
    if (s.selectedClipId.value !== ids[ids.length - 1]) throw new Error('selection must move to the last pasted clip')
    // ONE undo entry: a single undo removes BOTH pasted clips at once.
    // A per-clip push would leave one copy behind.
    s.undo()
    if (videoTrack(s).items!.length !== 1) throw new Error('undo must remove the pasted video copy')
    const audioItems = s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!.items!
    if (audioItems.length !== 1) throw new Error('one undo must remove the whole paste (both copies)')
  })

  await check('paste with an empty clipboard is a no-op and pushes no history', async () => {
    const s = await freshStore()
    s.clipboard.value = null // module-level clipboard: clear it explicitly
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const items = s.pasteClipboardAt(3)
    if (items.length !== 0) throw new Error('nothing to paste')
    // If the refused paste had pushed history, one undo would only revert
    // that no-op and the clip would survive. It must not: the stack top
    // is still the add's snapshot.
    s.undo()
    if (videoTrack(s).items!.length !== 0) throw new Error('empty paste pushed history')
    if (s.selectedClipId.value !== null) throw new Error('selection must not change')
  })

  await check('the clipboard is portable: copy in A, switch, paste in B (current project wins)', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    s.selectClip(v.id)
    s.copySelectedClips()
    const aId = s.currentProject.value!.id
    s.createProject('B') // switch projects — the module-level clipboard survives by design
    const bId = s.currentProject.value!.id
    if (bId === aId) throw new Error('sanity: switch must change the project')
    const ids = s.pasteClipboardAt(2)
    if (ids.length !== 1) throw new Error('paste in B failed')
    const bItems = videoTrack(s).items!
    const paste = bItems.find(i => i.id === ids[0])!
    if (paste.offset !== tk(2)) throw new Error('paste offset wrong in B')
    // Undo in B removes it from B (the paste belongs to B's history).
    s.undo()
    if (videoTrack(s).items!.length !== 0) throw new Error('undo must remove the paste in B')
    // Project A is untouched.
    const aMirror = JSON.parse(localStorage.getItem(`tmcut_project_${aId}`) || 'null')
    if (!aMirror || aMirror.timeline.tracks.find((t: { type: string }) => t.type === 'video').items.length !== 1) {
      throw new Error('project A was mutated')
    }
  })

  await check('duplicateSelectedClips drops linkIds and remaps groupIds to a fresh group', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(2), offset: 0 })
    s.selectClip(v.id)
    s.toggleLinkSelection() // pair with the audio clip
    if (!s.groupSelection()) throw new Error('precondition: group the pair')
    const srcGroup = videoTrack(s).items!.find(i => i.id === v.id)!.groupId
    if (!srcGroup) throw new Error('precondition: group exists')
    const newIds = s.duplicateSelectedClips()
    if (newIds.length !== 2) throw new Error(`expected 2 copies, got ${newIds.length}`)
    const vCopy = videoTrack(s).items!.find(i => newIds.includes(i.id))!
    const aItems = s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!.items!
    const aCopy = aItems.find(i => newIds.includes(i.id))!
    if (vCopy.linkId !== null) throw new Error('copy must not stay linked')
    if (aCopy.linkId !== null) throw new Error('copy must not stay linked')
    if (!vCopy.groupId) throw new Error('grouped source must yield grouped copy')
    if (vCopy.groupId === srcGroup) throw new Error('copy must get a FRESH groupId')
    if (vCopy.groupId !== aCopy.groupId) throw new Error('copies must share one group')
    // originals untouched
    const srcV = videoTrack(s).items!.find(i => i.id === v.id)!
    if (srcV.offset !== 0 || !srcV.groupId || srcV.linkId === null) throw new Error('original mutated')
    if (s.selectedClipId.value !== newIds[0]) throw new Error('selection must move to the first copy')
  })

  await check('duplicate at an explicit atSec keeps relative offsets', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: tk(1) })!
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(2), offset: tk(2) })
    s.selectClip(v.id)
    s.toggleLinkSelection()
    const newIds = s.duplicateSelectedClips(10)
    if (newIds.length !== 2) throw new Error(`expected 2 copies, got ${newIds.length}`)
    const vCopy = videoTrack(s).items!.find(i => newIds.includes(i.id))!
    const aItems = s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!.items!
    const aCopy = aItems.find(i => newIds.includes(i.id))!
    // block base = 1s; video → 10s, audio was +1s → 11s
    if (vCopy.offset !== tk(10)) throw new Error(`video copy at ${vCopy.offset}`)
    if (aCopy.offset !== tk(11)) throw new Error(`audio copy at ${aCopy.offset}`)
  })

  await check('paste skips EVERY locked target track with no history touch', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    s.selectClip(v.id)
    s.copySelectedClips()
    videoTrack(s).locked = true
    const before = videoTrack(s).items!.length
    const attempt = s.pasteClipboardAt(5)
    if (attempt.length !== 0) throw new Error('locked target must refuse the paste')
    if (videoTrack(s).items!.length !== before) throw new Error('locked track was modified')
    if (s.selectedClipId.value !== v.id) throw new Error('selection must stay on the source clip')
    // Refusal rule (R99/R103 house standard): a fully refused paste opens
    // no undo entry, so ONE undo walks back to the pre-add state.
    s.undo()
    if (videoTrack(s).items!.length !== 0) throw new Error('refused paste pushed history')
  })

  await check('duplicate of a locked selection refuses with no history touch', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    s.selectClip(v.id)
    videoTrack(s).locked = true
    const ids = s.duplicateSelectedClips(5)
    if (ids.length !== 0) throw new Error('locked selection must not duplicate')
    if (videoTrack(s).items!.length !== 1) throw new Error('locked track was modified')
    s.undo()
    if (videoTrack(s).items!.length !== 0) throw new Error('refused duplicate pushed history')
  })

  console.log(`\n=== All ${passed} copy/paste checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
