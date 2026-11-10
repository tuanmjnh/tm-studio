/**
 * The studio server's authorization policy — one function, default-deny.
 *
 * Before this file the only server-side check was `auth.ts`: a valid hub JWT
 * for this appId. `rbac.ts` carried `const permissionMap = {}` and looped over
 * it, so it never denied anything. Two consequences that mattered:
 *
 *  - `POST /api/v1/ai/discover` makes the Nitro process fetch a caller-supplied
 *    `baseUrl` and return the body. Any signed-in account could use the studio
 *    server as an HTTP proxy into the local network.
 *  - Every workspace route was open to every account; the renderer hid pages
 *    behind the hub route tree, which is a UI decision and not a check.
 *
 * The page layer still hides what a user cannot use, but the decision here is
 * independent of it: a direct `curl` reaches the same verdict.
 */

/** The claims this policy reads. `auth.ts` stores the decoded JWT here. */
export interface ServerAuth {
  role?: string
  permissions?: string[]
  capabilities?: string[]
}

export type ServerAccess
  = | { allowed: true }
    | { allowed: false, statusCode: 401 | 403, statusMessage: string, message: string }

/** Reachable with no token at all — a status probe, never data. */
const PUBLIC_PATHS = ['/api/health', '/api/system/network']

/**
 * Signed-in workspace features: media import, TTS, process artifacts, the
 * stock proxy and the AI relay. The hub scopes what the relay may reach per
 * app connection, and the other routes only touch this user's own session.
 */
const SIGNED_IN_PREFIXES = [
  '/api/push/',
  '/api/v1/media/',
  '/api/v1/process/',
  '/api/v1/stock/',
  '/api/v1/ai/relay/'
]

/** Provider discovery is configuration, not a workspace feature. */
const ADMIN_ONLY_PREFIXES = ['/api/v1/ai/discover']

/**
 * Discovery changes which credentials/provider a connection uses, so it takes
 * the hub's own AI-management capabilities. Both spellings are accepted: the
 * hub flattens seeded `{module:'ai', actions:[...]}` roles to `ai:write`, and
 * emits capability codes as `ai.providers.write`.
 */
const AI_ADMIN_CAPABILITIES = [
  'ai.discover',
  'ai.providers.write',
  'ai.providers.read',
  'ai.write',
  'ai.manage',
  'ai:write',
  'ai:manage'
]

function claimsOf(auth: ServerAuth | null | undefined): string[] {
  if (!auth) return []
  return [...(auth.permissions || []), ...(auth.capabilities || [])]
}

export function isRootClaims(auth: ServerAuth | null | undefined): boolean {
  if (!auth) return false
  return auth.role === 'root' || claimsOf(auth).includes('*')
}

function pathnameOf(path: string): string {
  const q = path.search(/[?#]/)
  return q === -1 ? path : path.slice(0, q)
}

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(prefix => pathname === prefix.replace(/\/$/, '') || pathname.startsWith(prefix))
}

function deny(statusCode: 401 | 403, statusMessage: string, message: string): ServerAccess {
  return { allowed: false, statusCode, statusMessage, message }
}

/**
 * Decide one request. Pure: no event, no runtimeConfig, no I/O — which is why
 * the spec can exercise the real function instead of a copy of its rules.
 */
export function evaluateServerAccess(
  path: string,
  method: string,
  auth: ServerAuth | null | undefined
): ServerAccess {
  // Only /api/** is served by these handlers; pages and /uploads/* are not
  // this policy's business.
  if (!path.startsWith('/api/')) return { allowed: true }

  const pathname = pathnameOf(path)

  if (PUBLIC_PATHS.includes(pathname)) return { allowed: true }

  if (!auth) {
    return deny(401, 'error.tokenMissing', `Missing authorization token (${method} ${pathname})`)
  }

  if (isRootClaims(auth)) return { allowed: true }

  if (matches(pathname, ADMIN_ONLY_PREFIXES)) {
    const claims = claimsOf(auth)
    if (claims.some(c => AI_ADMIN_CAPABILITIES.includes(c))) return { allowed: true }
    return deny(403, 'error.forbidden', `AI provider management requires an admin-capable account (${method} ${pathname})`)
  }

  if (matches(pathname, SIGNED_IN_PREFIXES)) return { allowed: true }

  // Default-deny: a route added without a policy decision does not silently
  // inherit access from the fact that its handler forgot to check.
  return deny(403, 'error.forbidden', `No access policy covers ${method} ${pathname}`)
}
