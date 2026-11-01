// Golden-frame comparison contract (V4 M2 prep, ADR-016).
// Frames are raw RGBA bytes; decoding PNG belongs to the host, not the core.

export interface TmcutFrameCompareOptions {
  /** Max acceptable mean absolute error over all channels (0..255). */
  meanTolerance?: number
  /** Max acceptable share of pixels that changed (0..1). */
  diffRatioTolerance?: number
  /** Per-channel delta a pixel may drift before it counts as changed. */
  channelTolerance?: number
}

export interface TmcutFrameCompareResult {
  ok: boolean
  meanAbsError: number
  maxChannelDelta: number
  differingPixels: number
  totalPixels: number
  diffRatio: number
}
