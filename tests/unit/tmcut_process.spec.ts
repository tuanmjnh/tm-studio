// =============================================================================
//  Production process spec.
//
//  Pins the parts that must never drift:
//   1. the profile (utils/process/definition.ts) really is the SOP's twelve
//      stages: linear, human-gated, and it never allows auto-publish;
//   2. the stage machine (utils/process/stageMachine.ts) refuses to advance
//      without artifacts + a signed gate, and REOPENS an approved stage when
//      its artifact is rewritten (SOP §6: content change ⇒ gates re-run);
//   3. the web guards (shared/utils/processStore.ts) and the desktop store
//      (electron/tools/process-store.cjs) accept exactly the same ids/names
//      and both refuse path traversal.
//
//  Run: pnpm test:process (or through tests/unit/run-all.mts).
// =============================================================================
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ANIME_SERIES_PROCESS } from '../../app/utils/process/definition'
import { DEMO_APPROVED_STAGES, DEMO_ARTIFACTS, DEMO_RUN_ID } from '../../app/utils/process/demoEpisode'
import { validateArtifact, validateStage, validateStageOutputs } from '../../app/utils/process/validators'
import {
  addArtifact,
  completeStage,
  createRun,
  recordGate,
  runProgress,
  staleApprovals,
  startStage
} from '../../app/utils/process/stageMachine'
import {
  artifactRelativePath,
  isSafeArtifactName,
  isSafeRunId,
  resolveInside
} from '../../shared/utils/processStore'
import type { ProcessDefinition, ProcessRun } from '../../app/types/productionProcess'

const require = createRequire(import.meta.url)

const desktopStore = require('../../electron/tools/process-store.cjs')

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    failed++
    console.log(`  ✗ ${name}\n    ${(err as Error)?.message || err}`)
  }
}

const NOW = '2026-10-30T00:00:00.000Z'
const def = ANIME_SERIES_PROCESS

function unwrap(result: { ok: boolean }): ProcessRun {
  if (!result.ok) throw new Error('expected ok, got an error result')
  return (result as { ok: true, run: ProcessRun }).run
}

function freshRun(): ProcessRun {
  return unwrap(createRun(def, { runId: 'S01E001', title: 'Demo episode', now: NOW }))
}

function write(run: ProcessRun, name: string, version = 1, hash = `h${version}`): ProcessRun {
  return unwrap(addArtifact(run, def, { name, version, hash, now: NOW, actor: 'user' }))
}

// ---------------------------------------------------------------------------
// 1. Profile
// ---------------------------------------------------------------------------

console.log('\n[profile]')

check('has the SOP stages in order', () => {
  assert.deepEqual(def.stages.map(stage => stage.id), [
    'brief', 'continuity', 'ideas', 'novelty', 'outline', 'script',
    'shots', 'assets', 'edit', 'qa', 'publish', 'canon'
  ])
})

check('every requirement is produced by an EARLIER stage', () => {
  const produced = new Set<string>()
  for (const stage of def.stages) {
    for (const name of stage.requires) {
      assert.ok(produced.has(name), `${stage.id} requires "${name}" which no earlier stage produces`)
    }
    assert.ok(stage.produces.length > 0, `${stage.id} produces nothing`)
    for (const name of stage.produces) produced.add(name)
  }
})

check('automation only reads artifacts that already exist upstream', () => {
  const produced = new Set<string>()
  for (const stage of def.stages) {
    if (stage.automation) {
      assert.ok(stage.produces.length === 1, `${stage.id}: one automation, one output`)
      for (const name of stage.automation.contextArtifacts || []) {
        assert.ok(produced.has(name), `${stage.id} automation reads "${name}" before it exists`)
      }
    }
    for (const name of stage.produces) produced.add(name)
  }
})

check('every stage is human-gated and the profile forbids auto-publish', () => {
  assert.ok(def.stages.every(stage => stage.gate === 'human'), 'a stage may never self-approve')
  assert.equal(def.policy.forbidAutoPublish, true)
  assert.equal(def.policy.blockOnCritical, true)
})

// ---------------------------------------------------------------------------
// 2. Stage machine
// ---------------------------------------------------------------------------

console.log('\n[stage machine]')

check('a new run sits on the first stage with progress 0', () => {
  const run = freshRun()
  assert.equal(run.currentStage, 'brief')
  assert.equal(run.status, 'running')
  assert.equal(run.stages[0]!.status, 'ready')
  assert.equal(runProgress(run), 0)
})

check('a stage cannot start before its requirements exist', () => {
  const run = freshRun()
  const result = startStage(run, def, 'continuity', { now: NOW })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.error.code, 'not-current')

  // Even when it IS current, missing requirements stop it.
  const synthetic: ProcessDefinition = {
    ...def,
    stages: [
      { id: 'a', titleKey: 'a', kind: 'manual', requires: ['missing.md'], produces: ['a.md'], gate: 'human' },
      { id: 'b', titleKey: 'b', kind: 'manual', requires: ['a.md'], produces: ['b.md'], gate: 'human' }
    ]
  }
  const created = createRun(synthetic, { runId: 'S02E001', title: 'x', now: NOW })
  assert.equal(created.ok, true)
  if (!created.ok) return
  const blocked = startStage(created.run, synthetic, 'a', { now: NOW })
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.error.code, 'missing-artifacts')
    assert.deepEqual(blocked.error.missing, ['missing.md'])
  }
})

check('completing without an artifact is refused', () => {
  const run = freshRun()
  const started = startStage(run, def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const result = completeStage(started.run, def, 'brief', { now: NOW })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.error.code, 'missing-artifacts')
    assert.deepEqual(result.error.missing, ['episode-brief.md'])
  }
})

check('human gate: complete → waiting_gate, approve → next stage', () => {
  const started = startStage(freshRun(), def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const run = write(started.run, 'episode-brief.md')

  const completed = completeStage(run, def, 'brief', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  assert.equal(completed.run.status, 'waiting_gate')
  assert.equal(completed.run.currentStage, 'brief')
  assert.equal(completed.run.stages[0]!.status, 'waiting_gate')

  const approved = recordGate(completed.run, def, 'brief', { decision: 'approved', reviewer: 'me', now: NOW })
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.equal(approved.run.currentStage, 'continuity')
  assert.equal(approved.run.stages[0]!.status, 'approved')
  assert.equal(approved.run.stages[1]!.status, 'ready')
  assert.equal(approved.run.status, 'running')
  assert.equal(runProgress(approved.run), 8)

  // The gate pins the hash that was reviewed, not just the file name.
  const artifact = approved.run.artifacts.find(a => a.name === 'episode-brief.md')!
  assert.equal(artifact.approvedBy, 'me')
  assert.equal(artifact.approvedHash, artifact.hash)
})

check('a gate cannot be signed twice', () => {
  const started = startStage(freshRun(), def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const completed = completeStage(write(started.run, 'episode-brief.md'), def, 'brief', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  const first = recordGate(completed.run, def, 'brief', { decision: 'approved', reviewer: 'me', now: NOW })
  assert.equal(first.ok, true)
  if (!first.ok) return
  const second = recordGate(first.run, def, 'brief', { decision: 'approved', reviewer: 'me', now: NOW })
  assert.equal(second.ok, false)
  if (!second.ok) assert.equal(second.error.code, 'wrong-state')
})

check('revise sends the stage back and it can start again', () => {
  const started = startStage(freshRun(), def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const completed = completeStage(write(started.run, 'episode-brief.md'), def, 'brief', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  const revised = recordGate(completed.run, def, 'brief', {
    decision: 'revise',
    reviewer: 'me',
    reason: 'too long',
    now: NOW
  })
  assert.equal(revised.ok, true)
  if (!revised.ok) return
  assert.equal(revised.run.status, 'needs_revision')
  assert.equal(revised.run.stages[0]!.status, 'needs_revision')
  assert.equal(revised.run.stages[0]!.lastError, 'too long')

  const again = startStage(revised.run, def, 'brief', { now: NOW })
  assert.equal(again.ok, true)
  if (again.ok) assert.equal(again.run.stages[0]!.attempts, 2)
})

check('reject blocks the run at the gate', () => {
  const started = startStage(freshRun(), def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const completed = completeStage(write(started.run, 'episode-brief.md'), def, 'brief', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  const rejected = recordGate(completed.run, def, 'brief', {
    decision: 'rejected',
    reviewer: 'me',
    reason: 'off-brief',
    now: NOW
  })
  assert.equal(rejected.ok, true)
  if (!rejected.ok) return
  assert.equal(rejected.run.status, 'blocked')
})

check('rewriting an approved artifact reopens its stage', () => {
  const started = startStage(freshRun(), def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const completed = completeStage(write(started.run, 'episode-brief.md'), def, 'brief', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  const approved = recordGate(completed.run, def, 'brief', { decision: 'approved', reviewer: 'me', now: NOW })
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.equal(approved.run.currentStage, 'continuity')

  const rewritten = write(approved.run, 'episode-brief.md', 2, 'h2')
  assert.equal(rewritten.status, 'needs_revision')
  assert.equal(rewritten.currentStage, 'brief')
  assert.equal(rewritten.stages[0]!.status, 'needs_revision')
  assert.equal(rewritten.stages[1]!.status, 'pending')
  assert.deepEqual(staleApprovals(rewritten), ['episode-brief.md'])
})

check('writing an unapproved artifact leaves the pipeline alone', () => {
  const written = write(freshRun(), 'series-bible.md', 1, 'x')
  assert.equal(written.currentStage, 'brief')
  assert.equal(written.status, 'running')
  assert.deepEqual(staleApprovals(written), [])
})

check('auto-gated stages advance without a human', () => {
  const synthetic: ProcessDefinition = {
    ...def,
    stages: [
      { id: 'a', titleKey: 'a', kind: 'compute', requires: [], produces: ['a.txt'], gate: 'auto' },
      { id: 'b', titleKey: 'b', kind: 'manual', requires: ['a.txt'], produces: ['b.txt'], gate: 'human' }
    ]
  }
  const created = createRun(synthetic, { runId: 'S03E001', title: 'x', now: NOW })
  assert.equal(created.ok, true)
  if (!created.ok) return
  const started = startStage(created.run, synthetic, 'a', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const written = addArtifact(started.run, synthetic, { name: 'a.txt', version: 1, hash: 'h', now: NOW })
  assert.equal(written.ok, true)
  if (!written.ok) return
  const completed = completeStage(written.run, synthetic, 'a', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  assert.equal(completed.run.currentStage, 'b')
  assert.equal(completed.run.stages[0]!.status, 'approved')
  assert.equal(completed.run.stages[0]!.decidedBy, 'auto')
  assert.equal(completed.run.status, 'running')
})

check('the last stage approval finishes the run', () => {
  const synthetic: ProcessDefinition = {
    ...def,
    stages: [{ id: 'only', titleKey: 'only', kind: 'manual', requires: [], produces: ['only.md'], gate: 'human' }]
  }
  const created = createRun(synthetic, { runId: 'S04E001', title: 'x', now: NOW })
  assert.equal(created.ok, true)
  if (!created.ok) return
  const started = startStage(created.run, synthetic, 'only', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const written = addArtifact(started.run, synthetic, { name: 'only.md', version: 1, hash: 'h', now: NOW })
  assert.equal(written.ok, true)
  if (!written.ok) return
  const completed = completeStage(written.run, synthetic, 'only', { now: NOW })
  assert.equal(completed.ok, true)
  if (!completed.ok) return
  const approved = recordGate(completed.run, synthetic, 'only', { decision: 'approved', reviewer: 'me', now: NOW })
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.equal(approved.run.status, 'done')
  assert.equal(runProgress(approved.run), 100)
})

// ---------------------------------------------------------------------------
// 3. Demo episode fixtures
// ---------------------------------------------------------------------------

console.log('\n[demo episode]')

check('the demo run can be seeded and stops at the AI stage', () => {
  assert.match(DEMO_RUN_ID, /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/)
  let run = freshRun()
  for (const artifact of DEMO_ARTIFACTS) run = write(run, artifact.name)
  for (const stageId of DEMO_APPROVED_STAGES) {
    const started = startStage(run, def, stageId, { now: NOW })
    assert.equal(started.ok, true, `${stageId} refused to start`)
    if (!started.ok) return
    const completed = completeStage(started.run, def, stageId, { now: NOW })
    assert.equal(completed.ok, true, `${stageId} refused to complete`)
    if (!completed.ok) return
    const decided = recordGate(completed.run, def, stageId, { decision: 'approved', reviewer: 'demo-seed', now: NOW })
    assert.equal(decided.ok, true, `${stageId} gate refused`)
    if (!decided.ok) return
    run = decided.run
  }
  // Seeding must leave the pipeline on the first AI stage, not at the end:
  // the user has to run one real model call to see automation work.
  assert.equal(run.currentStage, 'script')
  assert.equal(run.status, 'running')
  assert.equal(run.stages.filter(stage => stage.status === 'approved').length, DEMO_APPROVED_STAGES.length)
  assert.equal(runProgress(run), Math.round((DEMO_APPROVED_STAGES.length / def.stages.length) * 100))
  assert.deepEqual(staleApprovals(run), [])
})

check('the seed covers every artifact the pre-approved stages need', () => {
  const seeded = new Set(DEMO_ARTIFACTS.map(artifact => artifact.name))
  // Seeds may also carry series-level context (series-bible.md) that no stage
  // produces — that is the SOP's "read the history first" input, not a stage
  // output — but every output of the stages the demo approves MUST be seeded.
  for (const stageId of DEMO_APPROVED_STAGES) {
    const stage = def.stages.find(item => item.id === stageId)!
    for (const name of stage.produces) {
      assert.ok(seeded.has(name), `demo approves ${stageId} but never seeds "${name}"`)
    }
  }
  for (const artifact of DEMO_ARTIFACTS) {
    assert.equal(isSafeArtifactName(artifact.name), true, `unsafe seed name "${artifact.name}"`)
    assert.ok(artifact.content.trim().length > 200, `demo artifact "${artifact.name}" is a stub`)
  }
})

// ---------------------------------------------------------------------------
// 4. Storage guards (web + desktop parity)
// ---------------------------------------------------------------------------

console.log('\n[storage guards]')

check('web guards accept flat ids and reject traversal', () => {
  assert.equal(isSafeRunId('S01E001'), true)
  assert.equal(isSafeRunId('s01e001-demo'), true)
  assert.equal(isSafeRunId('../etc'), false)
  assert.equal(isSafeRunId('S01/E001'), false)
  assert.equal(isSafeRunId('.hidden'), false)
  assert.equal(isSafeRunId(''), false)

  assert.equal(isSafeArtifactName('episode-brief.md'), true)
  assert.equal(isSafeArtifactName('shot_list.v2.json'), true)
  assert.equal(isSafeArtifactName('../run.json'), false)
  assert.equal(isSafeArtifactName('a/b.md'), false)
  assert.equal(isSafeArtifactName('..'), false)
})

check('artifact paths are versioned and stay inside the root', () => {
  assert.equal(artifactRelativePath('S01E001', 'outline.md', 3), 'runs/S01E001/artifacts/v3/outline.md')
  // The guards return absolute OS paths, so expectations must be built with
  // resolve() — a hardcoded POSIX string fails on Windows runners.
  const root = resolve(process.cwd(), '.process-spec-root')
  assert.equal(resolveInside(root, 'runs/S01E001/run.json'), resolve(root, 'runs/S01E001/run.json'))
  assert.equal(resolveInside(root, '../escape.json'), null)
  assert.equal(resolveInside(root, resolve(root, 'abs.json')), null)
  assert.equal(resolveInside(root, 'runs/../../etc/passwd'), null)
})

check('desktop store enforces exactly the same rules as the web guards', () => {
  const ids = ['S01E001', 's01-demo', '../etc', 'S01/E001', '.hidden', '', 'x'.repeat(80)]
  for (const id of ids) {
    assert.equal(desktopStore.isSafeRunId(id), isSafeRunId(id), `run id verdict differs for "${id}"`)
  }
  const names = ['episode-brief.md', 'shot_list.v2.json', '../run.json', 'a/b.md', '..', '', 'a\\b.md']
  for (const name of names) {
    assert.equal(
      desktopStore.isSafeArtifactName(name),
      isSafeArtifactName(name),
      `artifact name verdict differs for "${name}"`
    )
  }
  assert.equal(
    desktopStore.artifactRelativePath('S01E001', 'outline.md', 3),
    artifactRelativePath('S01E001', 'outline.md', 3)
  )
  const root = resolve(process.cwd(), '.process-spec-root')
  assert.equal(desktopStore.resolveInside(root, '../escape.json'), null)
  assert.equal(desktopStore.resolveInside(root, 'runs/x/run.json'), resolve(root, 'runs/x/run.json'))
  assert.equal(desktopStore.MAX_ARTIFACT_BYTES, 1024 * 1024)
})

// ---------------------------------------------------------------------------
// 5. Validators (SOP QA rules as code)
// ---------------------------------------------------------------------------

console.log('\n[validators]')

const codes = (issues: { code: string, level: string }[]) => issues.map(issue => `${issue.level}:${issue.code}`)

check('continuity: invalid JSON, BLOCKED and CRITICAL conflict all stop the gate', () => {
  assert.deepEqual(codes(validateArtifact('continuity-brief.json', '{oops')), ['critical:json-invalid'])
  assert.ok(codes(validateArtifact('continuity-brief.json', JSON.stringify({ blocked: true }))).includes('critical:continuity-blocked'))
  const conflicted = JSON.stringify({
    characters: [{ id: 'CHAR-001' }],
    conflicts: [{ severity: 'CRITICAL', note: 'Mira knows the ending' }]
  })
  assert.ok(codes(validateArtifact('continuity-brief.json', conflicted)).includes('critical:continuity-conflict'))
  const clean = JSON.stringify({ characters: [{ id: 'CHAR-001' }], conflicts: [], blocked: false })
  assert.deepEqual(validateArtifact('continuity-brief.json', clean), [])
})

check('novelty: a REJECT score blocks, a REVISE score only warns', () => {
  assert.deepEqual(codes(validateArtifact('novelty-report.md', '# Report\n**Novelty Score: 42** → REJECT')), ['critical:novelty-rejected'])
  assert.deepEqual(codes(validateArtifact('novelty-report.md', 'Novelty Score: 72 → REVISE')), ['warning:novelty-revise'])
  assert.deepEqual(validateArtifact('novelty-report.md', 'Novelty Score: 88 → PASS'), [])
  assert.deepEqual(codes(validateArtifact('novelty-report.md', 'no score here')), ['warning:novelty-score-missing'])
})

check('outline: three missing beats block, one missing beat warns', () => {
  const thin = '# Outline\n## Hook\n## Setup\n## Inciting incident\n'
  assert.deepEqual(codes(validateArtifact('outline.md', thin)), ['critical:outline-beats-missing'])
  const almost = '# Outline\nHook\nSetup\nInciting incident\nEscalation\nRevelation\nChoice\nClimax\n'
  assert.deepEqual(codes(validateArtifact('outline.md', almost)), ['warning:outline-beat-weak'])
})

check('script: no scene heading cannot feed the shot list', () => {
  assert.deepEqual(codes(validateArtifact('script.md', 'Just prose, no scenes.')), [
    'critical:script-no-scenes',
    'warning:script-no-dialogue-block'
  ])
  const one = '# Script\n## S01E001_SC01 — hall\nDialogue: hi\n'
  assert.deepEqual(codes(validateArtifact('script.md', one)), ['warning:script-few-scenes'])
})

check('shot list: empty or prompt-less shots block, missing acceptance warns', () => {
  assert.deepEqual(codes(validateArtifact('shot-list.json', JSON.stringify({ shots: [] }))), ['critical:shots-empty'])
  const noPrompt = JSON.stringify({ shots: [{ shot_id: 'S1', prompt: '' }] })
  assert.deepEqual(codes(validateArtifact('shot-list.json', noPrompt)), ['critical:shots-prompt-missing', 'warning:shots-acceptance-missing'])
  const good = JSON.stringify({ shots: [{ shot_id: 'S1', prompt: 'wide hall', acceptance: 'water visible' }] })
  assert.deepEqual(validateArtifact('shot-list.json', good), [])
})

check('asset manifest: every asset needs a recorded license', () => {
  const unlicensed = JSON.stringify({ assets: [{ id: 'A1', license: '' }] })
  assert.deepEqual(codes(validateArtifact('asset-manifest.json', unlicensed)), ['critical:assets-license-missing'])
  const licensed = JSON.stringify({ assets: [{ id: 'A1', license: 'CC0' }, { id: 'A2', license_id: 'pexels' }] })
  assert.deepEqual(validateArtifact('asset-manifest.json', licensed), [])
})

check('qa report: a CRITICAL finding blocks unless it is explicitly none', () => {
  assert.deepEqual(codes(validateArtifact('qa-report.md', 'Verdict: FAIL\nCRITICAL: audio desync')), ['critical:qa-critical'])
  assert.deepEqual(validateArtifact('qa-report.md', 'Verdict: PASS\nNo critical findings.'), [])
})

check('an empty artifact is always critical, and the stage validator covers every output', () => {
  assert.deepEqual(codes(validateArtifact('anything.md', '   ')), ['critical:artifact-empty'])
  const brief = def.stages.find(stage => stage.id === 'brief')!
  assert.deepEqual(codes(validateStageOutputs(brief, {})), ['critical:artifact-empty'])
  assert.deepEqual(codes(validateStage(def, 'brief', { 'episode-brief.md': '# Brief' })), [])
})

check('engine: CRITICAL findings block completion, warnings do not', () => {
  const started = startStage(freshRun(), def, 'brief', { now: NOW })
  assert.equal(started.ok, true)
  if (!started.ok) return
  const run = write(started.run, 'episode-brief.md', 1, 'h')

  const blocked = completeStage(run, def, 'brief', {
    now: NOW,
    issues: [{ level: 'critical', code: 'artifact-empty', artifact: 'episode-brief.md', message: 'empty' }]
  })
  assert.equal(blocked.ok, false)
  if (blocked.ok) return
  assert.equal(blocked.error.code, 'validation')
  // The mutated run must come back so the caller can persist the reason.
  assert.equal(blocked.run?.status, 'needs_revision')
  assert.equal(blocked.run?.stages[0]!.lastError, 'empty')

  const warned = completeStage(run, def, 'brief', {
    now: NOW,
    issues: [{ level: 'warning', code: 'novelty-revise', artifact: 'episode-brief.md', message: 'note' }]
  })
  assert.equal(warned.ok, true)
  if (warned.ok) assert.equal(warned.run.status, 'waiting_gate')

  // A profile that opts out of blocking may pass criticals through.
  const lenient: ProcessDefinition = { ...def, policy: { ...def.policy, blockOnCritical: false } }
  const allowed = completeStage(run, lenient, 'brief', {
    now: NOW,
    issues: [{ level: 'critical', code: 'artifact-empty', artifact: 'episode-brief.md', message: 'empty' }]
  })
  assert.equal(allowed.ok, true)
})

check('the demo script content would pass its own validator', () => {
  const outline = DEMO_ARTIFACTS.find(item => item.name === 'outline.md')!
  assert.deepEqual(validateArtifact('outline.md', outline.content), [])
})

// ---------------------------------------------------------------------------
// 7. Web store round-trip (real files in a temp root)
// ---------------------------------------------------------------------------

console.log('\n[web store round-trip]')

const nitroStore = await import('../../server/utils/processStore')

check('Nitro store writes, versions and reads the same layout as desktop', () => {
  const root = mkdtempSync(join(tmpdir(), 'tmcut-process-'))
  process.env.TMCUT_PROCESS_DIR = root
  const store = nitroStore
  try {
    const run = freshRun()
    const saved = store.writeProcessRun(run.runId, run)
    assert.equal(saved.ok, true)
    assert.equal(existsSync(join(root, 'runs', run.runId, 'run.json')), true)

    const listed = store.listProcessRuns()
    assert.equal(listed.length, 1)
    assert.equal(listed[0]!.runId, run.runId)
    assert.equal(listed[0]!.title, run.title)
    assert.equal(listed[0]!.currentStage, run.currentStage)

    const read = store.readProcessRun(run.runId)
    assert.equal(read.ok, true)
    if (read.ok) assert.equal((read.run as ProcessRun).runId, run.runId)

    const v1 = store.writeProcessArtifact({ runId: run.runId, name: 'outline.md', content: '# v1' })
    assert.equal(v1.ok, true)
    const v2 = store.writeProcessArtifact({ runId: run.runId, name: 'outline.md', content: '# v2' })
    assert.equal(v2.ok, true)
    if (!v1.ok || !v2.ok) return
    assert.equal(v1.version, 1)
    assert.equal(v2.version, 2)
    assert.equal(v1.hash === v2.hash, false)
    assert.equal(existsSync(join(root, v2.file)), true)

    const latest = store.readProcessArtifact({ runId: run.runId, name: 'outline.md' })
    assert.equal(latest.ok, true)
    if (latest.ok) {
      assert.equal(latest.version, 2)
      assert.equal(latest.content, '# v2')
    }
    const old = store.readProcessArtifact({ runId: run.runId, name: 'outline.md', version: 1 })
    assert.equal(old.ok, true)
    if (old.ok) assert.equal(old.content, '# v1')

    // Same trust boundary as desktop: flat ids/names only.
    assert.equal(store.readProcessRun('../run').ok, false)
    assert.equal(store.writeProcessArtifact({ runId: 'S01E001', name: '../x.md', content: 'x' }).ok, false)
    assert.equal(store.writeProcessRun('S01E001', 'not-an-object').ok, false)
  } finally {
    delete process.env.TMCUT_PROCESS_DIR
    rmSync(root, { recursive: true, force: true })
  }
})

console.log(`\n=== process: ${passed}/${passed + failed} checks PASSED ===`)
if (failed > 0) process.exit(1)
