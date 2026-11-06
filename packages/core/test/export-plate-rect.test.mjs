// tmcut-core — export plate rect. Run: node --test test/
//
// The exporter's painter is one `drawImage` call, and that call takes two
// rectangles: which pixels of the decoded frame to read, and where on the canvas
// to put them. Both renderers already answer that question — `computeFitObjectStyle`
// for the preview's CSS, `buildFfmpegFitFilters` + `buildFfmpegTransform` for the
// file — so the third answer has to come from the same numbers or the export is a
// different video than the monitor showed. This file is where that is pinned.
//
// Every case is written as the rects themselves, not as a call into the FFmpeg
// builders: a test that re-ran those builders would pass even if the plate model
// drifted, and drift is exactly what parity against a real file measures.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planEncodePlate } from '../src/exportContent.mjs'

const CANVAS_16_9 = Object.freeze({ width: 1920, height: 1080 })

/** A plate ask; `layout`/`transform`/`opacity` fall back to the clip defaults. */
function plate(media, options = {}) {
  return planEncodePlate({ media, canvas: CANVAS_16_9, ...options })
}

describe('planEncodePlate — the four fits the painter owns', () => {
  it('fit of a 16:9 source into a 16:9 canvas is the whole frame at both ends', () => {
    assert.deepEqual(plate({ width: 640, height: 360 }), {
      source: { sx: 0, sy: 0, sw: 640, sh: 360 },
      dest: { dx: 0, dy: 0, dw: 1920, dh: 1080 },
      alpha: 1
    })
  })

  it('fit letterboxes a tall source: the source stays whole, the dest is centered', () => {
    // k = min(1920/960, 1080/1920) = 0.5625 → 540x1080, centered horizontally.
    assert.deepEqual(plate({ width: 960, height: 1920 }), {
      source: { sx: 0, sy: 0, sw: 960, sh: 1920 },
      dest: { dx: 690, dy: 0, dw: 540, dh: 1080 },
      alpha: 1
    })
  })

  it('fill crops the source to the canvas aspect and always covers the frame', () => {
    // The media is 1:2 and the canvas 16:9, so 540 of the 1920 source rows are
    // cropped away, centered — the same rect `scale=increase,crop=W:H` reads.
    assert.deepEqual(plate({ width: 960, height: 1920 }, { layout: { fit: 'fill' } }), {
      source: { sx: 0, sy: 690, sw: 960, sh: 540 },
      dest: { dx: 0, dy: 0, dw: 1920, dh: 1080 },
      alpha: 1
    })
  })

  it('fill crops the other axis when the source is the wide one', () => {
    assert.deepEqual(plate({ width: 1920, height: 540 }, { layout: { fit: 'fill' } }), {
      source: { sx: 480, sy: 0, sw: 960, sh: 540 },
      dest: { dx: 0, dy: 0, dw: 1920, dh: 1080 },
      alpha: 1
    })
  })

  it('stretch ignores the source aspect entirely', () => {
    assert.deepEqual(plate({ width: 640, height: 480 }, { layout: { fit: 'stretch' } }), {
      source: { sx: 0, sy: 0, sw: 640, sh: 480 },
      dest: { dx: 0, dy: 0, dw: 1920, dh: 1080 },
      alpha: 1
    })
  })

  it('crop reads the cropRect out of the source and then fits it', () => {
    // 0.25..0.75 of a 1920x1080 frame is a 960x540 16:9 region — and a 16:9
    // region in a 16:9 canvas fills it, exactly as `crop=...,fit` does.
    assert.deepEqual(plate({ width: 1920, height: 1080 }, {
      layout: { fit: 'crop', cropRect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }
    }), {
      source: { sx: 480, sy: 270, sw: 960, sh: 540 },
      dest: { dx: 0, dy: 0, dw: 1920, dh: 1080 },
      alpha: 1
    })
  })

  it('a crop to a non-canvas aspect is letterboxed by the fit that follows it', () => {
    // Half the width of a 16:9 frame is a 960x1080 region; `crop=…,fit` scales
    // that to 960x1080 inside the canvas — the full height, bars at the sides.
    assert.deepEqual(plate({ width: 1920, height: 1080 }, {
      layout: { fit: 'crop', cropRect: { x: 0, y: 0, w: 0.5, h: 1 } }
    }), {
      source: { sx: 0, sy: 0, sw: 960, sh: 1080 },
      dest: { dx: 480, dy: 0, dw: 960, dh: 1080 },
      alpha: 1
    })
  })

  it('a cropRect of the whole frame crops nothing', () => {
    assert.deepEqual(
      plate({ width: 640, height: 360 }, { layout: { fit: 'crop', cropRect: { x: 0, y: 0, w: 1, h: 1 } } }),
      plate({ width: 640, height: 360 })
    )
  })

  it('an absent cropRect fits, the way both builders fall through', () => {
    assert.deepEqual(
      plate({ width: 640, height: 360 }, { layout: { fit: 'crop', cropRect: null } }),
      plate({ width: 640, height: 360 })
    )
  })

  it('an unknown fit mode paints like fit, because both builders fall through to it', () => {
    assert.deepEqual(
      plate({ width: 640, height: 360 }, { layout: { fit: 'sideways' } }),
      plate({ width: 640, height: 360 })
    )
  })

  it('smart has no plate at all: the focus-aware crop is what planEncodeContent refuses', () => {
    // Returning the fit rect here would silently letterbox a frame the monitor
    // cropped, so the answer is null and the caller has nothing to draw.
    assert.equal(plate({ width: 640, height: 360 }, { layout: { fit: 'smart', focusX: 0.2, focusY: 0.8 } }), null)
  })
})

describe('planEncodePlate — transform, alpha, and what it will not invent', () => {
  it('scale sizes the content around the canvas center, as the CSS and the overlay both do', () => {
    assert.deepEqual(plate({ width: 640, height: 360 }, {
      transform: { x: 0, y: 0, scaleX: 0.5, scaleY: 0.5 }
    }), {
      source: { sx: 0, sy: 0, sw: 640, sh: 360 },
      dest: { dx: 480, dy: 270, dw: 960, dh: 540 },
      alpha: 1
    })
  })

  it('x and y are canvas pixels added after the centering', () => {
    assert.deepEqual(plate({ width: 960, height: 1920 }, {
      transform: { x: -90, y: 40, scaleX: 1, scaleY: 1 }
    }).dest, { dx: 600, dy: 40, dw: 540, dh: 1080 })
  })

  it('the two axes scale independently, which the FFmpeg percent scale cannot say', () => {
    // Scaling past the canvas is not clamped away: the overlay and the CSS
    // `overflow: hidden` both crop the same way, so the box stays the size the
    // transform asked for and a negative offset is the honest answer.
    const flat = plate({ width: 640, height: 360 }, {
      transform: { x: 0, y: 0, scaleX: 2, scaleY: 0.5 }
    }).dest
    assert.deepEqual(flat, { dx: -960, dy: 270, dw: 3840, dh: 540 })
  })

  it('alpha is the layer opacity, clamped into the range the painter accepts', () => {
    assert.equal(plate({ width: 640, height: 360 }, { opacity: 0.4 }).alpha, 0.4)
    assert.equal(plate({ width: 640, height: 360 }, { opacity: 7 }).alpha, 1)
    assert.equal(plate({ width: 640, height: 360 }, { opacity: -2 }).alpha, 0)
    assert.equal(plate({ width: 640, height: 360 }, { opacity: 'x' }).alpha, 1)
  })

  it('rotation is not part of the plate, because the content law refuses the project first', () => {
    // The painter could rotate a canvas context; neither counterpart has been
    // measured against the file doing it, so the plate stays identity and
    // `planEncodeContent` is what stops such a project from getting here.
    assert.deepEqual(
      plate({ width: 640, height: 360 }, { transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 30 } }),
      plate({ width: 640, height: 360 })
    )
  })

  it('no media size means no plate, not a full-canvas guess', () => {
    for (const media of [null, undefined, {}, { width: 0, height: 1080 }, { width: 1920, height: Number.NaN }]) {
      assert.equal(plate(media), null, JSON.stringify(media))
    }
  })

  it('no canvas size means no plate either', () => {
    assert.equal(planEncodePlate({ media: { width: 640, height: 360 }, canvas: null }), null)
    assert.equal(planEncodePlate({ media: { width: 640, height: 360 }, canvas: { width: 1920 } }), null)
  })

  it('a degenerate scale gives a box the painter can still address, never a zero-sized one', () => {
    const tiny = plate({ width: 640, height: 360 }, {
      transform: { x: 0, y: 0, scaleX: 0, scaleY: 0 }
    })
    assert.ok(tiny.dest.dw >= 1 && tiny.dest.dh >= 1, JSON.stringify(tiny.dest))
  })
})
