/**
 * Hub AI client (`app/composables/useHubAi.ts`) — the typed wrapper every AI
 * admin surface (key vault, import/export, model picker) calls.
 *
 * It is thin on purpose, so the only things worth pinning are the transport
 * rules: ids are URL-encoded, undefined/empty query values are dropped (an
 * `includeDisabled=` empty param would be a truthy-ish filter), object bodies
 * reach `hubFetch` untouched, and an envelope with `success: false` becomes a
 * thrown Error instead of silently returning `data: undefined`.
 */
import assert from 'node:assert/strict'

type Call = { path: string, options: { method?: string, body?: unknown } }
type Reply = { success?: boolean, data?: unknown, message?: string, statusMessage?: string }

const calls: Call[] = []
let reply: Reply = { success: true, data: null }

const globalScope = globalThis as Record<string, unknown>
// Nuxt auto-imports `useHub`; expose the stub the same way before the module
// under test resolves it.
globalScope.useHub = () => ({
  hubFetch: async (path: string, options: Call['options'] = {}) => {
    calls.push({ path, options })
    return reply
  }
})

let passed = 0

async function check(name: string, fn: () => Promise<void>) {
  calls.length = 0
  await fn()
  passed++
  console.log(`  ${name} PASSED`)
}

async function main() {
  const { useHubAi } = await import('../../app/composables/useHubAi')
  const ai = useHubAi()

  await check('listProviders GETs the encoded app namespace and unwraps data', async () => {
    reply = { success: true, data: [{ definition: { key: 'openai' }, connections: [] }] }
    const providers = await ai.listProviders('app 1')
    assert.equal(calls[0]!.path, '/api/v1/apps/app%201/ai/providers')
    assert.equal(calls[0]!.options.method || 'GET', 'GET')
    assert.equal(providers.length, 1)

    reply = { success: true }
    assert.deepEqual(await ai.listProviders('app-1'), [], 'a missing data field must read as no providers')
  })

  await check('listModels builds a query from set values only', async () => {
    reply = { success: true, data: [] }
    await ai.listModels('app-1', { provider: 'open ai', connectionId: 'c/1', includeDisabled: true })
    assert.equal(
      calls[0]!.path,
      '/api/v1/apps/app-1/ai/models?provider=open%20ai&connectionId=c%2F1&includeDisabled=true'
    )

    calls.length = 0
    await ai.listModels('app-1', { provider: '', connectionId: undefined })
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/models', 'empty filters must not be sent')
  })

  await check('discoverModels POSTs the credential test payload through', async () => {
    reply = { success: true, data: { baseUrl: 'https://x/v1', discovered: 1, persisted: 1, models: [] } }
    const body = { provider: 'openai', baseUrl: 'https://x/v1', apiKey: 'sk-test', persist: true }
    await ai.discoverModels('app-1', body)
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/discover')
    assert.equal(calls[0]!.options.method, 'POST')
    assert.equal(calls[0]!.options.body, body, 'the body must reach hubFetch unchanged (same reference)')
  })

  await check('saveCredential returns the connection + test verdict', async () => {
    reply = { success: true, data: { connection: { id: 'conn-1' }, test: { ok: true } } }
    const saved = await ai.saveCredential('app-1', {
      provider: 'openai',
      name: 'main',
      values: { AI_API_KEY: 'sk' },
      preserveSecrets: true
    })
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/connections/manual')
    assert.equal((calls[0]!.options.body as { preserveSecrets: boolean }).preserveSecrets, true)
    assert.equal(saved.connection.id, 'conn-1')
    assert.equal(saved.test.ok, true)
  })

  await check('toggleModel PATCHes the encoded model id with isEnabled', async () => {
    reply = { success: true, data: null }
    await ai.toggleModel('app-1', 'meta/llama', false)
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/models/meta%2Fllama')
    assert.equal(calls[0]!.options.method, 'PATCH')
    assert.deepEqual(calls[0]!.options.body, { isEnabled: false })
  })

  await check('deleteModel and deleteConnection DELETE their resource path', async () => {
    reply = { success: true, data: null }
    await ai.deleteModel('app-1', 'm 1')
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/models/m%201')
    assert.equal(calls[0]!.options.method, 'DELETE')

    calls.length = 0
    await ai.deleteConnection('app-1', 'conn/1')
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/connections/conn%2F1')
    assert.equal(calls[0]!.options.method, 'DELETE')
  })

  await check('grantConnection POSTs ids, revokeGrant DELETEs them as a query', async () => {
    reply = { success: true, data: null }
    await ai.grantConnection('app-1', { connectionId: 'c/1', targetAppId: 'other app' })
    assert.equal(calls[0]!.path, '/api/v1/apps/app-1/ai/grants')
    assert.deepEqual(calls[0]!.options.body, { connectionId: 'c/1', targetAppId: 'other app' })

    calls.length = 0
    await ai.revokeGrant('app-1', 'c/1', 'other app')
    assert.equal(
      calls[0]!.path,
      '/api/v1/apps/app-1/ai/grants?connectionId=c%2F1&targetAppId=other%20app'
    )
    assert.equal(calls[0]!.options.method, 'DELETE')
    assert.equal(calls[0]!.options.body, undefined)
  })

  await check('a success:false envelope throws the hub reason, not a silent undefined', async () => {
    reply = { success: false, message: 'ai.invalid-key' }
    await assert.rejects(() => ai.listProviders('app-1'), /ai\.invalid-key/)

    reply = { success: false, statusMessage: 'error.forbidden' }
    await assert.rejects(() => ai.listGrants('app-1'), /error\.forbidden/)

    reply = { success: false }
    await assert.rejects(() => ai.listProviders('app-1'), /Request failed/)
  })

  await check('listGrants unwraps data and tolerates a null list', async () => {
    reply = { success: true, data: null }
    assert.deepEqual(await ai.listGrants('app-1'), [])
    reply = { success: true, data: [{ connectionId: 'c1', appId: 'a', isEnabled: true }] }
    assert.equal((await ai.listGrants('app-1')).length, 1)
  })

  console.log(`\n=== All ${passed} hub-AI client checks passed ===`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
