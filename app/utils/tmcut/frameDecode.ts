// The one place `app/` turns media bytes into one decoded frame.
//
// Slice D2 (ADR-029/030): a thumbnail is one instant of one revision, and the
// browser can produce it without FFmpeg — Mediabunny demuxes, WebCodecs
// decodes, `CanvasSink` scales. Keeping that here, and only here, is what makes
// it one pipeline: the desktop and the web host ask the same service the same
// question and get the same kind of answer, so a filmstrip cannot look
// different depending on which window the project was opened in.
//
// Nothing around the decode lives in this file. Which bytes to read, whether
// this ask is still worth painting and how many frames may be held are decided
// in `frameStore.ts` and `tmcut-core`, because those are pure decisions and can
// be tested without a video decoder.

import { ALL_FORMATS, BlobSource, CanvasSink, Input, UrlSource } from 'mediabunny'
import { TMCUT_SCENE_GRID_CELLS, lumaCells } from 'tmcut-core'

/** How wide a canvas a scene scan draws: the grid it fills is 8x8 numbers. */
export const TMCUT_SCENE_PIXEL_WIDTH = 64

/** One frame the service decided is worth decoding. */
export interface TmcutFrameDecodeAsk {
  /** The frame key (`fingerprint-f<ms>-w<px>`) — only for logging and cache identity. */
  key: string
  /** Seconds inside the media, already clamped by core. */
  atSec: number
  /** Output width in pixels, already clamped by core. */
  width: number
  /** The copy the client byte cache holds, when it holds one. */
  bytes: Blob | null
  /** Where to read when the cache has nothing: a `media://` or http location. */
  src: string | null
  /** Retired by the service as soon as a newer ask for this slot wins. */
  signal: AbortSignal
}

/**
 * WebCodecs is the decoder. A runtime without it (plain Node, an old browser,
 * a headless export worker) is not offered a substitute: `null` means "this
 * host cannot make a frame", and the caller keeps its placeholder.
 */
export function hasFrameDecoder(): boolean {
  return typeof globalThis.VideoDecoder !== 'undefined'
}

function toPngBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if (typeof (canvas as OffscreenCanvas).convertToBlob === 'function') {
    return (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' })
  }
  return new Promise(resolve => (canvas as HTMLCanvasElement).toBlob(blob => resolve(blob), 'image/png'))
}

/** Where a read should get its bytes: the client copy first, a location second. */
export interface TmcutMediaRead {
  bytes: Blob | null
  src: string | null
  signal: AbortSignal
}

/**
 * Open one media location and hand back the only two things a caller needs: an
 * `Input`, and a `close` that lets it go. A cancelled read releases the input
 * immediately — Mediabunny keeps fetching ranges until disposed, and a scrub or a
 * scan that walked past this instant must not keep the network busy.
 *
 * The audio seam borrows this rather than opening a second demuxer: two owners of
 * the same byte-to-`Input` rule is two chances for a host to drift.
 */
export function openMedia(read: TmcutMediaRead): { input: Input, close: () => void } | null {
  const source = read.bytes
    ? new BlobSource(read.bytes)
    : read.src ? new UrlSource(read.src) : null
  if (!source) return null

  const input = new Input({ formats: ALL_FORMATS, source })
  let released = false
  const release = () => {
    if (released) return
    released = true
    input.dispose()
  }
  const onAbort = () => release()
  read.signal.addEventListener('abort', onAbort, { once: true })
  return {
    input,
    close() {
      read.signal.removeEventListener('abort', onAbort)
      release()
    }
  }
}

/**
 * Decode one frame to PNG bytes.
 *
 * Bytes already in hand beat a location, because the client copy is local,
 * already proven to belong to this revision, and needs no range requests.
 */
export async function decodeFrame(ask: TmcutFrameDecodeAsk): Promise<Blob | null> {
  if (!hasFrameDecoder()) return null
  const opened = openMedia(ask)
  if (!opened) return null
  const { input, close } = opened
  try {
    if (ask.signal.aborted) return null
    if (!(await input.canRead())) return null
    const [track] = await input.getVideoTracks()
    if (!track) return null
    const sink = new CanvasSink(track, { width: ask.width })
    const drawn = await sink.getCanvas(ask.atSec)
    if (!drawn || ask.signal.aborted) return null
    return await toPngBlob(drawn.canvas)
  } finally {
    close()
  }
}

/** The RGBA of a canvas the sink just painted, or null when 2D is unavailable. */
function rgbaOf(canvas: HTMLCanvasElement | OffscreenCanvas): Uint8ClampedArray | null {
  const context = (canvas as HTMLCanvasElement).getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) return null
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

export interface TmcutLumaSeriesAsk extends TmcutMediaRead {
  /** Instants to look at, seconds, ascending — core plans them, this file obeys. */
  timesSec: number[]
  /** Grid cells per side; core owns the default. */
  cells?: number
}

/**
 * Read a sparse scan of luma grids, one per requested instant.
 *
 * `canvasesAtTimestamps` is the whole reason this is one function: it decodes each
 * packet at most once for a sorted list of instants, which a loop of `getCanvas`
 * calls would not. A slot with no frame stays `null` — the grid law in core treats
 * a hole as missing information, and the shot list must not shift because one
 * sample was lost.
 *
 * The canvas is deliberately tiny: a shot score compares 64 numbers, and reading
 * 64 pixels costs nothing next to the decode that already happened.
 */
export async function decodeLumaSeries(ask: TmcutLumaSeriesAsk): Promise<Array<number[] | null>> {
  const times = Array.isArray(ask.timesSec) ? ask.timesSec : []
  const cells = Number.isInteger(ask.cells) && Number(ask.cells) > 0 ? Number(ask.cells) : TMCUT_SCENE_GRID_CELLS
  const empty = () => times.map(() => null)
  if (times.length === 0 || !hasFrameDecoder()) return empty()

  const opened = openMedia(ask)
  if (!opened) return empty()
  const { input, close } = opened
  try {
    if (ask.signal.aborted) return empty()
    if (!(await input.canRead())) return empty()
    const [track] = await input.getVideoTracks()
    if (!track) return empty()
    const sink = new CanvasSink(track, { width: TMCUT_SCENE_PIXEL_WIDTH })
    const grids: Array<number[] | null> = []
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (ask.signal.aborted) break
      const canvas = frame?.canvas ?? null
      const pixels = canvas ? rgbaOf(canvas) : null
      grids.push(canvas && pixels ? lumaCells(pixels, canvas.width, canvas.height, cells) : null)
    }
    while (grids.length < times.length) grids.push(null)
    return grids
  } finally {
    close()
  }
}
