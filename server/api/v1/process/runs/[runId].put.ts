/**
 * Production process — persist one run (atomic replace).
 *
 * The stage machine runs in the BROWSER, so the client sends the whole run it
 * just computed; this route only validates ids/size and writes the file.
 *
 * Contract: PUT /api/v1/process/runs/:runId   body = { run }
 *   ← { ok: true, data: { file } } | throws (400)
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const runId = getRouterParam(event, 'runId') || ''
  const body = await readBody<Record<string, unknown>>(event) || {}
  const run = body.run
  if (!run || typeof run !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'error.processRun', message: 'run payload is required' })
  }
  const result = writeProcessRun(runId, run)
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: 'error.processRun', message: result.error })
  }
  return { ok: true, data: { file: result.file } }
})
