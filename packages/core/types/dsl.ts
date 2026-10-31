// TMCut Timeline DSL v3 — core time, canvas, track and clip types.
// Mirrors docs/TMCut Architecture v3.md sections 2, 3 and 14.
// Type-only package: no runtime code, no imports.

/** Internal time unit: integer ticks. See TICKS_PER_SECOND in @tmcut/core. */
export type MediaTime = number

export interface FrameRate {
  numerator: number
  denominator: number
}

export type TmcutOrientation = 'landscape' | 'portrait' | 'square'

export interface TmcutAspectRatio {
  id: string
  value: number
  orientation: TmcutOrientation
}

export interface TmcutCanvasBackground {
  type: 'color' | 'image' | 'transparent'
  value?: string
}

export type TmcutFitMode = 'fit' | 'fill' | 'crop' | 'stretch' | 'smart'

export interface TmcutCropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface TmcutCanvas {
  width: number
  height: number
  fps: FrameRate
  aspectRatio: TmcutAspectRatio
  background: TmcutCanvasBackground
}

export type TmcutTrackType = 'video' | 'text' | 'audio'

export interface TmcutTransform {
  x: number
  y: number
  scaleX: number
  scaleY: number
  rotation: number
  /** 0..1 */
  opacity: number
}

export interface TmcutClipEffect {
  type: string
  params: Record<string, unknown>
}

export interface TmcutKeyframe {
  /** ticks on the timeline */
  t: MediaTime
  prop: string
  value: number
}

export interface TmcutTransition {
  type: string
  /** ticks */
  duration: MediaTime
}

export interface TmcutTimelineClip {
  id: string
  type: TmcutTrackType
  name?: string
  /** Registry reference. Null while the clip still carries a legacy path locator. */
  assetId: string | null
  /** Transitional bridge for path-based projects (see section 15 migration). */
  locator: {
    runtime: string
    path: string
  } | null
  /** Media range, in ticks. */
  source: {
    in: MediaTime
    out: MediaTime
  }
  /** Timeline placement, in ticks. */
  timeline: {
    start: MediaTime
    duration: MediaTime
  }
  speed: number
  reverse?: boolean
  /** Group editing: clips sharing a groupId move/select together. */
  groupId?: string | null
  /** Linked pair (e.g. video + its audio): select/move together. */
  linkId?: string | null
  transform: TmcutTransform
  fit?: TmcutFitMode
  focusX?: number
  focusY?: number
  cropRect?: TmcutCropRect
  /** 0..100, audio-bearing clips */
  volume?: number
  text?: string
  color?: string
  fontSize?: number
  /** Font family shown by the preview overlay (roadmap C-1). */
  fontFamily?: string
  /** File of the SAME face the preview family points at, for export drawtext fontfile=. */
  fontFile?: string
  /** Text style flags (roadmap C-2): bold/italic select the matching face file app-side; align anchors the block (default center = legacy behavior). */
  bold?: boolean
  italic?: boolean
  align?: 'left' | 'center' | 'right'
  shadow?: boolean
  stroke?: boolean
  /** Text animation in (intro) and out (outro) (Roadmap C-5). */
  animIn?: TmcutTextAnimationType
  animInDuration?: number
  animOut?: TmcutTextAnimationType
  animOutDuration?: number
  /** Video stabilization (Roadmap E-5). */
  stabilize?: boolean
  stabilizeLevel?: TmcutStabilizeLevel
  stabilizedPath?: string | null
  stabilizeStatus?: TmcutStabilizeStatus
  effects: TmcutClipEffect[]
  keyframes: TmcutKeyframe[]
  transitionIn?: TmcutTransition
  /** Fade in/out audio envelope, in TICKS (Roadmap C12). */
  fade?: { in: MediaTime, out: MediaTime }
}

export type TmcutTextAnimationType
  = | 'none'
    | 'fade'
    | 'slide-up'
    | 'slide-down'
    | 'slide-left'
    | 'slide-right'
    | 'zoom-in'
    | 'zoom-out'

export type TmcutStabilizeLevel = 'mild' | 'medium' | 'aggressive'

export type TmcutStabilizeStatus = 'none' | 'processing' | 'ready' | 'error'

export interface TmcutTrack {
  id: string
  type: TmcutTrackType
  name?: string
  muted?: boolean
  locked?: boolean
  hidden?: boolean
  items: TmcutTimelineClip[]
}

export interface TmcutMarker {
  id: string
  /** ticks */
  at: MediaTime
  label?: string
  color?: string
}

export interface TmcutTimeline {
  version: 3
  tracks: TmcutTrack[]
  markers: TmcutMarker[]
}

export interface TmcutMediaFolder {
  id: string
  name: string
  color?: string
  projectId?: string | null
  createdAt?: number | string
}

export type TmcutTemplateCategory
  = | 'intro'
    | 'outro'
    | 'split-screen'
    | 'social'
    | 'promo'
    | 'minimal'
    | 'custom'

export interface TmcutTemplatePlaceholder {
  id: string
  type: 'video' | 'image' | 'audio' | 'text'
  label: string
  clipId: string
  trackId?: string
  defaultContent?: string
  required?: boolean
}

export interface TmcutTemplate {
  id: string
  name: string
  description?: string
  category: TmcutTemplateCategory
  aspectRatio: '9:16' | '16:9' | '1:1'
  canvas: {
    width: number
    height: number
    fps: number
  }
  durationTicks: MediaTime
  tracks: TmcutTrack[]
  markers?: TmcutMarker[]
  placeholders: TmcutTemplatePlaceholder[]
  thumbnail?: string
  author?: string
  createdAt?: number
  isBuiltin?: boolean
}

export interface TmcutProject {
  version: 3
  project: {
    id: string
    name: string
    /** ticks */
    duration: MediaTime
  }
  canvas: TmcutCanvas
  timeline: TmcutTimeline
}
