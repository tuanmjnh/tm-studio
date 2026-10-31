export default defineNuxtPlugin((nuxtApp) => {
  const auth = useAuth()
  const tokenCookie = useCookie('accessToken')

  const handleSessionExpired = async () => {
    await auth.handleSessionExpired()
  }

  const originalFetch = globalThis.$fetch

  const config = useRuntimeConfig()
  const appId = (config.public.hubAppId as string) || 'tm-tools'

  const customFetch = originalFetch.create({
    onRequest({ options }) {
      const headers = new Headers(options.headers)
      if (!headers.has('X-App-Id')) {
        headers.set('X-App-Id', appId)
      }

      const token = auth.accessToken.value || tokenCookie.value
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`)
      }
      options.headers = headers
    }
  })

  // Requests whose 401 carries its own meaning: login/register failures are
  // user errors, /auth/me drives fetchUser's bounded retry, and a rejected
  // refresh means the session is over.
  const SELF_HANDLED = /\/auth\/(login|register|refresh|me)/

  // Nitro types $fetch's success value as TypedInternalResponse<...T>, which is
  // a superset of the caller's T and therefore not assignable back to it. The
  // wrapper is transparent — the payload is whatever the endpoint returns — so
  // re-declare the call site as returning exactly what the caller asked for.
  const send = customFetch as unknown as <R>(
    input: Parameters<typeof customFetch>[0],
    options?: Parameters<typeof customFetch>[1]
  ) => Promise<R>

  /**
   * The access-token cookie expires on its own (maxAge = token TTL) while the
   * refresh cookie stays valid, so the first call after a reload can reach the
   * server with no token at all (`error.tokenMissing`). Refreshing alone is not
   * enough: ofetch ignores what onResponseError returns, so the request that
   * triggered the refresh still failed — that used to kill export POSTs on the
   * first try. Replay it once with the fresh token instead. Replaying is safe
   * because a 401 comes from the auth gate, before any handler ran.
   */
  async function authFetch<T>(input: Parameters<typeof customFetch>[0], options?: Parameters<typeof customFetch>[1]): Promise<T> {
    const url = typeof input === 'string' ? input : (input as { url?: string })?.url || ''
    try {
      return await send<T>(input, options)
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status !== 401) {
        throw error
      }
      if (SELF_HANDLED.test(url)) {
        if (url.includes('/auth/refresh')) {
          await handleSessionExpired()
        }
        throw error
      }
      if (!(await auth.refresh())) {
        await handleSessionExpired()
        throw error
      }
      return await send<T>(input, options)
    }
  }

  globalThis.$fetch = authFetch as typeof globalThis.$fetch
  nuxtApp.$fetch = authFetch as typeof nuxtApp.$fetch

  // Window focus listener: verify session when user returns to app
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => {
      if (auth.isAuthenticated.value) {
        auth.fetchUser().catch(() => { })
      }
    })
  }
})
