// =============================================================================
// TMCut MCP IPC Layer — communicates with Electron main via privileged IPC
// All mutations go through main (gated by ipcPolicy.cjs isTrustedSender)
// =============================================================================

import type {
  AddCaptionParams, AddClipParams, AssetSummary, MoveClipParams,
  ProjectSummary, ProposalSnapshot, RemoveClipParams, SetEffectParams, SetTransitionParams,
  SetVolumeParams, SplitClipParams, TimelineSnapshot, ToolResult, TrimClipParams
} from './schemas.js'
import type { McpIpc } from './tool-registry.js'

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
  send(response: unknown): void
  onMessage(handler: (msg: { type: string, payload: unknown }) => void): void
  onClose(handler: () => void): void
}

// -----------------------------------------------------------------------------
// Real IPC implementation (injected at runtime by server.mjs)
// Uses Electron's ipcRenderer via preload bridge
// -----------------------------------------------------------------------------
export function createRealIpc(projectId: string, transport: McpTransport): McpIpc {
  const pending = new Map<string, { resolve: (v: unknown) => void, reject: (e: Error) => void }>()

  // Handle responses from main
  transport.onMessage((msg) => {
    if (msg.type === 'tool:result') {
      const { requestId, result } = msg.payload as { requestId: string, result: ToolResult }
      const waiter = pending.get(requestId)
      if (waiter) {
        pending.delete(requestId)
        waiter.resolve(result)
      }
    }
  })

  async function invokeTool<T>(tool: string, params: unknown, requestId: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`IPC timeout for ${tool}`))
      }, 30000)

      pending.set(requestId, {
        resolve: (v) => {
          clearTimeout(timeout)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timeout)
          reject(e)
        }
      })
      transport.send({
        type: 'tool:invoke',
        payload: { tool, params, requestId, projectId }
      })
    })
  }

  return {
    // Context
    getProjectContext: (_pid: string) => invokeTool<ProjectSummary>('project.get_context', {}, `ctx-${Date.now()}`),
    getTimeline: (_pid: string) => invokeTool<TimelineSnapshot>('project.get_timeline', {}, `tl-${Date.now()}`),
    listAssets: (_pid: string, query?: string, kind?: string, limit?: number) =>
      invokeTool<AssetSummary[]>('project.list_assets', { query, kind, limit }, `assets-${Date.now()}`),

    // Proposal
    createProposal: (_pid: string, intent: string) =>
      invokeTool<ProposalSnapshot>('edit.create_proposal', { intent }, `prop-create-${Date.now()}`),
    getProposal: (_pid: string) =>
      invokeTool<ProposalSnapshot | null>('edit.get_proposal', {}, `prop-get-${Date.now()}`),
    validateProposal: (_pid: string) =>
      invokeTool<{ ok: boolean, errors: string[] }>('edit.validate_proposal', {}, `prop-validate-${Date.now()}`),
    discardProposal: (_pid: string) =>
      invokeTool<undefined>('edit.discard_proposal', {}, `prop-discard-${Date.now()}`),
    applyProposal: (_pid: string) =>
      invokeTool<ToolResult>('edit.apply_proposal', {}, `prop-apply-${Date.now()}`),

    // Queued edits
    queueAddClip: (_pid: string, op: AddClipParams) =>
      invokeTool<undefined>('timeline.add_clip', op, `edit-addclip-${Date.now()}`),
    queueMoveClip: (_pid: string, op: MoveClipParams) =>
      invokeTool<undefined>('timeline.move_clip', op, `edit-move-${Date.now()}`),
    queueTrimClip: (_pid: string, op: TrimClipParams) =>
      invokeTool<undefined>('timeline.trim_clip', op, `edit-trim-${Date.now()}`),
    queueRemoveClip: (_pid: string, op: RemoveClipParams) =>
      invokeTool<undefined>('timeline.remove_clip', op, `edit-remove-${Date.now()}`),
    queueSplitClip: (_pid: string, op: SplitClipParams) =>
      invokeTool<undefined>('timeline.split_clip', op, `edit-split-${Date.now()}`),
    queueSetVolume: (_pid: string, op: SetVolumeParams) =>
      invokeTool<undefined>('timeline.set_volume', op, `edit-volume-${Date.now()}`),
    queueAddCaption: (_pid: string, op: AddCaptionParams) =>
      invokeTool<undefined>('timeline.add_caption', op, `edit-caption-${Date.now()}`),
    queueSetTransition: (_pid: string, op: SetTransitionParams) =>
      invokeTool<undefined>('timeline.set_transition', op, `edit-transition-${Date.now()}`),
    queueSetEffect: (_pid: string, op: SetEffectParams) =>
      invokeTool<undefined>('timeline.set_effect', op, `edit-effect-${Date.now()}`),

    // Playback
    seekPlayback: (_pid: string, timeSec: number) =>
      invokeTool<undefined>('playback.seek', { timeSec }, `pb-seek-${Date.now()}`),
    playPlayback: (_pid: string) =>
      invokeTool<undefined>('playback.play', {}, `pb-play-${Date.now()}`),
    pausePlayback: (_pid: string) =>
      invokeTool<undefined>('playback.pause', {}, `pb-pause-${Date.now()}`),

    // Phase 4: Asset Center
    listAssetCatalog: (_pid: string, params: unknown) =>
      invokeTool<unknown>('asset.list_catalog', params, `asset-list-${Date.now()}`),
    installAsset: (_pid: string, entryId: string, version?: string) =>
      invokeTool<undefined>('asset.install', { entryId, version }, `asset-install-${Date.now()}`),
    uninstallAsset: (_pid: string, entryId: string) =>
      invokeTool<undefined>('asset.uninstall', { entryId }, `asset-uninstall-${Date.now()}`),
    getAssetInstallStatus: (_pid: string, entryId: string) =>
      invokeTool<unknown>('asset.install_status', { entryId }, `asset-status-${Date.now()}`),

    // Phase 4: Templates
    listTemplates: (_pid: string, params: unknown) =>
      invokeTool<unknown>('template.list', params, `tpl-list-${Date.now()}`),
    applyTemplate: (_pid: string, templateId: string, replacements?: unknown, projectName?: string) =>
      invokeTool<undefined>('template.apply', { templateId, replacements, projectName }, `tpl-apply-${Date.now()}`),
    saveAsTemplate: (_pid: string, params: unknown) =>
      invokeTool<unknown>('template.save_as', params, `tpl-save-${Date.now()}`),
    deleteTemplate: (_pid: string, templateId: string) =>
      invokeTool<undefined>('template.delete', { templateId }, `tpl-delete-${Date.now()}`),
    importTemplate: (_pid: string, filePath: string, name?: string) =>
      invokeTool<unknown>('template.import', { filePath, name }, `tpl-import-${Date.now()}`),
    exportTemplate: (_pid: string, templateId: string, filePath?: string) =>
      invokeTool<unknown>('template.export', { templateId, filePath }, `tpl-export-${Date.now()}`),

    // Phase 7: Video Factory
    factoryEstimateBatch: (_pid: string, params: unknown) =>
      invokeTool<unknown>('factory.estimate_batch', params, `fac-est-${Date.now()}`),
    factoryCreateBatch: (_pid: string, params: unknown) =>
      invokeTool<unknown>('factory.create_batch', params, `fac-create-${Date.now()}`),
    factoryGetBatch: (_pid: string, batchId: string) =>
      invokeTool<unknown>('factory.get_batch', { batchId }, `fac-get-${Date.now()}`),
    factoryPauseBatch: (_pid: string, batchId: string) =>
      invokeTool<unknown>('factory.pause_batch', { batchId }, `fac-pause-${Date.now()}`),
    factoryResumeBatch: (_pid: string, batchId: string) =>
      invokeTool<unknown>('factory.resume_batch', { batchId }, `fac-resume-${Date.now()}`),
    factoryCancelBatch: (_pid: string, batchId: string) =>
      invokeTool<unknown>('factory.cancel_batch', { batchId }, `fac-cancel-${Date.now()}`),
    factoryGetJob: (_pid: string, jobId: string) =>
      invokeTool<unknown>('factory.get_job', { jobId }, `fac-job-${Date.now()}`),
    factoryRetryJob: (_pid: string, jobId: string) =>
      invokeTool<unknown>('factory.retry_job', { jobId }, `fac-retry-${Date.now()}`),
    factoryAssembleBatch: (_pid: string, batchId: string) =>
      invokeTool<unknown>('factory.assemble_batch', { batchId }, `fac-assemble-${Date.now()}`),

    // Events (server → host via transport)
    emitEvent: (event: unknown) => transport.send({ type: 'event', payload: event })
  }
}

// -----------------------------------------------------------------------------
// Mock IPC for unit tests (no Electron)
// -----------------------------------------------------------------------------
export function createMockIpc(projectId: string): McpIpc {
  const store: {
    proposals: Map<string, ProposalSnapshot>
    projectContext: ProjectSummary
  } = {
    proposals: new Map(),
    projectContext: { id: projectId, name: 'Test', canvas: { width: 1920, height: 1080, fps: 30 }, durationSec: 60, trackCounts: { video: 2, audio: 2, text: 1 }, clipCount: 5, revision: 1 }
  }

  return {
    getProjectContext: async () => store.projectContext,
    getTimeline: async () => ({ projectId, tracks: [], markers: [] }),
    listAssets: async () => [],
    createProposal: async (_pid: string, intent: string) => {
      const prop: ProposalSnapshot = { id: `prop-${Date.now()}`, intent, operations: [], createdAt: new Date().toISOString() }
      store.proposals.set(projectId, prop)
      return prop
    },
    getProposal: async (_pid: string) => store.proposals.get(projectId) ?? null,
    validateProposal: async () => ({ ok: true, errors: [] }),
    discardProposal: async (_pid: string) => { store.proposals.delete(projectId) },
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

    // Phase 4: Asset Center (mock)
    listAssetCatalog: async () => [],
    installAsset: async () => {},
    uninstallAsset: async () => {},
    getAssetInstallStatus: async () => ({ entryId: '', state: 'catalog' }),

    // Phase 4: Templates (mock)
    listTemplates: async () => [],
    applyTemplate: async () => {},
    saveAsTemplate: async () => { throw new Error('saveAsTemplate is not available in the test mock') },
    deleteTemplate: async () => {},
    importTemplate: async () => { throw new Error('importTemplate is not available in the test mock') },
    exportTemplate: async () => ({ filePath: '' }),

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
