import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { config } from '../../../config/index'
import { resolveUploadFilePath, uploadsContentTypeForName } from '../../../utils/uploads'
import { activeJobId, createJob, failJob, finishJob, reportOutTime } from '../../../utils/renderJobs'

/**
 * Web-runtime TMCut export (web-parity step 3). The browser cannot run ffmpeg
 * and the desktop runtime delegates to the Electron main process; this endpoint
 * gives the web runtime the same render by running the ALREADY COMPILED ffmpeg
 * argument array (app/utils/tmcut/render/compileTimelineToFfmpeg) on the Nitro
 * server and storing the result next to the uploads, so the existing
 * /uploads/** stream route serves it — no new serving path.
 *
 * Async job: ffmpeg runs in the background and the response is immediate
 * (jobId + duration). The client polls GET /api/v1/media/render/<jobId> for
 * REAL progress parsed from ffmpeg's `-progress pipe:1` output. One job runs at
 * a time (`error.renderBusy`).
 *
 * Trust model: the client is the app itself (auth middleware requires a valid
 * tm-tools JWT for every /api/** route). The endpoint still refuses to read
 * anything outside the uploads dir:
 *   - every `-i <src>` must be a flat `/uploads/<name>.<ext>` asset the server
 *     itself stored (traversal-safe resolveUploadFilePath + media-ext
 *     whitelist), and
 *   - the output path (always the last arg) is DISCARDED and replaced with a
 *     generated name inside the uploads dir.
 * Filter strings pass through unchanged (they carry drawtext font files / LUT
 * cubes, which are read-only inputs of the local desktop tool).
 *
 * Transport: like the proxy endpoint, ffmpeg muxes to a file descriptor and a
 * node WriteStream receives the bytes — on this machine some directories deny
 * the child process's open mode, so no direct ffmpeg file creation anywhere.
 * fd 3 carries the media, fd 1 the machine-readable progress, fd 2 the log.
 * mp4/mov use fragmented output so the file is self-contained (moov present)
 * even mid-write.
 *
 * Contract: POST /api/v1/media/render
 *   body = { args: string[], outputName?: string, duration?: number }
 *   ←    = { ok, jobId, duration }   (progress: GET /api/v1/media/render/:jobId)
 */
const OUTPUT_EXTS = new Set(['mp4', 'mov', 'mkv', 'webm', 'gif', 'mp3', 'wav'])
const MUXER_BY_EXT: Record<string, { format: string, flags?: string[] }> = {
  mp4: { format: 'mp4', flags: ['-movflags', 'frag_keyframe+empty_moov'] },
  mov: { format: 'mov', flags: ['-movflags', 'frag_keyframe+empty_moov'] },
  mkv: { format: 'matroska' },
  webm: { format: 'webm' },
  gif: { format: 'gif' },
  mp3: { format: 'mp3' },
  wav: { format: 'wav' }
}
const MAX_ARGS = 400
const MAX_ARG_LEN = 20000
const RENDER_TIMEOUT_MS = 20 * 60 * 1000

export default defineEventHandler(async (event) => {
  if (!event.context.auth) {
    throw createError({ statusCode: 401, statusMessage: 'error.unauthorized', message: 'Unauthorized' })
  }
  if (activeJobId()) {
    throw createError({ statusCode: 409, statusMessage: 'error.renderBusy', message: 'Another render is already running' })
  }

  const body = await readBody<{ args?: unknown, outputName?: unknown, duration?: unknown }>(event) || {}
  if (!Array.isArray(body.args) || body.args.length === 0 || body.args.length > MAX_ARGS) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'args must be a non-empty string array' })
  }
  const args = body.args.map(value => (typeof value === 'string' ? value : ''))
  if (args.some(value => value === '' || value.length > MAX_ARG_LEN || value.includes('\0'))) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'args contain an empty, oversized or invalid entry' })
  }

  const dir = config.uploads.dir

  // Every input must be a server-stored flat upload — rewrite to its abs path.
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== '-i') continue
    const src = args[i + 1]!
    if (!src.startsWith('/uploads/')) {
      throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'render inputs must be /uploads/ assets' })
    }
    const name = src.slice('/uploads/'.length)
    if (!name || name.includes('/')) {
      throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'invalid upload reference' })
    }
    const resolved = resolveUploadFilePath(dir, [decodeURIComponent(name)])
    if (!resolved) {
      throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: 'not a server-stored media file' })
    }
    const info = await stat(resolved).catch(() => null)
    if (!info?.isFile() || info.size <= 0) {
      throw createError({ statusCode: 404, statusMessage: 'error.notFound', message: 'render input no longer exists on the server' })
    }
    args[i + 1] = resolved
  }

  // Output is always the compiler's last argument — replace it entirely.
  const requested = typeof body.outputName === 'string' ? basename(body.outputName) : ''
  const ext = (extname(requested).slice(1).toLowerCase()) || 'mp4'
  const muxer = MUXER_BY_EXT[ext]
  if (!OUTPUT_EXTS.has(ext) || !muxer) {
    throw createError({ statusCode: 400, statusMessage: 'error.badRequest', message: `unsupported output extension .${ext}` })
  }
  const safeBase = requested.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\s]+/g, '_').trim().slice(0, 80) || 'render'
  const outName = `render-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}-${safeBase}.${ext}`
  const out = join(dir, outName)

  const durationSec = Number.isFinite(Number(body.duration)) ? Math.max(0, Number(body.duration)) : 0

  // fd 3 carries the media (stdout is reserved for -progress, stderr for logs).
  args[args.length - 1] = 'pipe:3'
  args.splice(args.length - 1, 0, ...(muxer.flags ?? []), '-f', muxer.format, '-progress', 'pipe:1', '-nostats')

  const jobId = `rj_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  const job = createJob(jobId, durationSec)

  const ffmpegPath = config.tools.ffmpegPath || 'ffmpeg'
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
  const ws = createWriteStream(out)
  let stderrTail = ''
  let settled = false
  const timer = setTimeout(() => finish(new Error('render timed out')), RENDER_TIMEOUT_MS)

  function finish(error: Error | null) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    child.kill()
    if (error) {
      ws.destroy()
      unlink(out).catch(() => {})
      failJob(jobId, error.message || 'Render failed')
      return
    }
    stat(out).then((info) => {
      if (!info.isFile() || info.size <= 0) {
        unlink(out).catch(() => {})
        failJob(jobId, 'Render produced no output')
        return
      }
      finishJob(jobId, { url: `/uploads/${outName}`, size: info.size, contentType: uploadsContentTypeForName(outName) })
    }).catch(() => failJob(jobId, 'Render produced no output'))
  }

  // Machine-readable progress (key=value lines).
  child.stdout?.on('data', (chunk: Buffer) => {
    for (const line of String(chunk).split('\n')) {
      const match = /^(?:out_time_us|out_time_ms)=(\d+)/.exec(line.trim())
      if (match) reportOutTime(jobId, Number(match[1]) / 1_000_000)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + String(chunk)).split('\n').filter(Boolean).slice(-4).join(' | ')
  })
  const mediaStream = child.stdio[3]
  if (mediaStream) mediaStream.pipe(ws)
  ws.on('error', err => finish(err instanceof Error ? err : new Error('write failed')))
  child.on('error', err => finish(err instanceof Error ? err : new Error('ffmpeg failed to start')))
  child.on('close', (code) => {
    if (settled) return
    if (code === 0 && ws.writableFinished) finish(null)
    else finish(new Error(stderrTail || `ffmpeg exited with code ${code}`))
  })

  return { ok: true, jobId, duration: job.durationSec }
})
