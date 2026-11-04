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

/**
 * Decode one frame to PNG bytes.
 *
 * Bytes already in hand beat a location, because the client copy is local,
 * already proven to belong to this revision, and needs no range requests.
 * A cancelled ask releases the `Input` immediately: Mediabunny keeps reading
 * ranges until it is disposed, and a scrub that left this frame behind must not
 * keep the network busy.
 */
export async function decodeFrame(ask: TmcutFrameDecodeAsk): Promise<Blob | null> {
  if (!hasFrameDecoder()) return null
  const source = ask.bytes
    ? new BlobSource(ask.bytes)
    : ask.src ? new UrlSource(ask.src) : null
  if (!source) return null

  const input = new Input({ formats: ALL_FORMATS, source })
  let released = false
  const release = () => {
    if (released) return
    released = true
    input.dispose()
  }
  const onAbort = () => release()
  ask.signal.addEventListener('abort', onAbort, { once: true })
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
    ask.signal.removeEventListener('abort', onAbort)
    release()
  }
}
