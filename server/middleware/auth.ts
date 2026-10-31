import { verifyAccessToken } from '../utils/jwt'

const publicRoutes = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/health',
  '/api/system/network'
]

export default defineEventHandler(async (event) => {
  const path = event.path

  if (!path.startsWith('/api/')) return
  if (publicRoutes.includes(path)) return

  let token: string | null = null

  const authHeader = getHeader(event, 'authorization')
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.slice(7)
  }

  if (!token) {
    token = getCookie(event, 'accessToken') || null
  }

  if (!token) {
    throw createError({ statusCode: 401, statusMessage: 'error.tokenMissing', message: 'Missing authorization token' })
  }
  const payload = await verifyAccessToken(token)

  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'error.invalidToken', message: 'Invalid or expired token' })
  }

  // Security constraint: Token must match tm-tools appId (except root / cross-app)
  const currentAppId = process.env.NUXT_PUBLIC_HUB_APP_ID || 'tm-tools'
  const rawPayload = payload as unknown as Record<string, unknown>
  const capabilities = Array.isArray(rawPayload.capabilities) ? rawPayload.capabilities as string[] : []
  const isRootOrCrossApp = payload.role === 'root'
    || (payload.permissions || []).includes('*')
    || (payload.permissions || []).includes('platform.crossapp.read')
    || (payload.permissions || []).includes('platform.crossapp.write')
    || capabilities.includes('*')
    || capabilities.includes('platform.crossapp.read')

  if (payload.appId && payload.appId !== currentAppId && !isRootOrCrossApp) {
    throw createError({ statusCode: 403, statusMessage: 'error.forbidden', message: 'Token not issued for this application' })
  }

  event.context.auth = payload
})
