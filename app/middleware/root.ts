export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) return

  const auth = useAuth()
  if (!auth.isAuthenticated.value) return navigateTo('/login')

  const user = auth.user.value
  const isRoot = user?.role === 'root' || user?.permissions?.includes('*')
  if (!isRoot) return navigateTo('/')
})
