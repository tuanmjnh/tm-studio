// Golden-frame comparison contract (V4 M2 prep, ADR-016).
// Frames are raw RGBA bytes; decoding PNG belongs to the host, not the core.

export interface TmcutFrameCompareOptions {
  /** Max acceptable mean absolute error over all channels (0..255). */
  meanTolerance?: number
  /** Max acceptable share of pixels that changed (0..1). */
  diffRatioTolerance?: number
  /** Per-channel delta a pixel may drift before it counts as changed. */
  channelTolerance?: number
  /**
   * One byte per pixel, same pixel count as the frames. A zero marks a pixel
   * that is NOT asserted: it leaves the mean, the diff count and the ratio.
   * Used where a golden must survive a lossy step (the encoder's chroma
   * subsample blurs a real band around every region edge) without loosening
   * the tolerance for the pixels that ARE asserted.
   */
  mask?: Uint8Array | Uint8ClampedArray
}

export interface TmcutFrameCompareResult {
  ok: boolean
  meanAbsError: number
  maxChannelDelta: number
  differingPixels: number
  totalPixels: number
  /** Pixels the mask left in the comparison; `diffRatio` and `meanAbsError` are over these. */
  assertedPixels: number
  /** Pixels the mask took out of the comparison. */
  skippedPixels: number
  diffRatio: number
}
