/**
 * Which identity the studio relays to Hub with, and where the device UI lives.
 *
 * The rule that matters: a device credential wins, App Secret is the hosted
 * fallback, and a half-present device pair fails closed instead of silently
 * downgrading to the App Secret.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveHubServiceIdentity } from '../../server/utils/hubIdentity'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')

const KEYS = [
  'NUXT_PUBLIC_HUB_URL',
  'NUXT_PUBLIC_HUB_APP_ID',
  'NUXT_HUB_APP_SECRET',
  'HUB_DEVICE_ID',
  'HUB_DEVICE_SECRET',
  'HUB_DEVICE_APP_ID'
]

function env(values: Record<string, string>): void {
  for (const key of KEYS) Reflect.deleteProperty(process.env, key)
  Object.assign(process.env, values)
}

describe('resolveHubServiceIdentity', () => {
  it('prefers the device credential over the App Secret', () => {
    env({
      NUXT_PUBLIC_HUB_URL: 'https://hub.test',
      NUXT_PUBLIC_HUB_APP_ID: 'tm-studio_749app',
      NUXT_HUB_APP_SECRET: 'app-secret',
      HUB_DEVICE_ID: 'dc-1',
      HUB_DEVICE_SECRET: 'device-secret',
      HUB_DEVICE_APP_ID: 'tm-studio_749app'
    })
    const identity = resolveHubServiceIdentity()
    assert.equal(identity?.kind, 'device')
    assert.deepEqual(identity?.headers, { 'X-Device-Id': 'dc-1', 'X-Device-Secret': 'device-secret' })
    assert.equal(JSON.stringify(identity).includes('app-secret'), false)
  })

  it('falls back to the App Secret for a hosted deployment with no device', () => {
    env({
      NUXT_PUBLIC_HUB_URL: 'https://hub.test',
      NUXT_PUBLIC_HUB_APP_ID: 'tm-studio_749app',
      NUXT_HUB_APP_SECRET: 'app-secret'
    })
    const identity = resolveHubServiceIdentity()
    assert.equal(identity?.kind, 'app')
    assert.deepEqual(identity?.headers, { 'X-App-Id': 'tm-studio_749app', 'X-App-Secret': 'app-secret' })
  })

  it('fails closed when only half the device pair is present', () => {
    env({
      NUXT_PUBLIC_HUB_URL: 'https://hub.test',
      NUXT_PUBLIC_HUB_APP_ID: 'tm-studio_749app',
      NUXT_HUB_APP_SECRET: 'app-secret',
      HUB_DEVICE_ID: 'dc-1'
    })
    assert.equal(resolveHubServiceIdentity(), null, 'must not downgrade to the App Secret')
  })

  it('is null with no hub url', () => {
    env({ NUXT_PUBLIC_HUB_APP_ID: 'tm-studio_749app', NUXT_HUB_APP_SECRET: 'app-secret' })
    assert.equal(resolveHubServiceIdentity(), null)
  })
})

describe('studio wiring', () => {
  it('both relay routes resolve identity per request and never hardcode the secret header', () => {
    for (const route of ['server/api/v1/ai/relay/catalog.get.ts', 'server/api/v1/ai/relay/chat.post.ts']) {
      const src = read(route)
      assert.ok(src.includes('resolveHubServiceIdentity'), `${route} must use the resolver`)
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
})
