/**
 * Groups & linked pairs (R101, roadmap B4 / core C9).
 *
 * The app selection is single-clip; the store expands it with
 * expandRelated() so grouped/linked relatives travel together. Contract:
 *  - toggleLinkSelection links the selected clip to EVERY unlocked clip
 *    overlapping it in time on any other track (shared linkId), and
 *    toggles off when all already share it; locked tracks are excluded;
 *  - groupSelection groups the EXPANDED selection (needs >=2 members —
 *    a lone clip has no relations, so it honestly fails);
 *  - ungroupSelection dissolves the group the selection expands to;
 *  - relatedOffsetsFor returns the relatives' start positions in STORE
 *    TICKS — the drag handler's payload.
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
function video(s: S) {
  return s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
}
function audio(s: S) {
  return s.currentProject.value!.timeline.tracks.find(t => t.type === 'audio')!
}

async function main() {
  await check('toggleLinkSelection links all time-overlapping unlocked clips across tracks', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const a1 = s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(4), offset: 0 })! // overlaps
    s.addClipToTrack('audio', { src: 'c.wav', in: 0, out: tk(2), offset: tk(6) }) // no overlap
    s.selectClip(v.id)
    const r = s.toggleLinkSelection()
    if (r !== 'linked') throw new Error(`expected linked, got ${r}`)
    const vItem = video(s).items!.find(i => i.id === v.id)!
    const aItem = audio(s).items!.find(i => i.id === a1.id)!
    if (!vItem.linkId || vItem.linkId !== aItem.linkId) throw new Error('linkId not shared')
    const other = audio(s).items!.find(i => i.src === 'c.wav')!
    if (other.linkId) throw new Error('non-overlapping clip must not be linked')
  })

  await check('toggling again unlinks the whole pair', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(4), offset: 0 })
    s.selectClip(v.id)
    s.toggleLinkSelection()
    const vItem = video(s).items!.find(i => i.id === v.id)!
    if (!vItem.linkId) throw new Error('precondition: linked')
    const r = s.toggleLinkSelection()
    if (r !== 'unlinked') throw new Error(`expected unlinked, got ${r}`)
    if (vItem.linkId !== null) throw new Error('linkId not cleared')
  })

  await check('no overlap / locked / no selection all return none', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(2), offset: tk(10) }) // disjoint
    s.selectClip(v.id)
    if (s.toggleLinkSelection() !== 'none') throw new Error('disjoint clips must not link')
    // locked target track excluded
    audio(s).locked = true
    const v2 = s.addClipToTrack('video', { src: 'd.mp4', in: 0, out: tk(4), offset: tk(10) })!
    s.addClipToTrack('audio', { src: 'e.wav', in: 0, out: tk(4), offset: tk(10) })
    s.selectClip(v2.id)
    if (s.toggleLinkSelection() !== 'none') throw new Error('locked track must be excluded')
    audio(s).locked = false
    // no selection
    s.selectClip(null)
    if (s.toggleLinkSelection() !== 'none') throw new Error('no selection must be none')
  })

  await check('groupSelection groups the expanded (linked) selection, fails for a lone clip', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const a = s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(4), offset: 0 })!
    s.selectClip(v.id)
    if (s.groupSelection()) throw new Error('a lone clip has no relations - must fail')
    s.toggleLinkSelection()
    if (!s.groupSelection()) throw new Error('expanded selection must reach 2')
    const vItem = video(s).items!.find(i => i.id === v.id)!
    const aItem = audio(s).items!.find(i => i.id === a.id)!
    if (!vItem.groupId || vItem.groupId !== aItem.groupId) throw new Error('groupId not shared')
  })

  await check('ungroupSelection dissolves the group the selection expands to', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(4), offset: 0 })
    s.selectClip(v.id)
    s.toggleLinkSelection()
    s.groupSelection()
    if (!s.ungroupSelection()) throw new Error('ungroup must succeed on a grouped pair')
    const vItem = video(s).items!.find(i => i.id === v.id)!
    if (vItem.groupId) throw new Error('groupId not cleared')
    if (s.ungroupSelection()) throw new Error('second ungroup must be a no-op')
  })

  await check('relatedOffsetsFor returns relatives in STORE TICKS and is undoable with the drag', async () => {
    const s = await freshStore()
    const v = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: tk(1) })!
    const a = s.addClipToTrack('audio', { src: 'b.wav', in: 0, out: tk(4), offset: tk(2) })!
    s.selectClip(v.id)
    // no relations yet - only the selected clip is in the expansion
    const none = s.relatedOffsetsFor(v.id)
    if (Object.keys(none).length !== 0) throw new Error('lone clip has no relatives')
    s.toggleLinkSelection()
    const rel = s.relatedOffsetsFor(v.id)
    if (rel[a.id] !== tk(2)) throw new Error(`relative offset must be store ticks: ${rel[a.id]}`)
    if (rel[v.id] !== undefined) throw new Error('the dragged clip itself is excluded')
    // every value must be an integer tick
    for (const key of Object.keys(rel)) {
      if (!Number.isInteger(rel[key])) throw new Error('relative offsets must be integer ticks')
    }
  })

  console.log(`\n=== All ${passed} group/link checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
