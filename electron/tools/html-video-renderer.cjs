'use strict'

const { BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { getToolsBinaries } = require('./paths.cjs')

const CHANNEL = 'tmcut:renderHtmlVideo'
const PROGRESS_CHANNEL = 'tmcut:htmlVideoProgress'
// ADR-019: one composition is one render contract on every host. These bounds
// and this frame count come from `@tmcut-core` — the same values the Nitro
// endpoint validates against — so a composition the studio accepts cannot be
// refused, or cut to a different number of frames, by only one of the hosts.
// `htmlVideo.mjs` is a leaf module with no imports, which is what lets the main
// process require it directly.
const { HTML_VIDEO_LIMITS: LIMITS, frameCountFor, htmlVideoSeekContract } = require('../../packages/core/src/htmlVideo.mjs')

// Fonts and images must be resident before the first seek, or frame 0 of a
// composition renders without its glyphs.
const READINESS_SCRIPT = 'Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))]).then(()=>Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{}))))'

function validateRenderOptions(options = {}) {
  const width = Number(options.width)
  const height = Number(options.height)
  const fps = Number(options.fps)
  const duration = Number(options.duration)
  const outputPath = typeof options.outputPath === 'string' ? options.outputPath.trim() : ''
  const html = typeof options.html === 'string' ? options.html : ''
  const css = typeof options.css === 'string' ? options.css : ''
  const errors = []

  if (!Number.isSafeInteger(width) || width < LIMITS.minWidth || width > LIMITS.maxWidth || width % 2 !== 0) {
    errors.push(`width-must-be-even-${LIMITS.minWidth}-${LIMITS.maxWidth}`)
  }
  if (!Number.isSafeInteger(height) || height < LIMITS.minHeight || height > LIMITS.maxHeight || height % 2 !== 0) {
    errors.push(`height-must-be-even-${LIMITS.minHeight}-${LIMITS.maxHeight}`)
  }
  if (!Number.isFinite(fps) || fps < LIMITS.minFps || fps > LIMITS.maxFps) {
    errors.push(`fps-must-be-${LIMITS.minFps}-${LIMITS.maxFps}`)
  }
  if (!Number.isFinite(duration) || duration < LIMITS.minDurationSec || duration > LIMITS.maxDurationSec) {
    errors.push(`duration-must-be-${LIMITS.minDurationSec}-${LIMITS.maxDurationSec}`)
  }
  if (Number.isFinite(duration) && Number.isFinite(fps) && frameCountFor(duration, fps) > LIMITS.maxFrames) errors.push('frame-limit-exceeded')
  if (!html.trim()) errors.push('html-required')
  if (Buffer.byteLength(html, 'utf8') + Buffer.byteLength(css, 'utf8') > LIMITS.maxHtmlBytes) errors.push('composition-too-large')
  // ADR-021: this transport deletes every <script>, so a composition whose seek
  // contract lives in a script cannot animate here — it would capture one
  // frame per tick and still report success. Refuse the job instead of lying.
  if (html.trim() && htmlVideoSeekContract(html) === 'script') errors.push('composition-requires-script-seek')
  if (!outputPath || !path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.mp4') errors.push('invalid-output-path')

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: { html, css, width, height, fps, duration, outputPath, jobId: String(options.jobId || '') }
      }
}

/**
 * ADR-021: deleting every `<script>` is what makes this host safe to point at
 * user-authored HTML, and it is also why a composition whose motion lives in a
 * script renders here as one frame repeated. This document's seek contract is
 * `__tmcutSeek` — CSS animations, SVG time, `<video>` time — while the
 * `window.__hf` contract that core's lint and the live Nitro engine use cannot
 * survive sanitization. Every app starter declares `__hf`, so none of them
 * animates on this transport, and `validateRenderOptions` therefore refuses a
 * script-driven composition (`composition-requires-script-seek`) rather than
 * encoding a still and calling it a render.
 */
function sanitizeCompositionHtml(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/?\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*(['"]?)refresh\1[^>]*>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(href|src|action|formaction)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, '')
}

function buildCompositionDocument({ html, css, width, height }) {
  const escapedCss = String(css || '').replace(/<\/style/gi, '<\\/style')
  const source = sanitizeCompositionHtml(html)
  const nonce = randomUUID()
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' data: file: media:; img-src data: blob: file: media:; media-src data: blob: file: media:; font-src data: file: media:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`
  const sizing = `<style>html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden}*,*::before,*::after{box-sizing:border-box}</style>`
  const styles = `<style>${escapedCss}</style>${sizing}`
  const runtime = `<script nonce="${nonce}">window.__tmcutSeek=async function(seconds){var t=Math.max(0,Number(seconds)||0);document.documentElement.dataset.tmcutTime=String(t);for(var a of document.getAnimations()){try{a.pause();a.currentTime=t*1000}catch{}}for(var s of document.querySelectorAll('svg')){try{s.setCurrentTime(t)}catch{}}var videos=Array.from(document.querySelectorAll('video'));for(var v of videos){if(Number.isFinite(v.duration)&&v.duration>0){try{v.currentTime=Math.min(t,Math.max(0,v.duration-0.04))}catch{}}}await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(r)})})};window.addEventListener('message',function(e){if(e.data&&e.data.type==='tmcut:seek')window.__tmcutSeek(e.data.time)})</script>`
  let result = source
  if (/<html\b[^>]*>/i.test(result)) {
    if (/<head\b[^>]*>/i.test(result)) {
      result = result.replace(/<head\b([^>]*)>/i, `<head$1><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${styles}`)
    } else {
      result = result.replace(/<html\b([^>]*)>/i, `<html$1><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${styles}</head>`)
    }
  } else {
    result = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${styles}</head><body>${result}</body></html>`
  }
  return /<\/body\s*>/i.test(result)
    ? result.replace(/<\/body\s*>/i, `${runtime}</body>`)
    : `${result}${runtime}`
}

function ffmpegArgs({ width, height, fps, frameCount, outputPath }) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'image2pipe', '-vcodec', 'png', '-framerate', String(fps), '-i', 'pipe:0',
    '-frames:v', String(frameCount), '-an', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', `scale=${width}:${height},setsar=1`,
    '-movflags', '+faststart', outputPath
  ]
}

function writeFrame(stream, frame) {
  return new Promise((resolve, reject) => {
    if (stream.destroyed || !stream.writable) return reject(new Error('FFmpeg input is not writable'))
    if (stream.write(frame)) return resolve()
    stream.once('drain', resolve)
    stream.once('error', reject)
  })
}

/**
 * One loaded composition, seeked frame by frame (the `TmcutCaptureSession`
 * of ADR-014). The renderer never plays the animation: it asks for a time,
 * screenshots, and asks for the next, so the same document always produces
 * the same frames. What `seek` can reach is only what `__tmcutSeek` drives
 * (see ADR-021 above) — a script-driven composition yields the same frame
 * every time, which is deterministic but not animated. close() releases the
 * window, and a document that fails to load releases it the same way.
 */
async function openCaptureSession({ html, css, width, height }, deps = {}) {
  const BrowserWindowClass = deps.BrowserWindow || BrowserWindow
  let window = null
  try {
    window = new BrowserWindowClass({
      width,
      height,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        offscreen: true
      }
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildCompositionDocument({ html, css, width, height }))}`)
    await window.webContents.executeJavaScript(READINESS_SCRIPT)
    return {
      async seek(atSec) {
        await window.webContents.executeJavaScript(`window.__tmcutSeek(${atSec})`)
      },
      async screenshot() {
        const image = await window.webContents.capturePage({ x: 0, y: 0, width, height })
        return image.toPNG()
      },
      async close() {
        if (!window.isDestroyed()) window.destroy()
      }
    }
  } catch (error) {
    if (window && !window.isDestroyed()) window.destroy()
    throw error
  }
}

/**
 * `TmcutPlatformCapture` for this host (ADR-014): a browser tab cannot
 * screenshot an offscreen document frame-accurately, so only Electron
 * declares the capability, and it declares the same rate bounds the render
 * path validates.
 */
function createElectronPlatformCapture(deps = {}) {
  return {
    open: request => openCaptureSession(request, deps),
    supportsFps: fps => Number.isFinite(fps) && fps >= LIMITS.minFps && fps <= LIMITS.maxFps
  }
}

async function renderHtmlVideo(options, deps = {}) {
  const validation = validateRenderOptions(options)
  if (!validation.ok) return { ok: false, error: validation.errors.join(',') }
  const value = validation.value
  const stat = deps.stat || fs.statSync
  const exists = deps.existsSync || fs.existsSync
  const mkdir = deps.mkdirSync || fs.mkdirSync
  const rename = deps.renameSync || fs.renameSync
  const unlink = deps.unlinkSync || fs.unlinkSync
  const spawnProcess = deps.spawn || spawn
  const binaries = deps.binaries || getToolsBinaries()
  let child = null
  let session = null
  let temporaryPath = ''
  let stderr = ''
  let frameCount = 0
  const totalFrames = frameCountFor(value.duration, value.fps)

  try {
    const outputDir = path.dirname(value.outputPath)
    if (!exists(outputDir)) mkdir(outputDir, { recursive: true })
    temporaryPath = path.join(outputDir, `.${path.basename(value.outputPath, path.extname(value.outputPath))}.${randomUUID()}.tmp.mp4`)

    session = await openCaptureSession(value, deps)

    child = spawnProcess(binaries.ffmpeg, ffmpegArgs({ ...value, frameCount: totalFrames, outputPath: temporaryPath }), {
      windowsHide: true,
      stdio: ['pipe', 'ignore', 'pipe']
    })
    if (!child || !child.stdin || !child.stderr || typeof child.once !== 'function') {
      throw new Error('FFmpeg process could not start')
    }
    child.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-8000)
    })
    const processResult = new Promise((resolve, reject) => {
      child.once('error', reject)
      child.stdin.once('error', reject)
      child.once('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}`))
        }
      })
    })

    for (let index = 0; index < totalFrames; index++) {
      await session.seek(index / value.fps)
      await writeFrame(child.stdin, await session.screenshot())
      frameCount++
      if (value.jobId && deps.sender && !deps.sender.isDestroyed()) {
        deps.sender.send(PROGRESS_CHANNEL, { jobId: value.jobId, frame: frameCount, total: totalFrames })
      }
    }
    child.stdin.end()
    await processResult
    const outputStat = stat(temporaryPath)
    if (!outputStat.isFile() || outputStat.size === 0) throw new Error('FFmpeg produced an empty output')
    rename(temporaryPath, value.outputPath)
    return { ok: true, path: value.outputPath, size: outputStat.size, frames: frameCount }
  } catch (error) {
    if (child && !child.killed && typeof child.kill === 'function') {
      child.kill()
    }
    try {
      if (temporaryPath && exists(temporaryPath)) unlink(temporaryPath)
    } catch { /* Keep the render error primary. */ }
    const message = error && error.message ? error.message : error
    return { ok: false, error: String(message), frames: frameCount }
  } finally {
    if (session) await session.close()
  }
}

/**
 * Registered on every desktop boot and reachable from preload, but no `app/`
 * code calls it (ADR-021): `TmcutHtmlVideoStudio.vue` posts the same job to
 * `/api/v1/media/html-video` on both hosts, so the live HTML-video engine is
 * the Playwright one. This channel stays for CSS-only compositions that need
 * an in-process renderer; anything the studio can actually author is refused by
 * `validateRenderOptions` until `__tmcutSeek` can reach script-driven ones.
 */
function registerHtmlVideoRenderer() {
  ipcMain.handle(CHANNEL, (event, options) => renderHtmlVideo(options, { sender: event.sender }))
}

module.exports = {
  CHANNEL,
  PROGRESS_CHANNEL,
  // Exported for the renderer's own test: the bounds are core's, not a copy.
  LIMITS,
  validateRenderOptions,
  sanitizeCompositionHtml,
  buildCompositionDocument,
  ffmpegArgs,
  openCaptureSession,
  createElectronPlatformCapture,
  renderHtmlVideo,
  registerHtmlVideoRenderer
}
