'use strict'

const { BrowserWindow, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { getToolsBinaries } = require('./paths.cjs')

const CHANNEL = 'tmcut:renderHtmlVideo'
const PROGRESS_CHANNEL = 'tmcut:htmlVideoProgress'
const MAX_HTML_BYTES = 2 * 1024 * 1024
const MAX_FRAMES = 1800

function validateRenderOptions(options = {}) {
  const width = Number(options.width)
  const height = Number(options.height)
  const fps = Number(options.fps)
  const duration = Number(options.duration)
  const outputPath = typeof options.outputPath === 'string' ? options.outputPath.trim() : ''
  const html = typeof options.html === 'string' ? options.html : ''
  const css = typeof options.css === 'string' ? options.css : ''
  const errors = []

  if (!Number.isSafeInteger(width) || width < 64 || width > 3840 || width % 2 !== 0) errors.push('width-must-be-even-64-3840')
  if (!Number.isSafeInteger(height) || height < 64 || height > 2160 || height % 2 !== 0) errors.push('height-must-be-even-64-2160')
  if (!Number.isInteger(fps) || fps < 15 || fps > 60) errors.push('fps-must-be-15-60')
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) errors.push('duration-must-be-1-120')
  if (Number.isFinite(duration) && Number.isInteger(fps) && duration * fps > MAX_FRAMES) errors.push('frame-limit-exceeded')
  if (!html.trim()) errors.push('html-required')
  if (Buffer.byteLength(html, 'utf8') + Buffer.byteLength(css, 'utf8') > MAX_HTML_BYTES) errors.push('composition-too-large')
  if (!outputPath || !path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.mp4') errors.push('invalid-output-path')

  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: { html, css, width, height, fps, duration, outputPath, jobId: String(options.jobId || '') }
      }
}

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

async function renderHtmlVideo(options, deps = {}) {
  const validation = validateRenderOptions(options)
  if (!validation.ok) return { ok: false, error: validation.errors.join(',') }
  const value = validation.value
  const stat = deps.stat || fs.statSync
  const exists = deps.existsSync || fs.existsSync
  const mkdir = deps.mkdirSync || fs.mkdirSync
  const rename = deps.renameSync || fs.renameSync
  const unlink = deps.unlinkSync || fs.unlinkSync
  const BrowserWindowClass = deps.BrowserWindow || BrowserWindow
  const spawnProcess = deps.spawn || spawn
  const binaries = deps.binaries || getToolsBinaries()
  let child = null
  let window = null
  let temporaryPath = ''
  let stderr = ''
  let frameCount = 0
  const totalFrames = Math.round(value.duration * value.fps)

  try {
    const outputDir = path.dirname(value.outputPath)
    if (!exists(outputDir)) mkdir(outputDir, { recursive: true })
    temporaryPath = path.join(outputDir, `.${path.basename(value.outputPath, path.extname(value.outputPath))}.${randomUUID()}.tmp.mp4`)

    window = new BrowserWindowClass({
      width: value.width,
      height: value.height,
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
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildCompositionDocument(value))}`)
    await window.webContents.executeJavaScript('Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,5000))]).then(()=>Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{}))))')

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
      const at = index / value.fps
      await window.webContents.executeJavaScript(`window.__tmcutSeek(${at})`)
      const image = await window.webContents.capturePage({ x: 0, y: 0, width: value.width, height: value.height })
      await writeFrame(child.stdin, image.toPNG())
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
    if (window && !window.isDestroyed()) window.destroy()
  }
}

function registerHtmlVideoRenderer() {
  ipcMain.handle(CHANNEL, (event, options) => renderHtmlVideo(options, { sender: event.sender }))
}

module.exports = {
  CHANNEL,
  PROGRESS_CHANNEL,
  MAX_HTML_BYTES,
  MAX_FRAMES,
  validateRenderOptions,
  sanitizeCompositionHtml,
  buildCompositionDocument,
  ffmpegArgs,
  renderHtmlVideo,
  registerHtmlVideoRenderer
}
