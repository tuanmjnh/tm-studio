import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { config } from '../../config/index'
import { parseUploadRange, resolveUploadFilePath, uploadsContentTypeForName } from '../../utils/uploads'

/**
 * Static serving for web-runtime media uploads. Whatever the upload
 * endpoint (POST /api/v1/media/upload) persisted in config.uploads.dir
 * streams back here as /uploads/<stored name>.
 *
 * Deliberately NOT under /api/**: media elements and canvas drawImage on the
 * web runtime hit this path directly, and same-origin GETs from the app are
 * the only realistic callers on a local single-user server. The handler
 * rejects access outside the uploads dir and unknown media extensions, so
 * nothing arbitrary gets read from disk.
 *
 * Range requests are honored (206) — timeline video seeking in Chromium
 * fails or reports unknown duration without them.
 */
export default defineEventHandler(async (event) => {
  const segmentsParam = getRouterParams(event).path
  const segments = Array.isArray(segmentsParam)
    ? segmentsParam
    : String(segmentsParam || '').split('/').filter(Boolean)

  const target = resolveUploadFilePath(config.uploads.dir, segments)
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Upload not found' })
  }

  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Upload not found' })
  }

  const size = info.size
  const contentType = uploadsContentTypeForName(target)
  setHeader(event, 'content-type', contentType)
  setHeader(event, 'accept-ranges', 'bytes')
  setHeader(event, 'cache-control', 'public, max-age=3600')

  const range = parseUploadRange(getHeader(event, 'range'), size)
  if (range === null) {
    // Unsatisfiable Range.
    setResponseStatus(event, 416)
    setHeader(event, 'content-range', `bytes */${size}`)
    return ''
  }

  const start = range.start
  const end = range.end
  // h3's typed header map wants Content-Length as a literal number.
  const length = end - start + 1
  setHeader(event, 'content-length', length)
  if (range.partial) {
    setResponseStatus(event, 206)
    setHeader(event, 'content-range', `bytes ${start}-${end}/${size}`)
  }
  return sendStream(event, createReadStream(target, { start, end }))
})
