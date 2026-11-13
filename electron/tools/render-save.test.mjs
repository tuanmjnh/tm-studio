/**
 * The desktop's write lane for a rendered file.
 *
 * The export encoder answers with a `Blob` in the renderer (WebCodecs + the
 * muxer both run there), so Main is the only place that can turn those bytes
 * into a file. This spec pins the two refusals in that lane plus the naming
 * rule, in plain Node: `render-save.cjs` imports no electron and no fs, so the
 * whole decision surface is exercised here without spawning a window.
 *
 * Run: node --test electron/tools/render-save.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { acceptRenderBytes, resolveRenderTarget, RENDER_EXTENSION } from './render-save.cjs'

test('bytes are accepted in every shape the renderer can hand IPC', () => {
  assert.equal(acceptRenderBytes(new Uint8Array([1, 2, 3])).byteLength, 3)
  assert.equal(acceptRenderBytes(new Uint8Array([1, 2, 3]).buffer).byteLength, 3)
  // A typed-array view must not be widened to its whole backing buffer.
  const backing = new Uint8Array([0, 1, 2, 3, 4, 5])
  const view = new Uint8Array(backing.buffer, 2, 3)
  assert.deepEqual(Array.from(acceptRenderBytes(view)), [2, 3, 4])
})

test('an empty render is refused, not written as a successful file', () => {
  assert.equal(acceptRenderBytes(new Uint8Array(0)), null)
  assert.equal(acceptRenderBytes(new ArrayBuffer(0)), null)
  assert.equal(acceptRenderBytes(null), null)
  assert.equal(acceptRenderBytes('not bytes'), null)
})

test('the render name is one path component and keeps the mp4 extension', () => {
  const target = resolveRenderTarget({
    dir: '/renders',
    filename: '../escape attempt',
    exists: () => false
  })
  assert.equal(target.path, '/renders/escape attempt.mp4')
  assert.equal(target.name, 'escape attempt.mp4')
})

test('a name without an extension gets the container the encoder wrote', () => {
  const target = resolveRenderTarget({ dir: '/renders', filename: 'Untitled Project', exists: () => false })
  assert.equal(target.name, `Untitled Project.${RENDER_EXTENSION}`)
})

test('a taken name is suffixed instead of overwriting the previous render', () => {
  const taken = new Set(['/renders/Scene.mp4'])
  const target = resolveRenderTarget({ dir: '/renders', filename: 'Scene.mp4', exists: path => taken.has(path) })
  assert.equal(target.path, '/renders/Scene (1).mp4')
})

test('no name at all still produces a legal file', () => {
  const target = resolveRenderTarget({ dir: '/renders', filename: '', exists: () => false })
  assert.equal(target.path, `/renders/render.${RENDER_EXTENSION}`)
})
