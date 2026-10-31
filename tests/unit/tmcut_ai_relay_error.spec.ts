import assert from 'node:assert/strict'
import './helpers/tmcut_store_env'
import { relayUpstreamError } from '../../server/utils/aiRelay'

/**
 * The AI relay failure path (R151 follow-up).
 *
 * Three free providers were configured and every chat call came back as a bare
 * `ai.network` / `ai.provider-unavailable` — the hub knew why (its error body
 * carries `data.detail`, e.g. "HTTP 404 — Function not found for account"), but
 * the tm-tools proxy dropped that field and the composable printed only the
 * code, so nothing on screen could tell a dead endpoint from a wrong model.
 * These checks pin both ends of the chain: the proxy keeps the detail, and the
 * message the UI prints contains it.
 */

const globalScope = globalThis as Record<string, unknown>

const CATALOG = {
  success: true,
  data: {
    connections: [{
      connectionId: 'c-nv',
      provider: 'nvidia',
      name: 'nvidia-main',
      adapterType: 'openai_compatible',
      origin: 'own',
      hasKey: true,
      model: '01-ai/yi-large',
      models: [{ modelId: '01-ai/yi-large', displayName: 'Yi Large' }]
    }]
  }
}

/** The shape ofetch hands back for a 502 thrown by our own proxy. */
const RELAY_502 = Object.assign(
  new Error('Failed to fetch with 502: Bad Gateway'),
  {
    statusCode: 502,
    data: {
      error: true,
      statusCode: 502,
      statusMessage: 'error.ai_relay',
      message: 'ai.provider-unavailable',
      data: { detail: 'HTTP 404 — Function not found for account' }
    }
  }
)

type FetchOptions = { body?: Record<string, unknown>, timeout?: number, method?: string }
type FetchCall = { url: string, options: FetchOptions }

type Mode = 'ok' | 'chat502' | 'chatTransportError' | 'catalogFails'

/**
 * Install a fake $fetch. Node has no `window`, so the composable never caches
 * the catalogue and every scenario starts clean.
 */
function stubFetch(mode: Mode) {
  const calls: FetchCall[] = []
  globalScope.$fetch = async (url: string, options: FetchOptions = {}) => {
    calls.push({ url: String(url), options })
    if (String(url).includes('/relay/catalog')) {
      if (mode === 'catalogFails') throw RELAY_502
      return CATALOG
    }
    if (mode === 'chat502') throw RELAY_502
    if (mode === 'chatTransportError') throw new Error('fetch failed')
    if (mode !== 'ok') throw new Error('chat must not be reached')
    return { success: true, data: { ok: true, content: 'PONG', provider: 'nvidia', model: '01-ai/yi-large', usage: null } }
  }
  return calls
}

let passed = 0

async function check(label: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`   ${label} PASSED`)
}

async function main() {
  console.log('=== [TMCut AI relay error path] Starting tests ===\n')

  const { useTmcutAi } = await import('../../app/composables/useTmcutAi')

  // ---- server proxy: hub body -> our own body --------------------------------
  await check('proxy forwards the hub data.detail instead of only the code', () => {
    const mapped = relayUpstreamError(RELAY_502, 'AI relay upstream failed')
    assert.equal(mapped.statusCode, 502)
    assert.equal(mapped.message, 'ai.provider-unavailable')
    assert.equal(mapped.statusMessage, 'error.ai_relay')
    assert.equal(mapped.data.detail, 'HTTP 404 — Function not found for account')
  })

  await check('proxy keeps a usable reason when the hub sent no detail', () => {
    const mapped = relayUpstreamError(
      Object.assign(new Error('x'), { statusCode: 502, data: { message: 'ai.invalid-key' } }),
      'AI relay upstream failed'
    )
    assert.equal(mapped.message, 'ai.invalid-key')
    assert.equal(mapped.data.detail, 'ai.invalid-key')
  })

  await check('proxy reports its own status when the hub itself is unreachable', () => {
    const mapped = relayUpstreamError(new Error('Unable to connect'), 'AI relay upstream failed')
    assert.equal(mapped.statusCode, 502)
    assert.equal(mapped.statusMessage, 'error.ai_relay')
    assert.equal(mapped.message, 'AI relay upstream failed')
    assert.equal(mapped.data.detail, 'AI relay upstream failed')
  })

  await check('proxy passes a 4xx from the hub through instead of flattening to 502', () => {
    const mapped = relayUpstreamError(
      Object.assign(new Error('x'), { statusCode: 404, data: { message: 'Connection is not usable by this app' } }),
      'AI relay upstream failed'
    )
    assert.equal(mapped.statusCode, 404)
  })

  // ---- composable: the string the UI prints ---------------------------------
  await check('a relay failure surfaces code AND provider detail', async () => {
    stubFetch('chat502')
    const { complete } = useTmcutAi()
    let message = ''
    try {
      await complete({ messages: [{ role: 'user', content: 'ping' }] })
    } catch (err) {
      message = String((err as Error).message)
    }
    assert.ok(message.includes('ai.provider-unavailable'), `code missing: ${message}`)
    assert.ok(message.includes('Function not found for account'), `detail missing: ${message}`)
  })

  await check('a proxy that never answered keeps its own transport reason', async () => {
    stubFetch('chatTransportError')
    const { complete } = useTmcutAi()
    let message = ''
    try {
      await complete({ messages: [{ role: 'user', content: 'ping' }] })
    } catch (err) {
      message = String((err as Error).message)
    }
    assert.equal(message, 'fetch failed')
  })

  await check('a per-surface timeout is sent to the relay, not only honoured on desktop', async () => {
    const calls = stubFetch('ok')
    const { complete } = useTmcutAi()
    const res = await complete({
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 8,
      timeoutMs: 20000
    })
    assert.equal(res.content, 'PONG')
    const chat = calls.find(c => c.url.includes('/relay/chat'))
    assert.ok(chat, 'no chat call recorded')
    assert.equal(chat.options.timeout, 20000)
    assert.equal(chat.options.body.model, '01-ai/yi-large')
  })

  await check('an unusable catalogue names the reason instead of blaming the hub config', async () => {
    stubFetch('catalogFails')
    const { complete } = useTmcutAi()
    let message = ''
    try {
      await complete({ messages: [{ role: 'user', content: 'ping' }] })
    } catch (err) {
      message = String((err as Error).message)
    }
    assert.ok(message.includes('No AI connection is usable'), message)
    assert.ok(message.includes('Function not found for account'), `catalogue reason missing: ${message}`)
  })

  await check('a connection probe targets that id and its own model', async () => {
    const calls = stubFetch('ok')
    const { probeConnection } = useTmcutAi()
    const res = await probeConnection('c-nv')
    assert.equal(res.content, 'PONG')
    const chat = calls.find(c => c.url.includes('/relay/chat'))
    assert.ok(chat, 'no chat call recorded')
    assert.equal(chat.options.body.connectionId, 'c-nv')
    assert.equal(chat.options.body.model, '01-ai/yi-large')
    assert.equal(res.provider, 'nvidia')
  })

  await check('a probe of a connection the app cannot use says so plainly', async () => {
    stubFetch('ok')
    const { probeConnection } = useTmcutAi()
    let message = ''
    try {
      await probeConnection('c-other')
    } catch (err) {
      message = String((err as Error).message)
    }
    assert.equal(message, 'Connection c-other is not usable by this app on TM Hub')
  })

  console.log(`\n=== All ${passed} tests passed successfully! ===`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
