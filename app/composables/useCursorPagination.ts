import { ref, shallowRef } from 'vue'

/**
 * Reusable cursor-based pagination state.
 * Generic over T. The `fetch` fn returns `{ items, nextCursor, hasMore }`.
 * Auto-imported via Nuxt (composables/). Reuse for any list needing
 * "load more" infinite scroll with a backend cursor.
 */
export type CursorToken = any

type CursorPage<T> = {
  items: T[]
  nextCursor: CursorToken
  hasMore: boolean
}

export function useCursorPagination<T>(options: {
  fetch: (cursor: CursorToken, limit: number) => Promise<CursorPage<T> | undefined | null>
  limit?: number
}) {
  const items = shallowRef<T[]>([])
  const nextCursor = shallowRef<CursorToken>(null)
  const hasMore = ref(true)
  const loading = ref(false)

  async function load(reset = false) {
    if (loading.value) return
    if (!reset && !hasMore.value) return
    loading.value = true
    try {
      const rs = await options.fetch(reset ? null : nextCursor.value, options.limit ?? 30)
      if (!rs) return null
      items.value = reset ? rs.items : [...items.value, ...rs.items]
      nextCursor.value = rs.nextCursor
      hasMore.value = rs.hasMore
      return rs
    } finally {
      loading.value = false
    }
  }

  /** Reload the first page, replacing existing items. */
  const refresh = () => load(true)
  /** Append the next page (used by infinite scroll). */
  const loadMore = () => load(false)
  /** Clear current state / reset to start. */
  const reset = () => {
    items.value = []
    nextCursor.value = null
    hasMore.value = true
  }

  return { items, nextCursor, hasMore, loading, refresh, loadMore, reset }
}
