// =============================================================================
//  Artifact validators (pure) — the SOP's QA rules as CODE.
//
//  A stage may only reach its human gate with artifacts that are structurally
//  sound. The engine refuses to complete a stage when a CRITICAL issue is
//  present, so "the report exists" stops being the bar; "the report can be
//  reviewed" becomes the bar.
//
//  Rules are keyed by artifact NAME, not by stage id: a second profile that
//  produces `shot-list.json` gets the same checks for free. Nothing here is
//  anime-specific except the required outline beats, which the profile could
//  override later.
//
//  Severity contract:
//    critical → blocks the gate (missing prompting data, canon conflict, policy)
//    warning  → shown, reviewable, never blocks
// =============================================================================

import type { ProcessDefinition, ProcessStageDef } from '~/types/productionProcess'

export type ProcessIssueLevel = 'critical' | 'warning'

export interface ProcessIssue {
  level: ProcessIssueLevel
  /** Stable machine code (asserted by the spec, used by tests/logs). */
  code: string
  /** Artifact the issue belongs to. */
  artifact: string
  /** Human-readable detail — data, not a translated UI string. */
  message: string
}

const OUTLINE_BEATS = [
  'hook',
  'setup',
  'inciting',
  'escalation',
  'revelation',
  'choice',
  'climax',
  'resolution'
]

function critical(code: string, artifact: string, message: string): ProcessIssue {
  return { level: 'critical', code, artifact, message }
}

function warning(code: string, artifact: string, message: string): ProcessIssue {
  return { level: 'warning', code, artifact, message }
}

/** Parse a JSON artifact once, reporting a critical issue instead of throwing. */
function parseJson(content: string, artifact: string, issues: ProcessIssue[]): unknown {
  try {
    return JSON.parse(content)
  } catch (err) {
    issues.push(critical('json-invalid', artifact, `Not valid JSON: ${String((err as Error)?.message || err)}`))
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** Continuity brief: an unresolved CRITICAL conflict or `blocked` stops the run. */
function validateContinuity(content: string, artifact: string, issues: ProcessIssue[]) {
  const parsed = parseJson(content, artifact, issues)
  if (!isRecord(parsed)) {
    if (parsed !== null) issues.push(critical('continuity-shape', artifact, 'Continuity brief must be a JSON object'))
    return
  }
  if (parsed.blocked === true) {
    issues.push(critical('continuity-blocked', artifact, 'The continuity brief is marked BLOCKED'))
  }
  for (const conflict of asArray(parsed.conflicts)) {
    if (isRecord(conflict) && String(conflict.severity || '').toUpperCase() === 'CRITICAL') {
      issues.push(critical('continuity-conflict', artifact, String(conflict.note || 'Unresolved CRITICAL continuity conflict')))
    }
  }
  if (asArray(parsed.characters).length === 0) {
    issues.push(warning('continuity-empty', artifact, 'No characters listed in the continuity brief'))
  }
}

/** Novelty report: a REJECT verdict (<65) must choose another idea, per SOP. */
function validateNovelty(content: string, artifact: string, issues: ProcessIssue[]) {
  const scores = [...content.matchAll(/novelty\s*score\s*[:=]?\s*\**\s*(\d{1,3})/gi)]
    .map(match => Number(match[1]))
    .filter(score => Number.isFinite(score) && score >= 0 && score <= 100)
  if (scores.length === 0) {
    issues.push(warning('novelty-score-missing', artifact, 'No "Novelty Score" found — a human must judge it'))
    return
  }
  const best = Math.max(...scores)
  if (best < 65) {
    issues.push(critical('novelty-rejected', artifact, `Best candidate scores ${best} (<65): pick or rewrite an idea`))
  } else if (best < 80) {
    issues.push(warning('novelty-revise', artifact, `Best candidate scores ${best} (65–79): REVISE before approving`))
  }
}

/** Outline: the SOP's beats are the minimum structure a script can be written from. */
function validateOutline(content: string, artifact: string, issues: ProcessIssue[]) {
  const lower = content.toLowerCase()
  const missing = OUTLINE_BEATS.filter(beat => !lower.includes(beat))
  if (missing.length >= 3) {
    issues.push(critical('outline-beats-missing', artifact, `Missing beats: ${missing.join(', ')}`))
  } else if (missing.length > 0) {
    issues.push(warning('outline-beat-weak', artifact, `Beats not found: ${missing.join(', ')}`))
  }
}

/** Script: scene headings are what the shot-list step consumes. */
function validateScript(content: string, artifact: string, issues: ProcessIssue[]) {
  const scenes = content.split('\n').filter(line => /^##\s+\S+/.test(line.trim()))
  if (scenes.length === 0) {
    issues.push(critical('script-no-scenes', artifact, 'No "## scene" heading found — the shot list cannot be built'))
  } else if (scenes.length < 2) {
    issues.push(warning('script-few-scenes', artifact, 'Only one scene heading found'))
  }
  if (!/\bdialogue\b/i.test(content)) {
    issues.push(warning('script-no-dialogue-block', artifact, 'No dialogue block found'))
  }
}

/** Shot list: a shot without a prompt cannot be generated at all. */
function validateShotList(content: string, artifact: string, issues: ProcessIssue[]) {
  const parsed = parseJson(content, artifact, issues)
  if (!isRecord(parsed)) {
    if (parsed !== null) issues.push(critical('shots-shape', artifact, 'Shot list must be a JSON object with "shots"'))
    return
  }
  const shots = asArray(parsed.shots)
  if (shots.length === 0) {
    issues.push(critical('shots-empty', artifact, 'The shot list has no shots'))
    return
  }
  let missingPrompt = 0
  let missingAcceptance = 0
  for (const shot of shots) {
    if (!isRecord(shot)) continue
    if (!nonEmptyString(shot.prompt)) missingPrompt++
    // acceptance criteria is how QA later judges the generated asset
    if (!nonEmptyString(shot.acceptance)) missingAcceptance++
  }
  if (missingPrompt > 0) {
    issues.push(critical('shots-prompt-missing', artifact, `${missingPrompt} shot(s) have no generation prompt`))
  }
  if (missingAcceptance > 0) {
    issues.push(warning('shots-acceptance-missing', artifact, `${missingAcceptance} shot(s) have no acceptance criteria`))
  }
}

/**
 * Asset manifest: the SOP's anti-infringement rule is that no asset may reach
 * an episode without a recorded license/source. Enforced here, at the gate.
 */
function validateAssetManifest(content: string, artifact: string, issues: ProcessIssue[]) {
  const parsed = parseJson(content, artifact, issues)
  const assets = Array.isArray(parsed) ? parsed : isRecord(parsed) ? asArray(parsed.assets) : []
  if (assets.length === 0) {
    issues.push(critical('assets-empty', artifact, 'The asset manifest lists no assets'))
    return
  }
  let unlicensed = 0
  for (const asset of assets) {
    if (!isRecord(asset)) {
      unlicensed++
      continue
    }
    const license = asset.license ?? asset.license_id ?? asset.licenseId
    if (!nonEmptyString(license)) unlicensed++
  }
  if (unlicensed > 0) {
    issues.push(critical('assets-license-missing', artifact, `${unlicensed} asset(s) have no recorded license/source`))
  }
}

/** QA report: a CRITICAL finding is a hard stop, not a note. */
function validateQaReport(content: string, artifact: string, issues: ProcessIssue[]) {
  if (/critical/i.test(content) && !/no\s+critical|critical\s*(findings)?\s*[:=]\s*none|0\s+critical/i.test(content)) {
    issues.push(critical('qa-critical', artifact, 'The QA report contains a CRITICAL finding'))
  }
  if (!/pass|fail/i.test(content)) {
    issues.push(warning('qa-verdict-missing', artifact, 'The QA report has no PASS/FAIL verdict'))
  }
}

/** Name → rule table. Unknown artifacts only get the shared checks below. */
const RULES: Record<string, (content: string, artifact: string, issues: ProcessIssue[]) => void> = {
  'continuity-brief.json': validateContinuity,
  'novelty-report.md': validateNovelty,
  'outline.md': validateOutline,
  'script.md': validateScript,
  'shot-list.json': validateShotList,
  'asset-manifest.json': validateAssetManifest,
  'qa-report.md': validateQaReport
}

/** Validate ONE artifact's content. Empty content is always critical. */
export function validateArtifact(name: string, content: string): ProcessIssue[] {
  const issues: ProcessIssue[] = []
  const text = String(content ?? '')
  if (!text.trim()) {
    issues.push(critical('artifact-empty', name, 'The artifact is empty'))
    return issues
  }
  if (name.endsWith('.json') && !RULES[name]) {
    // Any other JSON artifact must at least parse.
    parseJson(text, name, issues)
    return issues
  }
  RULES[name]?.(text, name, issues)
  return issues
}

/**
 * Validate everything a stage declares it produces. Missing content is passed
 * through as '' so a stage can never be completed on optimism alone.
 */
export function validateStageOutputs(
  stage: ProcessStageDef,
  contents: Record<string, string>
): ProcessIssue[] {
  const issues: ProcessIssue[] = []
  for (const name of stage.produces) issues.push(...validateArtifact(name, contents[name] ?? ''))
  return issues
}

/** Convenience for callers that only have a stage id. */
export function validateStage(
  def: ProcessDefinition,
  stageId: string,
  contents: Record<string, string>
): ProcessIssue[] {
  const stage = def.stages.find(item => item.id === stageId)
  return stage ? validateStageOutputs(stage, contents) : []
}

export function hasCritical(issues: ProcessIssue[]): boolean {
  return issues.some(issue => issue.level === 'critical')
}

/** Short summary for a toast/error banner: criticals first. */
export function summarizeIssues(issues: ProcessIssue[]): string {
  if (issues.length === 0) return ''
  const ordered = [...issues].sort((a, b) => (a.level === b.level ? 0 : a.level === 'critical' ? -1 : 1))
  return ordered
    .slice(0, 4)
    .map(issue => `${issue.level === 'critical' ? 'CRITICAL' : 'warning'}: ${issue.message}`)
    .join(' · ')
}
