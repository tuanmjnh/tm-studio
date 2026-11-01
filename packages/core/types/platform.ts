// TMCut platform adapter contract (V4 Phase 1 / M1, ADR-014).
// Type-only: the core ships no host implementation. A host (Electron main,
// a browser tab, a headless server) builds these objects and injects them;
// feature gates read TmcutRuntimeInfo instead of sniffing globals.
//
// Clock is NOT a host service: createClock() in @tmcut/core owns the tick ->
// frame math so every host agrees on frame boundaries.
import type { FrameRate } from './dsl.js'
import type { TmcutMediaMetadata } from './media.js'
import type { TmcutRenderEngine, TmcutRuntimeInfo } from './runtime.js'

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
 * Stored locator -> playable URL, plus the read-only metadata question.
 *
 * ADR-020: `probe` is required because both shipping hosts can answer it —
 * Electron through ffprobe, a browser tab through a metadata element. It asks
 * about a file and writes nothing: thumbnails, waveforms and the persisted
 * asset record stay with the host's asset pipeline (`analyzeAsset` on desktop),
 * which consumes the same core normalization rather than a second copy.
 *
 * `src` is the stored locator, and each host maps it the way it plays it: a
 * filesystem path for ffprobe, a URL for the media element. Null means "this
 * host could not read it" — a missing pipeline, an unreadable file, a document
 * without streams — and callers must keep their own fallback.
 *
 * Field trust differs per host: ffprobe reports every field, while a browser
 * reports duration and intrinsic size only, so a web probe leaves `fps` at 0
 * and infers `hasAudio` from the absence of a video track.
 */
export interface TmcutPlatformMedia {
  resolveSrc(src?: string | null): string
  probe(src: string): Promise<TmcutMediaMetadata | null>
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
 * Stateful capture, matching both host implementations: Electron loads the
 * document in an offscreen BrowserWindow, Playwright in a headless Chrome tab;
 * both then seek (`__tmcutSeek(t)`), screenshot, and repeat without replaying.
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

/** Everything the renderer needs from its host, behind one object. */
export interface TmcutPlatformAdapter {
  info: TmcutPlatformInfo
  media: TmcutPlatformMedia
  capture: TmcutPlatformCapture
  encoder: TmcutRenderEngine
}
