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
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
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
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
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
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })!
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(2), offset: tk(2) })!
    const ok = s.applyClipTransition(b.id, 'fade', 3)
    if (ok.ok !== false) throw new Error('should refuse too long duration')
  })

  await check('timelineTransitionCount counts only clips with a non-zero transition', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })!
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) })!
    if (s.timelineTransitionCount.value !== 0) throw new Error('no transitions yet')
    s.applyClipTransition(b.id, 'fade', 0.5)
    if (s.timelineTransitionCount.value !== 1) throw new Error('count should be 1')
    s.clearClipTransition(b.id)
    if (s.timelineTransitionCount.value !== 0) throw new Error('count should be back to 0')
  })

  // The preview no longer re-derives the overlap window: playback reads the
  // core evaluator's incoming/outgoing roles, progress and outgoing source
  // position. These checks pin that contract through the real store.
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  async function crossfadePair() {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) })
    return s
  }
  await check('playback crossfade reports the evaluator roles inside the window', async () => {
    const s = await crossfadePair()
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    const b = track.items!.find(i => i.src === 'b.mp4')!
    s.applyClipTransition(b.id, 'fade', 0.5)
    const p = useTmcutPlayback()
    p.seek(3.75)
    const cf = p.transitionCrossfade.value
    if (!cf) throw new Error('expected a crossfade inside [3.5, 4)')
    if (cf.incoming.id !== b.id) throw new Error('incoming must be the clip carrying transitionIn')
    if (cf.outgoing.src !== 'a.mp4') throw new Error('outgoing must be the neighbour')
    if (cf.type !== 'fade') throw new Error(`type ${cf.type}`)
    if (Math.abs(cf.progress - 0.5) > 1e-9) throw new Error(`progress ${cf.progress}`)
    if (Math.abs(cf.outgoingMediaTime - 3.75) > 1e-6) throw new Error(`outgoing media ${cf.outgoingMediaTime}`)
    const active = p.activeVideoClip.value
    if (active?.clip.id !== b.id) throw new Error('the main element renders the incoming clip')
    if (Math.abs(active.mediaCurrentTime - 0.25) > 1e-6) throw new Error(`incoming media ${active.mediaCurrentTime}`)
    p.seek(3)
    if (p.transitionCrossfade.value) throw new Error('no crossfade before the window')
    if (p.activeVideoClip.value?.clip.src !== 'a.mp4') throw new Error('the outgoing clip owns the main element up to the window')
    p.seek(4)
    if (p.transitionCrossfade.value) throw new Error('window end is exclusive')
  })

  await check('playback crossfade follows the outgoing clip through reverse and trims', async () => {
    const s = await crossfadePair()
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    const a = track.items!.find(i => i.src === 'a.mp4')!
    const b = track.items!.find(i => i.src === 'b.mp4')!
    s.applyClipTransition(b.id, 'fade', 0.5)
    const p = useTmcutPlayback()
    a.reverse = true
    p.seek(3.75)
    const reversed = p.transitionCrossfade.value
    if (!reversed) throw new Error('reverse clip must still crossfade')
    if (Math.abs(reversed.outgoingMediaTime - 0.25) > 1e-6) {
      throw new Error(`reverse source position ${reversed.outgoingMediaTime}`)
    }
    a.reverse = false
    a.out = tk(3) // trim the neighbour so it no longer ends at the window
    p.seek(3.75)
    if (p.transitionCrossfade.value) throw new Error('a broken pair must render as a plain cut')
  })

  console.log(`\n=== All ${passed} transition checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
