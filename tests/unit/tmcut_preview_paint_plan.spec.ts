/**
 * The preview paints core's composite plan (Zero-FFmpeg slice F2a).
 *
 * F1 put the answer to "which surfaces paint at this tick, in what order" in
 * core (`compositePlan`). This spec drives the SHIPPED composable and requires
 * it to hand that answer to the DOM instead of re-deriving it: the surfaces
 * come from core's slots, the layer objects come from the evaluator, and the
 * composable keeps no window math of its own.
 *
 * What F2a deliberately does NOT change: the DOM. `TmcutPreviewPlayer.vue`
 * still mounts one main <video> plus the crossfade element, so `activeVideoClip`
 * must keep naming the BOTTOM of the stack (the row whose picture also carries
 * the audio — which is what the file decodes for sound). F2b turns
 * `paintSurfaces` into one element per surface and flips the copy witness that
 * currently has to admit the preview shows one row.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_preview_paint_plan.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { evaluateTimeline, compositePlan } from 'tmcut-core'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const COMPOSABLE = 'app/composables/useTmcutPlayback.ts'
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const tk = (sec: number) => Math.round(sec * TICKS)

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Two visible footage rows, one 0-4 s clip each; `rowOrder` names them. */
async function twoRows() {
  const s = await freshStore()
  s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0 })
  s.addTrackToProject('video')
  const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
  s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0 }, rows[1]!.id)
  return { s, top: rows[0]!, bottom: rows[1]! }
}

async function main() {
  console.log('=== [TMCut preview paint plan] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  type Playback = ReturnType<typeof useTmcutPlayback>
  type Surface = Playback['paintSurfaces']['value'][number]
  const srcs = (p: Playback) => p.paintSurfaces.value.map((surface: Surface) => `${surface.clip.src}:${surface.role}`)
  const audioOwners = (p: Playback) => p.paintSurfaces.value.filter((surface: Surface) => surface.ownsAudio)

  // 1. The stacking law, seen from the composable: every visible row with a
  // live layer contributes a surface, bottom of the stack first.
  await check('two live rows give two surfaces, bottom of the stack first', async () => {
    await twoRows()
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(srcs(p), ['top.mp4:paint', 'bottom.mp4:paint'],
      'core lists the rows in track order, and the composable must not trim that')
    const owners = audioOwners(p)
    assert.equal(owners.length, 1, 'exactly one surface carries the audio')
    assert.equal(owners[0].clip.src, 'top.mp4', 'the bottom row — which is what the file decodes for sound')
    assert.equal(p.activeVideoClip.value.clip.src, 'top.mp4',
      'the element that exists today still shows the bottom row (F2b adds the others)')
  })

  // 2. A gap paints nothing, and the rows beside it keep their own surfaces —
  // this is the per-tick behaviour the per-file exporter could not express.
  await check('a row with no layer at this tick contributes nothing', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'gap-top.mp4', in: 0, out: tk(4), offset: 0 })
    s.addTrackToProject('video')
    const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
    s.addClipToTrack('video', { src: 'gap-bottom.mp4', in: 0, out: tk(8), offset: tk(3) }, rows[1]!.id)
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(srcs(p), ['gap-top.mp4:paint'])
    p.seek(5)
    assert.deepEqual(srcs(p), ['gap-bottom.mp4:paint'], 'the row that has a layer there paints alone')
    assert.equal(audioOwners(p).length, 1)
  })

  // 3. Hidden is hidden: the row leaves the plan exactly as it leaves the file.
  await check('a hidden row never reaches the surface list', async () => {
    const { s, top } = await twoRows()
    s.toggleTrackHidden(top.id)
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(srcs(p), ['bottom.mp4:paint'])
    assert.equal(p.paintSurfaces.value[0].ownsAudio, true, 'and it takes the audio with the picture')
  })

  // 4. A transition window is two surfaces of ONE row, outgoing under paint,
  // and the crossfade shape the player already binds to keeps working.
  await check('a transition window gives its row two surfaces, outgoing under paint', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const row = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) }, row.id)
    const joint = row.items!.find(item => item.src === 'b.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
    const p = useTmcutPlayback()
    // `applyClipTransition` overlaps the pair by the duration, so the window
    // covers [3.5, 4) — probe inside it, not past the joint.
    p.seek(3.75)
    assert.deepEqual(srcs(p), ['a.mp4:outgoing', 'b.mp4:paint'],
      'the outgoing clip is a surface beneath the incoming picture')
    assert.deepEqual(audioOwners(p).map((surface: Surface) => surface.clip.src),
      ['b.mp4'],
      'audio follows the incoming picture — the player already documents that simplification, and the file agrees because its audio is one time-ordered concat')
    assert.equal(p.paintSurfaces.value[0].ownsAudio, false, 'the outgoing surface is muted')
    const cf = p.transitionCrossfade.value
    assert.ok(cf, 'the player still gets a crossfade pair')
    assert.equal(cf!.outgoing.src, 'a.mp4')
    assert.equal(cf!.incoming.src, 'b.mp4')
    assert.equal(cf!.type, 'fade')
    assert.ok(Math.abs(cf!.progress - 0.5) < 1e-6, `progress from core, got ${cf!.progress}`)
  })

  // 5. Surfaces carry the layers the evaluator produced for this tick. A re-read
  // of the clip would be a second decision to keep in sync, so the DOM must get
  // core's numbers; the row it joins back to is the row core named.
  await check('a surface carries the layer core computed for this tick', async () => {
    const { s, bottom } = await twoRows()
    const project = s.currentProject.value!
    const p = useTmcutPlayback()
    p.seek(1)
    const evaluation = evaluateTimeline(project, tk(1))
    const plan = compositePlan(evaluation)
    assert.deepEqual(p.paintSurfaces.value.map((surface: Surface) => surface.layer),
      plan.slots.filter(slot => slot.kind === 'footage').map(slot => slot.layer),
      'the composable hands the DOM core slots, reshaped — not re-derived')
    const second = p.paintSurfaces.value[1]
    assert.equal(second.trackIndex, project.timeline.tracks.findIndex(t => t.id === bottom.id),
      'trackIndex is the row as authored, so joining back is one lookup')
    assert.equal(evaluation.tracks[second.trackIndex]?.id, second.trackId,
      'the same index answers in the authored list and in the evaluation')
    assert.deepEqual(second.layer, evaluation.tracks[second.trackIndex]?.layers?.[0],
      'and the layer is core answer for this tick, not a reading of the clip')
    assert.equal(second.mediaTimeSec, Number(second.layer.sourceTicks) / TICKS)
  })

  // 6. No second copy of the plan in the app: the composable asks core, and it
  // no longer reads transition roles off the layers itself.
  await check('the composable reads the plan and keeps no local window law', () => {
    const source = read(COMPOSABLE)
    assert.match(source, /import \{[^}]*compositePlan[^}]*\} from 'tmcut-core'/,
      'the name comes from tmcut-core, not a local helper')
    assert.doesNotMatch(source, /transition\??\.role/,
      'pair detection belongs to core; reading layer.transition.role here is the drift F1 removed')
    assert.match(source, /paintSurfaces/, 'the surface list is what the DOM will bind to')
  })

  console.log(`\n=== All ${passed} preview paint-plan checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
