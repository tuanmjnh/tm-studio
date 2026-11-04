/**
 * One footage-row law, read by both hosts (V4 Phase 2, gap G18 — slice #93).
 *
 * The preview decides every frame which row owns the canvas. It used to do that
 * with its own loop over the store rows and their evaluations (`footageRow`,
 * app/composables/useTmcutPlayback.ts); the exporter made a different decision
 * once per file (`selectExportTracks`, app/utils/tmcut/render/clip.ts). Two
 * copies of a rule is how a project with more than one footage row ended up
 * painting one row on screen and another in the file.
 *
 * The rule now lives in `tmcut-core` (`paintStack.mjs`). What this spec owns,
 * on top of the core test:
 *  1. EQUIVALENCE — the retired preview loop is kept here verbatim as a
 *     reference and compared against core, layout by layout and tick by tick,
 *     so the rewiring is proven to have changed nothing observable.
 *  2. the preview carries no second copy of the rule and reads it off core —
 *     since Zero-FFmpeg F2a that reading is `compositePlan`, which is built on
 *     `selectPaintRows`; the composable never calls the row law beside the plan,
 *     because a second call is a second answer to keep in sync.
 *  3. the SHIPPED composable — which the store harness runs in plain Node —
 *     hands the canvas over exactly where core says it does.
 *  4. THE EXPORTER SIDE OF THE LAW — the exporter answers once per file where
 *     core answers per tick, and Zero-FFmpeg F3 proved the two are ONE rule
 *     seen two ways: `selectExportTracks` joins core's `selectFileRows`, and
 *     the rows it hands the compiler are the union of the rows the canvas
 *     paints, layout by layout — footage AND captions. What is left between the
 *     surfaces is no longer a row question but a layer question (per-layer
 *     crop, blend and vignette: F4).
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_paint_stack.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, compositePlan, evaluateTimeline, selectPaintRows } from 'tmcut-core'
import type { CoreEvaluatedLayer } from 'tmcut-core'
import { freshStore } from './helpers/tmcut_store_env'
import { selectExportTracks } from '../../app/utils/tmcut/render'
import type { TmcutProject, TmcutTimelineItem, TmcutTrack } from '../../app/composables/useTmcutProject'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PREVIEW_HOST = 'app/composables/useTmcutPlayback.ts'
const EXPORT_HOST = 'app/utils/tmcut/render/clip.ts'

let passed = 0

async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

function tk(sec: number): number {
  return Math.round(sec * TICKS_PER_SECOND)
}

type ClipSeed = { id: string, src?: string, start: number, duration: number, opacity?: number }
type TrackSeed = {
  id: string
  type: 'video' | 'text' | 'audio'
  hidden?: boolean
  clips: ClipSeed[]
}
/** What one host returns for a row: its authored items and its live layers. */
type PaintedRow = { items: TmcutTimelineItem[], layers: CoreEvaluatedLayer[] } | null

function clip(seed: ClipSeed, trackId: string) {
  return {
    id: seed.id,
    trackId,
    ...(seed.src ? { src: seed.src } : {}),
    ...(seed.opacity === undefined ? {} : { opacity: seed.opacity }),
    offset: tk(seed.start),
    in: 0,
    out: tk(seed.duration),
    speed: 1
  }
}

function project(tracks: TrackSeed[]): TmcutProject {
  return {
    version: 1,
    name: 'paint stack',
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

function storeTracks(sut: TmcutProject): TmcutTrack[] {
  return sut.timeline?.tracks ?? []
}

/**
 * The rule the preview shipped until slice #93 — kept here, unchanged, as the
 * reference the core answer is measured against. Not a second implementation:
 * nothing in `app/` calls it.
 */
function retiredPreviewRow(sut: TmcutProject, atTicks: number): PaintedRow {
  const tracks = storeTracks(sut)
  if (!tracks.length) return null
  const evaluation = evaluateTimeline(sut, atTicks)
  const videoTracks = tracks.filter(track => track.type === 'video')
  const videoEvaluations = evaluation.tracks.filter(track => track.type === 'video')
  for (let index = 0; index < videoTracks.length; index++) {
    const track = videoTracks[index]
    const trackEvaluation = videoEvaluations[index]
    if (!track?.items?.length || !trackEvaluation || trackEvaluation.hidden) continue
    if (!trackEvaluation.layers.length) continue
    return { items: track.items, layers: trackEvaluation.layers }
  }
  return null
}

/** Core's answer to the same question: the row that owns the single surface. */
function coreBaseRow(sut: TmcutProject, atTicks: number): PaintedRow {
  const base = selectPaintRows(evaluateTimeline(sut, atTicks)).base
  if (!base) return null
  return { items: storeTracks(sut)[base.trackIndex]?.items ?? [], layers: base.layers }
}

const ROW_A: TrackSeed = { id: 'v1', type: 'video', clips: [{ id: 'a', src: 'a.mp4', start: 0, duration: 4 }] }
const ROW_A_LONG: TrackSeed = { id: 'v1', type: 'video', clips: [{ id: 'a', src: 'a.mp4', start: 0, duration: 8 }] }
const ROW_B_LATE: TrackSeed = { id: 'v2', type: 'video', clips: [{ id: 'b', src: 'b.mp4', start: 6, duration: 4 }] }
const ROW_B_OVERLAP: TrackSeed = { id: 'v2', type: 'video', clips: [{ id: 'b', src: 'b.mp4', start: 3, duration: 8 }] }
const ROW_EMPTY: TrackSeed = { id: 'v0', type: 'video', clips: [] }
const ROW_ZERO: TrackSeed = { id: 'vz', type: 'video', clips: [{ id: 'z', src: 'z.mp4', start: 0, duration: 0 }] }
const ROW_FADED: TrackSeed = { id: 'vf', type: 'video', clips: [{ id: 'f', src: 'f.mp4', start: 0, duration: 4, opacity: 0 }] }
const CAPTIONS: TrackSeed = { id: 't1', type: 'text', clips: [{ id: 'cap', start: 1, duration: 2 }] }
const MUSIC: TrackSeed = { id: 'a1', type: 'audio', clips: [{ id: 'm', src: 'm.mp3', start: 0, duration: 9 }] }

const LAYOUTS: TrackSeed[][] = [
  [ROW_A],
  [ROW_A, ROW_B_LATE],
  [ROW_A, ROW_B_OVERLAP],
  [ROW_B_OVERLAP, ROW_A],
  [{ ...ROW_A, hidden: true }, ROW_B_OVERLAP],
  [ROW_EMPTY, ROW_A],
  [ROW_ZERO, ROW_A],
  [ROW_FADED, ROW_B_OVERLAP],
  [CAPTIONS, ROW_A, MUSIC, ROW_B_OVERLAP],
  [MUSIC, CAPTIONS],
  [{ ...CAPTIONS, hidden: true }, ROW_A],
  [{ ...ROW_A, hidden: true }, { ...ROW_B_OVERLAP, hidden: true }]
]

const PROBE_TICKS = [-1, 0, 1, tk(1), tk(3), tk(4), tk(5), tk(6), tk(7), tk(10), tk(30)]

function rowIds(row: PaintedRow): string {
  return row ? row.items.map(item => item.id).join('+') : 'null'
}

async function main() {
  // 1. The equivalence proof, over every layout and tick this slice can name.
  await check('core answers exactly what the retired preview loop answered', () => {
    let compared = 0
    let nonNull = 0
    for (const layout of LAYOUTS) {
      const sut = project(layout)
      const layoutName = layout.map(t => `${t.id}${t.hidden ? '!' : ''}`).join(',')
      for (const at of PROBE_TICKS) {
        const before = retiredPreviewRow(sut, at)
        const after = coreBaseRow(sut, at)
        compared++
        if (before) nonNull++
        assert.deepEqual(
          after,
          before,
          `row changed for [${layoutName}] at ${at} ticks: before ${rowIds(before)}, after ${rowIds(after)}`
        )
      }
    }
    assert.equal(compared, LAYOUTS.length * PROBE_TICKS.length, 'every layout and tick compared')
    assert.ok(nonNull >= 40, `the sweep must cover live rows, got ${nonNull}`)
  })

  // 2. No second copy of the rule in the app. F2a moved the preview behind
  //    `compositePlan`, so the row law is reached through the plan — and must
  //    not be called beside it, which would be a second answer to keep in sync.
  await check('the preview reaches the row through the plan, not its own loop', () => {
    const source = readFileSync(join(ROOT, PREVIEW_HOST), 'utf8')
    assert.match(source, /compositePlan/, 'the preview asks core for the plan')
    assert.doesNotMatch(source, /selectPaintRows/,
      'the row law is cores, reached once through the plan')
    assert.ok(!source.includes('videoEvaluations'), 'no second copy of the pairing loop in the preview')
    assert.match(source, /tracks\[slot\.trackIndex\]/, 'the row joins back by the core index')
  })

  // 3. The composable that ships is the one measured here (the store harness
  //    runs it in plain Node), so the hand-off is proven on the shipped path,
  //    not only on the reproduction above.
  await check('the shipped preview hands the canvas over exactly where core does', async () => {
    const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'gap-top.mp4', in: 0, out: tk(4), offset: 0 })
    s.addTrackToProject('video')
    const videoRows = storeTracks(s.currentProject.value!).filter(t => t.type === 'video')
    const bottom = videoRows[1]!
    s.addClipToTrack('video', { src: 'gap-bottom.mp4', in: 0, out: tk(8), offset: tk(3) }, bottom.id)
    const project = s.currentProject.value!
    const p = useTmcutPlayback()
    const painted = () => p.activeVideoClip.value?.clip?.src ?? null
    p.seek(1)
    assert.equal(painted(), 'gap-top.mp4', 'the top row owns the canvas while it has a layer')
    p.seek(5)
    assert.equal(painted(), 'gap-bottom.mp4', 'the row that has a layer there takes over')
    assert.equal(
      selectPaintRows(evaluateTimeline(project, tk(5))).base?.trackId,
      bottom.id,
      'and core names the same row for the same tick'
    )
  })

  // 4. The one rule seen two ways: core's per-tick `rows` and the exporter's
  //    per-file stack must name the same rows in the same order. What is left
  //    over — the canvas holding only `base` — is the deliberate divergence,
  //    and `tests/unit/tmcut_export_paint_stack.spec.ts` proves the file side
  //    of it pixel by pixel.
  await check('the exporter stacks exactly the rows core names, in core order', () => {
    const sut = project([ROW_A_LONG, ROW_B_OVERLAP])
    const stack = selectPaintRows(evaluateTimeline(sut, tk(5)))
    assert.deepEqual(stack.rows.map(r => r.trackId), ['v1', 'v2'], 'both rows are live at 5 s')
    assert.equal(stack.base?.trackId, 'v1', 'and the canvas is held by the bottom one')

    const selection = selectExportTracks(sut)
    assert.equal(selection.videoBase?.id, 'v1', 'the file builds from that same bottom row')
    assert.deepEqual(
      [selection.videoBase?.id, ...selection.extraVideoTracks.map(t => t.id)].filter(id => id),
      stack.rows.map(r => r.trackId),
      'file stack == the core paint order'
    )
  })

  // 5. Where the two rules can agree today, they must: hidden rows.
  await check('a hidden row is dropped by core and by the exporter alike', () => {
    const visible = project([ROW_A_LONG, ROW_B_OVERLAP])
    const hidden = project([{ ...ROW_A_LONG, hidden: true }, ROW_B_OVERLAP])
    assert.equal(selectPaintRows(evaluateTimeline(visible, tk(5))).base?.trackId, 'v1')
    assert.equal(selectPaintRows(evaluateTimeline(hidden, tk(5))).base?.trackId, 'v2')
    assert.equal(selectExportTracks(hidden).videoBase?.id, 'v2')
  })

  // 6. The rows above `base` stay identifiable for whoever composites them:
  //    core names each one with its own index, its own layers and its own
  //    window — which is what the file stack leg (#95) and the canvas stack leg
  //    (F2b) both build on.
  await check('the rows above the base stay identifiable for the compositor', () => {
    const sut = project([ROW_A, ROW_B_OVERLAP, MUSIC])
    const stack = selectPaintRows(evaluateTimeline(sut, tk(3)))
    assert.deepEqual(stack.rows.map(r => r.trackId), ['v1', 'v2'])
    assert.equal(stack.rows[1].trackIndex, 1, 'the stacked row keeps its own index')
    assert.deepEqual(stack.rows[1].layers.map(l => l.clipId), ['b'])
    assert.ok(
      selectExportTracks(sut).audioTracks.some(t => t.id === 'a1'),
      'audio rows stay out of the paint stack'
    )
    assert.equal(stack.rows.some(r => r.trackId === 'a1'), false)
  })

  // 7. F3: the export side of the law is not a second rule. For every layout,
  //    the footage rows the exporter hands the compiler are exactly the rows
  //    the canvas names at SOME tick, in track order — which is where the two
  //    copies used to part company: the app asked whether a clip carried media,
  //    core asks whether a clip can be live at all.
  await check('the file stack is the union of the canvas stack', () => {
    for (const layout of LAYOUTS) {
      const sut = project(layout)
      const name = layout.map(t => `${t.id}${t.hidden ? '!' : ''}`).join(',')
      const live = new Set<number>()
      for (const at of PROBE_TICKS) {
        for (const row of selectPaintRows(evaluateTimeline(sut, at)).rows) live.add(row.trackIndex)
      }
      const expected = storeTracks(sut)
        .map((track, index) => (live.has(index) ? track.id : null))
        .filter((id): id is string => id !== null)
      const selection = selectExportTracks(sut)
      const fileRows = [selection.videoBase?.id, ...selection.extraVideoTracks.map(t => t.id)]
        .filter((id): id is string => id !== null && id !== undefined)
      assert.deepEqual(fileRows, expected, `footage rows of the file [${name}]`)
    }
  })

  // 8. Same proof for the caption lane, read off the plan the preview paints:
  //    a row the screen overlays at some tick is in the file, and a row it
  //    hides never is.
  await check('the file captions are the union of the overlay rows', () => {
    for (const layout of LAYOUTS) {
      const sut = project(layout)
      const name = layout.map(t => `${t.id}${t.hidden ? '!' : ''}`).join(',')
      const live = new Set<number>()
      for (const at of PROBE_TICKS) {
        for (const slot of compositePlan(evaluateTimeline(sut, at)).slots) {
          if (slot.kind === 'overlay') live.add(slot.trackIndex)
        }
      }
      const expected = storeTracks(sut)
        .map((track, index) => (live.has(index) ? track.id : null))
        .filter((id): id is string => id !== null)
      assert.deepEqual(selectExportTracks(sut).textTracks.map(t => t.id), expected, `caption rows of the file [${name}]`)
    }
  })

  // 9. Neither host may keep a copy of the row rule. Check 2 pins the preview
  //    (it reaches the rows only through the plan); this pins the exporter: it
  //    joins core's answer, so the `[0]` that chose the bottom of the stack and
  //    the `slice(1)` that chose the rows above it are gone from the app.
  await check('the exporter joins core rows instead of filtering tracks', () => {
    const source = readFileSync(join(ROOT, EXPORT_HOST), 'utf8')
    assert.match(source, /selectFileRows/, 'the exporter asks core which rows the file has')
    assert.doesNotMatch(source, /\.filter\([^)]*\.type ===/, 'no row filter survives in the app')
    assert.doesNotMatch(source, /videoRows\[0\]|\.slice\(1\)/, 'and no bottom-of-stack arithmetic')
  })

  console.log(`=== All ${passed} paint-stack checks passed ===`)
}

main().catch((error) => {
  console.error('FAILED:', error)
  process.exit(1)
})
