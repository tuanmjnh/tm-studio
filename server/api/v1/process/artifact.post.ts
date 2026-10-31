/**
 * Production process — write ONE artifact version (append-only).
 *
 * Path rules come from shared/utils/processStore.ts, the same module the
 * desktop store is pinned against: flat run id, flat artifact name, body cap.
 *
 * Contract: POST /api/v1/process/artifact
 *   body = { runId, name, content }
 *   ← { ok: true, data: { version, hash, file } } | throws (400)
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const body = await readBody<Record<string, unknown>>(event) || {}
  const result = writeProcessArtifact({
    runId: String(body.runId || ''),
    name: String(body.name || ''),
    content: String(body.content ?? '')
  })
  if (!result.ok) {
    throw createError({ statusCode: 400, statusMessage: 'error.processArtifact', message: result.error })
  }
  return { ok: true, data: { version: result.version, hash: result.hash, file: result.file } }
})
