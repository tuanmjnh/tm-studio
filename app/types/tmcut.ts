export type TmcutAssetKind = 'video' | 'audio' | 'image'

export type TmcutAssetStatus = 'ready' | 'analyzing' | 'missing' | 'error'

export type TmcutFitMode = 'fit' | 'fill' | 'crop' | 'stretch' | 'smart'

export type TmcutOrientation = 'landscape' | 'portrait' | 'square'

export interface TmcutCropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface TmcutAspectRatio {
  id: string
  value: number
  orientation: TmcutOrientation
}

export interface TmcutCanvasBackground {
  type: 'color' | 'image' | 'transparent'
  value?: string
}

export interface FrameRate {
  numerator: number
  denominator: number
}

export interface TmcutCanvas {
  width: number
  height: number
  fps: FrameRate
  aspectRatio: TmcutAspectRatio
  background: TmcutCanvasBackground
}

export interface TmcutAssetMeta {
  durationSec: number
  width: number
  height: number
  fps: number
  fileSize: number
  mtimeMs: number
  probedAt: string | null
  /** True when the container reports at least one video stream (width > 0).
   *  False for audio-only containers mislabeled as video (e.g. WebM-audio). */
  hasVideo?: boolean
}

export interface TmcutAsset {
  id: string
  kind: TmcutAssetKind
  name: string
  path: string
  usedBy: string[]
  status: TmcutAssetStatus
  meta: TmcutAssetMeta
  /** Single-frame cover (library grid). Desktop: cache file; web: source/dataURL. */
  thumbPath: string | null
  /** 8-frame filmstrip for timeline clips (desktop only, null elsewhere). */
  filmstripPath: string | null
  waveformPath: string | null
  /** Lightweight 540p/720p H.264 preview proxy file path (roadmap F-4). */
  proxyPath?: string | null
  /** Status of proxy generation. */
  proxyStatus?: 'none' | 'generating' | 'ready' | 'error'
  /** Media folder ID (roadmap G-3). */
  folderId?: string | null
  /** Project-scoped folder IDs map: projectId -> folderId (roadmap G-3). */
  folderByProject?: Record<string, string>
  addedAt: string
}

export interface TmcutMediaFolder {
  id: string
  name: string
  color?: string
  projectId?: string | null
  createdAt?: number | string
}

export interface TmcutProjectFileInfo {
  id: string
  name: string
  updatedAt: string
  size: number
}

export interface TmcutSnapshotInfo {
  ts: number
  name: string
  updatedAt: string
}

export interface TmcutFileStat {
  exists: boolean
  size: number
  mtimeMs: number
}

export interface TmcutProjectMeta {
  hasProject: boolean
  projectMtimeMs: number
  hasRecovery: boolean
  recoveryUpdatedAtMs: number | null
}

export interface TmcutRecoveryInfo {
  id: string
  updatedAt: string
  mode: 'suggest' | 'force'
}

export function createEmptyTmcutAssetMeta(): TmcutAssetMeta {
  return {
    durationSec: 0,
    width: 0,
    height: 0,
    fps: 0,
    fileSize: 0,
    mtimeMs: 0,
    probedAt: null
  }
}

export type {
  TmcutTemplate,
  TmcutTemplatePlaceholder,
  TmcutTemplateCategory,
  TmcutTemplateIndustry
} from '@tmcut-core'
