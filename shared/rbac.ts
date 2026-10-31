/**
 * Single source of truth for RBAC capabilities (shared by app + server).
 * Keep CAPABILITIES in sync with server enforcement (authz.hasCapability).
 */
export const CAPABILITIES = {
  // Application Registry
  APPS_READ: 'apps.read',
  APPS_CREATE: 'apps.create',
  APPS_UPDATE: 'apps.update',
  APPS_DELETE: 'apps.delete',
  APPS_ROTATE_SECRET: 'apps.rotateSecret',
  APPS_LOGS_READ: 'apps.logs.read',

  // Configuration
  CONFIGS_READ: 'configs.read',
  CONFIGS_WRITE: 'configs.write',
  CONFIGS_EXPORT: 'configs.export',

  // Connections (v1.23 — provider credentials per app: Cloudinary/Google/…)
  CONNECTIONS_READ: 'connections.read',
  CONNECTIONS_WRITE: 'connections.write',

  // Data Import (v1.24 — CSV/JSON/paste/Sheets → configs/users/routes)
  IMPORTS_READ: 'imports.read',
  IMPORTS_WRITE: 'imports.write',

  // Media
  MEDIA_READ: 'media.read',
  MEDIA_UPLOAD: 'media.upload',
  MEDIA_DELETE: 'media.delete',
  MEDIA_EXPORT: 'media.export',

  // Notifications
  NOTIFICATIONS_READ: 'notifications.read',
  NOTIFICATIONS_SEND: 'notifications.send',
  NOTIFICATIONS_MANAGE: 'notifications.manage',
  NOTIFICATIONS_EXPORT: 'notifications.export',

  // Mail
  MAIL_SEND: 'mail.send',
  MAIL_MANAGE: 'mail.manage',
  MAIL_ANALYTICS_READ: 'mail.analytics.read',

  // Users
  USERS_READ: 'users.read',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  USERS_EXPORT: 'users.export',
  USERS_IMPORT: 'users.import',

  // Roles
  ROLES_READ: 'roles.read',
  ROLES_MANAGE: 'roles.manage',

  // Routes
  ROUTES_READ: 'routes.read',
  ROUTES_MANAGE: 'routes.manage',

  // Permissions
  PERMISSIONS_READ: 'permissions.read',
  PERMISSIONS_CREATE: 'permissions.create',
  PERMISSIONS_UPDATE: 'permissions.update',
  PERMISSIONS_DELETE: 'permissions.delete',
  PERMISSIONS_MANAGE: 'permissions.manage',

  // Platform (ARCHITECTURE §2.4 — assignable only to tm-hub roles)
  PLATFORM_APPS_MANAGE: 'platform.apps.manage',
  PLATFORM_CROSSAPP_READ: 'platform.crossapp.read',
  PLATFORM_CROSSAPP_WRITE: 'platform.crossapp.write',
  PLATFORM_AUDIT_READ: 'platform.audit.read'
} as const

export type Capability = typeof CAPABILITIES[keyof typeof CAPABILITIES]

export interface CapabilityModuleDef {
  key: string
  actions: string[]
}

function buildModuleDefinitions(): CapabilityModuleDef[] {
  const map = new Map<string, string[]>()
  for (const cap of Object.values(CAPABILITIES)) {
    const idx = cap.indexOf('.')
    if (idx <= 0) continue
    const mod = cap.slice(0, idx)
    const action = cap.slice(idx + 1)
    const list = map.get(mod)
    if (list) list.push(action)
    else map.set(mod, [action])
  }
  return Array.from(map.entries()).map(([key, actions]) => ({ key, actions }))
}

/** Modules + actions for permission matrices / UI (derived from CAPABILITIES). */
export const MODULE_DEFINITIONS: CapabilityModuleDef[] = buildModuleDefinitions()

export const SYSTEM_CAPABILITIES: Capability[] = Object.values(CAPABILITIES)

export const CAPABILITY_GROUPS: Record<string, Capability[]> = MODULE_DEFINITIONS.reduce(
  (acc, m) => {
    acc[m.key] = m.actions.map(a => `${m.key}.${a}`) as Capability[]
    return acc
  },
  {} as Record<string, Capability[]>
)

export function isSystemCapability(capability: string): capability is Capability {
  return (SYSTEM_CAPABILITIES as string[]).includes(capability)
}

/** Full access: permissions contain module `*` with action `*` (e.g. seeded root role). */
export function isFullAccessRole(permissions?: Array<{ module: string, actions: string[] }> | null): boolean {
  return (permissions || []).some(p => p.module === '*' && (p.actions.includes('*') || p.actions.length === 0))
}

/** All routes allowed: allowedRoutes contains `*`. */
export function hasAllRoutes(allowedRoutes?: string[] | null): boolean {
  return (allowedRoutes || []).includes('*')
}

/**
 * Group flat permission codes (`apps.read`, `apps.logs.read`) back into
 * `{ module, actions }` entries. Split at the FIRST dot only — actions may
 * contain dots (e.g. `logs.read`).
 */
export function groupFlatPermissions(flat?: string[] | null): Array<{ module: string, actions: string[] }> {
  const grouped = new Map<string, string[]>()
  for (const code of flat || []) {
    const idx = code.indexOf('.')
    if (idx <= 0) continue
    const module = code.slice(0, idx)
    const action = code.slice(idx + 1)
    const list = grouped.get(module)
    if (!list) grouped.set(module, [action])
    else if (!list.includes(action)) list.push(action)
  }
  return Array.from(grouped.entries()).map(([module, actions]) => ({ module, actions }))
}

/** Minimal route info needed to decide access (ARCHITECTURE §5 — explicit permission, never inferred from path). */
export interface RouteAccessEntry {
  id: string
  requiredPermission?: string | null
}

/**
 * Accessible Routes are CALCULATED from role permissions + route.requiredPermission —
 * never stored as an independent authorization source (ARCHITECTURE §1/§4).
 *
 * - full-access role → `['*']`
 * - route without requiredPermission → accessible within the app (public scope)
 * - route with requiredPermission → accessible iff the role grants that capability
 */
export function computeAccessibleRouteIds(
  routes: RouteAccessEntry[],
  permissions?: Array<{ module: string, actions: string[] }> | null
): string[] {
  if (isFullAccessRole(permissions)) return ['*']
  const caps = new Set<string>()
  for (const p of permissions || []) {
    if (p.module === '*') continue
    for (const a of p.actions) caps.add(`${p.module}.${a}`)
  }
  const ids: string[] = []
  for (const r of routes) {
    if (!r.requiredPermission || caps.has(r.requiredPermission)) ids.push(r.id)
  }
  return ids
}
