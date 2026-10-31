// TMCut Editor API surface (docs section 37).
// UI and AI assistants program against this interface only — never
// against timeline internals, Electron IPC, or FFmpeg.

import type { MediaTime } from './dsl.js'

export interface TmcutEditorTimelineApi {
  addClip(trackType: 'video' | 'text' | 'audio', partial: Record<string, unknown>): string | null
  splitClip(clipId: string, splitTime: MediaTime): boolean
  removeClip(clipId: string): boolean
  moveClip(clipId: string, start: MediaTime): boolean
  setSpeed(clipId: string, speed: number): boolean
  setVolume(clipId: string, volume: number): boolean
  addTransition(clipId: string, transition: Record<string, unknown>): boolean
  addEffect(clipId: string, effect: Record<string, unknown>): boolean
  addKeyframe(clipId: string, keyframe: Record<string, unknown>): boolean
  undo(): boolean
  redo(): boolean
}

export interface TmcutEditorCanvasApi {
  setAspectRatio(width: number, height: number): void
}

export interface TmcutEditorSubtitleApi {
  add(text: string, start: MediaTime, duration: MediaTime): string | null
}

export interface TmcutEditorExportApi {
  createPlan(outputPath: string): Record<string, unknown>
}

export interface TmcutEditorApi {
  timeline: TmcutEditorTimelineApi
  canvas: TmcutEditorCanvasApi
  subtitle: TmcutEditorSubtitleApi
  export: TmcutEditorExportApi
}
