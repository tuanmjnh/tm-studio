// =============================================================================
// TMCut MCP IPC Layer — communicates with Electron main via privileged IPC
// All mutations go through main (gated by ipcPolicy.cjs isTrustedSender)
// =============================================================================

import type { McpIpc, ProjectSummary, TimelineSnapshot, AssetSummary, ProposalSnapshot, ToolResult, ServerCapabilities } from './schemas.js'

// -----------------------------------------------------------------------------
// IPC message types (matching main's mcp:server namespace)
// -----------------------------------------------------------------------------
export interface IpcRequest {
  type: 'tool:invoke'
  payload: {
    tool: string
    params: unknown
    requestId: string
    projectId: string
  }
}

export interface IpcResponse {
  type: 'tool:result'
  payload: {
    requestId: string
    result: ToolResult
  }
}

export interface IpcEvent {
  type: 'event:proposal_changed' | 'event:project_changed' | 'event:job_status'
  payload: unknown
}

// -----------------------------------------------------------------------------
// Minimal stdio JSON-RPC transport (MCP host ↔ this process)
// -----------------------------------------------------------------------------
export interface McpTransport {
  send(response: any): void
  onMessage(handler: (msg: any) => void): void
  onClose(handler: () => void): void
}

// -----------------------------------------------------------------------------
// Real IPC implementation (injected at runtime by server.mjs)
// Uses Electron's ipcRenderer via preload bridge
// -----------------------------------------------------------------------------
export function createRealIpc(projectId: string, transport: McpTransport): McpIpc {
  const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>()

  // Handle responses from main
  transport.onMessage((msg) => {
    if (msg.type === 'tool:result') {
      const { requestId, result } = msg.payload
      const waiter = pending.get(requestId)
      if (waiter) {
        pending.delete(requestId)
        waiter.resolve(result)
      }
    }
  })

  async function invokeTool(tool: string, params: unknown, requestId: string): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`IPC timeout for ${tool}`))
      }, 30000)

      pending.set(requestId, { resolve, reject })
      transport.send({
        type: 'tool:invoke',
        payload: { tool, params, requestId, projectId }
      })

      // Resolve clears timeout
      const originalResolve = resolve
      resolve = (v) => { clearTimeout(timeout); originalResolve(v) }
      const originalReject = reject
      reject = (e) => { clearTimeout(timeout); originalReject(e) }
    })
  }

  return {
    // Context
    getProjectContext: (pid: string) => invokeTool('project.get_context', {}, `ctx-${Date.now()}`) as Promise<ProjectSummary>,
    getTimeline: (pid: string) => invokeTool('project.get_timeline', {}, `tl-${Date.now()}`) as Promise<TimelineSnapshot>,
    listAssets: (pid: string, query?: string, kind?: string, limit?: number) =>
      invokeTool('project.list_assets', { query, kind, limit }, `assets-${Date.now()}`) as Promise<any>,

    // Proposal
    createProposal: (pid: string, intent: string) =>
      invokeTool('edit.create_proposal', { intent }, `prop-create-${Date.now()}`) as Promise<any>,
    getProposal: (pid: string) =>
      invokeTool('edit.get_proposal', {}, `prop-get-${Date.now()}`) as Promise<any>,
    validateProposal: (pid: string) =>
      invokeTool('edit.validate_proposal', {}, `prop-validate-${Date.now()}`) as Promise<any>,
    discardProposal: (pid: string) =>
      invokeTool('edit.discard_proposal', {}, `prop-discard-${Date.now()}`) as Promise<any>,
    applyProposal: (pid: string) =>
      invokeTool('edit.apply_proposal', {}, `prop-apply-${Date.now()}`) as Promise<ToolResult>,

    // Queued edits
    queueAddClip: (pid: string, op: any) =>
      invokeTool('timeline.add_clip', op, `edit-addclip-${Date.now()}`),
    queueMoveClip: (pid: string, op: any) =>
      invokeTool('timeline.move_clip', op, `edit-move-${Date.now()}`),
    queueTrimClip: (pid: string, op: any) =>
      invokeTool('timeline.trim_clip', op, `edit-trim-${Date.now()}`),
    queueRemoveClip: (pid: string, op: any) =>
      invokeTool('timeline.remove_clip', op, `edit-remove-${Date.now()}`),
    queueSplitClip: (pid: string, op: any) =>
      invokeTool('timeline.split_clip', op, `edit-split-${Date.now()}`),
    queueSetVolume: (pid: string, op: any) =>
      invokeTool('timeline.set_volume', op, `edit-volume-${Date.now()}`),
    queueAddCaption: (pid: string, op: any) =>
      invokeTool('timeline.add_caption', op, `edit-caption-${Date.now()}`),
    queueSetTransition: (pid: string, op: any) =>
      invokeTool('timeline.set_transition', op, `edit-transition-${Date.now()}`),
    queueSetEffect: (pid: string, op: any) =>
      invokeTool('timeline.set_effect', op, `edit-effect-${Date.now()}`),

    // Playback
    seekPlayback: (pid: string, timeSec: number) =>
      invokeTool('playback.seek', { timeSec }, `pb-seek-${Date.now()}`),
    playPlayback: (pid: string) =>
      invokeTool('playback.play', {}, `pb-play-${Date.now()}`),
    pausePlayback: (pid: string) =>
      invokeTool('playback.pause', {}, `pb-pause-${Date.now()}`),

    // Events (server → host via transport)
    emitEvent: (event: any) => transport.send({ type: 'event', payload: event })
  }
}

// -----------------------------------------------------------------------------
// Mock IPC for unit tests (no Electron)
// -----------------------------------------------------------------------------
export function createMockIpc(projectId: string): McpIpc {
  const store: any = {
    proposals: new Map(),
    projectContext: { id: projectId, name: 'Test', canvas: { width: 1920, height: 1080, fps: 30 }, durationSec: 60, trackCounts: { video: 2, audio: 2, text: 1 }, clipCount: 5, revision: 1 }
  }

  return {
    getProjectContext: async () => store.projectContext,
    getTimeline: async () => ({ projectId, tracks: [], markers: [] }),
    listAssets: async () => [],
    createProposal: async (pid: string, intent: string) => {
      const prop = { id: `prop-${Date.now()}`, intent, operations: [], createdAt: new Date().toISOString() }
      store.proposals.set(pid, prop)
      return prop
    },
    getProposal: async (pid: string) => store.proposals.get(pid) || null,
    validateProposal: async () => ({ ok: true, errors: [] }),
    discardProposal: async (pid: string) => { store.proposals.delete(pid) },
    applyProposal: async () => ({ ok: true }),
    queueAddClip: async () => {},
    queueMoveClip: async () => {},
    queueTrimClip: async () => {},
    queueRemoveClip: async () => {},
    queueSplitClip: async () => {},
    queueSetVolume: async () => {},
    queueAddCaption: async () => {},
    queueSetTransition: async () => {},
    queueSetEffect: async () => {},
    seekPlayback: async () => {},
    playPlayback: async () => {},
    pausePlayback: async () => {},
    emitEvent: () => {},

    // Phase 7: Video Factory (mock)
    factoryEstimateBatch: async () => ({ ok: true, plan: { templateName: 'Mock', sceneCount: 0, validCount: 0, totalCount: 0 }, estimate: { estimatedCostUsd: 0, currency: 'USD', batchSize: 1, perJobCostUsd: 0 }, budget: { allowed: true, requiresConfirmation: false, spentTodayUsd: 0 } }),
    factoryCreateBatch: async () => ({ ok: true, data: { batchId: 'mock-batch', templateId: 'mock', templateVersion: '1', totalItems: 1, completedItems: 0, failedItems: 0, budgetCapUsd: 0, estimatedCostUsd: 0, actualCostUsd: 0, createdAt: new Date().toISOString() } }),
    factoryGetBatch: async () => ({ ok: true, data: { batch: null, items: [], jobs: [], progress: 0 } }),
    factoryPauseBatch: async () => ({ ok: true }),
    factoryResumeBatch: async () => ({ ok: true }),
    factoryCancelBatch: async () => ({ ok: true }),
    factoryGetJob: async () => ({ ok: true, data: null }),
    factoryRetryJob: async () => ({ ok: true }),
    factoryAssembleBatch: async () => ({ ok: true, assembled: [], failed: [] })
  }
}