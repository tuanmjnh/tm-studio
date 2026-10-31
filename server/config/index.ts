import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface AppConfig {
  auth: {
    /** Shared with tm-hub: verifies hub-issued JWTs on every /api/** request. */
    accessTokenSecret: string
  }
  tools: {
    ffmpegPath: string
    ffprobePath: string
    ffplayPath: string
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

/**
 * Resolves a bundled tool binary the SAME way the desktop app does
 * (electron/tools/paths.cjs → getResourcePath): the exes shipped next to the
 * Electron resources live in <projectRoot>/resources in dev and in
 * <resourcesPath>/resources when packaged. Nitro runs with cwd = project root,
 * so the ffmpeg the web export/proxy spawns is byte-identical to the one the
 * Electron renderer uses. Empty string = not bundled; callers fall back to
 * PATH (`ffmpeg`) or disable the feature.
 */
function resolveBundledTool(envKey: string, exeName: string): string {
  const override = readEnv(envKey, '')
  if (override) return override
  const bundled = join(process.cwd(), 'resources', exeName)
  return existsSync(bundled) ? bundled : ''
}

export function loadConfig(): AppConfig {
  return {
    auth: {
      accessTokenSecret: readEnv('AUTH_JWT_SECRET')
    },
    tools: {
      ffmpegPath: resolveBundledTool('TOOLS_FFMPEG_PATH', 'ffmpeg.exe'),
      ffprobePath: resolveBundledTool('TOOLS_FFPROBE_PATH', 'ffprobe.exe'),
      ffplayPath: resolveBundledTool('TOOLS_FFPLAY_PATH', 'ffplay.exe')
    },
    uploads: {
      dir: readEnv('TOOLS_UPLOADS_DIR', join(process.cwd(), '.data', 'uploads')),
      maxMb: parseInt(readEnv('TOOLS_UPLOADS_MAX_MB', '512'))
    }
  }
}

export const config = loadConfig()
