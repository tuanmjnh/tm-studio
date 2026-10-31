/**
 * Generation-output source classification (Roadmap v1 §7 / P6 follow-up).
 *
 * A `GenerationJob.outputAssetId` is provider-defined: a local path, an HTTP
 * URL, a dry-run marker, or an opaque asset id from a control plane. Assembly
 * can only point a clip at something the editor can play, so the id has to be
 * classified BEFORE any project is written. Keeping that decision pure means
 * the same rules serve the ingest step, the tests and a future provider
 * adapter, instead of three slightly different `startsWith` checks.
 */
import type { GenerationJob } from '~/types/videoFactory'

export type OutputSourceKind = 'simulated' | 'local-path' | 'remote-url' | 'unknown'

export interface OutputSource {
  kind: OutputSourceKind
  /** Path or URL for the playable kinds; absent for simulated/unknown. */
  location?: string
  /** Every job that produced this same output (deduped by location). */
  jobIds: string[]
}

export interface OutputIngestPlan {
  sources: OutputSource[]
  /** Jobs whose output is a dry-run marker — nothing to ingest. */
  simulated: number
  /** Jobs whose output id is opaque (control-plane asset id, empty, …). */
  unknown: number
  /** Jobs with a path or URL that can be imported into the media library. */
  ingestable: number
}

const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
const URL_SCHEME = /^(https?:\/\/|data:|blob:)/i

export function classifyOutputSource(assetId?: string | null): OutputSourceKind {
  const value = typeof assetId === 'string' ? assetId.trim() : ''
  if (!value) return 'unknown'
  if (value.startsWith('dryrun:')) return 'simulated'
  if (URL_SCHEME.test(value)) return 'remote-url'
  if (value.startsWith('file://')) return 'local-path'
  if (WINDOWS_DRIVE.test(value) || value.startsWith('/')) return 'local-path'
  // Everything else is an id we cannot resolve without the control plane.
  return 'unknown'
}

/**
 * Normalise a playable location: strip `file://`, decode its percent escapes,
 * and leave paths/URLs otherwise untouched.
 */
export function outputLocation(assetId?: string | null): string | undefined {
  const kind = classifyOutputSource(assetId)
  if (kind !== 'local-path' && kind !== 'remote-url') return undefined
  const value = String(assetId).trim()
  if (kind !== 'local-path' || !value.startsWith('file://')) return value
  let rest = value.slice('file://'.length)
  // file:///C:/x → C:/x (Windows), file:///home/x → /home/x (POSIX).
  if (/^\/[a-zA-Z]:[\\/]/.test(rest)) rest = rest.slice(1)
  try {
    // A file URL percent-encodes reserved characters that are legal in a path
    // (§ `#`), so decode fully; a bare `%` throws and is left as-is.
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

/**
 * Group a batch's jobs by what has to happen to their output before assembly.
 * Order is first-seen, so the plan is deterministic for a given job list.
 */
export function planOutputIngest(jobs: GenerationJob[]): OutputIngestPlan {
  const byLocation = new Map<string, OutputSource>()
  const plan: OutputIngestPlan = { sources: [], simulated: 0, unknown: 0, ingestable: 0 }

  for (const job of jobs) {
    const kind = classifyOutputSource(job.outputAssetId)
    if (kind === 'simulated') {
      plan.simulated += 1
      continue
    }
    if (kind === 'unknown') {
      plan.unknown += 1
      continue
    }
    const location = outputLocation(job.outputAssetId)!
    plan.ingestable += 1
    const existing = byLocation.get(location)
    if (existing) {
      existing.jobIds.push(job.jobId)
      continue
    }
    const source: OutputSource = { kind, location, jobIds: [job.jobId] }
    byLocation.set(location, source)
    plan.sources.push(source)
  }

  return plan
}
