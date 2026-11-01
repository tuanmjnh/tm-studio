export interface GridColumn {
  key: string
  label?: string
  sortable?: boolean
  class?: string
  rowClass?: string
  slot?: string
  headerClass?: string
  sort?: 'asc' | 'desc' | 1 | -1 | null
}

export interface GridSwipeAction<T> {
  color?: 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'
  icon?: string
  label?: string
  click?: (item: T) => void
}
