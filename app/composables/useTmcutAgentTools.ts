// =============================================================================
//  TMCut Agent Tools — Roadmap v1 §4 (P1)
//  Single bridge between EXTERNAL INTELLIGENCE (AI agent, voice, MCP server)
//  and the SAME timeline commands the manual UI uses. No direct store mutation
//  outside the store's own command functions.
//
//  This composable exposes a small, validated, closed-vocabulary tool set:
//   - context-read tools  (project.get_context, project.get_timeline, ...)
//   - proposal tools      (edit.create/validate/get/discard/apply_proposal)
//   - reversible edits    (add/remove/move clip, set volume, add caption, ...)
//   - playback control    (seek/play/pause)
//
//  Mutating tools NEVER touch the timeline when called: they append a
//  declarative operation to the pending proposal, which the user reviews in
//  the Agent panel and then applies as ONE undo group (store
//  begin/endHistoryGroup). Validation runs twice — when an operation is
//  queued and again right before apply — so a stale clip id fails with a
//  structured error instead of silently doing nothing.
//
//  No shell, no free-form FFmpeg, no arbitrary paths. Credentials never leave
//  the main process.
// =============================================================================

import { computed, shallowRef } from 'vue'
import { useTmcutProject, type TmcutTimelineItem, type TmcutTrack } from './useTmcutProject'
import { useTmcutMedia } from './useTmcutMedia'
import { useTmcutPlayback } from './useTmcutPlayback'
import {
  createCommand,
  requiresApproval,
  type CommandResult,
  type TimelineCommand
} from '~/types/timelineCommands'
import {  secToTicks,
  TICKS_PER_SECOND
} from '@tmcut-core'

// -----------------------------------------------------------------------------
// Structured tool registry (self-describing for MCP / LLM tool schemas)
// -----------------------------------------------------------------------------

export interface AgentToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema subset
  risk: 'read' | 'reversible' | 'destructive' | 'cost'
  requiresApproval: boolean
}

export interface AgentToolResult {
  ok: boolean
  data?: unknown
  error?: { code: string, message: string, retryable: boolean }
  warning?: string
}

export interface TimelineSnapshot {
  projectId: string
  name: string
  canvas: { width: number, height: number, fps: number }
  durationTicks: number
  durationSec: number
  tracks: Array<{
    id: string
    type: string
    name: string
    locked: boolean
    muted: boolean
    hidden: boolean
    volume?: number
    pan?: number
    clips: Array<{
      id: string
      name: string
      type: string
      startTicks: number
      durationTicks: number
      text?: string
      effects: Array<{ type: string, params: Record<string, unknown> }>
    }>
  }>
}

/** One queued, declarative edit. Serializable so MCP/UI can inspect it. */
export interface AgentProposalOperation {
  id: string
  tool: string
  args: Record<string, unknown>
}

export type AgentProposalSource = 'ai' | 'voice' | 'text' | 'mcp'

export interface AgentPendingProposal {
  intent: string
  source: AgentProposalSource
  startedAt: number
  operations: AgentProposalOperation[]
}

export interface AgentProposalIssue {
  operationId: string
  index: number
  tool: string
  code: string
  message: string
}

export interface AgentApplyReport {
  applied: number
  failed: AgentProposalIssue[]
}

export const AGENT_TOOL_SCHEMAS: AgentToolSchema[] = [
  // --- Context read (low-risk) ---
  { name: 'project.get_context', description: 'Read current project name, canvas, duration', parameters: {}, risk: 'read', requiresApproval: false },
  { name: 'project.get_timeline', description: 'Read full timeline: tracks, clips, markers', parameters: {}, risk: 'read', requiresApproval: false },
  { name: 'project.list_assets', description: 'List library assets available to drop on the timeline', parameters: { query: { type: 'string' } }, risk: 'read', requiresApproval: false },
  // --- Proposal (reversible, batched) ---
  { name: 'edit.create_proposal', description: 'Start a proposal (undo group) for a batch of edits', parameters: { intent: { type: 'string' } }, risk: 'reversible', requiresApproval: false },
  { name: 'edit.get_proposal', description: 'Read the pending proposal and its validation state', parameters: {}, risk: 'read', requiresApproval: false },
  { name: 'edit.validate_proposal', description: 'Dry-run validate the pending proposal against the current timeline', parameters: {}, risk: 'read', requiresApproval: false },
  { name: 'edit.discard_proposal', description: 'Throw away the pending proposal without touching the timeline', parameters: {}, risk: 'read', requiresApproval: false },
  { name: 'edit.apply_proposal', description: 'Apply the queued proposal as ONE undo step', parameters: {}, risk: 'reversible', requiresApproval: true },
  // --- Reversible clip edits ---
  { name: 'timeline.add_clip', description: 'Add a clip to a track', parameters: { trackType: { type: 'string', enum: ['video', 'text', 'audio'] }, name: { type: 'string' }, mediaRef: { type: 'string' }, text: { type: 'string' }, offsetSec: { type: 'number' }, durationSec: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.move_clip', description: 'Move a clip to a new start time', parameters: { clipId: { type: 'string' }, startSec: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.trim_clip', description: 'Trim a clip in/out edge', parameters: { clipId: { type: 'string' }, edge: { type: 'string', enum: ['in', 'out'] }, atSec: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.remove_clip', description: 'Remove a clip from the timeline', parameters: { clipId: { type: 'string' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.split_clip', description: 'Split a clip at a time', parameters: { clipId: { type: 'string' }, atSec: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.set_volume', description: 'Set track volume', parameters: { trackId: { type: 'string' }, volume: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.add_caption', description: 'Add a caption (text clip)', parameters: { text: { type: 'string' }, atSec: { type: 'number' }, durationSec: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.set_transition', description: 'Add a transition to a clip cut', parameters: { clipId: { type: 'string' }, type: { type: 'string' }, durationSec: { type: 'number' } }, risk: 'reversible', requiresApproval: false },
  { name: 'timeline.set_effect', description: 'Set effects on a clip', parameters: { clipId: { type: 'string' }, effects: { type: 'array' } }, risk: 'reversible', requiresApproval: false },
  // --- Playback ---
  { name: 'playback.seek', description: 'Move the playhead', parameters: { timeSec: { type: 'number' } }, risk: 'read', requiresApproval: false },
  { name: 'playback.play', description: 'Start playback', parameters: {}, risk: 'read', requiresApproval: false },
  { name: 'playback.pause', description: 'Pause playback', parameters: {}, risk: 'read', requiresApproval: false }
]

/** Tools that append an operation instead of executing immediately. */
const MUTATING_TOOLS = new Set([
  'timeline.add_clip',
  'timeline.move_clip',
  'timeline.trim_clip',
  'timeline.remove_clip',
  'timeline.split_clip',
  'timeline.set_volume',
  'timeline.add_caption',
  'timeline.set_transition',
  'timeline.set_effect'
])

/** Margin kept by split/trim so no degenerate sliver is created. */
const EDGE_MARGIN_SEC = 0.1

function num(value: unknown, fallback = 0): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// -----------------------------------------------------------------------------
// Composable
// -----------------------------------------------------------------------------

// The pending proposal buffer. Module-level on purpose: the Agent panel, the
// voice pipeline and a future MCP bridge must all see ONE draft, never a copy
// per composable instance (useTmcutProject state is module-level too).
const pendingProposal = shallowRef<AgentPendingProposal | null>(null)

/** Shared draft count — reactive for badges and disabled states. */
export const useAgentProposalCount = () => computed(() => pendingProposal.value?.operations.length ?? 0)

export function useTmcutAgentTools() {
  const project = useTmcutProject()
  const media = useTmcutMedia()
  const playback = useTmcutPlayback()

  const proposalCount = useAgentProposalCount()

  // --- Timeline helpers -----------------------------------------------------

  function tracks(): TmcutTrack[] {
    return project.currentProject.value?.timeline?.tracks || []
  }

  function findClip(clipId: string): { item: TmcutTimelineItem, track: TmcutTrack } | null {
    for (const track of tracks()) {
      const item = (track.items || []).find(i => i.id === clipId)
      if (item) return { item, track }
    }
    return null
  }

  /** Resolve a tool argument that may be the literal "selected". */
  function resolveClipId(raw: unknown): string | null {
    const value = typeof raw === 'string' ? raw.trim() : ''
    const id = !value || value === 'selected' ? project.selectedClipId.value : value
    if (!id) return null
    return findClip(id) ? id : null
  }

  function resolveTrackId(raw: unknown): string | null {
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (value && value !== 'selected') {
      return tracks().some(t => t.id === value) ? value : null
    }
    const clipId = project.selectedClipId.value
    if (!clipId) return null
    return findClip(clipId)?.track.id ?? null
  }

  function clipStartSec(item: TmcutTimelineItem): number {
    return (item.offset ?? 0) / TICKS_PER_SECOND
  }

  function clipDurationSec(item: TmcutTimelineItem): number {
    return Math.max(0, ((item.out ?? 0) - (item.in ?? 0)) / (item.speed || 1)) / TICKS_PER_SECOND
  }

  function libraryAsset(mediaRef: unknown) {
    const ref = typeof mediaRef === 'string' ? mediaRef.trim() : ''
    if (!ref) return null
    return media.assets.value.find(a => a.id === ref) || null
  }

  // --- Context readers ------------------------------------------------------

  function getContext(): AgentToolResult {
    const current = project.currentProject.value
    if (!current) return { ok: false, error: { code: 'no-project', message: 'No project loaded', retryable: false } }
    return {
      ok: true,
      data: {
        projectId: current.id,
        name: current.name,
        canvas: {
          width: current.canvas?.width,
          height: current.canvas?.height,
          fps: current.canvas?.fps?.numerator
        },
        durationSec: project.totalDuration.value,
        selectedClipId: project.selectedClipId.value,
        pendingProposal: proposalCount.value
      }
    }
  }

  function getTimeline(): AgentToolResult {
    const current = project.currentProject.value
    if (!current) return { ok: false, error: { code: 'no-project', message: 'No project loaded', retryable: false } }
    const snapshot: TimelineSnapshot = {
      projectId: current.id,
      name: current.name,
      canvas: {
        width: current.canvas?.width || 1920,
        height: current.canvas?.height || 1080,
        fps: current.canvas?.fps?.numerator || 30
      },
      durationTicks: Math.round(project.totalDuration.value * TICKS_PER_SECOND),
      durationSec: project.totalDuration.value,
      tracks: (current.timeline?.tracks || []).map(track => ({
        id: track.id,
        type: track.type,
        name: track.name || track.type,
        locked: !!track.locked,
        muted: !!track.muted,
        hidden: !!track.hidden,
        volume: track.volume,
        pan: track.pan,
        clips: (track.items || []).map(item => ({
          id: item.id,
          name: item.name || item.text || item.id,
          type: track.type,
          startTicks: item.offset ?? 0,
          durationTicks: Math.max(1, Math.round(((item.out ?? 0) - (item.in ?? 0)) / (item.speed ?? 1))),
          text: item.text,
          effects: (item.effects || []).map(e => ({ type: e.type, params: e.params || {} }))
        }))
      }))
    }
    return { ok: true, data: snapshot }
  }

  function listAssets(query?: string): AgentToolResult {
    const q = (query || '').trim().toLowerCase()
    const assets = media.assets.value
      .filter(a => a.status !== 'missing' && a.status !== 'error')
      .filter(a => !q || (a.name || '').toLowerCase().includes(q) || (a.kind || '').includes(q))
      .map(a => ({
        id: a.id,
        name: a.name,
        kind: a.kind,
        durationSec: a.meta?.durationSec || 0,
        width: a.meta?.width || 0,
        height: a.meta?.height || 0
      }))
    return { ok: true, data: assets }
  }

  // --- Playback -------------------------------------------------------------

  function seek(timeSec: number): AgentToolResult {
    playback.seek(Math.max(0, num(timeSec)))
    return { ok: true }
  }
  function play(): AgentToolResult {
    playback.play()
    return { ok: true }
  }
  function pause(): AgentToolResult {
    playback.pause()
    return { ok: true }
  }

  // --- Proposal buffer ------------------------------------------------------

  function createProposal(intent: string, source: AgentProposalSource = 'ai'): AgentToolResult {
    const current = pendingProposal.value
    if (current && current.operations.length > 0) {
      // Never silently fold a new request into someone else's draft.
      return {
        ok: false,
        error: { code: 'proposal-pending', message: 'A proposal is already awaiting review', retryable: false }
      }
    }
    pendingProposal.value = {
      intent: String(intent || 'ai edit'),
      source,
      startedAt: Date.now(),
      operations: []
    }
    return { ok: true, data: { intent: pendingProposal.value.intent, queued: 0 } }
  }

  function ensureProposal(intent: string): AgentProposalSource {
    if (!pendingProposal.value) {
      createProposal(intent, 'ai')
      return 'ai'
    }
    return pendingProposal.value.source
  }

  /**
   * Queue one operation. Validation runs NOW so a bad argument is reported to
   * the caller immediately; it runs again at apply time because the timeline
   * may have moved in between.
   */
  function queueOperation(tool: string, args: Record<string, unknown>): AgentToolResult {
    ensureProposal(tool)
    const check = validateOperation({ id: 'pending', tool, args }, -1)
    if (check) return { ok: false, error: { code: check.code, message: check.message, retryable: false } }
    const op: AgentProposalOperation = {
      id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      tool,
      args: { ...args }
    }
    // Immutable append: the draft ref is shallow, so replacing the object is
    // what makes the review panel (and the counts) re-render.
    const draft = pendingProposal.value!
    pendingProposal.value = { ...draft, operations: [...draft.operations, op] }
    return { ok: true, data: { queued: true, operationId: op.id, count: proposalCount.value } }
  }

  function discardProposal(): AgentToolResult {
    const had = proposalCount.value
    pendingProposal.value = null
    return { ok: true, data: { discarded: had } }
  }

  // --- Validation -----------------------------------------------------------

  /** Returns null when valid, otherwise the structured issue. */
  function validateOperation(op: AgentProposalOperation, index: number): AgentProposalIssue | null {
    const fail = (code: string, message: string): AgentProposalIssue => ({
      operationId: op.id,
      index,
      tool: op.tool,
      code,
      message
    })
    if (!project.currentProject.value) return fail('no-project', 'No project loaded')

    const args = op.args || {}
    switch (op.tool) {
      case 'timeline.add_clip': {
        const trackType = (args.trackType as string) || 'text'
        if (!['video', 'text', 'audio'].includes(trackType)) return fail('bad-track-type', `Unknown track type "${trackType}"`)
        if (num(args.durationSec, 4) <= 0) return fail('bad-duration', 'durationSec must be greater than 0')
        if (num(args.offsetSec, 0) < 0) return fail('bad-offset', 'offsetSec must be zero or greater')
        if (trackType !== 'text') {
          if (!args.mediaRef) return fail('media-ref-missing', 'mediaRef is required for video/audio clips')
          const asset = libraryAsset(args.mediaRef)
          if (!asset) return fail('media-ref-missing', `mediaRef "${String(args.mediaRef)}" is not in the library`)
          if (!asset.path) return fail('media-ref-unresolved', `mediaRef "${String(args.mediaRef)}" has no local file`)
        } else if (!String(args.text ?? '').trim() && !String(args.name ?? '').trim()) {
          return fail('empty-text', 'A text clip needs text or a name')
        }
        return null
      }
      case 'timeline.move_clip': {
        if (!resolveClipId(args.clipId)) return fail('clip-not-found', `Clip "${String(args.clipId)}" is not on the timeline`)
        if (num(args.startSec, -1) < 0) return fail('bad-offset', 'startSec must be zero or greater')
        return null
      }
      case 'timeline.trim_clip': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return fail('clip-not-found', `Clip "${String(args.clipId)}" is not on the timeline`)
        if (args.edge !== 'in' && args.edge !== 'out') return fail('bad-edge', 'edge must be "in" or "out"')
        const clip = findClip(clipId!)!.item
        const start = clipStartSec(clip)
        const end = start + clipDurationSec(clip)
        const at = num(args.atSec, -1)
        if (at <= start + EDGE_MARGIN_SEC || at >= end - EDGE_MARGIN_SEC) {
          return fail('out-of-range', `atSec ${at}s must sit inside the clip (${start.toFixed(2)}s–${end.toFixed(2)}s)`)
        }
        return null
      }
      case 'timeline.remove_clip': {
        if (!resolveClipId(args.clipId)) return fail('clip-not-found', `Clip "${String(args.clipId)}" is not on the timeline`)
        return null
      }
      case 'timeline.split_clip': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return fail('clip-not-found', `Clip "${String(args.clipId)}" is not on the timeline`)
        const clip = findClip(clipId!)!.item
        const start = clipStartSec(clip)
        const end = start + clipDurationSec(clip)
        const at = num(args.atSec, -1)
        if (at <= start + EDGE_MARGIN_SEC || at >= end - EDGE_MARGIN_SEC) {
          return fail('out-of-range', `atSec ${at}s must sit inside the clip (${start.toFixed(2)}s–${end.toFixed(2)}s)`)
        }
        return null
      }
      case 'timeline.set_volume': {
        if (!resolveTrackId(args.trackId)) return fail('track-not-found', `Track "${String(args.trackId)}" is not on the timeline`)
        const volume = num(args.volume, -1)
        if (volume < 0 || volume > 100) return fail('bad-volume', 'volume must be between 0 and 100')
        return null
      }
      case 'timeline.add_caption': {
        if (!String(args.text ?? '').trim()) return fail('empty-text', 'A caption needs text')
        if (num(args.atSec, -1) < 0) return fail('bad-offset', 'atSec must be zero or greater')
        if (num(args.durationSec, 3) <= 0) return fail('bad-duration', 'durationSec must be greater than 0')
        return null
      }
      case 'timeline.set_transition': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return fail('clip-not-found', `Clip "${String(args.clipId)}" is not on the timeline`)
        if (!String(args.type ?? '').trim()) return fail('bad-transition', 'A transition type is required')
        const duration = num(args.durationSec, 0.5)
        if (duration <= 0) return fail('bad-duration', 'durationSec must be greater than 0')
        const check = project.checkClipTransition(clipId!, String(args.type), duration)
        if (!check.ok) return fail('transition-rejected', check.reason || 'The clip has no neighbour to blend with')
        return null
      }
      case 'timeline.set_effect': {
        if (!resolveClipId(args.clipId)) return fail('clip-not-found', `Clip "${String(args.clipId)}" is not on the timeline`)
        if (!Array.isArray(args.effects)) return fail('bad-effects', 'effects must be an array')
        return null
      }
      default:
        return fail('unknown-tool', `Unknown tool: ${op.tool}`)
    }
  }

  function validateProposal(): AgentToolResult & { data?: { valid: boolean, issues: AgentProposalIssue[] } } {
    const proposal = pendingProposal.value
    if (!proposal || proposal.operations.length === 0) {
      return { ok: false, error: { code: 'no-proposal', message: 'No queued operations', retryable: false } }
    }
    const issues = proposal.operations
      .map((op, index) => validateOperation(op, index))
      .filter((issue): issue is AgentProposalIssue => issue !== null)
    return { ok: true, data: { valid: issues.length === 0, issues } }
  }

  // --- Execution ------------------------------------------------------------

  function executeOperation(op: AgentProposalOperation): boolean {
    const args = op.args || {}
    switch (op.tool) {
      case 'timeline.add_clip': {
        const trackType = ((args.trackType as 'video' | 'text' | 'audio') || 'text')
        const asset = trackType === 'text' ? null : libraryAsset(args.mediaRef)
        project.addClipToTrack(trackType, {
          name: String(args.name || (trackType === 'text' ? (args.text || 'Caption') : 'Clip')),
          src: asset?.path,
          text: trackType === 'text' ? String(args.text ?? '') : undefined,
          in: 0,
          out: Math.max(TICKS_PER_SECOND / 10, Math.round(secToTicks(num(args.durationSec, 4)))),
          offset: Math.max(0, Math.round(secToTicks(num(args.offsetSec, playback.playhead.value))))
        })
        return true
      }
      case 'timeline.move_clip': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return false
        project.updateClip(clipId, { offset: Math.max(0, Math.round(secToTicks(num(args.startSec)))) })
        return true
      }
      case 'timeline.trim_clip': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return false
        // trimSelectedEdgeAt works on the selection, exactly like the keyboard
        // shortcut; selecting the target first keeps one code path.
        project.selectClip(clipId)
        return project.trimSelectedEdgeAt(args.edge as 'in' | 'out', num(args.atSec))
      }
      case 'timeline.remove_clip': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return false
        project.removeClip(clipId)
        return !findClip(clipId)
      }
      case 'timeline.split_clip': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return false
        return project.splitClip(clipId, num(args.atSec))
      }
      case 'timeline.set_volume': {
        const trackId = resolveTrackId(args.trackId)
        if (!trackId) return false
        project.updateTrackVolume(trackId, Math.max(0, Math.min(100, num(args.volume))))
        return true
      }
      case 'timeline.add_caption': {
        project.addClipToTrack('text', {
          name: String(args.text || '').slice(0, 24),
          text: String(args.text || ''),
          in: 0,
          out: Math.max(TICKS_PER_SECOND / 10, Math.round(secToTicks(num(args.durationSec, 3)))),
          offset: Math.max(0, Math.round(secToTicks(num(args.atSec)))),
          fontSize: 42,
          color: '#ffffff'
        })
        return true
      }
      case 'timeline.set_transition': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return false
        const applied = project.applyClipTransition(clipId, String(args.type), num(args.durationSec, 0.5))
        return applied.ok
      }
      case 'timeline.set_effect': {
        const clipId = resolveClipId(args.clipId)
        if (!clipId) return false
        const effects = (args.effects as Array<{ type?: string, params?: Record<string, unknown> }>) || []
        project.updateClip(clipId, {
          effects: effects
            .filter(e => typeof e?.type === 'string' && e.type)
            .map(e => ({ type: e.type as string, params: e.params || {} }))
        })
        return true
      }
      default:
        return false
    }
  }

  /**
   * Apply the reviewed proposal. Validation runs first against the CURRENT
   * timeline; only then does the store open a history group so the whole
   * draft collapses into a single Ctrl+Z.
   */
  function applyProposal(): AgentToolResult & { data?: AgentApplyReport } {
    const proposal = pendingProposal.value
    if (!proposal || proposal.operations.length === 0) {
      return { ok: false, error: { code: 'no-proposal', message: 'No queued operations', retryable: false } }
    }
    const validation = validateProposal()
    const issues = (validation.data?.issues || [])
    if (issues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'proposal-invalid',
          message: `${issues.length} operation(s) no longer apply: ${issues.map(i => i.message).join('; ')}`,
          retryable: false
        },
        data: { applied: 0, failed: issues }
      }
    }

    const failed: AgentProposalIssue[] = []
    let applied = 0
    project.beginHistoryGroup()
    try {
      proposal.operations.forEach((op, index) => {
        try {
          if (executeOperation(op)) {
            applied++
          } else {
            failed.push({ operationId: op.id, index, tool: op.tool, code: 'operation-rejected', message: 'The timeline refused this operation' })
          }
        } catch (err) {
          failed.push({ operationId: op.id, index, tool: op.tool, code: 'operation-failed', message: (err as Error)?.message || 'operation failed' })
        }
      })
    } finally {
      project.endHistoryGroup()
      project.saveProject()
      pendingProposal.value = null
    }

    return {
      ok: failed.length === 0,
      data: { applied, failed },
      ...(failed.length > 0
        ? { error: { code: 'partial-apply', message: `${failed.length} operation(s) failed; ${applied} applied as one undo step`, retryable: true } }
        : {})
    }
  }

  // --- Public: tool dispatch + schema listing -------------------------------

  function listTools(): AgentToolSchema[] {
    return AGENT_TOOL_SCHEMAS
  }

  /** Dispatch an agent/voice/MCP tool call by name. Mutations only queue. */
  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<AgentToolResult> {
    if (MUTATING_TOOLS.has(name)) return queueOperation(name, args)
    switch (name) {
      // Context read
      case 'project.get_context': return getContext()
      case 'project.get_timeline': return getTimeline()
      case 'project.list_assets': return listAssets(args.query as string | undefined)
      // Proposal
      case 'edit.create_proposal': return createProposal(args.intent as string || 'ai edit')
      case 'edit.get_proposal': return {
        ok: true,
        data: pendingProposal.value
          ? { ...pendingProposal.value, validation: validateProposal().data }
          : null
      }
      case 'edit.validate_proposal': return validateProposal()
      case 'edit.discard_proposal': return discardProposal()
      case 'edit.apply_proposal': return applyProposal()
      // Playback
      case 'playback.seek': return seek(Number(args.timeSec) || 0)
      case 'playback.play': return play()
      case 'playback.pause': return pause()
      default:
        return { ok: false, error: { code: 'unknown-tool', message: `Unknown tool: ${name}`, retryable: false } }
    }
  }

  return {
    // Reactive draft (read-only for the UI)
    pendingProposal,
    proposalCount,
    listTools,
    callTool,
    // Direct access (for MCP bindings)
    getContext,
    getTimeline,
    listAssets,
    createProposal,
    validateProposal,
    discardProposal,
    applyProposal
  }
}
