/**
 * The studio server had no authorization policy at all.
 *
 * `server/middleware/rbac.ts` declared `const permissionMap = {}` and then
 * looped over it, so the loop never ran. `server/middleware/auth.ts` proved
 * *who* the caller was and that the token belonged to this app, and nothing
 * else: any signed-in user could call `POST /api/v1/ai/discover` with an
 * arbitrary `baseUrl` and make the Nitro process fetch it. The renderer hid
 * admin pages behind the hub's route tree, which protects the UI and says
 * nothing about a direct `curl`.
 *
 * The policy below is therefore an explicit allowlist with default-deny, and
 * these checks pin both halves: the decision function, and the fact that the
 * middleware delegates to it instead of carrying a dead map.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateServerAccess } from '../../server/utils/serverAccess'
import { ROOT_ONLY_PATHS, isRootOnlyPath } from '../../shared/rbac'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

const root = { role: 'root', permissions: ['*'], capabilities: ['*'] }
const admin = {
  role: 'admin',
  permissions: ['ai:read', 'ai:write', 'connections:read', 'connections:write', 'connections.read', 'connections.write'],
  capabilities: []
}
const endUser = { role: 'user', permissions: ['media:read'], capabilities: [] }

const decide = (path: string, method: string, who: unknown) =>
  evaluateServerAccess(path, method, who as never)

describe('server authorization policy', () => {
  it('root may call every route', () => {
    for (const path of ['/api/v1/ai/discover', '/api/v1/ai/relay/chat', '/api/v1/process/runs', '/api/v1/media/upload']) {
      assert.equal(decide(path, 'POST', root).allowed, true, `root was denied ${path}`)
    }
  })

  it('provider discovery is an admin tool, not a workspace feature', () => {
    // The handler performs a server-side fetch to a caller-supplied base URL;
    // without this rule it is an authenticated SSRF proxy.
    assert.equal(decide('/api/v1/ai/discover', 'POST', endUser).allowed, false)
    const denied = decide('/api/v1/ai/discover', 'POST', endUser)
    assert.equal(denied.allowed, false)
    if (!denied.allowed) assert.equal(denied.statusCode, 403)
    assert.equal(decide('/api/v1/ai/discover', 'POST', admin).allowed, true)
  })

  it('the workspace features stay available to any signed-in user', () => {
    // Relay, media, process and stock are the editor's own calls; the hub
    // already scopes what the relay may reach per app connection.
    for (const path of [
      '/api/v1/ai/relay/catalog',
      '/api/v1/ai/relay/chat',
      '/api/v1/media/upload',
      '/api/v1/media/tts',
      '/api/v1/process/runs',
      '/api/v1/stock/proxy',
      '/api/push/fcm-token'
    ]) {
      assert.equal(decide(path, 'POST', endUser).allowed, true, `signed-in user was denied ${path}`)
    }
  })

  it('an unauthenticated caller is refused even though auth.ts should have caught it first', () => {
    const denied = decide('/api/v1/media/upload', 'POST', null)
    assert.equal(denied.allowed, false)
    if (!denied.allowed) assert.equal(denied.statusCode, 401)
  })

  it('public status routes need no token', () => {
    assert.equal(decide('/api/health', 'GET', null).allowed, true)
    assert.equal(decide('/api/system/network', 'GET', null).allowed, true)
  })

  it('an unknown /api route is denied rather than waved through', () => {
    // Default-deny is what makes the allowlist meaningful: a route added
    // without a policy decision must not inherit anonymous access.
    const denied = decide('/api/v1/something/new', 'GET', endUser)
    assert.equal(denied.allowed, false)
  })

  it('non-API paths are not this middleware\'s business', () => {
    assert.equal(decide('/tmcut/editor', 'GET', null).allowed, true)
  })
})

describe('the middleware actually enforces the policy', () => {
  it('rbac.ts delegates to the shared decision function', () => {
    const rbac = read('server/middleware/rbac.ts')
    assert.match(rbac, /evaluateServerAccess/, 'rbac.ts must call the policy, not carry a private map')
    assert.doesNotMatch(rbac, /const permissionMap: Record<string, string> = \{\s*\}/,
      'an empty permission map is a no-op, not a policy')
  })

  it('every /api/v1 route in the tree has an explicit outcome', () => {
    // The allowlist is exhaustive by design; this keeps a new route from
    // silently landing in the second half of the policy. Discover sits in the
    // admin set above, so it is checked with the admin claims.
    const workspace = [
      ['/api/v1/ai/relay/catalog', 'GET'],
      ['/api/v1/ai/relay/chat', 'POST'],
      ['/api/v1/media/tts', 'POST'],
      ['/api/v1/media/tts/status', 'GET'],
      ['/api/v1/media/upload', 'POST'],
      ['/api/v1/process/artifact', 'POST'],
      ['/api/v1/process/artifact', 'GET'],
      ['/api/v1/process/runs', 'GET'],
      ['/api/v1/process/runs/abc', 'GET'],
      ['/api/v1/process/runs/abc', 'PUT'],
      ['/api/v1/stock/download', 'POST'],
      ['/api/v1/stock/proxy', 'POST']
    ] as const
    for (const [path, method] of workspace) {
      assert.equal(decide(path, method, endUser).allowed, true, `${method} ${path} is not in the allowlist`)
    }
    assert.equal(decide('/api/v1/ai/discover', 'POST', admin).allowed, true,
      'discover must be reachable by an admin-capable account')
  })
})

describe('root-only surfaces are declared once', () => {
  it('the hub integration page is root-only', () => {
    assert.ok(ROOT_ONLY_PATHS.includes('/system/hub-integration'))
    assert.equal(isRootOnlyPath('/system/hub-integration'), true)
    assert.equal(isRootOnlyPath('/system/hub-integration/extra'), true, 'a nested path inherits the rule')
    assert.equal(isRootOnlyPath('/tmcut/editor'), false)
  })
})
