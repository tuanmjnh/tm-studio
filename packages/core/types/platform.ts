// TMCut platform adapter contract (V4 Phase 1 / M1, ADR-014).
// Type-only: the core ships no host implementation. A host (Electron main,
// a browser tab, a headless server) builds these objects and injects them;
// feature gates read TmcutRuntimeInfo instead of sniffing globals.
//
// Clock is NOT a host service: createClock() in tmcut-core owns the tick ->
// frame math so every host agrees on frame boundaries.
import type { FrameRate } from './dsl.js'
import type { TmcutMediaInfo, TmcutProbeHints } from './mediaInfo.js'
import type { TmcutRuntimeInfo } from './runtime.js'

export type TmcutPlatformName = TmcutRuntimeInfo['name']
export type TmcutPlatformInfo = TmcutRuntimeInfo

/** Tick <-> frame conversion for one timeline FrameRate. */
export interface TmcutClock {
  readonly fps: number
  readonly ticksPerFrame: number
  frameIndexAt(ticks: number): number
  frameStartAt(index: number): number
  nextFrameStart(ticks: number): number
  snap(ticks: number): number
  /** Start ticks of every frame in the half-open span [startTick, endTick). */
  frameStarts(startTick: number, endTick: number): number[]
  /** Frames needed to cover a duration (ceil, so a partial frame counts). */
  durationFrames(durationTicks: number): number
}

/**
 * Stored locator -> playable URL, plus the one read-only metadata question.
 *
 * Zero-FFmpeg slice I deleted the ffprobe leg, so `probe` (the raw-JSON
 * counterpart, answered by a host binary) is gone with it. `probeInfo` is the
 * single answer on both hosts: one demuxing service, one set of warnings, and
 * no second shape for a caller to prefer.
 */
export interface TmcutPlatformMedia {
  resolveSrc(src?: string | null): string
  /**
   * The §4.1 answer for a stored locator: tracks, durations with their source,
   * warnings, the compatibility report and the import status. It answers "how
   * long and how big" and "can this runtime really work with this file" in one
   * round-trip, which is why the app carries no second probe shape.
   *
   * `hints` carries facts the caller already holds (an asset record's byte size,
   * a MIME type from a picker) so the probe never asks for them again. A host
   * with no demuxing pipeline throws; a file the demuxer refuses comes back as
   * a verdict with warnings, never as a zero-filled `TmcutMediaInfo`.
   */
  probeInfo(src: string, hints?: TmcutProbeHints): Promise<TmcutMediaInfo>
}

/** One HTML/CSS composition document, loaded once and seeked per frame. */
export interface TmcutCaptureRequest {
  html: string
  css?: string
  width: number
  height: number
  fps: number
}

/**
 * Stateful capture: the document loads once, then each frame is seeked
 * (`__tmcutSeek(t)`) and screenshotted without ever replaying the animation.
 *
 * ADR-023: one host holds a session — the server that runs the headless browser
 * (Playwright) — and the desktop reaches it through the same local server that
 * serves the app, because the second engine this contract used to describe was
 * retired. A renderer-side adapter therefore answers the bounds question
 * (`supportsFps`) and refuses `open`, naming the endpoint that renders.
 */
export interface TmcutCaptureSession {
  seek(atSec: number): Promise<void>
  screenshot(): Promise<Uint8Array>
  close(): Promise<void>
}

export interface TmcutPlatformCapture {
  open(request: TmcutCaptureRequest): Promise<TmcutCaptureSession>
  /** Frame rate the host can capture at; null when capture is unavailable. */
  supportsFps(fps: FrameRate): boolean
}

/** Everything the renderer needs from its host, behind one object.
 *
 * There is no `encoder` here (zero-FFmpeg slice I): both hosts paint and encode
 * in-process through the WebCodecs export session, so a host has no render job
 * to queue and no path to poll.
 */
export interface TmcutPlatformAdapter {
  info: TmcutPlatformInfo
  media: TmcutPlatformMedia
  capture: TmcutPlatformCapture
}
