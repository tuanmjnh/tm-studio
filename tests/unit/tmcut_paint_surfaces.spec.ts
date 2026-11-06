/**
 * The surface law is one answer, read by two callers (Zero-FFmpeg H3d-2d).
 *
 * "Which layer paints at this tick, in what order, and what is its media time"
 * is core's (`compositePlan`). What the app still had to answer was how a core
 * slot joins back to an authored clip and which surface carries the audio — and
 * that answer lived **inside a Vue computed welded to the playhead**. So the
 * exporter could not read it: it paints at a frame index, not at the playhead.
 * A modal that re-implemented the mapping to get around that would be a second
 * answer to what the file looks like, which is the drift class §53 exists to
 * close (and the reason `webCodecsExport.ts` takes `surfaces` as a port at all).
 *
 * The law now lives in `app/utils/tmcut/paintSurfaces.ts`, plain and reactive-
 * free, and this file holds it to three things:
 *  - it is the ONLY place in `app/` that asks core for the composite plan;
 *  - the shipped preview and the law answer the same thing at the same tick;
 *  - the export glue, fed by the law, decodes exactly the plate the preview
 *    shows at the frame it was asked to paint — same file, same media time.
 *
 * The two guards that used to point at the composable for the first claim
 * (`tmcut_paint_stack.spec.ts` check 2, `tmcut_preview_paint_plan.spec.ts`
 * check 6) moved with the law rather than being weakened; their assertions are
 * re-pointed at the new file here, at the same strength.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_paint_surfaces.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { createFrameScheduler, compositePlan, evaluateTimeline, ticksToSec } from 'tmcut-core'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const tk = (sec: number) => Math.round(sec * TICKS)

const LAW = 'app/utils/tmcut/paintSurfaces.ts'
const COMPOSABLE = 'app/composables/useTmcutPlayback.ts'

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** The source with comment lines dropped, so a prose word is never code evidence. */
function codeOnly(source: string): string {
  return source
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

/** Every .ts/.vue file under app/, so "exactly one caller" is a real census. */
function appFiles(dir: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`
    const abs = join(root, rel)
    if (statSync(abs).isDirectory()) {
      found.push(...appFiles(rel))
    } else if (rel.endsWith('.ts') || rel.endsWith('.vue')) {
      found.push(rel)
    }
  }
  return found
}

/** A footage clip in the authored shape the evaluator reads. */
function clip(id: string, at = 0, forSeconds = 4, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type: 'video',
    src: `C:/media/${id}.mp4`,
    source: { in: 0, out: tk(forSeconds) },
    timeline: { start: tk(at), duration: tk(forSeconds) },
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    effects: [],
    keyframes: [],
    ...overrides
  }
}

/** One project, `rows` clips per footage row; text rows are their own kind. */
function projectOf(rows: Array<Array<Record<string, unknown>>>, canvas?: Record<string, unknown>) {
  return {
    version: 3,
    canvas: canvas ?? {
      width: 640,
      height: 360,
      fps: { numerator: 30, denominator: 1 },
      background: { type: 'color', value: '#101820' }
    },
    markers: [],
    tracks: rows.map((items, index) => ({
      id: `row-${index}`,
      type: items[0]?.type === 'text' ? 'text' : 'video',
      items
    }))
  }
}

const FPS = Object.freeze({ numerator: 30, denominator: 1 })

async function main() {
  console.log('=== [TMCut paint surfaces] Starting ===\n')
  const law = await import('../../app/utils/tmcut/paintSurfaces')
  const { surfacesAt } = law

  // 1. The law is its own module, and it is not a component in disguise: a
  //    reactive or DOM dependency would put the exporter's answer behind a
  //    component instance, which is the thing this increment removes.
  await check('the surface law is its own module and holds no reactive or platform code', () => {
    const source = codeOnly(read(LAW))
    assert.doesNotMatch(source, /from 'vue'/, 'no Vue: the export has no component instance')
    assert.doesNotMatch(source, /\bcomputed\(/, 'no computed: the caller owns the cache')
    assert.doesNotMatch(source, /\bref\(/, 'no ref: same reason')
    assert.doesNotMatch(source, /\b(document|window|localStorage)\b/, 'no DOM global')
    assert.match(source, /import \{[^}]*compositePlan[^}]*\} from 'tmcut-core'/,
      'the plan comes from core, not a local helper')
  })

  // 2. One census, not one grep. This is the claim §53.6 could not make: the
  //    app asked core for the plan in the composable and would have had to ask
  //    again in the modal.
  await check('the app asks core for the composite plan in exactly one file', () => {
    const callers = appFiles('app').filter(rel => /compositePlan\(/.test(codeOnly(read(rel))))
    assert.deepEqual(callers, [LAW],
      `expected only ${LAW} to call the plan, got ${callers.join(', ') || 'nothing'}`)
  })

  // 3. The composable now asks the law. Its own mapping is gone — the two
  //    literals below are exactly what used to sit in it.
  await check('the preview composable asks the law and keeps no slot mapping', () => {
    const source = read(COMPOSABLE)
    assert.match(source, /surfacesAt\(/, 'the surface answer comes from the law')
    assert.doesNotMatch(source, /ownsAudio = slot\.role === 'paint'/,
      'the audio-owner rule is the law\'s, not a second copy')
    assert.doesNotMatch(source, /crossfades = true/, 'pair detection is the law\'s too')
    assert.doesNotMatch(source, /for \(const slot of paintPlan/, 'no local slot loop left behind')
  })

  // 4-9 are the law's own behaviour, on projects the store built.
  await check('two live rows answer two surfaces, bottom of the stack first', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0 })
    s.addTrackToProject('video')
    const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
    s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0 }, rows[1]!.id)
    const project = s.currentProject.value!
    const answer = surfacesAt(project.timeline.tracks, evaluateTimeline(project, tk(1)))
    assert.deepEqual(answer.footage.map(item => `${item.clip.src}:${item.role}`),
      ['top.mp4:paint', 'bottom.mp4:paint'],
      'core lists rows in track order; the law must not trim or reorder that')
    const owners = answer.footage.filter(item => item.ownsAudio)
    assert.equal(owners.length, 1, 'one surface carries the sound of the file')
    assert.equal(owners[0]!.clip.src, 'top.mp4', 'the bottom row, which is what an export decodes')
    assert.equal(owners[0]!.crossfades, false, 'a plain cut has no ramp on it')
  })

  await check('a row the plan does not carry is not in the answer', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'gap-top.mp4', in: 0, out: tk(4), offset: 0 })
    s.addTrackToProject('video')
    const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
    s.addClipToTrack('video', { src: 'gap-bottom.mp4', in: 0, out: tk(8), offset: tk(3) }, rows[1]!.id)
    const project = s.currentProject.value!
    const srcs = (at: number) => surfacesAt(project.timeline.tracks, evaluateTimeline(project, at))
      .footage.map(item => item.clip.src)
    assert.deepEqual(srcs(tk(1)), ['gap-top.mp4'])
    assert.deepEqual(srcs(tk(5)), ['gap-bottom.mp4'], 'the row that has a layer there answers alone')
    const { top } = { top: rows[0] }
    s.toggleTrackHidden(top!.id)
    assert.deepEqual(srcs(tk(1)), [], 'hidden is hidden, exactly as it is hidden from the file')
  })

  await check('a transition window is two surfaces of one row, outgoing beneath paint', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const row = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) }, row.id)
    const joint = row.items!.find(item => item.src === 'b.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
    const project = s.currentProject.value!
    // The overlap covers [3.5, 4); probe inside it.
    const answer = surfacesAt(project.timeline.tracks, evaluateTimeline(project, tk(3.75)))
    assert.deepEqual(answer.footage.map(item => `${item.clip.src}:${item.role}`),
      ['a.mp4:outgoing', 'b.mp4:paint'])
    assert.deepEqual(answer.footage.map(item => item.crossfades), [true, true],
      'a crossfade exists only when BOTH layers are on screen')
    assert.deepEqual(answer.footage.filter(item => item.ownsAudio).map(item => item.clip.src),
      ['b.mp4'], 'sound follows the incoming picture, as the player already documents')
    assert.equal(answer.footage[0]!.ownsAudio, false, 'the outgoing surface is muted')
    assert.equal(answer.footage[0]!.trackIndex, answer.footage[1]!.trackIndex,
      'the pair belongs to one row, which is what makes it a pair')
    assert.deepEqual(answer.footage.map(item => item.key),
      answer.footage.map(item => `${item.trackId}:${item.clip.id}:${item.role}`),
      'the DOM key is the row, the clip and the role — unique per surface by construction')
  })

  await check('a live layer with no source position contributes nothing', () => {
    // The DSL shape that is live to `clipSpan` but has nothing for
    // `sourceRangeOf`: no `source`, no numeric `in`. Core answers `null`, and a
    // second app-side fallback (`clip.in + local * speed`) is how this project
    // once parked an element on NaN and re-seeked it every frame.
    const bare = clip('live', 0, 4)
    delete bare.source
    const project = projectOf([[bare]])
    const evaluation = evaluateTimeline(project, tk(1))
    const plan = compositePlan(evaluation)
    assert.ok(plan.slots.length > 0, 'the plan does carry the live row')
    assert.equal(plan.slots[0]!.layer.sourceTicks, null, 'and core answers no position for it')
    const answer = surfacesAt(project.tracks, evaluation)
    assert.deepEqual(answer.footage, [], 'so the law hands no surface: no position means no picture')
  })

  await check('a surface carries core\'s layer by reference and joins back by core\'s index', () => {
    const project = projectOf([[clip('a', 0, 4)], [clip('b', 0, 4, { type: 'video' })]])
    const evaluation = evaluateTimeline(project, tk(1))
    const plan = compositePlan(evaluation)
    const answer = surfacesAt(project.tracks, evaluation)
    assert.deepEqual(answer.footage.map(item => item.layer),
      plan.slots.filter(slot => slot.kind === 'footage').map(slot => slot.layer),
      'the numbers the painter uses are the evaluator\'s objects, not re-read clips')
    assert.equal(answer.footage[0]!.layer, plan.slots[0]!.layer, 'by reference, not by copy')
    for (const surface of answer.footage) {
      assert.equal(evaluation.tracks[surface.trackIndex]?.id, surface.trackId,
        'trackIndex is the row core named, so joining back is one lookup')
      assert.equal(surface.mediaTimeSec, ticksToSec(Number(surface.layer.sourceTicks)),
        'media time is core\'s source ticks, the only source it has')
    }
  })

  await check('overlays answer as text surfaces, after the footage and by reference', () => {
    const project = projectOf([[clip('a', 0, 4)], [{
      id: 'cap-1',
      type: 'text',
      text: 'ONE',
      source: { in: 0, out: tk(4) },
      timeline: { start: 0, duration: tk(4) }
    }]])
    // The second row must be a text row for the classifier to see an overlay.
    project.tracks[1]!.type = 'text'
    const evaluation = evaluateTimeline(project, tk(1))
    const plan = compositePlan(evaluation)
    const answer = surfacesAt(project.tracks, evaluation)
    assert.deepEqual(answer.footage.map(item => item.clip.id), ['a'])
    assert.deepEqual(answer.text.map(item => item.clip.id), ['cap-1'],
      'the text answer is its own list, in the plan\'s order')
    const overlay = plan.slots.find(slot => slot.kind === 'overlay')!
    assert.equal(answer.text[0]!.layer, overlay.layer,
      'a caption paints core\'s numbers, not its own keyframe reading')
  })

  await check('no tracks means no surfaces, and nothing throws', () => {
    const project = projectOf([[clip('a', 0, 4)]])
    const evaluation = evaluateTimeline(project, tk(1))
    assert.deepEqual(surfacesAt(undefined, evaluation), { footage: [], text: [] })
    assert.deepEqual(surfacesAt([], evaluation), { footage: [], text: [] })
    assert.ok(surfacesAt(project.tracks, evaluation).footage.length === 1,
      'the same call on a real project still answers')
  })

  // 10. The claim this increment exists for, measured against the shipped
  //     composable rather than a reproduction of it.
  await check('the preview and the law answer the same thing at the same tick', async () => {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'a.mp4', in: 0, out: tk(4), offset: 0 })
    const row = s.currentProject.value!.timeline.tracks.find(t => t.type === 'video')!
    s.addClipToTrack('video', { src: 'b.mp4', in: 0, out: tk(4), offset: tk(4) }, row.id)
    const joint = row.items!.find(item => item.src === 'b.mp4')!
    const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
    if (!applied.ok) throw new Error(`transition refused: ${applied.reason}`)
    const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')
    const p = useTmcutPlayback()
    const project = s.currentProject.value!
    for (const at of [tk(1), tk(3.75), tk(5)]) {
      p.seek(at / TICKS)
      const fromLaw = surfacesAt(project.timeline.tracks, evaluateTimeline(project, at)).footage
      assert.deepEqual(p.paintSurfaces.value.map(surface => `${surface.clip.src}:${surface.role}`),
        fromLaw.map(surface => `${surface.clip.src}:${surface.role}`),
        `the playhead at ${at} ticks: the DOM and the law must not diverge`)
      assert.deepEqual(p.paintSurfaces.value.map(surface => surface.mediaTimeSec),
        fromLaw.map(surface => surface.mediaTimeSec),
        `and the same media time, so a seek and an export frame ask the decoder for one thing`)
      // The pair the player binds to is read off that same answer: a tick with
      // no crossfading surface must leave it null, and the window must fill it.
      assert.equal(p.transitionCrossfade.value !== null,
        fromLaw.some(surface => surface.crossfades),
        `the crossfade pair agrees with the law at ${at} ticks`)
    }
  })

  // 11. The other caller. The glue is real, the law is real, and only the
  //     browser IO is faked — so what the file decodes is proven to be what the
  //     preview shows, not what a fake surface list said.
  await check('the export decodes the plate the preview shows at the frame it was asked for', async () => {
    const project = projectOf([[clip('a', 0, 3)]])
    const plateAsks: Array<Record<string, unknown>> = []
    const glue = await import('../../app/utils/tmcut/webCodecsExport')
    const exporter = glue.createWebCodecsExport({
      readPlate: (ask: Record<string, unknown>) => {
        plateAsks.push(ask)
        return Promise.resolve({ width: 640, height: 360, image: { marker: 'plate' } })
      },
      createCanvas: () => ({
        element: { marker: 'canvas' },
        begin() {},
        draw() {},
        dispose() {}
      }),
      surfaces: (evaluation: { at?: number }) => surfacesAt(project.tracks, evaluation as never).footage,
      capability: {
        decide: () => Promise.resolve({
          kind: 'ready',
          container: 'mp4',
          errors: [],
          config: { id: 'avc1-640', video: { codec: 'avc1.42001f', width: 640, height: 360, fps: FPS } }
        })
      },
      session: (ask: Record<string, unknown>) => ({
        async run() {
          for (const index of [0, 15, 29]) {
            await (ask.paint as (i: number) => unknown)(index)
          }
          return { videoPackets: 3, audioPackets: 0, progress: 1, output: { marker: 'blob' } }
        },
        async cancel() {}
      })
    })
    const result = await exporter.run({ project })
    assert.equal(result.kind, 'exported', `the export ran: ${JSON.stringify(result.message)}`)

    const scheduler = createFrameScheduler(project as never, { rate: FPS })
    const expected: Array<{ src: string | null, atSec: number }> = []
    for (const index of [0, 15, 29]) {
      const frame = scheduler.frameAt(index)!
      // Independent of the law: a clip authored at 0, speed 1, source in 0, so
      // the media position at the frame's start tick IS that tick in seconds.
      expected.push({ src: 'C:/media/a.mp4', atSec: ticksToSec(frame.startTicks) })
    }
    assert.deepEqual(plateAsks.map(ask => ({ src: ask.src, atSec: ask.atSec })), expected,
      'one decode per painted surface, at the position the preview puts the playhead')
  })

  console.log(`\n=== All ${passed} paint-surface law checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
