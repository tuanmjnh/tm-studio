/** Auth startup regressions: execute the real composable and plugin without Nuxt or network I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createContext, runInContext } from 'node:vm'
import ts from 'typescript'
import { computed, readonly, ref, watch } from 'vue'
import type { Ref } from 'vue'
import type { useAuth } from '../../app/composables/useAuth'

type Auth = ReturnType<typeof useAuth>
interface FetchOptions {
  headers?: HeadersInit
}
interface FetchHooks {
  onRequest: (context: { options: FetchOptions }) => void
}
interface RefreshReply {
  ok: boolean
  json: () => Promise<unknown>
}

// Only erase types and Nuxt's build-time client flag; all auth control flow stays intact.
function compile(relativePath: string) {
  const path = fileURLToPath(new URL(relativePath, import.meta.url))
  return ts.transpileModule(readFileSync(path, 'utf8').replaceAll('import.meta.client', 'true'), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
}
const authCode = compile('../../app/composables/useAuth.ts')
const pluginCode = compile('../../app/plugins/auth.client.ts')
const tokens = { accessToken: 'fresh-access', refreshToken: 'rotated-refresh', expiresIn: 3600 }
const successReply = (): RefreshReply => ({ ok: true, json: async () => ({ success: true, data: { ...tokens } }) })

function harness(initialCookies: Record<string, string> = {}) {
  const cookies = new Map<string, string | null>(Object.entries(initialCookies))
  const pendingCookies = new Map<string, string | null>()
  const states = new Map<string, Ref>()
  const requests = {
    refresh: [] as RequestInit[],
    me: [] as Headers[],
    app: [] as Array<{ url: string, auth: string | null }>,
    logout: 0
  }
  const redirects: unknown[] = []
  const http = { refresh: async (): Promise<RefreshReply> => successReply(), meStatuses: [] as number[], appStatuses: [] as number[] }
  const appPayload = { ok: true, jobId: 'rj_test' }
  let hooks: FetchHooks | undefined

  const useCookie = (name: string) => {
    // Every call reads persisted cookies. Writes stay queued until explicitly flushed,
    // modeling a new useCookie() call before Nuxt's deferred cookie watcher commits.
    const cookie = ref(cookies.get(name) ?? null)
    watch(cookie, value => pendingCookies.set(name, value), { flush: 'sync' })
    return cookie
  }
  // Stands in for the ofetch instance the plugin builds: injects the request
  // headers, then answers with the scripted status for that route.
  const routedFetch = async (input: string | { url?: string }, options: FetchOptions = {}) => {
    hooks?.onRequest({ options })
    const headers = new Headers(options.headers)
    const url = typeof input === 'string' ? input : input.url || ''
    const status = url.endsWith('/api/v1/auth/me')
      ? http.meStatuses.shift() ?? 200
      : url.startsWith('/api/')
        ? http.appStatuses.shift() ?? 200
        : assert.fail(`unexpected $fetch request ${url}`)
    if (url.endsWith('/api/v1/auth/me')) {
      requests.me.push(headers)
      if (status !== 200) {
        throw Object.assign(new Error(`Mock /me HTTP ${status}`), { statusCode: status })
      }
      return { success: true, data: { userId: 'test-user', email: 'user@example.invalid', name: 'Test User' } }
    }
    requests.app.push({ url, auth: headers.get('Authorization') })
    if (status !== 200) {
      // ofetch rejects 4xx/5xx with a FetchError carrying statusCode — the hook
      // system cannot retry from inside the failed call.
      throw Object.assign(new Error(`Mock app HTTP ${status}`), { statusCode: status })
    }
    return appPayload
  }
  const context = createContext({
    exports: {},
    computed,
    readonly,
    Headers,
    getCurrentInstance: () => null,
    useState: (name: string, init: () => unknown) => {
      if (!states.has(name)) states.set(name, ref(init()))
      return states.get(name)
    },
    useCookie,
    useRuntimeConfig: () => ({ public: { hubUrl: 'https://hub.invalid', hubAppId: 'test-app' } }),
    useRouter: () => ({ currentRoute: ref({ path: '/tmcut', fullPath: '/tmcut' }) }),
    useNuxtApp: () => ({}),
    navigateTo: async (target: unknown) => { redirects.push(target) },
    // Real macrotasks, so a session-expiry path that awaits keeps working,
    // unref'ed so a scheduled proactive refresh cannot keep the runner alive.
    setTimeout: (fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms)
      timer.unref()
      return timer
    },
    clearTimeout: (timer: unknown) => { clearTimeout(timer as ReturnType<typeof setTimeout>) },
    fetch: async (url: string, options: RequestInit) => {
      if (url === 'https://hub.invalid/api/v1/auth/logout') {
        requests.logout++
        return { ok: true }
      }
      assert.equal(url, 'https://hub.invalid/api/v1/auth/refresh', 'unexpected native fetch request')
      requests.refresh.push(options)
      return http.refresh()
    },
    $fetch: Object.assign(routedFetch, {
      create: (options: FetchHooks) => {
        hooks = options
        return routedFetch
      }
    }),
    defineNuxtPlugin: (plugin: (app: object) => void) => plugin({})
  })
  runInContext(authCode, context)
  const createAuth = context.exports.useAuth as () => Auth
  context.useAuth = createAuth
  const auth = createAuth()
  // The plugin has its own composable instance, as it does in the application.
  context.exports = {}
  runInContext(pluginCode, context)

  return {
    auth,
    cookies,
    pendingCookies,
    requests,
    redirects,
    http,
    // The plugin replaces globalThis.$fetch (the context object) with its wrapper.
    call: (url: string | { url?: string }) => (context.$fetch as (u: string | { url?: string }) => Promise<unknown>)(url),
    flushCookies: () => {
      for (const [name, value] of pendingCookies) cookies.set(name, value)
      pendingCookies.clear()
    }
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// A deadlocked promise must fail the spec, not let Node silently exit successfully.
async function settles<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Auth operation did not settle')), 500)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

let passed = 0
let failed = 0
async function check(name: string, fn: () => Promise<void>) {
  try {
    await settles(fn())
    passed++
    console.log(`[ok] ${name}`)
  } catch (error) {
    failed++
    console.error(`[FAILED] ${name}: ${(error as Error).message}`)
  }
}

async function main() {
  await check('startup succeeds before the new access cookie is persisted', async () => {
    const h = harness({ refreshToken: 'cookie-refresh' })
    await h.auth.fetchUser()
    assert.equal(h.auth.user.value?.id, 'test-user')
    assert.equal(h.auth.isAuthenticated.value, true)
    assert.equal(h.requests.refresh.length, 1)
    assert.equal(h.requests.me.length, 1)
    assert.equal(h.requests.me[0]!.get('Authorization'), 'Bearer fresh-access')
    assert.equal(h.auth.refreshToken.value, 'rotated-refresh')
    assert.equal(h.cookies.has('accessToken'), false)
    assert.equal(h.cookies.get('refreshToken'), 'cookie-refresh')
    assert.equal(h.pendingCookies.get('accessToken'), 'fresh-access')
    assert.equal(h.redirects.length, 0)
    h.flushCookies()
    assert.equal(h.cookies.get('accessToken'), 'fresh-access')
    assert.equal(h.cookies.get('refreshToken'), 'rotated-refresh')
  })

  await check('fetchUser uses an in-memory refresh token when cookies are absent', async () => {
    const h = harness()
    h.auth.setTokens({ ...tokens, accessToken: '' })
    await h.auth.fetchUser()
    assert.equal(h.auth.user.value?.id, 'test-user')
    assert.equal(h.requests.refresh.length, 1)
    assert.equal(JSON.parse(h.requests.refresh[0]!.body as string).refreshToken, 'rotated-refresh')
  })

  await check('in-memory tokens win over stale access and refresh cookies', async () => {
    const h = harness({ accessToken: 'stale-access', refreshToken: 'stale-refresh' })
    h.auth.setTokens(tokens)
    await h.auth.fetchUser()
    assert.equal(h.requests.refresh.length, 0)
    assert.equal(h.requests.me[0]!.get('Authorization'), 'Bearer fresh-access')
    assert.equal(h.auth.accessToken.value, 'fresh-access')
    assert.equal(h.auth.refreshToken.value, 'rotated-refresh')
  })

  for (const status of [401, 500]) {
    await check(`refresh settles false on /me ${status}, without recursively refreshing`, async () => {
      const h = harness({ accessToken: 'old-access', refreshToken: 'old-refresh' })
      h.http.meStatuses = [status]
      assert.equal(await h.auth.refresh(), false)
      assert.equal(h.requests.refresh.length, 1)
      assert.equal(h.requests.me.length, 1)
      assert.equal(h.auth.user.value, null)
      assert.equal(h.redirects.length, 0)
      assert.equal(await h.auth.refresh(), true, 'the pending gate must clear after /me fails')
      assert.equal(h.requests.refresh.length, 2)
    })

    await check(`fetchUser retries /me ${status} once and recovers`, async () => {
      const h = harness({ accessToken: 'old-access', refreshToken: 'old-refresh' })
      h.http.meStatuses = [status, 200]
      await h.auth.fetchUser()
      assert.equal(h.auth.user.value?.id, 'test-user')
      assert.equal(h.requests.refresh.length, 1)
      assert.equal(h.requests.me.length, 2)
      assert.equal(h.requests.me[1]!.get('Authorization'), 'Bearer fresh-access')
      assert.equal(h.redirects.length, 0)
    })

    await check(`persistent /me ${status} settles startup and clears the session`, async () => {
      const h = harness({ accessToken: 'old-access', refreshToken: 'old-refresh' })
      h.http.meStatuses = [status, status]
      await h.auth.fetchUser()
      assert.equal(h.requests.refresh.length, 1)
      assert.equal(h.requests.me.length, 2)
      assert.equal(h.auth.user.value, null)
      assert.equal(h.auth.accessToken.value, null)
      assert.equal(h.auth.refreshToken.value, null)
      assert.equal(h.requests.logout, 1)
      assert.equal(h.redirects.length, 1)
    })
  }

  const refreshFailures: Array<[string, () => Promise<RefreshReply>]> = [
    ['HTTP failure', async () => ({ ok: false, json: async () => ({}) })],
    ['network rejection', async () => { throw new Error('Mock transport failure') }],
    ['unsuccessful payload', async () => ({ ok: true, json: async () => ({ success: false }) })],
    ['missing payload', async () => ({ ok: true, json: async () => ({ success: true }) })]
  ]
  for (const [name, failure] of refreshFailures) {
    await check(`refresh ${name} returns false and allows a later attempt`, async () => {
      const h = harness({ refreshToken: 'cookie-refresh' })
      h.http.refresh = failure
      assert.equal(await h.auth.refresh(), false)
      assert.equal(h.requests.me.length, 0)
      h.http.refresh = async () => successReply()
      assert.equal(await h.auth.refresh(), true)
      assert.equal(h.requests.refresh.length, 2)
      assert.equal(h.auth.user.value?.id, 'test-user')
    })
  }

  await check('an empty refresh token does not latch the pending gate', async () => {
    const h = harness({ refreshToken: '' })
    assert.equal(await h.auth.refresh(), false)
    assert.equal(h.requests.refresh.length, 0)
    h.cookies.set('refreshToken', 'later-refresh')
    assert.equal(await h.auth.refresh(), true)
    assert.equal(h.requests.refresh.length, 1)
    assert.equal(JSON.parse(h.requests.refresh[0]!.body as string).refreshToken, 'later-refresh')
    assert.equal(h.auth.user.value?.id, 'test-user')
  })

  await check('a refresh response without an access token fails rather than recursing', async () => {
    const h = harness({ refreshToken: 'cookie-refresh' })
    h.http.refresh = async () => ({ ok: true, json: async () => ({ success: true, data: { ...tokens, accessToken: '' } }) })
    assert.equal(await h.auth.refresh(), false)
    assert.equal(h.requests.refresh.length, 1)
    assert.equal(h.requests.me.length, 0)
  })

  for (const outcome of ['success', 'refresh failure', 'user failure']) {
    await check(`concurrent refresh callers all settle after ${outcome}`, async () => {
      const h = harness({ refreshToken: 'cookie-refresh' })
      const response = deferred<RefreshReply>()
      h.http.refresh = () => response.promise
      if (outcome === 'user failure') h.http.meStatuses = [401]
      const calls = [h.auth.refresh(), h.auth.refresh(), h.auth.refresh()]
      assert.equal(h.requests.refresh.length, 1, 'concurrent callers must share one refresh request')
      response.resolve(outcome === 'refresh failure' ? { ok: false, json: async () => ({}) } : successReply())
      const expected = outcome === 'success'
      assert.deepEqual(await Promise.all(calls), [expected, expected, expected])
      assert.equal(h.requests.refresh.length, 1)
      assert.equal(h.requests.me.length, outcome === 'refresh failure' ? 0 : 1)
      h.http.refresh = async () => successReply()
      assert.equal(await h.auth.refresh(), true)
      assert.equal(h.requests.refresh.length, 2, 'a settled gate must allow a new refresh')
    })
  }

  await check('the interceptor leaves /auth/me retry ownership to fetchUser for strings and Requests', async () => {
    const h = harness({ accessToken: 'old-access', refreshToken: 'cookie-refresh' })
    h.http.meStatuses = [401, 401]
    for (const request of ['/api/v1/auth/me', { url: 'https://hub.invalid/api/v1/auth/me' }]) {
      await assert.rejects(() => h.call(request))
    }
    assert.equal(h.requests.refresh.length, 0)
    assert.equal(h.requests.logout, 0)
    assert.equal(h.redirects.length, 0)
  })

  await check('a 401 on a protected request refreshes and replays it with the fresh token', async () => {
    // Regression: the access cookie expires while the refresh cookie survives,
    // so the first call after a reload reaches the server with no token.
    // Refreshing was not enough — the failed export POST was still lost.
    const h = harness({ refreshToken: 'cookie-refresh' })
    h.http.appStatuses = [401, 200]
    const result = await h.call('/api/v1/media/render')
    assert.deepEqual(result, { ok: true, jobId: 'rj_test' })
    assert.equal(h.requests.app.length, 2, 'the request must be replayed once')
    assert.equal(h.requests.app[0]!.auth, null)
    assert.equal(h.requests.app[1]!.auth, 'Bearer fresh-access')
    assert.equal(h.requests.refresh.length, 1, 'one 401 must trigger exactly one refresh')
    assert.equal(h.redirects.length, 0)
  })

  await check('a second 401 fails instead of looping', async () => {
    const h = harness({ refreshToken: 'cookie-refresh' })
    h.http.appStatuses = [401, 401]
    await assert.rejects(() => h.call('/api/v1/media/render'))
    assert.equal(h.requests.app.length, 2)
    assert.equal(h.requests.refresh.length, 1)
  })

  await check('a 401 with an unrefreshable session ends it and keeps the error', async () => {
    const h = harness({ refreshToken: 'cookie-refresh' })
    h.http.refresh = async () => ({ ok: false, json: async () => ({}) })
    h.http.appStatuses = [401]
    await assert.rejects(() => h.call('/api/v1/media/render'), /Mock app HTTP 401/)
    assert.equal(h.requests.app.length, 1)
    assert.equal(h.requests.logout, 1)
    assert.equal(h.redirects.length, 1)
  })

  await check('non-401 failures are not retried', async () => {
    const h = harness({ accessToken: 'fresh-access', refreshToken: 'cookie-refresh' })
    h.http.appStatuses = [500]
    await assert.rejects(() => h.call('/api/v1/media/render'))
    assert.equal(h.requests.app.length, 1)
    assert.equal(h.requests.refresh.length, 0)
  })

  console.log(`\n${passed} auth refresh checks passed; ${failed} FAILED`)
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
