/**
 * V4 Phase 2, item (5): preview and export answer "what is on screen" from
 * ONE model.
 *
 * The preview already asks `evaluateTimeline`, which walks EVERY track and
 * marks a layer invisible when its track is hidden. The export used to
 * `.find()` the first video track and the first text track, and never read
 * `hidden` at all — so a project with parallel caption rows exported one row,
 * and a row the user had hidden in the timeline still painted into the file.
 *
 * These checks read the compiled FFmpeg arguments as the witness: the same
 * strings a real render runs, not an internal list that could agree with
 * itself and disagree with the command line.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_export_track_parity.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TICKS_PER_SECOND, createFrameScheduler, evaluateTimeline } from 'tmcut-core'
import { compileTimelineToFfmpeg, selectExportTracks } from '../../app/utils/tmcut/render'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

let passed = 0

async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function tk(sec: number): number {
  return Math.round(sec * TICKS_PER_SECOND)
}

type ClipSeed = { id: string, src?: string, text?: string, start: number, duration: number }
type TrackSeed = { id: string, type: 'video' | 'text' | 'audio', hidden?: boolean, clips: ClipSeed[] }

function clip(seed: ClipSeed, trackId: string) {
  return {
    id: seed.id,
    trackId,
    ...(seed.src ? { src: seed.src } : {}),
    ...(seed.text ? { text: seed.text } : {}),
    offset: tk(seed.start),
    in: 0,
    out: tk(seed.duration),
    speed: 1
  }
}

function project(tracks: TrackSeed[]): TmcutProject {
  return {
    version: 1,
    name: 'track parity',
    canvas: { width: 320, height: 180, fps: 30 },
    timeline: {
      tracks: tracks.map(t => ({
        id: t.id,
        type: t.type,
        name: t.id,
        ...(t.hidden ? { hidden: true } : {}),
        items: t.clips.map(c => clip(c, t.id))
      }))
    }
  } as unknown as TmcutProject
}

const VIDEO: TrackSeed = { id: 'v1', type: 'video', clips: [{ id: 'a', src: 'a.mp4', start: 0, duration: 2 }] }
const VIDEO2: TrackSeed = { id: 'v2', type: 'video', clips: [{ id: 'b', src: 'b.mp4', start: 0, duration: 8 }] }
const CAPTIONS_A: TrackSeed = { id: 't1', type: 'text', clips: [{ id: 'capA', text: 'A', start: 0, duration: 2 }] }
const CAPTIONS_B: TrackSeed = { id: 't2', type: 'text', clips: [{ id: 'capB', text: 'B', start: 1, duration: 2 }] }

/** The drawtext windows the file will honour: `[text, startSec, endSec]` per chain. */
function drawtextWindows(filterComplex: string): Array<[string, number, number]> {
  const pattern = /text='([^']*)'[^;]*?enable='gte\(t,([\d.]+)\)\*lt\(t,([\d.]+)\)'/g
  const found: Array<[string, number, number]> = []
  for (const match of filterComplex.matchAll(pattern)) {
    found.push([match[1], Number(match[2]), Number(match[3])])
  }
  return found
}

function filterComplexOf(compiled: { args: string[] }): string {
  const index = compiled.args.indexOf('-filter_complex')
  assert.ok(index >= 0, 'the compiled command has no filter graph')
  return compiled.args[index + 1]
}

async function main() {
  // 1. Every visible caption row reaches the file, not only the first one.
  await check('a second caption row reaches the file', () => {
    const compiled = compileTimelineToFfmpeg(project([VIDEO, CAPTIONS_A, CAPTIONS_B]), 'out.mp4')
    const windows = drawtextWindows(filterComplexOf(compiled))
    assert.equal(windows.length, 2, `expected two drawtext chains, got ${JSON.stringify(windows)}`)
    const byText = new Map(windows.map(w => [w[0], w]))
    assert.ok(byText.has('A') && byText.has('B'), `captions painted: ${[...byText.keys()]}`)
    assert.deepEqual(byText.get('B'), ['B', 1, 3], 'the second row keeps its own window')
  })

  // 2. A row the preview hides is not painted by the export either.
  await check('a hidden caption row paints nothing', () => {
    const compiled = compileTimelineToFfmpeg(project([VIDEO, CAPTIONS_A, { ...CAPTIONS_B, hidden: true }]), 'out.mp4')
    const windows = drawtextWindows(filterComplexOf(compiled))
    assert.equal(windows.length, 1, `hidden row still drew: ${JSON.stringify(windows)}`)
    assert.equal(windows[0][0], 'A')
  })

  await check('a hidden footage row contributes no input', () => {
    const compiled = compileTimelineToFfmpeg(project([VIDEO, { ...VIDEO2, hidden: true }]), 'out.mp4')
    const args = compiled.args.join(' ')
    assert.ok(args.includes('a.mp4'), 'the visible row is the base')
    assert.ok(!args.includes('b.mp4'), 'a hidden row must not be decoded at all')
    assert.equal(compiled.duration, 2, 'a hidden row does not stretch the timeline')
  })

  // 3. The base row is the first PAINTED one: hiding the bottom row must not
  // turn the export into a bare colour canvas.
  await check('the base is the first painted video row', () => {
    const mixed = project([{ ...VIDEO, hidden: true }, VIDEO2, CAPTIONS_A])
    assert.equal(selectExportTracks(mixed).videoBase?.id, 'v2', 'the visible row is the base')
    const compiled = compileTimelineToFfmpeg(mixed, 'out.mp4')
    assert.ok(compiled.args.join(' ').includes('b.mp4'), 'the base row is decoded')
    assert.equal(compiled.duration, 8)
  })

  // 4. The file is as long as the timeline: content on a row the exporter does
  // not yet composite still bounds the render instead of being cut off.
  await check('a parallel footage row still bounds the duration', () => {
    const compiled = compileTimelineToFfmpeg(project([VIDEO, VIDEO2]), 'out.mp4')
    assert.equal(compiled.duration, 8, 'the export must not end with the first row')
    const selection = selectExportTracks(project([VIDEO, VIDEO2]))
    assert.equal(selection.videoBase?.id, 'v1', 'the bottom row is still the one composited')
    assert.deepEqual(selection.extraVideoTracks.map(t => t.id), ['v2'], 'the uncomposited row is named')
  })

  // 5. The selector and the evaluator must not become two rules. Frame by
  // frame: every caption the evaluator marks visible has a window in the file,
  // and every window in the file is visible at that frame.
  await check('caption windows match the evaluator on every planned frame', () => {
    const p = project([
      VIDEO,
      CAPTIONS_A,
      CAPTIONS_B,
      { ...CAPTIONS_B, id: 't3', clips: [{ id: 'capC', text: 'C', start: 3, duration: 1 }] }
    ])
    const compiled = compileTimelineToFfmpeg(p, 'out.mp4')
    const windows = drawtextWindows(filterComplexOf(compiled))
    assert.equal(windows.length, 3, `three caption rows painted, got ${windows.length}`)
    const plan = createFrameScheduler(p)
    assert.ok(plan.frameCount > 0, 'the project schedules frames')
    for (const frame of plan.frames()) {
      const at = frame.startTicks
      const fromEvaluator = evaluateTimeline(p, at).layers
        .filter(layer => layer.kind === 'text' && layer.visible)
        .map(layer => layer.text?.content ?? '')
        .sort()
      const fromFile = windows
        .filter(([, start, end]) => at >= tk(start) && at < tk(end))
        .map(w => w[0])
        .sort()
      assert.deepEqual(fromFile, fromEvaluator, `frame ${frame.index} @ ${at} ticks`)
    }
  })

  // 6. Audio keeps its own rule: `hidden` is a picture decision, `muted` is
  // the sound one, so a hidden audio row must still mix (documented asymmetry).
  await check('a hidden audio row is not silenced by the picture rule', () => {
    const compiled = compileTimelineToFfmpeg(project([
      VIDEO,
      { id: 'a1', type: 'audio', hidden: true, clips: [{ id: 'music', src: 'music.wav', start: 0, duration: 4 }] }
    ]), 'out.mp4')
    assert.ok(compiled.args.join(' ').includes('music.wav'), 'audio is gated by muted, not hidden')
  })

  // 7. The selection is a pure read of the project, so two calls cannot
  // disagree — and it never disagrees with the evaluator about `hidden`.
  await check('the selection is deterministic and evaluator-shaped', () => {
    const p = project([VIDEO, { ...VIDEO2, hidden: true }, CAPTIONS_A, CAPTIONS_B])
    const first = selectExportTracks(p)
    const second = selectExportTracks(p)
    assert.deepEqual(
      { base: first.videoBase?.id, text: first.textTracks.map(t => t.id), extra: first.extraVideoTracks.map(t => t.id) },
      { base: second.videoBase?.id, text: second.textTracks.map(t => t.id), extra: second.extraVideoTracks.map(t => t.id) }
    )
    const flags = new Map(evaluateTimeline(p, 0).tracks.map(t => [t.id, t.hidden]))
    for (const track of first.textTracks) assert.equal(flags.get(track.id), false, `${track.id} is hidden in the evaluator`)
    assert.equal(flags.get(first.videoBase?.id ?? ''), false)
    assert.deepEqual(first.extraVideoTracks.map(t => t.id), [])
  })

  // 8. One caption, two clocks: the file's window and the evaluator's window
  // must be the SAME number. A span that does not divide evenly by the speed
  // (1 s at 1.1x = 109090.9 ticks) is where a float re-derivation and core's
  // rounded tick span part company, and the export used to re-derive it.
  await check('the caption window is the evaluator window, tick for tick', () => {
    const p = {
      version: 1,
      name: 'caption clock',
      canvas: { width: 320, height: 180, fps: 30 },
      timeline: {
        tracks: [
          { id: 'v1', type: 'video', name: 'v1', items: [clip({ id: 'a', src: 'a.mp4', start: 0, duration: 2 }, 'v1')] },
          { id: 't1', type: 'text', name: 't1', items: [{ id: 'capF', trackId: 't1', text: 'F', offset: 0, in: 0, out: tk(1), speed: 1.1 }] }
        ]
      }
    } as unknown as TmcutProject
    const layer = evaluateTimeline(p, 0).layers.find(l => l.kind === 'text')
    assert.ok(layer, 'the evaluator sees the caption')
    assert.equal(layer.endTicks, 109091, 'core rounds the span to whole ticks')
    const compiled = compileTimelineToFfmpeg(p, 'out.mp4')
    const [, start, end] = drawtextWindows(filterComplexOf(compiled))[0]
    assert.equal(start, 0)
    assert.equal(end, layer.endTicks / TICKS_PER_SECOND,
      'the drawtext window must be the evaluator window, not a re-derived float')
  })

  // 9. The modal warns about the row the export still cannot composite, reads
  // the same selector, and no longer claims caption rows are dropped.
  await check('the honest warning now names only the footage rows', () => {
    const modal = readFileSync(new URL('../../app/components/tmcut/TmcutExportModal.vue', import.meta.url), 'utf8')
    assert.match(modal, /selectExportTracks/, 'the modal must read the shared selector')
    assert.ok(!modal.includes('seenText'), 'the modal no longer hand-rolls the text half')
    assert.equal(selectExportTracks(project([VIDEO, VIDEO2, CAPTIONS_A, CAPTIONS_B])).extraVideoTracks.length, 1,
      'the warning has a fact to read')
    assert.equal(selectExportTracks(project([VIDEO, CAPTIONS_A, CAPTIONS_B])).extraVideoTracks.length, 0,
      'two caption rows alone no longer trip it')
    for (const locale of ['en', 'vi']) {
      const bundle = JSON.parse(readFileSync(new URL(`../../i18n/locales/${locale}.json`, import.meta.url), 'utf8')) as {
        tmcut?: { export?: { parallelTracksWarning?: string } }
      }
      const copy = bundle.tmcut?.export?.parallelTracksWarning ?? ''
      assert.ok(copy.length > 0, `${locale}.json lost the warning copy`)
      assert.ok(!/first track of each type|mỗi loại/i.test(copy), `${locale} still says captions are dropped`)
    }
  })

  console.log(`\n=== All ${passed} export track parity checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
