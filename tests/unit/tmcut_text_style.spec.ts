/**
 * One text style law, read by both hosts (V4 Phase 2, DOM-renderer item).
 *
 * The preview paints a caption with CSS; the export paints it with drawtext
 * options. Before this slice the numbers that make both sides agree lived in
 * an app helper, so a second host had to copy them and copied arithmetic
 * drifts. They now live in `tmcut-core` (`textStyle.mjs`), which is also where
 * `addClip` and the v1 migration seed a clip's font size and colour.
 *
 * What is asserted, and how:
 *  1. the app no longer carries a local copy — the helper file is gone and no
 *     source imports it (a reintroduced copy is the regression this guards).
 *  2. both hosts read the names off `tmcut-core` (source-level: an import can
 *     only prove intent, so 3 carries the behaviour).
 *  3. the compiled drawtext string carries the core numbers for real font
 *     sizes — measured, not restated: the expected substrings come from the
 *     same core functions the compiler calls.
 *  4. the preview applies the same functions to the same clip field, and keeps
 *     no literal fallback of its own.
 *  5. the export's `white` and the core's `#ffffff` are the same colour, not
 *     two colours that happen to look alike in a test.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  textBoxPadding,
  textShadowOffset,
  textStrokeWidth
} from 'tmcut-core'
import { textOverlayFilter } from '../../app/utils/tmcut/render/text'
import type { TextOverlayClip } from '../../app/utils/tmcut/render/types'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXPORT_HOST = 'app/utils/tmcut/render/text.ts'
const PREVIEW_HOST = 'app/components/tmcut/TmcutPreviewPlayer.vue'

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

function styledClip(fontSize: number): TextOverlayClip {
  return {
    text: 'hello',
    fontSize,
    offset: 0,
    in: 0,
    out: 2,
    speed: 1,
    shadow: true,
    stroke: true,
    bgColor: '#101010'
  } as TextOverlayClip
}

describe('the text style law has one home', () => {
  it('the app helper is gone and nothing imports it', () => {
    assert.ok(
      !existsSync(join(ROOT, 'app', 'utils', 'tmcut', 'textStyle.ts')),
      'app/utils/tmcut/textStyle.ts came back — the numbers belong to tmcut-core'
    )
    for (const file of [EXPORT_HOST, PREVIEW_HOST]) {
      assert.ok(!read(file).includes('tmcut/textStyle'), `${file} still imports the retired helper`)
    }
  })

  it('both hosts take the numbers from tmcut-core', () => {
    for (const file of [EXPORT_HOST, PREVIEW_HOST]) {
      const source = read(file)
      const fromCore = /import\s*\{([^}]*)\}\s*from\s*'tmcut-core'/gs.exec(source)
        ?? /import\s*\{([^}]*)\}\s*from\s*'tmcut-core'/.exec(source)
      assert.ok(fromCore, `${file} has no tmcut-core import to read the law from`)
      const names = fromCore[1].split(',').map(part => part.trim()).filter(Boolean)
      for (const needed of ['textBoxPadding', 'textStrokeWidth', 'textShadowOffset', 'DEFAULT_TEXT_FONT_SIZE']) {
        assert.ok(names.includes(needed), `${file} does not import ${needed} from tmcut-core`)
      }
    }
  })
})

describe('the export paints the core numbers', () => {
  for (const fontSize of [24, 36, 54, 72]) {
    it(`drawtext carries the core metrics at ${fontSize}px`, () => {
      const filter = textOverlayFilter(styledClip(fontSize))
      assert.ok(filter.includes(`fontsize=${fontSize}`), filter)
      assert.ok(
        filter.includes(`shadowx=${textShadowOffset(fontSize)}:shadowy=${textShadowOffset(fontSize)}`),
        `shadow offset is not the core number at ${fontSize}px: ${filter}`
      )
      assert.ok(
        filter.includes(`borderw=${textStrokeWidth(fontSize)}`),
        `stroke width is not the core number at ${fontSize}px: ${filter}`
      )
      assert.ok(
        filter.includes(`boxborderw=${textBoxPadding(fontSize)}`),
        `plate padding is not the core number at ${fontSize}px: ${filter}`
      )
    })
  }

  it('a clip with no style falls back to the core default size', () => {
    const filter = textOverlayFilter({ text: 'plain', offset: 0, in: 0, out: 1 } as TextOverlayClip)
    assert.ok(filter.includes(`fontsize=${DEFAULT_TEXT_FONT_SIZE}`), filter)
  })

  it('the export spells the core colour in FFmpeg syntax, same value', () => {
    // FFmpeg takes a colour name; CSS takes the hex. The law is the RGB, so
    // decode both spellings instead of trusting that "white" looks like "#ffffff".
    const filter = textOverlayFilter({ text: 'plain', offset: 0, in: 0, out: 1 } as TextOverlayClip)
    const [, spelled] = /fontcolor=(\w+)/.exec(filter) ?? []
    assert.equal(spelled, 'white')
    assert.equal(namedColorToHex(spelled), DEFAULT_TEXT_COLOR.toLowerCase())
  })
})

describe('the preview reads the same law', () => {
  const source = read(PREVIEW_HOST)

  it('the style block calls the core functions on the clip font size', () => {
    assert.ok(source.includes('textShadowOffset(fontSize)'), 'preview no longer derives the shadow from core')
    assert.ok(source.includes('textStrokeWidth(fontSize)'), 'preview no longer derives the stroke from core')
    assert.ok(source.includes('textBoxPadding(fontSize)'), 'preview no longer derives the plate from core')
  })

  it('the preview keeps no literal fallback of its own', () => {
    assert.ok(!/\|\|\s*36\b/.test(source), 'a `|| 36` font-size copy is back in the preview')
    assert.ok(!/\|\|\s*'#ffffff'/.test(source), 'a `|| \'#ffffff\'` colour copy is back in the preview')
    // F7: the preview no longer holds the clip in hand — it holds core's
    // `layer.text`, whose colour fields are null when unauthored. The fallback
    // is still core's constant, which is what this guard has always protected.
    assert.ok(source.includes('const text = layer.text'), 'the fallback is no longer taken from core answered text')
    assert.ok(source.includes('text.fontSize || DEFAULT_TEXT_FONT_SIZE'), 'the size fallback is not the core constant')
    assert.ok(source.includes('text.color || DEFAULT_TEXT_COLOR'), 'the colour fallback is not the core constant')
  })

  it('one clip field feeds both hosts', () => {
    // The export reads clip.fontSize, the preview reads textClip.fontSize — and
    // both default the same way, so an unsigned project cannot disagree.
    assert.ok(read(EXPORT_HOST).includes('clip.fontSize || DEFAULT_TEXT_FONT_SIZE'))
  })
})

/** The CSS named colours this repo's text defaults can land on. */
const CSS_NAMED_COLORS: Record<string, string> = {
  white: '#ffffff',
  black: '#000000'
}

function namedColorToHex(name: string): string {
  const hex = CSS_NAMED_COLORS[name.toLowerCase()]
  assert.ok(hex, `unknown colour spelling in the export filter: ${name}`)
  return hex
}
