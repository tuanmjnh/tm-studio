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

export interface TmcutRenderJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  progress: number
}

export interface TmcutRenderEngine {
  render(plan: unknown): Promise<TmcutRenderJob>
  cancel(jobId: string): Promise<void>
  getProgress(jobId: string): number
}

export interface TmcutRuntime {
  info: TmcutRuntimeInfo
  preview: TmcutPreviewEngine
  render: TmcutRenderEngine
}
