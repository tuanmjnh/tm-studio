// The first real consumer of the encode session (zero-FFmpeg slice H3d-2c).
//
// H3c proved a seam can turn painted frames and mixed PCM into one muxed file,
// and H3d-1/H3d-2a put the three laws it needs in core: which projects may be
// painted (`planEncodeContent`), where each plate lands (`planEncodePlate`), and
// what colour the frame starts from (`encodeCanvasFill`). What was missing is the
// caller. This file is it, and it is deliberately the least clever module in the
// directory: it decides nothing that core has already decided, and it holds no
// platform code at all.
//
// The four things it cannot do without a browser are parameters:
//  - `readPlate` decodes one instant of one file to one image — sample and pixel
//    work, so it lives in `frameDecode.ts`, the module allowed to hold a demuxer;
//  - `createCanvas` gives the run one surface to paint on and take its pixels
//    from, which is `OffscreenCanvas` and nothing else;
//  - `surfaces` answers which layers paint at one tick, joined to the authored
//    clips — the SAME law the preview reads, so a file cannot show a different
//    picture from the monitor the user cut on;
//  - `pcm` fills one audio packet, which the offline mixer answers from core's
//    `planExportMixPacket`.
//
// The sequence, and nothing else, is this file's: ask core whether the project
// may be painted, ask the runtime which config it accepts, hand the session core's
// numbers (never a re-derivation of them), and report one of five honest outcomes.
// Three of its rules are load-bearing against bugs this slice has already seen:
//  - a refusal costs NOTHING: the content law runs before the probe, and a runtime
//    refusal before a canvas or a decode, so a project the painter cannot make
//    never leaves a half-written file behind;
//  - a plate that will not decode is an ERROR, not a black frame — §52's whole
//    lesson is that a file which opens and plays is not evidence of content;
//  - the mixer, the abort and the progress callback pass through unchanged,
//    because a glue that re-stamps an audio request or re-scales a progress number
//    is a second clock, and two clocks is the bug this programme is retiring.

import { createFrameScheduler, encodeCanvasFill, planEncodeContent, planEncodePlate } from 'tmcut-core'
import type { CoreEncodePlateRect, CoreEvaluatedLayer, TmcutCanvas, TmcutProject, TmcutTrack } from 'tmcut-core'
import { createEncodeCapability } from './exportEncodePlan'
import type { TmcutEncodeCapability, TmcutEncodeDecision } from './exportEncodePlan'
import { createEncodeSession } from './exportEncodeSession'
import type { TmcutEncodePorts, TmcutEncodeSession, TmcutPcmRequest } from './exportEncodeSession'

/** One decoded picture, with the intrinsic size `planEncodePlate` places by. */
export interface TmcutExportPlate {
  width: number
  height: number
  /** Opaque to the glue: the canvas port draws it and the encoder eats the result. */
  image: unknown
  /** Given back once it is on the surface. */
  release?: () => void
}

export interface TmcutExportPlateAsk {
  /** The authored file the surface's clip reads from, or null when it has none. */
  src: string | null
  /** core's media position for this surface — `ticksToSec(layer.sourceTicks)`. */
  atSec: number
  canvas: { width: number, height: number }
  signal: AbortSignal
}

export type TmcutExportPlateReader = (ask: TmcutExportPlateAsk) => Promise<TmcutExportPlate | null>

/** One footage surface: core's layer, the clip it was authored from, its media time. */
export interface TmcutExportSurface {
  role: 'paint' | 'outgoing'
  clip: { src?: string | null }
  layer: Pick<CoreEvaluatedLayer, 'layout' | 'transform' | 'opacity'>
  mediaTimeSec: number
}

/** The caller's own surface law, read at the tick core's grid named. */
export type TmcutExportSurfaceReader = (evaluation: { at?: number }) => TmcutExportSurface[]

/** One canvas for the whole run: fill it, draw the plates, hand out its pixels. */
export interface TmcutExportCanvas {
  /** Whatever a `VideoFrame` can be made from. */
  element: unknown
  begin(fill: string): void
  draw(plate: TmcutExportPlate, rect: CoreEncodePlateRect): void
  dispose(): void
}

export type TmcutExportCanvasFactory = (width: number, height: number) => TmcutExportCanvas

export interface TmcutWebCodecsExportDeps {
  readPlate: TmcutExportPlateReader
  createCanvas: TmcutExportCanvasFactory
  surfaces: TmcutExportSurfaceReader
  /** Required for a file with sound; absent is a refusal, never invented silence. */
  pcm?: (request: TmcutPcmRequest) => Float32Array[] | Promise<Float32Array[]>
  capability?: TmcutEncodeCapability
  session?: (ask: TmcutSessionAsk, ports?: TmcutEncodePorts) => TmcutEncodeSession
  ports?: TmcutEncodePorts
}

type TmcutSessionAsk = Parameters<typeof createEncodeSession>[0]

export type TmcutWebCodecsExportKind = 'exported' | 'content-refused' | 'runtime-refused' | 'canceled' | 'failed'

export interface TmcutWebCodecsExportAsk {
  /** The project exactly as the store holds it: core's laws read it directly. */
  project: TmcutExportProject
  signal?: AbortSignal
  onProgress?: (value: number) => void
  inFlight?: number
}

/**
 * What this glue may be handed: the store's own `TmcutProject`, or the shape
 * core's laws accept for a project. It is spelled out instead of `unknown`
 * because the fill needs `canvas.background` — the one authored field
 * `planEncodeContent` classifies and does not hand back — and a cast here would
 * be the glue re-deriving the schema, which is the drift this slice exists to
 * close. Both branches are read at the same path core reads them.
 */
type TmcutExportProject = TmcutProject | { canvas?: TmcutCanvas, tracks?: TmcutTrack[] }

export interface TmcutWebCodecsExportResult {
  kind: TmcutWebCodecsExportKind
  /** core's refusal words, verbatim — only ever for `content-refused`. */
  reasons: readonly string[]
  /** the capability's own sentences — only ever for `runtime-refused`. */
  errors: readonly string[]
  /** What the muxer closed with (a `Blob` on the web), or null. */
  output: unknown
  videoPackets: number
  audioPackets: number
  progress: number
  message: string | null
}

function refusal(
  kind: 'content-refused' | 'runtime-refused',
  reasons: readonly string[],
  errors: readonly string[]
): TmcutWebCodecsExportResult {
  return { kind, reasons, errors, output: null, videoPackets: 0, audioPackets: 0, progress: 0, message: null }
}

/**
 * What the caller can show. Every outcome of `run` is a result, never a
 * rejection: the export button is a UI, and an exception it forgot to catch is
 * an export that appears to do nothing.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function failure(message: string): TmcutWebCodecsExportResult {
  return {
    kind: 'failed',
    reasons: [],
    errors: [],
    output: null,
    videoPackets: 0,
    audioPackets: 0,
    progress: 0,
    message
  }
}

function canceled(message: string, progress = 0): TmcutWebCodecsExportResult {
  return {
    kind: 'canceled',
    reasons: [],
    errors: [],
    output: null,
    videoPackets: 0,
    audioPackets: 0,
    progress,
    message
  }
}

export function createWebCodecsExport(deps: TmcutWebCodecsExportDeps) {
  const capability = deps.capability ?? createEncodeCapability()
  const makeSession = deps.session ?? createEncodeSession

  async function run(ask: TmcutWebCodecsExportAsk): Promise<TmcutWebCodecsExportResult> {
    const signal = ask.signal ?? new AbortController().signal
    if (signal.aborted) return canceled('the export was cancelled before it started')

    // The content law first, and nothing else: it is the only call that knows
    // which projects this painter can make, and every step after it costs a
    // probe, a canvas or a decode.
    const content = planEncodeContent(ask.project)
    if (content.kind === 'refused' || !content.request || !content.canvas) {
      return refusal('content-refused', content.reasons, [])
    }
    const canvas = content.canvas

    let decision: TmcutEncodeDecision
    try {
      decision = await capability.decide(content.request)
    } catch (error) {
      // A dying probe is an outcome the UI can show, not a rejection it has to
      // remember to catch: `run` resolves however an export can end.
      return failure(messageOf(error))
    }
    if (decision.kind === 'refused' || !decision.config) {
      return refusal('runtime-refused', [], decision.errors)
    }
    // The container is the other half of the promise: a config with no muxer
    // format would start a session that cannot close a file.
    if (!decision.container) {
      return {
        ...refusal('runtime-refused', [], decision.errors),
        message: 'the accepted encode config names no container to write'
      }
    }

    const audio = decision.config.audio ?? null
    if (audio && !deps.pcm) {
      return failure('this export has sound and no offline mixer was wired; it will not write silence in its place')
    }

    const surface = deps.createCanvas(canvas.width, canvas.height)
    const startColor = encodeCanvasFill(ask.project.canvas)
    if (startColor === null) {
      // Only reachable if the content law and the fill law disagree, which
      // `export-canvas-fill` pins against each other. Painting black here would
      // be the §53 bug: a file that opens and shows nothing the user cut.
      surface.dispose()
      return failure('the canvas background has no colour a painted frame can start from')
    }
    // The painter is handed a colour, never a maybe: core's `null` answer left
    // with a failure above, and the frame must start from the same colour the
    // monitor shows.
    const fill: string = startColor
    const scheduler = createFrameScheduler(ask.project, { rate: canvas.fps })

    async function paint(index: number): Promise<unknown> {
      const frame = scheduler.frameAt(index)
      if (!frame) throw new Error(`the frame grid has no frame ${index}`)
      // One fill per frame, before any plate: a plate that moved must not leave
      // the previous frame's pixels showing through it.
      surface.begin(fill)
      for (const who of deps.surfaces(frame.evaluation)) {
        if (who.role !== 'paint') continue
        const src = who.clip.src ?? null
        const plate = await deps.readPlate({ src, atSec: who.mediaTimeSec, canvas, signal })
        if (!plate) {
          // A frame the file cannot show is not a black frame: the preview showed
          // a picture here, and a quiet black moment is exactly the kind of wrong
          // output §52 says an opening, playing file cannot be trusted to avoid.
          throw new Error(`no plate could be decoded for ${src ?? 'a clip with no source'} at ${who.mediaTimeSec}s`)
        }
        const rect = planEncodePlate({
          media: { width: plate.width, height: plate.height },
          canvas,
          layout: who.layer.layout,
          transform: who.layer.transform,
          opacity: who.layer.opacity
        })
        if (!rect) {
          throw new Error(`${src ?? 'a clip with no source'} has a fit this painter cannot place`)
        }
        surface.draw(plate, rect)
        plate.release?.()
      }
      return surface.element
    }

    const session = makeSession({
      container: decision.container,
      video: decision.config.video,
      audio,
      totalFrames: content.totalFrames,
      contentEndTicks: content.contentEndTicks,
      paint,
      // A silent file has no answer to give: the session never asks, and if it
      // ever does, that is a disagreement between two core laws, not something
      // to paper over with zeros. With sound, the mixer is handed over exactly
      // as it came — a wrapper that re-stamped a request would be a second clock.
      pcm: audio ? deps.pcm! : () => { throw new Error('a silent file has no mixer to answer with') },
      inFlight: ask.inFlight,
      signal,
      onProgress: ask.onProgress
    }, deps.ports)

    try {
      const outcome = await session.run()
      if (signal.aborted) return canceled('the export was cancelled', outcome.progress)
      return {
        kind: 'exported',
        reasons: [],
        errors: [],
        output: outcome.output,
        videoPackets: outcome.videoPackets,
        audioPackets: outcome.audioPackets,
        progress: outcome.progress,
        message: null
      }
    } catch (error) {
      const message = messageOf(error)
      if (signal.aborted) return canceled(message)
      return failure(message)
    } finally {
      // One canvas per export, given back however the run ended: the encoder has
      // its own copies of the pixels, and a surface left alive is a leak per file.
      surface.dispose()
    }
  }

  return { run }
}
