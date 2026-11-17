// AI gateway unit tests — plain Node, no network, no Electron.
// Run: node --test electron/tools/ai-gateway.test.mjs
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const gw = require('./ai-gateway.cjs')
const configFile = require('./config-file.cjs')
const secure = require('./ai-secure.cjs')

describe('aiConfig', () => {
  it('freezes guarded defaults', () => {
    const cfg = gw.aiConfig({})
    assert.equal(cfg.provider, 'openai')
    assert.equal(cfg.baseUrl, 'https://api.openai.com/v1')
    assert.equal(cfg.maxTokens, 1024)
    assert.equal(cfg.timeoutMs, 60000)
    assert.equal(cfg.rpm, 30)
    assert.ok(Object.isFrozen(cfg))
  })

  it('rejects NaN numeric env (tm-trading failure class)', () => {
    const cfg = gw.aiConfig({ AI_TIMEOUT_MS: 'abc', AI_MAX_TOKENS: '', AI_RPM: 'xyz' })
    assert.equal(cfg.timeoutMs, 60000)
    assert.equal(cfg.maxTokens, 1024)
    assert.equal(cfg.rpm, 30)
  })

  it('selects family defaults', () => {
    assert.equal(gw.aiConfig({ AI_PROVIDER: 'anthropic' }).baseUrl, 'https://api.anthropic.com')
    assert.equal(gw.aiConfig({ AI_PROVIDER: 'ollama' }).baseUrl, 'http://localhost:11434/v1')
  })

  it('resolves per-task model overrides', () => {
    const cfg = gw.aiConfig({ AI_MODEL: 'base', AI_MODEL_TRANSCRIBE: 'whisper-x' })
    assert.equal(gw.resolveTaskModel('transcribe', cfg, { AI_MODEL: 'base', AI_MODEL_TRANSCRIBE: 'whisper-x' }), 'whisper-x')
    assert.equal(gw.resolveTaskModel('plan', cfg, { AI_MODEL: 'base' }), 'base')
  })
})

describe('RateLimiter', () => {
  it('allows rpm calls then rejects with wait time', () => {
    const limiter = new gw.RateLimiter(2, 60000)
    assert.equal(limiter.attempt(0).ok, true)
    assert.equal(limiter.attempt(1).ok, true)
    const rejected = limiter.attempt(2)
    assert.equal(rejected.ok, false)
    assert.ok(rejected.retryAfterMs > 0)
    assert.equal(limiter.attempt(60001).ok, true)
  })
})

describe('buildChatRequest', () => {
  it('builds OpenAI-compatible requests with json mode', () => {
    const req = gw.buildChatRequest(
      { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1' },
      { messages: [{ role: 'user', content: 'hi' }], model: 'm', jsonMode: true }
    )
    assert.equal(req.url, 'https://x/v1/chat/completions')
    assert.equal(req.headers.authorization, 'Bearer k')
    assert.deepEqual(req.body.response_format, { type: 'json_object' })
  })

  it('omits auth header without key (ollama local)', () => {
    const req = gw.buildChatRequest(
      { provider: 'ollama', apiKey: '', baseUrl: 'http://localhost:11434/v1' },
      { messages: [{ role: 'user', content: 'hi' }] }
    )
    assert.equal(req.headers.authorization, undefined)
  })

  it('builds Anthropic requests', () => {
    const req = gw.buildChatRequest(
      { provider: 'anthropic', apiKey: 'k', baseUrl: 'https://api.anthropic.com' },
      { messages: [{ role: 'user', content: 'hi' }], maxTokens: 10 }
    )
    assert.equal(req.url, 'https://api.anthropic.com/v1/messages')
    assert.equal(req.headers['x-api-key'], 'k')
    assert.equal(req.body.max_tokens, 10)
  })
})

describe('parseChatResponse', () => {
  it('parses OpenAI choices', () => {
    const out = gw.parseChatResponse('openai', { choices: [{ message: { content: 'hello' } }], usage: { total_tokens: 5 } })
    assert.equal(out.content, 'hello')
    assert.deepEqual(out.usage, { total_tokens: 5 })
  })

  it('parses Anthropic blocks', () => {
    const out = gw.parseChatResponse('anthropic', { content: [{ type: 'text', text: 'hi' }] })
    assert.equal(out.content, 'hi')
  })

  it('throws ai.bad-shape on empty content', () => {
    assert.throws(() => gw.parseChatResponse('openai', { choices: [] }), err => err.code === 'ai.bad-shape')
  })
})

describe('complete', () => {
  function stubFetch(json, status) {
    return async () => ({
      status: status || 200,
      text: async () => JSON.stringify(json)
    })
  }

  it('returns content with mocked fetch', async () => {
    const out = await gw.complete(
      { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { fetchImpl: stubFetch({ choices: [{ message: { content: 'yo' } }] }), logDir: null }
    )
    assert.equal(out.content, 'yo')
    assert.equal(out.model, 'm')
  })

  it('fails ai.no-key without credentials', async () => {
    await assert.rejects(
      gw.complete({ messages: [{ role: 'user', content: 'hi' }] }, { fetchImpl: stubFetch({}), logDir: null }),
      err => err.code === 'ai.no-key'
    )
  })

  it('maps 429 to ai.rate-limited', async () => {
    await assert.rejects(
      gw.complete(
        { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', messages: [{ role: 'user', content: 'hi' }] },
        { fetchImpl: stubFetch({}, 429), logDir: null }
      ),
      err => err.code === 'ai.rate-limited'
    )
  })

  it('maps timeouts to ai.timeout', async () => {
    const hanging = () => new Promise((resolve, reject) => {
      const err = new Error('aborted')
      err.name = 'AbortError'
      setTimeout(() => reject(err), 5)
    })
    await assert.rejects(
      gw.complete(
        { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', messages: [{ role: 'user', content: 'hi' }] },
        { fetchImpl: hanging, logDir: null }
      ),
      err => err.code === 'ai.timeout'
    )
  }, { timeout: 10000 })

  it('an unreachable endpoint reports ai.network, never a raw fetch error', async () => {
    const refused = async () => {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:1')
      err.code = 'ECONNREFUSED'
      throw err
    }
    await assert.rejects(
      gw.complete(
        { provider: 'custom', apiKey: 'k', baseUrl: 'http://127.0.0.1:1/v1', model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        { fetchImpl: refused, logDir: null }
      ),
      err => err.code === 'ai.network'
    )
  })

  it('a keyless gateway on a public base URL still completes', async () => {
    const out = await gw.complete(
      { provider: 'freellmapi', apiKey: '', baseUrl: 'https://gw.example.test/v1', model: 'auto', messages: [{ role: 'user', content: 'hi' }] },
      { fetchImpl: stubFetch({ choices: [{ message: { content: 'yo' } }] }), logDir: null }
    )
    assert.equal(out.content, 'yo')
  })

  it('a 200 with no message content is ai.bad-shape, not ai.network', async () => {
    await assert.rejects(
      gw.complete(
        { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        { fetchImpl: stubFetch({ choices: [{ message: { content: '' } }] }), logDir: null }
      ),
      err => err.code === 'ai.bad-shape'
    )
  })
})

describe('transcribe', () => {
  function fixtureFile() {
    const dir = mkdtempSync(join(tmpdir(), 'tmcut-ai-'))
    const file = join(dir, 'sample.mp3')
    writeFileSync(file, Buffer.from([0x49, 0x44, 0x33]))
    return { dir, file }
  }

  it('returns text with mocked fetch', async () => {
    const { dir, file } = fixtureFile()
    try {
      const out = await gw.transcribe(
        { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', model: 'whisper-1', filePath: file },
        {
          fetchImpl: async () => ({ status: 200, text: async () => JSON.stringify({ text: 'hello world' }) })
        }
      )
      assert.equal(out.text, 'hello world')
      assert.equal(out.segments, undefined)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('parses verbose_json segments when requested', async () => {
    const { dir, file } = fixtureFile()
    try {
      const out = await gw.transcribe(
        { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1', filePath: file, format: 'verbose_json' },
        {
          fetchImpl: async () => ({
            status: 200,
            text: async () => JSON.stringify({
              text: 'hi there',
              segments: [
                { start: 0, end: 1.5, text: 'hi' },
                { start: 1.5, end: 3, text: 'there' },
                { start: 'x', end: 4 }
              ]
            })
          })
        }
      )
      assert.equal(out.segments.length, 2)
      assert.deepEqual(out.segments[0], { start: 0, end: 1.5, text: 'hi' })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails ai.no-file for unreadable paths', async () => {
    await assert.rejects(
      gw.transcribe({ filePath: join(tmpdir(), 'tmcut-missing-file.mp3') }, {}),
      err => err.code === 'ai.no-file'
    )
  })
})

// ===== Aggregator support (one base URL, many providers/models) =============
// FreeLLMAPI-style gateways: the endpoint and the model ids cannot be guessed,
// so both must be explicit and every gap must fail loudly instead of silently
// falling back to api.openai.com (the pre-R128 behaviour).

describe('provider presets', () => {
  it('exposes picker-ready presets including the multi-provider gateway', () => {
    const presets = gw.providerPresets()
    const byId = Object.fromEntries(presets.map(p => [p.id, p]))
    assert.ok(byId.freellmapi && byId.custom)
    assert.equal(byId.freellmapi.needsBaseUrl, true)
    assert.equal(byId.freellmapi.requiresModel, true)
    assert.equal(byId.ollama.keyless, true)
    assert.equal(byId.gemini.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai')
  })

  it('does not silently default an unknown provider to api.openai.com', () => {
    assert.equal(gw.needsBaseUrl('some-aggregator'), true)
    assert.equal(gw.needsBaseUrl('openai'), false)
    assert.equal(gw.aiConfig({ AI_PROVIDER: 'some-aggregator' }).baseUrl, '')
  })

  it('reports configuration gaps in the masked status', () => {
    const status = gw.maskedStatus()
    assert.equal(typeof status.configured, 'boolean')
    assert.equal(typeof status.needsBaseUrl, 'boolean')
    assert.equal(typeof status.needsModel, 'boolean')
    assert.ok('providerLabel' in status)
  })
})

describe('listModels (multi-provider discovery)', () => {
  const okBody = body => ({ status: 200, text: async () => JSON.stringify(body) })

  it('parses the OpenAI {data:[{id}]} shape, sorted', async () => {
    const out = await gw.listModels(
      { provider: 'openai', apiKey: 'k', baseUrl: 'https://x/v1' },
      { fetchImpl: async () => okBody({ data: [{ id: 'b-model' }, { id: 'a-model' }] }) }
    )
    assert.deepEqual(out.models.map(m => m.id), ['a-model', 'b-model'])
    assert.equal(out.count, 2)
    assert.equal(out.baseUrl, 'https://x/v1')
    assert.equal(out.provider, 'openai')
  })

  it('parses an aggregator {models:[{id|name}]} shape and dedupes', async () => {
    const out = await gw.listModels(
      { provider: 'freellmapi', apiKey: 'k', baseUrl: 'https://gw/v1' },
      { fetchImpl: async () => okBody({ models: [{ id: 'gpt-4o' }, { id: 'gpt-4o' }, { name: 'claude-sonnet' }] }) }
    )
    assert.deepEqual(out.models.map(m => m.id), ['claude-sonnet', 'gpt-4o'])
  })

  it('requires an endpoint and credentials before calling out', async () => {
    await assert.rejects(
      gw.listModels({ provider: 'freellmapi', apiKey: 'k', baseUrl: '' }),
      err => err.code === 'ai.no-base-url'
    )
    await assert.rejects(
      gw.listModels({ provider: 'custom', baseUrl: 'https://gw/v1' }),
      err => err.code === 'ai.no-key'
    )
  })

  it('maps an http error and keeps the status', async () => {
    await assert.rejects(
      gw.listModels(
        { provider: 'custom', apiKey: 'k', baseUrl: 'https://gw/v1' },
        { fetchImpl: async () => ({ status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) }) }
      ),
      err => err.code === 'ai.http-error' && err.status === 401
    )
  })

  it('rejects a response without model ids', async () => {
    await assert.rejects(
      gw.listModels(
        { provider: 'custom', apiKey: 'k', baseUrl: 'https://gw/v1' },
        { fetchImpl: async () => okBody({ data: [] }) }
      ),
      err => err.code === 'ai.bad-shape'
    )
  })
})

describe('aggregator misconfiguration fails loudly', () => {
  it('ai.no-base-url when the gateway endpoint is missing', async () => {
    await assert.rejects(
      gw.complete({ provider: 'freellmapi', apiKey: 'k', baseUrl: '', model: 'x', messages: [{ role: 'user', content: 'hi' }] }),
      err => err.code === 'ai.no-base-url'
    )
  })

  it('ai.no-model when the aggregator model is not chosen', async () => {
    await assert.rejects(
      gw.complete({ provider: 'freellmapi', apiKey: 'k', baseUrl: 'https://gw.test/v1', messages: [{ role: 'user', content: 'hi' }] }),
      err => err.code === 'ai.no-model'
    )
  })

  it('a fully configured aggregator reaches the endpoint', async () => {
    const out = await gw.complete(
      {
        provider: 'freellmapi',
        apiKey: 'k',
        baseUrl: 'https://gw.test/v1',
        model: 'some/model',
        messages: [{ role: 'user', content: 'hi' }]
      },
      {
        fetchImpl: async () => ({
          status: 200,
          text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
        })
      }
    )
    assert.equal(out.content, 'ok')
    assert.equal(out.model, 'some/model')
  })
})

// ===== Per-surface task routing (editor script vs AutoCut captions) ========
// config.env slots: AI_PROVIDER_<T> / AI_BASE_URL_<T> / AI_API_KEY_<T> /
// AI_MODEL_<T> for T in PLAN | TRIAGE | TRANSCRIBE. Surfaces without slots
// keep the global config, so one gateway can run script-writing on one
// provider and transcription on another.

describe('task config slots', () => {
  const env = {
    AI_PROVIDER: 'openai',
    AI_API_KEY: 'global-key',
    AI_MODEL: 'gpt-4o-mini',
    AI_PROVIDER_TRANSCRIBE: 'groq',
    AI_API_KEY_TRANSCRIBE: 'groq-key',
    AI_MODEL_TRANSCRIBE: 'whisper-large-v3'
  }

  it('global task keeps the global config', () => {
    const plan = gw.taskConfig('plan', env)
    assert.equal(plan.provider, 'openai')
    assert.equal(plan.model, 'gpt-4o-mini')
    assert.equal(plan.baseUrl, 'https://api.openai.com/v1')
    assert.equal(plan.apiKey, 'global-key')
  })

  it('a slotted task switches provider AND re-scopes endpoint + model', () => {
    const stt = gw.taskConfig('transcribe', env)
    assert.equal(stt.provider, 'groq')
    assert.equal(stt.baseUrl, 'https://api.groq.com/openai/v1')
    assert.equal(stt.apiKey, 'groq-key')
    assert.equal(stt.model, 'whisper-large-v3')
    assert.equal(stt.task, 'TRANSCRIBE')
  })

  it('a switched provider without a model slot gets the new provider default, not the global model', () => {
    const switched = gw.taskConfig('triage', {
      ...env,
      AI_PROVIDER_TRIAGE: 'anthropic'
    })
    assert.equal(switched.provider, 'anthropic')
    assert.equal(switched.model, 'claude-haiku-4-5')
    assert.equal(switched.apiKey, 'global-key') // key falls back to global
  })

  it('unknown task names get no slots (no invented env keys)', () => {
    const odd = gw.taskConfig('exfiltrate', env)
    assert.equal(odd.provider, 'openai')
    assert.equal(odd.model, 'gpt-4o-mini')
  })

  it('aiConfig stays the no-task shape (back-compat)', () => {
    const cfg = gw.aiConfig(env)
    assert.equal(cfg.provider, 'openai')
    assert.equal(cfg.task, '')
  })

  it('complete() honours the task slots end to end', async () => {
    const saved = { ...process.env }
    let asked = null
    try {
      process.env.AI_PROVIDER = 'openai'
      delete process.env.AI_API_KEY // the keyless ollama slot must not see a global key
      process.env.AI_MODEL = 'gpt-4o-mini'
      process.env.AI_PROVIDER_TRANSCRIBE = 'ollama'
      process.env.AI_API_KEY_TRANSCRIBE = ''
      process.env.AI_MODEL_TRANSCRIBE = 'whisper'
      const out = await gw.complete(
        { task: 'transcribe', messages: [{ role: 'user', content: 'hi' }] },
        {
          fetchImpl: async (url, init) => {
            asked = { url, auth: init.headers.authorization || null }
            return { status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }) }
          }
        }
      )
      assert.equal(out.content, 'ok')
      // The TRANSCRIBE slot re-scoped the endpoint (not openai) and used
      // its model; keyless ollama sends no auth header.
      assert.ok(asked.url.startsWith('http://localhost:11434/v1/chat/completions'))
      assert.equal(asked.auth, null)
      assert.equal(out.model, 'whisper')
    } finally {
      for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_PROVIDER_TRANSCRIBE', 'AI_API_KEY_TRANSCRIBE', 'AI_MODEL_TRANSCRIBE']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })

  it('tasksStatus reports every surface with its own provider', () => {
    const saved = { ...process.env }
    try {
      process.env.AI_PROVIDER = 'openai'
      process.env.AI_API_KEY = 'k'
      process.env.AI_MODEL = 'gpt-4o-mini'
      process.env.AI_PROVIDER_TRANSCRIBE = 'ollama'
      process.env.AI_MODEL_TRANSCRIBE = 'whisper'
      const st = gw.tasksStatus()
      assert.equal(st.plan.provider, 'openai')
      assert.equal(st.plan.overridden, false)
      assert.equal(st.plan.configured, true)
      assert.equal(st.transcribe.provider, 'ollama')
      assert.equal(st.transcribe.overridden, true)
      assert.equal(st.transcribe.configured, true) // keyless counts
    } finally {
      for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_MODEL', 'AI_PROVIDER_TRANSCRIBE', 'AI_MODEL_TRANSCRIBE']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })

  // R139 (§203): "test this saved surface" resolves the AI_*_<TASK> slots
  // server-side — the renderer never holds the stored key it verifies.
  it('listModels(task) signs with the SAVED per-surface key', async () => {
    const saved = { ...process.env }
    let asked = null
    try {
      process.env.AI_PROVIDER = 'openai'
      process.env.AI_API_KEY = 'global-key'
      process.env.AI_BASE_URL = 'https://global.example/v1'
      process.env.AI_PROVIDER_TRANSCRIBE = 'groq'
      process.env.AI_API_KEY_TRANSCRIBE = 'surface-key'
      const out = await gw.listModels(
        { task: 'transcribe' },
        {
          fetchImpl: async (url, init) => {
            asked = { url, auth: init.headers.authorization || null }
            return { status: 200, text: async () => JSON.stringify({ data: [{ id: 'whisper-1' }] }) }
          }
        }
      )
      // The SURFACE's endpoint + key won, not the global pair.
      assert.ok(asked.url.startsWith('https://api.groq.com'), `got ${asked.url}`)
      assert.equal(asked.auth, 'Bearer surface-key')
      assert.equal(out.models[0].id, 'whisper-1')
    } finally {
      for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_PROVIDER_TRANSCRIBE', 'AI_API_KEY_TRANSCRIBE']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })

  it('listModels without a task still reads the global config', async () => {
    const saved = { ...process.env }
    let asked = null
    try {
      process.env.AI_PROVIDER = 'openai'
      process.env.AI_API_KEY = 'global-key'
      process.env.AI_BASE_URL = 'https://global.example/v1'
      process.env.AI_PROVIDER_TRANSCRIBE = 'groq'
      process.env.AI_API_KEY_TRANSCRIBE = 'surface-key'
      await gw.listModels(
        {},
        {
          fetchImpl: async (url, init) => {
            asked = { url, auth: init.headers.authorization || null }
            return { status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-x' }] }) }
          }
        }
      )
      assert.ok(asked.url.startsWith('https://global.example/v1/models'))
      assert.equal(asked.auth, 'Bearer global-key')
    } finally {
      for (const key of ['AI_PROVIDER', 'AI_API_KEY', 'AI_BASE_URL', 'AI_PROVIDER_TRANSCRIBE', 'AI_API_KEY_TRANSCRIBE']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })
})

// ===== config.env append helper (R18-2) =====================================
// AI_CONFIG_SECRET is generated on first run and must be added WITHOUT
// rewriting the file: a rewrite drops comments and `********` masks, and the
// in-memory values are decrypted while the file holds keychain tokens.

describe('appendConfigValue', () => {
  const fakeStorage = {
    encryptString: s => Buffer.from(`enc:${s}`),
    decryptString: b => b.toString().slice(4),
    isEncryptionAvailable: () => true
  }

  function withFakeStorage(fn) {
    secure.__setSafeStorage(fakeStorage)
    try {
      return fn()
    } finally {
      secure.__setSafeStorage(null)
    }
  }

  function withFile(content) {
    const dir = mkdtempSync(join(tmpdir(), 'tmcut-config-'))
    const file = join(dir, 'config.env')
    if (content !== null) writeFileSync(file, content)
    return { dir, file }
  }

  it('leaves every existing line byte-identical and adds exactly one line', () => {
    const original = [
      '# AI keys for this install',
      'AI_API_KEY=tmcut:enc:v1:preexisting',
      'AI_BASE_URL=https://x/v1'
    ].join('\n') + '\n'
    const { dir, file } = withFile(original)
    try {
      withFakeStorage(() => configFile.appendConfigValue(file, 'AI_CONFIG_SECRET', 'master-value'))
      const after = readFileSync(file, 'utf8')
      assert.ok(after.startsWith(original), 'existing lines must not move or change')
      const appended = after.slice(original.length)
      assert.ok(appended.startsWith('AI_CONFIG_SECRET='))
      assert.ok(appended.endsWith('\n'))
      assert.equal(appended.trimEnd().split('\n').length, 1, 'exactly one new line')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('encrypts a secret slot and round-trips through decrypt', () => {
    const { dir, file } = withFile('AI_MODEL=gpt-4o-mini\n')
    try {
      withFakeStorage(() => configFile.appendConfigValue(file, 'AI_CONFIG_SECRET', 'master-value'))
      const stored = configFile.readConfigFile(file).values.AI_CONFIG_SECRET
      assert.ok(stored.startsWith('tmcut:enc:v1:'), 'the master key must not sit in the file as plaintext')
      assert.equal(withFakeStorage(() => secure.decrypt(stored)), 'master-value')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes a non-secret key as plaintext even with a keychain available', () => {
    const { dir, file } = withFile(null)
    try {
      withFakeStorage(() => configFile.appendConfigValue(file, 'AI_BASE_URL', 'https://local.example/v1'))
      assert.equal(readFileSync(file, 'utf8'), 'AI_BASE_URL=https://local.example/v1\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('separates the new line from a file without a trailing newline', () => {
    const { dir, file } = withFile('AI_MODEL=gpt-4o-mini')
    try {
      withFakeStorage(() => configFile.appendConfigValue(file, 'AI_CONFIG_SECRET', 'master-value'))
      const lines = readFileSync(file, 'utf8').split('\n')
      assert.equal(lines[0], 'AI_MODEL=gpt-4o-mini', 'the old line must not be glued to the new one')
      assert.ok(lines[1].startsWith('AI_CONFIG_SECRET='))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ===== startup master-key decision ===========================================
// A master key that is silently replaced is worse than a missing one: every
// row sealed with the old key stops opening and nothing says why. These cases
// pin the decision `loadUserConfig()` takes before it appends anything.

describe('master-key startup decision', () => {
  const fakeStorage = {
    encryptString: s => Buffer.from(`enc:${s}`),
    decryptString: b => b.toString().slice(4),
    isEncryptionAvailable: () => true
  }
  // simulate a token sealed on another machine / a reset keychain
  const corruptStorage = {
    encryptString: s => Buffer.from(`enc:${s}`),
    decryptString: () => { throw new Error('cannot decrypt') },
    isEncryptionAvailable: () => true
  }

  function withStorage(storage, fn) {
    secure.__setSafeStorage(storage)
    try {
      return fn()
    } finally {
      secure.__setSafeStorage(null)
    }
  }

  function withFile(content) {
    const dir = mkdtempSync(join(tmpdir(), 'tmcut-master-'))
    const file = join(dir, 'config.env')
    if (content !== null) writeFileSync(file, content)
    return { dir, file }
  }

  function startup(file, currentEnv) {
    const values = configFile.readConfigFile(file).values
    return configFile.ensureMasterKey(file, {
      values,
      currentEnv,
      decrypt: secure.decrypt,
      encryptionAvailable: secure.isEncryptionAvailable()
    })
  }

  it('generates exactly one line when the file has no master key slot', () => {
    const { dir, file } = withFile('AI_MODEL=gpt-4o-mini\n')
    try {
      const before = readFileSync(file, 'utf8')
      const out = withStorage(fakeStorage, () => startup(file, undefined))
      assert.equal(out.decision, 'generate')
      assert.ok(out.value, 'a generated key must be returned for the env')
      const after = readFileSync(file, 'utf8')
      assert.ok(after.startsWith(before), 'existing lines must stay byte-identical')
      const added = after.slice(before.length).trimEnd().split('\n')
      assert.equal(added.length, 1, 'exactly one new line')
      assert.ok(added[0].startsWith('AI_CONFIG_SECRET='))
      assert.ok(
        configFile.readConfigFile(file).values.AI_CONFIG_SECRET.startsWith('tmcut:enc:v1:'),
        'the generated key must be a keychain token, not plaintext'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats an empty slot as absent (first run after a wiped panel)', () => {
    const { dir, file } = withFile('AI_CONFIG_SECRET=\n')
    try {
      const out = withStorage(fakeStorage, () => startup(file, undefined))
      assert.equal(out.decision, 'generate')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps a slot it can open and adds no second line', () => {
    const sealed = withStorage(fakeStorage, () => secure.encrypt('master-value'))
    const { dir, file } = withFile(`AI_CONFIG_SECRET=${sealed}\n`)
    try {
      const out = withStorage(fakeStorage, () => startup(file, undefined))
      assert.equal(out.decision, 'keep')
      assert.equal(out.value, null)
      assert.equal(readFileSync(file, 'utf8'), `AI_CONFIG_SECRET=${sealed}\n`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('an operator-provided env value wins without touching the file', () => {
    const { dir, file } = withFile('AI_MODEL=gpt-4o-mini\n')
    try {
      const out = withStorage(fakeStorage, () => startup(file, 'from-env'))
      assert.equal(out.decision, 'keep')
      assert.equal(readFileSync(file, 'utf8'), 'AI_MODEL=gpt-4o-mini\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Fails against the old unconditional generate: that path appended a new
  // key here, and every row sealed with the unreadable one was orphaned.
  it('never replaces a token it cannot decrypt', () => {
    const content = 'AI_MODEL=gpt-4o-mini\nAI_CONFIG_SECRET=tmcut:enc:v1:AAAA\n'
    const { dir, file } = withFile(content)
    try {
      const out = withStorage(corruptStorage, () => startup(file, undefined))
      assert.equal(out.decision, 'skip-unreadable')
      assert.equal(out.value, null, 'nothing may be handed to the env')
      assert.equal(readFileSync(file, 'utf8'), content, 'the unreadable slot stays exactly as it was')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not generate a master key when the keychain is unavailable', () => {
    const content = 'AI_MODEL=gpt-4o-mini\n'
    const { dir, file } = withFile(content)
    try {
      const out = withStorage(null, () => startup(file, undefined))
      assert.equal(out.decision, 'skip-unavailable')
      assert.equal(out.value, null, 'a plaintext master key would expose every stored key')
      assert.equal(readFileSync(file, 'utf8'), content)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cannot verify an encrypted slot without a keychain, so it skips', () => {
    const content = 'AI_CONFIG_SECRET=tmcut:enc:v1:AAAA\n'
    const { dir, file } = withFile(content)
    try {
      const out = withStorage(null, () => startup(file, undefined))
      assert.equal(out.decision, 'skip-unavailable')
      assert.equal(readFileSync(file, 'utf8'), content)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
