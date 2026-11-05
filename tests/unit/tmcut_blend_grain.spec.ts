/**
 * One blend answer, one moving grain plate (Zero-FFmpeg slice F6d).
 *
 * Slice F's exit criteria ask that preview and export read the SAME composition
 * rules. F2b/F4b brought the row selection, the transform, the opacity, the
 * mask, the layout and the effect chain to core's layer, and this spec closes
 * the two numbers that were left behind (§32.7, §35.6):
 *
 *  1. BLEND. The composite group already rides core's layer, but the mode was
 *     read off the authored clip on both surfaces — `(clip as { blend? }).blend`
 *     in the player, `clip.raw.blend` in the exporter — and nothing anywhere
 *     said which modes are legal. That is not cosmetic: `blend=all_mode='x'`
 *     with a name FFmpeg does not know kills the whole filtergraph, so one
 *     hand-edited project field could turn every export into a failure while
 *     the monitor happily painted a CSS mode that has no file counterpart.
 *     Core now owns the legal set and normalizes; the layer carries the answer;
 *     each surface reads that one answer.
 *
 *  2. GRAIN. The registry gives grain an `overlayAnimation`, and `effectOverlay`
 *     returned only `background`/`opacity` — so the live plate was a still and
 *     the file was not: `buildFfmpegEffectFilters` emits `noise=alls=…`, which
 *     draws fresh noise every frame. The plate now carries the effect's OWN
 *     motion (never the tile's before/after reveal, which is a thumbnail
 *     mnemonic the monitor has no business playing), and the `@keyframes` that
 *     drives it lives in the app-wide stylesheet, because a monitor that is
 *     mounted without a single thumbnail must still move.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_blend_grain.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BLEND_MODES, EFFECT_REGISTRY, TICKS_PER_SECOND, blendModeOf, evaluateTimeline, fxCapabilities } from 'tmcut-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const PLAYER = 'app/components/tmcut/TmcutPreviewPlayer.vue'
const EXPORTER = 'app/utils/tmcut/render/video.ts'
const PROJECT_TYPES = 'app/composables/useTmcutProject.ts'
const INSPECTOR = 'app/components/tmcut/TmcutInspector.vue'
const MAIN_CSS = 'app/assets/css/main.css'

let passed = 0

async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

const tk = (sec: number) => Math.round(sec * TICKS_PER_SECOND)

/** One footage row, one clip, authored however the test needs. */
function projectWith(clipFields: Record<string, unknown>) {
  return {
    timeline: {
      tracks: [{
        id: 'v1',
        type: 'video',
        items: [{ id: 'c1', src: 'a.mp4', offset: 0, in: 0, out: tk(4), ...clipFields }]
      }]
    }
  }
}

function layerAt(atSec: number, clipFields: Record<string, unknown>) {
  const evaluation = evaluateTimeline(projectWith(clipFields), tk(atSec))
  const layer = evaluation.layers.find(item => item.clipId === 'c1')
  assert.ok(layer, `no layer at ${atSec}s`)
  return layer as Record<string, unknown>
}

/** Animation names a CSS `animation` shorthand can reference, in order. */
function animationNames(shorthand: unknown): string[] {
  if (typeof shorthand !== 'string' || !shorthand) return []
  return shorthand.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)
}

async function main() {
  console.log('=== [TMCut blend + grain] Starting ===\n')
  const fx = await import('../../app/utils/tmcut/fxPreview')
  const layerOverlayPlates = fx.layerOverlayPlates as unknown as
    (effects: Array<{ type: string, params?: Record<string, unknown> }> | null | undefined) => Record<string, unknown>[]

  // 1. The legal set is core's, and it is the set BOTH counterparts implement:
  // every mode below is a CSS `mix-blend-mode` value and an FFmpeg
  // `blend=all_mode=` name spelled identically.
  await check('core owns the legal blend modes', () => {
    assert.ok(Array.isArray(BLEND_MODES), 'BLEND_MODES must be exported from core')
    assert.deepEqual([...BLEND_MODES].sort(), ['multiply', 'normal', 'overlay', 'screen'],
      'exactly the modes the CSS preview and the FFmpeg file share')
    assert.equal(blendModeOf({ blend: 'multiply' }), 'multiply', 'a legal mode survives')
    assert.equal(blendModeOf({}), 'normal', 'no blend authored = the classic overlay')
    assert.equal(blendModeOf({ blend: 'color-dodge' }), 'normal',
      'a mode FFmpeg would reject must not reach the filtergraph')
    assert.equal(blendModeOf({ blend: 42 }), 'normal', 'a non-string is not a mode either')
    assert.equal(blendModeOf(null), 'normal', 'a missing clip has no mode')
  })

  // 2. The evaluator carries the answer, so a renderer never asks the clip.
  await check('the layer carries the blend mode', () => {
    assert.equal(layerAt(1, { blend: 'screen' }).blend, 'screen', 'authored mode reaches the layer')
    assert.equal(layerAt(1, {}).blend, 'normal', 'unset normalizes ON the layer, not in the host')
    assert.equal(layerAt(1, { blend: 'hue' }).blend, 'normal',
      'the normalization happens once, in core')
  })

  // 3. The monitor reads the layer. The cast it used to carry is the tell: a
  // property core did not model, the host reached for the authored object.
  await check('the preview asks core, not the authored clip', () => {
    const player = read(PLAYER)
    assert.match(player, /layer\.blend/, 'the footage style must read the plan\'s blend')
    assert.doesNotMatch(player, /\(clip as \{ blend/, 'no cast for a field core now carries')
    assert.doesNotMatch(player, /clip\.blend\b/, 'the player must not read the authored clip for the mode')
  })

  // 4. The exporter asks the same law, so the two surfaces cannot disagree
  // about a mode — and a bogus authored value can no longer kill a render.
  await check('the export asks the same law', () => {
    const exporter = read(EXPORTER)
    assert.match(exporter, /blendModeOf\(/, 'the compiler must normalize through core')
    assert.doesNotMatch(exporter, /clip\.raw\.blend\b/, 'no raw read of the authored mode beside the law')
  })

  // 5. No second union in the app: the type gate is what stops a UI from
  // offering a mode core would normalize away.
  await check('the app declares no second blend union', () => {
    const types = read(PROJECT_TYPES)
    assert.match(types, /TmcutBlendMode = CoreBlendMode/, 'the app alias must come from core')
    assert.doesNotMatch(types, /TmcutBlendMode = 'normal'/, 'and not re-spell the literals')
    const inspector = read(INSPECTOR)
    assert.doesNotMatch(inspector, /as 'normal' \| 'screen'/, 'the picker must not cast a private union')
  })

  // 6. Grain moved in the file (`noise=` redraws every frame) and stood still
  // on the monitor. A live plate now carries the effect's own motion.
  await check('the grain plate moves', () => {
    const [plate] = layerOverlayPlates([{ type: 'grain', params: { amount: 40, size: 'medium' } }])
    assert.ok(plate, 'grain plates the live layer')
    assert.deepEqual(animationNames(plate.animation), ['tmfx-grain'],
      'the live plate runs the grain motion')
    // The other two flagged faces are static in the file too; they must stay so.
    for (const type of ['vignette', 'letterbox']) {
      const [still] = layerOverlayPlates([{ type, params: { intensity: 60, size: 10 } }])
      assert.ok(still, `${type} still plates`)
      assert.deepEqual(animationNames(still.animation), [], `${type} has no motion in either counterpart`)
    }
  })

  // 7. The tile reveals before/after; the monitor has nothing to reveal. The
  // reveal prefix must stay on the tile path and never leak into a plate.
  await check('the plate carries its own motion, not the reveal', () => {
    const plates = layerOverlayPlates([{ type: 'grain', params: { amount: 40 } }])
    assert.doesNotMatch(String(plates[0]!.animation), /tmfx-compare/,
      'a monitor-wide dissolve would be inventing motion the file does not have')
    const tile = fx.resolveFxPreview('effect', 'grain', { amount: 40 }) as unknown as
      { layers: Record<string, unknown>[] }
    const overlay = tile.layers[tile.layers.length - 1]
    assert.ok(overlay, 'the grain tile paints an overlay layer')
    assert.ok(String(overlay.animation).includes('tmfx-compare'),
      'the tile keeps its before/after reveal')
    assert.ok(String(overlay.animation).includes('tmfx-grain'),
      'and the grain motion underneath it')
    assert.equal((fx.layerOverlayPlates as unknown as (...args: unknown[]) => unknown[]).length, 1,
      'one call answers the plates; no animate flag to re-decide per surface')
  })

  // 8. A plate is styled by inline CSS, so its @keyframes must be app-wide.
  // Keyframes inside TmcutFxThumb.vue only exist once a thumbnail is mounted;
  // the monitor must not depend on one.
  await check('every live-plate motion has app-wide keyframes', () => {
    const flagged = Object.keys(EFFECT_REGISTRY).filter(
      type => (fxCapabilities(type) as { layerOverlay?: boolean } | null)?.layerOverlay === true)
    const names = new Set<string>()
    for (const type of flagged) {
      for (const plate of layerOverlayPlates([{ type, params: { amount: 40, intensity: 60, size: 10 } }])) {
        for (const name of animationNames(plate.animation)) names.add(name)
      }
    }
    assert.ok(names.size >= 1, 'grain must contribute a name, or this check is vacuous')
    const main = read(MAIN_CSS)
    const imports = [...main.matchAll(/@import\s+["']\.\/([a-z0-9-]+\.css)["']/g)].map(m => m[1] as string)
    assert.ok(imports.length >= 1, 'main.css must import the app stylesheets')
    const globalCss = imports
      .map(file => read(join('app', 'assets', 'css', file!)))
      .join('\n')
    const declared = new Set([...globalCss.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)/g)].map(m => m[1] as string))
    const missing = [...names].filter(name => !declared.has(name))
    assert.deepEqual(missing, [],
      `no @keyframes reachable from main.css for: ${missing.join(', ')} (a tile-local frame is not enough)`)
  })

  console.log(`\n=== [TMCut blend + grain] ${passed}/8 checks passed ===`)
}

main().catch((error) => {
  console.error('FAILED:', error)
  process.exit(1)
})
