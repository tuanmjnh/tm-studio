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

/** A canvas the sink holds: the only geometry a plate can report truthfully. */
interface PlateCanvas {
  width: number
  height: number
}

/**
 * One decoded picture, at the size the media really is.
 *
 * There is no `release` on a plate, on purpose: the canvas belongs to the sink,
 * the sink and the container belong to the reader, and the reader lets go only
 * when the export ends. A plate that could close its own container would put a
 * per-frame demux back into a run that asks for thousands of frames.
 */
export interface TmcutPlate {
  width: number
  height: number
  /** The sink's own canvas: the caller must draw it before this file's next read. */
  image: PlateCanvas
}

export interface TmcutPlateAsk {
  /** Where the clip's bytes come from; null when the clip has no source. */
  src: string | null
  /** Seconds inside the media, exactly as core named them — never re-rounded. */
  atSec: number
  /** The export's signal: obeyed per frame, and the container is opened with it. */
  signal: AbortSignal
}

/** The two questions a plate read asks a container; Mediabunny's `Input` answers them. */
interface PlateInput {
  canRead(): Promise<boolean>
  getVideoTracks(): Promise<unknown[]>
}

/**
 * The track a real container reports. Mediabunny keeps the class name private, so
 * it is read off `Input` rather than guessed at — the seam above erases the type
 * so a spec can hand back `{}`, and this is the one place that puts it back.
 */
type MediaVideoTrack = Awaited<ReturnType<Input['getVideoTracks']>>[number]

/** The pixels leg: `CanvasSink` answers it, and nothing else needs to. */
interface PlateSink {
  getCanvas(atSec: number): Promise<{ canvas: PlateCanvas } | null>
}

export interface TmcutPlateReaderDeps {
  open?: (read: TmcutMediaRead) => { input: PlateInput, close: () => void } | null
  /** The seam erases the track type, so the real builder below casts it back. */
  makeSink?: (track: unknown) => PlateSink
  hasDecoder?: () => boolean
}

/** One file the reader holds open, plus the turn-taking that serializes its reads. */
interface PlateHolder {
  opened: { input: PlateInput, close: () => void }
  sink: PlateSink | null
  queue: Promise<unknown>
  dead: boolean
}

/**
 * The export's plate leg: one container per file, for the whole run.
 *
 * `decodeFrame` above answers a thumbnail question — one instant, one PNG, one
 * `Input` opened and thrown away. An export asks the same question thousands of
 * times, in ascending order, for the same handful of files, and re-opening per
 * frame would demux from the first keyframe every time. So this is a reader with
 * a lifecycle its caller owns: `read` for every frame, `close` in the export's
 * `finally`.
 *
 * Three rules are the reason it is a module rather than a call site:
 *  - the instant goes to the sink verbatim, because core owns the clock;
 *  - the sink is built with no width, because `planEncodePlate` places a source
 *    whose geometry it is told truthfully — a proxy-sized plate would place
 *    correctly and encode a soft file;
 *  - one file's frames are read one at a time, because every frame of a file
 *    paints into that sink's ONE canvas and the encode session keeps more than
 *    one frame in flight (`planEncodeQueue`).
 */
export function createPlateReader(deps: TmcutPlateReaderDeps = {}) {
  const open = deps.open ?? openMedia
  const makeSink = deps.makeSink ?? ((track: unknown) => new CanvasSink(track as MediaVideoTrack))
  const canDecode = deps.hasDecoder ?? hasFrameDecoder
  const holders = new Map<string, PlateHolder>()
  let done = false

  /** Give a container back and stop ever reading it again. */
  function retire(src: string, holder: PlateHolder) {
    holder.dead = true
    if (holders.get(src) === holder) holders.delete(src)
    holder.opened.close()
  }

  async function readOne(src: string, holder: PlateHolder, ask: TmcutPlateAsk): Promise<TmcutPlate | null> {
    if (holder.dead || ask.signal.aborted) return null
    const input = holder.opened.input
    // A container that cannot answer, or holds no video, is not worth keeping:
    // a leak per failed frame is how an export dies at frame 900. The next frame
    // may still try the file, because a dropped location is not a dropped read.
    if (!(await input.canRead())) {
      retire(src, holder)
      return null
    }
    const [track] = await input.getVideoTracks()
    if (!track) {
      retire(src, holder)
      return null
    }
    if (!holder.sink) holder.sink = makeSink(track)
    const drawn = await holder.sink.getCanvas(ask.atSec)
    if (ask.signal.aborted || !drawn) {
      // A hole at one instant is a hole, not a broken file: only a cancel takes
      // the container down with it.
      if (ask.signal.aborted) retire(src, holder)
      return null
    }
    return { width: drawn.canvas.width, height: drawn.canvas.height, image: drawn.canvas }
  }

  async function read(ask: TmcutPlateAsk): Promise<TmcutPlate | null> {
    if (done || ask.signal.aborted || !ask.src || !canDecode()) return null
    const src = ask.src
    let holder = holders.get(src)
    if (!holder) {
      // No client bytes yet: the export reads its location, and the byte-cache
      // leg is a named gap in §53, not a decision this file forgot.
      const opened = open({ bytes: null, src, signal: ask.signal })
      if (!opened) return null
      holder = { opened, sink: null, queue: Promise.resolve(), dead: false }
      holders.set(src, holder)
      // `openMedia` releases the input when this signal fires; the reader also
      // has to stop handing that dead container to the frame after the cancel.
      const owned = holder
      ask.signal.addEventListener('abort', () => {
        owned.dead = true
      }, { once: true })
    }
    if (holder.dead) return null
    const owned = holder
    // The queue is never a rejected one: a failed read must not cost the next
    // frame its turn at the same container.
    const work = owned.queue.then(() => readOne(src, owned, ask))
    owned.queue = work.then(() => null, () => null)
    return await work
  }

  function close() {
    if (done) return
    done = true
    for (const [src, holder] of holders) retire(src, holder)
    holders.clear()
  }

  return { read, close }
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
