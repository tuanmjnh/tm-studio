/**
 * Starter invariants for the HTML/CSS video studio (app/utils/tmcut/htmlVideoStarters).
 *
 * A starter is only useful if it survives the same gate the render endpoint
 * applies to user input: the composition root, the `__hf` seek contract, a
 * duration inside the limits, and every `{{token}}` declared as a variable.
 * These checks pin that for the whole set — a new starter that forgets one of
 * them fails here instead of at render time, minutes later, on a black frame.
 *
 * Run: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.test.json \
 *        tests/unit/tmcut_html_video_starters.spec.ts
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { HTML_VIDEO_STARTERS, buildHtmlVideoPreviewDocument, htmlVideoStarter } from '../../app/utils/tmcut/htmlVideoStarters'
// The core is imported from source: the test runner does not resolve the app's
// `@tmcut-core` alias, and dist/ is a build artifact.
import {
  collectHtmlTokens,
  htmlVideoPreset,
  INDUSTRY_CATALOG,
  lintHtmlVideo,
  replaceHtmlTokens,
  validateHtmlVideoSpec
} from '../../../tmcut-core/src/index.mjs'

function fill(starter: (typeof HTML_VIDEO_STARTERS)[number]): string {
  const values: Record<string, string> = {}
  for (const variable of starter.variables) values[variable.key] = variable.value
  return replaceHtmlTokens(starter.html, values)
}

describe('HTML video starters — renderable out of the box', () => {
  it('ships a non-empty set with unique ids', () => {
    assert.ok(HTML_VIDEO_STARTERS.length >= 6)
    const ids = HTML_VIDEO_STARTERS.map(starter => starter.id)
    assert.equal(new Set(ids).size, ids.length)
    for (const starter of HTML_VIDEO_STARTERS) {
      assert.ok(starter.html.trim().length > 200, `${starter.id} html is too small`)
      assert.ok(starter.name && starter.summary, `${starter.id} needs a name and summary`)
    }
  })

  it('declares a variable for every {{token}} it uses', () => {
    for (const starter of HTML_VIDEO_STARTERS) {
      const declared = new Set(starter.variables.map(variable => variable.key))
      for (const token of collectHtmlTokens(starter.html)) {
        assert.ok(declared.has(token), `${starter.id} uses {{${token}}} without declaring it`)
      }
      for (const variable of starter.variables) {
        assert.ok(variable.label, `${starter.id}.${variable.key} needs a label`)
        assert.equal(typeof variable.value, 'string')
      }
    }
  })

  it('passes the render validation with its own defaults', () => {
    for (const starter of HTML_VIDEO_STARTERS) {
      const check = validateHtmlVideoSpec({
        html: fill(starter),
        width: starter.width,
        height: starter.height,
        fps: starter.fps,
        durationSec: starter.durationSec
      })
      assert.deepEqual(check.errors, [], `${starter.id} fails validation`)
      assert.deepEqual(check.warnings, [], `${starter.id} warns at render time`)
      assert.equal(check.frames, Math.round(starter.durationSec * starter.fps))
    }
  })

  it('keeps duration, data-duration and __hf.duration in agreement', () => {
    for (const starter of HTML_VIDEO_STARTERS) {
      const html = fill(starter)
      assert.match(html, new RegExp(`data-duration="${starter.durationSec}"`), `${starter.id} data-duration`)
      assert.match(html, new RegExp(`var DURATION = ${starter.durationSec};`), `${starter.id} DURATION`)
      assert.match(html, /window\.__hf = \{ duration: DURATION, seek: seek \}/, `${starter.id} __hf wiring`)
    }
  })

  it('matches its declared aspect preset', () => {
    for (const starter of HTML_VIDEO_STARTERS) {
      const preset = htmlVideoPreset(starter.aspect)
      assert.ok(preset, `${starter.id} has an unknown aspect`)
      assert.equal(starter.width, preset!.width, `${starter.id} width`)
      assert.equal(starter.height, preset!.height, `${starter.id} height`)
    }
  })

  it('is deterministic and offline: no rAF, no Math.random, no remote scripts', () => {
    for (const starter of HTML_VIDEO_STARTERS) {
      assert.doesNotMatch(starter.html, /requestAnimationFrame\s*\(/, `${starter.id} uses rAF`)
      assert.doesNotMatch(starter.html, /Math\.random\s*\(/, `${starter.id} uses Math.random`)
      assert.doesNotMatch(starter.html, /<script[^>]+src\s*=/i, `${starter.id} loads a remote script`)
      assert.doesNotMatch(starter.html, /setInterval\s*\(/, `${starter.id} uses a wall-clock timer`)
      assert.deepEqual(
        lintHtmlVideo(fill(starter)).filter(issue => issue.level === 'error'),
        [],
        `${starter.id} has a lint error`
      )
    }
  })

  it('looks up by id and rejects unknown ids', () => {
    assert.equal(htmlVideoStarter('kinetic-title')?.id, 'kinetic-title')
    assert.equal(htmlVideoStarter('nope'), null)
  })
})

describe('HTML video starters — industry coverage', () => {
  const catalog = new Set(INDUSTRY_CATALOG.map((meta: { id: string }) => meta.id))

  it('only claims industries that exist in the catalog', () => {
    for (const starter of HTML_VIDEO_STARTERS) {
      assert.ok(starter.industries.length > 0, `${starter.id} claims no industry`)
      assert.equal(
        new Set(starter.industries).size,
        starter.industries.length,
        `${starter.id} lists an industry twice`
      )
      for (const id of starter.industries) {
        assert.ok(catalog.has(id), `${starter.id} claims unknown industry "${id}"`)
      }
    }
  })

  it('covers every catalog industry with at least one starter', () => {
    const covered = new Set(HTML_VIDEO_STARTERS.flatMap(starter => starter.industries))
    const missing = [...catalog].filter(id => !covered.has(id as string))
    assert.deepEqual(missing, [], `no starter for: ${missing.join(', ')}`)
  })
})

describe('HTML video preview bridge', () => {
  const starter = HTML_VIDEO_STARTERS[0]!
  const document = buildHtmlVideoPreviewDocument(fill(starter))

  it('keeps the composition and appends a bridge', () => {
    assert.ok(document.startsWith(fill(starter)))
    assert.match(document, /hf:seek/)
    assert.match(document, /hf:ready/)
    assert.match(document, /hf:error/)
  })

  it('drives the public seek function, not a private hook', () => {
    assert.match(document, /window\.__hf\.seek/)
  })
})
