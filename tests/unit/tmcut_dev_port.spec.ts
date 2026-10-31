/**
 * R148 specs — the Electron dev port can never be unusable.
 *
 * The reported bug: `pnpm dev:electron` left the window blank. The Nuxt dev
 * server bound 4003 and `wait-on` succeeded, but the Electron shell computed
 * its renderer URL as `Number(process.env.PORT || 4003)` — an ambient PORT of
 * "0" is truthy, so it survived and the window loaded http://localhost:0
 * (ERR_UNSAFE_PORT). The same value keyed the IPC sender gate, so every
 * privileged invoke would have been refused too.
 *
 * Two contracts: the resolver is the ONLY place a port is decided, and the
 * dev script's wait-on URL agrees with the port Nuxt is told to bind.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parsePort, resolveDevPort } = require('../../electron/tools/ports.cjs') as {
  parsePort: (v: unknown) => number | null
  resolveDevPort: (env?: Record<string, string | undefined>, fallback?: number) => number
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('dev port resolver (R148)', () => {
  it('rejects the ambient values that used to win', () => {
    // "0" is the exact ambient value that produced localhost:0. It is
    // truthy, so a plain `|| fallback` never replaced it.
    assert.equal(parsePort('0'), null)
    assert.equal(parsePort(0), null)
    assert.equal(parsePort(''), null)
    assert.equal(parsePort('   '), null)
    assert.equal(parsePort('abc'), null)
    assert.equal(parsePort('-1'), null)
    assert.equal(parsePort('70000'), null)
    assert.equal(parsePort(undefined), null)
    assert.equal(parsePort(null), null)
    // The one non-obvious shape: Number('4003') on a numeric-ish string.
    assert.equal(parsePort('4003'), 4003)
    assert.equal(parsePort(4003), 4003)
    assert.equal(parsePort(65535), 65535)
  })

  it('falls back to the documented dev port when nothing usable is set', () => {
    assert.equal(resolveDevPort({}), 4003)
    assert.equal(resolveDevPort({ PORT: '0' }), 4003)
    assert.equal(resolveDevPort({ PORT: 'nope' }), 4003)
    assert.equal(resolveDevPort({ PORT: '' }), 4003)
  })

  it('honours a real PORT (the .env workflow) and an app-owned override', () => {
    assert.equal(resolveDevPort({ PORT: '4003' }), 4003)
    assert.equal(resolveDevPort({ PORT: '4111' }), 4111)
    // APP_DEV_PORT is app-owned, so it beats a stray ambient PORT.
    assert.equal(resolveDevPort({ APP_DEV_PORT: '4500', PORT: '0' }), 4500)
    // ...but an unusable APP_DEV_PORT still cannot win.
    assert.equal(resolveDevPort({ APP_DEV_PORT: '0', PORT: '4200' }), 4200)
  })
})

describe('main.cjs port wiring (R148)', () => {
  const main = read('electron/main.cjs')

  it('resolves both ports through the shared helper', () => {
    assert.ok(/require\(['"]\.\/tools\/ports\.cjs['"]\)/.test(main), 'main.cjs must require tools/ports.cjs')
    assert.ok(main.includes('const DEV_PORT = resolveDevPort(process.env)'), 'dev port must come from resolveDevPort')
    assert.ok(main.includes('parsePort(process.env.APP_PORT)'), 'packaged port must be guarded too')
  })

  it('no longer trusts a raw ambient PORT / APP_PORT', () => {
    // The regression this kills on sight: the old expression is back.
    assert.ok(!/Number\(\s*process\.env\.PORT\s*\|\|/.test(main), 'the truthy-|| idiom must not return for PORT')
    assert.ok(!/process\.env\.APP_PORT\s*\|\|/.test(main), 'the truthy-|| idiom must not return for APP_PORT')
  })

  it('the IPC origin gate is keyed by the SAME resolved dev port', () => {
    // A bad port here silently refuses every privileged invoke, so the gate
    // must not re-derive its own value.
    assert.ok(/createSenderGate\(\{\s*isDev,\s*port:\s*PORT,\s*devPort:\s*DEV_PORT\s*\}\)/.test(main),
      'sender gate must be built from the resolved ports')
  })
})

describe('dev:electron script contract (R148)', () => {
  const pkg = JSON.parse(read('package.json'))
  const script: string = pkg.scripts['dev:electron']

  it('tells Nuxt which port to bind instead of assuming a default', () => {
    const bound = /nuxt dev --port (\d+)/.exec(script)
    assert.ok(bound, 'dev:electron must bind an explicit Nuxt port (a bare `nuxt dev` follows the ambient env)')
    const waited = /wait-on http:\/\/localhost:(\d+)/.exec(script)
    assert.ok(waited, 'dev:electron must wait on a loopback URL')
    // The reported bug in one assertion: waiting on 4003 while Nuxt took 3000.
    assert.equal(bound![1], waited![1], 'wait-on port must equal the port Nuxt is told to bind')
    assert.equal(bound![1], '4003', 'the documented dev port is 4003 (matches PORT in .env)')
  })

  it('routes Electron through the CDP-port-aware launcher (R149)', () => {
    // The reported R149 bug: --remote-debugging-port=9222 hard-coded in this
    // script makes the DevTools http server silently fail whenever 9222 is
    // already bound by another target on the machine, killing automation (and
    // Chromium only logs an error and continues — easy to miss).
    assert.ok(script.includes('node electron/tools/dev-electron-launcher.cjs'),
      'dev:electron must launch Electron via the CDP-port-aware launcher')
    assert.ok(!/--remote-debugging-port=\d+/.test(script),
      'the raw --remote-debugging-port flag must not be hard-coded in the script anymore')
    assert.ok(readFileSync(join(ROOT, 'electron', 'tools', 'dev-electron-launcher.cjs')).includes('--remote-debugging-port=${port}'),
      'the launcher itself must pass the chosen free port to Electron')
  })

  it('the dev default and the script agree with the Electron fallback', () => {
    // Three places name the dev port; drift between them is the bug class.
    assert.equal(resolveDevPort({}), 4003)
    assert.ok(/nuxt dev --port 4003/.test(pkg.scripts.dev), 'pnpm dev must bind the same port')
  })
})

describe('CDP port picker (dev-electron-launcher, R149)', () => {
  const { pickCdpPort } = require('../../electron/tools/dev-electron-launcher.cjs') as {
    pickCdpPort: (isTaken: (port: number) => Promise<boolean>, start: number, span?: number) => Promise<number | null>
  }

  it('returns the preferred port when it is free', async () => {
    assert.equal(await pickCdpPort(() => Promise.resolve(false), 9222), 9222)
  })

  it('skips ports that are already bound (the reported bind() failure)', async () => {
    const taken = new Set([9222, 9223, 9224])
    const ports: number[] = []
    const port = await pickCdpPort(p => { ports.push(p); return Promise.resolve(taken.has(p)) }, 9222)
    assert.equal(port, 9225)
    assert.deepEqual(ports, [9222, 9223, 9224, 9225], 'probes in order, stops at the first free port')
  })

  it('gives up after the span so the caller can fall back to Chromium error path', async () => {
    const port = await pickCdpPort(() => Promise.resolve(true), 9222, 3)
    assert.equal(port, null)
  })
})
