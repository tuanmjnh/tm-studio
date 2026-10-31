'use strict'

// =============================================================================
//  Production process artifact store (main process).
//
//  The production pipeline keeps every artifact as a REAL FILE, one directory
//  per version, so the SOP's folder layout is the storage format:
//
//    <userData>/tmcut/process/runs/S01E001/run.json
//    <userData>/tmcut/process/runs/S01E001/artifacts/v1/episode-brief.md
//    <userData>/tmcut/process/runs/S01E001/artifacts/v2/episode-brief.md
//
//  This module is the trust boundary: ids and artifact names are flat tokens,
//  every resolved path must stay inside the process root, and bodies are
//  capped. The pure guards are exported so `tmcut_process.spec.ts` can pin
//  them against the web copy in shared/utils/processStore.ts.
// =============================================================================

const { ipcMain, app, shell } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const MAX_ARTIFACT_BYTES = 1024 * 1024
const MAX_RUN_BYTES = 512 * 1024

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ARTIFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

function isSafeRunId(value) {
  return typeof value === 'string' && RUN_ID_RE.test(value)
}

function isSafeArtifactName(value) {
  if (typeof value !== 'string') return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  return ARTIFACT_NAME_RE.test(value)
}

function isSafeVersion(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10000
}

function artifactRelativePath(runId, name, version) {
  return `runs/${runId}/artifacts/v${version}/${name}`
}

function runRelativePath(runId) {
  return `runs/${runId}/run.json`
}

function resolveInside(root, relative) {
  if (typeof root !== 'string' || !root.trim()) return null
  if (typeof relative !== 'string' || !relative.trim()) return null
  if (path.isAbsolute(relative)) return null
  const base = path.resolve(root)
  const target = path.resolve(base, relative)
  if (target === base) return target
  return target.startsWith(base + path.sep) ? target : null
}

function isWithinLimit(content, limit = MAX_ARTIFACT_BYTES) {
  if (typeof content !== 'string') return false
  return Buffer.byteLength(content, 'utf8') <= limit
}

function hashOf(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

function processRoot() {
  return path.join(app.getPath('userData'), 'tmcut', 'process')
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

const ok = data => ({ ok: true, data })
const fail = error => ({ ok: false, error: String(error || 'unknown error') })

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function listRuns(root) {
  const runsDir = path.join(root, 'runs')
  let entries
  try {
    entries = fs.readdirSync(runsDir, { withFileTypes: true })
  } catch {
    return []
  }
  const rows = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeRunId(entry.name)) continue
    const run = readJsonSafe(path.join(runsDir, entry.name, 'run.json'))
    if (!run || typeof run !== 'object') continue
    rows.push({
      runId: run.runId || entry.name,
      title: run.title || entry.name,
      status: run.status || 'draft',
      processId: run.processId || '',
      processVersion: run.processVersion || '',
      currentStage: run.currentStage || '',
      updatedAt: run.updatedAt || run.createdAt || '',
      artifacts: Array.isArray(run.artifacts) ? run.artifacts.length : 0
    })
  }
  return rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function nextVersion(root, runId, name) {
  const artifactsDir = path.join(root, 'runs', runId, 'artifacts')
  let versions
  try {
    versions = fs.readdirSync(artifactsDir)
      .map(dir => /^v(\d+)$/.exec(dir))
      .filter(Boolean)
      .map(match => Number(match[1]))
  } catch {
    return 1
  }
  let max = 0
  for (const version of versions) {
    const file = path.join(artifactsDir, `v${version}`, name)
    if (fs.existsSync(file)) max = Math.max(max, version)
  }
  return max + 1
}

function writeRun(root, runId, run) {
  if (!isSafeRunId(runId)) return fail('invalid run id')
  if (!run || typeof run !== 'object') return fail('invalid run payload')
  const serialized = JSON.stringify(run, null, 2)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_RUN_BYTES) return fail('run payload too large')
  const target = resolveInside(root, runRelativePath(runId))
  if (!target) return fail('path escapes the process root')
  ensureDir(path.dirname(target))
  // Atomic replace: a crash mid-write must never leave a half JSON behind.
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, serialized, 'utf8')
  fs.renameSync(tmp, target)
  return ok({ file: runRelativePath(runId) })
}

function writeArtifact(root, { runId, name, content }) {
  if (!isSafeRunId(runId)) return fail('invalid run id')
  if (!isSafeArtifactName(name)) return fail('invalid artifact name')
  if (!isWithinLimit(content)) return fail('artifact too large')
  const version = nextVersion(root, runId, name)
  const relative = artifactRelativePath(runId, name, version)
  const target = resolveInside(root, relative)
  if (!target) return fail('path escapes the process root')
  ensureDir(path.dirname(target))
  fs.writeFileSync(target, content, 'utf8')
  return ok({ version, hash: hashOf(content), file: relative })
}

function readArtifact(root, { runId, name, version }) {
  if (!isSafeRunId(runId)) return fail('invalid run id')
  if (!isSafeArtifactName(name)) return fail('invalid artifact name')
  const resolvedVersion = isSafeVersion(version) ? version : nextVersion(root, runId, name) - 1
  if (!isSafeVersion(resolvedVersion)) return fail('artifact not found')
  const target = resolveInside(root, artifactRelativePath(runId, name, resolvedVersion))
  if (!target) return fail('path escapes the process root')
  try {
    return ok({ version: resolvedVersion, content: fs.readFileSync(target, 'utf8') })
  } catch {
    return fail('artifact not found')
  }
}

function readRun(root, runId) {
  if (!isSafeRunId(runId)) return fail('invalid run id')
  const target = resolveInside(root, runRelativePath(runId))
  if (!target) return fail('path escapes the process root')
  const run = readJsonSafe(target)
  if (!run) return fail('run not found')
  return ok(run)
}

function registerProcessController() {
  const moduleName = 'process'
  const root = processRoot()
  try {
    ensureDir(path.join(root, 'runs'))
  } catch {
    // A read-only userData folder must surface as a per-call error, not a
    // crash while the app boots.
  }

  ipcMain.handle(`${moduleName}:root`, () => {
    try {
      ensureDir(path.join(root, 'runs'))
    } catch {
      // ignore
    }
    return ok({ path: root })
  })

  ipcMain.handle(`${moduleName}:openRoot`, () => {
    try {
      ensureDir(path.join(root, 'runs'))
      void shell.openPath(root)
      return ok({ path: root })
    } catch (error) {
      return fail(error.message)
    }
  })

  ipcMain.handle(`${moduleName}:list`, () => {
    try {
      return ok(listRuns(root))
    } catch (error) {
      return fail(error.message)
    }
  })

  ipcMain.handle(`${moduleName}:read`, (_event, runId) => {
    try {
      return readRun(root, runId)
    } catch (error) {
      return fail(error.message)
    }
  })

  ipcMain.handle(`${moduleName}:save`, (_event, payload) => {
    try {
      const { runId, run } = payload || {}
      return writeRun(root, runId, run)
    } catch (error) {
      return fail(error.message)
    }
  })

  ipcMain.handle(`${moduleName}:writeArtifact`, (_event, payload) => {
    try {
      return writeArtifact(root, payload || {})
    } catch (error) {
      return fail(error.message)
    }
  })

  ipcMain.handle(`${moduleName}:readArtifact`, (_event, payload) => {
    try {
      return readArtifact(root, payload || {})
    } catch (error) {
      return fail(error.message)
    }
  })
}

module.exports = {
  registerProcessController,
  // pure guards (pinned against shared/utils/processStore.ts by the spec)
  isSafeRunId,
  isSafeArtifactName,
  isSafeVersion,
  artifactRelativePath,
  runRelativePath,
  resolveInside,
  isWithinLimit,
  MAX_ARTIFACT_BYTES,
  MAX_RUN_BYTES
}
