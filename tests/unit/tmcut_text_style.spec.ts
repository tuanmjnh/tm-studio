/**
 * One text style law, read by both hosts (V4 Phase 2, DOM-renderer item).
 *
 * The preview paints a caption with CSS; the FFmpeg export used to paint it
 * with drawtext options. Before this slice the numbers that make both sides
 * agree lived in an app helper, so a second host had to copy them and copied
 * arithmetic drifts. They now live in `tmcut-core` (`textStyle.mjs`), which is
 * also where `addClip` and the v1 migration seed a clip's font size and colour.
 *
 * Slice I deleted the drawtext emitter with the rest of the engine, so the
 * export leg of this law is gone rather than copied. What remains is the
 * single-source claim, and it is worth keeping: the FFmpeg branch had 4
 * separate metrics pinned per font size, and a re-added painter would have to
 * answer those same four from core.
 *
 *  1. the app no longer carries a local copy — the helper file is gone and no
 *     source imports it (a reintroduced copy is the regression this guards).
 *  2. the preview reads the numbers off `tmcut-core` and applies them to the
 *     same clip field the store seeds.
 *  3. the export's answer about a caption is a NAMED refusal, so a project
 *     with text cannot be silently rendered without it.
 *  4. the seeded defaults are core's, not a literal in the store or a migration.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_text_style.spec.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  planEncodeContent,
  textBoxPadding,
  textShadowOffset,
  textStrokeWidth
} from 'tmcut-core'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PREVIEW_HOST = 'app/components/tmcut/TmcutPreviewPlayer.vue'
const STORE = 'app/composables/useTmcutProject.ts'

function read(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

describe('the text style law has one home', () => {
  it('the app helper is gone and nothing imports it', () => {
    assert.ok(
      !existsSync(join(ROOT, 'app', 'utils', 'tmcut', 'textStyle.ts')),
      'app/utils/tmcut/textStyle.ts came back — the numbers belong to tmcut-core'
    )
    for (const file of [PREVIEW_HOST, STORE]) {
      assert.ok(!read(file).includes('tmcut/textStyle'), `${file} still imports the retired helper`)
    }
  })

  it('the preview takes the numbers from tmcut-core', () => {
    const source = read(PREVIEW_HOST)
    const fromCore = /import\s*\{([^}]*)\}\s*from\s*'tmcut-core'/s.exec(source)
    assert.ok(fromCore, `${PREVIEW_HOST} has no tmcut-core import to read the law from`)
    const names = fromCore![1]!.split(',').map(part => part.trim()).filter(Boolean)
    for (const needed of ['textBoxPadding', 'textStrokeWidth', 'textShadowOffset', 'DEFAULT_TEXT_FONT_SIZE']) {
      assert.ok(names.includes(needed), `${PREVIEW_HOST} does not import ${needed} from tmcut-core`)
    }
  })

  it('the four metrics stay a real function of the font size', () => {
    // The drawtext branch pinned these numbers per size (24/36/54/72). The law
    // still owes them; nothing may flatten them into constants.
    for (const fontSize of [24, 36, 54, 72]) {
      assert.ok(textStrokeWidth(fontSize) > 0, `stroke at ${fontSize}px`)
      assert.ok(textShadowOffset(fontSize) > 0, `shadow at ${fontSize}px`)
      assert.ok(textBoxPadding(fontSize) > 0, `plate padding at ${fontSize}px`)
    }
    assert.ok(textStrokeWidth(72) > textStrokeWidth(24), 'the stroke scales with the type')
    assert.ok(textBoxPadding(72) > textBoxPadding(24), 'so does the plate')
    assert.equal(DEFAULT_TEXT_FONT_SIZE, 36)
    assert.equal(DEFAULT_TEXT_COLOR.toLowerCase(), '#ffffff')
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
})

describe('the export names a caption instead of dropping it', () => {
  it('a project with a text row is refused as `text`', () => {
    const project = {
      canvas: { width: 64, height: 36, fps: 30 },
      timeline: {
        tracks: [
          { id: 'v1', type: 'video', items: [{ id: 'a', src: 'a.mp4', in: 0, out: 120000, offset: 0, speed: 1 }] },
          { id: 't1', type: 'text', items: [{ id: 'cap', text: 'hello', in: 0, out: 120000, offset: 0 }] }
        ]
      }
    }
    const verdict = planEncodeContent(project)
    assert.equal(verdict.kind, 'refused')
    assert.deepEqual([...verdict.reasons], ['text'], 'a caption the painter cannot draw is a named refusal')
  })
})
