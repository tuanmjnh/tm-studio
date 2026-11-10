import type { TokenPayload } from '#shared/types/auth'
import { config } from '../config/index'
import { createAccessTokenVerifier } from './tokenVerify'

/**
 * Hub-issued access tokens. RS256 is verified with the published public JWKs
 * (`AUTH_JWT_PUBLIC_KEYS`, safe to ship); the legacy HS256 secret remains only
 * for the migration window. See `tokenVerify.ts` for the full order.
 *
 * When this process holds no local material at all — the case a packaged
 * desktop client is headed for — verification delegates to the hub's
 * introspection endpoint. That is opt-in by absence, not a fallback bolted on
 * top of a configured secret: a token that fails an HS256 check is a bad
 * token, not a reason to ask the hub about every rejected request.
 */
const hasLocalMaterial = Boolean(
  config.auth.accessTokenPublicKeys || config.auth.accessTokenSecret || config.auth.jwksUrl
)

export const verifyAccessToken: (token: string) => Promise<TokenPayload | null> = createAccessTokenVerifier({
  publicKeys: config.auth.accessTokenPublicKeys,
  jwksUrl: config.auth.jwksUrl,
  sharedSecret: config.auth.accessTokenSecret,
  introspect: hasLocalMaterial || !config.auth.hubIntrospectionUrl
    ? undefined
    : async (token) => {
      const res = await fetch(config.auth.hubIntrospectionUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' }
      })
      if (!res.ok) return null
      const body = await res.json() as {
        success?: boolean
        data?: {
          valid?: boolean
          sub?: string
          appId?: string
          email?: string
          name?: string
          roles?: string[]
          permissions?: string[]
          allowedRoutes?: string[]
        }
      }
      const data = body?.data
      if (!body?.success || !data?.valid || !data.sub) return null
      return {
        userId: data.sub,
        appId: data.appId || '',
        email: data.email || '',
        name: data.name,
        role: data.roles?.[0] || 'user',
        permissions: data.permissions || [],
        allowedRoutes: data.allowedRoutes
      }
    }
})
