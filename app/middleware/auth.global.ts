import type { RouteTreeNode } from '#shared/types/rbac'

export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return

  const publicPages = ['/login', '/register']
  if (publicPages.includes(to.path)) return

  const { fetchUser, isAuthenticated } = useAuth()

  if (!isAuthenticated.value) {
    await fetchUser()
  }

  if (!isAuthenticated.value && to.path !== '/login') {
    const redirect = to.fullPath !== '/' ? to.fullPath : undefined
    return navigateTo(redirect ? { path: '/login', query: { redirect } } : '/login')
  }

  const auth = useAuth()
  const user = auth.user.value
  if (!user) return

  const isRoot = user.role === 'root' || user.permissions?.includes('*')
  if (isRoot) return

  const nav = useNavMenu()
  const routes = await nav.fetchRoutes()

  if (canAccessPath(to.path, routes)) return
  return navigateTo(firstAllowedPath(routes) || '/')
})

function canAccessPath(path: string, nodes: RouteTreeNode[]): boolean {
  if (path === '/') return true
  for (const node of nodes) {
    if (node.path && (node.path === path || path.startsWith(node.path === '/' ? '/' : node.path + '/'))) {
      return true
    }
    if (node.children?.length && canAccessPath(path, node.children)) {
      return true
    }
  }
  return false
}

function firstAllowedPath(nodes: RouteTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.path && node.path !== '/') return node.path
    if (node.children?.length) {
      const child = firstAllowedPath(node.children)
      if (child) return child
    }
  }
  return null
}
