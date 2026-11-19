// Contract tests for the managed CIT engine (electron/tools/cit-engine.cjs).
// No Electron, no network: the downloader, extractor, process spawner and
// health probe are injected so the state machine is exercised in plain Node.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  CIT_SOURCE,
  CIT_UV,
  CIT_ESTIMATED_BYTES,
  CIT_PORT_START,
  CIT_PORT_END,
  enginePaths,
  venvPython,
  checksumMatches,
  progressFrom,
  serverEnv,
  uvEnv,
  isPortInRange,
  createCitEngine
} = require('./cit-engine.cjs')

function tempBase() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cit-engine-test-'))
}

function mockChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.exitCode = null
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {
    child.exitCode = 0
    child.emit('exit', 0)
  }
  return child
}

function mockEngine(overrides = {}) {
  const baseDir = tempBase()
  const startChild = mockChild()
  const engine = createCitEngine({
    baseDir,
    platform: 'win32',
    downloadFile: async (url, destination, onProgress) => {
      onProgress(100, 200)
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, 'zip bytes')
      if (overrides.hash) return overrides.hash
      return url.includes('codeload') ? CIT_SOURCE.sha256 : CIT_UV.sha256
    },
    extractZip: async (zipFile, destination) => {
      fs.mkdirSync(destination, { recursive: true })
      if (zipFile.endsWith('uv.zip')) {
        fs.writeFileSync(path.join(destination, 'uv.exe'), 'MZ')
        return
      }
      const top = path.join(destination, `cit-voice-studio-${CIT_SOURCE.commit.slice(0, 4)}`)
      fs.mkdirSync(path.join(top, 'apps'), { recursive: true })
      fs.writeFileSync(path.join(top, 'apps', 'web_stream.py'), '')
      return
    },
    spawnProcess: (command, args) => {
      if (String(command).replace(/\\/g, '/').endsWith('uv.exe')) {
        fs.mkdirSync(path.join(baseDir, 'cit', 'venv', 'Scripts'), { recursive: true })
        fs.writeFileSync(path.join(baseDir, 'cit', 'venv', 'Scripts', 'python.exe'), '')
        return Promise.resolve('')
      }
      if (Array.isArray(args) && args[0] === '-m') return startChild
      return Promise.resolve('')
    },
    waitForHealth: async () => {},
    ...overrides
  })
  return { engine, baseDir, startChild }
}

test('pinned artifacts are https on the expected hosts with real digests', () => {
  for (const artifact of [CIT_SOURCE, CIT_UV]) {
    assert.equal(new URL(artifact.url).protocol, 'https:')
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/)
    assert.ok(artifact.size > 0)
  }
  assert.equal(new URL(CIT_SOURCE.url).hostname, 'codeload.github.com')
  assert.equal(new URL(CIT_UV.url).hostname, 'github.com')
  assert.match(CIT_SOURCE.commit, /^[a-f0-9]{40}$/)
  assert.ok(CIT_SOURCE.url.includes(CIT_SOURCE.commit), 'source URL must pin the commit')
  assert.ok(CIT_ESTIMATED_BYTES <= 1024 * 1024 * 1024)
})

test('engine paths stay inside the configured base directory', () => {
  const base = path.join(os.tmpdir(), 'engine-base')
  const paths = enginePaths(base)
  for (const key of ['dir', 'src', 'venv', 'pythonDir', 'cache', 'models', 'uv', 'stateFile', 'logFile']) {
    assert.ok(path.resolve(paths[key]).startsWith(path.resolve(base) + path.sep), `${key} escaped the base dir`)
  }
})

test('venv python location is platform-specific', () => {
  const paths = enginePaths(os.tmpdir())
  assert.ok(venvPython(paths, 'win32').endsWith(path.join('Scripts', 'python.exe')))
  assert.ok(venvPython(paths, 'linux').endsWith(path.join('bin', 'python')))
})

test('checksum comparison rejects wrong, short and empty digests', () => {
  const good = 'a'.repeat(64)
  assert.equal(checksumMatches(good, good), true)
  assert.equal(checksumMatches('b'.repeat(64), good), false)
  assert.equal(checksumMatches('a'.repeat(62), good), false)
  assert.equal(checksumMatches('', ''), false)
})

test('progress is clamped and reports null percent without a total', () => {
  assert.deepEqual(progressFrom(50, 200), { received: 50, total: 200, percent: 25 })
  assert.equal(progressFrom(300, 200).percent, 100)
  assert.equal(progressFrom(-5, 200).percent, 0)
  assert.equal(progressFrom(10, 0).percent, null)
})

test('server and uv environments point into the base directory', () => {
  const base = tempBase()
  const paths = enginePaths(base)
  const server = serverEnv(paths, 8003)
  assert.equal(server.PORT, '8003')
  assert.equal(server.HF_HOME, paths.models)
  assert.equal(server.PYTHONUTF8, '1')
  const uv = uvEnv(paths, { PATH: 'x' })
  assert.equal(uv.UV_PROJECT_ENVIRONMENT, paths.venv)
  assert.equal(uv.UV_PYTHON_INSTALL_DIR, paths.pythonDir)
  assert.equal(uv.UV_CACHE_DIR, paths.cache)
  assert.equal(uv.PATH, 'x')
})

test('port guard only accepts the managed range', () => {
  assert.equal(isPortInRange(CIT_PORT_START), true)
  assert.equal(isPortInRange(CIT_PORT_END), true)
  assert.equal(isPortInRange(CIT_PORT_START - 1), false)
  assert.equal(isPortInRange(CIT_PORT_END + 1), false)
  assert.equal(isPortInRange(1.5), false)
})

test('install runs the phases in order and marks the engine installed', async () => {
  const phases = []
  const { engine, baseDir } = mockEngine()
  engine.onProgress(status => phases.push(status.phase))
  const status = await engine.install()
  assert.equal(status.installed, true)
  assert.equal(status.phase, 'installed')
  assert.deepEqual([...new Set(phases)].filter(p => p !== 'installed'), ['downloading', 'packages', 'models'])
  const state = JSON.parse(fs.readFileSync(path.join(baseDir, 'cit', 'engine.json'), 'utf8'))
  assert.equal(state.commit, CIT_SOURCE.commit)
})

test('a checksum mismatch aborts the install with an error phase', async () => {
  const { engine } = mockEngine({ hash: 'f'.repeat(64) })
  await assert.rejects(() => engine.install(), /checksum/)
  assert.equal(engine.status().phase, 'error')
  assert.match(engine.status().error, /checksum/)
})

test('install is refused on non-Windows hosts', async () => {
  const engine = createCitEngine({ baseDir: tempBase(), platform: 'linux' })
  await assert.rejects(() => engine.install(), /Windows only/)
})

test('start refuses an engine that is not installed', async () => {
  const { engine } = mockEngine()
  await assert.rejects(() => engine.start(), /Install the CIT engine first/)
})

test('start reports a loopback origin and stop returns to installed', async () => {
  const { engine } = mockEngine()
  await engine.install()
  const { origin } = await engine.start()
  assert.match(origin, /^http:\/\/127\.0\.0\.1:80(0[1-9]|10)$/)
  assert.equal(engine.status().running, true)
  assert.equal(engine.status().origin, origin)
  await engine.stop()
  assert.equal(engine.status().running, false)
  assert.equal(engine.status().phase, 'installed')
})

test('a failed health probe stops the child and reports an error', async () => {
  const { engine } = mockEngine({
    waitForHealth: async () => {
      throw new Error('no answer')
    }
  })
  await engine.install()
  await assert.rejects(() => engine.start(), /no answer/)
  assert.equal(engine.status().running, false)
  assert.equal(engine.status().phase, 'error')
})

test('dispose kills a running child', async () => {
  const { engine, startChild } = mockEngine()
  await engine.install()
  await engine.start()
  engine.dispose()
  assert.equal(startChild.exitCode, 0)
  assert.equal(engine.status().running, false)
})
