import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { config } from '../../../config/index'
import { resolveUploadFilePath } from '../../../utils/uploads'

/**
 * Web-runtime preview proxy (web-parity step 2). The browser cannot run
 * ffmpeg; the desktop runtime delegates the heavy scaling pass to the
 * main process (electron/tools/tmcut.controller.cjs generateProxy). This
 * endpoint offers the same pass to the web runtime: it scales an already
 * uploaded source (a /uploads/* asset) down with the SAME arguments the
 * desktop gateway uses (libx264 veryfast crf28 + aac 128k) and stores the
 * proxy next to the uploads so the existing /uploads/** stream route
 * serves it — `mediaUrl` needs no new serving path.
 *
 * Transport: ffmpeg muxes to stdout instead of writing to a path. On this
 * machine some directories deny the mapper's open mode for child processes
 * while normal node writes sail through, so the reliable pattern is a
 * fragmented-MP4 (movflags frag_keyframe+empty_moov) stream piped through
 * a node WriteStream — no direct ffmpeg file creation anywhere.
 *
 * Auth: server/middleware/auth.ts already requires a valid tm-tools user
 * JWT for every /api/** route. The endpoint itself validates that the
 * source is a server-stored upload (traversal-safe resolveUploadFilePath
 * + media-ext whitelist).
 *
 * Contract: POST /api/v1/media/proxy
 *   body   = { path: '/uploads/<name>.<ext>', width?: number (320..1920, 960) }
 *   ←      = { ok, path: '/uploads/proxy-<hash>.mp4', cached, width }
 * Cached copies (same source bytes + width) return instantly without an
 * ffmpeg run, mirroring the desktop proxies cache.
 */
export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<{ path?: unknown, width?: unknown }>(event) || {}
  const rawPath = typeof body.path === 'string' ? body.path.trim() : ''
  // Accept exactly one stored name behind the /uploads/ prefix — the flat
  // layout resolveUploadFilePath enforces also blocks traversal here.
  const name = rawPath.startsWith('/uploads/')
    ? rawPath.slice('/uploads/'.length)
    : ''
  if (!name || name.includes('/')) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'path must be a /uploads/ asset URL' })
  }
  const dir = config.uploads.dir
  const source = resolveUploadFilePath(dir, [decodeURIComponent(name)])
  if (!source) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'Not a server-stored media file' })
  }

  const srcStat = await stat(source).catch(() => null)
  if (!srcStat || !srcStat.isFile() || srcStat.size <= 0) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Source file no longer exists on the server' })
  }

  const targetWidth = Math.max(320, Math.min(1920, Math.floor(Number(body.width) || 960)))
  const key = createHash('sha1')
    .update(`${name}:${srcStat.mtimeMs.toFixed(0)}:${srcStat.size}:${targetWidth}`)
    .digest('hex')
    .slice(0, 20)
  const outName = `proxy-${key}.mp4`
  const out = join(dir, outName)

  let cached: boolean
  try {
    cached = (await stat(out)).isFile()
  } catch {
    cached = false
  }

  if (!cached) {
    const ffmpegPath = config.tools.ffmpegPath || 'ffmpeg'
    // Fragmented MP4 to stdout: self-bound file (moov present) so browsers
    // will stream it even while the WriteStream is still buffering.
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      source,
      '-vf',
      `scale=${targetWidth}:-2`,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '28',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-movflags',
      'frag_keyframe+empty_moov',
      '-f',
      'mp4',
      'pipe:1'
    ]
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
        const ws = createWriteStream(out)
        let stderrTail = ''
        let rejected = false
        const fail = (err: Error) => {
          rejected = true
          child.kill()
          child.stderr.destroy()
          ws.destroy()
          reject(err)
        }
        child.stderr.on('data', (chunk: Buffer) => {
          stderrTail = (stderrTail + String(chunk)).split('\n').filter(Boolean).slice(-3).join(' | ')
        })
        child.stdout.pipe(ws)
        child.on('error', fail)
        ws.on('error', fail)
        child.on('close', (code) => {
          if (rejected) return
          if (code === 0 && ws.writableFinished) {
            resolve()
          } else {
            reject(new Error(stderrTail || `ffmpeg exited with code ${code}`))
          }
        })
      })
    } catch (err) {
      await unlink(out).catch(() => {})
      throw createError({
        statusCode: 500,
        statusMessage: 'error.proxyFailed',
        message: (err instanceof Error ? err.message : 'Proxy generation failed').slice(0, 300)
      })
    }
  }

  return { ok: true, path: `/uploads/${outName}`, cached, width: targetWidth }
})
