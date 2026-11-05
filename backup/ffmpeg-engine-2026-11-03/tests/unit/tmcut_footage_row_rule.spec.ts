/**
 * The footage-row rule (roadmap V4 Phase 2 item 5, second leg; gap G18).
 *
 * Slice #87 made the EXPORT ask the timeline which footage row it may paint:
 * the first visible video row with content. The PREVIEW kept its own copy of
 * that answer — and its crossfade leg still read `.find(type === 'video')`,
 * i.e. row 0 whatever the user had hidden there. Two questions with two
 * answers is exactly the bug class #87 closed, so these checks drive the real
 * composable and the real compiler over the real store and require one row.
 *
 * They also pin the one place the two surfaces still differ: the export stacks
 * every visible footage row (slice #95), while the preview carries a single
 * `<video>` element and therefore shows only the row that owns the canvas. The
 * export banner has to say that, and not promise a picture either way.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_footage_row_rule.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { selectExportTracks } from '../../app/utils/tmcut/render/clip'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/compiler'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const tk = (sec: number) => Math.round(sec * TICKS)

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Every `-i` argument of the emitted command line: the footage the file decodes. */
function decodedSrcs(args: string[]): string[] {
  const out: string[] = []
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '-i') out.push(String(args[index + 1]))
  }
  return out
}

async function main() {
  console.log('=== [TMCut footage row rule] Starting ===\n')
  const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')

  /**
   * Two footage rows, one clip each (top.mp4 / bottom.mp4, 0-4 s). `pairRow`
   * additionally gives that row a second clip with a 0.5 s fade at the joint,
   * so the row owns an open transition window over [3.5, 4).
   */
  async function twoRows(pairRow: 'top' | 'bottom' | 'none' = 'none') {
    const s = await freshStore()
    s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0 })
    s.addTrackToProject('video')
    const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
    const top = rows[0]!
    const bottom = rows[1]!
    s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0 }, bottom.id)
    if (pairRow !== 'none') {
      const row = pairRow === 'top' ? top : bottom
      s.addClipToTrack('video', { src: 'joint.mp4', in: 0, out: tk(4), offset: tk(4) }, row.id)
      const joint = row.items!.find(item => item.src === 'joint.mp4')!
      const applied = s.applyClipTransition(joint.id, 'fade', 0.5)
      if (!applied.ok) throw new Error(`transition refused on the ${pairRow} row: ${applied.reason}`)
    }
    return { s, top, bottom }
  }

  const painted = (p: ReturnType<typeof useTmcutPlayback>) => p.activeVideoClip.value?.clip?.src ?? null

  // 1. One row, two surfaces: the row the preview paints is the BASE of the
  // stack, and the file decodes the rows above it as well — overlaid, not
  // concatenated after it.
  await check('the screen and the file take the same footage row', async () => {
    const { s, top } = await twoRows()
    const project = s.currentProject.value!
    const p = useTmcutPlayback()
    p.seek(1)
    assert.equal(selectExportTracks(project).videoBase?.id, top.id, 'the base row is the top visible row')
    assert.equal(painted(p), 'top.mp4', 'the canvas shows that row')
    const compiled = compileTimelineToFfmpeg(project, 'out.mp4')
    const srcs = decodedSrcs(compiled.args)
    assert.ok(srcs.some(src => src.includes('top.mp4')), `the file decodes the base row, got ${srcs}`)
    assert.ok(srcs.some(src => src.includes('bottom.mp4')),
      `the row above the base is stacked into the file, got ${srcs}`)
    const graph = compiled.args[compiled.args.indexOf('-filter_complex') + 1]!
    assert.match(graph, /overlay=enable='gte\(t,0\)\*lt\(t,4\)'/,
      'and it is overlaid on its own window, not concatenated after the base')
  })

  // 2. Hiding the top row moves BOTH answers down one row — hidden is hidden
  // in the file (slice #87), so the canvas may not be the exception.
  await check('hiding the top row hands the screen and the file to the row below', async () => {
    const { s, top, bottom } = await twoRows()
    s.toggleTrackHidden(top.id)
    const project = s.currentProject.value!
    const p = useTmcutPlayback()
    p.seek(1)
    assert.equal(selectExportTracks(project).videoBase?.id, bottom.id, 'the export follows the hide')
    assert.equal(painted(p), 'bottom.mp4', 'the preview follows the hide')
    const srcs = decodedSrcs(compileTimelineToFfmpeg(project, 'out.mp4').args)
    assert.ok(srcs.some(src => src.includes('bottom.mp4')) && !srcs.some(src => src.includes('top.mp4')),
      `the hidden row leaves the command line, got ${srcs}`)
  })

  // 3. The crossfade leg used to ask its own question with `.find()`: it read
  // row 0 however the user had hidden it, so the row that owns the canvas
  // could not crossfade at all while an invisible row drove the second
  // <video> element.
  await check('a transition on the row that paints still crossfades under a hidden row', async () => {
    const { s, top } = await twoRows('bottom')
    s.toggleTrackHidden(top.id)
    const p = useTmcutPlayback()
    p.seek(3.75)
    const cf = p.transitionCrossfade.value
    assert.ok(cf, 'the visible row has an open window at 3.75 s — the preview must see it')
    assert.equal(cf!.outgoing.src, 'bottom.mp4', 'both clips come from the row that paints')
    assert.equal(cf!.incoming.src, 'joint.mp4', 'both clips come from the row that paints')
  })

  // 4. And the mirror: a hidden row's window must not reach the canvas. The
  // outgoing element is a real <video> in the tree, so hidden footage can
  // show through wherever the main element is letterboxed or absent.
  await check('a hidden row never drives the crossfade element', async () => {
    const { s, top } = await twoRows('top')
    s.toggleTrackHidden(top.id)
    const p = useTmcutPlayback()
    p.seek(3.75)
    const cf = p.transitionCrossfade.value
    if (cf) {
      throw new Error(`the hidden row ${top.id} drives the crossfade (${cf.outgoing.src} -> ${cf.incoming.src})`)
    }
    assert.equal(painted(p), 'bottom.mp4', 'the row below still paints its own clip')
  })

  // 5. Neither surface may decide the cut alone: the file decodes the painting
  // row's pair, and the preview agrees that this particular cut crossfades.
  await check('the transition windows come from the row that paints', async () => {
    const { s, top } = await twoRows('bottom')
    s.toggleTrackHidden(top.id)
    const project = s.currentProject.value!
    const p = useTmcutPlayback()
    p.seek(3.75)
    const srcs = decodedSrcs(compileTimelineToFfmpeg(project, 'out.mp4').args)
    assert.ok(srcs.some(src => src.includes('bottom.mp4')) && srcs.some(src => src.includes('joint.mp4')),
      `the file decodes the painting row's pair, got ${srcs}`)
    assert.ok(p.transitionCrossfade.value, 'the preview must agree that this cut crossfades')
  })

  // 6. The two surfaces differ in exactly one way, and the banner must name it:
  // the file stacks the rows above the base, the screen still carries one
  // `<video>` and shows the base alone.
  await check('the warning says the file stacks and the screen does not', async () => {
    for (const locale of ['en', 'vi']) {
      const copy = read(`i18n/locales/${locale}.json`)
      const warning = copy.match(/"parallelTracksWarning":\s*"([^"]*)"/)?.[1] ?? ''
      assert.ok(warning.length > 0, `${locale}: parallelTracksWarning is missing`)
      assert.match(warning, /composites|stacks|theo thứ tự vẽ/,
        `${locale}: the rows above the base are in the file now`)
      assert.match(warning, /preview still|preview vẫn chỉ/i,
        `${locale}: the preview shows one row, and the copy must not hide that`)
      assert.doesNotMatch(warning, /preview-only|picture stays|only the top visible|chỉ có ở preview|chỉ có trong preview/i,
        `${locale}: the copy still describes the old renderer`)
    }
  })

  // 7. The poster is a frame of the file, so it comes from the composited row.
  await check('the export poster comes from the composited row', async () => {
    const modal = read('app/components/tmcut/TmcutExportModal.vue')
    assert.doesNotMatch(modal, /tracks\.find\(\s*tr\s*=>\s*tr\.type === 'video'\s*\)/,
      'the modal must not pick a footage row by itself')
    assert.match(modal, /posterUrl[\s\S]{0,400}selectExportTracks/,
      'the poster reads the same selector the compiler uses')
  })

  console.log(`\n=== All ${passed} footage row rule checks passed ===`)
}

main().catch((error) => {
  console.error('\nFAILED:', error)
  process.exit(1)
})
