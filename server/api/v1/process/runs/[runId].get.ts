/**
 * Production process — read one run (run.json).
 *
 * Contract: GET /api/v1/process/runs/:runId
 *   ← { ok: true, data: ProcessRun } | throws (400/404)
 */
export default defineEventHandler((event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const runId = getRouterParam(event, 'runId') || ''
  const result = readProcessRun(runId)
  if (!result.ok) {
    throw createError({
      statusCode: result.error === 'run not found' ? 404 : 400,
      statusMessage: 'error.processRun',
      message: result.error
    })
  }
  return { ok: true, data: result.run }
})
