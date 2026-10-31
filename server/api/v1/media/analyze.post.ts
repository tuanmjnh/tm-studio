import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { config } from '../../../config/index'
import { resolveUploadFilePath } from '../../../utils/uploads'
import { sceneDetectionArgs, silenceDetectionArgs } from '#shared/utils/detection-args.cjs'

/**
 * Web-runtime media analysis (web-parity step 4). AutoCut's EDL scoring needs
 * two ffmpeg passes — shot detection (`select='gt(scene,T)',showinfo`) and
 * silence detection (`silencedetect`) — which the desktop runtime runs in the
 * main process (electron/tools/tmcut.controller.cjs analyzeScenes/analyzeSilence).
 * The browser cannot spawn ffmpeg, so this endpoint runs the SAME argument
 * shapes server-side over an already uploaded `/uploads/*` asset and returns
 * the raw log; the renderer parses it with the shared @tmcut/core readers, so
 * both runtimes score identically.
 *
 * Unlike the render endpoint there is no output file at all (`-f null -`): the
 * only product is the stderr log, which is capped so a pathological file
 * cannot exhaust the server.
 *
 * Trust model: auth is already enforced by server/middleware/auth.ts for every
 * /api/** route. Here the source must be a flat `/uploads/<name>` file the
 * server itself stored (traversal-safe resolveUploadFilePath), and the filter
 * strings are built from clamped numbers — no client string reaches ffmpeg.
 *
 * Contract: POST /api/v1/media/analyze
 *   body = { src: '/uploads/<name>.<ext>', kind: 'scenes' | 'silence',
 *            threshold?, noiseDb?, minDuration? }
 *   ←    = { ok, log, durationSec }  (mirrors TmcutAnalysisResult)
 */
const MAX_LOG_BYTES = 4 * 1024 * 1024
const ANALYZE_TIMEOUT_MS = 10 * 60 * 1000

function runCapture(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number, log: string, failed: boolean }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch {
      resolve({ code: -1, log: '', failed: true })
      return
    }
    let log = ''
    let overflow = false
    const push = (chunk: Buffer) => {
      if (overflow) return
      log += String(chunk)
      if (log.length > MAX_LOG_BYTES) {
        overflow = true
        child.kill()
      }
    }
    child.stdout?.on('data', push)
    child.stderr?.on('data', push)
    const timer = setTimeout(() => {
      child.kill()
      resolve({ code: -1, log, failed: true })
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, log, failed: true })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, log, failed: overflow })
    })
  })
}

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }

  const body = await readBody<{ src?: unknown, kind?: unknown, threshold?: unknown, noiseDb?: unknown, minDuration?: unknown }>(event) || {}
  const kind = body.kind === 'silence' ? 'silence' : body.kind === 'scenes' ? 'scenes' : null
  if (!kind) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'kind must be scenes or silence' })
  }

  const rawSrc = typeof body.src === 'string' ? body.src.trim() : ''
  const name = rawSrc.startsWith('/uploads/') ? rawSrc.slice('/uploads/'.length) : ''
  if (!name || name.includes('/')) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'src must be a /uploads/ asset URL' })
  }
  const source = resolveUploadFilePath(config.uploads.dir, [decodeURIComponent(name)])
  if (!source) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'Not a server-stored media file' })
  }
  const info = await stat(source).catch(() => null)
  if (!info?.isFile() || info.size <= 0) {
    throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'Source file no longer exists on the server' })
  }

  // Clamping and argv both come from the shared detection module, so the web
  // pass and the desktop pass cannot drift apart.
  const pass = kind === 'scenes'
    ? sceneDetectionArgs(source, body.threshold)
    : silenceDetectionArgs(source, body.noiseDb, body.minDuration)

  const ffmpeg = config.tools.ffmpegPath || 'ffmpeg'
  const result = await runCapture(ffmpeg, pass, ANALYZE_TIMEOUT_MS)
  const label = kind === 'scenes' ? 'Scene detection failed' : 'Silence detection failed'
  if (result.code !== 0) {
    return { ok: false, error: result.failed ? `${label} (output too large)` : label }
  }

  const probe = await runCapture(config.tools.ffprobePath || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', source
  ], 30 * 1000)
  const durationSec = probe.code === 0 ? Number.parseFloat(probe.log.trim()) || 0 : 0

  return { ok: true, log: result.log, durationSec }
})
