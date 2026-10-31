// TMCut media registry types (docs section 16, 47-49).
// Type-only: asset references never carry runtime handles.

export type TmcutAssetKind = 'video' | 'audio' | 'image'

export type TmcutAssetStatus = 'ready' | 'analyzing' | 'missing' | 'error'

export type TmcutAssetSourceType = 'local' | 'browser-file' | 'cloud'

export interface TmcutAssetLocator {
  runtime: string
  path?: string
  url?: string
}

export interface TmcutMediaMetadata {
  durationSec: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
}

export interface TmcutMediaProxy {
  assetId: string
  cachePath: string
  width: number
  createdAt: string
}

export interface TmcutAsset {
  id: string
  kind: TmcutAssetKind
  name: string
  status: TmcutAssetStatus
  sourceType: TmcutAssetSourceType
  locator: TmcutAssetLocator
  durationSec: number
  width: number
  height: number
  fps: number
  fileSize: number
  hash: string | null
}

export type TmcutAnalysisVersion = string

export interface TmcutSceneSegment {
  /** seconds */
  start: number
  /** seconds */
  end: number
  score: number
}

export interface TmcutMediaAnalysis {
  assetId: string
  version: TmcutAnalysisVersion
  scenes: TmcutSceneSegment[]
  speech: Array<{ start: number, end: number }> | null
  transcript: string | null
  faces: unknown | null
  objects: unknown | null
  motion: number[] | null
  audio: number[] | null
  beats: number[] | null
  bpm: number | null
}
