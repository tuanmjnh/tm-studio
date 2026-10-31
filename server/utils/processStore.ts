// =============================================================================
//  Production process artifact store — WEB side (Nitro).
//
//  The browser cannot touch the disk, so the process page calls these routes
//  and the server writes the SAME layout the desktop main process writes:
//
//    <root>/runs/S01E001/run.json
//    <root>/runs/S01E001/artifacts/v1/episode-brief.md
//
//  Root is `.data/process` in the project (gitignored) unless
//  TMCUT_PROCESS_DIR overrides it. Every path goes through the shared guards in
//  shared/utils/processStore.ts, so the web and desktop rules stay identical.
// =============================================================================

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  MAX_ARTIFACT_BYTES,
  MAX_RUN_BYTES,
  artifactRelativePath,
  isSafeArtifactName,
  isSafeRunId,
  isSafeVersion,
  isWithinLimit,
  resolveInside,
  runRelativePath
} from '../../shared/utils/processStore'

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

export function processRootDir(): string {
  const configured = String(process.env.TMCUT_PROCESS_DIR || '').trim()
  return configured || join(process.cwd(), '.data', 'process')
}

function ensureRunsDir(root: string) {
  mkdirSync(join(root, 'runs'), { recursive: true })
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function listProcessRuns(): ProcessRunSummary[] {
  const root = processRootDir()
  ensureRunsDir(root)
  const runsDir = join(root, 'runs')
  const rows: ProcessRunSummary[] = []
  for (const entry of readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isSafeRunId(entry.name)) continue
    const run = readJson(join(runsDir, entry.name, 'run.json')) as Record<string, unknown> | null
    if (!run || typeof run !== 'object') continue
    rows.push({
      runId: String(run.runId || entry.name),
      title: String(run.title || entry.name),
      status: String(run.status || 'draft'),
      processId: String(run.processId || ''),
      processVersion: String(run.processVersion || ''),
      currentStage: String(run.currentStage || ''),
      updatedAt: String(run.updatedAt || run.createdAt || ''),
      artifacts: Array.isArray(run.artifacts) ? run.artifacts.length : 0
    })
  }
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function readProcessRun(runId: string): { ok: true, run: unknown } | { ok: false, error: string } {
  if (!isSafeRunId(runId)) return { ok: false, error: 'invalid run id' }
  const root = processRootDir()
  const target = resolveInside(root, runRelativePath(runId))
  if (!target) return { ok: false, error: 'path escapes the process root' }
  const run = readJson(target)
  if (!run) return { ok: false, error: 'run not found' }
  return { ok: true, run }
}

export function writeProcessRun(runId: string, run: unknown): { ok: true, file: string } | { ok: false, error: string } {
  if (!isSafeRunId(runId)) return { ok: false, error: 'invalid run id' }
  if (!run || typeof run !== 'object') return { ok: false, error: 'invalid run payload' }
  const serialized = JSON.stringify(run, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RUN_BYTES) return { ok: false, error: 'run payload too large' }
  const root = processRootDir()
  const target = resolveInside(root, runRelativePath(runId))
  if (!target) return { ok: false, error: 'path escapes the process root' }
  mkdirSync(dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  writeFileSync(tmp, serialized, 'utf8')
  renameSync(tmp, target)
  return { ok: true, file: runRelativePath(runId) }
}

function nextVersion(root: string, runId: string, name: string): number {
  const artifactsDir = join(root, 'runs', runId, 'artifacts')
  if (!existsSync(artifactsDir)) return 1
  let max = 0
  for (const entry of readdirSync(artifactsDir)) {
    const match = /^v(\d+)$/.exec(entry)
    if (!match) continue
    const version = Number(match[1])
    if (existsSync(join(artifactsDir, `v${version}`, name))) max = Math.max(max, version)
  }
  return max + 1
}

export function writeProcessArtifact(input: {
  runId: string
  name: string
  content: string
}): { ok: true, version: number, hash: string, file: string } | { ok: false, error: string } {
  const { runId, name, content } = input
  if (!isSafeRunId(runId)) return { ok: false, error: 'invalid run id' }
  if (!isSafeArtifactName(name)) return { ok: false, error: 'invalid artifact name' }
  if (!isWithinLimit(content, MAX_ARTIFACT_BYTES)) return { ok: false, error: 'artifact too large' }
  const root = processRootDir()
  const version = nextVersion(root, runId, name)
  const relative = artifactRelativePath(runId, name, version)
  const target = resolveInside(root, relative)
  if (!target) return { ok: false, error: 'path escapes the process root' }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
  const hash = createHash('sha256').update(content, 'utf8').digest('hex')
  return { ok: true, version, hash, file: relative }
}

export function readProcessArtifact(input: {
  runId: string
  name: string
  version?: number
}): { ok: true, version: number, content: string } | { ok: false, error: string } {
  const { runId, name } = input
  if (!isSafeRunId(runId)) return { ok: false, error: 'invalid run id' }
  if (!isSafeArtifactName(name)) return { ok: false, error: 'invalid artifact name' }
  const root = processRootDir()
  const version = isSafeVersion(input.version) ? input.version : nextVersion(root, runId, name) - 1
  if (!isSafeVersion(version)) return { ok: false, error: 'artifact not found' }
  const target = resolveInside(root, artifactRelativePath(runId, name, version))
  if (!target) return { ok: false, error: 'path escapes the process root' }
  if (!existsSync(target)) return { ok: false, error: 'artifact not found' }
  return { ok: true, version, content: readFileSync(target, 'utf8') }
}
