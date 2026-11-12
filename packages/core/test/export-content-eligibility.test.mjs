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
import { ENCODE_REFUSAL_REASONS, exportBakesEffect, exportBakesEffectInstance, planEncodeContent } from '../src/exportContent.mjs'

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

  it('an effect with no painter leg is refused', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { effects: [{ type: 'chromakey', params: { color: '#00ff00' } }] })]]])
    assert.deepEqual(planEncodeContent(project).reasons, ['effects'])
  })

  // Slice E1 taught the painter a filter-string leg, so the effects whose whole
  // look IS a CSS filter export now. The refusal must not outlive the leg.
  it('an effect the painter bakes does not block the file', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6, { effects: [{ type: 'mono', params: { intensity: 100 } }] })]]])
    const verdict = planEncodeContent(project)
    assert.equal(verdict.kind, 'eligible')
    assert.deepEqual(verdict.reasons, [])
    assert.deepEqual(verdict.blockedEffects, [])
    assert.equal(exportBakesEffect('mono'), true)
  })

  // A refusal that only says "effects" makes the user hunt through every clip
  // for the one that blocks the file. The verdict names them, from the same
  // walk, and `exportBakesEffect` is the single answer per type — the UI only
  // translates the names.
  it('a refused effect is named, once per type, and only when the painter cannot bake it', () => {
    const project = projectOf([
      ['row-a', [
        clip('a', 0, 4, { effects: [{ type: 'vignette', params: {} }, { type: 'chromakey', params: { color: '#00ff00' } }] }),
        clip('b', 4, 4, { effects: [{ type: 'vignette', params: { intensity: 20 } }] })
      ]]
    ])
    const verdict = planEncodeContent(project)
    assert.deepEqual(verdict.reasons, ['effects'])
    assert.deepEqual(verdict.blockedEffects, ['chromakey', 'vignette'])
    assert.equal(exportBakesEffect('vignette'), false)
  })

  // Baked and unbaked effects on the same clip: the file may render, because the
  // painter draws the one it knows — the verdict still names the one it does not.
  // (A clip mixing the two is refused today, so the assertion below pins the
  // stricter of the two answers rather than a silently dropped effect.)
  it('one unbaked effect on a clip still refuses the whole file', () => {
    const project = projectOf([
      ['row-a', [clip('a', 0, 4, {
        effects: [
          { type: 'mono', params: { intensity: 100 } },
          { type: 'vignette', params: {} }
        ]
      })]]
    ])
    const verdict = planEncodeContent(project)
    assert.deepEqual(verdict.reasons, ['effects'])
    assert.deepEqual(verdict.blockedEffects, ['vignette'], 'only the type the painter cannot draw is named')
  })

  it('an unhidden, effect-free project names no blocked effect', () => {
    const verdict = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6)]]]))
    assert.deepEqual(verdict.blockedEffects, [])
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
      ['row-a', [clip('a', 0, 4, { effects: [{ type: 'chromakey', params: { color: '#00ff00' } }], mask: { shape: 'rectangle', x: 0, y: 0, w: 1, h: 1, feather: 0, rotation: 0, invert: false, axis: 'x' } })]],
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

  it('a transparent canvas is refused: no config the ladder asks for carries alpha', () => {
    // The FFmpeg chain switches to an alpha-capable output for exactly this
    // background (`render/index.ts:112`); `planEncodePresets` offers H.264, VP9
    // and AV1 with no alpha option, so the file would be black where the preview
    // is see-through. That is the silent-difference class this law exists to stop.
    const project = projectOf([['row-a', [clip('a', 0, 6)]]], {
      width: 1920,
      height: 1080,
      fps: FPS_30,
      background: { type: 'transparent', value: '' }
    })
    assert.deepEqual(planEncodeContent(project).reasons, ['background-transparent'])
  })

  it('a colour canvas background is the fill the painter already does', () => {
    const project = projectOf([['row-a', [clip('a', 0, 6)]]], {
      width: 1920,
      height: 1080,
      fps: FPS_30,
      background: { type: 'color', value: '#101820' }
    })
    assert.equal(planEncodeContent(project).kind, 'eligible')
  })

  it('the vocabulary names the transparent canvas, so the UI has words for it', () => {
    assert.ok(ENCODE_REFUSAL_REASONS.includes('background-transparent'))
    assert.deepEqual(
      ENCODE_REFUSAL_REASONS.filter(reason => reason.startsWith('background-')),
      ['background-image', 'background-transparent']
    )
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

describe('planEncodeContent — a lut3d preset is decided per instance, not per type', () => {
  const preset = lut => [{ type: 'lut3d', params: { lut } }]

  it('a plate-free preset is bakeable, so its clip does not block the file', () => {
    // The reported bug: a project whose only effect is the "Cool" preset was
    // refused because the check asked "is `lut3d` a baked type?" — a question
    // about the registry, when the answer depends on THIS preset's grade.
    const project = projectOf([['row-a', [clip('a', 0, 6, { effects: preset('cool') })]]])
    const verdict = planEncodeContent(project)
    assert.equal(verdict.kind, 'eligible')
    assert.deepEqual(verdict.reasons, [])
    assert.deepEqual(verdict.blockedEffects, [])
  })

  it('every preset whose grade is a pure colour/filter chain is bakeable', () => {
    for (const lut of ['warm', 'cool', 'cinematic', 'vintage', 'vivid', 'fade', 'mono', 'sepia', 'noir', 'bleach', 'teal-orange', 'sunset', 'moonlight', 'forest', 'rose', 'cyberpunk', 'honey', 'arctic']) {
      const verdict = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { effects: preset(lut) })]]]))
      assert.equal(verdict.kind, 'eligible', lut)
      assert.deepEqual(verdict.reasons, [], lut)
    }
  })

  it('the `film` preset is still refused: its grade carries a grain plate', () => {
    // `lutGrade('film')` ends in `{ op: 'grain' }`, and canvas 2D has no
    // gradient shorthand to draw that noise. An honest refusal, not a file that
    // silently drops the grain.
    const verdict = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { effects: preset('film') })]]]))
    assert.equal(verdict.kind, 'refused')
    assert.deepEqual(verdict.reasons, ['effects'])
    assert.deepEqual(verdict.blockedEffects, ['lut3d:film'])
  })

  it('an unknown preset id is refused, never treated as identity', () => {
    const verdict = planEncodeContent(projectOf([['row-a', [clip('a', 0, 6, { effects: preset('no-such-lut') })]]]))
    assert.equal(verdict.kind, 'refused')
    assert.deepEqual(verdict.blockedEffects, ['lut3d:no-such-lut'])
  })

  it('the baked answer is per instance, and the bare type stays unbaked', () => {
    // A type-level boolean cannot express this, which is why the export answer is
    // a function of the INSTANCE. The bare type keeps its old answer so a caller
    // that has no params cannot accidentally claim the whole type is baked.
    assert.equal(exportBakesEffectInstance({ type: 'lut3d', params: { lut: 'cool' } }), true)
    assert.equal(exportBakesEffectInstance({ type: 'lut3d', params: { lut: 'film' } }), false)
    assert.equal(exportBakesEffectInstance({ type: 'mono', params: {} }), true)
    assert.equal(exportBakesEffectInstance({ type: 'chromakey', params: {} }), false)
    assert.equal(exportBakesEffect('lut3d'), false, 'the bare type is not baked: the params decide')
  })
})
