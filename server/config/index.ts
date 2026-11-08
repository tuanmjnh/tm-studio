import { join } from 'node:path'

export interface AppConfig {
  auth: {
    /** Shared with tm-hub: verifies hub-issued JWTs on every /api/** request. */
    accessTokenSecret: string
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
  return {
    auth: {
      accessTokenSecret: readEnv('AUTH_JWT_SECRET')
    },
    uploads: {
      dir: readEnv('TOOLS_UPLOADS_DIR', join(process.cwd(), '.data', 'uploads')),
      maxMb: parseInt(readEnv('TOOLS_UPLOADS_MAX_MB', '512'))
    }
  }
}

export const config = loadConfig()
