/**
 * Production process — list runs.
 *
 * WEB twin of `process:list` (electron/tools/process-store.cjs). Artifacts are
 * files on the server (`.data/process`, override with TMCUT_PROCESS_DIR) so the
 * browser build keeps the same folder layout the SOP asks for.
 *
 * Contract: GET /api/v1/process/runs
 *   ← { ok: true, data: ProcessRunSummary[] }
 */
export default defineEventHandler((event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  return { ok: true, data: listProcessRuns() }
})
