import type { NitroFetchOptions, NitroFetchRequest } from 'nitropack'
import { HubClient } from 'tm-hub-client'

export const useHub = () => {
  const config = useRuntimeConfig()
  const auth = useAuth()
  const tokenCookie = useCookie('accessToken')

  const hubUrl = (config.public.hubUrl as string) || 'http://localhost:4000'
  const appId = (config.public.hubAppId as string) || 'tm-tools'

  const client = new HubClient({
    baseUrl: hubUrl,
    appId: appId,
    getAccessToken: () => auth.accessToken.value || tokenCookie.value,
    onUnauthorized: () => {
      auth.handleSessionExpired()
    },
    getRefreshToken: () => auth.refreshToken.value || useCookie('refreshToken').value,
    onTokensRefreshed: (tokens) => {
      auth.setTokens(tokens)
    }
  })

  const seedPermissions = () => {
    const perms = auth.user.value?.permissions
    if (perms?.length) client.setPermissions([...perms])
  }
  seedPermissions()
  if (import.meta.client) {
    watch(() => auth.user.value?.permissions, seedPermissions)
  }

  const hubFetch = async <T = unknown>(
    path: string,
    options: NitroFetchOptions<NitroFetchRequest> = {}
  ): Promise<T> => {
    const fullUrl = path.startsWith('http') ? path : `${hubUrl}${path}`
    const headers = new Headers(options.headers as HeadersInit || {})

    if (!headers.has('X-App-Id')) {
      headers.set('X-App-Id', appId)
    }

    const token = auth.accessToken.value || tokenCookie.value
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    try {
      return (await $fetch(fullUrl, {
        ...options,
        headers
      })) as T
    } catch (err: unknown) {
      const status = (err as { statusCode?: number, response?: { status?: number } })?.statusCode
        || (err as { response?: { status?: number } })?.response?.status
        || (err as { status?: number })?.status

      if (status === 401 && !path.includes('/auth/login') && !path.includes('/auth/refresh') && !path.includes('/auth/register')) {
        const refreshed = await auth.refresh()
        if (refreshed) {
          const newToken = auth.accessToken.value || tokenCookie.value
          if (newToken) headers.set('Authorization', `Bearer ${newToken}`)
          return (await $fetch(fullUrl, {
            ...options,
            headers
          })) as T
        } else {
          await auth.handleSessionExpired()
        }
      }
      throw err
    }
  }

  return {
    client,
    hubUrl,
    appId,
    hubFetch,
    // Direct modular access via client
    auth: client.auth,
    apps: client.apps,
    configs: client.configs,
    media: client.media,
    notifications: client.notifications,
    users: client.users,
    roles: client.roles,
    routes: client.routes,
    permissions: client.permissions,
    capabilities: client.capabilities,
    logs: client.logs,
    connections: client.connections,
    imports: client.imports,
    export: client.export,
    mail: client.mail
  }
}
