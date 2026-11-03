// =============================================================================
//  tmcut-core — pixels
//  Golden-frame comparison (V4 Phase 1 / M2 prep, ADR-016).
//
//  A renderer's output is raw RGBA (ImageData from a canvas, a decoded PNG
//  buffer on the host side); the core only compares numbers. No PNG decoder
//  and no hash equality: a screenshot's compression noise moves bytes even
//  when the frame looks identical, so the gate is mean absolute error plus
//  the share of pixels that differ beyond a per-channel tolerance.
// =============================================================================

/** ADR-016 defaults: tolerate a 2/255 average error and 0.1% changed pixels. */
export const DEFAULT_FRAME_COMPARE = Object.freeze({
  meanTolerance: 2,
  diffRatioTolerance: 0.001,
  channelTolerance: 0
})

function isByteArray(value) {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray
}

function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Compare two RGBA frames of identical length.
 *
 * @param {Uint8Array | Uint8ClampedArray} expected golden frame
 * @param {Uint8Array | Uint8ClampedArray} actual rendered frame
 * @param {{
 *   meanTolerance?: number,
 *   diffRatioTolerance?: number,
 *   channelTolerance?: number,
 *   mask?: Uint8Array | Uint8ClampedArray
 * }} [options]
 *   `mask` carries one byte per pixel, same pixel count as the frames: a zero
 *   marks a pixel that is NOT asserted. A golden of a patterned still has to
 *   survive the encoder's chroma subsample, which blurs a real band around every
 *   region edge; loosening the tolerances for the whole frame to cover that band
 *   would also cover the shift and the wrong-colour bugs the golden exists to
 *   catch, so the edge is marked instead. Masked pixels leave the mean, the diff
 *   count and the ratio completely — they are not a pass, they are not measured.
 * @returns {{
 *   ok: boolean,
 *   meanAbsError: number,
 *   maxChannelDelta: number,
 *   differingPixels: number,
 *   totalPixels: number,
 *   assertedPixels: number,
 *   skippedPixels: number,
 *   diffRatio: number
 * }}
 *   `ok` is true when meanAbsError <= meanTolerance AND diffRatio <=
 *   diffRatioTolerance. A pixel counts as differing when ANY of its channels
 *   exceeds channelTolerance. Throws TypeError on a malformed frame or mask, and
 *   when the mask leaves nothing to assert (a vacuous golden is not a gate).
 */
export function compareFrames(expected, actual, options = {}) {
  if (!isByteArray(expected) || !isByteArray(actual)) {
    throw new TypeError('compareFrames expects Uint8Array frames')
  }
  if (expected.length === 0 || expected.length % 4 !== 0) {
    throw new TypeError('frame length must be a non-zero multiple of 4 (RGBA)')
  }
  if (expected.length !== actual.length) {
    throw new TypeError(`frame length mismatch: ${expected.length} vs ${actual.length}`)
  }

  const channelTolerance = finiteOr(options.channelTolerance, DEFAULT_FRAME_COMPARE.channelTolerance)
  const meanTolerance = finiteOr(options.meanTolerance, DEFAULT_FRAME_COMPARE.meanTolerance)
  const diffRatioTolerance = finiteOr(options.diffRatioTolerance, DEFAULT_FRAME_COMPARE.diffRatioTolerance)
  const mask = options.mask
  if (mask !== undefined && !isByteArray(mask)) {
    throw new TypeError('compareFrames expects a Uint8Array mask')
  }
  const totalPixels = expected.length / 4
  if (mask && mask.length !== totalPixels) {
    throw new TypeError(`mask length mismatch: ${mask.length} vs ${totalPixels} pixels`)
  }

  let sum = 0
  let maxChannelDelta = 0
  let differingPixels = 0
  let skippedPixels = 0

  for (let pixel = 0; pixel < totalPixels; pixel++) {
    if (mask && mask[pixel] === 0) {
      skippedPixels++
      continue
    }
    const index = pixel * 4
    let pixelDiffers = false
    for (let channel = 0; channel < 4; channel++) {
      const delta = Math.abs(expected[index + channel] - actual[index + channel])
      sum += delta
      if (delta > maxChannelDelta) maxChannelDelta = delta
      if (delta > channelTolerance) pixelDiffers = true
    }
    if (pixelDiffers) differingPixels += 1
  }

  const assertedPixels = totalPixels - skippedPixels
  if (assertedPixels === 0) {
    throw new TypeError('the mask leaves no pixel to assert')
  }
  const meanAbsError = sum / (assertedPixels * 4)
  const diffRatio = differingPixels / assertedPixels

  return {
    ok: meanAbsError <= meanTolerance && diffRatio <= diffRatioTolerance,
    meanAbsError,
    maxChannelDelta,
    differingPixels,
    totalPixels,
    assertedPixels,
    skippedPixels,
    diffRatio
  }
}
