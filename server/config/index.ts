import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AuthConfig, AuthProvider } from '#shared/types/auth'
import type { ModuleDefinition } from '#shared/types/rbac'

export interface AppConfig {
  auth: AuthConfig
  hub: {
    url: string
    appId: string
  }
  mongodb: {
    uri: string
    dbName: string
  }
  supabase: {
    url: string
    publishableKey: string
    serviceRoleKey: string
  }
  cloudinary: {
    cloudName: string
    apiKey: string
    apiSecret: string
  }
  firebase: {
    projectId: string
    clientEmail: string
    privateKey: string
    storageBucket: string
  }
  webPush: {
    publicKey: string
    privateKey: string
    subject: string
  }
  app: {
    name: string
    url: string
    port: number
  }
  tools: {
    ytDlpPath: string
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
  ai: {
    provider: string
    apiKey: string
    baseUrl: string
    model: string
  }
  modules: ModuleDefinition[]
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
      provider: readEnv('AUTH_PROVIDER', 'hub') as AuthProvider,
      accessTokenSecret: readEnv('AUTH_JWT_SECRET', 'dbe14a60ba70621b213b2cf535aaa712e2b9c0c9a1b1e471add395f715450fb3'),
      refreshTokenSecret: readEnv('AUTH_REFRESH_TOKEN_SECRET', '60780ac5cd7b755ae1cce5322ac9874763f48a410f4657ee9a74e0019edbda89'),
      accessTokenExpiry: parseInt(readEnv('AUTH_ACCESS_TOKEN_EXPIRY', '900')),
      refreshTokenExpiry: parseInt(readEnv('AUTH_REFRESH_TOKEN_EXPIRY', '604800'))
    },
    hub: {
      url: readEnv('NUXT_PUBLIC_HUB_URL', 'http://localhost:4000'),
      appId: readEnv('NUXT_PUBLIC_HUB_APP_ID', 'tm-tools')
    },
    mongodb: {
      uri: readEnv('MONGODB_URI', 'mongodb://localhost:27017'),
      dbName: readEnv('MONGODB_DB_NAME', 'tm-tools')
    },
    supabase: {
      url: readEnv('SUPABASE_URL', 'https://zldjdwcrejpputsgxedi.supabase.co'),
      publishableKey: readEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_iWGWp0Rk4teLNr67WPApqg_ZxakiLuL'),
      serviceRoleKey: readEnv('SUPABASE_SERVICE_ROLE_KEY', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpsZGpkd2NyZWpwcHV0c2d4ZWRpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTM4NzgyMCwiZXhwIjoyMTAwOTYzODIwfQ.D4s74_NQcwkOOJk0byIWCO3b4E9CODGVxQ0mn1-s8PQ')
    },
    cloudinary: {
      cloudName: readEnv('CLOUDINARY_CLOUD_NAME', 'dvkmve9tn'),
      apiKey: readEnv('CLOUDINARY_API_KEY', '518485535157415'),
      apiSecret: readEnv('CLOUDINARY_API_SECRET', 'g2wrwD4_Kg1Mt_wtiBdL4vROMsE')
    },
    firebase: {
      projectId: readEnv('FIREBASE_PROJECT_ID', 'tm-browsers'),
      clientEmail: readEnv('FIREBASE_CLIENT_EMAIL', 'firebase-adminsdk-fbsvc@tm-browsers.iam.gserviceaccount.com'),
      privateKey: readEnv('FIREBASE_PRIVATE_KEY', '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5qbA1gX1eIL21\nH9BLK7dL3awjbWymSEwnIShqFlmkJ0PNAOT841ruBgiRg/6PTBYyjw7llD9qA9x4\nl+bpETCkXkF2ItHu9Mv+4EUR60ZgrQS9eWoBiTmMYK4XvV4zBx2VgsTDfhsN7rdi\nY4qCGrugcaCFSmAUv6LGv0dE8gyUN5dCntIdhb7H43I+O3W2nUVXSpXEXWNDCKZU\nsNhYJPIegL4MMFePdhM9PiA3ybwptxgGevY3jbLdfR30xNB3CQdA0NIJZSNJhriu\nRNMUcEdrLR332KiwXFP3cXFRMlncMgI8fC2Ok3kbkzpn1Rqw+FS6/s33k6DimVdb\nVOR+6pbJAgMBAAECggEAW4xQHnoM0uqrEJIw17glKEwUct2kivOwVUUU1AbUScyw\nsnfj8cy7zA1+kR44WflnIqQG8O5iPIjN4Erqqfb3eL0fYzy1LrJXmoSEmlrcd5Qo\n97LUMhCzp0QO5BbUya2TCWOTWWAnv/17QJEbvZ6n8OvGfqMXcHO0NHMiFd2SlUxi\nJ7XVW/YaXRtBXiaztqeEPtg1HDRHAaLxmFyAsrUiMzjc47HEeOak6PE9vJ6XMwCu\nxXyW5l5DTCA4p58cdQS8ry/JjEt3mn6zJaJzze8GDgoJzAjnWSO3FKdyfcxyXeuG\ntVGNi58C1CEbLGMoqCEV6QC5epwPsvYBL5nQrRwpJwKBgQDvDSRogyMjXW3ysApw\nYy8cuLnQd+pwxx2XnT4mEdzcRoWLpWwvRxTsg2BalDs2LAUfUWR3Epz+n7K1+YhK\nOySjjeiDDWmvCohj87ThX6lvBylJZnwplA0+/KoBiBPS++w6nbismjb/nj9Fdjsr\nBbXw19i/UYMSKCkQcp4KuXDtjwKBgQDG04cqjOT9sXdH6KiyrIeuCoJ20CrREfea\nm18/ZsRDAvH0gdiTIMHY8LVYXYlWA+gqv6cfpnAsiUY3GsNyC0ISeezs1dibQftJ\nr9voXwD34zxj17bNl6sMqJ/z6bfkuEqnmN4jYjm/1LcDhSTbsQ9pmCWlOrkBmn7y\negWIXtw6JwKBgQDKb9u0MdFw4m74hQHiGOxNq1WX5+T+KnCx8zQtMxVQ6Nuw3Z6X\nDt/2Rm8zZbIa9v5Dfj7Q409WBVFm73DuQ9WMN+F+Eb68v/OuiTRVYxht8KeTBBoD\nb+Ajxf4GHAGFu1dacDRy3onSwGUeYrhKf6SK148yvUl898uGpTmXJWEvmwKBgEx5\n4GvFde7+69qE6x6OrkGLWVNKDq4MMykMyj4g0SzVXSunJh6xYt6G97ndgI3NQufu\nf+H0qwD2bEOVz8d1/RwOOct/FaniXz2gnv1qTX0LspbUykOaKvjbg2rWYx1epZiB\nfDAv//aBY0O/WsYF/N+o3hIH3FF5k4rA1I/3rM3RAoGBAKivq/ODa9Nt8p5l3uu/\nBV2Tr1ZnOeR9w2iIGgWgMQ5eLRtdlGJwQOpnMz51kjS0iAWKQHFy/VdbfDEPTbAI\n4th68zmSeEomazqjxzMwL+BN8eanU9XFinqItUrnVlrv5qFes+86HBm0cW4Ag219\nwwY2YxHjhCZm0yLjqY+sWtER\n-----END PRIVATE KEY-----\n'),
      storageBucket: readEnv('FIREBASE_STORAGE_BUCKET', 'tm-browsers.appspot.com')
    },
    webPush: {
      publicKey: readEnv('WEB_PUSH_PUBLIC_KEY', 'BJCUmDcZCmiAvk89Pb8lBB_TOYtT0wBMvOA8e-rc9nRIZk__-NuRHDZKedwuOecx30SbzqEso1Ovo_8ZbZgC8Fw'),
      privateKey: readEnv('WEB_PUSH_PRIVATE_KEY', '2VztAFydbex4A3TzyFgA_BL1L16n_xQZKJoWaAlZvAU'),
      subject: readEnv('WEB_PUSH_SUBJECT', 'mailto:tuanmjnhdeveloper@gmail.com')
    },
    app: {
      name: readEnv('APP_NAME', 'TM Tools'),
      url: readEnv('APP_URL', 'http://127.0.0.1:3456'),
      port: parseInt(readEnv('APP_PORT', '3456'))
    },
    tools: {
      ytDlpPath: resolveBundledTool('TOOLS_YTDLP_PATH', 'yt-dlp.exe'),
      ffmpegPath: resolveBundledTool('TOOLS_FFMPEG_PATH', 'ffmpeg.exe'),
      ffprobePath: resolveBundledTool('TOOLS_FFPROBE_PATH', 'ffprobe.exe'),
      ffplayPath: resolveBundledTool('TOOLS_FFPLAY_PATH', 'ffplay.exe')
    },
    uploads: {
      dir: readEnv('TOOLS_UPLOADS_DIR', join(process.cwd(), '.data', 'uploads')),
      maxMb: parseInt(readEnv('TOOLS_UPLOADS_MAX_MB', '512'))
    },
    ai: {
      provider: readEnv('AI_PROVIDER', 'gemini'),
      apiKey: readEnv('AI_API_KEY', ''),
      baseUrl: readEnv('AI_BASE_URL', ''),
      model: readEnv('AI_MODEL', '')
    },
    modules: [
      { key: 'dashboard', label: 'Dashboard', description: 'Dashboard module', icon: 'i-lucide-layout-dashboard' },
      { key: 'chat', label: 'AI Chat', description: 'AI chat module', icon: 'i-lucide-message-square' },
      { key: 'browser_hub', label: 'Browser Hub', description: 'Browser profiles & proxies management', icon: 'i-lucide-globe' },
      { key: 'settings', label: 'Settings', description: 'Settings module', icon: 'i-lucide-settings' },
      { key: 'users', label: 'Users', description: 'User management', icon: 'i-lucide-user-cog' },
      { key: 'rbac', label: 'RBAC', description: 'Role & permission management', icon: 'i-lucide-shield' }
    ]
  }
}

export const config = loadConfig()
