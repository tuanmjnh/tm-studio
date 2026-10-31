// =============================================================================
//  Production Process — a CONFIG-DRIVEN pipeline (stage → artifacts → gate).
//
//  The anime-series SOP in docs/production-process/ is the first profile, but
//  nothing here is anime-specific: a profile is a ProcessDefinition (stages,
//  artifacts, gates, automation) and a run is one instance of it. A different
//  process (shorts batch, documentary…) is a different JSON profile, not code.
//
//  Artifacts live as REAL FILES on disk (desktop: main process; web: Nitro),
//  one directory per version, so the SOP's directory layout is the actual
//  storage format and every revision stays diffable.
// =============================================================================

/** How a stage does its work — drives which buttons the UI offers. */
export type ProcessStageKind = 'manual' | 'ai' | 'compute' | 'render' | 'review'

/** Who must sign off before the pipeline advances. */
export type ProcessStageGate = 'human' | 'auto'

export type ProcessRunStatus
  = | 'draft'
    | 'running'
    | 'waiting_gate'
    | 'needs_revision'
    | 'blocked'
    | 'done'

export type ProcessStageStatus
  = | 'pending'
    | 'ready'
    | 'running'
    | 'waiting_gate'
    | 'approved'
    | 'needs_revision'

export type ProcessGateDecision = 'approved' | 'revise' | 'rejected'

export type ProcessActor = 'user' | 'agent'

/** One AI automation a stage may run (prompt ids live in utils/process/prompts). */
export interface ProcessAutomation {
  task: 'plan'
  promptId: string
  /** Artifacts the prompt is built from (defaults to the stage's `requires`). */
  contextArtifacts?: string[]
  /** Stage output is JSON, so a parse failure is reported instead of stored. */
  expectsJson?: boolean
}

export interface ProcessStageDef {
  id: string
  /** i18n key — never a hardcoded language string. */
  titleKey: string
  kind: ProcessStageKind
  /** Artifacts that MUST exist (and be valid) before the stage can start. */
  requires: string[]
  /** Artifacts the stage produces; they must exist before it can complete. */
  produces: string[]
  gate: ProcessStageGate
  automation?: ProcessAutomation
  /** NOTE shown in the UI (i18n key) — e.g. "no auto-publish". */
  hintKey?: string
}

export interface ProcessPolicy {
  /** A run cannot be created without an approved canon snapshot. */
  requireCanonApproved: boolean
  /** Publishing is a human act by definition — the profile can never opt out. */
  forbidAutoPublish: true
  /** Stage-level retries before the run reports BLOCKED. */
  maxRetries: number
  /** A CRITICAL validator issue blocks the gate instead of warning. */
  blockOnCritical: boolean
}

export interface ProcessDefinition {
  id: string
  version: string
  titleKey: string
  descriptionKey: string
  /** Directory template relative to the process root. */
  artifactRoot: string
  stages: ProcessStageDef[]
  policy: ProcessPolicy
}

export interface ProcessArtifact {
  name: string
  version: number
  /** sha256 of the stored content — approval is pinned to this exact hash. */
  hash: string
  createdAt: string
  createdBy: ProcessActor
  /** Where the bytes live, relative to the run directory. */
  file?: string
  approvedAt?: string
  approvedBy?: string
  /** Hash that was approved; a later write makes the approval stale. */
  approvedHash?: string
}

export interface ProcessStageState {
  id: string
  status: ProcessStageStatus
  attempts: number
  startedAt?: string
  completedAt?: string
  decidedAt?: string
  decidedBy?: string
  lastError?: string
}

export interface ProcessLogEntry {
  at: string
  actor: ProcessActor
  stage: string
  action: string
  detail?: string
}

export interface ProcessRun {
  runId: string
  processId: string
  processVersion: string
  title: string
  status: ProcessRunStatus
  createdAt: string
  updatedAt: string
  /** Stage the pipeline is sitting on (or waiting at its gate). */
  currentStage: string
  stages: ProcessStageState[]
  artifacts: ProcessArtifact[]
  log: ProcessLogEntry[]
}

/** Result of every engine operation: an error code the UI can translate. */
export interface ProcessOpError {
  code:
    | 'unknown-stage'
    | 'not-current'
    | 'missing-artifacts'
    | 'gate-open'
    | 'wrong-state'
    | 'unknown-run'
    | 'empty-id'
    | 'validation'
  message: string
  missing?: string[]
}

/**
 * `run` is present on a failure ONLY when the engine still changed state
 * (a stage blocked by a CRITICAL validator issue): the caller must persist it,
 * otherwise the UI and the disk disagree about why the gate did not open.
 */
export type ProcessOpResult
  = | { ok: true, run: ProcessRun }
    | { ok: false, error: ProcessOpError, run?: ProcessRun }
