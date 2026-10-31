// =============================================================================
// Authoritative Timeline Command API — Roadmap v1 P0
// Single source of truth for all timeline mutations. UI, AI Agent, Voice, MCP
// all go through this layer. No direct state mutation allowed.
// =============================================================================

import type { TmcutTimelineItem, TmcutTrack, TmcutProject } from '~/composables/useTmcutProject'
import type { TmcutMarker } from '@tmcut-core'

// -----------------------------------------------------------------------------
// Core Types
// -----------------------------------------------------------------------------

export type TimelineCommandType = 
  // Project level
  | 'project.create'
  | 'project.load'
  | 'project.save'
  | 'project.delete'
  | 'project.duplicate'
  | 'project.switchCanvas'
  | 'project.setBackground'
  | 'project.setName'
  // Track level
  | 'track.add'
  | 'track.remove'
  | 'track.move'
  | 'track.rename'
  | 'track.setVisibility'
  | 'track.setLocked'
  | 'track.setMuted'
  | 'track.setVolume'
  | 'track.setPan'
  // Clip level
  | 'clip.add'
  | 'clip.remove'
  | 'clip.move'
  | 'clip.trim'
  | 'clip.split'
  | 'clip.duplicate'
  | 'clip.setSpeed'
  | 'clip.setTransition'
  | 'clip.clearTransition'
  | 'clip.setEffects'
  | 'clip.addEffect'
  | 'clip.removeEffect'
  | 'clip.setKeyframes'
  | 'clip.setStabilize'
  | 'clip.setCrop'
  | 'clip.setMask'
  // Marker level
  | 'marker.add'
  | 'marker.remove'
  | 'marker.update'
  // Render zone
  | 'render.setIn'
  | 'render.setOut'
  | 'render.clear'
  // History
  | 'history.undo'
  | 'history.redo'
  | 'history.push'
  // Batch (AI/Factory)
  | 'batch.applyProposal'

export interface TimelineCommand<T = unknown> {
  type: TimelineCommandType
  payload: T
  // Metadata
  requestId: string // UUID for idempotency
  timestamp: number // epoch ms
  source: 'ui' | 'ai' | 'voice' | 'mcp' | 'test'
  // Approval flow
  requiresApproval?: boolean
  approvalReason?: string
  estimatedCostUsd?: number
}

// -----------------------------------------------------------------------------
// Command Payloads
// -----------------------------------------------------------------------------

// Project Commands
export interface ProjectCreatePayload {
  name: string
  canvas?: { width: number; height: number; fps: { numerator: number; denominator: number } }
  source?: 'manual' | 'template' | 'ai' | 'import'
  templateId?: string
  templateVersion?: string
}

export interface ProjectLoadPayload {
  projectId: string
}

export interface ProjectSavePayload {
  projectId: string
}

export interface ProjectDeletePayload {
  projectId: string
}

export interface ProjectDuplicatePayload {
  projectId: string
  newName?: string
  presetId?: string
}

export interface ProjectSwitchCanvasPayload {
  width: number
  height: number
  fps?: { numerator: number; denominator: number }
}

export interface ProjectSetBackgroundPayload {
  type: 'color' | 'image' | 'transparent'
  value?: string
}

export interface ProjectSetNamePayload {
  projectId: string
  name: string
}

// Track Commands
export interface TrackAddPayload {
  type: 'video' | 'text' | 'audio'
  name?: string
  index?: number // insert position
}

export interface TrackRemovePayload {
  trackId: string
  force?: boolean // remove even if locked (requires approval)
}

export interface TrackMovePayload {
  trackId: string
  direction: 'up' | 'down'
}

export interface TrackRenamePayload {
  trackId: string
  name: string
}

export interface TrackSetVisibilityPayload {
  trackId: string
  hidden: boolean
}

export interface TrackSetLockedPayload {
  trackId: string
  locked: boolean
}

export interface TrackSetMutedPayload {
  trackId: string
  muted: boolean
}

export interface TrackSetVolumePayload {
  trackId: string
  volume: number // 0-100
}

export interface TrackSetPanPayload {
  trackId: string
  pan: number // -100 to 100
}

// Clip Commands
export interface ClipAddPayload {
  trackId: string
  trackType: 'video' | 'text' | 'audio'
  clip: Omit<TmcutTimelineItem, 'id'>
  atIndex?: number
}

export interface ClipRemovePayload {
  clipId: string
  ripple?: boolean
}

export interface ClipMovePayload {
  clipId: string
  targetTrackId?: string
  targetOffset: number // ticks
  targetIndex?: number
}

export interface ClipTrimPayload {
  clipId: string
  edge: 'in' | 'out'
  newOffset: number // ticks
}

export interface ClipSplitPayload {
  clipId: string
  splitTimeSec: number
}

export interface ClipDuplicatePayload {
  clipId: string
  targetTrackId?: string
  targetOffset?: number // ticks, defaults to end of clip
}

export interface ClipSetSpeedPayload {
  clipId: string
  speed: number
}

export interface ClipSetTransitionPayload {
  clipId: string
  type: string // transition key from catalog
  durationSec: number
}

export interface ClipClearTransitionPayload {
  clipId: string
}

export interface ClipSetEffectsPayload {
  clipId: string
  effects: Array<{ type: string; params: Record<string, unknown> }>
}

export interface ClipAddEffectPayload {
  clipId: string
  effect: { type: string; params: Record<string, unknown> }
}

export interface ClipRemoveEffectPayload {
  clipId: string
  effectType: string
}

export interface ClipSetKeyframesPayload {
  clipId: string
  keyframes: Array<{ t: number; prop: string; value: number; easing?: string }>
}

export interface ClipSetStabilizePayload {
  clipId: string
  enabled: boolean
  stabilizedPath?: string
}

export interface ClipSetCropPayload {
  clipId: string
  crop: { x: number; y: number; width: number; height: number } // normalized 0-1
}

export interface ClipSetMaskPayload {
  clipId: string
  mask: { 
    type: 'rectangle' | 'circle' | 'linear'
    x: number; y: number; width: number; height: number
    rotation?: number
    feather?: number
    inverted?: boolean
  } | null
}

// Marker Commands
export interface MarkerAddPayload {
  atSec: number
  label?: string
  color?: string
}

export interface MarkerRemovePayload {
  markerId: string
}

export interface MarkerUpdatePayload {
  markerId: string
  label?: string
  color?: string
}

// Render Zone Commands
export interface RenderSetInPayload {
  timeSec: number
}

export interface RenderSetOutPayload {
  timeSec: number
}

export interface RenderClearPayload {
  // no payload
}

// History Commands
export interface HistoryUndoPayload {
  // no payload
}

export interface HistoryRedoPayload {
  // no payload
}

export interface HistoryPushPayload {
  description: string
}

// Batch Command (AI/Factory)
export interface BatchApplyProposalPayload {
  proposalId: string
  operations: ProposalOperation[]
}

export interface ProposalOperation {
  op: 'add' | 'remove' | 'update' | 'move'
  targetType: 'clip' | 'track' | 'marker' | 'project' | 'render'
  targetId?: string
  data: Record<string, unknown>
}

// -----------------------------------------------------------------------------
// Command Registry (for validation & documentation)
// -----------------------------------------------------------------------------

export const COMMAND_SPECS: Record<TimelineCommandType, {
  description: string
  requiresApproval: boolean
  estimatedCostUsd?: number
  approvalReasonTemplate?: string
}> = {
  // Project
  'project.create': { description: 'Create new project', requiresApproval: false },
  'project.load': { description: 'Load existing project', requiresApproval: false },
  'project.save': { description: 'Save project to disk', requiresApproval: false },
  'project.delete': { description: 'Delete project permanently', requiresApproval: true, approvalReasonTemplate: 'This will permanently delete project "{{name}}" and all its data.' },
  'project.duplicate': { description: 'Duplicate project with optional canvas preset', requiresApproval: false },
  'project.switchCanvas': { description: 'Change canvas resolution/aspect ratio', requiresApproval: false },
  'project.setBackground': { description: 'Set canvas background', requiresApproval: false },
  'project.setName': { description: 'Rename project', requiresApproval: false },
  
  // Track
  'track.add': { description: 'Add new track', requiresApproval: false },
  'track.remove': { description: 'Remove track and all its clips', requiresApproval: true, approvalReasonTemplate: 'This will delete track "{{trackId}}" and all {{clipCount}} clips on it.' },
  'track.move': { description: 'Move track up/down in stack', requiresApproval: false },
  'track.rename': { description: 'Rename track', requiresApproval: false },
  'track.setVisibility': { description: 'Show/hide track', requiresApproval: false },
  'track.setLocked': { description: 'Lock/unlock track', requiresApproval: false },
  'track.setMuted': { description: 'Mute/unmute track', requiresApproval: false },
  'track.setVolume': { description: 'Set track volume (0-100)', requiresApproval: false },
  'track.setPan': { description: 'Set track pan (-100 to 100)', requiresApproval: false },
  
  // Clip
  'clip.add': { description: 'Add clip to track', requiresApproval: false },
  'clip.remove': { description: 'Remove clip from timeline', requiresApproval: false },
  'clip.move': { description: 'Move clip to new position/track', requiresApproval: false },
  'clip.trim': { description: 'Trim clip in/out point', requiresApproval: false },
  'clip.split': { description: 'Split clip at playhead', requiresApproval: false },
  'clip.duplicate': { description: 'Duplicate clip', requiresApproval: false },
  'clip.setSpeed': { description: 'Change clip playback speed', requiresApproval: false },
  'clip.setTransition': { description: 'Add transition to clip', requiresApproval: false },
  'clip.clearTransition': { description: 'Remove transition from clip', requiresApproval: false },
  'clip.setEffects': { description: 'Replace all effects on clip', requiresApproval: false },
  'clip.addEffect': { description: 'Add effect to clip', requiresApproval: false },
  'clip.removeEffect': { description: 'Remove effect from clip', requiresApproval: false },
  'clip.setKeyframes': { description: 'Set keyframe animation', requiresApproval: false },
  'clip.setStabilize': { description: 'Enable/disable stabilization', requiresApproval: false },
  'clip.setCrop': { description: 'Set clip crop region', requiresApproval: false },
  'clip.setMask': { description: 'Set clip mask', requiresApproval: false },
  
  // Marker
  'marker.add': { description: 'Add timeline marker', requiresApproval: false },
  'marker.remove': { description: 'Remove timeline marker', requiresApproval: false },
  'marker.update': { description: 'Update marker label/color', requiresApproval: false },
  
  // Render Zone
  'render.setIn': { description: 'Set render in point', requiresApproval: false },
  'render.setOut': { description: 'Set render out point', requiresApproval: false },
  'render.clear': { description: 'Clear render zone', requiresApproval: false },
  
  // History
  'history.undo': { description: 'Undo last operation', requiresApproval: false },
  'history.redo': { description: 'Redo last undone operation', requiresApproval: false },
  'history.push': { description: 'Push history checkpoint', requiresApproval: false },
  
  // Batch
  'batch.applyProposal': { description: 'Apply AI/Factory proposal as single undo group', requiresApproval: true, approvalReasonTemplate: 'Apply {{operationCount}} operations as a single undo group. Estimated cost: ${{estimatedCostUsd}}.' }
}

// -----------------------------------------------------------------------------
// Command Execution Result
// -----------------------------------------------------------------------------

export interface CommandResult<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    retryable: boolean
    retryAfterSec?: number
  }
  // For audit
  affectedIds?: string[]
  undoGroupId?: string
}

export interface ProposalResult {
  ok: boolean
  applied: number
  skipped: number
  errors: Array<{ index: number; error: string }>
  undoGroupId: string
}

// -----------------------------------------------------------------------------
// Type Guards
// -----------------------------------------------------------------------------

export function isProjectCommand(type: TimelineCommandType): boolean {
  return type.startsWith('project.')
}

export function isTrackCommand(type: TimelineCommandType): boolean {
  return type.startsWith('track.')
}

export function isClipCommand(type: TimelineCommandType): boolean {
  return type.startsWith('clip.')
}

export function isMarkerCommand(type: TimelineCommandType): boolean {
  return type.startsWith('marker.')
}

export function isRenderCommand(type: TimelineCommandType): boolean {
  return type.startsWith('render.')
}

export function isHistoryCommand(type: TimelineCommandType): boolean {
  return type.startsWith('history.')
}

export function isBatchCommand(type: TimelineCommandType): boolean {
  return type.startsWith('batch.')
}

export function requiresApproval(type: TimelineCommandType): boolean {
  return COMMAND_SPECS[type]?.requiresApproval ?? false
}

// -----------------------------------------------------------------------------
// Command Factory Functions
// -----------------------------------------------------------------------------

// Internal factory with proper type inference using const assertions
export function createCommand<const T extends TimelineCommandType>(
  type: T,
  payload: T extends 'render.clear' | 'history.undo' | 'history.redo' ? undefined : 
    T extends 'project.create' ? ProjectCreatePayload :
    T extends 'project.load' ? ProjectLoadPayload :
    T extends 'project.save' ? ProjectSavePayload :
    T extends 'project.delete' ? ProjectDeletePayload :
    T extends 'project.duplicate' ? ProjectDuplicatePayload :
    T extends 'project.switchCanvas' ? ProjectSwitchCanvasPayload :
    T extends 'project.setBackground' ? ProjectSetBackgroundPayload :
    T extends 'project.setName' ? ProjectSetNamePayload :
    T extends 'track.add' ? TrackAddPayload :
    T extends 'track.remove' ? TrackRemovePayload :
    T extends 'track.move' ? TrackMovePayload :
    T extends 'track.rename' ? TrackRenamePayload :
    T extends 'track.setVisibility' ? TrackSetVisibilityPayload :
    T extends 'track.setLocked' ? TrackSetLockedPayload :
    T extends 'track.setMuted' ? TrackSetMutedPayload :
    T extends 'track.setVolume' ? TrackSetVolumePayload :
    T extends 'track.setPan' ? TrackSetPanPayload :
    T extends 'clip.add' ? ClipAddPayload :
    T extends 'clip.remove' ? ClipRemovePayload :
    T extends 'clip.move' ? ClipMovePayload :
    T extends 'clip.trim' ? ClipTrimPayload :
    T extends 'clip.split' ? ClipSplitPayload :
    T extends 'clip.duplicate' ? ClipDuplicatePayload :
    T extends 'clip.setSpeed' ? ClipSetSpeedPayload :
    T extends 'clip.setTransition' ? ClipSetTransitionPayload :
    T extends 'clip.clearTransition' ? ClipClearTransitionPayload :
    T extends 'clip.setEffects' ? ClipSetEffectsPayload :
    T extends 'clip.addEffect' ? ClipAddEffectPayload :
    T extends 'clip.removeEffect' ? ClipRemoveEffectPayload :
    T extends 'clip.setKeyframes' ? ClipSetKeyframesPayload :
    T extends 'clip.setStabilize' ? ClipSetStabilizePayload :
    T extends 'clip.setCrop' ? ClipSetCropPayload :
    T extends 'clip.setMask' ? ClipSetMaskPayload :
    T extends 'marker.add' ? MarkerAddPayload :
    T extends 'marker.remove' ? MarkerRemovePayload :
    T extends 'marker.update' ? MarkerUpdatePayload :
    T extends 'render.setIn' ? RenderSetInPayload :
    T extends 'render.setOut' ? RenderSetOutPayload :
    T extends 'history.push' ? HistoryPushPayload :
    T extends 'batch.applyProposal' ? BatchApplyProposalPayload :
    never,
  options: {
    source?: 'ui' | 'ai' | 'voice' | 'mcp' | 'test'
    requestId?: string
  } = {}
): TimelineCommand<T> {
  return {
    type,
    payload: payload as any,
    requestId: options.requestId || crypto.randomUUID(),
    timestamp: Date.now(),
    source: options.source || 'ui'
  }
}

// Project
export const createProjectCreate = (payload: ProjectCreatePayload) => createCommand('project.create', payload)
export const createProjectLoad = (payload: ProjectLoadPayload) => createCommand('project.load', payload)
export const createProjectSave = (payload: ProjectSavePayload) => createCommand('project.save', payload)
export const createProjectDelete = (payload: ProjectDeletePayload) => createCommand('project.delete', payload)
export const createProjectDuplicate = (payload: ProjectDuplicatePayload) => createCommand('project.duplicate', payload)
export const createProjectSwitchCanvas = (payload: ProjectSwitchCanvasPayload) => createCommand('project.switchCanvas', payload)
export const createProjectSetBackground = (payload: ProjectSetBackgroundPayload) => createCommand('project.setBackground', payload)
export const createProjectSetName = (payload: ProjectSetNamePayload) => createCommand('project.setName', payload)

// Track
export const createTrackAdd = (payload: TrackAddPayload) => createCommand('track.add', payload)
export const createTrackRemove = (payload: TrackRemovePayload) => createCommand('track.remove', payload)
export const createTrackMove = (payload: TrackMovePayload) => createCommand('track.move', payload)
export const createTrackRename = (payload: TrackRenamePayload) => createCommand('track.rename', payload)
export const createTrackSetVisibility = (payload: TrackSetVisibilityPayload) => createCommand('track.setVisibility', payload)
export const createTrackSetLocked = (payload: TrackSetLockedPayload) => createCommand('track.setLocked', payload)
export const createTrackSetMuted = (payload: TrackSetMutedPayload) => createCommand('track.setMuted', payload)
export const createTrackSetVolume = (payload: TrackSetVolumePayload) => createCommand('track.setVolume', payload)
export const createTrackSetPan = (payload: TrackSetPanPayload) => createCommand('track.setPan', payload)

// Clip
export const createClipAdd = (payload: ClipAddPayload) => createCommand('clip.add', payload)
export const createClipRemove = (payload: ClipRemovePayload) => createCommand('clip.remove', payload)
export const createClipMove = (payload: ClipMovePayload) => createCommand('clip.move', payload)
export const createClipTrim = (payload: ClipTrimPayload) => createCommand('clip.trim', payload)
export const createClipSplit = (payload: ClipSplitPayload) => createCommand('clip.split', payload)
export const createClipDuplicate = (payload: ClipDuplicatePayload) => createCommand('clip.duplicate', payload)
export const createClipSetSpeed = (payload: ClipSetSpeedPayload) => createCommand('clip.setSpeed', payload)
export const createClipSetTransition = (payload: ClipSetTransitionPayload) => createCommand('clip.setTransition', payload)
export const createClipClearTransition = (payload: ClipClearTransitionPayload) => createCommand('clip.clearTransition', payload)
export const createClipSetEffects = (payload: ClipSetEffectsPayload) => createCommand('clip.setEffects', payload)
export const createClipAddEffect = (payload: ClipAddEffectPayload) => createCommand('clip.addEffect', payload)
export const createClipRemoveEffect = (payload: ClipRemoveEffectPayload) => createCommand('clip.removeEffect', payload)
export const createClipSetKeyframes = (payload: ClipSetKeyframesPayload) => createCommand('clip.setKeyframes', payload)
export const createClipSetStabilize = (payload: ClipSetStabilizePayload) => createCommand('clip.setStabilize', payload)
export const createClipSetCrop = (payload: ClipSetCropPayload) => createCommand('clip.setCrop', payload)
export const createClipSetMask = (payload: ClipSetMaskPayload) => createCommand('clip.setMask', payload)

// Marker
export const createMarkerAdd = (payload: MarkerAddPayload) => createCommand('marker.add', payload)
export const createMarkerRemove = (payload: MarkerRemovePayload) => createCommand('marker.remove', payload)
export const createMarkerUpdate = (payload: MarkerUpdatePayload) => createCommand('marker.update', payload)

// Render
export const createRenderSetIn = (payload: RenderSetInPayload) => createCommand('render.setIn', payload)
export const createRenderSetOut = (payload: RenderSetOutPayload) => createCommand('render.setOut', payload)
export const createRenderClear = () => createCommand('render.clear', undefined)

// History
export const createHistoryUndo = () => createCommand('history.undo', undefined)
export const createHistoryRedo = () => createCommand('history.redo', undefined)
export const createHistoryPush = (payload: HistoryPushPayload) => createCommand('history.push', payload)

// Batch
export const createBatchApplyProposal = (payload: BatchApplyProposalPayload) => createCommand('batch.applyProposal', payload)