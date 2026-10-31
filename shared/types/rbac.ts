export type PermissionAction
  = | 'read'
    | 'create'
    | 'update'
    | 'write'
    | 'delete'
    | 'send'
    | 'manage'
    | 'rotateSecret'
    | '*'

export interface ModulePermission {
  module: string
  actions: PermissionAction[]
}

export interface SystemRoute {
  id: string
  path: string
  name: string
  label: string
  icon?: string
  sort: number
  isVisible: boolean
  parentId?: string | null
  isDeleted?: boolean
  requiredPermission?: string | null
  createdAt: string
  updatedAt: string
}

export interface RouteTreeNode extends SystemRoute {
  children?: RouteTreeNode[]
}

export interface Role {
  id: string
  name: string
  description: string
  permissions: ModulePermission[]
  allowedRoutes: string[]
  isSystem: boolean
  createdAt: string
  updatedAt: string
}

export interface UserRole {
  userId: string
  roleId: string
  assignedBy: string
  assignedAt: string
}

export interface RBACConfig {
  modules: ModuleDefinition[]
}

export interface ModuleDefinition {
  key: string
  label: string
  description: string
  icon?: string
  children?: ModuleDefinition[]
}

export interface PermissionCheck {
  module: string
  action: PermissionAction
}
