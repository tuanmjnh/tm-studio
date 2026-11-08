// tmcut-core — still-image tests. Run: node --test "test/*.test.mjs"
//
// One question, one answer: "is this file a still, and is it a VECTOR still?"
// The extension law used to live in two lists that disagreed (core said `svg`
// is nothing, the app's legacy helper said it is an image), and the preview
// read the second one while the export read the first. These tests pin the
// single law. Slice J retired the FFmpeg input-argv emitter (`-width` /
// `-height` were private librsvg options); the classification it fed is kept
// because the preview and the decoder still branch on it.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyAssetKind,
  isVectorStillImage
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
  it('is true only for the extension whose decoder resolves geometry', () => {
    assert.equal(isVectorStillImage('a/b/x.SVG'), true)
    assert.equal(isVectorStillImage('x.png'), false)
    assert.equal(isVectorStillImage('x.gif'), false)
    assert.equal(isVectorStillImage('x.txt'), false)
    assert.equal(isVectorStillImage(undefined), false)
  })
})
