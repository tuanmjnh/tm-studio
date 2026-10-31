import { spawn } from 'node:child_process'
import { existsSync, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Browser, BrowserContext, Page } from 'playwright-core'
import { HTML_VIDEO_LIMITS, frameCountFor, isAllowedRenderUrl } from '@tmcut-core'
import { config } from '../config/index'
import { failJob, finishJob, reportOutTime, setJobDuration } from './renderJobs'

/**
 * HTML/CSS → MP4 capture engine.
 *
 * This follows the HyperFrames contract (heygen-com/hyperframes, Apache-2.0):
 * a composition is a plain HTML document with a `data-composition-id` root and
 * a time-pure `__hf.seek(t)`. The renderer never plays the animation — it asks
 * for one frame, screenshots it, then asks for the next, so the same document
 * always produces the same video.
 *
 * We do NOT depend on @hyperframes/engine: it pulls a bundled Puppeteer
 * download, while this machine already has Chrome and the app already has
 * playwright-core. The captured stills are encoded by the same bundled ffmpeg
 * the timeline export uses, through the same fd-3 transport, so the file lands
 * in the uploads dir and the existing /uploads/** route serves it.
 *
 * Trust boundary: the HTML is user-authored. Remote requests are denied unless
 * the render opts in, and private/loopback/metadata hosts stay denied even
 * then (see isAllowedRenderUrl in @tmcut/core) — a composition must not be able
 * to use the renderer as an SSRF pivot.
 */

const RENDER_TIMEOUT_MS = 10 * 60 * 1000

export function resolveChromeExecutable(): string | null {
  const override = process.env.TMCUT_CHROME_PATH || process.env.CHROME_PATH
  if (override && existsSync(override)) return override

  const localAppData = process.env.LOCALAPPDATA || ''
  const candidates = process.platform === 'win32'
    ? [
        join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']

  return candidates.find(path => path && existsSync(path)) || null
}

export interface HtmlVideoRenderOptions {
  jobId: string
  html: string
  width: number
  height: number
  fps: number
  durationSec: number
  allowRemote: boolean
  quality: number
  outName: string
}

interface CaptureResult {
  frames: number
  durationSec: number
  stderr: string
}

async function withBrowser<T>(executablePath: string, fn: (browser: Browser) => Promise<T>): Promise<T> {
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--hide-scrollbars',
      '--force-color-profile=srgb',
      '--force-device-scale-factor=1',
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    ]
  })
  try {
    return await fn(browser)
  } finally {
    await browser.close().catch(() => {})
  }
}

async function captureFrames(
  context: BrowserContext,
  opts: HtmlVideoRenderOptions,
  framesDir: string
): Promise<CaptureResult> {
  const page: Page = await context.newPage()
  const started = Date.now()

  await page.setContent(opts.html, { waitUntil: 'load', timeout: 20_000 })
  await page.waitForFunction(
    () => {
      const hf = (globalThis as unknown as { __hf?: { seek?: unknown, duration?: unknown } }).__hf
      return !!hf && typeof hf.seek === 'function' && Number(hf.duration) > 0
    },
    null,
    { timeout: 20_000 }
  )
  await page.evaluate(() => (globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }).document.fonts.ready)

  const pageDuration = await page.evaluate(() => {
    const hf = (globalThis as unknown as { __hf?: { duration?: number } }).__hf
    return Number(hf?.duration || 0)
  })
  if (!Number.isFinite(pageDuration) || pageDuration <= 0) {
    throw new Error('composition declared no duration')
  }
  if (pageDuration > HTML_VIDEO_LIMITS.maxDurationSec) {
    throw new Error(`composition is ${pageDuration.toFixed(2)}s; the limit is ${HTML_VIDEO_LIMITS.maxDurationSec}s`)
  }

  // The composition's own duration wins over the request: a template that
  // declares 5s must not be rendered as 8s of frozen last frame.
  const frames = frameCountFor(pageDuration, opts.fps)
  if (frames > HTML_VIDEO_LIMITS.maxFrames) {
    throw new Error(`composition needs ${frames} frames; the limit is ${HTML_VIDEO_LIMITS.maxFrames}`)
  }
  setJobDuration(opts.jobId, pageDuration)

  for (let frame = 0; frame < frames; frame += 1) {
    if (Date.now() - started > RENDER_TIMEOUT_MS) throw new Error('HTML video render timed out')
    const time = frame / opts.fps
    await page.evaluate(async (t) => {
      const hf = (globalThis as unknown as { __hf: { seek: (time: number) => unknown } }).__hf
      const result = hf.seek(t)
      if (result && typeof (result as Promise<void>).then === 'function') await result
    }, time)
    await page.screenshot({
      path: join(framesDir, `frame-${String(frame).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: opts.quality,
      clip: { x: 0, y: 0, width: opts.width, height: opts.height },
      caret: 'hide'
    })
    reportOutTime(opts.jobId, Math.min(pageDuration, (frame + 1) / opts.fps))
  }

  return { frames, durationSec: frames / opts.fps, stderr: '' }
}

function encodeFrames(opts: HtmlVideoRenderOptions, framesDir: string, out: string, totalSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const ffmpegPath = config.tools.ffmpegPath || 'ffmpeg'
    const args = [
      '-hide_banner', '-y',
      '-f', 'image2',
      '-framerate', String(opts.fps),
      '-i', join(framesDir, 'frame-%05d.jpg'),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', 'frag_keyframe+empty_moov',
      '-f', 'mp4',
      '-progress', 'pipe:1',
      '-nostats',
      'pipe:3'
    ]
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] })
    const ws = createWriteStream(out)
    let stderrTail = ''
    let settled = false
    const timer = setTimeout(() => finish(new Error('encode timed out')), RENDER_TIMEOUT_MS)

    function finish(error: Error | null): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill()
        ws.destroy()
        unlink(out).catch(() => {})
        reject(error)
        return
      }
      stat(out)
        .then((info) => {
          if (!info.isFile() || info.size <= 0) throw new Error('encode produced no output')
          resolve('')
        })
        .catch((err: Error) => {
          unlink(out).catch(() => {})
          reject(err)
        })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        const match = /^(?:out_time_us|out_time_ms)=(\d+)/.exec(line.trim())
        if (match) reportOutTime(opts.jobId, Math.min(totalSec, Number(match[1]) / 1_000_000))
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
  })
}

/**
 * Runs the whole pipeline and settles the job. Never throws: a failure is
 * recorded on the job so the poller can show the real reason.
 */
export async function runHtmlVideoRender(opts: HtmlVideoRenderOptions): Promise<void> {
  const executablePath = resolveChromeExecutable()
  if (!executablePath) {
    failJob(opts.jobId, 'No Chromium browser found. Set TMCUT_CHROME_PATH to chrome.exe or install Chrome/Edge.')
    return
  }

  const framesDir = await mkdtemp(join(tmpdir(), 'tmcut-html-'))
  const out = join(config.uploads.dir, opts.outName)

  try {
    const captured = await withBrowser(executablePath, async (browser) => {
      const context = await browser.newContext({
        viewport: { width: opts.width, height: opts.height },
        deviceScaleFactor: 1,
        // Deterministic locale/timezone: a composition must not change with the
        // machine it renders on.
        locale: 'en-US',
        timezoneId: 'UTC',
        reducedMotion: 'no-preference'
      })
      await context.route('**/*', (route) => {
        const url = route.request().url()
        return isAllowedRenderUrl(url, opts.allowRemote) ? route.continue() : route.abort()
      })
      return captureFrames(context, opts, framesDir)
    })

    await encodeFrames(opts, framesDir, out, captured.durationSec)
    const info = await stat(out)
    if (!info.isFile() || info.size <= 0) throw new Error('render produced no output')
    reportOutTime(opts.jobId, captured.durationSec)
    finishJob(opts.jobId, {
      url: `/uploads/${opts.outName}`,
      size: info.size,
      contentType: 'video/mp4'
    })
  } catch (err) {
    unlink(out).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    failJob(opts.jobId, `HTML video render failed: ${message}`)
  } finally {
    await rm(framesDir, { recursive: true, force: true }).catch(() => {})
  }
}

export function newHtmlVideoOutputName(base: string): string {
  const safe = String(base || 'html-video').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|\s]+/g, '_').trim().slice(0, 60) || 'html-video'
  return `html-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}-${safe}.mp4`
}
