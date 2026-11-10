import { join } from 'node:path'

export interface AppConfig {
  auth: {
    /** Legacy HS256 shared secret — kept only so pre-rotation hub tokens verify. */
    accessTokenSecret: string
    /** JSON array of hub public JWKs; the RS256 path. Not a secret. */
    accessTokenPublicKeys: string
    /** Hub JWKS endpoint. Public by definition; empty until the hub publishes one. */
    jwksUrl: string
    /** Hub token introspection URL; lets a client verify with no local material. */
    hubIntrospectionUrl: string
    /** Public hub base URL, for deriving the introspection URL. */
    hubUrl: string
  }
  // Web-runtime media uploads (importWebFiles): files the browser picks up
  // are persisted here and streamed back under /uploads/*. .data/ is
  // already gitignored (same dir family as Nuxt's dev cache).
  uploads: {
    dir: string
    maxMb: number
  }
}

function readEnv(key: string, fallback = ''): string {
  return process.env[key] || fallback
}

export function loadConfig(): AppConfig {
  const hubUrl = readEnv('NUXT_PUBLIC_HUB_URL', 'http://localhost:4000').replace(/\/+$/, '')
  return {
    auth: {
      accessTokenSecret: readEnv('AUTH_JWT_SECRET'),
      accessTokenPublicKeys: readEnv('AUTH_JWT_PUBLIC_KEYS'),
      jwksUrl: readEnv('AUTH_JWT_JWKS_URL'),
      // An explicit override wins; otherwise derive the hub's own route. The
      // studio never invents a hub endpoint it has not been told about.
      hubIntrospectionUrl: readEnv('AUTH_JWT_INTROSPECT_URL')
        || (hubUrl ? `${hubUrl}/api/v1/auth/introspect` : ''),
      hubUrl
    },
    uploads: {
      dir: readEnv('TOOLS_UPLOADS_DIR', join(process.cwd(), '.data', 'uploads')),
      maxMb: parseInt(readEnv('TOOLS_UPLOADS_MAX_MB', '512'))
    }
  }
}

export const config = loadConfig()
