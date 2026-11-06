// tmcut-core — export content eligibility. Run: node --test test/
//
// Slice H3d gives `createEncodeSession` its first caller. H3c proved the seam can
// turn samples into a file; it said nothing about which projects the app may hand
// it, and the answer is not "all of them": the preview paints a composite with DOM
// surfaces (§52.7 — there is no pixel compositor in `app/`), so a WebCodecs
// exporter has to paint each frame itself, and a plain `drawImage` plate covers
// only part of what a project can ask for.
//
// The refusal list is therefore a law with a name per line, owned by core, and it
// is checked against the authored timeline — the same facts the DOM surfaces and
// the FFmpeg chain read — so the exporter can never paint a project the preview
// would show differently. A caller that guesses "probably fine" is the failure
// mode this file exists to prevent: an export that silently drops captions is
// worse than an export that refuses and tells the user which clip to fix.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { TICKS_PER_SECOND } from '../src/time.mjs'
import { createFrameScheduler } from '../src/scheduler.mjs'
import { planEncodeContent } from '../src/exportContent.mjs'

const T = TICKS_PER_SECOND

/** A footage/text/audio clip; `at`/`forSeconds` are whole seconds. */
function clip(id, at = 0, forSeconds = 4, overrides = {}) {
  return {
    id,
    type: 'video',
    locator: { runtime: 'local', path: `C:/media/${id}.mp4` },
    source: { in: 0, out: forSeconds * T },
    timeline: { start: at * T, duration: forSeconds * T },
    speed: 1,
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    effects: [],
    keyframes: [],
    ...overrides
  }
}

const FPS_30 = Object.freeze({ numerator: 30, denominator: 1 })

function projectOf(tracks, canvas = { width: 1920, height: 1080, fps: FPS_30 }) {
  return {
    version: 3,
    canvas,
    markers: [],
    tracks: tracks.map(([id, items, overrides]) => ({ id, type: 'video', items, ...overrides }))
  }
}

describe('planEncodeContent — the frame grid the seam is owed', () => {
  it('a single footage row is eligible and reports the grid core already counts', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6)]]])
    const verdict = planEncodeContent(project)
    const scheduler = createFrameScheduler(project, { rate: FPS_30 })
    assert.equal(verdict.kind, 'eligible')
    assert.deepEqual(verdict.reasons, [])
    assert.equal(verdict.totalFrames, scheduler.frameCount)
    assert.equal(verdict.contentEndTicks, scheduler.endTicks)
    assert.equal(verdict.durationSec, 6)
  })

  it('the encode request carries the canvas size and the canvas rate, unchanged', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6)]]], {
      width: 1080, height: 1920, fps: { numerator: 30000, denominator: 1001 }
    })
    const verdict = planEncodeContent(project)
    assert.deepEqual(verdict.request.width, 1080)
    assert.deepEqual(verdict.request.height, 1920)
    assert.deepEqual(verdict.request.fps, { numerator: 30000, denominator: 1001 })
  })

  it('a file with sound asks for the audio config this runtime answered true to', () => {
    // Measured §49.4/§52.1: on this machine `mp4a.40.2` answers supported at
    // 48 000 Hz stereo and unsupported at 22 050 and 32 000.
    const project = projectOf([['row-a', [clip('a', 0, 6)]]])
    assert.deepEqual(planEncodeContent(project).request.audio, { sampleRate: 48_000, channelCount: 2 })
  })

  it('a silent file asks for no audio track at all', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { volume: 0 })]]])
    assert.equal(planEncodeContent(project).request.audio, null)
  })

  it('a muted footage row is silent, so the track it carries is not promised', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6)], { muted: true }]])
    assert.equal(planEncodeContent(project).request.audio, null)
  })

  it('an audio row alone still counts as sound', () => {
    const project = projectOf([
      ['row-a', [clip('a', 0, 6, { volume: 0 })]],
      ['row-b', [clip('b', 0, 6, { type: 'audio' })], { type: 'audio' }]
    ])
    assert.deepEqual(planEncodeContent(project).request.audio, { sampleRate: 48_000, channelCount: 2 })
  })
})

describe('planEncodeContent — what the exporter cannot paint yet', () => {
  it('a second footage row in the file is refused, even where it never overlaps', () => {
    // The seam paints one plate stack per frame; the second row is the DOM's
    // `mix-blend-mode` and z-order work (F2b/F4b), which has no canvas twin.
    const project = projectOf([
      ['row-a', [clip('a', 0, 4)]],
      ['row-b', [clip('b', 6, 4)]]
    ])
    const verdict = planEncodeContent(project)
    assert.equal(verdict.kind, 'refused')
    assert.deepEqual(verdict.reasons, ['stacked-rows'])
  })

  it('a text row with content is refused — captions are drawtext, not drawImage', () => {
    const project = projectOf([
      ['row-a', [clip('a', 0, 6)]],
      ['text-1', [clip('t', 1, 2, { type: 'text', text: 'hello' })], { type: 'text' }]
    ])
    assert.deepEqual(planEncodeContent(project).reasons, ['text'])
  })

  it('a text row that holds nothing is not a reason to refuse', () => {
    const project = projectOf([
      ['row-a', [clip('a', 0, 6)]],
      ['text-1', [], { type: 'text' }]
    ])
    assert.equal(planEncodeContent(project).kind, 'eligible')
  })

  it('a hidden text row paints nothing, so it does not block an export', () => {
    const project = projectOf([
      ['row-a', [clip('a', 0, 6)]],
      ['text-1', [clip('t', 1, 2, { type: 'text', text: 'hello' })], { type: 'text', hidden: true }]
    ])
    assert.equal(planEncodeContent(project).kind, 'eligible')
  })

  it('an effect is refused: the preview applies it as CSS filters, the file cannot', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { effects: [{ type: 'brightness', params: { value: 1.2 } }] })]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['effects'])
  })

  it('a mask is refused', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { mask: { shape: 'circle', x: 0.25, y: 0.25, w: 0.5, h: 0.5, feather: 0, rotation: 0, invert: false, axis: 'x' } })]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['mask'])
  })

  it('a blend mode is refused, and `normal` is not a blend mode', () => {
    const blended = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { blend: 'screen' })]]]))
    assert.deepEqual(blended.reasons, ['blend'])
    const plain = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { blend: 'normal' })]]]))
    assert.equal(plain.kind, 'eligible')
  })

  it('a transition is refused: two plates cross-faded is a compositor', () => {
    const project = projectOf([['row-a', [
      clip('a', 0, 4),
      clip('b', 4, 4, { transitionIn: { type: 'fade', duration: 1 * T } })
    ]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['transition'])
  })

  it('a reversed clip is refused — the mixer already refuses to play it', () => {
    // `audioMixAt` names this refusal too (§G3/G4): a source that cannot run
    // backwards is one source with two honest answers, not two different ones.
    const project = projectOf([['row-a', [clip('a', 0, 6, { reverse: true })]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['reverse'])
  })

  it('stabilization is refused: the crop it applies lives in the binary', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { stabilize: true, stabilizeLevel: 'medium' })]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['stabilize'])
  })

  it('fit `smart` is refused while `fit`, `fill`, `crop` and `stretch` are paintable', () => {
    assert.deepEqual(planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { fit: 'smart' })]]])).reasons, ['fit-unsupported'])
    for (const fit of ['fit', 'fill', 'crop', 'stretch']) {
      assert.equal(planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { fit })]]])).kind, 'eligible', fit)
    }
  })

  it('rotation is refused until the plate rect has been measured against the file', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 15 } })]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['rotation'])
  })

  it('a speed ramp is NOT refused: the evaluator already gives the media tick per frame', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, {
      speedPoints: [{ t: 0, speed: 1 }, { t: 3 * T, speed: 2 }]
    })]]])
    assert.equal(planEncodeContent(project).kind, 'eligible')
  })

  it('keyframes are NOT refused for the same reason', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, {
      keyframes: [{ property: 'transform.x', points: [{ t: 0, value: 0 }, { t: 3 * T, value: 100 }] }]
    })]]])
    assert.equal(planEncodeContent(project).kind, 'eligible')
  })

  it('a file with no footage row is refused as empty, not exported as black', () => {
    // The row lanes are a TRACK property, the same classification
    // `selectFileRows` and `evaluateTimeline` use — a clip's own `type` is a
    // label, not a lane, so this fixture declares the audio row it means.
    const project = projectOf([['row-b', [clip('b', 0, 6, { type: 'audio' })], { type: 'audio' }]])
    assert.deepEqual(planEncodeContent(project).reasons, ['empty'])
  })

  it('every refusal in one project is named, not only the first', () => {
    const project = projectOf([
      ['row-a', [clip('a', 0, 4, { effects: [{ type: 'blur', params: {} }], mask: { shape: 'rectangle', x: 0, y: 0, w: 1, h: 1, feather: 0, rotation: 0, invert: false, axis: 'x' } })]],
      ['row-b', [clip('b', 0, 4)]],
      ['text-1', [clip('t', 0, 2, { type: 'text', text: 'x' })], { type: 'text' }]
    ])
    const verdict = planEncodeContent(project)
    assert.equal(verdict.kind, 'refused')
    assert.deepEqual(verdict.reasons, ['effects', 'mask', 'stacked-rows', 'text'])
  })

  it('an image canvas background is refused: the painter has no still-decode leg', () => {
    // TmcutPreviewPlayer.vue paints `background-image: cover` and the FFmpeg
    // chain registers the file as an input; a canvas `drawImage` of the
    // footage would export the project with its backdrop missing.
    const project = projectOf([['row-a', [clip('a', 0, 6)]]], {
      width: 1920,
      height: 1080,
      fps: FPS_30,
      background: { type: 'image', value: 'C:/media/backdrop.jpg' }
    })
    assert.deepEqual(planEncodeContent(project).reasons, ['background-image'])
  })

  it('an image background with no file behind it is the black canvas both renderers already agree on', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6)]]], {
      width: 1920,
      height: 1080,
      fps: FPS_30,
      background: { type: 'image', value: '  ' }
    })
    assert.equal(planEncodeContent(project).kind, 'eligible')
  })

  it('a refusal reports no request, so a caller cannot run it by accident', () => {
    const verdict = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { stabilize: true })]]]))
    assert.equal(verdict.request, null)
    assert.equal(verdict.canvas, null)
  })
})

describe('planEncodeContent — the input it will not guess about', () => {
  it('a canvas without finite dimensions is refused, not defaulted to 1920x1080', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6)]]], { width: 0, height: 1080, fps: FPS_30 })
    const verdict = planEncodeContent(project)
    assert.equal(verdict.kind, 'refused')
    assert.deepEqual(verdict.reasons, ['bad-canvas'])
  })

  it('a missing or zero frame rate is refused: the clock has no unit', () => {
    const verdict = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6)]]], { width: 1920, height: 1080 }))
    assert.deepEqual(verdict.reasons, ['bad-canvas'])
  })

  it('an empty project is refused as empty, and never as a zero-frame export', () => {
    const verdict = planEncodeContent(projectOf([]))
    assert.deepEqual(verdict.reasons, ['empty'])
    assert.equal(verdict.totalFrames, 0)
    assert.equal(verdict.contentEndTicks, 0)
  })

  it('null input is refused, not thrown on', () => {
    assert.equal(planEncodeContent(null).kind, 'refused')
  })
})
