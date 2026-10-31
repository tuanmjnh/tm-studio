/**
 * Caption cues for the HTML/CSS video studio.
 *
 * AutoCaptions writes one text clip per recognised segment; the subtitle
 * composition reads `cues` as JSON. This spec pins the conversion (units,
 * ordering, dropped junk) and the starter that consumes it, because both fail
 * silently: a wrong unit still renders, it just lights the wrong word.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseCaptionCues, serializeCaptionCues, toCaptionCues } from '../../app/utils/tmcut/captions'
import { htmlVideoStarter } from '../../app/utils/tmcut/htmlVideoStarters'
import { replaceHtmlTokens, validateHtmlVideoSpec } from '../../../tmcut-core/src/index.mjs'

describe('toCaptionCues — timeline clips to cues', () => {
  it('drops empty text and non-positive spans', () => {
    const cues = toCaptionCues([
      { text: '  ', startSec: 0, endSec: 1 },
      { text: 'kept', startSec: 1, endSec: 1 },
      { text: 'kept too', startSec: 2, endSec: 1.5 },
      { text: ' real ', startSec: 0, endSec: 0.8 }
    ])
    assert.deepEqual(cues, [{ start: 0, end: 0.8, text: 'real' }])
  })

  it('clamps a negative start to zero', () => {
    assert.deepEqual(toCaptionCues([{ text: 'late', startSec: -0.4, endSec: 1 }]), [
      { start: 0, end: 1, text: 'late' }
    ])
  })

  it('sorts by start and rounds to milliseconds', () => {
    const cues = toCaptionCues([
      { text: 'second', startSec: 2.00049, endSec: 3.00051 },
      { text: 'first', startSec: 0.0001, endSec: 1.9999 }
    ])
    assert.deepEqual(cues.map(cue => cue.text), ['first', 'second'])
    assert.equal(cues[0]!.start, 0)
    assert.equal(cues[0]!.end, 2)
    assert.equal(cues[1]!.start, 2)
  })

  it('treats missing fields as an empty span', () => {
    assert.deepEqual(toCaptionCues([{ text: 'no timing' } as never]), [])
    assert.deepEqual(toCaptionCues([{ text: 'NaN', startSec: Number.NaN, endSec: Number.NaN }]), [])
  })
})

describe('cues serialization', () => {
  const cues = toCaptionCues([
    { text: 'one', startSec: 0, endSec: 0.5 },
    { text: 'two "quoted" <tag>', startSec: 0.5, endSec: 1.5 }
  ])

  it('round-trips through the variable string', () => {
    assert.deepEqual(parseCaptionCues(serializeCaptionCues(cues)), cues)
  })

  it('rejects malformed input instead of throwing', () => {
    assert.deepEqual(parseCaptionCues('{not json'), [])
    assert.deepEqual(parseCaptionCues(null), [])
    assert.deepEqual(parseCaptionCues({ cues }), [])
  })
})

describe('voice-captions starter', () => {
  const starter = htmlVideoStarter('voice-captions')

  it('exists and declares the cues variable', () => {
    assert.ok(starter, 'voice-captions starter is missing')
    const keys = starter!.variables.map(variable => variable.key)
    assert.deepEqual(keys.sort(), ['accent', 'cues', 'eyebrow'])
  })

  it('ships default cues that parse', () => {
    const value = starter!.variables.find(variable => variable.key === 'cues')!.value
    assert.equal(parseCaptionCues(value).length, 3)
  })

  it('reads cues from an attribute the escaping step survives', () => {
    const values: Record<string, string> = {}
    for (const variable of starter!.variables) values[variable.key] = variable.value
    const html = replaceHtmlTokens(starter!.html, values)
    const attribute = /data-cues="([^"]*)"/.exec(html)
    assert.ok(attribute, 'data-cues attribute is missing')
    // HTML entity decoding is what the browser does when the composition
    // calls getAttribute; the JSON must survive the escape/replace round-trip.
    const decoded = attribute![1]!
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\u0027')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
    assert.equal(parseCaptionCues(decoded).length, 3)
  })

  it('extends its duration to cover the last cue', () => {
    assert.match(starter!.html, /DURATION = Math\.max\(DURATION, cues\[cues\.length - 1\]\.end\)/)
  })

  it('passes render validation with its defaults', () => {
    const values: Record<string, string> = {}
    for (const variable of starter!.variables) values[variable.key] = variable.value
    const check = validateHtmlVideoSpec({
      html: replaceHtmlTokens(starter!.html, values),
      width: starter!.width,
      height: starter!.height,
      fps: starter!.fps,
      durationSec: starter!.durationSec
    })
    assert.deepEqual(check.errors, [])
    assert.deepEqual(check.warnings, [])
  })
})
