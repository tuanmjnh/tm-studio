import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { validateRenderOptions, sanitizeCompositionHtml, buildCompositionDocument, ffmpegArgs, openCaptureSession, createElectronPlatformCapture, renderHtmlVideo, LIMITS } = require('./html-video-renderer.cjs')

function validOptions(outputPath, extra = {}) {
  return {
    html: '<main class="title">Hello</main>',
    css: '.title { animation: enter 1s both } @keyframes enter { from { opacity: 0 } to { opacity: 1 } }',
    width: 64,
    height: 64,
    fps: 15,
    duration: 1,
    outputPath,
    ...extra
  }
}

test('validation accepts bounded dimensions, rates, duration, and absolute mp4 output', () => {
  const result = validateRenderOptions(validOptions(path.join(tmpdir(), 'composition.mp4')))
  assert.equal(result.ok, true)
  assert.equal(result.value.width, 64)
  assert.equal(result.value.fps, 15)
})

test('validation rejects unsafe or oversized render requests before launching Chromium', () => {
  const base = validOptions(path.join(tmpdir(), 'composition.mp4'))
  for (const overrides of [
    { width: 65 },
    { height: LIMITS.maxHeight + 2 },
    { fps: 120 },
    { duration: LIMITS.maxDurationSec + 1 },
    { html: ' ' },
    { css: 'x'.repeat(2 * 1024 * 1024) },
    { outputPath: '../relative.mp4' },
    { outputPath: path.join(tmpdir(), 'composition.webm') },
    { duration: LIMITS.maxFrames / 15 + 1 }
  ]) {
    assert.equal(validateRenderOptions({ ...base, ...overrides }).ok, false, JSON.stringify(overrides))
  }
})

test('composition document includes CSS, seek hook, nonce CSP, and no external network access', () => {
  const doc = buildCompositionDocument({ html: '<main>frame</main>', css: 'main { color: red }', width: 640, height: 360 })
  assert.match(doc, /main \{ color: red \}/)
  assert.match(doc, /window\.__tmcutSeek/)
  assert.match(doc, /script-src 'nonce-[a-f0-9-]+'/)
  assert.match(doc, /<script nonce="[a-f0-9-]+">/)
  assert.match(doc, /connect-src 'none'/)
  assert.match(doc, /width:640px;height:360px/)
})

test('composition HTML strips scripts, event handlers, refresh redirects, and javascript URLs', () => {
  const sanitized = sanitizeCompositionHtml('<script>alert(1)</script><img src="x" onerror="alert(2)"><meta http-equiv="refresh" content="0;url=https://bad"><a href="javascript:alert(3)">x</a>')
  assert.doesNotMatch(sanitized, /<script|onerror|http-equiv|javascript:/i)
  assert.match(sanitized, /<img src="x">/)
})

test('FFmpeg uses a bounded PNG pipe and deterministic H.264 output dimensions', () => {
  const args = ffmpegArgs({ width: 640, height: 360, fps: 30, frameCount: 90, outputPath: 'video.mp4' })
  assert.ok(args.includes('pipe:0'))
  assert.ok(args.includes('90'))
  assert.ok(args.includes('libx264'))
  assert.ok(args.some(arg => String(arg).includes('scale=640:360,setsar=1')))
  assert.equal(args.at(-1), 'video.mp4')
})

test('renderer captures each seeked frame and cleans up its hidden window after encoding', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tmcut-html-video-'))
  const outputPath = path.join(dir, 'render.mp4')
  const frames = []
  let capturedFrames = 0
  let actualOutputPath = ''
  let seekTimes = []
  let destroyed = false
  const sender = new EventEmitter()
  sender.isDestroyed = () => false
  sender.send = (channel, payload) => sender.emit(channel, payload)
  class FakeWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler: (handler) => { this.openHandler = handler },
        on: (event, handler) => { this.navigationHandler = handler },
        executeJavaScript: async (code) => {
          const match = code.match(/window\.__tmcutSeek\(([^)]+)\)/)
          if (match) seekTimes.push(Number(match[1]))
        },
        capturePage: async () => ({ toPNG: () => Buffer.from(`frame-${capturedFrames++}`) })
      }
    }

    async loadURL(url) { this.url = url }
    isDestroyed() { return destroyed }
    destroy() { destroyed = true }
  }
  const spawn = (_binary, commandArgs) => {
    actualOutputPath = commandArgs.at(-1)
    const proc = new EventEmitter()
    proc.killed = false
    proc.stderr = new EventEmitter()
    proc.stdin = new EventEmitter()
    proc.stdin.writable = true
    proc.stdin.destroyed = false
    proc.stdin.write = (chunk) => {
      frames.push(chunk)
      return true
    }
    proc.stdin.end = () => setImmediate(() => {
      writeFileSync(actualOutputPath, Buffer.from('mp4'))
      proc.emit('close', 0)
    })
    proc.kill = () => {
      proc.killed = true
    }
    return proc
  }
  const events = []
  sender.on('tmcut:htmlVideoProgress', data => events.push(data))

  try {
    const result = await renderHtmlVideo(validOptions(outputPath, { width: 64, height: 64, fps: 15, duration: 1, jobId: 'job-1' }), {
      BrowserWindow: FakeWindow,
      spawn,
      binaries: { ffmpeg: 'ffmpeg-test' },
      sender
    })
    assert.equal(result.ok, true, result.error)
    assert.equal(result.frames, 15)
    assert.equal(frames.length, 15)
    assert.equal(seekTimes.length, 15)
    assert.equal(seekTimes[0], 0)
    assert.ok(Math.abs(seekTimes.at(-1) - 14 / 15) < 0.0001)
    assert.equal(destroyed, true)
    assert.notEqual(actualOutputPath, outputPath)
    assert.equal(result.path, outputPath)
    assert.equal(statSync(outputPath).size, 3)
    assert.deepEqual(events.map((_, index) => index + 1), Array.from({ length: 15 }, (_, index) => index + 1))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed FFmpeg render preserves pre-existing destination and removes temporary output', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tmcut-html-video-fail-'))
  const outputPath = path.join(dir, 'render.mp4')
  writeFileSync(outputPath, Buffer.from('previous'))
  let actualOutputPath = ''
  let destroyed = false
  class FakeWindow {
    constructor() {
      this.webContents = {
        setWindowOpenHandler: () => {},
        on: () => {},
        executeJavaScript: async () => {},
        capturePage: async () => ({ toPNG: () => Buffer.from('frame') })
      }
    }

    async loadURL() {}
    isDestroyed() { return destroyed }
    destroy() { destroyed = true }
  }
  const spawn = (_binary, commandArgs) => {
    actualOutputPath = commandArgs.at(-1)
    const proc = new EventEmitter()
    proc.killed = false
    proc.stderr = new EventEmitter()
    proc.stdin = new EventEmitter()
    proc.stdin.writable = true
    proc.stdin.destroyed = false
    proc.stdin.write = () => true
    proc.stdin.end = () => setImmediate(() => {
      proc.stderr.emit('data', Buffer.from('intentional encode failure'))
      proc.emit('close', 1)
    })
    proc.kill = () => {
      proc.killed = true
    }
    return proc
  }
  try {
    const result = await renderHtmlVideo(validOptions(outputPath, { width: 64, height: 64, fps: 15, duration: 1 }), {
      BrowserWindow: FakeWindow,
      spawn,
      binaries: { ffmpeg: 'ffmpeg-test' }
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /intentional encode failure/)
    assert.equal(readFileSync(outputPath, 'utf8'), 'previous')
    assert.equal(statSync(dir).isDirectory(), true)
    assert.equal(existsSync(actualOutputPath), false)
    assert.equal(destroyed, true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

class FakeCompositionWindow {
  constructor(options) {
    FakeCompositionWindow.last = this
    this.options = options
    this.destroyed = false
    this.executed = []
    this.seekTimes = []
    this.listeners = {}
    this.webContents = {
      setWindowOpenHandler: (handler) => { this.openHandler = handler },
      on: (event, handler) => { this.listeners[event] = handler },
      executeJavaScript: async (code) => {
        this.executed.push(code)
        const seek = /window\.__tmcutSeek\(([^)]+)\)/.exec(code)
        if (seek) this.seekTimes.push(Number(seek[1]))
      },
      capturePage: async (rect) => {
        this.lastRect = rect
        return { toPNG: () => Buffer.from('png-frame') }
      }
    }
  }

  async loadURL(url) { this.url = url }
  isDestroyed() { return this.destroyed }
  destroy() { this.destroyed = true }
}

function sessionDeps() {
  FakeCompositionWindow.last = null
  return { BrowserWindow: FakeCompositionWindow }
}

const COMPOSITION = { html: '<main class="t">frame</main>', css: '.t { color: red }', width: 320, height: 180 }

test('capture session loads an isolated offscreen document and settles fonts before the first frame', async () => {
  const session = await openCaptureSession(COMPOSITION, sessionDeps())
  const window = FakeCompositionWindow.last
  assert.equal(window.options.show, false)
  assert.deepEqual(window.options.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    offscreen: true
  })
  assert.match(window.url, /^data:text\/html/)
  const document = decodeURIComponent(window.url.replace('data:text/html;charset=utf-8,', ''))
  assert.match(document, /window\.__tmcutSeek/)
  assert.match(document, /connect-src 'none'/)
  assert.match(document, /\.t \{ color: red \}/)
  assert.deepEqual(window.openHandler({}), { action: 'deny' })
  let prevented = false
  function preventDefault() {
    prevented = true
  }
  window.listeners['will-navigate']({ preventDefault })
  assert.equal(prevented, true)
  // Readiness runs before any seek, so frame 0 never renders without glyphs.
  assert.match(window.executed[0], /document\.fonts\.ready/)
  assert.equal(window.seekTimes.length, 0)
  await session.close()
})

test('capture session seeks on request, screenshots the composed rect, and releases the window once', async () => {
  const session = await openCaptureSession(COMPOSITION, sessionDeps())
  const window = FakeCompositionWindow.last
  assert.deepEqual(Object.keys(session).sort(), ['close', 'screenshot', 'seek'])
  await session.seek(0)
  await session.seek(2.5)
  assert.deepEqual(window.seekTimes, [0, 2.5])
  const frame = await session.screenshot()
  assert.equal(Buffer.isBuffer(frame), true)
  assert.equal(frame.toString(), 'png-frame')
  assert.deepEqual(window.lastRect, { x: 0, y: 0, width: 320, height: 180 })
  await session.close()
  assert.equal(window.destroyed, true)
  await session.close()
})

test('capture session destroys its window when the composition fails to load', async () => {
  class ExplodingWindow extends FakeCompositionWindow {
    async loadURL() { throw new Error('render-process-gone') }
  }
  FakeCompositionWindow.last = null
  await assert.rejects(
    openCaptureSession(COMPOSITION, { BrowserWindow: ExplodingWindow }),
    /render-process-gone/
  )
  assert.equal(ExplodingWindow.last.destroyed, true)
})

test('electron capture host answers the platform contract for the rates it can shoot', async () => {
  const capture = createElectronPlatformCapture(sessionDeps())
  for (const fps of [61, 0, -1, Number.NaN, null, '30']) assert.equal(capture.supportsFps(fps), false, String(fps))
  for (const fps of [1, 10, 14, 15, 15.5, 29.97, 30, 60]) assert.equal(capture.supportsFps(fps), true, String(fps))
  const session = await capture.open({ ...COMPOSITION, fps: 30 })
  assert.equal(typeof session.seek, 'function')
  await session.close()
})

// ADR-019: the desktop host used to reject rates the web host accepted, so the
// same composition produced a video in one runtime and an error in the other.
test('desktop bounds are the core render contract, not a second copy', async () => {
  const { HTML_VIDEO_LIMITS, frameCountFor } = await import('../../packages/core/src/htmlVideo.mjs')
  assert.deepEqual(LIMITS, HTML_VIDEO_LIMITS, 'main process must read core limits')

  const base = validOptions(path.join(tmpdir(), 'composition.mp4'))
  // Rates and durations the studio can author and Nitro accepts: the desktop
  // validator has to take them too, whole or fractional.
  for (const overrides of [{ fps: 1 }, { fps: 10 }, { fps: 14 }, { fps: 29.97 }, { duration: HTML_VIDEO_LIMITS.minDurationSec }, { height: 2160 }]) {
    const result = validateRenderOptions({ ...base, ...overrides })
    assert.equal(result.ok, true, `${JSON.stringify(overrides)} -> ${JSON.stringify(result.errors)}`)
  }
  // And the same frame ceiling: every bound is legal on its own, the product
  // is not — which is exactly how the web host reports it too.
  assert.equal(validateRenderOptions({ ...base, fps: HTML_VIDEO_LIMITS.maxFps, duration: HTML_VIDEO_LIMITS.maxDurationSec }).ok, false)
  assert.equal(validateRenderOptions({ ...base, css: 'x'.repeat(HTML_VIDEO_LIMITS.maxHtmlBytes) }).ok, false)
  assert.equal(frameCountFor(base.duration, base.fps), Math.round(base.duration * base.fps), 'frame math is core frame math')
})

// ADR-021: the two HTML-video transports are not equivalent, and this is the
// pin that says so. Measured on this machine (real Chrome, one real starter —
// `stat-counter`, 540x960 @10fps, 1s = 10 frames):
//   live engine (server/utils/htmlVideoRender.ts, playwright-core):
//     10/10 distinct frame hashes, and two fresh browser contexts produced the
//     identical 10 hashes — deterministic, and the frames really move.
//   desktop document (`buildCompositionDocument` + `__tmcutSeek`, screenshotted
//     through Chrome because Electron cannot be launched from this shell):
//     the built document is 3577 bytes and holds __tmcutSeek but no __hf,
//     because sanitizeCompositionHtml deletes every <script>. The 10 captures
//     collapsed to one repeated hash (7aed8e5bf3bf) — a still image, encoded
//     as video. Nothing errored: the render "succeeded" 10 times over.
// So a JS-driven composition — every starter in
// app/utils/tmcut/htmlVideoStarters.ts, which is the whole authoring surface —
// is refused by `validateRenderOptions` before anything launches. The module is
// kept because the CSS-only half of the contract genuinely works here; these
// assertions are what separates the two halves.
const JS_DRIVEN_COMPOSITION = `<div data-composition-id="counter">
<script>
window.__hf = {
  duration: 1,
  seek: function (t) { document.querySelector('.n').textContent = String(Math.round(t * 100)) }
}
</script>
<p class="n">0</p>
</div>`

test('a JS-driven composition passes the core seek lint but loses that contract in the desktop document', async () => {
  const { lintHtmlVideo } = await import('../../packages/core/src/htmlVideo.mjs')

  const findings = lintHtmlVideo(JS_DRIVEN_COMPOSITION)
  assert.equal(findings.some(f => f.code === 'missing-seek-contract'), false, 'the author did declare __hf')

  const doc = buildCompositionDocument({ html: JS_DRIVEN_COMPOSITION, css: '', width: 540, height: 960 })
  assert.match(doc, /window\.__tmcutSeek/, 'the host injects its own seek hook')
  assert.doesNotMatch(doc, /__hf/, 'and the composition script that would answer it is gone')
  assert.doesNotMatch(doc, /textContent/, 'including the body of the composition seek')
  assert.match(sanitizeCompositionHtml(JS_DRIVEN_COMPOSITION), /<p class="n">0<\/p>/, 'markup survives')
  assert.doesNotMatch(sanitizeCompositionHtml(JS_DRIVEN_COMPOSITION), /__hf|<script/i)
})

test('the desktop seek hook drives CSS/SVG/video time only — which is all it can drive', () => {
  const doc = buildCompositionDocument({ html: '<main>frame</main>', css: 'main { animation: e 1s both }', width: 320, height: 180 })
  const seek = /window\.__tmcutSeek[\s\S]*?<\/script>/i.exec(doc)?.[0] ?? ''
  assert.ok(seek.length > 0, 'the runtime is inlined before </body>')
  for (const driven of ['document.getAnimations()', 'setCurrentTime(t)', 'querySelectorAll(\'video\')']) {
    assert.ok(seek.includes(driven), `seeks ${driven}`)
  }
  // Those are the only channels this transport can push a frame time through.
  // There is no fourth one, so a script-driven composition has no way to
  // receive a seek on this host.
  assert.doesNotMatch(seek, /__hf|hf-seek|postMessage/)
})

// The refusal is the point: before it, this transport answered a script-driven
// composition with a still image and a success result.
test('desktop validation refuses a composition it cannot seek instead of rendering a still', () => {
  const base = validOptions(path.join(tmpdir(), 'composition.mp4'))
  const refused = validateRenderOptions({ ...base, html: JS_DRIVEN_COMPOSITION })
  assert.equal(refused.ok, false)
  assert.deepEqual(refused.errors, ['composition-requires-script-seek'])

  // Motion that lives in CSS/SVG/video time is exactly what this host can
  // drive, so it stays accepted — the rule is about the seek contract, not
  // about scripts appearing anywhere in a document.
  assert.equal(validateRenderOptions({ ...base, html: '<main class="title">Hello</main>' }).ok, true)
  assert.equal(validateRenderOptions({ ...base, html: '<svg data-composition-id="s"><script>0</script></svg>' }).ok, true)
  // A composition that declares only the event contract is refused too, since
  // the listener is stripped with the script that registers it.
  assert.equal(validateRenderOptions({ ...base, html: '<div data-composition-id="d"><script>addEventListener(\'hf-seek\', () => {})</script></div>' }).ok, false)
})

test('the refusal happens before any window or FFmpeg process exists', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tmcut-html-video-refuse-'))
  let windows = 0
  let spawns = 0
  class CountingWindow extends FakeCompositionWindow {
    constructor(options) {
      super(options)
      windows += 1
    }
  }
  try {
    const result = await renderHtmlVideo(validOptions(path.join(dir, 'render.mp4'), { html: JS_DRIVEN_COMPOSITION }), {
      BrowserWindow: CountingWindow,
      spawn: () => {
        spawns += 1
        throw new Error('must not spawn')
      },
      binaries: { ffmpeg: 'ffmpeg-test' }
    })
    assert.equal(result.ok, false)
    assert.equal(result.error, 'composition-requires-script-seek')
    assert.deepEqual([windows, spawns], [0, 0], 'refused before launching anything')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
