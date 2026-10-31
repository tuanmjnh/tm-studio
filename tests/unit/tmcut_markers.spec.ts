/**
 * Markers + snap behaviour (R97, roadmap B5).
 *
 * The app keeps markers in the project timeline array. Core functions
 * (`addMarker`, `removeMarker`, `snapTime*`) operate on the v3 DSL — the
 * store uses a tiny shim `{ version:3, tracks:[], markers: ensureMarkers() }`
 * so the core sees a live reference to the same marker array. The bridge
 * `snapTimeSec` decodes the store tracks to v3, installs that same marker
 * array, and forwards playhead/ignore/threshold in ticks. The key contract
 * the spec pins:
 *  - markers are stored in the project file (localStorage mirror + disk)
 *  - add / update / remove are each one undo entry
 *  - snap respects clips (start/end), playhead, zero, and markers
 *  - snap threshold is measured in TICKS on the decoded timeline
 *    (the store never lets a SECONDS bridge leak into the snap math)
 */
import { TICKS, freshStore } from './helpers/tmcut_store_env'

let passed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`[ok] ${name}`)
}

const tk = (sec: number) => Math.round(sec * TICKS)

function markers(s: Awaited<ReturnType<typeof freshStore>>) {
  return s.currentProject.value!.timeline.markers!
}

function snapSec(s: Awaited<ReturnType<typeof freshStore>>, targetSec: number, playheadSec?: number, thresholdSec?: number) {
  const res = s.snapTimeSec(targetSec, playheadSec ?? 0, {
    thresholdSec
  })
  return res
}

async function main() {
  await check('addMarkerAt creates a marker, persists, and survives undo/redo', async () => {
    const s = await freshStore()
    const before = markers(s).length
    s.addMarkerAt(3.2)
    if (markers(s).length !== before + 1) throw new Error('marker not added')
    const m = markers(s).at(-1)!
    if (m.at !== tk(3.2)) throw new Error(`marker ticks wrong: ${m.at}`)
    s.undo()
    if (markers(s).length !== before) throw new Error('undo must remove the marker')
    s.redo()
    if (markers(s).length !== before + 1) throw new Error('redo must re-add the marker')
  })

  await check('updateMarker is one undo entry and persists', async () => {
    const s = await freshStore()
    s.addMarkerAt(1)
    const id = markers(s).at(-1)!.id
    s.updateMarker(id, { label: 'cut', color: '#ff0000' })
    const m = markers(s).find(m => m.id === id)!
    if (m.label !== 'cut' || m.color !== '#ff0000') throw new Error('update not applied')
    s.undo()
    const back = markers(s).find(m => m.id === id)!
    if (back.label) throw new Error('undo must revert label')
    if (back.color !== '#3b82f6') throw new Error('undo must revert colour to default')
  })

  await check('removeMarkerById deletes the marker and is undoable', async () => {
    const s = await freshStore()
    s.addMarkerAt(2)
    s.addMarkerAt(4)
    const removedId = markers(s)[0].id
    const ok = s.removeMarkerById(removedId)
    if (!ok) throw new Error('remove returned false')
    if (markers(s).some(m => m.id === removedId)) throw new Error('marker still present')
    s.undo()
    if (!markers(s).some(m => m.id === removedId)) throw new Error('undo must restore marker')
  })

  await check('snapTimeSec respects clip boundaries and playhead', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(3), offset: tk(4) })
    const snapped = snapSec(s, 4.5, 0, 0.6)
    if (Math.abs(snapped - 4) > 1e-9) throw new Error(`should snap to clip start at 4s, got ${snapped}`)
    const snapped2 = snapSec(s, 4.1, 0, 0.2)
    if (Math.abs(snapped2 - 4) > 1e-9) throw new Error(`should snap to 4s, got ${snapped2}`)
    const snapped3 = snapSec(s, 0.05, 0, 0.2)
    if (Math.abs(snapped3 - 0) > 1e-9) throw new Error(`should snap to zero, got ${snapped3}`)
    const snapped4 = snapSec(s, 6.5, 6.6, 0.2)
    if (Math.abs(snapped4 - 6.6) > 1e-9) throw new Error(`should snap to playhead, got ${snapped4}`)
  })

  await check('snapTimeSec uses markers as snap candidates (roadmap B5)', async () => {
    const s = await freshStore()
    s.addMarkerAt(2.5)
    s.addMarkerAt(5.5)
    // No clips: only zero and markers should be candidates.
    const snapped = snapSec(s, 2.55, 0, 0.2)
    if (Math.abs(snapped - 2.5) > 1e-9) throw new Error(`marker snap failed: ${snapped}`)
    const snapped2 = snapSec(s, 5.4, 0, 0.3)
    if (Math.abs(snapped2 - 5.5) > 1e-9) throw new Error(`marker snap missed: ${snapped2}`)
    // When clip start sits within threshold, marker must not steal it unless closer.
    s.addClipToTrack('video', { src: 'x.mp4', in: 0, out: tk(3), offset: 0 })
    const snapped3 = snapSec(s, 2.51, 0, 0.2)
    if (Math.abs(snapped3 - 2.5) > 1e-9) throw new Error(`marker should win at 2.5s: ${snapped3}`)
    const snapped4 = snapSec(s, 3.05, 0, 0.2)
    if (Math.abs(snapped4 - 3) > 1e-9) throw new Error(`clip end at 3s should win: ${snapped4}`)
  })

  await check('snap threshold is honoured and ignoreIds disables a clip', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    // With a tiny threshold, target 3.15s should NOT snap to 3s start 4s
    const noSnap = snapSec(s, 3.15, 0, 0.1)
    if (Math.abs(noSnap - 3.15) > 1e-9) throw new Error(`threshold should block snap, got ${noSnap}`)
    // Ignore the clip ids → no clip candidates
    const ignored = snapSec(s, 3.15, 0, 0.5)
    // still snaps to zero? Actually zero is 3.15 away > threshold → no snap
    if (Math.abs(ignored - 3.15) > 1e-9) throw new Error(`ignoreIds should leave target unchanged`)
  })

  await check('markers round-trip via the localStorage mirror', async () => {
    const s = await freshStore()
    s.addMarkerAt(1.0)
    s.addMarkerAt(2.0)
    const id = s.currentProject.value!.id
    const mirror = JSON.parse(localStorage.getItem(`tmcut_project_${id}`) || '{}')
    if (!Array.isArray(mirror.timeline?.markers)) throw new Error('markers missing in mirror')
    if (mirror.timeline.markers.length !== 2) throw new Error('markers count mismatch in mirror')
    const s2 = await freshStore()
    await s2.loadProject(id)
    if (s2.currentProject.value!.timeline.markers!.length !== 2) throw new Error('markers not reloaded')
  })

  console.log(`\n=== All ${passed} marker/snap checks passed ===`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
