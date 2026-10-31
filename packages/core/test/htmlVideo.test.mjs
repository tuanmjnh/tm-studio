import test from 'node:test'
import assert from 'node:assert/strict'
import {
  HTML_VIDEO_LIMITS,
  HTML_VIDEO_PRESETS,
  collectHtmlTokens,
  frameCountFor,
  frameTimes,
  htmlVideoEscape,
  htmlVideoPreset,
  isAllowedRenderUrl,
  isBlockedRenderHost,
  lintHtmlVideo,
  replaceHtmlTokens,
  unresolvedHtmlTokens,
  validateHtmlVideoSpec
} from '../src/index.mjs'

/** Minimal composition that satisfies both lint gates. */
function spec(overrides = {}) {
  return {
    width: 1080,
    height: 1920,
    fps: 30,
    durationSec: 5,
    html: [
      '<!doctype html><html><body>',
      '<div data-composition-id="t" data-duration="5">',
      '<h1 id="title">Hello</h1>',
      '</div>',
      '<script>',
      'window.__hf = { duration: 5, seek: function (t) {',
      '  document.getElementById("title").style.opacity = String(Math.min(1, t));',
      '} };',
      '</script>',
      '</body></html>'
    ].join('\n'),
    ...overrides
  }
}

test('html video: presets are unique and resolve by id', () => {
  const ids = HTML_VIDEO_PRESETS.map(p => p.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const preset of HTML_VIDEO_PRESETS) {
    assert.ok(preset.width > 0 && preset.height > 0)
    assert.deepEqual(htmlVideoPreset(preset.id), preset)
  }
  assert.equal(htmlVideoPreset('nope'), null)
})

test('html video: frame math is exact at the boundaries', () => {
  assert.equal(frameCountFor(5, 30), 150)
  assert.equal(frameCountFor(0.5, 24), 12)
  assert.equal(frameCountFor(0, 30), 0)
  assert.equal(frameCountFor(NaN, 30), 0)
  const times = frameTimes(2, 30)
  assert.equal(times.length, 60)
  assert.equal(times[0], 0)
  assert.equal(times[59], 59 / 30)
  assert.ok(times[59] < 2, 'the last frame starts before the duration ends')
})

test('html video: a well-formed spec validates and reports frames', () => {
  const result = validateHtmlVideoSpec(spec())
  assert.deepEqual(result.errors, [], 'expected no errors')
  assert.equal(result.valid, true)
  assert.equal(result.frames, 150)
})

test('html video: missing composition root is an error, not a warning', () => {
  const result = validateHtmlVideoSpec(spec({ html: '<html><body><h1>x</h1></body></html>' }))
  assert.equal(result.valid, false)
  assert.match(result.errors.join(' '), /missing-composition-root/)
  assert.match(result.errors.join(' '), /missing-seek-contract/)
})

test('html video: canvas and duration limits are enforced', () => {
  assert.equal(validateHtmlVideoSpec(spec({ width: 10 })).valid, false)
  assert.equal(validateHtmlVideoSpec(spec({ fps: 0 })).valid, false)
  assert.equal(validateHtmlVideoSpec(spec({ durationSec: 0.1 })).valid, false)
  // 120 s × 60 fps = 7200 frames, above the 3600-frame capture ceiling.
  const tooLong = validateHtmlVideoSpec(spec({ fps: 60, durationSec: 120 }))
  assert.equal(tooLong.valid, false)
  assert.match(tooLong.errors.join(' '), /frame limit/)
  // 60 fps is fine when the frame budget holds.
  assert.equal(validateHtmlVideoSpec(spec({ fps: 60, durationSec: 30 })).valid, true)
})

test('html video: oversized documents are refused before any browser starts', () => {
  const huge = spec({ html: `${spec().html}<!--${'x'.repeat(HTML_VIDEO_LIMITS.maxHtmlBytes)}-->` })
  const result = validateHtmlVideoSpec(huge)
  assert.equal(result.valid, false)
  assert.match(result.errors.join(' '), /byte limit/)
})

test('html video: non-deterministic authoring is warned, not silently accepted', () => {
  const result = validateHtmlVideoSpec(spec({
    html: spec().html
      .replace('<h1 id="title">Hello</h1>', '<h1 id="title">Hello</h1><script>requestAnimationFrame(function f(){})</script>')
      .replace('String(Math.min(1, t))', 'String(Math.random())')
  }))
  const codes = result.warnings.join(' ')
  assert.match(codes, /requestAnimationFrame|unseeded-random/)
  assert.match(codes, /unseeded-random/)
  // Warnings alone never block a render.
  assert.equal(result.valid, true)
})

test('html video: variables are escaped, unknown tokens stay visible', () => {
  const html = '<h1>{{title}}</h1><p>{{missing}}</p>'
  assert.deepEqual(collectHtmlTokens(html), ['missing', 'title'])
  assert.equal(replaceHtmlTokens(html, { title: '<b>Hi & bye</b>' }), '<h1>&lt;b&gt;Hi &amp; bye&lt;/b&gt;</h1><p>{{missing}}</p>')
  assert.deepEqual(unresolvedHtmlTokens(html, { title: 'x' }), ['missing'])
  assert.equal(htmlVideoEscape(null), '')
  // Unfilled slots are reported by lint so the studio can ask for them.
  assert.ok(lintHtmlVideo(html).some(issue => issue.code === 'unresolved-token'))
})

test('html video: variable payloads must be flat primitives', () => {
  assert.equal(validateHtmlVideoSpec(spec({ variables: { title: 'ok', n: 3, flag: true } })).valid, true)
  assert.equal(validateHtmlVideoSpec(spec({ variables: { bad: { nested: 1 } } })).valid, false)
  assert.equal(validateHtmlVideoSpec(spec({ variables: { 'bad key': 'x' } })).valid, false)
  assert.equal(validateHtmlVideoSpec(spec({ variables: [] })).valid, false)
})

test('html video: remote URL policy blocks SSRF targets even when remote is allowed', () => {
  for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.1.1', '169.254.169.254', 'metadata.google.internal', '::1', 'printer.local']) {
    assert.equal(isBlockedRenderHost(host), true, `${host} must be blocked`)
  }
  assert.equal(isBlockedRenderHost('example.com'), false)

  assert.equal(isAllowedRenderUrl('data:image/png;base64,AAAA'), true)
  assert.equal(isAllowedRenderUrl('about:blank'), true)
  assert.equal(isAllowedRenderUrl('https://example.com/a.js'), false, 'remote is opt-in')
  assert.equal(isAllowedRenderUrl('https://example.com/a.js', true), true)
  assert.equal(isAllowedRenderUrl('http://127.0.0.1:4000/api', true), false)
  assert.equal(isAllowedRenderUrl('file:///C:/secret.txt', true), false)
  assert.equal(isAllowedRenderUrl('not a url', true), false)
})
