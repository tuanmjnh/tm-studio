// Slice H2 — the exporter builds the list of questions, never the list of answers.
//
// H1 put the verdict in core: a preset is usable only when a recorded
// `isConfigSupported` answer says so. That leaves one decision the host cannot
// keep in an IO layer either — WHICH configs to ask. Get it wrong in the
// harmless direction and the export just costs a few extra probes. Get it wrong
// in the other direction and the exporter never asks the config that works, so
// a machine that CAN encode H.264 is told it cannot.
//
// The matrix measured on this machine (Chrome 156, recorded in the zero-FFmpeg
// audit) is what makes each rule below a rule rather than a preference:
//
//  * `avc1.<profile>001f` (Baseline 3.1) — accepted at 720p, refused at 1080p.
//    A single hard-coded H.264 string cannot serve every raster, so the level
//    must follow the picture. It follows Annex A, not the runtime's mood,
//    because the level the file DECLARES is what a phone will check later.
//  * level_idc 33/34/35 (0x21/0x22/0x23) are refused at every raster: those
//    levels do not exist. Asking them is not a probe, it is a typo.
//  * `aac` and `mp4a.40.2` are the same codec, and the runtime answered one
//    true and the other false. An exporter that spells it once loses audio.
//  * a codec needs its container: `vp09` in an MP4 is not a smaller mistake
//    than a swapped codec, it is the same mistake the brief forbids.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ENCODER_EVEN_DIMENSION_REASON,
  planEncodeConfig,
  planEncodePresets
} from '../src/exportEncode.mjs'

const RATE_30 = { numerator: 30, denominator: 1 }
const RATE_25 = { numerator: 25, denominator: 1 }
const RATE_2997 = { numerator: 30000, denominator: 1001 }
const RATE_5994 = { numerator: 60000, denominator: 1001 }
const STEREO = { sampleRate: 48000, channelCount: 2 }

/** The presets a request offers to ask about; an unusable request offers none. */
function askable(request) {
  return planEncodePresets(request).presets
}

function avcOf(presets) {
  return presets.find(preset => preset.video.codec.startsWith('avc1.'))
}

/** Every answer the runtime could give, so the ladder itself is under test. */
function allSupported(presets) {
  const out = {}
  for (const preset of presets) {
    out[preset.id] = {
      video: { supported: true, config: { codec: preset.video.codec } },
      audio: preset.audio ? { supported: true, config: { codec: preset.audio.codec } } : undefined
    }
  }
  return out
}

describe('planEncodePresets — the level follows the picture, from Annex A', () => {
  it('offers the tightest level that can carry a 1080p30 picture', () => {
    const presets = askable({ width: 1920, height: 1080, fps: RATE_30 })
    // 120 x 68 = 8160 macroblocks/frame and 244800/s — the line Annex A draws at level 4.
    assert.equal(avcOf(presets).video.codec, 'avc1.640028')
  })

  it('raises the level for 4K and again for 4K60, never for a smaller picture', () => {
    const at30 = askable({ width: 3840, height: 2160, fps: RATE_30 })
    const at60 = askable({ width: 3840, height: 2160, fps: RATE_5994 })
    const sd = askable({ width: 640, height: 360, fps: RATE_30 })
    assert.deepEqual(
      [avcOf(at30), avcOf(at60), avcOf(sd)].map(preset => preset.video.codec.slice(-2)),
      ['33', '34', '1f']
    )
  })

  it('carries the rational rate into the preset, so 29.97 is not re-rounded later', () => {
    const strict = askable({ width: 1920, height: 1080, fps: RATE_2997 })
    assert.deepEqual(avcOf(strict).video.fps, RATE_2997)
  })

  it('counts a partial macroblock as a whole one, because that is what is coded', () => {
    // 1930 is 120.625 macroblocks wide: an encoder pads it to 121, so the
    // picture is 8228 macroblocks and level 4's 8192 no longer covers it.
    const padded = askable({ width: 1930, height: 1080, fps: RATE_30 })
    assert.equal(avcOf(padded).video.codec, 'avc1.640032')
  })

  it('accepts the level whose limit the picture hits exactly', () => {
    // 240 x 92 = 22080 macroblocks at 25 fps = 552000/s: level 5's two limits,
    // met exactly, must not be read as exceeded.
    const exact = askable({ width: 3840, height: 1472, fps: RATE_25 })
    assert.equal(avcOf(exact).video.codec, 'avc1.640032')
    // 80 x 45 = 3600 macroblocks/frame and 108000/s is level 3.1's pair —
    // 1f, not 1e. The runtime measured here accepts 720p at 3.1 too.
    const hd = askable({ width: 1280, height: 720, fps: RATE_30 })
    assert.equal(avcOf(hd).video.codec, 'avc1.64001f')
  })

  it('also asks the looser level, because refusing the tight one is not refusing H.264', () => {
    // A runtime can cap an encode below what Annex A allows for the level. One
    // question would then report "no H.264" on a machine that has it.
    const presets = askable({ width: 3840, height: 2160, fps: RATE_30 })
    assert.deepEqual(
      presets.filter(preset => preset.video.codec.startsWith('avc1.')).map(preset => preset.video.codec),
      ['avc1.640033', 'avc1.640034']
    )
  })

  it('names only levels that exist in the standard', () => {
    for (const preset of askable({ width: 1280, height: 720, fps: RATE_30 })) {
      if (!preset.video.codec.startsWith('avc1.')) continue
      const levelIdc = parseInt(preset.video.codec.slice(-2), 16)
      // 33, 34 and 35 were measured refused at every raster: no such level.
      assert.ok([10, 11, 12, 13, 20, 21, 22, 30, 31, 32, 40, 41, 42, 50, 51, 52, 60, 61, 62].includes(levelIdc),
        `level_idc ${levelIdc} is not a defined H.264 level`)
    }
  })

  it('refuses a picture no level carries, and says which field refused it', () => {
    const plan = planEncodePresets({ width: 7680, height: 4320, fps: RATE_30 })
    assert.deepEqual(plan.presets, [])
    assert.match(plan.errors.join(' '), /level/)
  })

  it('refuses an odd edge with the chroma reason the render contract already uses', () => {
    const plan = planEncodePresets({ width: 1921, height: 1080, fps: RATE_30 })
    assert.deepEqual(plan.presets, [])
    assert.ok(plan.errors.some(error => error.includes(ENCODER_EVEN_DIMENSION_REASON)),
      `expected the chroma reason, got ${JSON.stringify(plan.errors)}`)
  })

  it('refuses a float fps, the same drift H1 refuses in a timestamp', () => {
    const plan = planEncodePresets({ width: 1920, height: 1080, fps: 29.97 })
    assert.deepEqual(plan.presets, [])
    assert.ok(plan.errors.some(error => error.startsWith('fps')), JSON.stringify(plan.errors))
  })
})

describe('planEncodePresets — a codec comes with the container that holds it', () => {
  it('pairs H.264 with MP4 and VP9 or AV1 with WebM', () => {
    for (const preset of askable({ width: 1920, height: 1080, fps: RATE_30 })) {
      const family = preset.video.codec.slice(0, 4)
      if (family === 'avc1') assert.equal(preset.container, 'mp4', `${preset.id} put H.264 outside MP4`)
      else assert.equal(preset.container, 'webm', `${preset.id} put ${family} outside WebM`)
    }
  })

  it('asks both AAC spellings, because the runtime refused one and accepted the other', () => {
    const presets = askable({ width: 1920, height: 1080, fps: RATE_30, audio: STEREO })
    const codecs = new Set(presets.filter(preset => preset.container === 'mp4').map(preset => preset.audio.codec))
    assert.deepEqual([...codecs].sort(), ['aac', 'mp4a.40.2'])
  })

  it('pairs Opus with the WebM presets, which is where it belongs', () => {
    const presets = askable({ width: 1920, height: 1080, fps: RATE_30, audio: { sampleRate: 48000, channelCount: 1 } })
    for (const preset of presets.filter(row => row.container === 'webm')) {
      assert.equal(preset.audio.codec, 'opus')
      assert.equal(preset.audio.sampleRate, 48000)
      assert.equal(preset.audio.channelCount, 1)
    }
  })

  it('offers video-only presets when the caller names no audio', () => {
    const presets = askable({ width: 1920, height: 1080, fps: RATE_30 })
    assert.ok(presets.length > 0)
    assert.ok(presets.every(preset => !preset.audio), 'a preset without an audio request must not invent one')
    // The audio candidates multiply the ladder; with no audio they must not multiply it twice.
    const ids = presets.map(preset => preset.id)
    assert.equal(new Set(ids).size, ids.length, `a silent export was asked twice: ${ids.join(', ')}`)
  })

  it('names every preset uniquely, because the answers are keyed by that name', () => {
    // 4K60 leaves level 5.2 as the only legal H.264 answer, so an escape hatch
    // that re-asks the tightest level would name the same config twice.
    const presets = askable({ width: 3840, height: 2160, fps: RATE_5994, audio: STEREO })
    const ids = presets.map(preset => preset.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(ids.every(id => typeof id === 'string' && id.length > 0))
  })

  it('names the rate, because a level accepted at 30 fps is not accepted at 60', () => {
    const at30 = askable({ width: 3840, height: 2160, fps: RATE_30 })
    const at60 = askable({ width: 3840, height: 2160, fps: RATE_5994 })
    const shared = at30.map(preset => preset.id).filter(id => at60.some(preset => preset.id === id))
    assert.deepEqual(shared, [], `two rates answered each other: ${shared.join(', ')}`)
  })
})

describe('planEncodePresets — the ladder is a valid input to the H1 verdict', () => {
  it('produces presets planEncodeConfig accepts without an invalid verdict', () => {
    for (const size of [[640, 360], [1280, 720], [1920, 1080], [3840, 2160]]) {
      const presets = askable({ width: size[0], height: size[1], fps: RATE_30, audio: STEREO })
      const plan = planEncodeConfig({ presets, answers: allSupported(presets) })
      assert.equal(plan.kind, 'ready', `${size.join('x')} produced no askable preset`)
      const refused = plan.checked.filter(row => row.verdict !== 'supported')
      assert.deepEqual(refused.map(row => [row.id, row.verdict]), [],
        `a preset on the ladder was judged ${refused[0]?.verdict}: ${refused[0]?.reasons?.join('; ')}`)
    }
  })

  it('puts the most compatible preset first, so the winner is not an accident of order', () => {
    const presets = askable({ width: 1920, height: 1080, fps: RATE_30, audio: STEREO })
    assert.equal(presets[0].container, 'mp4')
    assert.ok(presets[0].video.codec.startsWith('avc1.'))
  })

  it('keeps the same answer for the same request, so a re-run is reviewable', () => {
    const request = { width: 1280, height: 720, fps: RATE_2997, audio: { sampleRate: 48000, channelCount: 1 } }
    assert.deepEqual(planEncodePresets(request), planEncodePresets(request))
  })

  it('bounds the bitrate between a floor and a ceiling instead of trusting a formula', () => {
    const tiny = askable({ width: 320, height: 240, fps: RATE_30 })
    const huge = askable({ width: 3840, height: 2160, fps: RATE_5994 })
    assert.ok(tiny.every(preset => preset.video.bitrate >= 1_000_000), `smallest was ${tiny[0].video.bitrate}`)
    assert.ok(huge.every(preset => preset.video.bitrate <= 40_000_000), `largest was ${huge[0].video.bitrate}`)
  })

  it('returns nothing rather than a preset built from a missing picture', () => {
    for (const request of [{}, { width: 1920, height: 1080 }, { width: 0, height: 0, fps: RATE_30 }]) {
      const plan = planEncodePresets(request)
      assert.deepEqual(plan.presets, [])
      assert.ok(plan.errors.length > 0, `${JSON.stringify(request)} was refused silently`)
    }
  })

  it('refuses an unusable audio request instead of exporting without sound', () => {
    const plan = planEncodePresets({ width: 1920, height: 1080, fps: RATE_30, audio: { sampleRate: 0, channelCount: 2 } })
    assert.deepEqual(plan.presets, [])
    assert.ok(plan.errors.some(error => error.startsWith('audio')), JSON.stringify(plan.errors))
  })
})
