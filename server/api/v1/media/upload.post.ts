import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { config } from '../../../config/index'
import { uploadKindForName } from '../../../utils/uploads'

/**
 * Web-runtime media upload (R152). The browser pickers hand us File blobs —
 * instead of wrapping them in session-only blob: URLs (which die on reload),
 * the renderer streams the bytes here and the Nitro server persists them in
 * `config.uploads.dir`. The response URL (/uploads/<stored name>) is what
 * the media library keeps as the asset path.
 *
 * Auth: server/middleware/auth.ts already requires a valid tm-tools user JWT
 * for every /api/** route, so only logged-in users reach the disk write.
 * RBAC: the permission map carries no prefix for this route — same posture
 * as the other v1 media endpoints (editor is a workspace feature).
 *
 * Transport: raw octet-stream body instead of multipart. h3 buffers multipart
 * parts in memory, while a couple of 300MB+ source videos would exhaust the
 * dev server; a raw stream can be piped straight to disk and cut off the
 * moment the size guard trips.
 *
 * Contract: POST /api/v1/media/upload?name=<basename>
 *   body   = raw file bytes (content-type: application/octet-stream)
 *   ←      = { ok, kind, url: '/uploads/<stored>', size, name }
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const query = getQuery(event)
  const rawName = typeof query.name === 'string' ? query.name : ''
  const kind = uploadKindForName(rawName)
  if (!kind) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'Unsupported or missing file name (media extensions only)' })
  }

  // Keep the human-readable part of the name; strip any path/config chars.
  const safeName = basename(String(rawName)).replace(/[\\/:*?"<>|\s]+/g, '_').trim()
  if (!safeName) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'Invalid file name' })
  }

  const maxBytes = Math.max(1, config.uploads.maxMb) * 1024 * 1024
  const contentLength = Number(event.node.req.headers['content-length'] || 0)
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'Empty request body' })
  }

  // Cheap lock first (header-based), hard guard second (byte counting in the
  // stream — chunked uploads can lie about content-length).
  if (contentLength > maxBytes) {
    throw createError({ statusCode: 413, statusMessage: 'error.payloadTooLarge', message: `File exceeds the ${config.uploads.maxMb} MB upload limit` })
  }

  const storedName = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}-${safeName}`
  const dir = config.uploads.dir
  const dest = join(dir, storedName)
  await mkdir(dir, { recursive: true })

  let received = 0
  try {
    await new Promise<void>((resolve, reject) => {
      const req = event.node.req
      const stream = createWriteStream(dest)
      req.on('data', (chunk: Buffer) => {
        received += chunk.length
        if (received > maxBytes) {
          // Kill both ends; unlinked below. Reject with the size error.
          req.destroy()
          stream.destroy()
          reject(createError({ statusCode: 413, statusMessage: 'error.payloadTooLarge', message: `File exceeds the ${config.uploads.maxMb} MB upload limit` }))
        }
      })
      req.on('error', reject)
      stream.on('error', reject)
      stream.on('finish', () => resolve())
      req.pipe(stream)
    })
  } catch (error) {
    await unlink(dest).catch(() => {})
    throw error
  }

  return {
    ok: true,
    kind,
    url: `/uploads/${storedName}`,
    size: received,
    name: safeName
  }
})
