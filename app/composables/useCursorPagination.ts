import { ref, shallowRef } from 'vue'

/**
 * Reusable cursor-based pagination state.
 * Generic over T. The `fetch` fn returns `{ items, nextCursor, hasMore }`.
 * Auto-imported via Nuxt (composables/). Reuse for any list needing
 * "load more" infinite scroll with a backend cursor.
 */
export type CursorToken = string | number | null

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
  const error = ref<unknown>(null)

  async function load(reset = false) {
    if (loading.value) return null
    if (!reset && !hasMore.value) return null
    loading.value = true
    try {
      const rs = await options.fetch(reset ? null : nextCursor.value, options.limit ?? 30)
      if (!rs) return null
      items.value = reset ? rs.items : [...items.value, ...rs.items]
      nextCursor.value = rs.nextCursor
      hasMore.value = rs.hasMore
      error.value = null
      return rs
    } catch (err) {
      // Every call site is fire-and-forget (`onMounted(() => pager.refresh())`,
      // a refresh button, a "load more" item), so a rethrow here becomes an
      // unhandled rejection and Vue reports a failed hook instead of a failed
      // request. Report it on `error` and let the page decide what to show.
      // Rows already on screen and `hasMore` stay untouched so a retry works.
      error.value = err
      return null
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
    error.value = null
  }

  return { items, nextCursor, hasMore, loading, error, refresh, loadMore, reset }
}
