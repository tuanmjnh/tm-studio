/**
 * The studio shipped the public Hub config in neither place: there was no
 * `public-config.cjs`, no `bake:public-config` script and no call in Main. The
 * Electron auth broker resolves the app id from `NUXT_PUBLIC_HUB_APP_ID`, which
 * the renderer bundle carries but Main's `process.env` did not, so every login
 * answered `notConfigured`.
 *
 * Two contracts: only public values may be baked, and the file is applied on
 * the startup path both dev and packaged take.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { bakePublicConfig, applyPublicConfig, PUBLIC_CONFIG_KEYS, FILE_NAME } = require('../../electron/tools/public-config.cjs') as {
  bakePublicConfig: (options?: Record<string, unknown>) => { path: string, keys: string[] }
  applyPublicConfig: (file: string, env?: Record<string, string>) => string[]
  PUBLIC_CONFIG_KEYS: string[]
  FILE_NAME: string
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const JWT_SECRET = 'shared-secret-must-never-ship'
const APP_SECRET = 'app-secret-must-never-ship'
const PUBLIC_JWK = { kty: 'RSA', kid: 'hub-1', alg: 'RS256', n: 'abc', e: 'AQAB' }

let root: string

function writeEnv(values: Record<string, string>) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`)
  writeFileSync(join(root, '.env'), `${lines.join('\n')}\n`, 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tm-studio-public-config-'))
  mkdirSync(join(root, 'resources'), { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('bake-public-config — allow-list only', () => {
  it('writes hub url, app id and public keys, and drops every secret', () => {
    writeEnv({
      NUXT_PUBLIC_HUB_URL: 'https://hub.test',
      NUXT_PUBLIC_HUB_APP_ID: 'tm-studio_test1',
      AUTH_JWT_PUBLIC_KEYS: JSON.stringify([PUBLIC_JWK]),
      AUTH_JWT_SECRET: JWT_SECRET,
      NUXT_HUB_APP_SECRET: APP_SECRET,
      HUB_DEVICE_SECRET: 'device-secret-must-never-ship'
    })

    bakePublicConfig({ projectRoot: root, env: {} })

    const text = readFileSync(join(root, 'resources', FILE_NAME), 'utf8')
    const written = JSON.parse(text) as Record<string, string>
    assert.deepEqual(Object.keys(written).sort(), [...PUBLIC_CONFIG_KEYS].sort())
    assert.equal(written.NUXT_PUBLIC_HUB_APP_ID, 'tm-studio_test1')
    for (const secret of [JWT_SECRET, APP_SECRET, 'device-secret-must-never-ship']) {
      assert.ok(!text.includes(secret), 'a secret reached resources/public-config.json')
    }
  })

  it('refuses a key set that carries a private exponent', () => {
    writeEnv({ AUTH_JWT_PUBLIC_KEYS: JSON.stringify([{ ...PUBLIC_JWK, d: 'private' }]) })
    assert.throws(() => bakePublicConfig({ projectRoot: root, env: {} }), /no "d"/)
  })

  it('lets the shell env win over .env', () => {
    writeEnv({ NUXT_PUBLIC_HUB_APP_ID: 'from-file' })
    bakePublicConfig({ projectRoot: root, env: { NUXT_PUBLIC_HUB_APP_ID: 'from-shell' } })
    const written = JSON.parse(readFileSync(join(root, 'resources', FILE_NAME), 'utf8')) as Record<string, string>
    assert.equal(written.NUXT_PUBLIC_HUB_APP_ID, 'from-shell')
  })
})

describe('apply-public-config — defaults only', () => {
  it('fills missing keys and keeps an explicit value', () => {
    const file = join(root, 'resources', FILE_NAME)
    writeFileSync(file, JSON.stringify({
      NUXT_PUBLIC_HUB_URL: 'https://baked.test',
      NUXT_PUBLIC_HUB_APP_ID: 'baked-app',
      AUTH_JWT_PUBLIC_KEYS: JSON.stringify([PUBLIC_JWK])
    }), 'utf8')

    const env: Record<string, string> = { NUXT_PUBLIC_HUB_APP_ID: 'user-config' }
    const applied = applyPublicConfig(file, env)
    assert.equal(env.NUXT_PUBLIC_HUB_URL, 'https://baked.test')
    assert.equal(env.NUXT_PUBLIC_HUB_APP_ID, 'user-config')
    assert.deepEqual(applied.sort(), ['AUTH_JWT_PUBLIC_KEYS', 'NUXT_PUBLIC_HUB_URL'])
  })

  it('does nothing when the file is absent', () => {
    const env: Record<string, string> = {}
    assert.deepEqual(applyPublicConfig(join(root, 'missing.json'), env), [])
    assert.deepEqual(env, {})
  })
})

describe('main.cjs applies the baked config on the shared startup path', () => {
  const main = readFileSync(join(repoRoot, 'electron', 'main.cjs'), 'utf8')

  it('applies it from app.whenReady, not from startServer', () => {
    const ready = main.slice(main.indexOf('app.whenReady()'))
    assert.ok(
      /loadUserConfig\(\)\s*\n\s*applyBakedPublicConfig\(\)/.test(ready),
      'whenReady must load config.env then apply the baked public config'
    )
    const startServer = main.slice(main.indexOf('async function startServer()'))
    const body = startServer.slice(0, startServer.indexOf('\n}'))
    assert.ok(
      !/applyPublicConfig\(/.test(body),
      'startServer is packaged-only; the call belongs on the shared startup path'
    )
  })

  it('resolves the packaged and dev locations separately', () => {
    assert.ok(/process\.resourcesPath.*resources.*public-config\.json/s.test(main))
    assert.ok(/__dirname,\s*'\.\.',\s*'resources',\s*'public-config\.json'/.test(main))
  })
})

describe('build scripts bake before packaging', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

  it('defines the bake script and runs it in every electron build', () => {
    assert.ok(pkg.scripts['bake:public-config'], 'bake:public-config is missing')
    for (const name of ['build:electron', 'build:electron:win', 'build:electron:dir']) {
      assert.match(pkg.scripts[name], /bake:public-config/, `${name} must bake the public config first`)
    }
  })
})
