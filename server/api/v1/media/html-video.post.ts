import { randomBytes } from 'node:crypto'
import { replaceHtmlTokens, validateHtmlVideoSpec } from '@tmcut-core'
import { activeJobId, createJob } from '../../../utils/renderJobs'
import { newHtmlVideoOutputName, resolveChromeExecutable, runHtmlVideoRender } from '../../../utils/htmlVideoRender'

/**
 * HTML/CSS → MP4. Starts a background render job and answers immediately with
 * the job id; the client polls GET /api/v1/media/render/:jobId — the SAME job
 * store and poll route the timeline export uses, so progress is real.
 *
 * Contract: POST /api/v1/media/html-video
 *   body = { html, width, height, fps, durationSec, variables?, allowRemote?, quality?, outputName? }
 *   ←    = { ok, jobId, duration, frames, width, height, fps }
 *
 * The composition is untrusted input. It is validated statically here (the
 * core lint refuses documents without a composition root or a seek contract)
 * and rendered with network access denied by default; private hosts stay
 * denied even when remote assets are allowed.
 */
const MAX_HTML_CHARS = 700_000

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  if (activeJobId()) {
    throw createError({ statusCode: 409, statusMessage: 'error.renderBusy', message: 'Another render is already running' })
  }
  if (!resolveChromeExecutable()) {
    throw createError({
      statusCode: 503,
      statusMessage: 'error.htmlVideo.noBrowser',
      message: 'No Chromium browser found for HTML video rendering'
    })
  }

  const body = await readBody<Record<string, unknown>>(event) || {}
  if (typeof body.html === 'string' && body.html.length > MAX_HTML_CHARS) {
    throw createError({ statusCode: 413, statusMessage: 'error.badRequest', message: 'html is too large' })
  }

  const variables = body.variables && typeof body.variables === 'object' && !Array.isArray(body.variables)
    ? body.variables as Record<string, string | number | boolean | null>
    : undefined
  const html = replaceHtmlTokens(typeof body.html === 'string' ? body.html : '', variables)

  const check = validateHtmlVideoSpec({
    html,
    width: Number(body.width),
    height: Number(body.height),
    fps: Number(body.fps),
    durationSec: Number(body.durationSec),
    variables
  })
  if (!check.valid) {
    throw createError({
      statusCode: 400,
      statusMessage: 'error.badRequest',
      message: check.errors.join('; ').slice(0, 600)
    })
  }

  const quality = Math.min(100, Math.max(60, Math.round(Number(body.quality) || 92)))
  const outName = newHtmlVideoOutputName(typeof body.outputName === 'string' ? body.outputName : 'html-video')
  const jobId = `hv_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  createJob(jobId, check.durationSec)

  void runHtmlVideoRender({
    jobId,
    html,
    width: Number(body.width),
    height: Number(body.height),
    fps: Number(body.fps),
    durationSec: check.durationSec,
    allowRemote: body.allowRemote === true,
    quality,
    outName
  })

  return {
    ok: true,
    jobId,
    duration: check.durationSec,
    frames: check.frames,
    width: Number(body.width),
    height: Number(body.height),
    fps: Number(body.fps),
    warnings: check.warnings
  }
})
