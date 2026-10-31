// =============================================================================
//  Production Process — pure stage machine (no Vue, no disk, no AI).
//
//  One linear pipeline per run: only `currentStage` may start/complete, and a
//  human gate must be signed off before the pipeline advances. Everything is
//  a pure function on a cloned run so a spec can pin every branch, and the
//  store can persist the returned object verbatim.
// =============================================================================

import type {
  ProcessActor,
  ProcessDefinition,
  ProcessGateDecision,
  ProcessOpError,
  ProcessOpResult,
  ProcessRun,
  ProcessStageDef,
  ProcessStageState
} from '~/types/productionProcess'
import type { ProcessIssue } from './validators'

export function cloneRun(run: ProcessRun): ProcessRun {
  return {
    ...run,
    stages: run.stages.map(stage => ({ ...stage })),
    artifacts: run.artifacts.map(artifact => ({ ...artifact })),
    log: run.log.map(entry => ({ ...entry }))
  }
}

export function stageDefinition(def: ProcessDefinition, stageId: string): ProcessStageDef | null {
  return def.stages.find(stage => stage.id === stageId) || null
}

export function stageState(run: ProcessRun, stageId: string): ProcessStageState | null {
  return run.stages.find(stage => stage.id === stageId) || null
}

/** Latest version of one artifact (artifacts are append-only). */
export function latestArtifact(run: ProcessRun, name: string) {
  let latest: ProcessRun['artifacts'][number] | null = null
  for (const artifact of run.artifacts) {
    if (artifact.name !== name) continue
    if (!latest || artifact.version > latest.version) latest = artifact
  }
  return latest
}

export function hasArtifact(run: ProcessRun, name: string): boolean {
  return latestArtifact(run, name) !== null
}

/** Requirement names the run still needs before the stage may start. */
export function missingRequirements(def: ProcessDefinition, run: ProcessRun, stageId: string): string[] {
  const stage = stageDefinition(def, stageId)
  if (!stage) return []
  return stage.requires.filter(name => !hasArtifact(run, name))
}

export function nextStageId(def: ProcessDefinition, stageId: string): string | null {
  const index = def.stages.findIndex(stage => stage.id === stageId)
  if (index === -1 || index >= def.stages.length - 1) return null
  return def.stages[index + 1]!.id
}

function touch(run: ProcessRun, now: string) {
  run.updatedAt = now
}

function log(run: ProcessRun, entry: { at: string, actor: ProcessActor, stage: string, action: string, detail?: string }) {
  run.log = [...run.log, entry].slice(-500)
}

function fail(code: ProcessOpError['code'], message: string, missing?: string[]): ProcessOpResult {
  return { ok: false, error: { code, message, missing } }
}

/** Create a fresh run sitting on the first stage. */
export function createRun(
  def: ProcessDefinition,
  input: { runId: string, title: string, now: string }
): ProcessOpResult {
  const runId = String(input.runId || '').trim()
  if (!runId) return fail('empty-id', 'runId is required')
  const run: ProcessRun = {
    runId,
    processId: def.id,
    processVersion: def.version,
    title: input.title || runId,
    status: 'running',
    createdAt: input.now,
    updatedAt: input.now,
    currentStage: def.stages[0]?.id || '',
    stages: def.stages.map((stage, index) => ({
      id: stage.id,
      status: index === 0 ? 'ready' : 'pending',
      attempts: 0
    })),
    artifacts: [],
    log: [{ at: input.now, actor: 'user', stage: '', action: 'run.created', detail: runId }]
  }
  return { ok: true, run }
}

/**
 * Start the current stage. Refuses when it is not current, is already done, or
 * its required artifacts are missing — the SOP's "no writing before reading
 * the bible and ledger" rule, enforced by data instead of good intentions.
 */
export function startStage(
  source: ProcessRun,
  def: ProcessDefinition,
  stageId: string,
  options: { now: string, actor?: ProcessActor }
): ProcessOpResult {
  const run = cloneRun(source)
  const stage = stageDefinition(def, stageId)
  const state = stageState(run, stageId)
  if (!stage || !state) return fail('unknown-stage', `Unknown stage: ${stageId}`)
  if (run.currentStage !== stageId) {
    return fail('not-current', `Stage "${stageId}" is not the current stage (${run.currentStage})`)
  }
  if (!['ready', 'needs_revision'].includes(state.status)) {
    return fail('wrong-state', `Stage "${stageId}" is ${state.status}, not ready to start`)
  }
  const missing = missingRequirements(def, run, stageId)
  if (missing.length > 0) return fail('missing-artifacts', `Missing artifacts: ${missing.join(', ')}`, missing)

  state.status = 'running'
  state.startedAt = state.startedAt || options.now
  state.attempts += 1
  state.lastError = undefined
  run.status = 'running'
  touch(run, options.now)
  log(run, { at: options.now, actor: options.actor || 'user', stage: stageId, action: 'stage.started' })
  return { ok: true, run }
}

/**
 * Mark the stage's outputs as produced and move it to the gate. The caller
 * writes the artifact files first (store) and records their hashes here, then
 * passes the validator findings: a CRITICAL issue stops the stage at the door
 * when the profile says so (`policy.blockOnCritical`), because a report nobody
 * can review must not reach a human gate pretending to be finished.
 */
export function completeStage(
  source: ProcessRun,
  def: ProcessDefinition,
  stageId: string,
  options: { now: string, actor?: ProcessActor, issues?: ProcessIssue[] }
): ProcessOpResult {
  const run = cloneRun(source)
  const stage = stageDefinition(def, stageId)
  const state = stageState(run, stageId)
  if (!stage || !state) return fail('unknown-stage', `Unknown stage: ${stageId}`)
  if (state.status !== 'running') {
    return fail('wrong-state', `Stage "${stageId}" is ${state.status}, not running`)
  }
  const missing = stage.produces.filter(name => !hasArtifact(run, name))
  if (missing.length > 0) {
    return fail('missing-artifacts', `Stage produced nothing: ${missing.join(', ')}`, missing)
  }
  const criticals = (options.issues || []).filter(issue => issue.level === 'critical')
  if (criticals.length > 0 && def.policy.blockOnCritical) {
    state.status = 'needs_revision'
    state.lastError = criticals.map(issue => issue.message).join(' · ')
    run.status = 'needs_revision'
    log(run, {
      at: options.now,
      actor: 'agent',
      stage: stageId,
      action: 'stage.blocked',
      detail: criticals.map(issue => issue.code).join(',')
    })
    touch(run, options.now)
    return { ok: false, error: { code: 'validation', message: state.lastError }, run }
  }

  state.completedAt = options.now
  if (stage.gate === 'auto') {
    state.status = 'approved'
    state.decidedAt = options.now
    state.decidedBy = 'auto'
    markArtifactsApproved(run, stage, options.now, 'auto')
    log(run, { at: options.now, actor: 'agent', stage: stageId, action: 'gate.auto-approved' })
    advance(run, def, stageId, options.now)
  } else {
    state.status = 'waiting_gate'
    run.status = 'waiting_gate'
    log(run, { at: options.now, actor: options.actor || 'user', stage: stageId, action: 'gate.requested' })
  }
  touch(run, options.now)
  return { ok: true, run }
}

function markArtifactsApproved(run: ProcessRun, stage: ProcessStageDef, at: string, reviewer: string) {
  run.artifacts = run.artifacts.map((artifact) => {
    if (!stage.produces.includes(artifact.name)) return artifact
    // Only the CURRENT version carries the approval: the older ones are
    // history, and pinning them would imply they are still live content.
    const latest = latestArtifact(run, artifact.name)
    if (!latest || latest.version !== artifact.version) return artifact
    return { ...artifact, approvedAt: at, approvedBy: reviewer, approvedHash: artifact.hash }
  })
}

/** Move the pipeline to the next stage (or DONE when the last one passes). */
function advance(run: ProcessRun, def: ProcessDefinition, stageId: string, now: string) {
  const next = nextStageId(def, stageId)
  if (!next) {
    run.status = 'done'
    return
  }
  run.currentStage = next
  const nextState = stageState(run, next)
  if (nextState && nextState.status === 'pending') nextState.status = 'ready'
  run.status = 'running'
  touch(run, now)
}

/**
 * Sign a gate. `approved` advances and pins every artifact the stage produced
 * to its current hash; `revise` sends the stage back with a reason; `rejected`
 * blocks the run (the SOP's REJECTED state needs a human to unblock).
 */
export function recordGate(
  source: ProcessRun,
  def: ProcessDefinition,
  stageId: string,
  input: { decision: ProcessGateDecision, reviewer: string, reason?: string, now: string }
): ProcessOpResult {
  const run = cloneRun(source)
  const stage = stageDefinition(def, stageId)
  const state = stageState(run, stageId)
  if (!stage || !state) return fail('unknown-stage', `Unknown stage: ${stageId}`)
  if (state.status !== 'waiting_gate') {
    return fail('wrong-state', `Stage "${stageId}" is ${state.status}, not waiting for a decision`)
  }
  const reviewer = String(input.reviewer || '').trim() || 'unknown'
  state.decidedAt = input.now
  state.decidedBy = reviewer

  if (input.decision === 'approved') {
    state.status = 'approved'
    markArtifactsApproved(run, stage, input.now, reviewer)
    log(run, { at: input.now, actor: 'user', stage: stageId, action: 'gate.approved', detail: reviewer })
    advance(run, def, stageId, input.now)
  } else if (input.decision === 'revise') {
    state.status = 'needs_revision'
    state.lastError = input.reason || ''
    run.status = 'needs_revision'
    log(run, { at: input.now, actor: 'user', stage: stageId, action: 'gate.revise', detail: input.reason })
  } else {
    state.status = 'approved'
    run.status = 'blocked'
    log(run, { at: input.now, actor: 'user', stage: stageId, action: 'gate.rejected', detail: input.reason })
  }
  touch(run, input.now)
  return { ok: true, run }
}

/**
 * Record one written artifact version. Writing a new version of an artifact
 * whose approval was already given REWINDS its stage(s) to needs_revision —
 * the SOP rule "content changed after approval ⇒ the gates run again" —
 * because an approved hash that no longer matches is a lie.
 */
export function addArtifact(
  source: ProcessRun,
  def: ProcessDefinition,
  input: { name: string, version: number, hash: string, now: string, actor?: ProcessActor, file?: string }
): ProcessOpResult {
  const run = cloneRun(source)
  const name = String(input.name || '').trim()
  if (!name) return fail('empty-id', 'Artifact name is required')
  const next: ProcessRun['artifacts'][number] = {
    name,
    version: Math.max(1, Math.trunc(input.version) || 1),
    hash: String(input.hash || ''),
    createdAt: input.now,
    createdBy: input.actor || 'user',
    file: input.file
  }
  // The previous approval stays on the previous version (audit trail); this
  // new content has not been reviewed, so it carries no pin of its own.
  run.artifacts = [...run.artifacts, next]
  log(run, {
    at: input.now,
    actor: input.actor || 'user',
    stage: run.currentStage,
    action: 'artifact.written',
    detail: `${name}@v${next.version}`
  })
  touch(run, input.now)
  return { ok: true, run: reopenStaleGates(run, def, name, input.now) }
}

/** Rewind every approved stage that produced `name`, earliest first. */
function reopenStaleGates(run: ProcessRun, def: ProcessDefinition, name: string, now: string): ProcessRun {
  const affected = def.stages.filter(stage => stage.produces.includes(name))
  if (affected.length === 0) return run
  const order = def.stages.map(stage => stage.id)
  const reopened: string[] = []
  for (const stage of affected) {
    const state = stageState(run, stage.id)
    if (!state || state.status !== 'approved') continue
    state.status = 'needs_revision'
    state.decidedAt = undefined
    state.decidedBy = undefined
    reopened.push(stage.id)
  }
  if (reopened.length === 0) return run
  const earliest = reopened.sort((a, b) => order.indexOf(a) - order.indexOf(b))[0]!
  run.currentStage = earliest
  // A later stage may have been approved with the old content; sending the
  // pipeline back to `earliest` is the honest state — the rest re-runs.
  for (const stage of def.stages) {
    const state = stageState(run, stage.id)
    if (!state) continue
    const index = order.indexOf(stage.id)
    if (index <= order.indexOf(run.currentStage)) continue
    // 'ready' counts too: a downstream stage that was unlocked by the old
    // approval must not stay lit while the pipeline is back on `earliest`.
    if (state.status === 'approved' || state.status === 'waiting_gate' || state.status === 'running' || state.status === 'ready') {
      state.status = 'pending'
      state.decidedAt = undefined
      state.decidedBy = undefined
    }
  }
  run.status = 'needs_revision'
  log(run, { at: now, actor: 'user', stage: earliest, action: 'gate.reopened', detail: name })
  return run
}

/** Progress 0..100 for the board header: approved stages over total. */
export function runProgress(run: ProcessRun): number {
  if (run.stages.length === 0) return 0
  const approved = run.stages.filter(stage => stage.status === 'approved').length
  return Math.round((approved / run.stages.length) * 100)
}

/**
 * Artifacts whose LATEST version is unreviewed while an older version was
 * approved — the UI banner that explains why a gate reopened.
 */
export function staleApprovals(run: ProcessRun): string[] {
  const names = new Set(run.artifacts.map(artifact => artifact.name))
  const stale: string[] = []
  for (const name of names) {
    const versions = run.artifacts.filter(artifact => artifact.name === name)
    const latest = versions.reduce((a, b) => (b.version > a.version ? b : a))
    const approvedBefore = versions.some(artifact => !!artifact.approvedHash && artifact.version !== latest.version)
    if (approvedBefore && !latest.approvedHash) stale.push(name)
  }
  return stale
}
