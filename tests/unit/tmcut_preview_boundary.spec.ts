/**
 * Preview boundary semantics (ADR-018).
 *
 * A clip window is half-open, `[start, end)`, for EVERY consumer of the
 * timeline. Before this rule, the evaluator was already half-open while the
 * preview compared text with `t <= end` and the export used FFmpeg
 * `between(t,start,end)` — which includes `end`. Preview and export agreed
 * with each other and disagreed with the evaluator, so a caption kept running
 * for one extra frame and was painted over the first frame of the next one.
 *
 * The export side of that story is measured with real pixels in
 * tmcut_render_parity.spec.ts. This file covers the two preview halves that
 * spec cannot reach, and it deliberately does NOT need FFmpeg:
 *   1. `activeTextClips` reads layers from `evaluateTimeline` instead of
 *      running its own window comparison, so the boundary cannot drift again;
 *   2. `renderSeconds` pulls the render position back to the start of the last
 *      content frame when the playhead rests on the end, because that instant
 *      is one frame past the picture the export produces.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_preview_boundary.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshStore, TICKS } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function tk(sec: number): number {
  return Math.round(sec * TICKS)
}

/** Seconds per frame at the project's own rate, so no assertion assumes 30. */
function frameSec(s: Awaited<ReturnType<typeof freshStore>>): number {
  const fps = s.currentProject.value?.canvas?.fps as { numerator?: number, denominator?: number } | undefined
  const num = fps?.numerator
  const den = fps?.denominator
  return num && den ? den / num : 1 / 30
}

/** Adjacent captions: `[0,2)` then `[2,4)` — a cut with no gap. */
async function twoCaptions() {
  const s = await freshStore()
  s.addClipToTrack('text', { id: 'cap-1', text: 'ONE', offset: 0, in: 0, out: tk(2) })
  s.addClipToTrack('text', { id: 'cap-2', text: 'TWO', offset: tk(2), in: 0, out: tk(2) })
  return s
}

async function main() {
  console.log('=== [TMCut preview boundary] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  await check('the cut frame belongs to the incoming caption only', async () => {
    const s = await twoCaptions()
    assert.equal(s.contentDuration.value, 4, 'two 2 s captions make a 4 s project')
    const p = useTmcutPlayback()
    p.seek(2)
    const ids = p.activeTextClips.value.map(clip => clip.id)
    assert.deepEqual(ids, ['cap-2'], `t = end of the first window must not keep it alive (got ${ids})`)
  })

  await check('the frame before the cut still shows the outgoing caption', async () => {
    const s = await twoCaptions()
    const p = useTmcutPlayback()
    p.seek(2 - frameSec(s))
    const ids = p.activeTextClips.value.map(clip => clip.id)
    assert.deepEqual(ids, ['cap-1'], `the last frame of a window is inside it (got ${ids})`)
  })

  await check('a hidden text track yields no overlay', async () => {
    const s = await twoCaptions()
    const p = useTmcutPlayback()
    p.seek(1)
    assert.equal(p.activeTextClips.value.length, 1, 'visible before the track is hidden')
    const track = s.currentProject.value!.timeline.tracks.find(t => t.type === 'text')!
    track.hidden = true
    p.seek(1.5)
    assert.deepEqual(p.activeTextClips.value.map(clip => clip.id), [], 'the evaluator drops hidden tracks')
    track.hidden = false
  })

  await check('resting on the end of the content renders the last frame, not black', async () => {
    const s = await twoCaptions()
    const p = useTmcutPlayback()
    const frame = frameSec(s)
    p.seek(4)
    assert.ok(p.renderSeconds.value < 4, `position pulled back (got ${p.renderSeconds.value})`)
    assert.ok(Math.abs(p.renderSeconds.value - (4 - frame)) < 1e-6,
      `one frame before the end (got ${p.renderSeconds.value}, want ${4 - frame})`)
    const ids = p.activeTextClips.value.map(clip => clip.id)
    assert.deepEqual(ids, ['cap-2'], `the finished project keeps its last caption on screen (got ${ids})`)
  })

  await check('the clamp bounds on the content, not on the padded ruler', async () => {
    const s = await freshStore()
    s.addClipToTrack('text', { id: 'cap-1', text: 'ONE', offset: 0, in: 0, out: tk(2) })
    const p = useTmcutPlayback()
    assert.equal(s.contentDuration.value, 2, 'two seconds of content')
    assert.equal(s.totalDuration.value, 5, 'the ruler is padded to its 5 s minimum')
    // The play loop parks the playhead on contentDuration, well inside the
    // ruler. Clamping against the ruler extent would render at 2 s — a frame
    // that does not exist in the export — and the canvas would go black.
    p.seek(2)
    assert.ok(Math.abs(p.renderSeconds.value - (2 - frameSec(s))) < 1e-6,
      `last content frame, not last ruler frame (got ${p.renderSeconds.value})`)
    assert.deepEqual(p.activeTextClips.value.map(clip => clip.id), ['cap-1'],
      'the caption is still on screen at the end of playback')
  })

  await check('positions inside the content render exactly where the playhead is', async () => {
    await twoCaptions()
    const p = useTmcutPlayback()
    p.seek(1.25)
    assert.equal(p.renderSeconds.value, 1.25, 'no pull-back below the end')
    p.seek(0)
    assert.equal(p.renderSeconds.value, 0, 'the first frame is the first frame')
  })

  await check('an empty timeline has no render position to pull back', async () => {
    const s = await freshStore()
    const p = useTmcutPlayback()
    assert.equal(s.contentDuration.value, 0)
    p.seek(0)
    assert.equal(p.renderSeconds.value, 0, 'a 0-length project must not produce a negative position')
    assert.deepEqual(p.activeTextClips.value, [])
  })

  await check('the preview player renders text layers from the evaluator position', async () => {
    const player = readFileSync(join(root, 'app/components/tmcut/TmcutPreviewPlayer.vue'), 'utf8')
    assert.match(player, /renderSeconds/, 'the player destructures the clamped position')
    assert.match(player, /secToTicks\(renderSeconds\.value\)/, 'layer local time comes from the render position')
  })

  console.log(`\n=== All ${passed} preview boundary checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
