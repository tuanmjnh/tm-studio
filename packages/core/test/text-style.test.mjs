// tmcut-core — text style tests. Run: node --test test/
//
// The numbers below are written out, not re-derived from the functions: a test
// that recomputes `fontSize / 18` would pass even if the law changed, and the
// whole point of this module is that the law can only change HERE.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  textBoxPadding,
  textShadowOffset,
  textStrokeWidth
} from '../src/textStyle.mjs'
import { addClip } from '../src/timeline.mjs'
import { defaultTimeline, migrateV1ToV3 } from '../src/project.mjs'

describe('text style defaults', () => {
  it('pins the fallback font size and glyph colour', () => {
    assert.equal(DEFAULT_TEXT_FONT_SIZE, 36)
    assert.equal(DEFAULT_TEXT_COLOR, '#ffffff')
  })
})

describe('text style metrics', () => {
  it('stroke width: drawtext borderw at the sizes the app actually uses', () => {
    assert.equal(textStrokeWidth(36), 2)
    assert.equal(textStrokeWidth(27), 2) // 1.5 rounds up
    assert.equal(textStrokeWidth(26), 1) // 1.44 rounds down
    assert.equal(textStrokeWidth(17), 1)
  })

  it('shadow offset: drawtext shadowx/shadowy and CSS text-shadow', () => {
    assert.equal(textShadowOffset(36), 3)
    assert.equal(textShadowOffset(21), 2) // 1.5 rounds up
    assert.equal(textShadowOffset(10), 1)
  })

  it('box padding: drawtext boxborderw and the preview plate padding', () => {
    assert.equal(textBoxPadding(36), 9)
    assert.equal(textBoxPadding(10), 3) // 2.5 rounds up
    assert.equal(textBoxPadding(9), 2)
    assert.equal(textBoxPadding(4), 2)
  })

  it('never returns below its floor, whatever the font size', () => {
    for (const fontSize of [0, 1, 2, 3, -20]) {
      assert.ok(textStrokeWidth(fontSize) >= 1, `stroke floored at ${fontSize}`)
      assert.ok(textShadowOffset(fontSize) >= 1, `shadow floored at ${fontSize}`)
      assert.ok(textBoxPadding(fontSize) >= 2, `padding floored at ${fontSize}`)
    }
  })

  it('grows with the font size instead of oscillating at the edges', () => {
    let stroke = 0
    let shadow = 0
    let padding = 0
    for (let fontSize = 1; fontSize <= 200; fontSize += 1) {
      const nextStroke = textStrokeWidth(fontSize)
      const nextShadow = textShadowOffset(fontSize)
      const nextPadding = textBoxPadding(fontSize)
      assert.ok(nextStroke >= stroke, `stroke fell at ${fontSize}`)
      assert.ok(nextShadow >= shadow, `shadow fell at ${fontSize}`)
      assert.ok(nextPadding >= padding, `padding fell at ${fontSize}`)
      stroke = nextStroke
      shadow = nextShadow
      padding = nextPadding
    }
  })
})

describe('text style law seeds the clip factories', () => {
  it('addClip puts the law on a text clip that carries no style', () => {
    const timeline = defaultTimeline()
    const clip = addClip(timeline, 'text', { text: 'hello', offset: 0 })
    assert.equal(clip.color, DEFAULT_TEXT_COLOR)
    assert.equal(clip.fontSize, DEFAULT_TEXT_FONT_SIZE)
  })

  it('addClip keeps an author style instead of overwriting it', () => {
    const timeline = defaultTimeline()
    const clip = addClip(timeline, 'text', { text: 'hi', color: '#ff0000', fontSize: 72 })
    assert.equal(clip.color, '#ff0000')
    assert.equal(clip.fontSize, 72)
  })

  it('a v1 migration fills the same two fields from the same law', () => {
    const v3 = migrateV1ToV3({
      id: 'p1',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: { tracks: [{ id: 't1', type: 'text', items: [{ id: 'c1', text: 'x', in: 0, out: 2 }] }] }
    })
    const clip = v3.timeline.tracks[0].items[0]
    assert.equal(clip.color, DEFAULT_TEXT_COLOR)
    assert.equal(clip.fontSize, DEFAULT_TEXT_FONT_SIZE)
  })

  it('a v1 migration keeps an author style', () => {
    const v3 = migrateV1ToV3({
      id: 'p1',
      canvas: { width: 1920, height: 1080, fps: 30 },
      timeline: { tracks: [{ id: 't1', type: 'text', items: [{ id: 'c1', text: 'x', color: '#123456', fontSize: 54 }] }] }
    })
    const clip = v3.timeline.tracks[0].items[0]
    assert.equal(clip.color, '#123456')
    assert.equal(clip.fontSize, 54)
  })
})
