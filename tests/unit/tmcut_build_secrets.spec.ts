/**
 * A private `runtimeConfig` value is server-side, but it is NOT out of the
 * build: Nuxt serializes the config it sees at build time into the server
 * bundle, and the server bundle ships inside the installer. Measured on this
 * repo before the fix: building with `NUXT_HUB_APP_SECRET` set made the literal
 * secret appear in `.output/server/chunks/_/nitro.mjs` (and in the asar of the
 * packaged app). `AUTH_JWT_SECRET` never appeared because the config never read
 * it — the difference is the `nuxt.config.ts` expression, not the variable.
 *
 * The rule this pins: the app secret is read at REQUEST time from the process
 * environment, never evaluated in `nuxt.config.ts`.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/**
 * A comment that explains WHY a secret must not be read at build time is not
 * the violation. Strip `//` and block comments before matching, so the guard
 * checks code and the prose can name the pattern it forbids.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('no shared secret may be baked into the build', () => {
  const config = stripComments(read('nuxt.config.ts'))

  it('nuxt.config never evaluates the app secret', () => {
    // Any `process.env.NUXT_HUB_APP_SECRET` here is evaluated while building,
    // and its value is serialized into the server bundle that ships.
    assert.doesNotMatch(config, /process\.env\.NUXT_HUB_APP_SECRET/,
      'nuxt.config.ts reads NUXT_HUB_APP_SECRET at build time — the value lands in .output and inside the installer')
  })

  it('nuxt.config never reads the shared JWT secret or a provider key', () => {
    for (const name of ['AUTH_JWT_SECRET', 'AI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
      assert.equal(config.includes(`process.env.${name}`), false,
        `nuxt.config.ts reads ${name} at build time`)
    }
  })

  it('the private runtime config declares an empty default, not a value', () => {
    const block = config.match(/runtimeConfig:\s*\{[\s\S]*?\n {2}\}/)
    assert.ok(block, 'runtimeConfig block not found')
    assert.match(block![0], /hubAppSecret:\s*''/, 'the app secret must default to empty at build time')
  })

  it('the relay resolves its service identity from the environment per request', () => {
    for (const route of ['server/api/v1/ai/relay/catalog.get.ts', 'server/api/v1/ai/relay/chat.post.ts']) {
      const src = stripComments(read(route))
      assert.match(src, /resolveHubServiceIdentity\(\)/,
        `${route} must resolve the identity from the environment at request time`)
      assert.doesNotMatch(src, /config\.hubAppSecret/,
        `${route} still reads the build-time runtimeConfig value`)
      assert.doesNotMatch(src, /X-App-Secret/,
        `${route} must not hardcode the App Secret header; the resolver chooses the identity`)
    }
    const helper = read('server/utils/hubIdentity.ts')
    assert.match(helper, /process\.env\.NUXT_HUB_APP_SECRET/, 'the resolver is the one place that reads the App Secret env')
    assert.match(helper, /process\.env\.HUB_DEVICE_SECRET/, 'the resolver is the one place that reads the device credential env')
  })

  it('an Electron config.env credential is encrypted at rest', () => {
    // Electron copies config.env into process.env before Nitro starts, which is
    // exactly how a per-install secret reaches the relay. If the slot is not in
    // SECRET_SLOT_RE it would sit in plaintext on disk.
    const slots = read('electron/tools/secret-slots.cjs')
    const declaration = slots.match(/SECRET_SLOT_RE = (\/[^\n]+\/[a-z]*)/)
    assert.ok(declaration, 'secret-slots.cjs must declare the regex')
    const re = new RegExp(declaration![1].slice(1, declaration![1].lastIndexOf('/')))
    assert.ok(re.test('NUXT_HUB_APP_SECRET'), 'NUXT_HUB_APP_SECRET must be an encrypted config slot')
    assert.ok(re.test('HUB_DEVICE_SECRET'), 'HUB_DEVICE_SECRET must be an encrypted config slot')
  })
})
