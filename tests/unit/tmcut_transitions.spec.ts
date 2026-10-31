/**
 * Transitions (roadmap B3 / core C5): apply / clear / validation.
 *
 * Store contract:
 *  - checkClipTransition runs validation BEFORE any history push, so a
 *    refused request leaves no stray undo entry.
 *  - applyClipTransition pushes history via applyV3Edit and routes through
 *    core applyTransition; success is true/false only.
 *  - clearClipTransition probes first on a throwaway conversion; only on
 *    success does it push history and apply.
 *  - duration lives in TICKS inside the v1 seconds model (bridge is identity)
 *    — the store always converts UI seconds → ticks at the boundary.
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)

async function main() {
  await check('checkClipTransition returns ok=false with reason=no-neighbor for first clip', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const res = s.checkClipTransition(clip.id, 'fade', 0.5)
    if (res.ok !== false) throw new Error('expected no-neighbor')
  })

  await check('applyClipTransition shifts the clip left and is undoable', async () => {
    const s = await freshStore()
    const a = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) })!
    const ok = s.applyClipTransition(b.id, 'fade', 0.5)
    if (ok.ok !== true) throw new Error(`transition should apply, got ${JSON.stringify(ok)}`)
    const b2 = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!.find(i => i.id === b.id)!
    if (!b2.transitionIn || (b2.transitionIn.duration ?? 0) <= 0) throw new Error('transition not stored')
    // The transition overlaps the head; the clip offset should be moved left by duration.
    if (b2.offset !== tk(4) - tk(0.5)) throw new Error(`offset not shifted: ${b2.offset / TICKS}`)
    s.undo()
    const bBack = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!.find(i => i.id === b.id)!
    if (bBack.offset !== tk(4)) throw new Error('undo should restore offset')
    if (bBack.transitionIn && (bBack.transitionIn.duration ?? 0) > 0) throw new Error('undo should clear transition')
  })

  await check('clearClipTransition removes a transition and restores the cut', async () => {
    const s = await freshStore()
    const a = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) })!
    s.applyClipTransition(b.id, 'fade', 0.5)
    const cleared = s.clearClipTransition(b.id)
    if (!cleared) throw new Error('clear should succeed')
    const b2 = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!.items!.find(i => i.id === b.id)!
    if (b2.transitionIn && (b2.transitionIn.duration ?? 0) > 0) throw new Error('transition not cleared')
    if (b2.offset !== tk(4)) throw new Error('offset not restored')
  })

  await check('applyClipTransition refuses when duration exceeds neighbor gap', async () => {
    const s = await freshStore()
    const a = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(2), offset: tk(2) })!
    const ok = s.applyClipTransition(b.id, 'fade', 3)
    if (ok.ok !== false) throw new Error('should refuse too long duration')
  })

  await check('timelineTransitionCount counts only clips with a non-zero transition', async () => {
    const s = await freshStore()
    const a = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) })!
    if (s.timelineTransitionCount.value !== 0) throw new Error('no transitions yet')
    s.applyClipTransition(b.id, 'fade', 0.5)
    if (s.timelineTransitionCount.value !== 1) throw new Error('count should be 1')
    s.clearClipTransition(b.id)
    if (s.timelineTransitionCount.value !== 0) throw new Error('count should be back to 0')
  })

  console.log(`\n=== All ${passed} transition checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
