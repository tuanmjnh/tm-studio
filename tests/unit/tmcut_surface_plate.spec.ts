/**
 * Every footage layer carries its own effect plate (Zero-FFmpeg slice F4b).
 *
 * F2b gave each footage row an element and ONE styling function; F4a put them
 * all on one media clock. The *plate* effects stayed outside that law: the
 * player owned a second vignette formula (a radial `circle` at 40%, alpha
 * `intensity/100 * 0.85`) rendered as ONE monitor-wide `<div>`, keyed off
 * `activeVideoClip` — the bottom row, the one that owns the audio. So a stacked
 * row carrying its own vignette painted none, and the bottom row's vignette
 * tinted every row above it. `letterbox` had no live face at all. The tile, the
 * inspector and the file all read the registry's own `ellipse` 52%/0.82 face,
 * so only the live monitor disagreed with everybody else.
 *
 * The export bakes both effects INTO the layer: `render/video.ts:320` puts
 * `buildFfmpegEffectFilters(clip.raw.effects)` right after that clip's own fit,
 * so the plate travels with the row's transform, opacity and mask. The law these
 * checks demand is the screen-side reading of that: a plate is a property of a
 * SURFACE, taken from the registry's overlay face — never a second formula in
 * the DOM, and never keyed to whichever row happens to own the audio.
 *
 * The second half of the debt is the same argument about numbers: `clipVisual`
 * re-ran `evaluateClip(clip, localTicks(clip))` while the surface already
 * carries core's `layer.transform` / `layer.opacity` / `layer.layout` /
 * `layer.effects` / `layer.mask` — computed once, for the very plan that picked
 * the row. Two readings of one clip can drift; one cannot.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_surface_plate.spec.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TICKS, freshStore } from './helpers/tmcut_store_env'
import { EFFECT_REGISTRY, fxCapabilities } from 'tmcut-core'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(root, rel), 'utf8')
const PLAYER = 'app/components/tmcut/TmcutPreviewPlayer.vue'
const FX = 'app/utils/tmcut/fxPreview.ts'
const tk = (sec: number) => Math.round(sec * TICKS)

let passed = 0
async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

/** Two visible footage rows at 0-4 s; the top row sits above the audio owner. */
async function twoRows() {
  const s = await freshStore()
  s.addClipToTrack('video', { src: 'bottom.mp4', in: 0, out: tk(4), offset: 0 })
  s.addTrackToProject('video')
  const rows = s.currentProject.value!.timeline.tracks.filter(t => t.type === 'video')
  s.addClipToTrack('video', { src: 'top.mp4', in: 0, out: tk(4), offset: 0 }, rows[1]!.id)
  return () => s.currentProject.value!.timeline.tracks.flatMap(t => t.items || [])
}

function backgroundOf(style: Record<string, unknown> | null): string {
  assert.ok(style, 'expected an overlay style')
  const bg = (style as { background?: string }).background
  assert.ok(bg, 'expected a background on the overlay face')
  return bg
}

async function main() {
  console.log('=== [TMCut surface plate] Starting ===\n')
  const player = read(PLAYER)
  const fx = await import('../../app/utils/tmcut/fxPreview')

  // 1. The bug this slice exists for: one plate for the whole monitor, keyed to
  // the bottom row. It cannot be per-layer, so it may not come back.
  await check('the monitor holds no frame-wide vignette plate', () => {
    assert.doesNotMatch(player, /activeVignetteStyle/,
      'the vignette plate must belong to a surface, not to the row that owns the audio')
    assert.doesNotMatch(player, /radial-gradient\(/,
      'the player must not own a second vignette formula — the registry already has one')
  })

  // 2. The registry face has to be reachable, or the DOM has nothing to read.
  await check('the registry overlay face is reachable from one call', () => {
    assert.equal(typeof (fx as Record<string, unknown>).effectOverlay, 'function',
      'fxPreview must expose the overlay face, not only the filter/transform face')
    assert.equal(typeof (fx as Record<string, unknown>).layerOverlayPlates, 'function',
      'one call must turn a layer of effects into its plates, in chain order')
  })

  // 3. One law: the plate IS the registry face — same gradient, same unit scale.
  await check('the vignette plate reads the registry face verbatim', () => {
    const effectOverlay = fx.effectOverlay as unknown as
      (type: string, params?: Record<string, unknown>) => Record<string, unknown> | null
    assert.match(backgroundOf(effectOverlay('vignette', { intensity: 100 })), /rgba\(0,\s*0,\s*0,\s*0\.82\)/,
      'intensity 100 is the registry\'s full 0.82 alpha')
    assert.match(backgroundOf(effectOverlay('vignette', { intensity: 50 })), /rgba\(0,\s*0,\s*0,\s*0\.41\)/,
      'the scale is the registry\'s 0..100 unit, not the player\'s own /100')
    assert.doesNotMatch(backgroundOf(effectOverlay('vignette', { intensity: 100 })), /circle/,
      'the registry says ellipse; a second shape would be a second law')
  })

  // 4. Only faces that ARE the layer's look may reach the live preview. The
  // registry says which ones, so no local type table appears in the DOM.
  await check('a thumbnail mnemonic never becomes a live plate', () => {
    const effectOverlay = fx.effectOverlay as unknown as
      (type: string, params?: Record<string, unknown>) => Record<string, unknown> | null
    assert.equal(effectOverlay('chromakey', { color: '#00ff00' }), null,
      'illustrative: the file keys out a color, it never draws a band')
    assert.equal(effectOverlay('pixelate', { size: 8 }), null,
      'the file downscales and upscales — its grid lines do not exist')
    assert.equal(effectOverlay('blur', { amount: 80 }), null,
      'a filter-only effect paints on the element itself')
    assert.equal(effectOverlay('lut3d', { lut: 'warm' }), null, 'a grade has no plate')
    assert.ok(effectOverlay('letterbox', { size: 10 }), 'letterbox is exact: it must reach the monitor')
    assert.ok(effectOverlay('grain', { amount: 40 }), 'grain is the layer\'s own noise: it must reach the monitor')
  })

  // 5. Several plate effects on one clip stack in effect order, which is the
  // order the export bakes them into that layer.
  await check('plates come out one per overlay effect, in chain order', () => {
    const layerOverlayPlates = fx.layerOverlayPlates as unknown as
      (effects: Array<{ type: string, params?: Record<string, unknown> }> | null | undefined) => Record<string, unknown>[]
    assert.deepEqual(layerOverlayPlates(null), [], 'no effects, no plates')
    const plates = layerOverlayPlates([
      { type: 'letterbox', params: { size: 10 } },
      { type: 'blur', params: { amount: 40 } },
      { type: 'vignette', params: { intensity: 100 } }
    ])
    assert.equal(plates.length, 2, 'only the overlay-bearing effects contribute a plate')
    assert.match(backgroundOf(plates[0]!), /linear-gradient/, 'letterbox is the first effect')
    assert.match(backgroundOf(plates[1]!), /radial-gradient/, 'and vignette follows it, as in the chain')
  })

  // 6. Which effects may plate a live layer is the registry's answer, and the
  // flag may not lie: every flagged effect has to actually have a face.
  await check('the live-plate set comes from the registry', () => {
    const flagged = Object.keys(EFFECT_REGISTRY).filter(
      type => (fxCapabilities(type) as { layerOverlay?: boolean } | null)?.layerOverlay === true)
    assert.deepEqual(flagged.sort(), ['grain', 'letterbox', 'vignette'],
      'exactly the effects whose DOM overlay IS the file\'s bake')
    const effectOverlay = fx.effectOverlay as unknown as
      (type: string, params?: Record<string, unknown>) => Record<string, unknown> | null
    for (const type of flagged) {
      assert.ok(effectOverlay(type, {}), `registry flags ${type} as a live plate but its face is empty`)
    }
    const src = read(FX)
    assert.equal((src.match(/\??\.layerOverlay\b(?!Plates)/g) || []).length, 1,
      'fxPreview reads the registry flag in exactly one place')
  })

  // 7. The law applied to the stack: the plate follows its own layer, so a row
  // above the audio owner finally shows what the file bakes into it.
  await check('a stacked row carries its own plate and no one else\'s', async () => {
    const items = await twoRows()
    const top = items().find(item => item.src === 'top.mp4')!
    top.effects = [{ type: 'vignette', params: { intensity: 100 } }]
    const { useTmcutPlayback } = await import('../../app/composables/useTmcutPlayback')
    const p = useTmcutPlayback()
    p.seek(1)
    const layerOverlayPlates = fx.layerOverlayPlates as unknown as
      (effects: Array<{ type: string, params?: Record<string, unknown> }> | null | undefined) => Record<string, unknown>[]
    const plates = (src: string) => {
      const surface = [...p.stackedSurfaces.value, p.mainSurface.value].find(item => item?.clip.src === src)
      assert.ok(surface, `no surface for ${src}`)
      return layerOverlayPlates(surface!.layer.effects).length
    }
    assert.equal(plates('top.mp4'), 1, 'core puts the vignette on the TOP layer, so the top row plates it')
    assert.equal(plates('bottom.mp4'), 0,
      'the bottom row owned this plate before F4b; its own layer never asked for one')

    // And the DOM has to ask per surface, for all three sites.
    for (const site of ['mainSurface', 'crossfadeSurface', 'surface']) {
      assert.match(player, new RegExp(`surfacePlates\\(${site}\\)`),
        `the ${site} layer must render its own plates`)
    }
    const lines = player.split('\n')
    for (const site of ['mainSurface', 'crossfadeSurface', 'surface']) {
      const styleAt = lines.findIndex(line => line.includes(`surfaceStyle(${site})`))
      const platesAt = lines.findIndex(line => line.includes(`surfacePlates(${site})`))
      assert.ok(styleAt >= 0 && platesAt > styleAt,
        `plates of ${site} must ride inside the layer that surfaceStyle positions`)
    }

    // Leg two of the debt: the DOM reads the plan, it does not re-run it.
    assert.doesNotMatch(player, /evaluateClip/, 'the footage law must not re-run the evaluator')
    assert.doesNotMatch(player, /resolveClipLayout/, 'nor re-resolve the layout')
    for (const field of ['layer.transform', 'layer.opacity', 'layer.layout', 'layer.effects', 'layer.mask']) {
      assert.match(player, new RegExp(field.replace('.', '\\.')), `the surface must carry ${field}`)
    }
  })

  console.log(`\n=== [TMCut surface plate] ${passed}/7 checks passed ===`)
}

main().catch((error) => {
  console.error('FAILED:', error)
  process.exit(1)
})
