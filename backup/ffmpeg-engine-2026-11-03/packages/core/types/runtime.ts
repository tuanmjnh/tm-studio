// TMCut runtime adapter interfaces (docs section 12) and capability
// flags (docs section 13). Implemented per host (Electron / Web / CLI);
// the core never imports a runtime.

export interface TmcutCapabilities {
  filesystem: boolean
  nativeFFmpeg: boolean
  webCodecs: boolean
  webGPU: boolean
  hardwareEncoding: boolean
  backgroundRender: boolean
  cloudRender: boolean
  largeFileAccess: boolean
}

export interface TmcutRuntimeInfo {
  name: 'electron' | 'web' | 'headless'
  capabilities: TmcutCapabilities
}

// Minimal engine contracts. Full method sets arrive with Phase 5/6 packages;
// these interfaces already fix the dependency direction:
// UI -> Editor API -> Core -> Interfaces -> Runtime Adapter.
export interface TmcutPreviewEngine {
  initialize(): Promise<void>
  seek(timeMs: number): Promise<void>
  play(): Promise<void>
  pause(): Promise<void>
  dispose(): Promise<void>
}

/**
 * One render job as the host reports it. `output` says where the finished
 * file lives — an absolute path on a host with a filesystem, a URL on a host
 * that renders server-side — and it only means something once `status` is
 * terminal. `error` carries the host's own failure message.
 */
export interface TmcutRenderJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
  output?: { path?: string, url?: string }
  error?: string
}

/**
 * Encoder host service. Polling is a PULL: `getJob` is what a caller loops on,
 * because a progress number alone cannot express "finished, and here is the
 * file" — which is the one thing every export path eventually needs.
 */
export interface TmcutRenderEngine {
  render(plan: unknown): Promise<TmcutRenderJob>
  cancel(jobId: string): Promise<void>
  getProgress(jobId: string): number
  /** Latest known state, or null when this host has never seen that id. */
  getJob?(jobId: string): TmcutRenderJob | null
}

export interface TmcutRuntime {
  info: TmcutRuntimeInfo
  preview: TmcutPreviewEngine
  render: TmcutRenderEngine
}
