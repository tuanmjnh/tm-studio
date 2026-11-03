// tmcut-core — still-image tests. Run: node --test "test/*.test.mjs"
//
// One question, one answer: "is this file a still, and how does a still get
// fed to FFmpeg?" The extension law used to live in two lists that disagreed
// (core said `svg` is nothing, the app's legacy helper said it is an image),
// and the preview read the second one while the export read the first. These
// tests pin the single law, and they pin the shape of the input flags because
// a wrong flag is not a cosmetic problem: `-width`/`-height` are private
// librsvg options, and handing them to any other decoder makes FFmpeg refuse
// the input ("Codec AVOption width ... has not been used for any stream",
// exit before the graph even builds). Both halves are measured on the
// vendored binary, not assumed.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAssetKind,
  isVectorStillImage,
  stillImageInputFlags,
  buildBackgroundSource
} from '../src/index.mjs'

describe('classifyAssetKind — the still list', () => {
  it('counts a vector still as an image, case-insensitively', () => {
    assert.equal(classifyAssetKind('logo.svg'), 'image')
    assert.equal(classifyAssetKind('/tmp/LOGO.SVG'), 'image')
    assert.equal(classifyAssetKind('photo.png'), 'image')
  })

  it('still refuses what is not media at all', () => {
    assert.equal(classifyAssetKind('notes.txt'), null)
    assert.equal(classifyAssetKind('archive.zip'), null)
    assert.equal(classifyAssetKind('noext'), null)
  })
})

describe('isVectorStillImage', () => {
  it('is true only for the extension whose decoder takes a raster size', () => {
    assert.equal(isVectorStillImage('a/b/x.SVG'), true)
    assert.equal(isVectorStillImage('x.png'), false)
    assert.equal(isVectorStillImage('x.gif'), false)
    assert.equal(isVectorStillImage('x.txt'), false)
    assert.equal(isVectorStillImage(undefined), false)
  })
})

describe('stillImageInputFlags', () => {
  it('loops every still, and asks for no raster size from a raster file', () => {
    // The exact array matters: -width/-height on a PNG input is a hard error,
    // so the absence of the pair here is what keeps a normal export alive.
    assert.deepEqual(
      stillImageInputFlags('bg.png', { fps: 30 }),
      ['-framerate', '30', '-loop', '1']
    )
  })

  it('gives a vector still the box it will be drawn into', () => {
    assert.deepEqual(
      stillImageInputFlags('bg.svg', { fps: 30, width: 1080, height: 1920 }),
      ['-framerate', '30', '-loop', '1', '-width', '1080', '-height', '1920']
    )
  })

  it('leaves the size alone when no box was given', () => {
    assert.deepEqual(
      stillImageInputFlags('bg.svg', { fps: 25 }),
      ['-framerate', '25', '-loop', '1']
    )
  })

  it('rejects a non-positive or non-finite box instead of inventing one', () => {
    for (const box of [{ width: 0, height: 1080 }, { width: 1080, height: -2 }, { width: NaN, height: 1080 }]) {
      assert.deepEqual(
        stillImageInputFlags('bg.svg', { fps: 30, ...box }),
        ['-framerate', '30', '-loop', '1'],
        `box ${JSON.stringify(box)}`
      )
    }
  })

  it('bounds the loop last, so the trim window stays where a reader expects it', () => {
    assert.deepEqual(
      stillImageInputFlags('clip.svg', { fps: 30, width: 1920, height: 1080, duration: 3.5 }),
      ['-framerate', '30', '-loop', '1', '-width', '1920', '-height', '1080', '-t', '3.500']
    )
    assert.deepEqual(
      stillImageInputFlags('clip.png', { fps: 30, duration: 3.5 }),
      ['-framerate', '30', '-loop', '1', '-t', '3.500']
    )
  })

  it('falls back to 30 fps, the way every other rate in core does', () => {
    assert.deepEqual(stillImageInputFlags('x.png', {}), ['-framerate', '30', '-loop', '1'])
  })
})

describe('buildBackgroundSource — the same law for the canvas background', () => {
  const base = { canvasW: 1920, canvasH: 1080, fps: 30, duration: 4 }

  it('keeps the raster background flags byte-identical', () => {
    const desc = buildBackgroundSource({ ...base, background: { type: 'image', value: 'bg.png' } })
    assert.deepEqual(desc.inputFlags, ['-framerate', '30', '-loop', '1'])
  })

  it('rasterises a vector background at the canvas, not at its own default size', () => {
    const desc = buildBackgroundSource({ ...base, background: { type: 'image', value: 'bg.svg' } })
    assert.deepEqual(desc.inputFlags, ['-framerate', '30', '-loop', '1', '-width', '1920', '-height', '1080'])
  })
})
