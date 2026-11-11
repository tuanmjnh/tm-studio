/**
 * Which identity the studio relays to Hub with, and where the device UI lives.
 *
 * The rule that matters: a device credential wins, App Secret is the hosted
 * fallback, and a half-present device pair fails closed instead of silently
 * downgrading to the App Secret. A credential is also bound to the Hub that
 * issued it — a row from another Hub is refused, never sent.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHubServiceIdentity, resolveHubServiceIdentityDetailed } from '../../server/utils/hubIdentity'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const KEYS = [
  'NUXT_PUBLIC_HUB_URL',
  'NUXT_PUBLIC_HUB_APP_ID',
  'NUXT_HUB_APP_SECRET',
  'HUB_DEVICE_ID',
  'HUB_DEVICE_SECRET',
  'HUB_DEVICE_APP_ID',
  'HUB_DEVICE_HUB_ORIGIN'
]

const APP = 'tm-studio_749app'
const PROD = 'https://hub.test'

function env(values: Record<string, string>): void {
  for (const key of KEYS) Reflect.deleteProperty(process.env, key)
  Object.assign(process.env, values)
}

function enrolled(overrides: Record<string, string> = {}): void {
  env({
    NUXT_PUBLIC_HUB_URL: PROD,
    NUXT_PUBLIC_HUB_APP_ID: APP,
    HUB_DEVICE_ID: 'dc-1',
    HUB_DEVICE_SECRET: 'device-secret',
    HUB_DEVICE_APP_ID: APP,
    HUB_DEVICE_HUB_ORIGIN: PROD,
    ...overrides
  })
}

describe('resolveHubServiceIdentity', () => {
  it('prefers the device credential over the App Secret', () => {
    enrolled({ NUXT_HUB_APP_SECRET: 'app-secret' })
    const identity = resolveHubServiceIdentity()
    assert.equal(identity?.kind, 'device')
    assert.deepEqual(identity?.headers, { 'X-Device-Id': 'dc-1', 'X-Device-Secret': 'device-secret' })
    assert.equal(JSON.stringify(identity).includes('app-secret'), false)
  })

  it('falls back to the App Secret for a hosted deployment with no device', () => {
    env({ NUXT_PUBLIC_HUB_URL: PROD, NUXT_PUBLIC_HUB_APP_ID: APP, NUXT_HUB_APP_SECRET: 'app-secret' })
    const identity = resolveHubServiceIdentity()
    assert.equal(identity?.kind, 'app')
    assert.deepEqual(identity?.headers, { 'X-App-Id': APP, 'X-App-Secret': 'app-secret' })
  })

  it('fails closed when only half the device pair is present', () => {
    env({
      NUXT_PUBLIC_HUB_URL: PROD,
      NUXT_PUBLIC_HUB_APP_ID: APP,
      NUXT_HUB_APP_SECRET: 'app-secret',
      HUB_DEVICE_ID: 'dc-1'
    })
    assert.equal(resolveHubServiceIdentity(), null, 'must not downgrade to the App Secret')
    assert.equal(resolveHubServiceIdentityDetailed().issue, 'incomplete-pair')
  })

  it('is null with no hub url', () => {
    env({ NUXT_PUBLIC_HUB_APP_ID: APP, NUXT_HUB_APP_SECRET: 'app-secret' })
    assert.equal(resolveHubServiceIdentity(), null)
  })
})

describe('credential is bound to the Hub that issued it', () => {
  it('is refused when this build points at another Hub', () => {
    enrolled({ HUB_DEVICE_HUB_ORIGIN: 'http://localhost:4000' })
    const { identity, issue, storedOrigin } = resolveHubServiceIdentityDetailed()
    assert.equal(identity, null)
    assert.equal(issue, 'hub-mismatch')
    assert.equal(storedOrigin, 'http://localhost:4000')
  })

  it('is refused when the app id changed but the Hub did not', () => {
    enrolled({ HUB_DEVICE_APP_ID: 'tm-studio_other' })
    const { identity, issue } = resolveHubServiceIdentityDetailed()
    assert.equal(identity, null)
    assert.equal(issue, 'app-mismatch')
  })

  it('is refused when it carries no recording of its Hub', () => {
    env({
      NUXT_PUBLIC_HUB_URL: PROD,
      NUXT_PUBLIC_HUB_APP_ID: APP,
      HUB_DEVICE_ID: 'dc-1',
      HUB_DEVICE_SECRET: 'device-secret',
      HUB_DEVICE_APP_ID: APP
    })
    const { identity, issue } = resolveHubServiceIdentityDetailed()
    assert.equal(identity, null, 'a pre-scoping row cannot be proven and must not be sent')
    assert.equal(issue, 'legacy-no-origin')
  })

  it('accepts a trailing slash or different case on the same origin', () => {
    enrolled({ HUB_DEVICE_HUB_ORIGIN: 'HTTPS://HUB.TEST/' })
    assert.equal(resolveHubServiceIdentityDetailed().issue, null)
    assert.equal(resolveHubServiceIdentity()?.kind, 'device')
  })
})

describe('studio wiring', () => {
  it('both relay routes go through the identity guard and never hardcode the secret header', () => {
    for (const route of ['server/api/v1/ai/relay/catalog.get.ts', 'server/api/v1/ai/relay/chat.post.ts']) {
      const src = read(route)
      assert.ok(src.includes('requireHubServiceIdentity'), `${route} must use the identity guard`)
      assert.equal(/'X-App-Secret'/.test(src), false, `${route} must not hardcode X-App-Secret`)
    }
  })

  it('device secret is an encrypted config slot', () => {
    const slots = read('electron/tools/secret-slots.cjs')
    const declaration = slots.match(/SECRET_SLOT_RE = (\/[^\n]+\/[a-z]*)/)
    assert.ok(declaration)
    const re = new RegExp(declaration![1].slice(1, declaration![1].lastIndexOf('/')))
    assert.ok(re.test('HUB_DEVICE_SECRET'))
  })

  it('the device page uses the registry namespace and never renders a secret', () => {
    const page = read('app/pages/system/settings/devices.vue')
    assert.ok(page.includes('/api/v1/auth/user-devices'))
    assert.equal(/['"`]\/api\/v1\/auth\/devices/.test(page), false)
    assert.equal(/HUB_DEVICE_SECRET/.test(page), false)
    assert.ok(read('app/pages/system/settings.vue').includes('/system/settings/devices'))
  })

  it('local forget is an ungated broker call and the Hub revoke stays separate', () => {
    const page = read('app/pages/system/settings/devices.vue')
    assert.ok(page.includes('forgetCredential()'), 'the local forget goes through the broker')
    assert.equal(/forgetCredential\([^)]*accessToken/.test(page), false, 'a local forget sends no token')
    assert.ok(page.includes('method: \'DELETE\''), 'Hub revoke stays its own registry call')
  })

  it('the broker is the only writer of the device credential slots', () => {
    const main = read('electron/main.cjs')
    assert.ok(main.includes('ipcMain.handle(\'device:forget\''))
    assert.ok(main.includes('ipcMain.handle(\'device:status\''))
    assert.equal(main.includes('ipcMain.handle(\'device:enroll\''), false, 'RFC 8628 enrollment stays retired')
  })
})
