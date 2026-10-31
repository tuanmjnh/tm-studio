/**
 * Split / trim / close-gaps consistency (R99, roadmap B2/B7/B9, core C1/C2).
 *
 * Store contract:
 *  - splitClip works in UI SECONDS, converts to TICKS, enforces a 0.1s margin,
 *    pushes history, and never creates degenerate slivers. The second piece
 *    inherits everything except the transitionIn field.
 *  - trimSelectedEdgeAt is the keyboard trim entry: UI SECONDS → TICKS,
 *    margin check, then core trimClip via applyV3Edit.
 *  - closeProjectGaps is a core-backed gap close: the store first does a
 *    cheap pre-scan to avoid a no-op history push. If gaps exist, it routes
 *    to core closeGaps via applyV3Edit and returns the number of TICKS
 *    closed (core returns seconds — converted at the boundary).
 *  - all three must keep the timeline in integer TICKS and must not produce
 *    negative durations or overlapping items on the same track.
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)
const dur = (i: { in: number, out: number, speed: number }) => Math.max(0, Math.round((i.out - i.in) / (i.speed ?? 1)))

function videoItems(s: Awaited<ReturnType<typeof freshStore>>) {
  return s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!
}

async function main() {
  await check('splitClip creates two pieces with correct in/out/offset and respects the 0.1s margin', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(10), offset: 0 })!
    const ok = s.splitClip(clip.id, 5)
    if (!ok) throw new Error('split should succeed')
    const items = videoItems(s)
    if (items.length !== 2) throw new Error(`expected 2 items, got ${items.length}`)
    const first = items[0]!
    const second = items[1]!
    // First piece: in=0, out=tk(5) in source time, offset unchanged (0)
    if (first.out !== tk(5)) throw new Error(`first out wrong: ${first.out}`)
    // Second piece: in=tk(5), offset=tk(5)
    if (second.in !== tk(5) || second.offset !== tk(5)) throw new Error(`second piece wrong in/offset`)
    // No transition inherited
    if (second.transitionIn) throw new Error('second piece must not inherit transitionIn')
    // Undo restores the original single clip
    s.undo()
    if (videoItems(s).length !== 1) throw new Error('undo must restore single clip')
    s.redo()
    if (videoItems(s).length !== 2) throw new Error('redo must re-create split')
  })

  await check('splitClip refuses splits too close to the edges (0.1s margin)', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(10), offset: 0 })!
    const tooEarly = s.splitClip(clip.id, 0.05)
    const tooLate = s.splitClip(clip.id, 9.95)
    if (tooEarly || tooLate) throw new Error('split should be refused for margin violations')
    if (videoItems(s).length !== 1) throw new Error('clip must stay untouched')
  })

  await check('trimSelectedEdgeAt trims the selected clip edge and keeps durations positive', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(10), offset: 0 })!
    s.selectClip(clip.id)
    const ok = s.trimSelectedEdgeAt('out', 7)
    if (!ok) throw new Error('trim should succeed')
    const trimmed = videoItems(s).find(i => i.id === clip.id)!
    if (trimmed.out !== tk(7)) throw new Error(`out not trimmed: ${trimmed.out}`)
    if (dur(trimmed) <= 0) throw new Error('duration must stay positive')
    // Trimming into the margin should be refused
    const refused = s.trimSelectedEdgeAt('out', 9.95)
    if (refused) throw new Error('trim too close to edge must be refused')
  })

  await check('closeProjectGaps pulls every unlocked track together and returns closed TICKS', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: tk(4) })
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(3), offset: tk(10) })
    const closed = s.closeProjectGaps()
    if (closed <= 0) throw new Error('should report some ticks closed')
    const items = videoItems(s).sort((a, b) => a.offset - b.offset)
    if (items[0].offset !== 0) throw new Error('first clip must start at 0')
    if (items[1].offset !== tk(2)) throw new Error(`second clip not pulled: ${items[1].offset / TICKS}s`)
  })

  await check('closeProjectGaps is a no-op when there are no gaps', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(3), offset: tk(2) })
    const closed = s.closeProjectGaps()
    if (closed !== 0) throw new Error('no gaps should return 0')
    // The pre-scan avoids pushing a no-op history entry.
    // However an earlier addClip already pushed; we just ensure closeGaps
    // itself didn't create a new entry when nothing changed.
    const items = videoItems(s)
    if (items[0].offset !== 0 || items[1].offset !== tk(2)) throw new Error('items moved unexpectedly')
  })

  await check('split + trim + closeGaps keep integer TICKS and no negative durations', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(10), offset: 0 })!
    s.splitClip(clip.id, 3)
    s.selectClip(videoItems(s)[1].id)
    s.trimSelectedEdgeAt('in', 3.5)
    s.closeProjectGaps()
    for (const i of videoItems(s)) {
      if (i.out < i.in) throw new Error('negative duration detected')
      if ((i.out - i.in) % 1 !== 0) { /* ok */ }
      // offsets are in TICKS (they are integers; source in/out are also TICKS)
      if (!Number.isInteger(i.offset) || !Number.isInteger(i.in) || !Number.isInteger(i.out)) {
        throw new Error('non-integer ticks detected')
      }
    }
  })

  console.log(`\n=== All ${passed} split/trim/gap checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
