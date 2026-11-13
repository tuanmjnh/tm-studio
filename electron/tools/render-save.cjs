/**
 * Where a rendered file lands, and what may be written there.
 *
 * The export encoder hands back a `Blob` in the renderer. On the desktop host
 * that is not a file: there is no path to reveal, the preview cannot play a
 * `blob:` the modal classifies by extension, and the browser download lane in
 * this shell begins a download and then cancels it (measured 2026-11-13: an
 * `<a download>` on a `blob:` reached `state: "canceled"` with 0 bytes and
 * wrote nothing). So Main owns the write: these are its rules, kept free of
 * electron/fs imports so they are unit-testable in plain Node — the same split
 * as media-download.cjs.
 *
 * Two rules matter and both are refusals rather than repairs:
 *  - an empty render is not a file the user asked for;
 *  - a name is a single path component, never a path: a render called
 *    `../../x` must land in the renders directory like any other.
 */
const { resolveDownloadTarget, sanitizeFilename } = require('./media-download.cjs')

const RENDER_EXTENSION = 'mp4'
const MAX_RENDER_BYTES = 4 * 1024 * 1024 * 1024

/**
 * Validate the bytes Main was handed. Returns a Uint8Array view or null, so a
 * caller that received something else (a detached buffer, a string) refuses
 * instead of writing an empty file that looks like a successful export.
 */
function acceptRenderBytes(data) {
  if (data instanceof Uint8Array) return data.byteLength > 0 ? data : null
  if (data instanceof ArrayBuffer) return data.byteLength > 0 ? new Uint8Array(data) : null
  if (ArrayBuffer.isView(data)) {
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return view.byteLength > 0 ? view : null
  }
  return null
}

/**
 * Final path for a render: the requested name, sanitized to one component,
 * with a ` (n)` suffix when the target exists. `exists` is injected so the
 * caller owns fs and this stays a pure decision.
 */
function resolveRenderTarget({ dir, filename, exists }) {
  const name = sanitizeFilename(filename || 'render', RENDER_EXTENSION)
  return resolveDownloadTarget({ dir, filename: name, exists, defaultExtension: RENDER_EXTENSION })
}

module.exports = {
  RENDER_EXTENSION,
  MAX_RENDER_BYTES,
  acceptRenderBytes,
  resolveRenderTarget
}
