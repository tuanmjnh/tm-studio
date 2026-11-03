import type { TmcutTimelineItem, TmcutTrack } from '~/composables/useTmcutProject'
import type { TmcutCropRect, TmcutMask } from 'tmcut-core'
import { classifyAssetKind, normalizeMask, resolveClipLayout, ticksToSec } from 'tmcut-core'
import { clipDurationTicks } from '~/utils/tmcut/clipTime'

/**
 * C16-R2/R3: the render pipeline's CANONICAL clip view.
 *
 * C16-R3 flipped the store: in/out/offset are INTEGER TICKS now, and
 * `toRenderClip` is the SINGLE decode point — everything downstream
 * (FFmpeg args, preview overlays, SRT) consumes SECONDS through the
 * *Sec fields plus the exact `durationTicks` (core audio builders take
 * the v3 shape, never the flat legacy one, so a tick item is never
 * misread as seconds).
 *
 * `raw` is the source item passed verbatim to core expression builders
 * that only touch unit-agnostic fields (keyframeExpr reads keyframes[],
 * already ticks); anything needing duration feeds `durationTicks`.
 */
export interface RenderClip {
  id: string
  /** Media input: absolute path of the source file (video/audio clips). */
  footagePath: string | null
  /** Text clip body (text tracks). */
  text: string | null
  /**
   * True when `footagePath` is a still image (png/jpg/webp…). A still decodes
   * as a single frame and carries NO audio stream, so the graph must loop it
   * into a video stream and synthesise its (silent) audio lane — otherwise the
   * `[i:a]` audio chain matches no stream and ffmpeg rejects the graph.
   */
  isImage: boolean
  /** Source in-point, media seconds (decoded from store ticks). */
  inSec: number
  /** Source out-point, media seconds (decoded from store ticks). */
  outSec: number
  /** Timeline position, seconds (decoded from store ticks). */
  offsetSec: number
  /** Timeline span, whole ticks (clipTime math — no float re-derivation). */
  durationTicks: number
  speed: number
  /** Percentage 0..100 (v1 scale). */
  scalePct: number
  /** Percentage 0..100 (v1 opacity). */
  opacityPct: number
  x: number
  y: number
  rotation: number
  /** Percentage 0..100 (v1 volume). */
  volumePct: number
  fit: string
  focusX: number
  focusY: number
  /** Normalized crop rect as stored (each fit adapter clamps it itself), null = none. */
  cropRect: TmcutCropRect | null
  /**
   * Mask geometry sanitized by core `normalizeMask` — the same call
   * `evaluateTimeline` puts on the layer (V4 M3), so the export's `geq` alpha
   * and the preview's CSS mask start from one shape. null = no mask.
   */
  mask: TmcutMask | null
  transitionIn: { type: string, duration: number } | null
  /** Source item for core expression builders (keyframeExpr). */
  raw: TmcutTimelineItem
  /** Track-level audio (R124 A1): the track this clip lives on. `muted`
   *  silences the whole track at mix time; `pan` (-100..100) shifts the
   *  stereo field. Both are 0/false when absent — a plain clip keeps the
   *  old byte-identical export. */
  trackMuted: boolean
  trackPan: number
  trackVolume: number
}

/**
 * Adapts an app timeline item (any track) to the render canonical view.
 * This is the ONLY place the render layer maps app-model fields — C16-R3
 * moved the time fields from seconds to ticks, decoded here once.
 *
 * `track` carries the track-level audio flags (mute/pan/volume) so the
 * render layer can express them at mix time without re-scanning the
 * timeline (R124 A1).
 */
export function toRenderClip(item: TmcutTimelineItem, track?: TmcutTrack | null): RenderClip {
  const src = item.src ?? null
  const footagePath = (item.stabilize && item.stabilizedPath) ? item.stabilizedPath : src
  // V4 M3: fit/focus/crop and the mask come from the same core calls the
  // evaluator makes, so the export can never place a frame differently from
  // the layer the preview read.
  const layout = resolveClipLayout(item)
  return {
    id: item.id,
    footagePath,
    isImage: classifyAssetKind(footagePath || '') === 'image',
    text: item.text ?? null,
    inSec: ticksToSec(item.in || 0),
    outSec: ticksToSec(item.out || 0),
    offsetSec: ticksToSec(item.offset || 0),
    durationTicks: clipDurationTicks(item),
    speed: item.speed || 1,
    scalePct: item.scale ?? 100,
    opacityPct: item.opacity ?? 100,
    x: item.x || 0,
    y: item.y || 0,
    rotation: item.rotation || 0,
    volumePct: item.volume ?? 100,
    fit: layout.fit,
    focusX: layout.focusX,
    focusY: layout.focusY,
    cropRect: layout.cropRect,
    mask: normalizeMask(item.mask),
    transitionIn: item.transitionIn ?? null,
    raw: item,
    trackMuted: !!track?.muted,
    trackPan: Number(track?.pan ?? 0),
    trackVolume: Number(track?.volume ?? 100)
  }
}

/**
 * Which rows the export may paint, decided by the SAME rule the preview uses:
 * `evaluateTimeline` walks every track and marks a layer invisible when its
 * track is `hidden`, so a hidden row must not reach the file either, and every
 * visible caption row is content — not only the first text track.
 *
 * `videoBase` is the ONE footage row the exporter composites today: the graph
 * builds a single concat chain, so parallel visible footage rows cannot be
 * stacked yet. They are returned as `extraVideoTracks` so the compiler can
 * still bound the file by them (content that is not exported must not shorten
 * the render) and the UI can warn honestly about what is missing.
 *
 * Audio is deliberately NOT gated by `hidden`: muting a row is the sound
 * control, hiding it is a picture control, and an audio track has no picture.
 * The evaluator reads the same two flags the same way (`visible` from
 * `hidden`, `audible` from `muted`).
 */
export interface ExportTrackSelection {
  videoBase: TmcutTrack | null
  extraVideoTracks: TmcutTrack[]
  textTracks: TmcutTrack[]
  audioTracks: TmcutTrack[]
}

function paints(track: TmcutTrack, needed: 'src' | 'text'): boolean {
  if (track.hidden === true) return false
  return (track.items || []).some(item => (needed === 'src' ? !!item.src : !!item.text))
}

/** Read-only view of the project's rows, in track order. Pure. */
export function selectExportTracks(
  project: { timeline?: { tracks?: TmcutTrack[] } } | null | undefined
): ExportTrackSelection {
  const tracks = project?.timeline?.tracks || []
  const videoRows = tracks.filter(t => t.type === 'video' && paints(t, 'src'))
  return {
    videoBase: videoRows[0] ?? null,
    extraVideoTracks: videoRows.slice(1),
    textTracks: tracks.filter(t => t.type === 'text' && paints(t, 'text')),
    audioTracks: tracks.filter(t => t.type === 'audio')
  }
}

/** Video-track items that carry media input, sorted by timeline position. */
export function renderVideoClips(track: TmcutTrack | null | undefined): RenderClip[] {
  return (track?.items || [])
    .filter(c => !!c.src)
    .sort((a, b) => (a.offset || 0) - (b.offset || 0))
    .map(c => toRenderClip(c, track))
}

/**
 * Audio-track items that carry media input, in track order. R124 A1:
 * accepts EVERY audio track (not just the first one) — a CapCut-style
 * project can layer background music, voiceover, and SFX on separate
 * rows, and they all mix into the output bus.
 */
export function renderAudioClips(tracks: TmcutTrack[] | undefined): RenderClip[] {
  const out: RenderClip[] = []
  for (const track of tracks || []) {
    if (track.type !== 'audio') continue
    for (const item of track.items || []) {
      if (!item.src) continue
      out.push(toRenderClip(item, track))
    }
  }
  return out
}

/**
 * Text items that carry a text body, in track order then timeline order.
 * R124 A1 did this for audio; captions got the same rule in V4 Phase 2 (5),
 * because a second text row is content the preview already shows.
 */
export function renderTextClips(tracks: TmcutTrack | TmcutTrack[] | undefined): RenderClip[] {
  const rows = tracks ? (Array.isArray(tracks) ? tracks : [tracks]) : []
  const out: RenderClip[] = []
  for (const track of rows) {
    for (const item of track.items || []) {
      if (!item.text) continue
      out.push(toRenderClip(item, track))
    }
  }
  return out
}

/** Timeline span of one clip, seconds (decoded from the exact tick span). */
export function renderClipDuration(clip: RenderClip): number {
  return ticksToSec(clip.durationTicks)
}
