// =============================================================================
//  Process artifact store — shared trust rules (web side).
//
//  The browser has no disk access, so on web the Nitro route writes artifacts
//  on the server and validates with THIS module. The desktop main process has
//  its own CJS copy (electron/tools/process-store.cjs) because a sandboxed
//  Electron entry point cannot import TypeScript; the unit spec
//  `tmcut_process.spec.ts` pins the two copies against the same vectors so the
//  two runtimes cannot drift apart silently (same approach as stockGuards).
// =============================================================================

import { isAbsolute, resolve, sep } from 'node:path'

/** One artifact version may not exceed this (Markdown/JSON, not media). */
export const MAX_ARTIFACT_BYTES = 1024 * 1024
/** run.json is small by design: the log is capped in the engine. */
export const MAX_RUN_BYTES = 512 * 1024

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const ARTIFACT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/

/** `S01E001` — no separators, no traversal, no leading dot. */
export function isSafeRunId(value: unknown): boolean {
  return typeof value === 'string' && RUN_ID_RE.test(value)
}

/** `episode-brief.md` — flat name only, never a path. */
export function isSafeArtifactName(value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (value.includes('/') || value.includes('\\') || value.includes('..')) return false
  return ARTIFACT_NAME_RE.test(value)
}

export function isSafeVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000
}

/** Relative directory for one artifact version: artifacts/v3/episode-brief.md */
export function artifactRelativePath(runId: string, name: string, version: number): string {
  return `runs/${runId}/artifacts/v${version}/${name}`
}

export function runRelativePath(runId: string): string {
  return `runs/${runId}/run.json`
}

/**
 * Resolve `relative` under `root`, refusing anything that escapes it. Returns
 * null instead of throwing so callers answer with a structured error.
 */
export function resolveInside(root: string, relative: string): string | null {
  if (typeof root !== 'string' || !root.trim()) return null
  if (typeof relative !== 'string' || !relative.trim()) return null
  if (isAbsolute(relative)) return null
  const base = resolve(root)
  const target = resolve(base, relative)
  if (target === base) return target
  return target.startsWith(base + sep) ? target : null
}

/** Reject payloads over the cap without buffering them in the store. */
export function isWithinLimit(content: unknown, limit = MAX_ARTIFACT_BYTES): boolean {
  if (typeof content !== 'string') return false
  return Buffer.byteLength(content, 'utf8') <= limit
}
