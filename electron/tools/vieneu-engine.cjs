'use strict'
// Managed VieNeu-TTS engine (headless OpenAI-compatible server on loopback).
//
// Like the CIT engine, the installer ships without it: the user downloads it
// into the app's data directory from the Voice Studio panel, and Main owns its
// lifecycle (install, start, stop, quit). Everything the downloader touches is
// pinned here by commit + sha256 — the renderer can only ask "install/start/
// stop", never hand over a URL or a path, so this cannot become an arbitrary
// downloader or an argv injection point.
//
// The engine is Python: `uv sync --frozen` builds the torch-free ONNX venv,
// the model files land in HF_HOME under the engine dir (so a reinstall does
// not re-download them elsewhere), and the server runs as
// `python -m apps.openai_speech` — the GUI-free OpenAI-compatible API on
// /health, /v1/voices and /v1/audio/speech.
const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const net = require('net')
const https = require('https')
const crypto = require('crypto')
const { spawn, spawnSync } = require('child_process')

const VIENEU_SOURCE = Object.freeze({
  repo: 'pnnbao97/VieNeu-TTS',
  commit: '512de867d49b883d50cc47989c445d070f62362f',
  url: 'https://codeload.github.com/pnnbao97/VieNeu-TTS/zip/512de867d49b883d50cc47989c445d070f62362f',
  sha256: '4610a0190b3c132a78b18fe637e4bf18943950819e899d8d190941efaf3113c7',
  size: 3117785
})

const VIENEU_UV = Object.freeze({
  version: '0.13.7',
  url: 'https://github.com/astral-sh/uv/releases/download/0.13.7/uv-x86_64-pc-windows-msvc.zip',
  sha256: '0cdc5b38fe5a8168ed6a25814f5ba43c21d313dd3187314fccb37b7cec46e021',
  size: 15236317
})

// Source + uv + torch-free venv (onnxruntime, gradio, librosa) + the v3 Turbo
// ONNX backbone/codec files. Shown before the download starts.
const VIENEU_ESTIMATED_BYTES = 1500 * 1024 * 1024
const VIENEU_PORT_START = 8000
const VIENEU_PORT_END = 8010
const VIENEU_HEALTH_TIMEOUT_MS = 240_000
const INSTALL_TIMEOUT_MS = 30 * 60_000

const PHASES = Object.freeze({
  idle: 'idle',
  downloading: 'downloading',
  packages: 'packages',
  models: 'models',
  installed: 'installed',
  starting: 'starting',
  running: 'running',
  stopping: 'stopping',
  stopped: 'stopped',
  error: 'error'
})

function enginePaths(baseDir) {
  const dir = path.join(path.resolve(baseDir), 'vieneu')
  return {
    dir,
    src: path.join(dir, 'src'),
    venv: path.join(dir, 'venv'),
    pythonDir: path.join(dir, 'python'),
    cache: path.join(dir, 'cache'),
    models: path.join(dir, 'models'),
    uv: path.join(dir, 'uv.exe'),
    stateFile: path.join(dir, 'engine.json'),
    logFile: path.join(dir, 'engine.log')
  }
}

function venvPython(paths, platform = process.platform) {
  return platform === 'win32'
    ? path.join(paths.venv, 'Scripts', 'python.exe')
    : path.join(paths.venv, 'bin', 'python')
}

function checksumMatches(actualHex, expectedHex) {
  const actual = Buffer.from(String(actualHex || ''), 'hex')
  const expected = Buffer.from(String(expectedHex || ''), 'hex')
  return actual.length > 0 && actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function progressFrom(received, total) {
  const size = Number(total) || 0
  const done = Number(received) || 0
  return {
    received: done,
    total: size,
    percent: size > 0 ? Math.max(0, Math.min(100, Math.round((done / size) * 100))) : null
  }
}

function serverEnv(paths, port) {
  return {
    HOST: '127.0.0.1',
    PORT: String(port),
    HF_HOME: paths.models,
    VIENEU_BACKEND: 'onnx',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUNBUFFERED: '1',
    HF_HUB_DISABLE_SYMLINKS_WARNING: '1'
  }
}

function uvEnv(paths, baseEnv = process.env) {
  return {
    ...baseEnv,
    UV_PROJECT_ENVIRONMENT: paths.venv,
    UV_PYTHON_INSTALL_DIR: paths.pythonDir,
    UV_CACHE_DIR: paths.cache,
    UV_NO_PROGRESS: '1'
  }
}

function isPortInRange(port) {
  return Number.isInteger(port) && port >= VIENEU_PORT_START && port <= VIENEU_PORT_END
}

function isInstalled(paths, platform = process.platform) {
  return fs.existsSync(venvPython(paths, platform)) && fs.existsSync(path.join(paths.src, 'apps', 'openai_speech.py'))
}

function readState(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'))
  } catch {
    return null
  }
}

function createVieneuEngine(options = {}) {
  const platform = options.platform || process.platform
  const paths = enginePaths(options.baseDir)

  const state = {
    phase: PHASES.idle,
    error: '',
    origin: '',
    progress: null,
    task: null,
    child: null,
    port: null,
    logTail: ''
  }
  const listeners = new Set()

  function emit(patch) {
    Object.assign(state, patch)
    const snapshot = publicStatus()
    for (const listener of listeners) {
      try {
        listener(snapshot)
      } catch {
        // A dead window must not break the install.
      }
    }
  }

  function publicStatus() {
    return {
      provider: 'vieneu',
      platform,
      dir: paths.dir,
      installed: isInstalled(paths, platform),
      phase: state.phase,
      origin: state.origin,
      error: state.error,
      progress: state.progress,
      running: Boolean(state.child),
      estimatedBytes: VIENEU_ESTIMATED_BYTES,
      commit: VIENEU_SOURCE.commit
    }
  }

  function onProgress(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function download(url, destination, onProgress) {
    if (options.downloadFile) return options.downloadFile(url, destination, onProgress)
    return new Promise((resolve, reject) => {
      const request = (target, hops) => {
        https.get(target, { headers: { 'user-agent': 'tm-studio' } }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            response.resume()
            if (hops <= 0) return reject(new Error('Too many redirects while downloading the VieNeu engine'))
            return request(new URL(response.headers.location, target).toString(), hops - 1)
          }
          if (response.statusCode !== 200) {
            response.resume()
            return reject(new Error(`Download failed with HTTP ${response.statusCode}`))
          }
          const total = Number(response.headers['content-length']) || 0
          const out = fs.createWriteStream(destination)
          const hash = crypto.createHash('sha256')
          let received = 0
          response.on('data', (chunk) => {
            received += chunk.length
            hash.update(chunk)
            out.write(chunk)
            onProgress(received, total)
          })
          response.on('error', reject)
          out.on('error', reject)
          out.on('finish', () => resolve(hash.digest('hex')))
          response.on('end', () => out.end())
        }).on('error', reject)
      }
      request(url, 5)
    })
  }

  async function extractZip(zipFile, destination) {
    if (options.extractZip) return options.extractZip(zipFile, destination)
    await fsp.mkdir(destination, { recursive: true })
    const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const result = spawnSync(tarExe, ['-xf', zipFile, '-C', destination], { windowsHide: true })
    if (result.error) throw new Error(`Cannot extract the VieNeu engine archive: ${result.error.message}`)
    if (result.status !== 0) throw new Error('Cannot extract the VieNeu engine archive')
  }

  function run(command, args, step) {
    if (options.spawnProcess) return options.spawnProcess(command, args, step)
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: step.cwd,
        env: step.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let output = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`${step.label || 'The engine step'} timed out`))
      }, step.timeoutMs || INSTALL_TIMEOUT_MS)
      const collect = (chunk) => {
        output = (output + chunk.toString()).slice(-8000)
      }
      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve(output)
        else reject(new Error(`${step.label || 'The engine step'} failed${output ? `: ${output.trim().split('\n').slice(-3).join(' ')}` : ''}`))
      })
    })
  }

  async function install() {
    if (state.task) return publicStatus()
    if (platform !== 'win32') {
      throw new Error('The managed VieNeu engine currently installs on Windows only')
    }
    if (isInstalled(paths, platform)) {
      emit({ phase: PHASES.installed, error: '' })
      return publicStatus()
    }

    state.task = (async () => {
      emit({ phase: PHASES.downloading, error: '', progress: null })
      await fsp.mkdir(paths.dir, { recursive: true })
      const tmp = path.join(paths.dir, 'tmp')
      await fsp.rm(tmp, { recursive: true, force: true })
      await fsp.mkdir(tmp, { recursive: true })

      emit({ phase: PHASES.downloading, progress: progressFrom(0, VIENEU_UV.size + VIENEU_SOURCE.size) })
      const downloaded = { bytes: 0 }
      const track = (received) => {
        emit({ phase: PHASES.downloading, progress: progressFrom(downloaded.bytes + received, VIENEU_UV.size + VIENEU_SOURCE.size) })
      }
      const uvZip = path.join(tmp, 'uv.zip')
      const uvHash = await download(VIENEU_UV.url, uvZip, received => track(received))
      downloaded.bytes += VIENEU_UV.size
      if (!checksumMatches(uvHash, VIENEU_UV.sha256)) throw new Error('The uv download did not match its pinned checksum')
      const uvOut = path.join(tmp, 'uv')
      await extractZip(uvZip, uvOut)
      await fsp.copyFile(path.join(uvOut, 'uv.exe'), paths.uv)

      const srcZip = path.join(tmp, 'source.zip')
      const srcHash = await download(VIENEU_SOURCE.url, srcZip, received => track(received))
      downloaded.bytes += VIENEU_SOURCE.size
      if (!checksumMatches(srcHash, VIENEU_SOURCE.sha256)) throw new Error('The VieNeu source download did not match its pinned checksum')
      const srcOut = path.join(tmp, 'source')
      await extractZip(srcZip, srcOut)
      const extracted = (await fsp.readdir(srcOut)).find(name => name.startsWith('VieNeu-TTS-'))
      if (!extracted) throw new Error('The VieNeu source archive had an unexpected layout')
      await fsp.rm(paths.src, { recursive: true, force: true })
      await fsp.rename(path.join(srcOut, extracted), paths.src)

      emit({ phase: PHASES.packages, progress: null })
      await run(paths.uv, ['sync', '--frozen', '--no-progress'], {
        cwd: paths.src,
        env: uvEnv(paths),
        label: 'Installing VieNeu Python packages'
      })

      emit({ phase: PHASES.models, progress: null })
      const python = venvPython(paths, platform)
      await run(python, ['-c', 'from vieneu import Vieneu; Vieneu(mode="v3turbo"); print("models ready")'], {
        cwd: paths.src,
        env: { ...process.env, ...serverEnv(paths, VIENEU_PORT_START) },
        label: 'Downloading VieNeu models'
      })

      await fsp.writeFile(paths.stateFile, JSON.stringify({
        commit: VIENEU_SOURCE.commit,
        uvVersion: VIENEU_UV.version,
        installedAt: new Date().toISOString()
      }, null, 2))
      await fsp.rm(tmp, { recursive: true, force: true })
      emit({ phase: PHASES.installed, progress: null, error: '' })
    })()

    try {
      await state.task
    } catch (error) {
      emit({ phase: PHASES.error, error: String(error && error.message ? error.message : error), progress: null })
      throw error
    } finally {
      state.task = null
    }
    return publicStatus()
  }

  function freePort() {
    const probe = port => new Promise((resolve) => {
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.once('listening', () => server.close(() => resolve(true)))
      server.listen(port, '127.0.0.1')
    })
    return (async () => {
      for (let port = VIENEU_PORT_START; port <= VIENEU_PORT_END; port++) {
        if (await probe(port)) return port
      }
      throw new Error(`No free loopback port in ${VIENEU_PORT_START}-${VIENEU_PORT_END} for the VieNeu engine`)
    })()
  }

  async function waitForHealth(origin) {
    if (options.waitForHealth) return options.waitForHealth(origin)
    const deadline = Date.now() + VIENEU_HEALTH_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (!state.child) throw new Error('The VieNeu engine stopped while starting')
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) })
        if (response.ok) return
      } catch {
        // Not up yet.
      }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    throw new Error('The VieNeu engine did not answer on its health endpoint in time')
  }

  async function start() {
    if (state.child) return { origin: state.origin }
    if (!isInstalled(paths, platform)) throw new Error('Install the VieNeu engine first')
    emit({ phase: PHASES.starting, error: '', origin: '' })
    const port = await freePort()
    const origin = `http://127.0.0.1:${port}`
    const python = venvPython(paths, platform)
    const args = ['-m', 'apps.openai_speech']
    const spawnImpl = options.spawnProcess

    const child = spawnImpl
      ? spawnImpl(python, args, { cwd: paths.src, env: serverEnv(paths, port) })
      : spawn(python, args, {
          cwd: paths.src,
          env: { ...process.env, ...serverEnv(paths, port) },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
    state.child = child
    state.port = port
    emit({ origin })
    if (!spawnImpl) {
      const log = fs.createWriteStream(paths.logFile, { flags: 'a' })
      const collector = (chunk) => {
        log.write(chunk)
        state.logTail = (state.logTail + String(chunk)).slice(-4000)
      }
      child.stdout?.on('data', collector)
      child.stderr?.on('data', collector)
    }
    child.once('exit', (code) => {
      if (state.child !== child) return
      const wasRunning = state.phase === PHASES.running
      state.child = null
      state.port = null
      state.origin = ''
      if (state.phase !== PHASES.stopping) {
        emit({ phase: PHASES.stopped, error: wasRunning && code ? `VieNeu engine exited with code ${code}` : '' })
      }
    })

    try {
      await waitForHealth(origin)
    } catch (error) {
      await stop()
      emit({ phase: PHASES.error, error: `${error.message}${state.logTail ? ` — ${state.logTail.trim().split('\n').slice(-2).join(' ')}` : ''}` })
      throw error
    }
    emit({ phase: PHASES.running, origin, error: '' })
    return { origin }
  }

  async function stop() {
    const child = state.child
    if (!child) {
      emit({ phase: isInstalled(paths, platform) ? PHASES.installed : PHASES.idle, origin: '' })
      return
    }
    emit({ phase: PHASES.stopping })
    await new Promise((resolve) => {
      let force = null
      let deadline = null
      const done = () => {
        if (force) clearTimeout(force)
        if (deadline) clearTimeout(deadline)
        resolve()
      }
      child.once('exit', done)
      // Graceful first; the tree kill is the safety net for a wedged uvicorn,
      // and it only runs if the child is genuinely still alive by then.
      child.kill('SIGTERM')
      if (platform === 'win32' && child.pid) {
        force = setTimeout(() => {
          if (child.exitCode !== null) return
          try {
            spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
          } catch {
            // Already gone.
          }
        }, 3000)
        force.unref?.()
      }
      deadline = setTimeout(done, 10_000)
    })
    state.child = null
    state.port = null
    state.origin = ''
    emit({ phase: PHASES.installed, origin: '', progress: null })
  }

  function dispose() {
    const child = state.child
    if (!child) return
    child.kill('SIGKILL')
    if (platform === 'win32' && child.pid && child.exitCode === null) {
      try {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } catch {
        // Already gone.
      }
    }
    state.child = null
  }

  return {
    status: () => publicStatus(),
    install,
    start,
    stop,
    dispose,
    onProgress,
    paths
  }
}

module.exports = {
  VIENEU_SOURCE,
  VIENEU_UV,
  VIENEU_ESTIMATED_BYTES,
  VIENEU_PORT_START,
  VIENEU_PORT_END,
  PHASES,
  enginePaths,
  venvPython,
  checksumMatches,
  progressFrom,
  serverEnv,
  uvEnv,
  isPortInRange,
  isInstalled,
  readState,
  createVieneuEngine
}
