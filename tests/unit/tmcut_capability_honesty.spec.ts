// =============================================================================
//  Capability honesty on the two surfaces that used to overstate one.
//
//  1. The effect tile said "Not in export" only for a definition the registry
//     called incomplete — while `planEncodeContent` refused EVERY clip that
//     carried an effect. So a complete effect advertised as exportable led the
//     user to an export button that answered `effects`. The tile now says
//     "Preview only" for every effect, because that is what is true today.
//  2. The timeline offered a per-track Pan number while nothing applies pan:
//     the Web Audio mixer has no panner and the retired FFmpeg filter is gone.
//     A control that cannot change what the user hears is worse than no
//     control, so the input is gone — the `pan` FIELD stays, because stored
//     projects carry it and a value must never be silently destroyed.
//
//  Both checks are source contracts on purpose: the behaviour lives in a Vue
//  component the node runner cannot mount, and the failure mode (a badge that
//  lies) is visible in the template.
// =============================================================================
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('a capability badge may only claim what the renderer can do', () => {
  const thumb = read('app/components/tmcut/TmcutFxThumb.vue')

  it('the tile reads the two capabilities, never one boolean', () => {
    assert.match(thumb, /const \{ fidelity, previewReady, exportReady \} = preview\.value\.status/,
      'the badge still destructures one capability')
    assert.doesNotMatch(thumb, /exportSupported/, 'the retired single flag is still read')
  })

  it('an effect the exporter refuses is badged preview-only, and that badge is urgent', () => {
    assert.match(thumb, /if \(!exportReady\) info = \{[^}]*?previewOnly/,
      'the refusal badge does not use the preview-only copy')
  })

  it('both locales name the state, so the tile never renders a raw key', () => {
    for (const locale of ['en', 'vi']) {
      const json = JSON.parse(read(`i18n/locales/${locale}.json`))
      const copy = json?.tmcut?.fxThumb?.previewOnly
      assert.equal(typeof copy, 'string', `${locale} is missing tmcut.fxThumb.previewOnly`)
      assert.ok(copy.length > 0, `${locale} ships an empty previewOnly string`)
    }
  })
})

describe('a pan control may only exist where playback applies pan', () => {
  const timeline = read('app/components/tmcut/TmcutTimeline.vue')
  const project = read('app/composables/useTmcutProject.ts')
  const player = read('app/components/tmcut/TmcutPreviewPlayer.vue')

  it('the timeline renders no pan input while the mixer has no panner', () => {
    assert.doesNotMatch(timeline, /track-pan-/, 'the pan input is still rendered')
    assert.doesNotMatch(timeline, /updateTrackPan/, 'the pan setter is still wired to a control')
  })

  it('the pan FIELD survives, so an opened project keeps its stored value', () => {
    assert.match(project, /pan\?: number/, 'the Pan field left the project schema')
    assert.match(project, /function updateTrackPan/, 'the setter left the store, so old data has no path')
  })

  it('the player says pan is not applied instead of dropping it in silence', () => {
    assert.match(player, /pan/i, 'the player no longer mentions pan at all')
    assert.match(player, /not applied|no stereo field|chưa áp dụng/i, 'the player does not say pan is unapplied')
  })
})

describe('the footer names the engine that actually runs', () => {
  const workspace = read('app/components/tmcut/TmcutEditorWorkspace.vue')

  it('it does not advertise a GPU renderer the app does not have', () => {
    // docs/audit/playback-buffering-audit.md, "The two engine labels are one
    // layer": `'gpu' in navigator` says what the browser could run, not what
    // this editor paints with. There is no WebGPU/WebGL2 renderer in app/.
    assert.doesNotMatch(workspace, /hasWebGPU/, 'the footer still sniffs for a GPU backend')
    assert.doesNotMatch(workspace, /'WebGPU'|"WebGPU"|`WebGPU/, 'the footer still claims WebGPU')
    assert.doesNotMatch(workspace, /'WebGL'|"WebGL"|`WebGL/, 'the footer still claims WebGL')
  })

  it('it names the preview engine and the encoder that do run', () => {
    assert.match(workspace, /t\('tmcut\.workspace\.engineLabel'\)/)
    for (const locale of ['en', 'vi']) {
      const label = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.workspace?.engineLabel
      assert.equal(typeof label, 'string', `${locale} is missing tmcut.workspace.engineLabel`)
      assert.match(label, /WebCodecs/, `${locale} must name the encoder that writes the file`)
      assert.doesNotMatch(label, /WebGPU|WebGL/, `${locale} must not name a renderer that does not run`)
    }
  })
})
