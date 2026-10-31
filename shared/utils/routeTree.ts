import type { SystemRoute, RouteTreeNode } from '#shared/types/rbac'

export function buildRouteTree(flatRoutes: SystemRoute[]): RouteTreeNode[] {
  const map = new Map<string, RouteTreeNode>()
  const roots: RouteTreeNode[] = []

  const sorted = [...flatRoutes].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))

  for (const item of sorted) {
    map.set(item.id, { ...item, children: [] })
  }

  for (const item of sorted) {
    const current = map.get(item.id)!
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(current)
    } else {
      roots.push(current)
    }
  }

  return roots
}
