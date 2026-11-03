/**
 * Deterministic frame stepping (roadmap V4 Phase 2, item 3).
 *
 * The preview used to advance only by integrating a wall-clock delta, so
 * "the frame after this one" had no definition outside the moment the user
 * pressed the key. `createFrameScheduler` gives one: a frame INDEX is a
 * position on the canvas rate's grid, and its content is the evaluator's
 * answer at that position. These checks drive the real composable in Node, so
 * what is proven is the wiring, not a restatement of the core module (whose
 * own behavior is covered by `packages/core/test/scheduler.test.mjs`).
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_frame_scheduler.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, renderAt, ticksToSec } from 'tmcut-core'
import { freshStore, TICKS } from './helpers/tmcut_store_env'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')

function tk(sec: number): number {
  return Math.round(sec * TICKS)
}

/** The same comment-stripping the core boundary check uses: a doc block that
 *  says "no Date.now()" must not trip a guard that looks for Date.now(). */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

const WALL_CLOCK = ['Date.now', 'new Date', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'performance.now']

/** The whole `function name(...) { ... }` text, brace-matched. A regex would
 *  have to guess the indentation a formatter may change; this cannot. */
function bodyOf(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`)
  if (start === -1) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}') {
      depth--
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return ''
}

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

async function main() {
  console.log('=== [TMCut frame scheduler] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  // 1. The plan follows the project: 2 s at the default 30 fps canvas is 60
  // frames of 4000 ticks, and the span ends where the content ends.
  await check('the frame plan counts the content, not the padded ruler', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    const plan = p.frameScheduler.value
    assert.equal(plan.fps, 30, 'the rate comes from the canvas the transport already shows')
    assert.equal(plan.ticksPerFrame, TICKS_PER_SECOND / 30)
    assert.equal(plan.endTicks, tk(2))
    assert.equal(plan.frameCount, 60)
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(1), offset: tk(2) })
    assert.equal(p.frameScheduler.value.frameCount, 90, 'an appended clip extends the sequence')
    assert.equal(p.frameScheduler.value.endTicks, tk(3))
  })

  // 2. The index IS a position: seekToFrame(37) puts the playhead on tick
  // 37 * ticksPerFrame and the preview shows exactly that frame's content.
  await check('seekToFrame lands on the frame the plan names', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    p.seekToFrame(37)
    const frame = p.frameScheduler.value.frameAt(37)!
    assert.equal(frame.startTicks, 37 * 4000)
    assert.equal(p.playhead.value, ticksToSec(frame.startTicks))
    assert.equal(p.currentFrameIndex.value, 37)
    assert.equal(p.renderSeconds.value, p.playhead.value, 'inside the content the render position is the frame position')
    assert.ok(frame.evaluation.layers.length > 0, 'the frame has a layer to render')
    assert.equal(
      p.activeVideoClip.value!.mediaCurrentTime,
      ticksToSec(frame.evaluation.layers[0]!.sourceTicks!),
      'the picture the transport shows is the picture the frame carries'
    )
  })

  // 3. The roadmap acceptance, phrased through the app's own answer: asking for
  // the same index twice, with other seeks in between, gives identical content.
  await check('the same frame index answers identically on every request', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    s.addClipToTrack('text', { text: 'Hello', offset: tk(1), in: 0, out: tk(1) })
    const p = useTmcutPlayback()
    const readout = () => JSON.stringify({
      playhead: p.playhead.value,
      active: p.activeVideoClip.value,
      texts: p.activeTextClips.value.map(clip => clip.id),
      crossfade: p.transitionCrossfade.value?.progress ?? null
    })
    p.seekToFrame(45)
    const first = readout()
    p.seekToFrame(3)
    p.seekToFrame(59)
    p.seekToFrame(45)
    assert.equal(readout(), first, 'frame 45 changed between requests — the plan is not index-driven')
  })

  // 4. Stepping is index arithmetic. From the middle of a frame the playhead
  // goes to the NEXT frame start, never 1/30 s past where it stood.
  await check('stepFrame moves whole frames and re-quantises a mid-frame playhead', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    p.seekToFrame(10)
    p.seek(p.playhead.value + 0.001) // parked inside frame 10
    assert.equal(p.currentFrameIndex.value, 10)
    p.stepFrame(1)
    assert.equal(p.currentFrameIndex.value, 11)
    assert.equal(p.playhead.value, ticksToSec(11 * 4000), 'the step lands on the grid, overshoot discarded')
    p.stepFrame(-1)
    assert.equal(p.playhead.value, ticksToSec(10 * 4000), 'and a step back returns to the same grid point')
    p.seekToFrame(0)
    p.stepFrame(-1)
    assert.equal(p.playhead.value, 0, 'frame 0 has no frame before it')
    p.seekToFrame(59)
    p.stepFrame(1)
    assert.equal(p.playhead.value, ticksToSec(59 * 4000), 'the last frame is where stepping stops')
    p.stepFrame(0)
    assert.equal(p.playhead.value, ticksToSec(59 * 4000), 'a zero step moves nothing')
  })

  // 5. Parity with the boundary the export already follows (ADR-018): the last
  // frame of the plan is the last position a renderer may draw from. Core owns
  // that law now (`renderAt` scrub mode), so the plan and the answer to a
  // position at the span end are read from the same project, not from two
  // copies of the step-back arithmetic.
  await check('the last frame of the plan is the ADR-018 render position', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2) + 1, offset: 0 })
    const p = useTmcutPlayback()
    const plan = p.frameScheduler.value
    assert.equal(plan.frameCount, 61, 'a partial frame still counts')
    const last = plan.frameCount - 1
    p.seekToFrame(last)
    const parked = renderAt(s.currentProject.value!, plan.endTicks, { snapToFrame: false })
    assert.equal(parked.beyond, true, 'a position at the span end is past the last frame, so it steps back')
    assert.equal(parked.at, plan.frameAt(last)!.startTicks, 'core parks the scrub on the last frame the plan carries')
    p.seekToFrame(plan.frameCount)
    assert.equal(p.playhead.value, ticksToSec(plan.frameAt(last)!.startTicks), 'an index past the sequence has no frame to land on')
  })

  // 6. An empty project has no frames at all, so an index-driven step has
  // nowhere to go: the playhead keeps the position the seconds transport left
  // it in (module state survives a new project), and no seek happens.
  await check('an empty project schedules nothing', async () => {
    await freshStore()
    const p = useTmcutPlayback()
    assert.equal(p.frameScheduler.value.frameCount, 0)
    assert.equal(p.frameScheduler.value.frameAt(0), null)
    const parked = p.playhead.value
    p.seekToFrame(0)
    p.stepFrame(1)
    p.stepFrame(-1)
    assert.equal(p.playhead.value, parked, 'a frame step on an empty plan must not invent a position')
    assert.equal(p.currentFrameIndex.value, 0)
  })

  // 7. NTSC rates must not drift: 2 s at 30000/1001 is 60 frames of 4004
  // ticks, and frame 59 is the last one inside the content.
  await check('a 29.97 canvas steps on exact NTSC frame boundaries', async () => {
    const s = await freshStore()
    s.currentProject.value!.canvas.fps = { numerator: 30000, denominator: 1001 }
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(2), offset: 0 })
    const p = useTmcutPlayback()
    assert.equal(p.frameScheduler.value.ticksPerFrame, 4004)
    assert.equal(p.frameScheduler.value.frameCount, 60)
    p.seekToFrame(59)
    assert.equal(p.playhead.value, ticksToSec(59 * 4004))
    p.stepFrame(1)
    assert.equal(p.playhead.value, ticksToSec(59 * 4004), 'frame 60 does not exist in a 60-frame plan')
    s.currentProject.value!.canvas.fps = { numerator: 30, denominator: 1 }
  })

  // 8. The roadmap forbids a wall clock as frame timing — checked at the
  // source of the module that owns the sequence, comments excluded.
  await check('the scheduler reads no clock of its own', async () => {
    const code = stripComments(read('packages/core/src/scheduler.mjs'))
    for (const forbidden of WALL_CLOCK) {
      assert.ok(!code.includes(forbidden), `packages/core/src/scheduler.mjs uses ${forbidden}`)
    }
    assert.match(code, /evaluateTimeline\(/, 'the frame content is the evaluator answer, not a second model')
  })

  // 9. And the app must not re-derive the grid: the frame path delegates to
  // core, and its seek keeps no trace of the rAF delta it replaced.
  await check('the transport asks core for frames instead of counting time', async () => {
    const playback = read('app/composables/useTmcutPlayback.ts')
    assert.match(playback, /import \{[^}]*createFrameScheduler[^}]*\} from 'tmcut-core'/)
    const seekBody = bodyOf(playback, 'seekToFrame')
    assert.ok(seekBody, 'the composable no longer defines seekToFrame')
    for (const forbidden of ['timestamp', 'delta', 'lastTimestamp', 'Date.now']) {
      assert.ok(!seekBody.includes(forbidden), `seekToFrame consults ${forbidden}`)
    }
    assert.match(seekBody, /frameScheduler\.value\.frameAt\(index\)/, 'the frame must come from the plan')
    const stepBody = bodyOf(playback, 'stepFrame')
    assert.ok(stepBody, 'the composable no longer defines stepFrame')
    assert.match(stepBody, /seekToFrame\(currentFrameIndex\.value \+ delta\)/, 'stepping is index arithmetic')
  })

  // 10. The shortcut exists, is documented, and is named in both locales.
  await check('Alt+arrow steps one frame and the help says so', async () => {
    const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')
    assert.match(player, /if \(e\.altKey\) stepFrame\(-1\)\r?\n\s*else stepBackward/, 'Alt+Left frames, plain Left still steps seconds')
    assert.match(player, /if \(e\.altKey\) stepFrame\(1\)\r?\n\s*else stepForward/)
    const modal = read('app/components/tmcut/TmcutShortcutsModal.vue')
    assert.match(modal, /id: 'frameStep', category: 'playback'/)
    assert.match(modal, /t\('tmcut\.hotkeys\.frameStep'\)/)
    assert.match(modal, /t\('tmcut\.hotkeys\.desc\.frameStep'\)/)
    for (const locale of ['en', 'vi']) {
      const bundle = JSON.parse(read(`i18n/locales/${locale}.json`)) as {
        tmcut: { hotkeys: { frameStep?: string, desc?: { frameStep?: string } } }
      }
      assert.ok(bundle.tmcut.hotkeys.frameStep, `${locale}.json has no hotkeys.frameStep`)
      assert.ok(bundle.tmcut.hotkeys.desc?.frameStep, `${locale}.json has no hotkeys.desc.frameStep`)
    }
  })

  console.log(`\n=== All ${passed} frame scheduler checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
