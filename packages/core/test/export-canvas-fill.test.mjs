// tmcut-core — the colour a painted export frame starts from. Run: node --test test/
//
// `planEncodePlate` says where one layer lands; it says nothing about what is
// UNDER it. A painter that forgets to clear re-uses the previous frame's pixels
// and ships a file whose motion is a smear, so the frame must start from the
// canvas background — and the colour of that background is a rule with three
// readers today: the preview's CSS (`bgStyle.backgroundColor = bg.value ||
// '#000000'`), the FFmpeg chain (`buildBackgroundSource`, which defaults to
// `color=c=0x000000` and blanks to black through `toFfmpegColor`), and a canvas
// `fillStyle`, which is a fourth language: it eats `#101820` and `red`, and
// silently keeps the old colour for anything it does not parse.
//
// So the painter gets the answer from core rather than reading the canvas itself.
// `null` is part of the law: it means "there is no colour that paints this
// background correctly", and it is reserved for exactly the two shapes
// `planEncodeContent` refuses — `transparent` (no alpha in the preset ladder) and
// a real `image` (no decoder-fed cover fit yet). A non-null answer therefore
// always comes with an eligible project, and that pairing is asserted below so
// the two laws cannot drift apart.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '../src/time.mjs'
import { encodeCanvasFill, planEncodeContent } from '../src/exportContent.mjs'

const T = TICKS_PER_SECOND
const FPS_30 = Object.freeze({ numerator: 30, denominator: 1 })

function projectWithBackground(background) {
  return {
    version: 3,
    canvas: { width: 1920, height: 1080, fps: FPS_30, background },
    markers: [],
    tracks: [{
      id: 'row-a',
      type: 'video',
      items: [{
        id: 'a',
        type: 'video',
        locator: { runtime: 'local', path: 'C:/media/a.mp4' },
        source: { in: 0, out: 4 * T },
        timeline: { start: 0, duration: 4 * T },
        speed: 1,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
        effects: [],
        keyframes: []
      }]
    }]
  }
}

describe('encodeCanvasFill — the frame the painter starts from', () => {
  it('an authored colour is the fill, unchanged', () => {
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: '#101820' } }), '#101820')
    // A named colour is legal in CSS and in FFmpeg, so neither counterpart
    // rewrites it and the painter must not either.
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: 'red' } }), 'red')
  })

  it('no background at all is black, in both counterparts', () => {
    // `buildBackgroundSource` defaults to `#000000` when the canvas carries no
    // background; a file painted any other way is a different picture.
    assert.equal(encodeCanvasFill({}), '#000000')
    assert.equal(encodeCanvasFill({ background: null }), '#000000')
    assert.equal(encodeCanvasFill(null), '#000000')
  })

  it('a blank colour value is black, not an unparsed fillStyle', () => {
    // Canvas keeps the PREVIOUS colour when handed something it cannot parse, so
    // a blank value must be resolved here rather than passed along.
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: '' } }), '#000000')
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: '   ' } }), '#000000')
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: 12345 } }), '#000000')
    assert.equal(encodeCanvasFill({ background: { type: 'color' } }), '#000000')
  })

  it('the FFmpeg spelling of a colour becomes the canvas spelling', () => {
    // `toFfmpegColor` accepts `0x123456`, so a project can hold that shape — and
    // a canvas cannot. Both spellings name one colour; the file must not be a
    // different one from the preview because of a syntax the painter never read.
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: '0x123456' } }), '#123456')
    assert.equal(encodeCanvasFill({ background: { type: 'color', value: ' 0xff0000 ' } }), '#ff0000')
  })

  it('a transparent canvas has no colour answer', () => {
    // Refused as `background-transparent` (H3d-2b): the preset ladder has no
    // alpha, so black would be a promise the file cannot keep.
    assert.equal(encodeCanvasFill({ background: { type: 'transparent', value: '#101820' } }), null)
  })

  it('an image background has no colour answer, and a blank one is black', () => {
    // `planEncodeContent` refuses a real image; the FFmpeg chain falls back to a
    // black source when the path is blank, and so does the painter.
    assert.equal(encodeCanvasFill({ background: { type: 'image', value: 'C:/bg.png' } }), null)
    assert.equal(encodeCanvasFill({ background: { type: 'image', value: '  ' } }), '#000000')
  })

  it('an unknown background type is the colour branch, as both counterparts read it', () => {
    // `buildBackgroundSource` falls through to the colour branch, the preview
    // paints nothing (so the box shows black); the painter follows the file.
    assert.equal(encodeCanvasFill({ background: { type: 'gradient', value: '#101820' } }), '#101820')
  })

  it('a fill this module can answer for never comes with a refused background', () => {
    // The pairing that keeps the two laws honest: `null` exactly when the
    // content law names a background reason, a colour exactly when it does not.
    const shapes = [
      undefined,
      { type: 'color', value: '#101820' },
      { type: 'transparent' },
      { type: 'image', value: 'C:/bg.png' },
      { type: 'image', value: '' }
    ]
    for (const background of shapes) {
      const verdict = planEncodeContent(projectWithBackground(background))
      const refused = verdict.reasons.some(reason => reason.startsWith('background-'))
      const fill = encodeCanvasFill({ background })
      if (refused) {
        assert.equal(fill, null,
          `${JSON.stringify(background)} is refused (${verdict.reasons}) and must not get a colour`)
      } else {
        assert.notEqual(fill, null,
          `a project with no background refusal (${JSON.stringify(background)}) must get a colour`)
      }
    }
  })
})
