/**
 * Production process — read one artifact version (latest when omitted).
 *
 * Contract: GET /api/v1/process/artifact?runId=&name=&version=
 *   ← { ok: true, data: { version, content } } | throws (400/404)
 */
export default defineEventHandler((event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  const query = getQuery(event)
  const rawVersion = Number(query.version)
  const result = readProcessArtifact({
    runId: String(query.runId || ''),
    name: String(query.name || ''),
    version: Number.isInteger(rawVersion) && rawVersion > 0 ? rawVersion : undefined
  })
  if (!result.ok) {
    throw createError({
      statusCode: result.error === 'artifact not found' ? 404 : 400,
      statusMessage: 'error.processArtifact',
      message: result.error
    })
  }
  return { ok: true, data: { version: result.version, content: result.content } }
})
