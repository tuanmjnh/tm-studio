/**
 * Managed CIT engine — the installer stays lean, Main fetches it on demand.
 *
 * The CIT Voice Studio engine is Python. It is NOT shipped inside the
 * installer: the Voice Studio panel offers a Download button, Main pulls the
 * pinned source + uv into the app data dir, and the same panel starts/stops
 * the server. The renderer can only say "install / start / stop" — it never
 * hands over a URL or a path, so this cannot become an arbitrary downloader
 * or an argv injection point.
 *
 * Pinned here:
 *  * both downloads are https on their expected hosts, pinned by commit and
 *    sha256, and the estimate matches what the panel promises;
 *  * every path the engine writes stays inside the configured base dir;
 *  * the download base is the app data dir (env-overridable), not a bundle;
 *  * the panel, the preload allow-list and the IPC policy agree on the four
 *    handlers and the progress push channel;
 *  * both locales and the user guide describe the download/start/stop flow.
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
  CIT_SOURCE,
  CIT_UV,
  CIT_ESTIMATED_BYTES,
  CIT_PORT_START,
  CIT_PORT_END,
  enginePaths,
  isInstalled,
  PHASES
} = require('../../electron/tools/cit-engine.cjs')
const { PUSH_CHANNELS, isAllowedPushChannel } = require('../../electron/ipcPolicy.cjs')

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`[ok] ${name}`)
}

check('the source download is pinned by commit and sha256 on codeload', () => {
  const url = new URL(CIT_SOURCE.url)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'codeload.github.com')
  assert.match(CIT_SOURCE.commit, /^[a-f0-9]{40}$/)
  assert.ok(CIT_SOURCE.url.includes(CIT_SOURCE.commit), 'URL is not pinned to the commit')
  assert.match(CIT_SOURCE.sha256, /^[a-f0-9]{64}$/)
  assert.ok(CIT_SOURCE.size > 0)
})

check('the uv download is a pinned https GitHub release', () => {
  const url = new URL(CIT_UV.url)
  assert.equal(url.protocol, 'https:')
  assert.equal(url.hostname, 'github.com')
  assert.ok(CIT_UV.url.includes(`/download/${CIT_UV.version}/`), 'uv URL is not pinned to its version')
  assert.match(CIT_UV.sha256, /^[a-f0-9]{64}$/)
  assert.ok(CIT_UV.size > 0)
})

check('the estimate the panel shows stays under a gigabyte', () => {
  assert.ok(CIT_ESTIMATED_BYTES <= 1024 * 1024 * 1024)
  const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
  assert.match(body, /estimatedBytes/, 'the panel never shows the download size')
})

check('every engine path stays inside the configured base directory', () => {
  const base = join(tmpdir(), 'cit-engine-spec')
  const paths = enginePaths(base)
  for (const key of Object.keys(paths)) {
    assert.ok(
      resolve(paths[key]).startsWith(resolve(base) + sep),
      `${key} escaped the base dir: ${paths[key]}`
    )
  }
  assert.ok(paths.venv.startsWith(paths.dir) && paths.models.startsWith(paths.dir))
})

check('isInstalled needs both the venv python and the headless entry point', () => {
  const base = mkdtempSync(join(tmpdir(), 'cit-engine-spec-'))
  try {
    const paths = enginePaths(base)
    assert.equal(isInstalled(paths, 'win32'), false)
    mkdirSync(join(paths.venv, 'Scripts'), { recursive: true })
    writeFileSync(join(paths.venv, 'Scripts', 'python.exe'), '')
    assert.equal(isInstalled(paths, 'win32'), false, 'venv alone must not count as installed')
    mkdirSync(join(paths.src, 'apps'), { recursive: true })
    writeFileSync(join(paths.src, 'apps', 'web_stream.py'), '')
    assert.equal(isInstalled(paths, 'win32'), true)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

check('the managed range is a closed loopback port band', () => {
  assert.ok(PHASES.running && PHASES.installed && PHASES.error)
  assert.ok(CIT_PORT_START >= 8001 && CIT_PORT_END <= 8010)
})

check('Main installs into the app data dir, env-overridable, never the bundle', () => {
  const controller = read('electron/tools/tmcut.controller.cjs')
  assert.match(controller, /createCitEngine\(/, 'the controller never builds the engine')
  assert.match(controller, /TMCUT_CIT_ENGINE_DIR/, 'no override for the data dir')
  assert.match(controller, /app\.getPath\('userData'\)[\s\S]{0,80}engines/, 'the default dir is not under userData')
  assert.match(controller, /will-quit[\s\S]{0,80}dispose/, 'quitting the app leaves the engine running')
})

check('the engine module takes no URL or path from its caller', () => {
  const engine = read('electron/tools/cit-engine.cjs')
  // The install path only ever fetches CIT_SOURCE.url / CIT_UV.url; any other
  // download() call site would mean a caller-supplied URL slipped in.
  const calls = [...engine.matchAll(/await download\(([^,]+),/g)].map(m => m[1]!.trim())
  assert.deepEqual(calls.sort(), ['CIT_SOURCE.url', 'CIT_UV.url'])
  assert.ok(!/options\.(url|path|command|args)\b/.test(engine), 'the factory accepts caller-supplied locations')
})

check('preload offers exactly the four engine handlers plus the progress push', () => {
  const preload = read('electron/preload.cjs')
  for (const name of ['citEngineStatus', 'citEngineInstall', 'citEngineStart', 'citEngineStop']) {
    assert.ok(preload.includes(`'${name}'`), `preload cannot invoke ${name}`)
  }
  assert.match(preload, /engineProgress/, 'the panel never receives install progress')
  assert.equal(preload.includes('citEngineAny'), false)
  assert.ok(isAllowedPushChannel('tmcut:engineProgress'), 'push channel is not in the policy')
  assert.ok(PUSH_CHANNELS.includes('tmcut:engineProgress'))
})

check('the panel wires download, start and stop for the CIT tab on desktop only', () => {
  const body = read('app/components/tmcut/TmcutVoiceStudioBody.vue')
  // Both engines are managed now, so the gate lists both providers — it must
  // still start at isDesktop, or the engine panel leaks onto the web build.
  assert.match(body, /isDesktop && \(provider === 'vieneu' \|\| provider === 'cit'\)/, 'the engine panel leaks onto the web build')
  assert.match(body, /citEngineInstall/, 'no download button wiring')
  assert.match(body, /citEngineStart/, 'no start wiring')
  assert.match(body, /citEngineStop/, 'no stop wiring')
  assert.match(body, /onEngineProgress/, 'progress pushes are not subscribed')
  assert.match(body, /status\.origin/, 'a started engine never pins the loopback origin')
})

check('both locales and the guide describe the managed flow', () => {
  for (const locale of ['en', 'vi']) {
    const copy = JSON.parse(read(`i18n/locales/${locale}.json`))?.tmcut?.voice?.engine
    for (const key of ['title', 'install', 'size', 'installed', 'running', 'stopped', 'start', 'stop', 'failed']) {
      assert.equal(typeof copy?.[key], 'string', `${locale} lacks tmcut.voice.engine.${key}`)
    }
    for (const phase of ['downloading', 'packages', 'models', 'starting', 'stopping']) {
      assert.equal(typeof copy?.phases?.[phase], 'string', `${locale} lacks the ${phase} phase label`)
    }
  }
  const guide = read('docs/content/user-guide.md')
  assert.match(guide, /Engine do app quản lý/)
  assert.match(guide, /TMCUT_CIT_ENGINE_DIR/)
  assert.match(guide, /sha256/)
})

console.log(`tmcut_cit_engine: ${passed} passed`)
