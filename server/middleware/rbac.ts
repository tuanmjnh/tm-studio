function checkPermission(userPermissions: string[], module: string, action: string): boolean {
  if (userPermissions.includes('*')) return true
  const candidates = [`${module}.${action}`, `${module}:${action}`]
  if (action === 'write') {
    candidates.push(`${module}.upload`, `${module}.create`, `${module}.update`, `${module}.manage`)
    candidates.push(`${module}:upload`, `${module}:create`, `${module}:update`, `${module}:manage`)
  }
  if (action === 'manage') {
    candidates.push(`${module}.create`, `${module}.update`, `${module}.delete`, `${module}.write`)
    candidates.push(`${module}:create`, `${module}:update`, `${module}:delete`, `${module}:write`)
  }
  if (module === 'logs' && action === 'read') {
    candidates.push('apps.logs.read', 'apps:logs.read')
  }
  return candidates.some(c => userPermissions.includes(c))
}

const permissionMap: Record<string, string> = {}

export default defineEventHandler(async (event) => {
  const auth = event.context.auth
  if (!auth) return

  if (auth.permissions?.includes('*') || auth.role === 'root') return

  const path = event.path
  const method = event.method || 'GET'

  for (const [prefix, permission] of Object.entries(permissionMap)) {
    if (path.startsWith(prefix)) {
      const action = method === 'GET' ? 'read' : method === 'POST' ? 'write' : method === 'DELETE' ? 'delete' : 'write'
      const module = permission.split(':')[0] || ''
      if (!checkPermission(auth.permissions || [], module, action)) {
        throw createError({ statusCode: 403, statusMessage: 'error.forbidden', message: `Insufficient permissions for ${module}:${action}` })
      }
    }
  }
})
