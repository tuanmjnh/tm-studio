import type { AuthResponse, AuthUser, ForgotPasswordRequest, LoginPlatform, LoginRequest, RegisterRequest, ResetPasswordRequest, TotpChallenge } from '#shared/types/auth'
import type { LoginStartResponse } from '#shared/types/webauthn'

interface HubUserData {
  id: string
  email: string
  name: string
  username?: string
  roles?: string[]
  permissions?: string[]
  platform?: LoginPlatform
  createdAt?: string
  updatedAt?: string
}

interface HubAuthData {
  accessToken: string
  refreshToken: string
  expiresIn: number
  user: HubUserData
}

type HubLoginData = Partial<HubAuthData> & {
  totpRequired?: boolean
  pendingTotpToken?: string
  user?: HubUserData
}

interface HubMeData {
  userId: string
  email: string
  name: string
  username?: string
  roles?: string[]
  permissions?: string[]
  allowedRoutes?: string[]
  platform?: LoginPlatform
  createdAt?: string
  updatedAt?: string
}

// Module-scope state for proactive refresh and session expiry handling
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null
let isHandlingSessionExpired = false
/** Instance-bound toast API derived from the auto-imported useToast(). */
type ToastApi = ReturnType<typeof useToast>

// Instance-bound toast captured inside the setup context (see handleSessionExpired).
let boundToast: ToastApi | null = null

/** useToast() outside a component instance emits a Vue inject() warning; shield it. */
function useSafeToast(): ToastApi | null {
  try {
    // getCurrentInstance() is only non-null during setup/synchronous component work.
    return getCurrentInstance() ? useToast() : null
  } catch {
    return null
  }
}

export const useAuth = () => {
  const user = useState<AuthUser | null>('auth:user', () => null)
  const accessToken = useState<string | null>('auth:accessToken', () => null)
  const refreshToken = useState<string | null>('auth:refreshToken', () => null)
  const loading = useState('auth:loading', () => false)

  const config = useRuntimeConfig()
  const hubUrl = (config.public.hubUrl as string) || 'http://localhost:4000'
  const appId = (config.public.hubAppId as string) || 'tm-tools'

  // Capturing the toast binding while the setup context is still active lets
  // the async session-expiry path show toasts without the inject() warning.
  if (import.meta.client && boundToast === null) boundToast = useSafeToast()

  const isAuthenticated = computed(() => !!user.value)
  const can = (module: string, action: string) => {
    if (!user.value) return false
    const perms = user.value.permissions || []
    if (perms.includes('*')) return true
    const candidates = new Set<string>([`${module}.${action}`, `${module}:${action}`])
    if (action === 'write') {
      for (const a of ['upload', 'create', 'update', 'manage']) {
        candidates.add(`${module}.${a}`)
        candidates.add(`${module}:${a}`)
      }
    }
    if (action === 'manage') {
      for (const a of ['create', 'update', 'delete', 'write']) {
        candidates.add(`${module}.${a}`)
        candidates.add(`${module}:${a}`)
      }
    }
    if (module === 'logs' && action === 'read') {
      candidates.add('apps.logs.read')
      candidates.add('apps:logs.read')
    }
    return perms.some(p => candidates.has(p))
  }

  function applyAuthData(data: HubAuthData): AuthResponse {
    const formattedUser: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      username: data.user.username,
      role: data.user.roles?.[0] || 'user',
      permissions: data.user.permissions || [],
      platform: data.user.platform || 'web',
      createdAt: data.user.createdAt || new Date().toISOString(),
      updatedAt: data.user.updatedAt || new Date().toISOString()
    }

    user.value = formattedUser
    accessToken.value = data.accessToken
    refreshToken.value = data.refreshToken

    const cookieAccess = useCookie('accessToken', { maxAge: data.expiresIn, path: '/', sameSite: 'lax' })
    const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })

    cookieAccess.value = data.accessToken
    cookieRefresh.value = data.refreshToken

    scheduleProactiveRefresh(data.expiresIn)

    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      user: formattedUser
    }
  }

  async function login(credentials: LoginRequest): Promise<AuthResponse | TotpChallenge> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const { data } = await $fetch<{ success: boolean, data: HubLoginData }>(`${hubUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...credentials, appId }
      })

      if (data.totpRequired && data.pendingTotpToken && data.user) {
        return {
          totpRequired: true,
          pendingTotpToken: data.pendingTotpToken,
          user: { id: data.user.id, email: data.user.email, name: data.user.name }
        }
      }

      return applyAuthData(data as HubAuthData)
    } finally {
      loading.value = false
    }
  }

  async function verifyTotp(code: string, pendingTotpToken: string): Promise<AuthResponse> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const { data } = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/totp/login`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { code, pendingTotpToken, appId }
      })
      return applyAuthData(data)
    } finally {
      loading.value = false
    }
  }

  async function passkeyLogin(): Promise<AuthResponse> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const start = await $fetch<{ success: boolean, data: LoginStartResponse }>(`${hubUrl}/api/v1/auth/passkey/login/start`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { appId }
      })
      const opts = start.data

      const publicKey: PublicKeyCredentialRequestOptions = {
        challenge: b64urlToBuf(opts.challenge),
        rpId: opts.rpId,
        timeout: opts.timeout,
        allowCredentials: opts.allowCredentials?.map(c => ({
          id: b64urlToBuf(c.id),
          type: 'public-key' as const,
          transports: c.transports as AuthenticatorTransport[] | undefined
        })),
        userVerification: opts.userVerification as UserVerificationRequirement | undefined
      }

      const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null
      if (!credential) throw new Error('Passkey authentication cancelled')

      const assertion = credential.response as AuthenticatorAssertionResponse
      const serialized = {
        id: credential.id,
        rawId: bufToB64url(credential.rawId),
        type: 'public-key' as const,
        response: {
          clientDataJSON: bufToB64url(assertion.clientDataJSON),
          authenticatorData: bufToB64url(assertion.authenticatorData),
          signature: bufToB64url(assertion.signature),
          userHandle: assertion.userHandle ? bufToB64url(assertion.userHandle) : undefined
        }
      }

      const finish = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/passkey/login/finish`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { appId, credential: serialized }
      })
      return applyAuthData(finish.data)
    } finally {
      loading.value = false
    }
  }

  async function register(input: RegisterRequest): Promise<AuthResponse> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      const { data } = await $fetch<{ success: boolean, data: HubAuthData }>(`${hubUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...input, appId }
      })

      const formattedUser: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name,
        username: data.user.username,
        role: data.user.roles?.[0] || 'user',
        permissions: data.user.permissions || [],
        platform: data.user.platform || 'web',
        createdAt: data.user.createdAt || new Date().toISOString(),
        updatedAt: data.user.updatedAt || new Date().toISOString()
      }

      user.value = formattedUser
      accessToken.value = data.accessToken
      refreshToken.value = data.refreshToken

      const cookieAccess = useCookie('accessToken', { maxAge: data.expiresIn, path: '/', sameSite: 'lax' })
      const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })

      cookieAccess.value = data.accessToken
      cookieRefresh.value = data.refreshToken

      return {
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresIn: data.expiresIn,
        user: formattedUser
      }
    } finally {
      loading.value = false
    }
  }

  async function forgotPassword(input: ForgotPasswordRequest): Promise<void> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      await $fetch(`${hubUrl}/api/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...input, appId: input.appId || appId }
      })
    } finally {
      loading.value = false
    }
  }

  async function resetPassword(input: ResetPasswordRequest): Promise<void> {
    if (loading.value) return Promise.reject(new Error('Request in progress'))
    loading.value = true
    try {
      await $fetch(`${hubUrl}/api/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'X-App-Id': appId },
        body: { ...input, appId: input.appId || appId }
      })
    } finally {
      loading.value = false
    }
  }

  let refreshPromise: Promise<boolean> | null = null

  async function refresh(): Promise<boolean> {
    if (refreshPromise) return refreshPromise

    const rToken = refreshToken.value || useCookie('refreshToken').value
    if (!rToken) return false

    refreshPromise = (async () => {
      try {
        const res = await fetch(`${hubUrl}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Id': appId
          },
          body: JSON.stringify({ refreshToken: rToken, appId })
        })

        if (!res.ok) return false

        const json = await res.json()
        if (!json.success || !json.data) return false

        const data = json.data
        accessToken.value = data.accessToken
        refreshToken.value = data.refreshToken

        const cookieAccess = useCookie('accessToken', { maxAge: data.expiresIn, path: '/', sameSite: 'lax' })
        const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })

        cookieAccess.value = data.accessToken
        cookieRefresh.value = data.refreshToken

        scheduleProactiveRefresh(data.expiresIn)

        // Never let this user request re-enter its own pending refresh.
        await fetchUser(false)

        return true
      } catch {
        return false
      } finally {
        refreshPromise = null
      }
    })()

    return refreshPromise
  }

  function scheduleProactiveRefresh(expiresIn: number): void {
    if (!import.meta.client) return
    if (proactiveRefreshTimer) {
      clearTimeout(proactiveRefreshTimer)
      proactiveRefreshTimer = null
    }
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) return

    const leadSec = Math.min(120, Math.max(30, Math.floor(expiresIn * 0.15)))
    const delayMs = Math.max(5_000, (expiresIn - leadSec) * 1000)

    proactiveRefreshTimer = setTimeout(async () => {
      proactiveRefreshTimer = null
      const ok = await refresh()
      if (!ok) {
        await handleSessionExpired()
      }
    }, delayMs)
  }

  function clearProactiveRefresh(): void {
    if (proactiveRefreshTimer) {
      clearTimeout(proactiveRefreshTimer)
      proactiveRefreshTimer = null
    }
  }

  async function handleSessionExpired(): Promise<void> {
    if (isHandlingSessionExpired) return
    isHandlingSessionExpired = true

    try {
      await logout({ redirect: false })
      if (import.meta.client) {
        const router = useRouter()
        const currentPath = router.currentRoute.value.path
        if (currentPath !== '/login' && currentPath !== '/register') {
          const nuxtApp = useNuxtApp()
          const i18n = (nuxtApp as unknown as { $i18n?: { t: (key: string) => string } }).$i18n
          const t = (key: string) => (i18n ? i18n.t(key) : key)
          // useToast() is an inject() — calling it here (timer/refresh path, no
          // component instance) used to warn "inject() can only be used inside
          // setup()". The instance-bound binding is captured once in setup.
          const toast = boundToast ?? useSafeToast()
          if (toast) {
            toast.add({
              title: t('auth.sessionExpired'),
              description: t('auth.sessionExpiredDesc'),
              color: 'error'
            })
          }
          const redirect = router.currentRoute.value.fullPath
          await navigateTo(redirect && redirect !== '/' ? { path: '/login', query: { redirect } } : '/login')
        }
      }
    } finally {
      setTimeout(() => {
        isHandlingSessionExpired = false
      }, 1000)
    }
  }

  async function logout(options: { redirect?: boolean } = { redirect: true }): Promise<void> {
    try {
      const rToken = refreshToken.value || useCookie('refreshToken').value
      if (rToken) {
        await fetch(`${hubUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-App-Id': appId
          },
          body: JSON.stringify({ refreshToken: rToken })
        }).catch(() => { })
      }
    } catch {
      // Ignore logout errors
    } finally {
      clearProactiveRefresh()
      user.value = null
      accessToken.value = null
      refreshToken.value = null

      const cookieAccess = useCookie('accessToken', { path: '/' })
      const cookieRefresh = useCookie('refreshToken', { path: '/' })
      cookieAccess.value = null
      cookieRefresh.value = null

      if (options?.redirect !== false && import.meta.client) {
        const router = useRouter()
        if (router.currentRoute.value.path !== '/login') {
          await navigateTo('/login')
        }
      }
    }
  }

  async function fetchUser(allowRefresh = true): Promise<void> {
    try {
      // Cookie writes may not have flushed yet after token rotation.
      const token = accessToken.value || useCookie('accessToken').value
      if (!token) {
        if (!allowRefresh) throw new Error('Missing access token after refresh')
        const rToken = refreshToken.value || useCookie('refreshToken').value
        if (rToken) {
          const success = await refresh()
          if (success) return
        }
        user.value = null
        accessToken.value = null
        refreshToken.value = null
        if (import.meta.client) {
          const router = useRouter()
          if (router.currentRoute.value.path !== '/login' && router.currentRoute.value.path !== '/register') {
            await handleSessionExpired()
          }
        }
        return
      }

      accessToken.value = token
      refreshToken.value = refreshToken.value || useCookie('refreshToken').value || null

      const { data } = await $fetch<{ success: boolean, data: HubMeData }>(`${hubUrl}/api/v1/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-App-Id': appId
        }
      })

      user.value = {
        id: data.userId,
        email: data.email,
        name: data.name,
        username: data.username,
        role: data.roles?.[0] || 'user',
        permissions: data.permissions || [],
        platform: data.platform || 'web',
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: data.updatedAt || new Date().toISOString()
      }
    } catch (error) {
      if (!allowRefresh) throw error
      const success = await refresh()
      if (!success) {
        user.value = null
        accessToken.value = null
        refreshToken.value = null
        if (import.meta.client) {
          const router = useRouter()
          if (router.currentRoute.value.path !== '/login' && router.currentRoute.value.path !== '/register') {
            await handleSessionExpired()
          }
        }
      }
    }
  }

  async function revokeTokens(): Promise<void> {
    await logout({ redirect: true })
  }

  function setTokens(tokens: { accessToken: string, refreshToken: string, expiresIn: number }) {
    accessToken.value = tokens.accessToken
    refreshToken.value = tokens.refreshToken
    const cookieAccess = useCookie('accessToken', { maxAge: tokens.expiresIn, path: '/', sameSite: 'lax' })
    const cookieRefresh = useCookie('refreshToken', { maxAge: 604800, path: '/', sameSite: 'lax' })
    cookieAccess.value = tokens.accessToken
    cookieRefresh.value = tokens.refreshToken

    scheduleProactiveRefresh(tokens.expiresIn)
  }

  return {
    user: readonly(user),
    accessToken: readonly(accessToken),
    refreshToken: readonly(refreshToken),
    loading: readonly(loading),
    isAuthenticated,
    can,
    login,
    verifyTotp,
    passkeyLogin,
    register,
    forgotPassword,
    resetPassword,
    logout,
    refresh,
    fetchUser,
    handleSessionExpired,
    revokeTokens,
    setTokens
  }
}
