import type { TmcutTimelineItem } from '~/composables/useTmcutProject'

export type TmcutCompileMode = 'video' | 'audio' | 'gif'

export interface TmcutCompileRange {
  start: number
  end: number
}

export interface CompileOptions {
  encoder?: string
  crf?: number
  bitrate?: number
  /** Output mode: full video (default), audio-only export, or animated GIF. */
  mode?: TmcutCompileMode
  /** In/Out render zone (design #3). Clamped to the timeline; out > in required. */
  range?: TmcutCompileRange | null
  /** Output resolution multiplier relative to the canvas (1 = native). */
  outScale?: number
  /** Output frame rate (defaults to the canvas fps). */
  outFps?: number
  /** MP3 bitrate in kbps (audio mode only). */
  audioBitrate?: number
  /** Export-time noise reduction: ONE global afftdn on the final audio bus (roadmap D-3). */
  denoise?: boolean
  /** Color LUT: absolute path of a .cube file graded onto the footage before drawtext (roadmap E-4). */
  lut3dPath?: string
  /** Phase 4 / R76: canvas background is transparent — pick an alpha-capable output pix_fmt. */
  transparent?: boolean
}

export interface CompileResult {
  args: string[]
  duration: number
  summary: string
}

export interface RenderContext {
  canvasW: number
  canvasH: number
  fps: number
  totalDuration: number
  outputDuration: number
  outScale: number
  outFps: number
  mode: TmcutCompileMode
  range: TmcutCompileRange | null
  bgColor: string
  hasAudio: boolean
}

export type TextOverlayClip = Pick<
  TmcutTimelineItem,
  | 'text'
  | 'fontSize'
  | 'color'
  | 'x'
  | 'y'
  | 'offset'
  | 'in'
  | 'out'
  | 'speed'
  | 'fontFile'
  | 'bold'
  | 'italic'
  | 'align'
  | 'shadow'
  | 'stroke'
  | 'shadowColor'
  | 'strokeColor'
  | 'bgColor'
  | 'opacity'
  | 'rotation'
  | 'mask'
  | 'keyframes'
  | 'animIn'
  | 'animInDuration'
  | 'animOut'
  | 'animOutDuration'
>
