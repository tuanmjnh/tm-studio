/**
 * `useCursorPagination` must not leak an unhandled rejection.
 *
 * The defect this pins: `load()` used `try/finally` with no `catch`. Every
 * caller that does not await — `onMounted(() => pager.refresh())`, a refresh
 * button, an "load more" menu item — got a floating promise. When the endpoint
 * fails, that promise rejects with nobody attached, so Vue reports
 * "Unhandled error during execution of mounted hook" and the console fills
 * with an error the page cannot act on. Seen live on
 * `app/pages/system/settings/sessions.vue:28` against a hub that answers 404
 * for `/api/v1/auth/sessions`.
 *
 * What the contract is: a failed load sets `error` and leaves `items` alone.
 * It must NOT throw at the fire-and-forget caller, and it must still clear
 * `loading` and keep the pager usable so a retry can succeed.
 */
import './helpers/tmcut_store_env'
import { useCursorPagination } from '../../app/composables/useCursorPagination'

let passed = 0
class CheckFailed extends Error {}
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
  } catch (error) {
    console.error(`FAILED: ${name}\n  ${(error as Error).message}`)
    throw error
  }
  passed++
  console.log(`[ok] ${name}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message)
}

/** Collect rejections that nothing handled, the way Vue's scheduler would. */
function trackUnhandled() {
  const seen: string[] = []
  const onUnhandled = (reason: unknown) => {
    seen.push(String((reason as Error)?.message ?? reason))
  }
  process.on('unhandledRejection', onUnhandled)
  return {
    seen,
    stop: () => process.off('unhandledRejection', onUnhandled)
  }
}

/** Let queued microtasks and the unhandledRejection hook run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 20))

async function main() {
  await check('a rejected fetch sets error, keeps items, and does not reject the caller', async () => {
    const tracker = trackUnhandled()
    try {
      const pager = useCursorPagination<{ id: string }>({
        fetch: async () => {
          throw new Error('Request failed with status 404')
        }
      })

      // The fire-and-forget shape the page actually uses.
      let threw = ''
      try {
        void pager.refresh()
      } catch (error) {
        threw = String((error as Error).message)
      }
      await settle()

      assert(threw === '', `refresh() threw synchronously instead of reporting: ${threw}`)
      assert(tracker.seen.length === 0, `an unhandled rejection escaped: ${tracker.seen.join(' | ')}`)
      assert(pager.error.value !== null, 'a failed load must expose the error')
      assert(
        String(pager.error.value?.message || pager.error.value).includes('404'),
        `the surfaced error must keep the cause, got ${String(pager.error.value)}`
      )
      assert(pager.items.value.length === 0, 'a failed first page must leave items empty')
      assert(pager.loading.value === false, 'loading must be cleared after a failure')
    } finally {
      tracker.stop()
    }
  })

  await check('a failure does not poison the pager: a retry can still succeed', async () => {
    let attempt = 0
    const pager = useCursorPagination<{ id: string }>({
      fetch: async () => {
        attempt++
        if (attempt === 1) throw new Error('Request failed with status 404')
        return { items: [{ id: 's1' }], nextCursor: null, hasMore: false }
      }
    })

    await pager.refresh()
    assert(pager.error.value !== null, 'the first attempt must record the error')

    await pager.refresh()
    assert(pager.error.value === null, 'a successful retry must clear the error')
    assert(pager.items.value.length === 1, 'the retry must populate items')
  })

  await check('a failure while appending keeps the rows already loaded', async () => {
    let attempt = 0
    const pager = useCursorPagination<{ id: string }>({
      fetch: async () => {
        attempt++
        if (attempt === 1) return { items: [{ id: 'a' }, { id: 'b' }], nextCursor: 'c2', hasMore: true }
        throw new Error('Request failed with status 500')
      }
    })

    await pager.refresh()
    assert(pager.items.value.length === 2, 'first page must load two rows')

    await pager.loadMore()
    assert(pager.items.value.length === 2, 'a failed append must not drop the rows already shown')
    assert(pager.error.value !== null, 'a failed append must surface the error')
    assert(pager.hasMore.value === true, 'a failed append must stay retryable')
    assert(pager.loading.value === false, 'loading must be cleared after a failed append')
  })

  await check('a successful load clears a previous error', async () => {
    let attempt = 0
    const pager = useCursorPagination<{ id: string }>({
      fetch: async () => {
        attempt++
        if (attempt === 1) throw new Error('boom')
        return { items: [{ id: 'x' }], nextCursor: null, hasMore: false }
      }
    })

    await pager.refresh()
    await pager.refresh()
    assert(pager.error.value === null, 'the error must not linger after a good load')
  })

  console.log(`\n=== All ${passed} cursor-pagination checks passed ===`)
}

main().catch((error) => {
  if (error instanceof CheckFailed) process.exit(1)
  console.error(error)
  process.exit(1)
})
