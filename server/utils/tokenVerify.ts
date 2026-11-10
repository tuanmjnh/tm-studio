import { createLocalJWKSet, decodeProtectedHeader, importJWK, jwtVerify } from 'jose'
import type { JSONWebKeySet, JWK } from 'jose'
import type { TokenPayload } from '#shared/types/auth'

/**
 * How the studio proves a bearer token is real — one pure factory.
 *
 * The studio used to hold `AUTH_JWT_SECRET`, the same symmetric secret tm-hub
 * signs with, and verify HS256 locally. On a hosted satellite that is a
 * deployment choice; inside a packaged desktop client it is the exact thing
 * Q1 forbids, because the secret would have to travel in the installer.
 *
 * What the hub can give the client instead, in order of preference:
 *
 *  1. Public keys (RS256). `AUTH_JWT_PUBLIC_KEYS` is a JSON array of public
 *     JWKs — not a secret, safe to ship. This is the end state and the code
 *     path a packaged build uses.
 *  2. A JWKS URL. The same public material, fetched and rotated by the hub.
 *     The hub does not publish this endpoint yet; the path is wired so enabling
 *     it is configuration, not code.
 *  3. Introspection (`POST /api/v1/auth/introspect`). Available today. Costs a
 *     hub round trip per new token, so results are cached until the token's
 *     own expiry and rejections are never cached.
 *  4. The legacy HS256 secret. Kept only for the migration window: tokens the
 *     hub minted before it rotated must keep verifying.
 *
 * Order is first-match-wins and every step fails closed. `none` and every
 * algorithm outside the accepted set are refused.
 */

export interface IntrospectedClaims {
  userId: string
  appId: string
  email: string
  role?: string
  name?: string
  permissions: string[]
  allowedRoutes?: string[]
  /** Epoch millis; the cache entry dies with the token. */
  expiresAt?: number
  purpose?: string
}

export interface VerifierOptions {
  /** JSON array of hub PUBLIC JWKs (RS256). Not a secret. */
  publicKeys?: string
  /** JWKS endpoint; when set, keys rotate without a redeploy. */
  jwksUrl?: string
  /** Override the JWKS fetch (tests supply a resolver). */
  jwksResolver?: () => Promise<JSONWebKeySet['keys']>
  /** Legacy HS256 shared secret — migration only. */
  sharedSecret?: string
  /** Introspection transport; lets a client verify with no key material. */
  introspect?: (token: string) => Promise<IntrospectedClaims | null>
  /** Clock override for expiry tests. */
  now?: () => number
}

export type AccessTokenVerifier = (token: string) => Promise<TokenPayload | null>

const CACHE_LIMIT = 500
/** Introspection results for tokens without a readable expiry get a short life. */
const DEFAULT_CACHE_MS = 30_000

function toTokenPayload(payload: Record<string, unknown>): TokenPayload | null {
  // `signTotpChallenge` answers a pending login with a 5-minute token signed
  // the same way. Treating it as an access token would open the workspace
  // before the second factor was presented.
  if (payload.purpose === 'totp') return null
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) return null
  return { ...(payload as unknown as TokenPayload), userId: sub }
}

function normalizeIntrospected(claims: IntrospectedClaims): TokenPayload | null {
  if (claims.purpose === 'totp') return null
  if (!claims.userId) return null
  const permissions = claims.permissions || []
  return {
    userId: claims.userId,
    email: claims.email,
    name: claims.name || '',
    role: claims.role || (permissions.includes('*') ? 'root' : 'user'),
    permissions,
    allowedRoutes: claims.allowedRoutes,
    appId: claims.appId
  } as TokenPayload
}

interface PublicJwk extends JWK {
  kid?: string
}

/** Public RS256 JWKs only: `n`/`e` present, `d` (private) absent. */
function parsePublicKeys(raw: string): PublicJwk[] {
  if (!raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is PublicJwk => {
      if (!value || typeof value !== 'object') return false
      const jwk = value as Record<string, unknown>
      return !('d' in jwk)
        && typeof jwk.n === 'string' && jwk.n.length > 0
        && typeof jwk.e === 'string' && jwk.e.length > 0
        && typeof jwk.kid === 'string' && jwk.kid.length > 0
    })
  } catch {
    return []
  }
}

async function defaultJwksResolver(url: string): Promise<JSONWebKeySet['keys']> {
  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`JWKS fetch failed: HTTP ${res.status}`)
  const body = await res.json() as JSONWebKeySet
  return Array.isArray(body.keys) ? body.keys : []
}

export function createAccessTokenVerifier(options: VerifierOptions): AccessTokenVerifier {
  const now = options.now ?? (() => Date.now())
  const secret = options.sharedSecret ? new TextEncoder().encode(options.sharedSecret) : null
  const inlineKeys = parsePublicKeys(options.publicKeys || '')
  const resolver = options.jwksResolver
    ?? (options.jwksUrl ? () => defaultJwksResolver(options.jwksUrl!) : null)
  const cache = new Map<string, { payload: TokenPayload, expiresAt: number }>()

  function cached(token: string, at: number): TokenPayload | null {
    const hit = cache.get(token)
    if (!hit) return null
    if (hit.expiresAt <= at) {
      cache.delete(token)
      return null
    }
    return hit.payload
  }

  function remember(token: string, payload: TokenPayload, claims: IntrospectedClaims, at: number): void {
    const ttl = (claims.expiresAt ?? at + DEFAULT_CACHE_MS) - at
    if (ttl <= 0) return
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
    cache.set(token, { payload, expiresAt: at + ttl })
  }

  async function verifyAsymmetric(token: string): Promise<TokenPayload | null> {
    let header: { alg?: string, kid?: string }
    try {
      header = decodeProtectedHeader(token) as { alg?: string, kid?: string }
    } catch {
      return null
    }
    if (header.alg !== 'RS256' && header.alg !== 'ES256') return null

    // A JWKS URL is authoritative when configured; the inline set is what a
    // packaged client ships. Try the URL first so a rotation is picked up.
    const candidates: PublicJwk[] = []
    if (resolver) {
      try {
        const keys = await resolver()
        candidates.push(...(keys as PublicJwk[]))
      } catch {
        // Fall back to the inline set: a hub outage must not lock out a client
        // that already holds the public key.
      }
    }
    candidates.push(...inlineKeys)

    for (const jwk of candidates) {
      if ('d' in jwk) continue
      if (header.kid && jwk.kid && jwk.kid !== header.kid) continue
      try {
        const key = await importJWK(jwk, header.alg)
        const { payload } = await jwtVerify(token, key, { algorithms: [header.alg] })
        return toTokenPayload(payload as Record<string, unknown>)
      } catch {
        // Wrong key for this token: try the next published key.
      }
    }
    return null
  }

  return async function verify(token: string): Promise<TokenPayload | null> {
    if (!token) return null

    const asymmetric = await verifyAsymmetric(token)
    if (asymmetric) return asymmetric

    if (secret) {
      try {
        const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] })
        return toTokenPayload(payload as Record<string, unknown>)
      } catch {
        // Not this secret; introspection is the next authority.
      }
    }

    if (options.introspect) {
      const at = now()
      const hit = cached(token, at)
      if (hit) return hit
      let claims: IntrospectedClaims | null
      try {
        claims = await options.introspect(token)
      } catch {
        return null
      }
      if (!claims) return null
      const payload = normalizeIntrospected(claims)
      if (!payload) return null
      remember(token, payload, claims, at)
      return payload
    }

    return null
  }
}

// `createLocalJWKSet` is what a long-lived production verifier would hand to
// `jwtVerify`; this export keeps that name available to callers that build a
// key set once. The per-token loop above is used instead because a JWKS URL
// can rotate mid-process, and a cached set would then reject every new token.
export { createLocalJWKSet }
