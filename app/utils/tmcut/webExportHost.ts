// The export button's other half: the real ports, assembled in one place.
//
// `createWebCodecsExport` (H3d-2c) takes four browser things as parameters and
// decides nothing about them. The two legs now exist — the plate reader (§53.8)
// and the sound leg (§53.9) — and the surface law has been shared since §53.7.
// This module is the assembly, and it is deliberately the only place in `app/`
// that names all four: a modal that assembled them again would be a second
// answer to "what does an export open", which is the drift class §53 retires.
//
// Two rules are why this is a module and not an object literal:
//  - the reader and the mixer own resources, so both are given back in `finally`
//    on every path — including a refusal that never needed them;
//  - the authored `clip.src` is not a location a decoder can open. It goes
//    through the host's `resolveSrc` (`resolveMediaSrc` in the app) before it
//    reaches a `UrlSource`, because a skipped resolve fails as "no plate", not
//    as "you forgot to resolve".
//
// The canvas is the one piece with no law of its own: `planEncodePlate` decided
// the rectangle, `encodeCanvasFill` decided the colour, and this only has to
// obey both. `begin` clears every frame — a painter that does not is the smear
// §53.5 pinned in core.

import { planEncodeContent, projectTracks } from 'tmcut-core'
import type { TmcutCanvas, TmcutProject } from 'tmcut-core'
import type { TmcutTrack } from '~/composables/useTmcutProject'
import { createWebCodecsExport } from './webCodecsExport'
import type { TmcutWebCodecsExportResult } from './webCodecsExport'
import { createPlateReader } from './frameDecode'
import { createExportMixLeg } from './exportMixLeg'
import { surfacesAt } from './paintSurfaces'

/**
 * The two legs as ports, so a spec can drive the whole assembly without a
 * decoder. Both shapes are structural copies of what the legs return; the real
 * defaults below hand over the real modules.
 */
export interface WebExportReader {
  read: (ask: { src: string | null, atSec: number, signal: AbortSignal }) => Promise<{
    width: number
    height: number
    image: unknown
  } | null>
  close: () => void
}

export interface WebExportMixer {
  mix: (ask: Record<string, unknown>) => Promise<Float32Array[]>
  close: () => void
  refused: () => Array<{ clipId: string | null, reason: string }>
}

export interface WebExportHostDeps {
  createReader?: (ports: { bytesFor?: (src: string) => Promise<Blob | null> }) => WebExportReader
  createMixer?: (
    project: { tracks?: unknown[] },
    ports: { bytesFor?: (src: string) => Promise<Blob | null> }
  ) => WebExportMixer
  createCanvas?: (width: number, height: number) => WebExportCanvas
  capability?: Parameters<typeof createWebCodecsExport>[0]['capability']
  session?: Parameters<typeof createWebCodecsExport>[0]['session']
  ports?: Parameters<typeof createWebCodecsExport>[0]['ports']
}

/** What a painted surface needs: one rectangle, one image, one alpha, one filter. */
export interface WebExportCanvas {
  element: unknown
  begin(fill: string): void
  draw(plate: { image: unknown }, rect: {
    source: { sx: number, sy: number, sw: number, sh: number }
    dest: { dx: number, dy: number, dw: number, dh: number }
    alpha: number
  }, filter?: string): void
  dispose(): void
}

export interface WebExportAsk {
  project: TmcutProject | { canvas?: TmcutCanvas, tracks?: never[] }
  /** The host's own path -> location rule (`resolveMediaSrc` in the app). */
  resolveSrc: (src: string) => string
  /**
   * The client byte cache's answer for ONE authored path, when the assembly has
   * a cache to ask. Keyed by the authored path and not by the resolved URL: the
   * cache names revisions of files the user imported, and `media://local?file=…`
   * is not one of them. Both legs share this answer, so the picture and the
   * sound can never come from two different copies of one file.
   */
  bytesFor?: (src: string) => Promise<Blob | null>
  signal?: AbortSignal
  onProgress?: (value: number) => void
}

/**
 * A real canvas, built the way both hosts can: `OffscreenCanvas` where the
 * runtime has one (it is the only kind a `VideoFrame` accepts without a DOM),
 * and an element otherwise. `draw` has to work on both, so it reads `alpha`
 * from the rect core returned rather than assuming an opaque plate.
 */
function offscreenOrElement(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement

function contextOf(canvas: AnyCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
  return canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
}

/** The canvas the painter and the encoder share for one export. */
export function createExportCanvas(width: number, height: number): WebExportCanvas {
  const canvas = offscreenOrElement(width, height)
  const context = contextOf(canvas)
  if (!context) throw new Error('this host has no 2D canvas for the export to paint on')
  return {
    element: canvas,
    begin(fill: string) {
      // A frame that is not cleared re-uses the last one's pixels. Core chose
      // this colour (`encodeCanvasFill`); this only has to start from it.
      context.globalAlpha = 1
      context.fillStyle = fill
      context.fillRect(0, 0, width, height)
    },
    draw(plate, rect, filter) {
      context.globalAlpha = rect.alpha
      // The effect chain rides on `ctx.filter`, which reads the same grammar the
      // preview's CSS `filter` uses — so `exportEffectFilter` hands the monitor's
      // own words here instead of a second set of numbers. Set on every draw (and
      // cleared after) because the filter belongs to THIS plate, not to the frame
      // background or the next row.
      if (filter) context.filter = filter
      context.drawImage(
        plate.image as CanvasImageSource,
        rect.source.sx, rect.source.sy, rect.source.sw, rect.source.sh,
        rect.dest.dx, rect.dest.dy, rect.dest.dw, rect.dest.dh
      )
      if (filter) context.filter = 'none'
      context.globalAlpha = 1
    },
    dispose() {
      // A canvas that held frame pixels is the largest allocation in the run;
      // zeroing its size is the one way to hand it back before GC does.
      canvas.width = 0
      canvas.height = 0
    }
  }
}

export interface WebExportHost {
  run: (ask: WebExportAsk) => Promise<TmcutWebCodecsExportResult>
  /** The mixer's named refusals, read after a run — never during one. */
  refused: () => Array<{ clipId: string | null, reason: string }>
}

export function createWebExportHost(deps: WebExportHostDeps = {}): WebExportHost {
  const makeReader = deps.createReader ?? (ports => createPlateReader(ports))
  const makeMixer = deps.createMixer ?? ((_project, ports) => createExportMixLeg(ports))
  const makeCanvas = deps.createCanvas ?? createExportCanvas
  let refusals: Array<{ clipId: string | null, reason: string }> = []

  async function run(ask: WebExportAsk): Promise<TmcutWebCodecsExportResult> {
    refusals = []
    // The content law decides the audio target (`ENCODE_AUDIO_REQUEST`), and the
    // mixer is created before the run because the glue asks it per packet. A
    // project core refuses never reaches a decoder: the loop below is inside the
    // try, but the legs are lazy in everything they open.
    const content = planEncodeContent(ask.project)
    // One port, two legs: the same answer about where a file's bytes live, so a
    // cached picture cannot be paired with a streamed sound from a different copy.
    const ports = ask.bytesFor ? { bytesFor: ask.bytesFor } : {}
    const reader = makeReader(ports)
    const mixer = makeMixer(ask.project as { tracks?: unknown[] }, ports)
    try {
      const audio = content.kind === 'eligible' && content.request?.audio
        ? content.request.audio
        : { sampleRate: 48_000, channelCount: 2 }
      const exporter = createWebCodecsExport({
        readPlate: async (plateAsk) => {
          const plate = await reader.read({
            src: plateAsk.src ? ask.resolveSrc(plateAsk.src) : null,
            // The cache is keyed by the authored path; the container still opens
            // the resolved location when the copy is not there.
            authoredSrc: plateAsk.src ?? null,
            atSec: plateAsk.atSec,
            signal: plateAsk.signal
          })
          if (!plate) return null
          return { width: plate.width, height: plate.height, image: plate.image }
        },
        createCanvas: makeCanvas,
        // Core's own resolution of "where are this project's rows": the store
        // keeps them under `timeline.tracks`, so a join that only looked at the
        // top level found no clip and painted nothing while core called the
        // project eligible — a file that opens and shows the background.
        surfaces: evaluation => surfacesAt(
          projectTracks<TmcutTrack>(ask.project as { timeline?: { tracks?: readonly TmcutTrack[] } }),
          evaluation as Parameters<typeof surfacesAt>[1]
        ).footage,
        pcm: request => mixer.mix({
          project: ask.project as { tracks?: never[], timeline?: { tracks?: never[] } },
          request,
          target: audio,
          signal: ask.signal
        }),
        capability: deps.capability,
        session: deps.session,
        ports: deps.ports
      })
      const result = await exporter.run({
        project: ask.project,
        signal: ask.signal,
        onProgress: ask.onProgress
      })
      refusals = mixer.refused()
      return result
    } finally {
      // Both legs own resources, and both are released however the run ended —
      // including the path where the glue threw before it asked for anything.
      mixer.close()
      reader.close()
    }
  }

  return { run, refused: () => refusals }
}
