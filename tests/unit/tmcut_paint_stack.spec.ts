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
 *  2. the preview carries no second copy of the rule and reads it off core.
 *  3. the SHIPPED composable — which the store harness runs in plain Node —
 *     hands the canvas over exactly where core says it does.
 *  4. the exporter's remaining divergence is PINNED: `videoBase` is still the
 *     first visible row for the whole file, while core answers per tick. When
 *     the compositor consumes `rows`, this check must be updated to expect the
 *     stack — it is not allowed to drift unnoticed.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_paint_stack.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS_PER_SECOND, evaluateTimeline, selectPaintRows } from 'tmcut-core'
import type { CoreEvaluatedLayer } from 'tmcut-core'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { selectExportTracks } from '../../app/utils/tmcut/render'
import type { TmcutProject, TmcutTimelineItem, TmcutTrack } from '../../app/composables/useTmcutProject'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PREVIEW_HOST = 'app/composables/useTmcutPlayback.ts'

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

/** What the rewired preview composes: core's row joined back to the store. */
function currentPreviewRow(sut: TmcutProject, atTicks: number): PaintedRow {
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
  [{ ...ROW_A, hidden: true }, { ...ROW_B_OVERLAP, hidden: true }]
]

const TICKS = [-1, 0, 1, tk(1), tk(3), tk(4), tk(5), tk(6), tk(7), tk(10), tk(30)]

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
      for (const at of TICKS) {
        const before = retiredPreviewRow(sut, at)
        const after = currentPreviewRow(sut, at)
        compared++
        if (before) nonNull++
        assert.deepEqual(
          after,
          before,
          `row changed for [${layoutName}] at ${at} ticks: before ${rowIds(before)}, after ${rowIds(after)}`
        )
      }
    }
    assert.equal(compared, LAYOUTS.length * TICKS.length, 'every layout and tick compared')
    assert.ok(nonNull >= 40, `the sweep must cover live rows, got ${nonNull}`)
  })

  // 2. No second copy of the rule in the app.
  await check('the preview reads the row from core and keeps no local loop', () => {
    const source = readFileSync(join(ROOT, PREVIEW_HOST), 'utf8')
    assert.match(source, /selectPaintRows/, 'the preview asks core')
    assert.match(
      source,
      /import \{[^}]*selectPaintRows[^}]*\} from 'tmcut-core'/,
      'the name comes from tmcut-core, not a local helper'
    )
    assert.ok(!source.includes('videoEvaluations'), 'no second copy of the pairing loop in the preview')
    assert.match(source, /tracks\?\.\[base\.trackIndex\]/, 'the row joins back by the core index')
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

  // 4. Core answers per tick; the exporter still answers once per file. This is
  //    G18 as it stands today, pinned so the compositor slice changes it on
  //    purpose and not by accident.
  await check('the exporter divergence is recorded, not silently accepted', () => {
    const sut = project([ROW_A, ROW_B_OVERLAP])
    const stack = selectPaintRows(evaluateTimeline(sut, tk(5)))
    assert.equal(stack.base?.trackId, 'v2', 'the screen paints the row that has a layer here')
    assert.deepEqual(stack.rows.map(r => r.trackId), ['v2'], 'and only one row owns the canvas')

    const selection = selectExportTracks(sut)
    assert.equal(selection.videoBase?.id, 'v1', 'the file is still built from the first row')
    assert.deepEqual(selection.extraVideoTracks.map(t => t.id), ['v2'])
  })

  // 5. Where the two rules can agree today, they must: hidden rows.
  await check('a hidden row is dropped by core and by the exporter alike', () => {
    const visible = project([ROW_A_LONG, ROW_B_OVERLAP])
    const hidden = project([{ ...ROW_A_LONG, hidden: true }, ROW_B_OVERLAP])
    assert.equal(selectPaintRows(evaluateTimeline(visible, tk(5))).base?.trackId, 'v1')
    assert.equal(selectPaintRows(evaluateTimeline(hidden, tk(5))).base?.trackId, 'v2')
    assert.equal(selectExportTracks(hidden).videoBase?.id, 'v2')
  })

  // 6. The rows after `base` are the footage the single-row law drops — the
  //    exporter keeps them for the timeline extent, and must not decode them.
  await check('dropped rows stay identifiable for the compositor', () => {
    const sut = project([ROW_A, ROW_B_OVERLAP, MUSIC])
    const stack = selectPaintRows(evaluateTimeline(sut, tk(3)))
    assert.deepEqual(stack.rows.map(r => r.trackId), ['v1', 'v2'])
    assert.equal(stack.rows[1].trackIndex, 1, 'the dropped row keeps its own index')
    assert.deepEqual(stack.rows[1].layers.map(l => l.clipId), ['b'])
    assert.ok(
      selectExportTracks(sut).audioTracks.some(t => t.id === 'a1'),
      'audio rows stay out of the paint stack'
    )
    assert.equal(stack.rows.some(r => r.trackId === 'a1'), false)
  })

  console.log(`=== All ${passed} paint-stack checks passed ===`)
}

main().catch((error) => {
  console.error('FAILED:', error)
  process.exit(1)
})
