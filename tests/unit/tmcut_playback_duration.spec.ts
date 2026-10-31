/**
 * Content duration vs ruler extent.
 *
 * `totalDuration` carries a 5-second floor so the timeline ruler never
 * collapses (see tmcut_store_behaviour). That floor is a DRAWING extent, not
 * the length of the project — playback, the saved project duration, the
 * transport readouts and the export spec must all follow the real content.
 * A 2s clip therefore plays for 2s, not 2s of media plus 3s of black.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_playback_duration.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { freshStore, TICKS } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

function tk(sec: number): number {
  return Math.round(sec * TICKS)
}

// Single-slot fake animation clock: the playback loop re-arms itself through
// requestAnimationFrame, so one pending callback at a time is all the model
// needs. `tick` advances the wall clock and runs that callback once.
let pending: ((t: number) => void) | null = null
let clock = 0
let frameId = 0
const g = globalThis as Record<string, unknown>
g.requestAnimationFrame = (cb: (t: number) => void) => {
  pending = cb
  return ++frameId
}
g.cancelAnimationFrame = () => {
  pending = null
}

function tick(ms: number) {
  clock += ms
  const cb = pending
  pending = null
  if (cb) cb(clock)
}

function runFrames(count: number, ms: number) {
  for (let i = 0; i < count; i++) tick(ms)
}

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

async function main() {
  console.log('=== [TMCut playback duration] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  await check('contentDuration reports the real content while totalDuration keeps the ruler floor', async () => {
    const s = await freshStore()
    assert.equal(s.contentDuration.value, 0, 'an empty timeline has no content')
    assert.equal(s.totalDuration.value, 5, 'the ruler still draws its 5s minimum')
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    assert.equal(s.contentDuration.value, 2)
    assert.equal(s.totalDuration.value, 5, 'the floor is presentation, not project length')
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4) })
    assert.equal(s.contentDuration.value, 6, 'a later clip extends the content')
  })

  await check('saveProject persists the content length, not the padded ruler', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    s.saveProject()
    const mirror = JSON.parse(localStorage.getItem(`tmcut_project_${s.currentProject.value!.id}`) || '{}')
    assert.equal(mirror.durationMs, 2000, 'the dashboard card must show the media length the export produces')
  })

  await check('playback stops at the end of the content instead of running the ruler tail', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    p.seek(0)
    p.play()
    assert.equal(p.isPlaying.value, true)
    runFrames(40, 100) // 4 wall seconds of frames for a 2s timeline
    assert.equal(p.isPlaying.value, false, 'the loop stops on its own at the content end')
    assert.equal(p.playhead.value, 2, 'and parks exactly at the content end, not at 5')
  })

  await check('the loop zone without In/Out marks wraps at the content end', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    p.seek(0)
    p.loopPlayback.value = true
    p.play()
    runFrames(25, 100) // crosses the 2s end once
    assert.equal(p.isPlaying.value, true, 'looping never reaches the timeline end')
    assert.ok(p.playhead.value > 0 && p.playhead.value < 2, `wrapped inside the content (got ${p.playhead.value})`)
    p.loopPlayback.value = false
    p.pause()
  })

  await check('pressing play with the playhead parked past the content restarts at zero', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    p.seek(3) // legal: the ruler extends to 5s even with 2s of content
    assert.equal(p.playhead.value, 3, 'seek keeps clamping to the ruler extent')
    p.play()
    runFrames(2, 16)
    assert.ok(p.playhead.value < 1, `restarts from the beginning (got ${p.playhead.value})`)
    p.pause()
  })

  await check('transport readouts and the End shortcut use the content length', async () => {
    const timeline = read('app/components/tmcut/TmcutTimeline.vue')
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    const editor = read('app/pages/tmcut/editor.vue')
    const inspector = read('app/components/tmcut/TmcutInspector.vue')
    assert.match(timeline, /formatTimecode\(contentDuration\)/, 'the timeline footer reads the project length')
    assert.match(player, /formatTimecode\(contentDuration\b/, 'the program monitor reads the project length')
    assert.match(editor, /formatTimecode\(contentDuration\)/, 'the status bar reads the project length')
    assert.match(inspector, /formatTimecode\(contentDuration\.value\)/, 'the details panel reads the project length')
    for (const [name, source] of [['timeline', timeline], ['player', player], ['editor', editor], ['inspector', inspector]] as const) {
      assert.doesNotMatch(source, /formatTimecode\(totalDuration(\.value)?\)/, `${name} must not label the padded ruler as the duration`)
    }
    assert.match(timeline, /seek\(contentDuration\.value\)/, 'End jumps to the end of content')
    assert.match(player, /@click="seek\(contentDuration\)"/, 'skip-to-end lands on the last frame of content')
  })

  await check('the transport frame field follows the canvas rate', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    assert.equal(p.formatTimecode(1.5), '00:01.15', '30fps stays the default')
    assert.equal(p.formatTimecode(1.5, 60), '00:01.30', '60fps counts frames 0-59')
    assert.equal(p.formatTimecode(2.96, 24), '00:02.23', '24fps caps the frame field at 23')
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    assert.match(player, /formatTimecode\(playhead, previewFps\)/, 'the playhead readout uses the canvas rate')
    assert.match(player, /formatTimecode\(contentDuration, previewFps\)/, 'the duration readout uses the canvas rate')
  })

  await check('canvas clicks edit overlays instead of toggling playback', async () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    assert.match(player, /function onCanvasClick\(e: MouseEvent\)/, 'the canvas handler sees the event target')
    assert.match(player, /closest\('\[data-canvas-hit\]'\)/, 'interactive overlays are excluded from play/pause')
    const tagged = (player.match(/data-canvas-hit/g) || []).length
    assert.ok(tagged >= 4, `the text layer, transform box and status overlays must opt out (found ${tagged})`)
  })

  await check('transport controls are Nuxt UI components, not native inputs', async () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    assert.doesNotMatch(player, /<select[\s\S]{0,400}tmcut-preview-quality/, 'the quality picker is a USelect')
    assert.doesNotMatch(player, /<input[\s\S]{0,200}type="range"/, 'the volume control is a USlider')
    assert.match(player, /<USelect[\s\S]{0,400}tmcut-preview-quality/, 'quality uses USelect')
    assert.match(player, /<USlider[\s\S]{0,400}onVolumeChange/, 'volume uses USlider')
  })

  console.log(`\n=== All ${passed} playback duration checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
