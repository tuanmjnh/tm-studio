// Shared shapes between the pure engine, the filesystem stores (main process
// on desktop, Nitro on web) and the process page. Kept free of Nuxt imports so
// the unit spec can load it in plain Node.

export interface ProcessArtifactSeed {
  name: string
  content: string
}

/** One artifact version as stored on disk. */
export interface ProcessWriteResult {
  version: number
  hash: string
  file: string
}

export interface ProcessStoreEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
}

/** Cheap row for the run list (the full run is read on open). */
export interface ProcessRunSummary {
  runId: string
  title: string
  status: string
  processId: string
  processVersion: string
  currentStage: string
  updatedAt: string
  artifacts: number
}
