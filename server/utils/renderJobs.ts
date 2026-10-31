/**
 * In-memory registry for web-runtime render jobs (TMCut export on the Nitro
 * server). The POST that starts a render answers immediately with a jobId and
 * ffmpeg runs in the background; the client polls GET
 * /api/v1/media/render/<jobId> for real progress (parsed from `-progress
 * pipe:1`), the final /uploads/ URL, or the failure message.
 *
 * A single job may run at a time (`activeRenderId`): a second request is
 * refused with `error.renderBusy` rather than spawning a competing ffmpeg that
 * would starve the machine. Finished jobs stay readable for a while so a slow
 * poller still sees the result, then get pruned.
 */

export interface RenderJob {
  id: string
  status: 'running' | 'done' | 'failed'
  /** 0..100, derived from ffmpeg's reported output time vs. the timeline span. */
  progress: number
  outTimeSec: number
  durationSec: number
  url: string | null
  size: number
  contentType: string | null
  error: string | null
  startedAt: number
  finishedAt: number | null
}

const jobs = new Map<string, RenderJob>()
let activeRenderId: string | null = null

const COMPLETED_TTL_MS = 10 * 60 * 1000

export function activeJobId(): string | null {
  return activeRenderId
}

export function createJob(id: string, durationSec: number): RenderJob {
  const job: RenderJob = {
    id,
    status: 'running',
    progress: 0,
    outTimeSec: 0,
    durationSec: Math.max(0, durationSec),
    url: null,
    size: 0,
    contentType: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null
  }
  jobs.set(id, job)
  activeRenderId = id
  pruneCompleted()
  return job
}

export function getJob(id: string): RenderJob | undefined {
  return jobs.get(id)
}

/** Records ffmpeg's reported output time; clamps progress just below 100. */
export function reportOutTime(id: string, outTimeSec: number): void {
  const job = jobs.get(id)
  if (!job || job.status !== 'running') return
  job.outTimeSec = outTimeSec
  if (job.durationSec > 0) {
    job.progress = Math.max(0, Math.min(99, Math.round((outTimeSec / job.durationSec) * 100)))
  }
}

/**
 * Corrects the expected length once the real one is known. The HTML renderer
 * discovers the composition's declared duration only after the page loads, and
 * the poller must divide progress by that number, not by the request's guess.
 */
export function setJobDuration(id: string, durationSec: number): void {
  const job = jobs.get(id)
  if (!job || job.status !== 'running') return
  if (Number.isFinite(durationSec) && durationSec > 0) job.durationSec = durationSec
}

export function finishJob(id: string, result: { url: string, size: number, contentType: string }): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'done'
  job.progress = 100
  job.url = result.url
  job.size = result.size
  job.contentType = result.contentType
  job.finishedAt = Date.now()
  if (activeRenderId === id) activeRenderId = null
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id)
  if (!job) return
  job.status = 'failed'
  job.error = error.slice(0, 400)
  job.finishedAt = Date.now()
  if (activeRenderId === id) activeRenderId = null
}

/** Drops completed/failed jobs older than the TTL so the map cannot grow. */
function pruneCompleted(): void {
  const cutoff = Date.now() - COMPLETED_TTL_MS
  for (const [id, job] of jobs) {
    if (job.status !== 'running' && (job.finishedAt ?? job.startedAt) < cutoff) jobs.delete(id)
  }
}
