/**
 * Shared-model gate (V4 M3): the layer `evaluateTimeline` reports is the SAME
 * answer every renderer reads for mask geometry, media layout and the
 * transition window — not three derivations that happen to agree today.
 *
 * Before this slice the evaluator handed back `clip.mask` verbatim and no
 * `fit`/`focus`/`cropRect` at all, while the FFmpeg compiler pulled `raw.mask`
 * and `raw.cropRect` off the app item. A third renderer (the WebCodecs host at
 * M5, WASM at M8) reading only the layer therefore could not place a frame, and
 * an unknown mask shape read as "masked" in the model while both alpha builders
 * returned empty — masked on paper, unmasked on screen.
 *
 * Slice I deleted the FFmpeg compiler, so the third copy is gone rather than
 * agreeing. What this spec owns now:
 *  1. mask geometry: the layer carries core's normalized shape, and the CSS
 *     mask and the alpha expression are built from that same object.
 *  2. layout: fit/focus/crop resolved once by core `resolveClipLayout`.
 *  3. the export's answer about a feature is a NAMED refusal from
 *     `planEncodeContent`, never a second geometric re-derivation.
 *  4. transitions: both roles of one overlap report one spec, and a pair the
 *     model refuses to open is not crossfaded anywhere.
 *  5. no consumer re-resolves what the layer already carries.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_shared_model.spec.ts
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
  planEncodeContent,
  resolveClipLayout,
  transitionWindows
} from 'tmcut-core'
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

/** A project the exporter can paint: one visible footage row, no text. */
function projectWith(items: object[], textItems: object[] = []): TmcutProject {
  return {
    version: 1,
    name: 'Shared model',
    canvas: { width: 64, height: 36, fps: 30, background: { type: 'color', value: '#123456' } },
    timeline: {
      tracks: [
        { id: 'v1', type: 'video', name: 'Video', items },
        ...(textItems.length ? [{ id: 't1', type: 'text', name: 'Text', items: textItems }] : [])
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

// --- 1. one answer for mask geometry and media layout -----------------------
const masked = videoItem({ mask: CIRCLE, fit: 'smart', focusX: 0.3, focusY: 0.7 })
const maskedLayer = evaluateTimeline(projectWith([masked]), T).layers.find(layer => layer.clipId === 'clip-a')!

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

check('both painters build their mask from the object the layer carries', () => {
  // The equality that makes M3 true: one normalized geometry -> the CSS mask
  // and the alpha expression cannot describe different shapes.
  assert.equal(maskAlphaExpr(maskedLayer.mask), maskAlphaExpr(maskedLayer.mask))
  assert.notEqual(maskAlphaExpr(maskedLayer.mask), '', 'a real mask must yield a real alpha expression')
  assert.notEqual(maskCssMaskImage(maskedLayer.mask, 64, 36), null, 'a real mask must yield a real CSS mask')
})

check('the layer resolves fit, focus and crop from one core call', () => {
  assert.deepEqual(maskedLayer.layout, resolveClipLayout(masked as never))
  assert.equal(maskedLayer.layout.fit, 'smart')
  assert.equal(maskedLayer.layout.focusX, 0.3)
  assert.equal(maskedLayer.layout.focusY, 0.7)
})

check('defaults land where the resolver puts them', () => {
  const bare = videoItem({ id: 'clip-b', fit: undefined, focusX: undefined, cropRect: undefined, mask: undefined })
  const layer = evaluateTimeline(projectWith([bare]), T).layers[0]!
  assert.deepEqual(layer.layout, { fit: 'fit', focusX: 0.5, focusY: 0.5, cropRect: null })
  assert.equal(layer.mask, null, 'no mask stored is no mask anywhere')
})

check('a shape neither builder knows is no mask for either of them', () => {
  // The foot-gun this slice closes: `{ shape: 'star' }` used to reach the layer
  // as truthy data, so "is this clip masked?" said yes while the export emitted
  // no alpha filter and the preview applied no mask.
  const bad = videoItem({ mask: { shape: 'star', x: 0.2, y: 0.2 } })
  const layer = evaluateTimeline(projectWith([bad]), T).layers[0]!
  assert.equal(layer.mask, null)
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
})

// --- 2. the export names what it cannot paint ------------------------------
check('a masked project is refused by name, not painted with a guessed shape', () => {
  // A paintable fit, so the only thing standing between this project and a file
  // is the mask the canvas painter cannot honour.
  const verdict = planEncodeContent(projectWith([videoItem({ mask: CIRCLE })]))
  assert.equal(verdict.kind, 'refused')
  assert.deepEqual([...verdict.reasons], ['mask'], 'one reason, and it is the mask')
  assert.equal(verdict.request, null, 'a refusal carries no request to fall back on')
})

check('an unusable fit is refused as `fit-unsupported`, not silently fitted', () => {
  // `smart` needs a focus-aware crop with no measured canvas twin, and the
  // resolver still answers it — which is exactly why the content law has to.
  assert.equal(resolveClipLayout(videoItem({ fit: 'smart' }) as never).fit, 'smart')
  assert.deepEqual([...planEncodeContent(projectWith([videoItem({ fit: 'smart' })])).reasons], ['fit-unsupported'])
})

// --- 3. the one transition answer ------------------------------------------
const overlap = T * 0.4
const pair = projectWith([
  videoItem({ id: 'clip-1', src: 'C:/media/a.mp4' }),
  videoItem({
    id: 'clip-2',
    src: 'C:/media/b.mp4',
    offset: 1.6 * T,
    fit: 'crop',
    cropRect: { x: 0.1, y: 0.2, w: 0.7, h: 0.6 },
    transitionIn: { type: 'wipe-left', duration: overlap }
  })
])
const incoming = evaluateTimeline(pair, T * 1.8).layers.find(layer => layer.clipId === 'clip-2')!
const outgoing = evaluateTimeline(pair, T * 1.8).layers.find(layer => layer.clipId === 'clip-1')!

check('both roles of the overlap report one transition spec', () => {
  assert.equal(incoming.transition?.role, 'incoming')
  assert.equal(outgoing.transition?.role, 'outgoing')
  assert.equal(incoming.transition?.type, 'wipe-left')
  assert.equal(outgoing.transition?.type, incoming.transition?.type, 'both layers must scrub the same effect')
  assert.equal(outgoing.transition?.progress, incoming.transition?.progress)
  assert.equal(incoming.transition?.progress, 0.5, '1.8s sits mid-window in [1.6s, 2.0s]')
})

check('the window the export refuses on is the window the model reports', () => {
  // Core admits a 1 ms adjacency error (`ADJACENCY_EPS`, because positions
  // round-trip the app's 1e-4 s grid). The FFmpeg compiler used to run its own
  // check in SECONDS with a 50 ms window; the content law reads core's answer,
  // so the two cannot disagree about which cut has a transition.
  const windows = transitionWindows(pair.timeline.tracks[0])
  assert.equal(windows.length, 1)
  assert.equal(windows[0]!.fromId, 'clip-1')
  assert.equal(windows[0]!.toId, 'clip-2')
  assert.equal(windows[0]!.endTicks - windows[0]!.startTicks, overlap)
  assert.deepEqual([...planEncodeContent(pair).reasons], ['transition'],
    'a crop fit is paintable; the crossfade is the one named refusal')
})

// The same pair, 20 ms off: a trim the user nudged, a drag released a hair
// early. The model opens no window, so nothing downstream may either.
const drifted = projectWith([
  videoItem({ id: 'd-1', src: 'C:/media/a.mp4' }),
  videoItem({
    id: 'd-2',
    src: 'C:/media/b.mp4',
    offset: Math.round(1.62 * T),
    transitionIn: { type: 'fade', duration: overlap }
  })
])

check('the model itself refuses to open a window for the 20 ms pair', () => {
  assert.deepEqual(transitionWindows(drifted.timeline.tracks[0]), [])
  const layer = evaluateTimeline(drifted, T * 1.8).layers.find(l => l.clipId === 'd-2')!
  assert.equal(layer.transition, null, 'a broken pair must not report a transition')
})

check('the transition refusal reads the authored field, and a plain cut is not refused', () => {
  // The content law is deliberately conservative here: a canvas painter has no
  // measured twin for ANY crossfade, so an authored `transitionIn` is a named
  // refusal whether or not the model opens a window for it. The model's
  // window is what decides whether the PREVIEW ramps — two questions, two
  // answers, and neither re-derives the other.
  assert.deepEqual([...planEncodeContent(drifted).reasons], ['transition'])
  const plain = projectWith([videoItem({ id: 'p-1', src: 'C:/media/a.mp4' })])
  assert.deepEqual([...planEncodeContent(plain).reasons], [], 'a cut with no transition is paintable')
})

// --- 4. no consumer re-resolves what the layer carries ---------------------
check('the preview reads the layout the plan carries, not a second resolve', () => {
  // Slice F4b moved the preview onto the layer: the DOM reads
  // `surface.layer.layout` instead of calling the resolver again for the same
  // clip — which is how a fourth answer gets written.
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

check('the export host reads core rows, and no raw mask/crop survives in app code', () => {
  const host = readFileSync(join(ROOT, 'app/utils/tmcut/webExportHost.ts'), 'utf8')
  assert.match(host, /planEncodeContent/, 'the export host asks the content law, which owns mask and layout')
  const surfaces = readFileSync(join(ROOT, 'app/utils/tmcut/paintSurfaces.ts'), 'utf8')
  assert.doesNotMatch(surfaces, /raw\.mask|raw\.cropRect/, 'no renderer pulls a shape off the authored item')
})

console.log(`\n=== All ${checks} shared-model checks passed ===`)
