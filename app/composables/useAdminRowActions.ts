import type { DropdownMenuItem } from '@nuxt/ui'

export type RowActionConfig
  = | { type: 'view', label?: string, onSelect: () => void }
    | { type: 'edit', label?: string, onSelect: () => void }
    | { type: 'copy', label?: string, onSelect: () => void }
    | { type: 'toggleStatus', active: boolean, onSelect: () => void }
    | { type: 'logs', onSelect: () => void }
    | { type: 'delete', label?: string, visible?: boolean, onSelect: () => void }
    | {
      type: 'custom'
      label: string
      icon: string
      onSelect: () => void
      /** 0/undefined = main group, 1 = secondary group (icon color text-secondary) */
      group?: 0 | 1
      color?: DropdownMenuItem['color']
      ui?: DropdownMenuItem['ui']
    }

/**
 * Standard row-action dropdown builder for admin list pages.
 * Grouping: main actions → secondary (logs/copy) → danger (delete last).
 */
export function useAdminRowActions() {
  const { t } = useI18n()

  const buildRowActions = (configs: RowActionConfig[]): DropdownMenuItem[][] => {
    const main: DropdownMenuItem[] = []
    const secondary: DropdownMenuItem[] = []
    const danger: DropdownMenuItem[] = []

    for (const c of configs) {
      if (c.type === 'delete' && c.visible === false) continue

      switch (c.type) {
        case 'view':
          main.push({
            label: c.label || t('common.view'),
            icon: 'i-lucide-eye',
            ui: { itemLeadingIcon: 'text-info' },
            onSelect: c.onSelect
          })
          break
        case 'edit':
          main.push({
            label: c.label || t('common.edit'),
            icon: 'i-lucide-pencil',
            onSelect: c.onSelect
          })
          break
        case 'copy':
          secondary.push({
            label: c.label || t('common.copy'),
            icon: 'i-lucide-copy',
            ui: { itemLeadingIcon: 'text-secondary' },
            onSelect: c.onSelect
          })
          break
        case 'toggleStatus':
          main.push({
            label: c.active ? t('common.inactive') : t('common.active'),
            icon: c.active ? 'i-lucide-pause-circle' : 'i-lucide-check-circle-2',
            onSelect: c.onSelect
          })
          break
        case 'logs':
          secondary.push({
            label: t('common.viewLogs'),
            icon: 'i-lucide-scroll-text',
            ui: { itemLeadingIcon: 'text-secondary' },
            onSelect: c.onSelect
          })
          break
        case 'delete':
          danger.push({
            label: c.label || t('common.delete'),
            icon: 'i-lucide-trash-2',
            color: 'error',
            ui: { itemLeadingIcon: 'text-error' },
            onSelect: c.onSelect
          })
          break
        case 'custom': {
          const item: DropdownMenuItem = {
            label: c.label,
            icon: c.icon,
            onSelect: c.onSelect
          }
          if (c.color) item.color = c.color
          item.ui = c.ui || (c.group === 1 ? { itemLeadingIcon: 'text-secondary' } : undefined)
          if (c.group === 1) secondary.push(item)
          else main.push(item)
          break
        }
      }
    }

    const groups: DropdownMenuItem[][] = [main, secondary].filter(g => g.length > 0)
    if (danger.length) groups.push(danger)
    return groups
  }

  return { buildRowActions }
}
