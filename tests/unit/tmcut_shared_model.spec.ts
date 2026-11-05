/**
 * Shared-model gate (V4 M3): the layer `evaluateTimeline` reports and the
 * `RenderClip` the FFmpeg compiler reads must be the SAME answer for mask
 * geometry, media layout and the transition window — not two derivations that
 * happen to agree today.
 *
 * Before this slice the evaluator handed back `clip.mask` verbatim and no
 * `fit`/`focus`/`cropRect` at all, while the compiler pulled `raw.mask` and
 * `raw.cropRect` off the app item. A third renderer (the WebCodecs host at M5,
 * WASM at M8) reading only the layer therefore could not place a frame, and an
 * unknown mask shape read as "masked" in the model while both alpha builders
 * returned empty — masked on paper, unmasked on screen.
 *
 * Six subjects:
 *  1. mask geometry: layer == render clip == what both builders were given.
 *  2. layout: fit/focus/crop resolved once by core `resolveClipLayout`.
 *  3. the export graph carries the window and the mask the MODEL reports.
 *  4. the export asks core which cuts have a transition instead of re-deciding.
 *  5. the render layer stops reading mask/crop off `raw` (source guard).
 *  6. the preview reads its fit style through the same resolver.
 *
 * No FFmpeg binary needed — this is about the inputs each renderer is handed.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TICKS_PER_SECOND,
  evaluateTimeline,
  maskAlphaExpr,
  maskCssMaskImage,
  ticksToSec,
  transitionWindows
} from 'tmcut-core'
import { toRenderClip } from '../../app/utils/tmcut/render/clip'
import { compileTimelineToFfmpeg } from '../../app/utils/tmcut/render'
import type { TmcutProject } from '../../app/composables/useTmcutProject'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const T = TICKS_PER_SECOND

let checks = 0
function check(name: string, fn: () => void): void {
  fn()
  checks += 1
  console.log(`[ok] ${name}`)
}

function circleMask() {
  return { shape: 'circle', x: 0.25, y: 0.2, w: 0.5, h: 0.6, feather: 18, rotation: 20, invert: true, axis: 'y' }
}

function projectWith(items: object[], textItems: object[] = []): TmcutProject {
  return {
    version: 1,
    name: 'Shared model',
    canvas: { width: 64, height: 36, fps: 30, background: { type: 'color', value: '#123456' } },
    timeline: {
      tracks: [
        { id: 'v1', type: 'video', name: 'Video', items },
        { id: 't1', type: 'text', name: 'Text', items: textItems }
      ]
    }
  } as unknown as TmcutProject
}

function videoItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clip-a',
    src: 'C:/media/a.mp4',
    in: 0,
    out: 2 * T,
    offset: 0,
    speed: 1,
    opacity: 100,
    scale: 100,
    x: 0,
    y: 0,
    rotation: 0,
    fit: 'fit',
    ...overrides
  }
}

const CIRCLE = circleMask()

// --- 1 + 2. one answer for mask geometry and media layout -------------------
const masked = videoItem({ mask: CIRCLE, fit: 'smart', focusX: 0.3, focusY: 0.7 })
const maskedProject = projectWith([masked])
const maskedLayer = evaluateTimeline(maskedProject, T).layers.find(layer => layer.clipId === 'clip-a')!
const maskedRenderClip = toRenderClip(masked as never)

check('the layer reports sanitized mask geometry, not the stored fragment', () => {
  assert.deepEqual(maskedLayer.mask, {
    shape: 'circle',
    x: 0.25,
    y: 0.2,
    w: 0.5,
    h: 0.6,
    feather: 18,
    rotation: 20,
    invert: true,
    axis: 'y'
  })
})

check('preview and export are handed the same mask object the layer carries', () => {
  // The equality that makes M3 true: same normalized geometry -> the CSS mask
  // and the `geq` alpha cannot describe different shapes.
  assert.deepEqual(maskedRenderClip.mask, maskedLayer.mask)
  assert.equal(maskAlphaExpr(maskedRenderClip.mask), maskAlphaExpr(maskedLayer.mask))
  assert.notEqual(maskAlphaExpr(maskedLayer.mask), '', 'a real mask must yield a real alpha expression')
  assert.notEqual(maskCssMaskImage(maskedLayer.mask, 64, 36), null, 'a real mask must yield a real CSS mask')
})

check('the render clip resolves fit, focus and crop from the model', () => {
  assert.deepEqual(maskedRenderClip.cropRect, maskedLayer.layout.cropRect)
  assert.equal(maskedRenderClip.fit, maskedLayer.layout.fit)
  assert.equal(maskedRenderClip.focusX, maskedLayer.layout.focusX)
  assert.equal(maskedRenderClip.focusY, maskedLayer.layout.focusY)
  assert.equal(maskedRenderClip.fit, 'smart')
})

check('defaults land where both fit adapters already put them', () => {
  const bare = videoItem({ id: 'clip-b', fit: undefined, focusX: undefined, cropRect: undefined, mask: undefined })
  const layer = evaluateTimeline(projectWith([bare]), T).layers[0]!
  const render = toRenderClip(bare as never)
  assert.deepEqual(layer.layout, { fit: 'fit', focusX: 0.5, focusY: 0.5, cropRect: null })
  assert.equal(render.fit, 'fit')
  assert.equal(render.focusX, 0.5)
  assert.equal(render.cropRect, null)
  assert.equal(render.mask, null, 'no mask stored is no mask anywhere')
})

check('a shape neither builder knows is no mask for either of them', () => {
  // The foot-gun this slice closes: `{ shape: 'star' }` used to reach the layer
  // as truthy data, so "is this clip masked?" said yes while the export emitted
  // no alpha filter and the preview applied no mask.
  const bad = videoItem({ mask: { shape: 'star', x: 0.2, y: 0.2 } })
  const layer = evaluateTimeline(projectWith([bad]), T).layers[0]!
  assert.equal(layer.mask, null)
  assert.equal(toRenderClip(bad as never).mask, null)
  assert.equal(maskAlphaExpr(layer.mask), '')
  assert.equal(maskCssMaskImage(layer.mask, 64, 36), null)
})

check('an out-of-range stored value is clamped before a renderer sees it', () => {
  const escaped = videoItem({ mask: { shape: 'rectangle', x: 1.6, w: -0.4, feather: 300, rotation: -540 } })
  const layer = evaluateTimeline(projectWith([escaped]), T).layers[0]!
  assert.equal(layer.mask.x, 1)
  assert.equal(layer.mask.w, 0.001)
  assert.equal(layer.mask.feather, 100)
  assert.equal(layer.mask.rotation, -180)
  assert.deepEqual(toRenderClip(escaped as never).mask, layer.mask)
})

// --- 3. the export graph carries what the model says ------------------------
const overlap = T * 0.4
const pair = projectWith([
  videoItem({ id: 'clip-1', src: 'C:/media/a.mp4' }),
  videoItem({
    id: 'clip-2',
    src: 'C:/media/b.mp4',
    offset: 1.6 * T,
    fit: 'crop',
    cropRect: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
    mask: CIRCLE,
    transitionIn: { type: 'wipe-left', duration: overlap }
  })
])
const incoming = evaluateTimeline(pair, T * 1.8).layers.find(layer => layer.clipId === 'clip-2')!
const outgoing = evaluateTimeline(pair, T * 1.8).layers.find(layer => layer.clipId === 'clip-1')!
const graph = compileTimelineToFfmpeg(pair, 'shared-model.mp4').args
const filterGraph = String(graph[graph.indexOf('-filter_complex') + 1])

check('both roles of the overlap report one transition spec', () => {
  assert.equal(incoming.transition?.role, 'incoming')
  assert.equal(outgoing.transition?.role, 'outgoing')
  assert.equal(incoming.transition?.type, 'wipe-left')
  assert.equal(outgoing.transition?.type, incoming.transition?.type, 'both layers must scrub the same effect')
  assert.equal(outgoing.transition?.progress, incoming.transition?.progress)
  assert.equal(incoming.transition?.progress, 0.5, '1.8s sits mid-window in [1.6s, 2.0s]')
})

check('the export xfade window equals the window the model reports', () => {
  // Derived from the evaluator, not from the compiler's own adjacency test:
  // duration is the model's transition duration, offset is where the incoming
  // clip starts. If either drifts, the export crossfades at a different time
  // than the preview ramps.
  const xfade = filterGraph.match(/xfade=transition=[a-z]+:duration=([\d.]+):offset=([\d.]+)/)
  assert.ok(xfade, `expected an xfade in the graph, got ${filterGraph.slice(0, 160)}`)
  assert.equal(Number(xfade[1]), ticksToSec(incoming.transition!.duration), 'xfade duration vs model duration')
  assert.equal(Number(xfade[2]), ticksToSec(incoming.startTicks), 'xfade offset vs the window the model opens at')
})

check('the export mask is the model mask rendered as alpha', () => {
  const expected = maskAlphaExpr(incoming.mask)
  assert.notEqual(expected, '', 'the model must report a mask for a clip that stores one')
  assert.ok(
    filterGraph.includes(`a='(${expected})*`) || filterGraph.includes(`a='(${expected})'`),
    'the geq alpha must be the expression the model geometry produces, byte for byte'
  )
  const crop = filterGraph.match(/crop=w='iw\*([\d.]+)':h='ih\*([\d.]+)'/)
  assert.ok(crop, `expected the crop fit to reach the graph, got ${filterGraph.slice(0, 200)}`)
  const rect = incoming.layout.cropRect!
  assert.equal(Number(crop[1]), rect.w, 'the graph crop width vs the model rect')
  assert.equal(Number(crop[2]), rect.h, 'the graph crop height vs the model rect')
})

check('a clip with no mask emits no alpha pass at all', () => {
  const plain = compileTimelineToFfmpeg(projectWith([videoItem()]), 'plain.mp4').args
  const plainGraph = String(plain[plain.indexOf('-filter_complex') + 1])
  assert.ok(!plainGraph.includes('geq='), `unmasked clip must not pay for geq, got ${plainGraph}`)
  assert.equal(evaluateTimeline(projectWith([videoItem()]), T).layers[0]!.mask, null)
})

// --- 4. the export asks the model which cuts have a transition --------------
// Core admits a 1 ms adjacency error (`ADJACENCY_EPS`, because positions
// round-trip the app's 1e-4 s grid). The compiler used to run its own check in
// SECONDS with a 50 ms window, so a pair that sits 20 ms off — a trim the user
// nudged, a drag released a hair early — had NO transition for the preview and
// a full crossfade in the file. One model, one answer: the export must consume
// `transitionWindows`, the same authority `evaluateTimeline` uses.
const drifted = projectWith([
  videoItem({ id: 'd-1', src: 'C:/media/a.mp4' }),
  videoItem({
    id: 'd-2',
    src: 'C:/media/b.mp4',
    // clip-1 ends at 2.000 s; the overlap model puts the cut at offset+duration,
    // so 1.62 s sits exactly 20 ms past what the model would accept.
    offset: Math.round(1.62 * T),
    transitionIn: { type: 'fade', duration: overlap }
  })
])

check('the model itself refuses to open a window for the 20 ms pair', () => {
  // Without this, the next check would only prove the compiler is blind.
  assert.deepEqual(transitionWindows(drifted.timeline.tracks[0]), [])
  const layer = evaluateTimeline(drifted, T * 1.8).layers.find(l => l.clipId === 'd-2')!
  assert.equal(layer.transition, null, 'a broken pair must not report a transition')
})

check('a pair the model does not call a transition is not crossfaded in the export', () => {
  const driftedGraph = compileTimelineToFfmpeg(drifted, 'drifted.mp4').args
  const driftedFilter = String(driftedGraph[driftedGraph.indexOf('-filter_complex') + 1])
  assert.ok(
    !driftedFilter.includes('xfade'),
    `the export must concat where the preview shows no transition, got ${driftedFilter}`
  )
  assert.ok(
    !driftedFilter.includes('acrossfade'),
    'the audio lane may not crossfade a pair the video lane plays straight'
  )
})

check('the intact pair still crossfades with the model window', () => {
  // The other direction: consuming the windows must not lose real transitions.
  const windows = transitionWindows(pair.timeline.tracks[0])
  assert.equal(windows.length, 1)
  assert.equal(windows[0]!.fromId, 'clip-1')
  assert.equal(windows[0]!.toId, 'clip-2')
  assert.equal(windows[0]!.endTicks - windows[0]!.startTicks, overlap)
  assert.ok(filterGraph.includes('xfade='), 'the valid pair must still reach xfade')
})

// --- 5. the source stays on the model --------------------------------------
check('the render layer no longer pulls mask or crop off the app item', () => {
  // `raw` exists for the expression builders (keyframeExpr, rampSetptsExpr),
  // which read unit-agnostic fields. Selecting mask/cropRect out of it re-opens
  // the split M3 closed: two sources of truth for one shape.
  const video = readFileSync(join(ROOT, 'app/utils/tmcut/render/video.ts'), 'utf8')
  const clip = readFileSync(join(ROOT, 'app/utils/tmcut/render/clip.ts'), 'utf8')
  assert.ok(!/raw\.mask/.test(video), 'video.ts must read clip.mask (the normalized model value)')
  assert.ok(!/raw\.cropRect/.test(video), 'video.ts must read clip.cropRect')
  assert.ok(!/raw\.mask|raw\.cropRect/.test(clip), 'clip.ts must resolve mask/cropRect through core')
  assert.ok(/normalizeMask\(item\.mask\)/.test(clip), 'clip.ts must call the same normalizer the evaluator calls')
  assert.ok(/resolveClipLayout\(item\)/.test(clip), 'clip.ts must call the same layout resolver the evaluator calls')
})

check('the export no longer carries its own adjacency tolerance', () => {
  const video = readFileSync(join(ROOT, 'app/utils/tmcut/render/video.ts'), 'utf8')
  const index = readFileSync(join(ROOT, 'app/utils/tmcut/render/index.ts'), 'utf8')
  assert.ok(
    /transitionWindows/.test(video),
    'video.ts must read the windows core reports instead of testing adjacency itself'
  )
  assert.ok(
    !/0\.05/.test(video),
    'the 50 ms second-scale guess is the bug: one tolerance lives in core'
  )
  assert.ok(
    /transitionWindows\(/.test(index),
    'the compiler entry point must hand the pipeline the model windows'
  )
})

check('the preview resolves fit, focus and crop from the same core call', () => {
  // Third consumer, same rule. The SFC used to spell the defaults out a second
  // time (`clip.fit || 'fit'`, `focusX ?? 0.5`), which is how a fourth answer
  // gets written: valid for today's data, free to drift from it tomorrow.
  // Slice F4b moved the preview one step further along the same law: the
  // resolver is core's and its ANSWER arrives on the layer, so the DOM reads
  // `surface.layer.layout` instead of calling it again for the same clip.
  const player = readFileSync(join(ROOT, 'app/components/tmcut/TmcutPreviewPlayer.vue'), 'utf8')
  assert.ok(/fitStyle\(surface\.layer\.layout\)/.test(player), 'the preview must read layout through core')
  assert.ok(!/resolveClipLayout\(/.test(player), 'nor re-resolve a layout the plan already carries')
  assert.ok(!/focusX \?\? 0\.5/.test(player), 'no local copy of the focus default may remain')
  assert.ok(!/computeFitObjectStyle\(clip\.fit \|\| 'fit'/.test(player), 'no local copy of the fit default may remain')
  const fitStyle = player.match(/function fitStyle[\s\S]*?\n}/)
  assert.ok(fitStyle, 'the preview must have one fit-style helper every footage layer uses')
  assert.equal((player.match(/fitStyle\(/g) ?? []).length, 2,
    'one definition and one call site — the shared surface helper — so no element can pick its own fit')
})

console.log(`\n=== All ${checks} shared-model checks passed ===`)
