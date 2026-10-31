/**
 * Store behaviour spec (roadmap C16 gate layer).
 *
 * C16-R3 landed: the store's `in/out/offset` are INTEGER TICKS now.
 * Assertions read the RAW store fields (never through the accessors), so
 * this spec keeps guarding the unit contract: a partial flip — or any
 * accidental double conversion — breaks them. Public actions that speak
 * seconds to the UI (splitClip time, trim time, duplicate target) take
 * seconds here too, mirroring the components.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_store_behaviour.spec.ts
 */
import assert from 'node:assert/strict'
import { freshStore, videoClip, TICKS } from './helpers/tmcut_store_env'

let passed = 0
function check(label: string, fn: () => void | Promise<void>) {
  return Promise.resolve(fn()).then(() => {
    passed++
    console.log(`   ${label} PASSED`)
  })
}

/** Seconds → the store's tick unit, for writing literals readably. */
function tk(sec: number): number {
  return Math.round(sec * TICKS)
}
/** Raw store duration in the store unit (values already ticks). */
function durationTicks(clip: { in: number, out: number, speed?: number }) {
  return Math.round((clip.out - clip.in) / (clip.speed || 1))
}
function startTicks(clip: { offset: number }) {
  return Math.round(clip.offset || 0)
}

async function main() {
  console.log('=== [TMCut Store Behaviour] Starting ===\n')

  await check('addClipToTrack stores tick geometry and reports duration', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: tk(1), out: tk(5) })!
    assert.equal(durationTicks(clip), tk(4), 'a 4s range must stay 4s long')
    assert.equal(startTicks(clip), 0)
    // totalDuration keeps a 5-unit (second) ruler floor, so a 4s timeline still reads 5.
    assert.equal(s.totalDuration.value, 5)
    // Appending lands after the last clip on the track.
    const second = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(3) })!
    assert.equal(startTicks(second), tk(4), 'auto-offset follows the previous clip end')
    assert.equal(s.totalDuration.value, 7)
  })

  await check('splitClip cuts at the playhead without leaking source time', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: tk(2), out: tk(6), offset: tk(1) })!
    assert.ok(s.splitClip(clip.id, 3), 'split at 2s into a clip starting at 1s (seconds arg)')
    const track = videoClipTrack(s)
    const [first, tail] = track.items!
    // First piece keeps the source window start; tail continues from where
    // the playhead cut it: 1s of timeline at speed 1 => +1s of source.
    assert.equal(first.in, tk(2))
    assert.equal(first.out, tk(4))
    assert.equal(tail.in, tk(4))
    assert.equal(tail.out, tk(6))
    assert.equal(startTicks(first), tk(1))
    assert.equal(startTicks(tail), tk(3))
    assert.equal(durationTicks(first), tk(2))
    assert.equal(durationTicks(tail), tk(2))
    // Geometry must be conserved: two halves == the original.
    assert.equal(durationTicks(first) + durationTicks(tail), tk(4))
  })

  await check('splitClip respects speed (source advances speed x timeline)', async () => {
    const s = await freshStore()
    // 16s of source at 2x speed = 8s on the timeline (above the 5s ruler
    // floor, so totalDuration reflects real geometry).
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(16), offset: 0, speed: 2 })!
    assert.equal(s.totalDuration.value, 8)
    assert.ok(s.splitClip(clip.id, 2))
    const [first, tail] = videoClipTrack(s).items!
    assert.equal(first.out, tk(4), '2 timeline seconds at 2x consume 4 source seconds')
    assert.equal(tail.in, tk(4))
    assert.equal(tail.out, tk(16))
    assert.equal(tail.speed, 2)
    assert.equal(durationTicks(first), tk(2))
    assert.equal(durationTicks(tail), tk(6))
  })

  await check('splitClip near an edge is refused and changes nothing', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4) })!
    const before = JSON.stringify(videoClipTrack(s).items)
    assert.equal(s.splitClip(clip.id, 0.05), false)
    assert.equal(s.splitClip(clip.id, 3.95), false)
    assert.equal(JSON.stringify(videoClipTrack(s).items), before, 'refused split must be a no-op')
  })

  await check('trimSelectedEdgeAt moves one edge and keeps the other', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(8), offset: 0 })!
    s.selectClip(clip.id)
    assert.ok(s.trimSelectedEdgeAt('out', 5))
    let live = videoClip(s, clip.id)
    assert.equal(live.in, 0)
    assert.equal(live.out, tk(5))
    assert.equal(s.totalDuration.value, 5)
    assert.ok(s.trimSelectedEdgeAt('in', 2))
    live = videoClip(s, clip.id)
    assert.equal(live.in, tk(2), 'trimming the in edge moves the source start')
    assert.equal(live.out, tk(5))
  })

  await check('updateClip writes exactly the patched fields', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: tk(1), out: tk(5), offset: 0 })!
    s.updateClip(clip.id, { offset: tk(3), opacity: 50 })
    const live = videoClip(s, clip.id)
    assert.equal(live.offset, tk(3))
    assert.equal(live.opacity, 50)
    assert.equal(live.in, tk(1), 'an offset edit must not touch the source window')
    assert.equal(live.out, tk(5))
    assert.equal(s.totalDuration.value, 7)
  })

  await check('undo/redo restores split geometry in one entry', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(6), offset: 0 })!
    assert.ok(s.splitClip(clip.id, 3))
    assert.equal(videoClipTrack(s).items!.length, 2)
    s.undo()
    assert.equal(videoClipTrack(s).items!.length, 1, 'undo of a split removes the tail')
    assert.equal(videoClip(s, clip.id).out, tk(6), 'and restores the original out point')
    s.redo()
    assert.equal(videoClipTrack(s).items!.length, 2, 'redo re-creates the split')
  })

  await check('ripple delete closes the gap on the same track', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const b = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(3), offset: tk(2) })!
    s.addClipToTrack('video', { src: 'c.mp4', in: 0, out: tk(4), offset: tk(5) })
    s.selectClip(b.id)
    assert.ok(s.rippleDeleteSelected())
    const items = videoClipTrack(s).items!
    assert.equal(items.length, 2)
    assert.equal(startTicks(items[1]!), tk(2), 'the clip after the cut slides left')
    assert.equal(durationTicks(items[1]!), tk(4), 'and keeps its length')
    assert.equal(s.totalDuration.value, 6)
  })

  await check('closeProjectGaps pulls every clip to the start', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: tk(4) })
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(3), offset: tk(10) })
    const closedTicks = s.closeProjectGaps()
    assert.ok(closedTicks > 0)
    const items = videoClipTrack(s).items!
    assert.equal(startTicks(items[0]!), 0)
    assert.equal(startTicks(items[1]!), tk(2))
  })

  await check('duplicate pastes a copy without moving the original', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: tk(1), out: tk(4), offset: 0 })!
    s.selectClip(clip.id)
    const newIds = s.duplicateSelectedClips(4) // seconds target (UI contract)
    assert.equal(newIds.length, 1)
    const items = videoClipTrack(s).items!
    assert.equal(items.length, 2)
    assert.equal(startTicks(items.find(i => i.id === clip.id)!), 0)
    assert.equal(startTicks(items.find(i => i.id === newIds[0])!), tk(4))
  })

  await check('transition applies only to adjacent clips and stores ticks', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const tail = s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) })!
    const verdict = s.applyClipTransition(tail.id, 'fade', 0.5)
    assert.equal(verdict.ok, true, `transition refused: ${verdict.reason}`)
    const live = videoClip(s, tail.id)
    // transitionIn.duration is a CORE field and always lived in ticks.
    assert.equal(Math.round(live.transitionIn!.duration), tk(0.5))
  })

  await check('fade toggle stores a ticks envelope and clears again', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(10), offset: 0 })!
    s.selectClip(clip.id)
    assert.equal(s.toggleFadeSelection(), 'applied')
    const applied = videoClip(s, clip.id)
    assert.equal(Math.round(applied.fade!.in), tk(0.5))
    assert.equal(Math.round(applied.fade!.out), tk(0.5))
    assert.equal(s.toggleFadeSelection(), 'cleared')
    assert.equal(videoClip(s, clip.id).fade!.in, 0)
  })

  await check('save/load round-trip preserves tick geometry (no re-scale)', async () => {
    const s = await freshStore()
    const clip = s.addClipToTrack('video', { src: 'a.mp4', in: tk(2.5), out: tk(8.25), offset: tk(1.5) })!
    const id = s.currentProject.value!.id
    await s.flushDiskSave()
    const { useTmcutProject } = await import('../../app/composables/useTmcutProject')
    const again = useTmcutProject()
    await again.loadProject(id)
    const live = again.currentProject.value!.timeline.tracks
      .find(t => t.type === 'video')!.items!.find(i => i.id === clip.id)!
    assert.equal(live.in, tk(2.5))
    assert.equal(live.out, tk(8.25))
    assert.equal(live.offset, tk(1.5), 'schema 3 file must not be re-scaled AGAIN by the migration')
  })

  await check('legacy seconds file migrates once at open (schema <3)', async () => {
    // Simulate a pre-C16-R3 save: same id, schemaVersion 2, SECONDS items.
    const { useTmcutProject } = await import('../../app/composables/useTmcutProject')
    const store = useTmcutProject()
    const proj = store.createProject(`legacy-${Math.random().toString(36).slice(2, 8)}`)
    proj.schemaVersion = 2
    proj.timeline.tracks.find(t => t.type === 'video')!.items = [
      { id: 'old1', in: 1.5, out: 6, offset: 0.5, speed: 1, opacity: 100, scale: 100, x: 0, y: 0, rotation: 0 } as never
    ]
    store.saveProject() // persist the seconds-era payload through the storage mirror
    const again = useTmcutProject()
    await again.loadProject(proj.id)
    const live = again.currentProject.value!.timeline.tracks
      .find(t => t.type === 'video')!.items!.find(i => i.id === 'old1')!
    assert.equal(live.in, tk(1.5), 'seconds scale to ticks once')
    assert.equal(live.out, tk(6))
    assert.equal(live.offset, tk(0.5))
    assert.equal(again.currentProject.value!.schemaVersion, 3, 'the file is re-stamped at schema 3')
    // Re-open: the stamp must prevent a second scaling.
    const third = useTmcutProject()
    await third.loadProject(proj.id)
    const same = third.currentProject.value!.timeline.tracks
      .find(t => t.type === 'video')!.items!.find(i => i.id === 'old1')!
    assert.equal(same.in, tk(1.5), 'opening twice must NOT double-scale')
  })

  await check('createProject persists a caller-provided canvas to the mirror', async () => {
    // Quick presets used to patch the raw returned object after creation
    // and never re-saved — the editor's loadProject then read the default
    // mirror (R92). The canvas must be in the FIRST save already.
    const { useTmcutProject } = await import('../../app/composables/useTmcutProject')
    const store = useTmcutProject()
    const proj = store.createProject('vertical-preset', { width: 1080, height: 1920, fps: { numerator: 30, denominator: 1 } })
    const mirrored = JSON.parse(localStorage.getItem(`tmcut_project_${proj.id}`) || '{}')
    assert.equal(mirrored.canvas.width, 1080, 'the storage mirror carries the preset canvas')
    assert.equal(mirrored.canvas.height, 1920)
    assert.deepEqual(mirrored.canvas.fps, { numerator: 30, denominator: 1 }, 'legacy fps number normalized to rational')
  })

  console.log(`\n=== All ${passed} store behaviour checks passed ===`)
}

function videoClipTrack(s: Awaited<ReturnType<typeof freshStore>>) {
  return s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
