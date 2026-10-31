import type { TmcutTimelineItem, TmcutTrack } from '~/composables/useTmcutProject'
import { classifyAssetKind, ticksToSec } from '@tmcut-core'
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
    fit: item.fit || 'fit',
    focusX: item.focusX ?? 0.5,
    focusY: item.focusY ?? 0.5,
    transitionIn: item.transitionIn ?? null,
    raw: item,
    trackMuted: !!track?.muted,
    trackPan: Number(track?.pan ?? 0),
    trackVolume: Number(track?.volume ?? 100)
  }
}

/** Video-track items that carry media input, sorted by timeline position. */
export function renderVideoClips(track: TmcutTrack | undefined): RenderClip[] {
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

/** Text-track items that carry a text body, in track order. */
export function renderTextClips(track: TmcutTrack | undefined): RenderClip[] {
  return (track?.items || []).filter(c => !!c.text).map(c => toRenderClip(c, track))
}

/** Timeline span of one clip, seconds (decoded from the exact tick span). */
export function renderClipDuration(clip: RenderClip): number {
  return ticksToSec(clip.durationTicks)
}
