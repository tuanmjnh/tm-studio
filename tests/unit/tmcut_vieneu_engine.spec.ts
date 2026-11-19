/**
 * Managed VieNeu engine — the installer stays lean, Main fetches it on demand.
 *
 * VieNeu-TTS is Python. It is NOT shipped inside the installer: the Voice
 * Studio panel offers a Download button, Main pulls the pinned source + uv
 * into the app data dir, and the same panel starts/stops the OpenAI-compatible
 * server (`python -m apps.openai_speech`). The renderer can only say
 * "install / start / stop" — it never hands over a URL or a path, so this
 * cannot become an arbitrary downloader or an argv injection point.
 *
 * Pinned here:
 *  * both downloads are https on their expected hosts, pinned by commit and
 *    sha256;
 *  * every path the engine writes stays inside the configured base dir, and
 *    the model cache (HF_HOME) lives in it too;
 *  * the server env pins HOST to loopback and passes our port band through;
 *  * the panel, the preload allow-list and the IPC policy agree on the four
 *    handlers and the shared progress channel;
 *  * the guide describes the download/start/stop flow and the dir override.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
const require = createRequire(import.meta.url)
const {
  VIENEU_SOURCE,
  VIENEU_UV,
  VIENEU_ESTIMATED_BYTES,
  VIENEU_PORT_START,
  VIENEU_PORT_END,
  enginePaths,
  isInstalled,
  serverEnv,
  uvEnv,
  PHASES
} = require('../../electron/tools/vieneu-engine.cjs')
const { PUSH_CHANNELS, isAllowedPushChannel } = require('../../electron/ipcPolicy.cjs')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

check('the source download is pinned by commit and sha256 on codeload', () => {
  const url = new URL(VIENEU_SOURCE.url)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'codeload.github.com')
  assert.match(VIENEU_SOURCE.commit, /^[a-f0-9]{40}$/)
  assert.ok(VIENEU_SOURCE.url.includes(VIENEU_SOURCE.commit), 'URL is not pinned to the commit')
  assert.match(VIENEU_SOURCE.sha256, /^[a-f0-9]{64}$/)
  assert.ok(VIENEU_SOURCE.size > 0)
})

check('the uv download is the same pinned https GitHub release', () => {
  const url = new URL(VIENEU_UV.url)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'github.com')
  assert.ok(VIENEU_UV.url.includes(`/download/${VIENEU_UV.version}/`), 'uv URL is not pinned to its version')
  assert.match(VIENEU_UV.sha256, /^[a-f0-9]{64}$/)
  assert.ok(VIENEU_UV.size > 0)
})

check('the estimate the panel shows stays under two gigabytes', () => {
  assert.ok(VIENEU_ESTIMATED_BYTES <= 2 * 1024 * 1024 * 1024)
  const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
  assert.match(body, /estimatedBytes/, 'the panel never shows the download size')
})

check('every engine path stays inside the configured base directory', () => {
  const base = join(tmpdir(), 'vieneu-engine-spec')
  const paths = enginePaths(base)
  for (const key of Object.keys(paths)) {
    assert.ok(
      resolve(paths[key]).startsWith(resolve(base) + sep),
      `${key} escaped the base dir: ${paths[key]}`
    )
  }
  assert.ok(paths.venv.startsWith(paths.dir) && paths.models.startsWith(paths.dir))
  assert.ok(paths.dir.endsWith(`${sep}vieneu`), 'the VieNeu engine must not share the CIT dir')
})

check('isInstalled needs both the venv python and the headless entry point', () => {
  const base = mkdtempSync(join(tmpdir(), 'vieneu-engine-spec-'))
  try {
    const paths = enginePaths(base)
    assert.equal(isInstalled(paths, 'win32'), false)
    mkdirSync(join(paths.venv, 'Scripts'), { recursive: true })
    writeFileSync(join(paths.venv, 'Scripts', 'python.exe'), '')
    assert.equal(isInstalled(paths, 'win32'), false, 'venv alone must not count as installed')
    mkdirSync(join(paths.src, 'apps'), { recursive: true })
    writeFileSync(join(paths.src, 'apps', 'openai_speech.py'), '')
    assert.equal(isInstalled(paths, 'win32'), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

check('the managed range is a closed loopback port band', () => {
  assert.ok(PHASES.running && PHASES.installed && PHASES.error)
  assert.ok(VIENEU_PORT_START >= 8000 && VIENEU_PORT_END <= 8010)
})

check('the server only ever binds loopback, with the model cache inside the engine dir', () => {
  const paths = enginePaths(join(tmpdir(), 'vieneu-engine-spec'))
  const env = serverEnv(paths, 8003)
  assert.equal(env.HOST, '127.0.0.1')
  assert.equal(env.PORT, '8003')
  assert.equal(env.HF_HOME, paths.models)
  assert.equal(uvEnv(paths, {}).UV_PROJECT_ENVIRONMENT, paths.venv)
})

check('Main installs into the app data dir, env-overridable, never the bundle', () => {
  const controller = read('electron/tools/tmcut.controller.cjs')
  assert.match(controller, /createVieneuEngine\(/, 'the controller never builds the VieNeu engine')
  assert.match(controller, /TMCUT_VIENEU_ENGINE_DIR/, 'no override for the data dir')
  assert.match(controller, /will-quit[\s\S]{0,120}vieneuEngine\.dispose/, 'quitting the app leaves the engine running')
  assert.match(controller, /engineProgress/, 'the VieNeu status never reaches the panel')
})

check('the engine module takes no URL or path from its caller', () => {
  const engine = read('electron/tools/vieneu-engine.cjs')
  // The install path only ever fetches VIENEU_SOURCE.url / VIENEU_UV.url; any
  // other download() call site would mean a caller-supplied URL slipped in.
  const calls = [...engine.matchAll(/await download\(([^,]+),/g)].map(m => m[1]!.trim())
  assert.deepEqual(calls.sort(), ['VIENEU_SOURCE.url', 'VIENEU_UV.url'])
  assert.ok(!/options\.(url|path|command|args)\b/.test(engine), 'the factory accepts caller-supplied locations')
  assert.match(engine, /'apps', 'openai_speech\.py'/, 'installation checks the wrong entry point')
  assert.match(engine, /'apps\.openai_speech'/, 'the server is not the headless OpenAI-compatible app')
})

check('preload offers exactly the four VieNeu engine handlers', () => {
  const preload = read('electron/preload.cjs')
  for (const name of ['vieneuEngineStatus', 'vieneuEngineInstall', 'vieneuEngineStart', 'vieneuEngineStop']) {
    assert.ok(preload.includes(`'${name}'`), `preload cannot invoke ${name}`)
  }
  assert.ok(isAllowedPushChannel('tmcut:engineProgress'), 'push channel is not in the policy')
  assert.ok(PUSH_CHANNELS.includes('tmcut:engineProgress'))
})

check('the panel wires the VieNeu engine for both providers on desktop only', () => {
  const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
  assert.match(body, /isDesktop && \(provider === 'vieneu' \|\| provider === 'cit'\)/, 'the engine panel leaks onto the web build')
  assert.match(body, /vieneuEngineInstall/, 'no VieNeu download wiring')
  assert.match(body, /vieneuEngineStart/, 'no VieNeu start wiring')
  assert.match(body, /vieneuEngineStop/, 'no VieNeu stop wiring')
  assert.match(body, /onEngineProgress/, 'progress pushes are not subscribed')
  assert.match(body, /status\.origin/, 'a started engine never pins the loopback origin')
  assert.match(body, /engineStatuses\.value\[status\.provider\]/, 'progress from the two engines is not keyed by provider')
})

check('both locales and the guide describe the managed flow', () => {
  for (const locale of ['en', 'vi']) {
    const copy = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.voice?.engine
    for (const key of ['title', 'install', 'size', 'installed', 'running', 'stopped', 'start', 'stop', 'failed']) {
      assert.equal(typeof copy?.[key], 'string', `${locale} lacks tmcut.voice.engine.${key}`)
    }
  }
  const guide = read('docs/content/user-guide.md')
  assert.match(guide, /Engine do app quản lý/)
  assert.match(guide, /TMCUT_VIENEU_ENGINE_DIR/)
  assert.match(guide, /sha256/)
})

console.log(`tmcut_vieneu_engine: ${passed} passed`)
