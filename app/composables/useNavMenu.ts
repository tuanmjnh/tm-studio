import type { NavigationMenuItem } from '@nuxt/ui'
import type { RouteTreeNode } from '#shared/types/rbac'
import type { HubSystemRoute } from 'tm-hub-client'

function mapHubRouteToRouteTreeNode(hubRoute: HubSystemRoute): RouteTreeNode {
  return {
    id: hubRoute.id,
    path: hubRoute.path,
    name: hubRoute.name,
    label: hubRoute.label,
    icon: hubRoute.icon,
    sort: hubRoute.sort,
    isVisible: hubRoute.isVisible,
    parentId: hubRoute.parentId,
    isDeleted: hubRoute.isDeleted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    children: hubRoute.children?.map(mapHubRouteToRouteTreeNode)
  }
}

export const useNavMenu = () => {
  const { t } = useI18n()
  const auth = useAuth()
  const { routes } = useHub()

  const allowedRoutes = useState<RouteTreeNode[]>('nav:allowedRoutes', () => [])

  async function fetchRoutes(force = false) {
    if (allowedRoutes.value.length > 0 && !force) return allowedRoutes.value
    if (!auth.isAuthenticated.value) return []

    try {
      const res = await routes.list()
      allowedRoutes.value = (res.data || []).map(mapHubRouteToRouteTreeNode)
    } catch {
      allowedRoutes.value = []
    }
    return allowedRoutes.value
  }

  function clearRoutes() {
    allowedRoutes.value = []
  }

  const translateRouteLabel = (label?: string | null, name?: string | null): string => {
    const raw = String(label || name || '')
    if (!raw) return ''
    const candidates = raw.startsWith('nav.') ? [raw] : [`nav.${raw}`, raw]
    for (const key of candidates) {
      const translated = t(key)
      if (translated && translated !== key) return translated
    }
    return raw
  }

  const translateLabel = (node: RouteTreeNode): string => translateRouteLabel(node.label, node.name)

  function mapRouteToNav(node: RouteTreeNode, open: Ref<boolean>): NavigationMenuItem {
    const label = translateLabel(node)

    if (node.children?.length) {
      return {
        label,
        icon: node.icon || 'i-lucide-folder',
        defaultOpen: false,
        type: 'trigger',
        children: node.children
          .filter((child: RouteTreeNode) => child.isVisible !== false)
          .map((child: RouteTreeNode) => mapRouteToNav(child, open))
      }
    }

    return {
      label,
      icon: node.icon || 'i-lucide-circle',
      to: node.path,
      onSelect: () => { open.value = false }
    }
  }

  function buildNavItems(open: Ref<boolean>): NavigationMenuItem[] {
    const hidden = new Set(['settings'])
    return allowedRoutes.value
      .filter((node: RouteTreeNode) => !hidden.has(node.name) && node.isVisible !== false)
      .map((node: RouteTreeNode) => mapRouteToNav(node, open))
  }

  return {
    allowedRoutes: readonly(allowedRoutes),
    fetchRoutes,
    clearRoutes,
    translateRouteLabel,
    buildNavItems
  }
}
