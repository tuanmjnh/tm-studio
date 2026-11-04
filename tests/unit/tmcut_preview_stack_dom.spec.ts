/**
 * The preview stacks every footage surface (Zero-FFmpeg slice F2b).
 *
 * F2a made the composable read core's plan; the DOM still mounted ONE main
 * `<video>` plus the crossfade element, so the rows core stacked above the
 * painting row reached the file and not the screen. That asymmetry is what
 * `tmcut.export.parallelTracksWarning` had to admit. This spec owns the two
 * halves of closing it:
 *  1. `stackedSurfaces` — the plan minus what the existing two elements already
 *     carry, so a v-for can render the rest without a row disappearing twice or
 *     painting twice.
 *  2. one visual law for every footage layer: the main element, the outgoing
 *     crossfade layer and each stacked surface are styled by the SAME function
 *     of a surface, so a second row cannot get a cheaper look than the first.
 *  3. the copy: the warning may no longer promise a single-row picture, in
 *     either locale.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_preview_stack_dom.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const PLAYER = 'app/components/tmcut/TmcutPreviewPlayer.vue'
const tk = (sec: number) => Math.round(sec * TICKS)

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Two visible footage rows, one 0-4 s clip each. */
async function twoRows(withTransition = false) {
  const s = await freshStore()
  s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0 })
  s.addTrackToProject('video')
  const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
  s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0 }, rows[1]!.id)
  if (withTransition) {
    const joint = rows[0]!.items!.find(item => item.src === 'top.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
  }
  return { s, top: rows[0]!, bottom: rows[1]! }
}

async function main() {
  console.log('=== [TMCut preview stack DOM] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')
  type Playback = ReturnType<typeof useTmcutPlayback>
  type Surface = Playback['paintSurfaces']['value'][number]
  const stacked = (p: Playback) => p.stackedSurfaces.value.map((surface: Surface) => `${surface.clip.src}:${surface.role}`)
  const roles = (p: Playback) => p.paintSurfaces.value.map((surface: Surface) => `${surface.clip.src}:${surface.role}`)
  const audioOwners = (p: Playback) => p.paintSurfaces.value.filter((surface: Surface) => surface.ownsAudio)
  const sources = (p: Playback) => p.paintSurfaces.value.map((surface: Surface) => surface.clip.src)

  // 1. The v-for source must be the plan MINUS the two elements that exist.
  // Anything else double-paints a row or silently drops one.
  await check('stackedSurfaces is the plan without the elements that already exist', async () => {
    await twoRows()
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(sources(p), ['top.mp4', 'bottom.mp4'],
      'core stacks both rows at this tick')
    assert.deepEqual(stacked(p), ['bottom.mp4:paint'],
      'the main element carries the owning row, so only the row above is stacked')
    assert.equal(p.stackedSurfaces.value[0].layer, p.paintSurfaces.value[1].layer,
      'and the stacked surface is the same surface, not a re-derived copy')
  })

  // 2. A single row must give an EMPTY stack — the v-for renders nothing extra.
  await check('one row leaves nothing to stack', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'solo.mp4', in: 0, out: tk(4), offset: 0 })
    const p = useTmcutPlayback()
    p.seek(1)
    assert.deepEqual(stacked(p), [], 'no second row, no second element')
    assert.equal(s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video').length, 1)
  })

  // 3. The outgoing partner is carried by its own element: it must not also
  // appear in the v-for, or the same clip paints twice at half alpha.
  await check('the crossfade pair is not stacked a second time', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const row = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) }, row.id)
    const joint = row.items!.find(item => item.src === 'b.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
    const p = useTmcutPlayback()
    // `applyClipTransition` overlaps the pair backwards, so the window is [3.5, 4).
    p.seek(3.75)
    assert.deepEqual(roles(p), ['a.mp4:outgoing', 'b.mp4:paint'])
    assert.ok(p.transitionCrossfade.value, 'the pair is a crossfade, not two stacked rows')
    assert.deepEqual(stacked(p), [], 'and both of its elements already exist')
  })

  // 4. Upper rows crossfade too: an outgoing partner that belongs to a row
  // ABOVE the painting row has no dedicated element, so it must be stacked.
  await check('an outgoing partner of a stacked row is stacked', async () => {
    const { s, bottom } = await twoRows()
    const jointSeed = { src: 'upper.mp4', in: 0, out: tk(4), offset: tk(4) }
    s.addClipToTrack('video', jointSeed, bottom.id)
    const joint = bottom.items!.find(item => item.src === 'upper.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
    const p = useTmcutPlayback()
    p.seek(3.75)
    assert.deepEqual(roles(p), ['top.mp4:paint', 'bottom.mp4:outgoing', 'upper.mp4:paint'],
      'core puts the stacked row pair in plan order')
    assert.deepEqual(stacked(p), ['bottom.mp4:outgoing', 'upper.mp4:paint'],
      'the pair above the canvas is rendered in order, partner under paint')
    assert.deepEqual(audioOwners(p).map((surface: Surface) => surface.clip.src),
      ['top.mp4'], 'the audio still follows the bottom of the stack')
  })

  // 5. One visual law for every footage layer. The main element, the crossfade
  // element and the stacked surfaces must be styled by the same function of a
  // surface — a second row painted by a cheaper helper is the drift this slice
  // exists to prevent, and the per-tick ramp has to come from core's layer,
  // not from a pair object scoped to one row.
  await check('every footage layer is styled by one surface helper', () => {
    const player = read(PLAYER)
    assert.match(player, /function surfaceStyle/, 'one styling function for all footage layers')
    assert.match(player, /v-for="surface in stackedSurfaces"/,
      'one element per stacked surface, in core plan order')
    assert.match(player, /:style="surfaceStyle\(mainSurface\)"/, 'the main element is styled by it')
    assert.match(player, /:style="surfaceStyle\(crossfadeSurface\)"/, 'and so is the crossfade layer')
    assert.match(player, /v-for="surface in stackedSurfaces"[\s\S]{0,700}\n\s*:muted="true"/,
      'a stacked row never carries sound: the plan puts the owning row under it')
    assert.doesNotMatch(player, /const videoTransformStyle|const outgoingStyle|videoObjectStyle/,
      'no per-element copy of the ramp law may survive beside the shared helper')
    assert.match(player, /surface\.layer\.transition/, 'the ramp is read from core layer for this tick')
    assert.match(player, /surface\.crossfades/, 'and only while the partner is on screen')
  })

  // 6. The copy must stop promising a single-row screen, in BOTH locales.
  await check('the export warning says the screen stacks, in both locales', () => {
    for (const locale of ['en', 'vi']) {
      const copy = read(`i18n/locales/${locale}.json`)
      const warning = copy.match(/"parallelTracksWarning":\s*"([^"]*)"/)?.[1] ?? ''
      assert.ok(warning.length > 0, `${locale}: parallelTracksWarning is missing`)
      assert.match(warning, /composites|stacks|theo thứ tự vẽ/,
        `${locale}: the rows above the base are in the file`)
      assert.doesNotMatch(warning, /preview still|preview vẫn chỉ/i,
        `${locale}: the preview no longer shows one row, and the copy must say so`)
      assert.match(warning, /preview (also|now)|màn hình (cũng|now)/i,
        `${locale}: the copy has to state what the screen does today`)
    }
  })

  console.log(`\n=== All ${passed} preview stack-DOM checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
