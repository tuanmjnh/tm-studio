import { ofetch } from 'ofetch'

const COOKIE_NAME = 'fcmToken'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180
const MAX_TOKEN_LENGTH = 4096

/**
 * The FCM token stays server-side in an HttpOnly cookie so page scripts never
 * hold it. GET only reports presence, never the value.
 */
export default defineEventHandler(async (event) => {
  const method = event.method

  if (method === 'GET') {
    return { success: true, data: { exists: !!getCookie(event, COOKIE_NAME) } }
  }

  if (method === 'POST') {
    const body = await readBody(event).catch(() => ({} as { fcmToken?: unknown }))
    const fcmToken = typeof body?.fcmToken === 'string' ? body.fcmToken.trim() : ''

    if (!fcmToken || fcmToken.length > MAX_TOKEN_LENGTH) {
      throw createError({ statusCode: 400, statusMessage: 'error.invalidRequest', message: 'Invalid FCM token' })
    }

    setCookie(event, COOKIE_NAME, fcmToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE
    })

    return { success: true, data: { exists: true } }
  }

  if (method === 'DELETE') {
    const fcmToken = getCookie(event, COOKIE_NAME) || ''
    const body = await readBody(event).catch(() => ({} as { endpoint?: unknown }))
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''

    const config = useRuntimeConfig(event)
    const hubUrl = String(config.public.hubUrl || '').replace(/\/+$/, '')
    const hubAppId = String(config.public.hubAppId || '')

    let accessToken = ''
    const authHeader = getHeader(event, 'authorization')
    if (authHeader?.startsWith('Bearer ')) accessToken = authHeader.slice(7)
    if (!accessToken) accessToken = getCookie(event, 'accessToken') || ''

    let unsubscribed = false
    if (hubUrl && accessToken && (fcmToken || endpoint)) {
      try {
        await ofetch(`${hubUrl}/api/v1/apps/${encodeURIComponent(hubAppId)}/notifications/unsubscribe`, {
          method: 'POST',
          headers: {
            'X-App-Id': hubAppId,
            'Authorization': `Bearer ${accessToken}`
          },
          body: {
            endpoint: endpoint || undefined,
            fcmToken: fcmToken || undefined
          },
          timeout: 8000
        })
        unsubscribed = true
      } catch (err) {
        console.warn('[Push] Hub unsubscribe failed, clearing local cookie anyway:', err)
      }
    }

    deleteCookie(event, COOKIE_NAME, { path: '/' })

    return { success: true, data: { exists: false, unsubscribed } }
  }

  throw createError({ statusCode: 405, statusMessage: 'error.invalidRequest', message: 'Method not allowed' })
})
