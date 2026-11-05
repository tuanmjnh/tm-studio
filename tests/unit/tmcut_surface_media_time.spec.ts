/**
 * One media-time source for a footage surface (Zero-FFmpeg slice F6a).
 *
 * `compositePlan` hands the preview the layer core computed for this tick, and
 * that layer already answers "where in the source file is this picture" —
 * `sourceTicks`, with speed, ramp and reverse folded in and the result clamped
 * to the clip's own range. The composable also kept a second answer for the one
 * case core says "I have no source range for this clip": a live clip shaped like
 * the DSL (`timeline.{start,duration}`, no numeric `in`/`out`) fell through to
 * the app's own map, which reads `clip.in + local * speed`. With no `in` that
 * arithmetic is NaN, and `ticksToSec` folds non-finite to `0` — measured, not
 * argued: `mediaTimeSec` came back `0` at playhead 1 s. So the element is parked
 * at the first source frame and re-seeked by the drift check every frame, which
 * reads as a frozen clip rather than a crash. A surface with no position cannot
 * paint, so the law this spec demands is the one the plan already states: the
 * picture's source position is core's, or the surface is not on the canvas.
 *
 * Why the branch matters even though the store writes flat clips: core accepts
 * BOTH shapes — `sourceRangeOf` reads `source.{in,out}` first, then a numeric
 * `in` — so any project that arrives as v3 (a template, an AI plan, a file from
 * the roadmap's own DSL) reaches the preview through this branch. The check
 * builds that shape rather than assuming it cannot happen.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_surface_media_time.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { compositePlan, evaluateTimeline } from 'tmcut-core'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const COMPOSABLE = 'app/composables/useTmcutPlayback.ts'
const tk = (sec: number) => Math.round(sec * TICKS)

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** One live footage row with one clip, authored through the real store. */
async function oneClip(patch?: (clip: Record<string, unknown>) => void) {
  const s = await freshStore()
  s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
  const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
  const clip = track.items![0] as unknown as Record<string, unknown>
  if (patch) patch(clip)
  return { s, track, clip }
}

async function main() {
  console.log('=== [TMCut surface media time] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  type Playback = ReturnType<typeof useTmcutPlayback>
  const times = (p: Playback) => p.paintSurfaces.value.map(surface => surface.mediaTimeSec)

  // 1. The ordinary case, restated as a contract: the surface's media time IS
  // core's sourceTicks, not a reading of the clip. This holds today and must
  // keep holding after the fallback goes away.
  await check('a flat footage surface takes core sourceTicks', async () => {
    const { s } = await oneClip()
    const p = useTmcutPlayback()
    p.seek(1)
    const layer = compositePlan(evaluateTimeline(s.currentProject.value!, tk(1)))
      .slots.filter(slot => slot.kind === 'footage').map(slot => slot.layer)[0]
    assert.notEqual(layer.sourceTicks, null, 'core answers this shape')
    assert.equal(p.paintSurfaces.value[0].mediaTimeSec, layer.sourceTicks / TICKS)
  })

  // 2. The branch, built on purpose: a live clip in the DSL shape, so core
  // reports no source range. Nothing may invent a time for it.
  await check('a live clip with no core source position contributes no surface', async () => {
    const { s } = await oneClip((clip) => {
      clip.timeline = { start: 0, duration: tk(4) }
      clip.in = undefined
      clip.out = undefined
    })
    const evaluation = evaluateTimeline(s.currentProject.value!, tk(1))
    const slots = compositePlan(evaluation).slots.filter(slot => slot.kind === 'footage')
    assert.equal(slots.length, 1, 'core still puts the clip on the canvas')
    assert.equal(slots[0].layer.sourceTicks, null, 'and core says it has no source range')
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(p.paintSurfaces.value.map(surface => surface.clip.src), [],
      'a surface with no position cannot paint, so the plan must not carry it')
    assert.ok(times(p).every(t => Number.isFinite(t)), `no NaN reaches the DOM, got ${times(p)}`)
  })

  // 3. The same clip in a stack must not steal the audio claim either: the
  // bottom of the stack is the row the file decodes for sound, and an element
  // that does not exist cannot carry it.
  await check('the dropped surface leaves the audio claim to a paintable row', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0 })
    s.addTrackToProject('video')
    const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
    const top = rows[1]!
    s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0 }, top.id)
    const topClip = top.items![0] as unknown as Record<string, unknown>
    topClip.timeline = { start: 0, duration: tk(4) }
    topClip.in = undefined
    topClip.out = undefined
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(p.paintSurfaces.value.map(surface => surface.clip.src), ['bottom.mp4'])
    assert.equal(p.paintSurfaces.value[0].ownsAudio, true,
      'the row that paints is the row that owns the sound')
  })

  // 4. The crossfade pair already refuses a partner with no source position;
  // with one rule for both, the refusal has to come from the same place.
  await check('a crossfade whose partner has no source position is a plain cut', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const row = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) }, row.id)
    const joint = row.items!.find(item => item.src === 'b.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
    const leaving = row.items!.find(item => item.src === 'a.mp4') as unknown as Record<string, unknown>
    leaving.timeline = { start: 0, duration: tk(4) }
    leaving.in = undefined
    leaving.out = undefined
    const p = useTmcutPlayback()
    p.seek(3.75)
    assert.deepEqual(p.paintSurfaces.value.map(surface => surface.clip.src), ['b.mp4'],
      'the picture that has a position paints alone')
    assert.equal(p.transitionCrossfade.value, null,
      'and there is no ramp to a partner the canvas cannot seek')
  })

  // 5. The law is in one place: the composable keeps no media-time map of its
  // own. The app copy of the map still exists for the audio row (slice G owns
  // that leg); what ends here is the footage branch reading it.
  await check('the composable keeps no media-time map for footage', () => {
    const source = read(COMPOSABLE)
    assert.doesNotMatch(source, /clipMediaTimeSec/,
      'the second copy of the source-position law is not the preview\'s to keep')
    assert.doesNotMatch(source, /function mediaTimeAt/,
      'and no local wrapper stands in for core\'s answer')
    assert.match(source, /sourceTicks/, 'the surface still reads core\'s number')
  })

  console.log(`\n=== All ${passed} surface-media-time checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
