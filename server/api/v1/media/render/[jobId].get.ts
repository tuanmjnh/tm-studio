import { getJob } from '../../../../utils/renderJobs'

/**
 * Poll a web-runtime render job started by POST /api/v1/media/render.
 * Returns the live progress (ffmpeg's reported output time vs. the timeline
 * span), then the final /uploads/ URL or the failure message. Jobs are kept
 * in memory for a while after completion so a slow poller still sees them.
 *
 * Contract: GET /api/v1/media/render/:jobId
 *   ← = { ok, status, progress, outTimeSec, duration, url, size, error }
 */
export default defineEventHandler((event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const jobId = String(getRouterParams(event).jobId || '')
  const job = getJob(jobId)
  if (!job) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Unknown render job' })
  }

  return {
    ok: job.status !== 'failed',
    status: job.status,
    progress: job.progress,
    outTimeSec: Math.round(job.outTimeSec * 100) / 100,
    duration: job.durationSec,
    url: job.url,
    size: job.size,
    contentType: job.contentType,
    error: job.error
  }
})
